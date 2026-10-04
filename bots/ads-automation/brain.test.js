import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,addJob } from './db.js';
import { applyBrainResult,validateBrainResult } from './brain.js';

test('model output rejects missing, extra, and non-finite fields',()=>{
  assert.throws(()=>validateBrainResult('copy',{ad_text:'Olá'}),/banner_text: required/);
  assert.throws(()=>validateBrainResult('copy',{ad_text:'Olá',banner_text:'Tarot',tool:'run'}),/unexpected field/);
  assert.throws(()=>validateBrainResult('image_qa',{approved:'yes',text_matches:true,language_matches:true,issues:[]}),/boolean required/);
  assert.throws(()=>validateBrainResult('research',{candidates:[{
    surface:'bots',value:'@samplebot',target:{},hypothesis:'test',source:'public',evidence:[],score:1e999
  }],assumptions:[]}),/finite number/);
});

test('invalid target from researcher cannot enter the candidate store',()=>{
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl','https://t.me/examplebot','BR','pt','test')`).run();
  const jobId=addJob(store.db,1,'research',{});
  const job=store.db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  assert.throws(()=>applyBrainResult(store,job,{candidates:[{
    surface:'channels',value:'invalid',target:{},hypothesis:'test',source:'public',evidence:[],score:1
  }],assumptions:[]}),/public @username/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM candidates').get().n,0);
  store.close();
});
