import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { refreshInsights } from './learning.js';
import { captureExperimentContext,readExperimentContext,usableInsights } from './learning-context.js';

function seed(){
  const store=openStore(':memory:'),db=store.db;
  db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,target_cpa)
    VALUES (1,'pilot','Pilot','tarot-intl','https://t.me/examplebot','English global','en','fixture',0.05)`).run();
  return store;
}
function experiment(store,id,{candidate=id,angle='love',hypothesis='direct tarot',version='fixture-v1',legacy=false}={}){
  const db=store.db;
  db.prepare(`INSERT OR IGNORE INTO candidates(id,project_id,surface,value,source,hypothesis)
    VALUES (?,1,'bots',?,'fixture',?)`).run(candidate,`@peer_${candidate}_bot`,hypothesis);
  db.prepare(`INSERT INTO creatives(id,project_id,candidate_id,angle,ad_text,status)
    VALUES (?,1,?,?,'text','approved')`).run(id,candidate,angle);
  db.prepare(`INSERT INTO experiments(id,project_id,candidate_id,creative_id,title,cpm,placement,ad_id)
    VALUES (?,1,?,?,?,0.13,'bot_banner',?)`).run(id,candidate,id,`fixture-${id}`,1000+id);
  if(!legacy){
    db.prepare('INSERT OR IGNORE INTO hypotheses(project_id,claim) VALUES (1,?)').run(hypothesis);
    const hypothesisId=db.prepare('SELECT id FROM hypotheses WHERE project_id=1 AND claim=?').get(hypothesis).id;
    db.prepare('INSERT INTO experiment_contexts(experiment_id,context_json) VALUES (?,?)').run(id,JSON.stringify({
      schema:1,hypothesisId,hypothesis,market:'English global',language:'en',targetCpa:0.05,
      productScope:'tarot-intl',destination:'https://t.me/examplebot',
      surface:'bots',candidate:`@peer_${candidate}_bot`,target:{},angle,productVersion:version,
      productVersionEvidence:version?{verified:true,source:'isolated test fixture'}:null}));
  }
}
function round(store,id,number,{spent=0.05,actions=3,views=300}={}){
  store.db.prepare(`INSERT INTO rounds(experiment_id,number,spent,actions,views,reason)
    VALUES (?,?,?,?,?,'fixture')`).run(id,number,spent,actions,views);
}
const validated=store=>store.db.prepare("SELECT * FROM insights WHERE status='validated' ORDER BY id").all();

test('partial rounds remain observations and cannot become validated insights',()=>{
  const store=seed();experiment(store,1);
  round(store,1,1,{spent:0.001});round(store,1,2,{spent:0.001});
  refreshInsights(store,1);
  assert.equal(validated(store).length,0);
  assert.equal(store.db.prepare('SELECT status FROM insights').get().status,'observed');
  store.close();
});

test('a later weak round withdraws current validation and retains prior evidence',()=>{
  const store=seed();experiment(store,1);round(store,1,1);round(store,1,2);
  refreshInsights(store,1);
  const old=validated(store)[0];assert.equal(JSON.parse(old.evidence_json).rounds.length,2);
  const unchanged=store.db.prepare('SELECT COUNT(*) n FROM audit').get().n;
  refreshInsights(store,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM audit').get().n,unchanged);
  round(store,1,3,{actions:0});refreshInsights(store,1);
  assert.equal(validated(store).length,0);
  assert.equal(store.db.prepare('SELECT status FROM insights WHERE id=?').get(old.id).status,'needs_review');
  const history=store.db.prepare("SELECT details_json FROM audit WHERE action='insight.review_required'").get();
  assert.deepEqual(JSON.parse(history.details_json).previous,old);
  const observed=store.db.prepare("SELECT evidence_json FROM insights WHERE status='observed'").get();
  assert.equal(JSON.parse(observed.evidence_json).rounds.length,3);
  // Campaign deletion does not remove rounds or archived learning evidence.
  store.db.prepare("UPDATE experiments SET status='deleted' WHERE id=1").run();refreshInsights(store,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM rounds').get().n,3);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='insight.review_required'").get().n,1);
  // Two subsequent complete successes can qualify the same claim again.
  round(store,1,4);round(store,1,5);refreshInsights(store,1);
  assert.equal(validated(store)[0].id,old.id);
  assert.equal(JSON.parse(validated(store)[0].evidence_json).rounds.length,5);
  store.close();
});

test('separate creatives on the same peer cannot overwrite each other’s claims',()=>{
  const store=seed();
  experiment(store,1,{candidate:1,angle:'love'});experiment(store,2,{candidate:1,angle:'reflection'});
  for(const id of [1,2]){round(store,id,1);round(store,id,2);}
  refreshInsights(store,1);
  assert.equal(validated(store).length,2);
  assert.deepEqual(validated(store).map(i=>JSON.parse(i.evidence_json).experimentId),[1,2]);
  round(store,2,3,{actions:0});refreshInsights(store,1);
  assert.equal(validated(store).length,1);
  assert.equal(JSON.parse(validated(store)[0].evidence_json).angle,'love');
  store.close();
});

test('a product claim loses validation if current repeated evidence no longer covers three peers',()=>{
  const store=seed();
  for(let id=1;id<=3;id++){
    experiment(store,id,{angle:id===3?'reflection':'love'});round(store,id,1);round(store,id,2);
  }
  refreshInsights(store,1);
  const product=validated(store).find(i=>i.scope==='product');assert.ok(product);
  round(store,3,3,{actions:0});refreshInsights(store,1);
  assert.equal(validated(store).filter(i=>i.scope==='product').length,0);
  const saved=store.db.prepare('SELECT * FROM insights WHERE id=?').get(product.id);
  assert.equal(saved.status,'needs_review');assert.equal(saved.evidence_json,product.evidence_json);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM operations').get().n,0);
  store.close();
});

test('legacy conflated channel claims are held with their original evidence intact',()=>{
  const store=seed();experiment(store,1);round(store,1,1);round(store,1,2);
  const original=JSON.stringify({experimentId:1,rounds:[{spent:0.05,actions:3},{spent:0.05,actions:3}]});
  store.db.prepare(`INSERT INTO insights(project_id,scope,claim,evidence_json,status)
    VALUES (1,'channel','legacy claim',?,'validated')`).run(original);
  refreshInsights(store,1);
  const legacy=store.db.prepare("SELECT * FROM insights WHERE claim='legacy claim'").get();
  assert.equal(legacy.status,'needs_review');assert.equal(legacy.evidence_json,original);
  assert.equal(validated(store).length,1);
  store.close();
});

test('later project, candidate and creative edits cannot relabel an old test',()=>{
  const store=seed(),db=store.db;experiment(store,1);round(store,1,1);round(store,1,2);
  refreshInsights(store,1);const before=validated(store)[0];
  db.prepare("UPDATE projects SET market='Brazil',language='pt',target_cpa=0.001 WHERE id=1").run();
  db.prepare("UPDATE candidates SET hypothesis='different audience',value='@renamed_bot' WHERE id=1").run();
  db.prepare("UPDATE creatives SET angle='different angle' WHERE id=1").run();
  refreshInsights(store,1);
  assert.deepEqual(validated(store)[0],before);
  assert.equal(usableInsights(store,db.prepare('SELECT * FROM projects').get()).length,0);
  assert.throws(()=>db.prepare("UPDATE experiment_contexts SET context_json='{}'").run(),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM experiment_contexts').run(),/immutable/);
  assert.throws(()=>db.prepare("UPDATE hypotheses SET claim='redefined'").run(),/immutable/);
  store.close();
});

test('unknown product version and legacy contexts remain observations despite good CPA',()=>{
  const store=seed();experiment(store,1,{version:null});experiment(store,2,{legacy:true});
  for(const id of [1,2]){round(store,id,1);round(store,id,2);}
  refreshInsights(store,1);assert.equal(validated(store).length,0);
  const observed=store.db.prepare("SELECT * FROM insights WHERE status='observed' ORDER BY id").all();
  assert.deepEqual(observed.map(i=>JSON.parse(i.evidence_json).contextStatus),['product_version_unknown','legacy_unknown']);
  assert.equal(JSON.parse(observed[1].evidence_json).market,null);
  assert.equal(observed[1].hypothesis,'');
  store.close();
});

test('different product versions or different exact hypotheses cannot combine into a product claim',()=>{
  const store=seed();
  experiment(store,1);experiment(store,2);experiment(store,3,{angle:'reflection',version:'fixture-v2'});
  experiment(store,4,{angle:'reflection',hypothesis:'a similar but distinct hypothesis'});
  for(const id of [1,2,3,4]){round(store,id,1);round(store,id,2);}
  refreshInsights(store,1);
  assert.equal(validated(store).filter(i=>i.scope==='channel').length,4);
  assert.equal(validated(store).filter(i=>i.scope==='product').length,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM hypotheses').get().n,2);
  store.close();
});

test('new snapshots reuse exact hypothesis identity, remain immutable, and do not guess product version',()=>{
  const store=seed();experiment(store,1,{legacy:true});experiment(store,2,{legacy:true});
  store.db.prepare('UPDATE experiments SET ad_id=NULL').run();
  const a=captureExperimentContext(store,1),b=captureExperimentContext(store,2);
  assert.equal(JSON.parse(a.context_json).hypothesisId,JSON.parse(b.context_json).hypothesisId);
  store.db.prepare("UPDATE candidates SET hypothesis='changed later' WHERE id=1").run();
  assert.deepEqual(captureExperimentContext(store,1),a);
  assert.equal(readExperimentContext(store.db,1).productVersion,null);
  store.close();
});

test('historical context cannot be invented after a campaign was created',()=>{
  const store=seed();experiment(store,1,{legacy:true});
  assert.throws(()=>captureExperimentContext(store,1),/historical experiment/);
  store.db.prepare('UPDATE experiments SET ad_id=NULL WHERE id=1').run();round(store,1,1);
  assert.throws(()=>captureExperimentContext(store,1),/historical experiment/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM experiment_contexts').get().n,0);
  store.close();
});
