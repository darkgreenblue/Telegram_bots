import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,addJob } from './db.js';
import { applyBrainResult,validateBrainResult } from './brain.js';

test('model output rejects missing, extra, and non-finite fields',()=>{
  assert.throws(()=>validateBrainResult('copy',{ad_text:'Olá'}),/banner_text: required/);
  assert.throws(()=>validateBrainResult('copy',{ad_text:'Olá',banner_text:'Tarot',tool:'run'}),/unexpected field/);
  assert.throws(()=>validateBrainResult('image_qa',{approved:'yes',text_matches:true,language_matches:true,issues:[]}),/boolean required/);
  assert.throws(()=>validateBrainResult('research',{candidates:[{
    surface:'bots',value:'@samplebot',target_json:'{}',hypothesis:'test',source:'public',evidence_urls:[],score:1e999
  }],assumptions:[]}),/finite number/);
});

test('invalid target from researcher cannot enter the candidate store',()=>{
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl','https://t.me/examplebot','BR','pt','test')`).run();
  const jobId=addJob(store.db,1,'research',{});
  const job=store.db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  assert.throws(()=>applyBrainResult(store,job,{candidates:[{
    surface:'channels',value:'invalid',target_json:'{}',hypothesis:'test',source:'public',evidence_urls:['https://t.me/s/invalid'],score:1
  }],assumptions:[]}),/public @username/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM candidates').get().n,0);
  store.close();
});

test('research output uses a strict schema and preserves validated target evidence',()=>{
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl@en','https://t.me/examplebot','Global','en','test')`).run();
  const id=addJob(store.db,1,'research',{}),job=store.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const result={candidates:[{surface:'users',value:'English Android',
    target_json:'{"language_codes":["en"],"device":"android"}',hypothesis:'device split',
    source:'audience hypothesis',evidence_urls:[],score:2}],assumptions:[]};
  applyBrainResult(store,job,result);
  const candidate=store.db.prepare('SELECT target_json,evidence_json FROM candidates WHERE project_id=1').get();
  assert.deepEqual(JSON.parse(candidate.target_json),{language_codes:['en'],device:'android'});
  assert.deepEqual(JSON.parse(candidate.evidence_json),[]);
  assert.throws(()=>applyBrainResult(store,job,{...result,candidates:[{...result.candidates[0],target_json:'[]'}]}),
    /target must be an object/);
  store.close();
});
