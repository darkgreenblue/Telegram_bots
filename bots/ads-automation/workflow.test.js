import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { pollExperiment,executeDecision,projectCapacity } from './workflow.js';
import { AdsApi } from './api.js';

const safeResetMinute=()=>Math.floor(((Date.now()/1000)%86400)/60+180)%1440;

const seed=store=>{
  const db=store.db;
  db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,target_cpa,status)
    VALUES (1,'pilot','Pilot','tarot-intl@pt','https://t.me/examplebot','BR','pt','test',0.02,'ready')`).run();
  db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis) VALUES (1,1,'bots','@examplebot','test','persona')`).run();
  db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status) VALUES (1,1,1,'angle','Ad','approved')`).run();
  db.prepare(`INSERT INTO experiments(id,project_id,candidate_id,creative_id,title,cpm,placement,ad_id,status,first_view_at)
    VALUES (1,1,1,1,'unique',0.13,'bot_banner',444,'testing',unixepoch()-1000)`).run();
};

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
      ?{currency:'TON',remaining_budget:10}:true})};
  };
  const api=new AdsApi({token:'test',store,fetcher,live:true});
  try{
    await assert.rejects(executeDecision(store,api,9,{resetMinute:safeResetMinute()}),/temporarily unavailable/);
    assert.equal(store.db.prepare('SELECT allocated_total FROM experiments WHERE id=1').get().allocated_total,2);
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
