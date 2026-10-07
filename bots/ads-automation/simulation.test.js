import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,addCandidate } from './db.js';
import { targetFor } from './targets.js';
import { createExperiment,createApproved,decide,pollExperiment } from './workflow.js';
import { refreshInsights } from './learning.js';

test('offline four-surface cycle records evidence without touching the Ads account',async()=>{
  const store=openStore(':memory:');
  const db=store.db;
  db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,
    target_cpa,approved_spend,status) VALUES (1,'pilot','Tarot','tarot-intl',
    'https://t.me/examplebot','BR','pt','Multilingual tarot bot',0.02,4,'ready')`).run();
  const specs=[
    {surface:'channels',value:'@publictarot',target:{}},
    {surface:'bots',value:'@publicbot',target:{}},
    {surface:'search',value:'tarot online',target:{}},
    {surface:'users',value:'BR-pt',target:{country_codes:['BR'],language_codes:['pt']}}
  ];
  const ids=[];
  for(const spec of specs){
    const candidateId=addCandidate(db,{projectId:1,...spec,source:'simulation',hypothesis:`audience via ${spec.surface}`});
    const image=spec.surface==='channels'?'/not-uploaded/simulation.jpg':null;
    const creativeId=Number(db.prepare(`INSERT INTO creatives(project_id,candidate_id,angle,ad_text,image_path,status)
      VALUES (?,?,?,?,?,'approved')`).run(1,candidateId,'curiosity','Seu tarot de hoje',image).lastInsertRowid);
    const candidate=db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId);
    const id=createExperiment(store,{projectId:1,candidateId,creativeId,cpm:0.18,placement:targetFor(candidate).placement});
    ids.push(id);
    const decision=db.prepare(`SELECT id FROM decisions WHERE experiment_id=? AND kind='create'`).get(id);
    decide(store,decision.id,true);
  }
  let writes=0;
  const disabledApi={live:false,getAccount:async()=>{writes++;throw new Error('account should not be called');}};
  for(const id of ids)await assert.rejects(createApproved(store,disabledApi,id,{resetMinute:0}),/cost capability gate/);
  assert.equal(writes,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM experiments WHERE ad_id IS NOT NULL').get().n,0);

  const id=ids[1];
  db.prepare(`UPDATE experiments SET ad_id=444,status='testing',first_view_at=unixepoch()-1200,spend_authorized=0.05 WHERE id=?`).run(id);
  let snapshot={ad_id:444,spent_budget:0.05,remaining_budget:0.95,daily_spent_budget:0.05,
    views:300,actions:4,status:'active',is_paused:false};
  const api={getAd:async()=>snapshot,call:async(method,params)=>{
    assert.equal(method,'editAd');assert.equal(params.ad_id,444);return {...snapshot,is_paused:true};
  }};
  await pollExperiment(store,api,id,{resetMinute:0});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rounds WHERE experiment_id=?').get(id).n,1);
  assert.equal(db.prepare(`SELECT kind FROM decisions WHERE experiment_id=? AND kind='graduate'`).get(id),undefined);
  db.prepare(`UPDATE experiments SET status='testing',test_round=2,start_spent=0.05,start_actions=4,
    start_views=300,last_spent=0.05,last_views=300,last_actions=4,spend_authorized=0.1 WHERE id=?`).run(id);
  snapshot={...snapshot,spent_budget:0.1,remaining_budget:0.9,daily_spent_budget:0.1,views:700,actions:8};
  await pollExperiment(store,api,id,{resetMinute:0});
  assert.equal(db.prepare(`SELECT kind FROM decisions WHERE experiment_id=? AND kind='graduate'`).get(id).kind,'graduate');
  refreshInsights(store,1);
  const evidence=db.prepare(`SELECT scope,status,evidence_json FROM insights WHERE project_id=1 AND status='validated'`).all();
  assert.equal(evidence.length,0); // The simulation has no verified serving product version.
  const observed=db.prepare("SELECT evidence_json FROM insights WHERE status='observed'").get();
  assert.equal(JSON.parse(observed.evidence_json).rounds.length,2);
  assert.equal(JSON.parse(observed.evidence_json).contextStatus,'product_version_unknown');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM operations').get().n,0);
  store.close();
});
