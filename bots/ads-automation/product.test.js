import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { syncProductStats,paymentFeedback,paymentFingerprint } from './product.js';

test('grouped product snapshots preserve revenue unit and late conversions',async()=>{
  const store=openStore(':memory:'),db=store.db;
  db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'pilot','Pilot','tarot-intl@pt','https://t.me/samplebot','BR','pt','test')`).run();
  db.prepare(`INSERT INTO candidates(id,project_id,surface,value,source,hypothesis)
    VALUES (1,1,'bots','@a_bot','fixture','direct'),(2,1,'search','tarot','fixture','direct')`).run();
  db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status)
    VALUES (1,1,1,'a','text','approved'),(2,1,2,'a','text','approved')`).run();
  db.prepare(`INSERT INTO experiments(id,project_id,candidate_id,creative_id,title,cpm,placement,ad_id,tracking_code)
    VALUES (1,1,1,1,'test-1',0.13,'bot_banner',11,'AAA'),(2,1,2,2,'test-2',0.10,'search_result',12,'BBB')`).run();
  let scans=0,revenue=0;
  const bridge=async req=>{assert.equal(req.action,'stats_all');assert.deepEqual(req.cohortCodes,['AAA','BBB']);
    assert.ok(Number.isSafeInteger(req.at));scans++;return {revenueUnit:'star',hasPayments:true,
      cohorts:{instances:[{instance:'tarot-intl-en',byCode:{AAA:{7:{eligibleUsers:3,revenue:revenue,revenueUnit:'star',refunds:null}}}}]},
      byCode:{AAA:{starts:4,returning:1,newUsers:3,payers:1,revenue,hasPayments:true}}};};
  assert.equal(await syncProductStats(store,{bridge,at:100000}),2);
  assert.equal(scans,1);
  assert.equal(await syncProductStats(store,{bridge,at:100001}),0);
  revenue=25;
  assert.equal(await syncProductStats(store,{bridge,at:100000+6*3600}),2);
  const observations=db.prepare('SELECT revenue,revenue_unit FROM product_observations WHERE experiment_id=1 ORDER BY at').all();
  assert.deepEqual(observations,[{revenue:0,revenue_unit:'star'},{revenue:25,revenue_unit:'star'}]);
  const feedback=paymentFeedback(store,1);
  assert.equal(feedback.experiments.length,2);
  assert.equal(feedback.experiments[0].cohorts[0][7].revenue,25);
  assert.equal(feedback.experiments[0].observedAt,121600);
  assert.match(feedback.rules,/Missing metrics are unknown/);
  const digest=paymentFingerprint(feedback),later=structuredClone(feedback);
  later.experiments[0].observedAt+=100;
  later.experiments[0].cohorts[0][7].asOf=200000;
  assert.equal(paymentFingerprint(later),digest);
  later.experiments[0].cohorts[0][7].revenue=30;
  assert.notEqual(paymentFingerprint(later),digest);
  store.close();
});
