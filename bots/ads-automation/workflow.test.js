import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { pollExperiment,executeDecision,projectCapacity,projectSpendCommitment,createApproved } from './workflow.js';
import { AdsApi } from './api.js';

const safeResetMinute=()=>Math.floor(((Date.now()/1000)%86400)/60+180)%1440;

const seed=store=>{
  const db=store.db;
  db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,target_cpa,approved_spend,status)
    VALUES (1,'pilot','Pilot','tarot-intl@pt','https://t.me/examplebot','BR','pt','test',0.02,3,'ready')`).run();
  db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis) VALUES (1,1,'bots','@examplebot','test','persona')`).run();
  db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status) VALUES (1,1,1,'angle','Ad','approved')`).run();
  db.prepare(`INSERT INTO experiments(id,project_id,candidate_id,creative_id,title,cpm,placement,ad_id,status,first_view_at,spend_authorized)
    VALUES (1,1,1,1,'unique',0.13,'bot_banner',444,'testing',unixepoch()-1000,0.05)`).run();
};

test('a matching account title without local create history cannot claim an old campaign',async()=>{
  const store=openStore(':memory:');seed(store);
  const previousGate=process.env.ADS_COST_GATE_VERIFIED;process.env.ADS_COST_GATE_VERIFIED='1';
  try{
    store.db.prepare("UPDATE experiments SET ad_id=NULL,status='draft',spend_authorized=0,tracking_code='FIXTURE' WHERE id=1").run();
    store.db.prepare("INSERT INTO decisions(project_id,experiment_id,kind,payload_json,status) VALUES(1,1,'create','{}','approved')").run();
    const api={live:true,getAccount:async()=>({currency:'TON',remaining_budget:20}),
      findByTitle:async()=>({ad_id:999,title:'unique'}),call:async()=>assert.fail('cannot mutate existing campaign')};
    await assert.rejects(createApproved(store,api,1,{resetMinute:safeResetMinute(),bridge:async()=>({username:'examplebot'})}),/unowned title collision/);
    assert.equal(store.db.prepare('SELECT ad_id FROM experiments WHERE id=1').get().ad_id,null);
  }finally{
    if(previousGate===undefined)delete process.env.ADS_COST_GATE_VERIFIED;else process.env.ADS_COST_GATE_VERIFIED=previousGate;
    store.close();
  }
});

test('uncertain create retries preserve the original provider deadline and financial reservation',async()=>{
  const store=openStore(':memory:');seed(store);
  const previousGate=process.env.ADS_COST_GATE_VERIFIED;process.env.ADS_COST_GATE_VERIFIED='1';
  try{
    store.db.prepare("UPDATE experiments SET ad_id=NULL,status='draft',spend_authorized=0,tracking_code='FIXTURE' WHERE id=1").run();
    store.db.prepare("INSERT INTO decisions(project_id,experiment_id,kind,payload_json,status) VALUES(1,1,'create','{}','approved')").run();
    let first=true,writes=0,original;
    const api=new AdsApi({token:'fixture',store,live:true,wait:async()=>{},fetcher:async(url,request)=>{
      if(url.endsWith('/getCurrentAccount'))return {ok:true,status:200,json:async()=>({ok:true,result:{currency:'TON',remaining_budget:20}})};
      if(url.endsWith('/getAdsList'))return {ok:true,status:200,json:async()=>({ok:true,result:{ads:[]}})};
      writes++;original=JSON.parse(request.body);
      if(first)throw new Error('unknown response');
      return {ok:true,status:200,json:async()=>({ok:true,result:{ad_id:555,status:'in_review'}})};
    }});
    const options={resetMinute:safeResetMinute(),bridge:async()=>({username:'examplebot'})};
    await assert.rejects(createApproved(store,api,1,options),/unknown response/);
    store.db.prepare("UPDATE operations SET request_json=? WHERE op_key='create-1'")
      .run(JSON.stringify({...original,deactivate_date:1}));
    await assert.rejects(createApproved(store,api,1,options),/expired uncertain create/);
    assert.equal(writes,4);
    store.db.prepare("UPDATE operations SET request_json=? WHERE op_key='create-1'").run(JSON.stringify(original));
    store.db.prepare("UPDATE creatives SET ad_text='Changed after unknown outcome' WHERE id=1").run();
    await assert.rejects(createApproved(store,api,1,options),/request changed/);
    assert.equal(writes,4);
    store.db.prepare("UPDATE creatives SET ad_text='Ad' WHERE id=1").run();
    // A later retry calculates a different deadline; persisted request remains authoritative.
    const persisted={...original,deactivate_date:original.deactivate_date-30};
    store.db.prepare("UPDATE operations SET request_json=? WHERE op_key='create-1'").run(JSON.stringify(persisted));
    first=false;
    assert.equal(await createApproved(store,api,1,options),555);
    assert.deepEqual(original,persisted);assert.equal(writes,5);
    assert.equal(projectSpendCommitment(store.db,1),0.05);
    assert.equal(store.db.prepare('SELECT lease_until FROM experiments WHERE id=1').get().lease_until,persisted.deactivate_date);
  }finally{
    if(previousGate===undefined)delete process.env.ADS_COST_GATE_VERIFIED;else process.env.ADS_COST_GATE_VERIFIED=previousGate;
    store.close();
  }
});

test('full 0.05 test is paused, recorded, and sent for review',async()=>{
  const store=openStore(':memory:');seed(store);let paused=0;
  const ad={ad_id:444,spent_budget:0.05,remaining_budget:0.95,daily_spent_budget:0.05,
    views:250,actions:3,status:'active',is_paused:false};
  const api={getAd:async()=>ad,call:async(method,params)=>{if(method==='editAd'&&params.is_paused)paused++;return {...ad,is_paused:true};}};
  await pollExperiment(store,api,1,{resetMinute:0});
  assert.equal(paused,1);
  assert.equal(store.db.prepare('SELECT status FROM experiments WHERE id=1').get().status,'paused');
  assert.equal(store.db.prepare('SELECT spent FROM rounds WHERE experiment_id=1').get().spent,0.05);
  assert.equal(store.db.prepare(`SELECT kind FROM decisions WHERE experiment_id=1`).get().kind,'review');store.close();
});

test('provider spend beyond a reserved test share locks the whole project',async()=>{
  const store=openStore(':memory:');seed(store);
  const ad={ad_id:444,spent_budget:0.06,remaining_budget:0.94,daily_spent_budget:0.06,
    views:250,actions:2,status:'active',is_paused:false};
  let pauses=0;
  const api={getAd:async()=>ad,call:async(method,params)=>{
    if(method==='editAd'&&params.is_paused)pauses++;
    return {...ad,is_paused:true};
  }};
  await pollExperiment(store,api,1,{resetMinute:0});
  assert.equal(pauses,1);
  assert.equal(store.db.prepare('SELECT status FROM projects WHERE id=1').get().status,'paused');
  assert.equal(store.db.prepare(`SELECT kind FROM decisions WHERE experiment_id=1`).get().kind,'review');
  store.close();
});

test('deletion cannot reclaim before ten inactive minutes',async()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE experiments SET status='paused',stopped_at=unixepoch()-599 WHERE id=1`).run();
  store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json,status) VALUES (1,1,1,'delete','{}','approved')`).run();
  let deletions=0;const api={getAd:async()=>({ad_id:444,is_paused:true,remaining_budget:0.95}),
    call:async()=>{deletions++;return true;}};
  await executeDecision(store,api,1,{resetMinute:0});assert.equal(deletions,0);
  store.db.prepare(`UPDATE experiments SET stopped_at=unixepoch()-601 WHERE id=1`).run();
  await executeDecision(store,api,1,{resetMinute:0});assert.equal(deletions,1);
  assert.equal(store.db.prepare('SELECT status FROM experiments WHERE id=1').get().status,'deleted');store.close();
});

test('ready-for-review ads are submitted explicitly after account review state changes',async()=>{
  const store=openStore(':memory:');seed(store);let submitted=0;
  const ad={ad_id:444,spent_budget:0,remaining_budget:1,daily_spent_budget:0,
    views:0,actions:0,status:'ready_for_review',is_paused:false};
  const api={getAd:async()=>ad,call:async(method,params)=>{
    assert.equal(method,'submitAdForReview');assert.equal(params.ad_id,444);submitted++;return {...ad,status:'in_review'};
  }};
  await pollExperiment(store,api,1,{resetMinute:0});
  assert.equal(submitted,1);
  assert.equal(store.db.prepare('SELECT status FROM experiments WHERE id=1').get().status,'review');
  store.close();
});

test('project cap counts money already spent even after a campaign was deleted',()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE experiments SET status='deleted',allocated_total=1,returned_total=0.6,last_remaining=0 WHERE id=1`).run();
  assert.deepEqual(projectCapacity(store.db,1),{slots:0,allocated:0.4});
  store.close();
});

test('twenty allocated campaigns remain distinct from a three TON spend ceiling',async()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE experiments SET status='paused',spend_authorized=0.05 WHERE id=1`).run();
  for(let id=2;id<=20;id++)store.db.prepare(`INSERT INTO experiments(
    id,project_id,candidate_id,creative_id,title,cpm,placement,ad_id,status,spend_authorized)
    VALUES (?,?,?,?,?,0.13,'bot_banner',?,'paused',0.05)`).run(id,1,1,1,`ad-${id}`,1000+id);
  assert.deepEqual(projectCapacity(store.db,1),{slots:20,allocated:20});
  assert.equal(projectSpendCommitment(store.db,1),1);
  store.db.prepare(`UPDATE experiments SET spend_authorized=1 WHERE id IN (2,3)`).run();
  store.db.prepare(`UPDATE experiments SET spend_authorized=0.15 WHERE id=4`).run();
  assert.equal(projectSpendCommitment(store.db,1),3);
  store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json,status)
    VALUES (30,1,1,'continue','{}','approved'),(31,1,1,'graduate','{}','approved')`).run();
  store.db.prepare(`INSERT INTO rounds(experiment_id,number,spent,actions,views,reason)
    VALUES (1,1,0.05,3,300,'test'),(1,2,0.05,3,300,'test')`).run();
  const before=process.env.ADS_COST_GATE_VERIFIED;
  process.env.ADS_COST_GATE_VERIFIED='1';
  let writes=0;
  const api={live:true,getAd:async()=>({ad_id:444,spent_budget:0.05,remaining_budget:0.95,
    daily_spent_budget:0.05,views:300,actions:3,is_paused:true}),call:async()=>{writes++;}};
  try{
    for(const id of [30,31])await assert.rejects(
      executeDecision(store,api,id,{resetMinute:safeResetMinute()}),/project spend cap exhausted/);
    assert.equal(writes,0);
    assert.equal(store.db.prepare('SELECT test_round FROM experiments WHERE id=1').get().test_round,1);
    assert.equal(projectSpendCommitment(store.db,1),3);
  }finally{
    if(before===undefined)delete process.env.ADS_COST_GATE_VERIFIED;
    else process.env.ADS_COST_GATE_VERIFIED=before;
    store.close();
  }
});

test('an untouched ad stopped during review receives a fresh bounded lease',async()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE projects SET approved_spend=1 WHERE id=1`).run();
  store.db.prepare(`UPDATE experiments SET status='review',review_status='in_review',first_view_at=NULL,
    lease_until=unixepoch()-60 WHERE id=1`).run();
  const ad={ad_id:444,spent_budget:0,remaining_budget:1,daily_spent_budget:0,
    views:0,actions:0,status:'stopped',is_paused:true};
  let edit;
  const api={live:true,getAd:async()=>ad,call:async(method,params)=>{assert.equal(method,'editAd');edit=params;return ad;}};
  const before=process.env.ADS_COST_GATE_VERIFIED;
  process.env.ADS_COST_GATE_VERIFIED='1';
  try{
    await pollExperiment(store,api,1,{resetMinute:safeResetMinute()});
    assert.equal(edit.ad_id,444);
    assert.equal(edit.daily_budget_limit,0.05);
    assert.equal(edit.is_paused,false);
    assert.equal(store.db.prepare('SELECT status FROM experiments WHERE id=1').get().status,'testing');
  }finally{
    if(before===undefined)delete process.env.ADS_COST_GATE_VERIFIED;
    else process.env.ADS_COST_GATE_VERIFIED=before;
    store.close();
  }
});

test('a disabled cost gate blocks both test continuation and winner graduation',async()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE projects SET approved_spend=2 WHERE id=1`).run();
  store.db.prepare(`UPDATE experiments SET status='paused' WHERE id=1`).run();
  store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json,status)
    VALUES (20,1,1,'continue','{}','approved'),(21,1,1,'graduate','{}','approved')`).run();
  const before=process.env.ADS_COST_GATE_VERIFIED;
  process.env.ADS_COST_GATE_VERIFIED='0';
  let calls=0;
  const api={live:true,call:async()=>{calls++;return true;}};
  try{
    for(const id of [20,21])await assert.rejects(
      executeDecision(store,api,id,{resetMinute:safeResetMinute()}),/cost capability gate/);
    assert.equal(calls,0);
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM decisions WHERE status='approved'`).get().n,2);
  }finally{
    if(before===undefined)delete process.env.ADS_COST_GATE_VERIFIED;
    else process.env.ADS_COST_GATE_VERIFIED=before;
    store.close();
  }
});

test('pauseall during a delayed recharge check prevents a financial API write',async()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE projects SET approved_spend=2 WHERE id=1`).run();
  store.db.prepare(`UPDATE experiments SET status='paused' WHERE id=1`).run();
  store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json,status)
    VALUES (8,1,1,'recharge','{"amount":1}','approved')`).run();
  const before=process.env.ADS_COST_GATE_VERIFIED;
  process.env.ADS_COST_GATE_VERIFIED='1';
  let writes=0;
  const api={live:true,getAd:async()=>{
    store.db.prepare("UPDATE projects SET status='paused' WHERE id=1").run();
    return {ad_id:444,remaining_budget:0,is_paused:true};
  },getAccount:async()=>({currency:'TON',remaining_budget:10}),call:async()=>{writes++;}};
  try{
    await assert.rejects(executeDecision(store,api,8,{resetMinute:safeResetMinute()}),/project not approved/);
    assert.equal(writes,0);
    assert.equal(store.db.prepare('SELECT spend_reservation_applied FROM decisions WHERE id=8').get().spend_reservation_applied,0);
  }finally{
    if(before===undefined)delete process.env.ADS_COST_GATE_VERIFIED;
    else process.env.ADS_COST_GATE_VERIFIED=before;
    store.close();
  }
});

test('recharge after an interrupted resume allocates only one extra TON',async()=>{
  const store=openStore(':memory:');seed(store);
  store.db.prepare(`UPDATE projects SET approved_spend=2 WHERE id=1`).run();
  store.db.prepare(`UPDATE experiments SET status='paused' WHERE id=1`).run();
  store.db.prepare(`INSERT INTO decisions(id,project_id,experiment_id,kind,payload_json,status)
    VALUES (9,1,1,'recharge','{"amount":1}','approved')`).run();
  const before=process.env.ADS_COST_GATE_VERIFIED;
  process.env.ADS_COST_GATE_VERIFIED='1';
  let increased=0,failResume=true;
  const fetcher=async url=>{
    const method=url.split('/').at(-1);
    if(method==='increaseAdBudget')increased++;
    if(method==='editAd'&&failResume)throw new Error('resume temporarily unavailable');
    return {ok:true,status:200,json:async()=>({ok:true,result:method==='getCurrentAccount'
      ?{currency:'TON',remaining_budget:10}:method==='getAdsById'
        ?[{ad_id:444,remaining_budget:increased?1:0}]:true})};
  };
  const api=new AdsApi({token:'test',store,fetcher,live:true});
  try{
    await assert.rejects(executeDecision(store,api,9,{resetMinute:safeResetMinute()}),/temporarily unavailable/);
    assert.equal(store.db.prepare('SELECT allocated_total FROM experiments WHERE id=1').get().allocated_total,2);
    assert.equal(projectSpendCommitment(store.db,1),2);
    failResume=false;
    await executeDecision(store,api,9,{resetMinute:safeResetMinute()});
    assert.equal(increased,1);
    assert.equal(store.db.prepare('SELECT allocated_total FROM experiments WHERE id=1').get().allocated_total,2);
    assert.equal(store.db.prepare('SELECT status FROM decisions WHERE id=9').get().status,'executed');
  }finally{
    if(before===undefined)delete process.env.ADS_COST_GATE_VERIFIED;
    else process.env.ADS_COST_GATE_VERIFIED=before;
    store.close();
  }
});
