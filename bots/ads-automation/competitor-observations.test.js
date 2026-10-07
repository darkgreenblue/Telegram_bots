import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,addCandidate } from './db.js';
import { archiveCompetitorObservation,competitorBenchmark,competitorInspiration } from './competitor-observations.js';
import { queueStrategy,queueResearch,applyBrainResult } from './brain.js';

test('competitor benchmark preserves exact introductions, claims and versioned observations without duplicate writes',()=>{
  const s=openStore(':memory:');try{
    s.db.exec("INSERT INTO projects(id,slug,name,scope,destination,market,language,context) VALUES(1,'fixture','fixture','fixture','fixture','Global','en','fixture')");
    const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'fixture',hypothesis:'direct'});
    const input={url:'https://t.me/samplebot',checkedAt:new Date().toISOString(),source:'support-web',section:'start',
      visibleText:'Your Tarot reader. Choose a language.',menuLabels:['English'],keywords:['Tarot','reader'],
      advertisedFeatures:['Tarot readings'],observedFeatures:['Language selection'],limitations:['No paid reading completed'],
      artifacts:[{name:'start.png',sha256:'a'.repeat(64)}]};
    const first=archiveCompetitorObservation(s,id,input);assert.equal(first.created,true);
    assert.deepEqual(archiveCompetitorObservation(s,id,input),{observationId:first.observationId,created:false});
    archiveCompetitorObservation(s,id,{...input,section:'help',visibleText:'Tarot reader help'});
    const history=competitorBenchmark(s,id);assert.equal(history.length,2);
    assert.equal(history[1].visibleText,input.visibleText);assert.equal(history[1].advertisedFeatures[0],'Tarot readings');
    assert.throws(()=>s.db.prepare('DELETE FROM competitor_observations WHERE id=?').run(first.observationId),/immutable/);
    assert.throws(()=>s.db.prepare("UPDATE competitor_observations SET observation_json='{}' WHERE id=?").run(first.observationId),/immutable/);
    assert.throws(()=>archiveCompetitorObservation(s,id,{...input,url:'https://t.me/anotherbot'}),/identity/);
    assert.throws(()=>archiveCompetitorObservation(s,id,{...input,keywords:['invented feature']}),/absent/);
    assert.throws(()=>archiveCompetitorObservation(s,id,{...input,artifacts:[{name:'../secret.txt',sha256:'a'.repeat(64)}]}),/invalid/);
    assert.throws(()=>competitorBenchmark(s,id,{limit:1000}),/invalid/);
    const ad={kind:'telegram-sponsored',text:'Love Tarot Readings',destinationUrl:null,
      location:'Above the message list',relevance:'related',relevanceReason:'Tarot service mentioned',performance:'successful'};
    archiveCompetitorObservation(s,id,{...input,section:'product',advertisements:[ad,
      {...ad,text:'Game ad',relevance:'unrelated'}]});
    const inspiration=competitorInspiration(s,1);
    assert.equal(inspiration.observations[0].advertisements.length,1);
    assert.equal(inspiration.observations[0].advertisements[0].performance,'unknown');
    assert.equal(inspiration.observations[0].advertisements[0].destinationUrl,null);
    for(const jobId of [queueStrategy(s,id),queueResearch(s,1)]){
      const payload=JSON.parse(s.db.prepare('SELECT input_json FROM jobs WHERE id=?').get(jobId).input_json);
      assert.match(payload.competitorInspiration.use,/inspiration-only/);
      assert.equal(payload.competitorInspiration.observations[0].observationId>0,true);
    }
    const channel=addCandidate(s.db,{projectId:1,surface:'channels',value:'@channelbot',source:'fixture',hypothesis:'direct'});
    const copy={project_id:1,kind:'copy',input_json:JSON.stringify({candidateId:channel,
      strategy:{angle:'love',visual_brief:'original variant'}})};
    applyBrainResult(s,copy,{ad_text:'Explore a reading',banner_text:'Love Tarot'});
    const image=JSON.parse(s.db.prepare("SELECT input_json FROM jobs WHERE kind='image_prompt'").get().input_json);
    assert.equal(image.competitorInspiration.observations[0].advertisements[0].use,'inspiration-only');
    assert.equal(s.db.prepare('SELECT count(*) n FROM operations').get().n,0);
  }finally{s.close();}
});
