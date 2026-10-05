import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTest,canGraduate,remainingTest,cadence } from './policy.js';
import { leaseEnd } from './workflow.js';
import { targetFor } from './targets.js';

test('a second calendar day only has the unused test share',()=>{
  assert.equal(remainingTest(0.02,0),0.03);
  assert.equal(remainingTest(0.025,0),0.02); // precision cannot round up
  assert.equal(assessTest({spent:0.05,actions:2,views:220,firstViewAt:100,now:200,targetCpa:0.03}).kind,'review');
});
test('slow campaign rule uses 48 hours from first view and independent 0.03 CPA',()=>{
  const base={views:90,firstViewAt:100,now:100+48*3600,targetCpa:0.01,testStartSpent:0};
  assert.equal(assessTest({...base,spent:0.02,actions:1}).kind,'continue');
  assert.equal(assessTest({...base,spent:0.04,actions:1}).kind,'reclaim');
  assert.equal(assessTest({...base,spent:0.02,actions:0}).kind,'reclaim');
});
test('winning requires repeated action-bearing tests',()=>{
  assert.equal(canGraduate([{spent:0.05,actions:5}],0.02),false);
  assert.equal(canGraduate([{spent:0.05,actions:3},{spent:0.05,actions:2}],0.03),true);
  assert.equal(canGraduate([{spent:0.05,actions:3},{spent:0.05,actions:0}],0.03),false);
});
test('provider-side lease cannot cross verified budget reset',()=>{
  const t=86400+12*3600;
  assert.equal(leaseEnd(t,0),t+3600);
  assert.throws(()=>leaseEnd(86300,0),/close|reset/);
});
test('one target per experiment across all four surfaces',()=>{
  assert.deepEqual(targetFor({surface:'channels',value:'@samplechannel'}).target.channel_ids,['@samplechannel']);
  assert.deepEqual(targetFor({surface:'bots',value:'@samplebot'}).target.bot_ids,['@samplebot']);
  assert.deepEqual(targetFor({surface:'search',value:'tarot love'}).target.search_queries,['tarot love']);
  assert.deepEqual(targetFor({surface:'users',target:{country_codes:['BR'],language_codes:['pt']}}).target.country_codes,['BR']);
  assert.throws(()=>targetFor({surface:'users',target:{}}),/filter/);
});
test('check cadence accelerates on fast spending',()=>{
  const now=1000;
  assert.equal(cadence({views:10,spent:0,firstViewAt:950},now),60);
  assert.ok(cadence({views:500,spent:0.04,lastViews:100,lastSpent:0.01,lastCheckedAt:700,firstViewAt:100},now)<=300);
});
