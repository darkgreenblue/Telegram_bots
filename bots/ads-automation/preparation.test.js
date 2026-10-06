import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { prepareCandidates } from './preparation.js';
import { createExperiment } from './workflow.js';

function fixture(max=20){
  const store=openStore(':memory:'),db=store.db;
  db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,status,max_campaigns)
    VALUES(1,'variants','Variants','tarot-intl@en','https://t.me/examplebot','Global','en','test','ready',?)`).run(max);
  db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis)
    VALUES(1,1,'bots','@samplebot','public','persona')`).run();
  for(const id of [1,2])db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status)
    VALUES(?,1,1,?,'Read tarot','approved')`).run(id,`angle-${id}`);
  return store;
}

test('new creative on a prepared candidate gets its own draft and owner decision, without financial authority',()=>{
  const store=fixture();
  try{
    const first=prepareCandidates(store),second=prepareCandidates(store);
    assert.equal(first.length,1);assert.equal(second.length,1);
    assert.notEqual(first[0],second[0]);
    assert.deepEqual(prepareCandidates(store),[]);
    const experiments=store.db.prepare('SELECT * FROM experiments ORDER BY id').all();
    assert.deepEqual(experiments.map(e=>e.creative_id),[1,2]);
    assert.equal(new Set(experiments.map(e=>e.title)).size,2);
    assert.ok(experiments.every(e=>e.status==='draft'&&e.tracking_code===null&&e.ad_id===null&&e.spend_authorized===0));
    const decisions=store.db.prepare('SELECT kind,status FROM decisions').all();
    assert.deepEqual(decisions,[{kind:'create',status:'pending'},{kind:'create',status:'pending'}]);
    assert.equal(store.db.prepare('SELECT count(*) n FROM operations').get().n,0);
  }finally{store.close();}
});

test('creative variants respect draft campaign slots and preserve deleted test evidence',()=>{
  const store=fixture(1);
  try{
    const [first]=prepareCandidates(store);
    assert.deepEqual(prepareCandidates(store),[]);
    store.db.prepare(`INSERT INTO rounds(experiment_id,number,spent,actions,views,reason)
      VALUES(?,1,0.05,2,300,'fixture')`).run(first);
    store.db.prepare("UPDATE experiments SET status='deleted' WHERE id=?").run(first);
    const [second]=prepareCandidates(store);
    assert.ok(second>first);
    assert.deepEqual(prepareCandidates(store),[]);
    assert.equal(store.db.prepare('SELECT count(*) n FROM rounds WHERE experiment_id=?').get(first).n,1);
    assert.equal(store.db.prepare('SELECT count(*) n FROM experiments').get().n,2);
  }finally{store.close();}
});

test('replaying preparation returns the original draft and cannot change its bid or candidate',()=>{
  const store=fixture();
  try{
    const request={projectId:1,candidateId:1,creativeId:1,cpm:0.13,placement:'bot_banner'};
    const first=createExperiment(store,request);
    assert.equal(createExperiment(store,request),first);
    assert.throws(()=>createExperiment(store,{...request,cpm:0.2}),/parameters differ/);
    store.db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis)
      VALUES(2,1,'bots','@anotherbot','public','other')`).run();
    assert.throws(()=>createExperiment(store,{...request,candidateId:2}),/another candidate/);
    assert.equal(store.db.prepare('SELECT count(*) n FROM experiments').get().n,1);
    assert.equal(store.db.prepare('SELECT count(*) n FROM decisions').get().n,1);
  }finally{store.close();}
});

test('withheld peers and failed image QA never become drafts',()=>{
  const store=fixture();
  try{
    store.db.prepare("UPDATE candidates SET status='withheld' WHERE id=1").run();
    assert.deepEqual(prepareCandidates(store),[]);
    store.db.prepare("UPDATE candidates SET status='found' WHERE id=1").run();
    store.db.prepare("UPDATE creatives SET status='qa_failed'").run();
    assert.deepEqual(prepareCandidates(store),[]);
    assert.equal(store.db.prepare('SELECT count(*) n FROM decisions').get().n,0);
  }finally{store.close();}
});
