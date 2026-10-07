import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore,addCandidate,addJob } from './db.js';
import { parsePublicPeer,collectPublicPeer,peerReadiness,enrichPublicPeers,recordBotInterfaceEvidence } from './peer-evidence.js';
import { shortlist } from './discovery.js';
import { createExperiment } from './workflow.js';
import { applyBrainResult } from './brain.js';

const at=new Date().toISOString();
const html=count=>`<div class="tgme_page_title">Tarot Reader</div><div class="tgme_page_extra">@samplebot</div>
  ${count===null?'':`<div class="tgme_page_extra">${count} monthly users</div>`}
  <div class="tgme_page_description">Your tarot reading bot.</div><a>Start Bot</a>`;
function features(value=24000){
  const publicPeer=parsePublicPeer(html(value),'@samplebot',at);
  return {publicPeer,initialReview:{status:'eligible',relevance:'direct',reason:'Direct tarot competitor with measured audience',
    marketEvidence:'English public presentation; language share unknown',peerCheckedAt:at}};
}
function candidate(id=1,value=24000){return {id,surface:'bots',value:'@samplebot',status:'found',score:1,features_json:JSON.stringify(features(value))};}
function fixture(){
  const s=openStore(':memory:');
  s.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context,status,initial_peer_policy)
    VALUES(1,'direct','Direct','tarot-intl@en','https://t.me/examplebot','Global','en','Tarot','ready','competitor-first')`).run();
  return s;
}

test('actual bot language evidence invalidates old reviews and duplicate or older observations cannot mutate it',()=>{
  const s=fixture();try{
    const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'fixture',hypothesis:'direct',features:features()});
    const jid=addJob(s.db,1,'peer_review',{candidateId:id,peer:features().publicPeer});
    const old=s.db.prepare('SELECT * FROM jobs WHERE id=?').get(jid);
    const proof={url:'https://t.me/samplebot',checkedAt:at,method:'support-web-start',status:'observed',
      observedLanguages:['en'],excerpt:'Greetings! Personal Tarot bot.',limitations:'Greeting only. Audience proportions unknown.'};
    const newer=recordBotInterfaceEvidence(s,id,proof);
    assert.equal(recordBotInterfaceEvidence(s,id,proof),null);
    assert.throws(()=>recordBotInterfaceEvidence(s,id,{...proof,url:'https://t.me/wrongbot'}),/identity/);
    assert.throws(()=>recordBotInterfaceEvidence(s,id,{...proof,excerpt:'different'}),/conflicting/);
    assert.throws(()=>recordBotInterfaceEvidence(s,id,{...proof,checkedAt:'2000-01-01'}),/invalid/);
    const result={status:'eligible',relevance:'direct',reason:'Direct English greeting verified',marketEvidence:'English interface only, audience share unknown'};
    assert.throws(()=>applyBrainResult(s,old,result),/stale/);
    const job=s.db.prepare('SELECT * FROM jobs WHERE id=?').get(newer);
    assert.equal(JSON.parse(job.input_json).botInterface.audienceLanguageShare,null);
    applyBrainResult(s,job,result);
    const candidate=s.db.prepare('SELECT * FROM candidates WHERE id=?').get(id);
    assert.equal(peerReadiness(candidate,'competitor-first').ready,true);
    assert.equal(JSON.parse(candidate.features_json).initialReview.interfaceCheckedAt,at);
    const language={status:'available',offeredLanguages:['en','ru'],selectedLanguage:'en',verified:true};
    const next=new Date(Date.parse(at)+1000).toISOString();
    recordBotInterfaceEvidence(s,id,{...proof,checkedAt:next,languageSelection:language});
    const observed=JSON.parse(s.db.prepare('SELECT features_json FROM candidates WHERE id=?').get(id).features_json).botInterface;
    assert.equal(observed.defaultLanguage,null);assert.equal(observed.languageSelection.verified,true);
    assert.throws(()=>recordBotInterfaceEvidence(s,id,{...proof,checkedAt:next,
      languageSelection:{...language,selectedLanguage:'ru'}}),/invalid/);
    assert.equal(peerReadiness({...candidate,features_json:JSON.stringify({...features(),botInterface:observed})},
      'competitor-first',Date.parse(at)+2*86400000).ready,false);
  }finally{s.close();}
});

test('public MAU is measured, hidden MAU stays null, and groups cannot become channels',()=>{
  assert.equal(parsePublicPeer(html('23 788'),'@samplebot',at).audience.value,23788);
  assert.equal(parsePublicPeer(html(null),'@samplebot',at).audience.value,null);
  const group=parsePublicPeer('<div class="tgme_page_extra">60 000 members, 500 online</div>','@samplegroup',at);
  assert.equal(group.kind,'group');assert.equal(group.audience.value,null);
});

test('unknown-size, stale, wrong-peer or newly changed evidence cannot pass discovery gate',()=>{
  for(const change of [f=>f.publicPeer.audience.value=null,f=>f.publicPeer.url='https://t.me/otherbot',
    f=>f.publicPeer.checkedAt='2000-01-01T00:00:00Z',f=>f.initialReview.peerCheckedAt='older',
    f=>f.initialReview.relevance='adjacent',f=>f.initialReview.status='deferred']){
    const f=features();change(f);assert.equal(peerReadiness({...candidate(),features_json:JSON.stringify(f)},'competitor-first').ready,false);
  }
});

test('high model score and diversity cannot displace a verified direct competitor',()=>{
  const weak={...candidate(2),score:100,features_json:'{}'};
  const small=candidate(3,7),large=candidate(4,24000);
  assert.equal(shortlist([weak,small,large],3,{policy:'competitor-first'})[0].id,4);
  assert.equal(peerReadiness(small,'competitor-first').ready,false);
});

test('existing pending draft cannot be recreated without measured peer review',()=>{
  const s=fixture();try{
    const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'test',hypothesis:'direct',score:100});
    const cr=Number(s.db.prepare(`INSERT INTO creatives(project_id,candidate_id,angle,ad_text,status)
      VALUES(1,?,'love','Explore a tarot reading','approved')`).run(id).lastInsertRowid);
    assert.throws(()=>createExperiment(s,{projectId:1,candidateId:id,creativeId:cr,cpm:0.13,placement:'bot_banner'}),/discovery gate/);
    assert.equal(s.db.prepare('SELECT count(*) n FROM experiments').get().n,0);
  }finally{s.close();}
});

test('collector retries transient failure but defers rate limit without expensive repeated requests',async()=>{
  let attempts=0;
  const out=await collectPublicPeer('@samplebot',{wait:async()=>{},fetcher:async()=>{
    if(++attempts===1)throw new Error('network timeout');return {ok:true,text:async()=>html('24 000')};}});
  assert.equal(out.audience.value,24000);assert.equal(attempts,2);
  attempts=0;await assert.rejects(()=>collectPublicPeer('@samplebot',{fetcher:async()=>{
    attempts++;return {ok:false,status:429,headers:{get:()=>600}};}}),e=>e.retryAfter===600);
  assert.equal(attempts,1);
});

test('enrichment persists real evidence and queues one review; repeated cycle does not duplicate it',async()=>{
  const s=fixture();try{
    addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'test',hypothesis:'direct'});
    const options={collect:async()=>parsePublicPeer(html('24 000'),'@samplebot',at)};
    assert.equal(await enrichPublicPeers(s,options),1);
    assert.equal(await enrichPublicPeers(s,options),0);
    const job=s.db.prepare('SELECT * FROM jobs WHERE kind=?').get('peer_review');
    assert.equal(JSON.parse(job.input_json).peer.audience.value,24000);
    assert.equal(s.db.prepare('SELECT count(*) n FROM jobs').get().n,1);
    applyBrainResult(s,job,{status:'eligible',relevance:'direct',reason:'direct reader',marketEvidence:'English public description'});
    assert.equal(s.db.prepare('SELECT count(*) n FROM jobs WHERE kind=?').get('strategy').n,1);
  }finally{s.close();}
});

test('stale model review cannot approve a refreshed peer; missing metrics never become eligible',()=>{
  const s=fixture();try{
    const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'test',hypothesis:'direct',features:features()});
    const jid=addJob(s.db,1,'peer_review',{candidateId:id,peer:{checkedAt:'old'}}),job=s.db.prepare('SELECT * FROM jobs WHERE id=?').get(jid);
    const result={status:'eligible',relevance:'direct',reason:'direct',marketEvidence:'English'};
    assert.throws(()=>applyBrainResult(s,job,result),/stale peer/);
    s.db.prepare('UPDATE candidates SET features_json=? WHERE id=?').run(JSON.stringify(features(null)),id);
    s.db.prepare('UPDATE jobs SET input_json=? WHERE id=?').run(JSON.stringify({candidateId:id,peer:{checkedAt:at}}),jid);
    assert.throws(()=>applyBrainResult(s,s.db.prepare('SELECT * FROM jobs WHERE id=?').get(jid),result),/measurable evidence/);
  }finally{s.close();}
});
