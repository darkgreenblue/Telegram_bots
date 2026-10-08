import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore,addCandidate,leaseJob} from './db.js';
import {archiveCompetitorObservation} from './competitor-observations.js';
import {archiveIntelligenceEvidence,archiveIntelligenceEstimate,calculateIntelligenceEstimate,
  intelligenceContext,intelligenceArchive,queueIntelligenceResearch,INTELLIGENCE_DOMAINS} from './intelligence.js';
import {SCHEMAS,validateBrainResult,queueStrategy,queueMarketResearch} from './brain.js';
import {archivePublicPeerIntelligence} from './intelligence-collection.js';
import {submitBrainJob} from './brain-submit.js';
function fixture(){const s=openStore(':memory:');s.db.exec(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
 VALUES(1,'test','test','test','https://t.me/samplebot','Global','en','test'),(2,'other','other','other','https://t.me/otherbot','Global','en','other')`);return s;}
const evidence=()=>({entityUrl:'https://t.me/samplebot',hostUrl:'https://t.me/hostbot',sourceUrl:'https://example.com/pricing',destinationUrl:'https://t.me/samplebot',
 checkedAt:new Date().toISOString(),source:'public-web',language:'en',context:'Public affiliate page',
 visibleText:'10000 monthly users. Members spend 5 Stars per active day, according to our affiliate program.',
 facts:[{domain:'audience',kind:'measured',label:'Public monthly count',quote:'10000 monthly users',metric:{value:10000,unit:'users',
 definition:'Monthly unique users shown publicly',population:'Monthly user cohort',period:'last 30 days',asOf:new Date().toISOString()}},
 {domain:'affiliate',kind:'competitor-claim',label:'Spend claim',quote:'Members spend 5 Stars per active day',metric:{value:5,unit:'star',
 definition:'Claimed average per active user per day',population:'Daily active user cohort',period:'day',asOf:new Date().toISOString()}}],
 artifacts:[{name:'affiliate.png',sha256:'a'.repeat(64)}],limitations:['Self-reported spending is not independently verified'],parentRef:null});
function estimate(e,ref){const n=e.facts[0].metric;return {entityUrl:e.entityUrl,title:'Conditional daily Stars spend',
 formula:'population * participation * spend_per_participant_period',unit:'star',period:'day',asOf:e.checkedAt,
 inputs:[{key:'population',low:10000,high:10000,unit:n.unit,definition:n.definition,population:n.population,period:n.period,basis:'evidence',evidenceRef:ref,factIndex:0},
 {key:'participation',low:0.01,high:0.1,unit:'fraction',definition:'Assumed daily active paying fraction of the monthly cohort',population:n.population,period:'day',basis:'assumption',evidenceRef:null,factIndex:null},
 {key:'spend_per_participant_period',low:1,high:5,unit:'star',definition:'Scenario spend per active paying monthly-cohort member',population:n.population,period:'day',basis:'assumption',evidenceRef:null,factIndex:null}],
 assumptions:['Activity/payment fraction and spend are assumptions; MAU is not DAU'],caveats:['Self-reported affiliate claim; Stars gross spend is not profit or payout'],confidence:'medium'};}
const report=ref=>({coverage:INTELLIGENCE_DOMAINS.map(domain=>({domain,status:domain==='audience'?'observed':'not-inspected',limitations:'Only supplied public evidence was inspected'})),
 findings:[{domain:'monetization',purpose:'pricing',claim:'A payment test may help compare demand',scope:{market:'Global',language:'en',productVersion:'unknown'},
 evidence:[{ref,quote:'10000 monthly users'}],caveats:['No evidence of successful conversion'],hypothesis:'A low entry price increases paid conversion',ownDataTest:'Run a scoped pricing experiment with our own mature payment cohorts'}],estimates:[]});

test('deep public evidence is immutable, quote-bound, traceable across hosts, and queued once',()=>{const s=fixture();try{
 const e=evidence(),first=archiveIntelligenceEvidence(s,1,e);assert.equal(first.created,true);assert.equal(archiveIntelligenceEvidence(s,1,e).created,false);
 archiveIntelligenceEvidence(s,1,{...e,context:'Later public inspection'});assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='competitive_intelligence'").get().n,1);
 const c=intelligenceContext(s,1);assert.equal(c.evidence.length,2);assert.equal(c.evidence[0].classification,'observed_fact');
 assert.equal(c.evidence[0].facts[1].kind,'competitor-claim');assert.equal(c.evidence[0].hostUrl,e.hostUrl);
 assert.throws(()=>s.db.exec('DELETE FROM intelligence_evidence'),/immutable/);
 assert.throws(()=>archiveIntelligenceEvidence(s,1,{...e,facts:[{...e.facts[0],quote:'invented claim'}]}),/quote/);
 for(const url of ['https://localhost/path','https://127.0.0.1/path','https://t.me/+private','https://user:pw@example.com/path'])assert.throws(()=>archiveIntelligenceEvidence(s,1,{...e,sourceUrl:url}),/URL/);
 assert.throws(()=>archiveIntelligenceEvidence(s,2,{...e,parentRef:first.ref}),/another project/);
 const independent=archiveIntelligenceEvidence(s,2,e);assert.notEqual(independent.ref,first.ref);
 assert.equal(intelligenceContext(s,2).evidence[0].ref,independent.ref);assert.equal(s.db.prepare('SELECT count(*) n FROM operations').get().n,0);
 }finally{s.close();}});

test('revenue scenarios retain formula, definitions, assumptions, unit and source without manufacturing certainty',()=>{const s=fixture();try{
 const e=evidence(),ref=archiveIntelligenceEvidence(s,1,e).ref,x=estimate(e,ref),value=calculateIntelligenceEstimate(s,1,x);
 assert.deepEqual(value.result,{low:100,high:5000,unit:'star',period:'day'});assert.equal(value.classification,'estimate');assert.equal(value.confidence,'low');assert.equal(value.sources[0].checkedAt,e.checkedAt);
 assert.match(value.interpretation,/not verified revenue/);const id=archiveIntelligenceEstimate(s,1,x).id;assert.equal(archiveIntelligenceEstimate(s,1,x).id,id);
 assert.throws(()=>s.db.exec("UPDATE intelligence_estimates SET estimate_json='{}'"),/immutable/);
 const mutate=f=>{const copy=structuredClone(x);f(copy);assert.throws(()=>calculateIntelligenceEstimate(s,1,copy));};
 mutate(c=>c.inputs[0].high=999999);mutate(c=>c.inputs[0].definition='DAU');mutate(c=>c.inputs[1].high=2);mutate(c=>c.inputs[2].unit='TON');
 mutate(c=>c.inputs[2].population='Daily active cohort');mutate(c=>c.inputs[2].period='month');mutate(c=>c.formula='eval(process.env)');mutate(c=>c.assumptions=[]);mutate(c=>c.confidence='validated');
 mutate(c=>c.inputs[2]={...c.inputs[2],basis:'evidence',evidenceRef:ref,factIndex:1,low:5,high:5,definition:e.facts[1].metric.definition,population:e.facts[1].metric.population});
 assert.throws(()=>calculateIntelligenceEstimate(s,2,x),/another project/);
 }finally{s.close();}});

test('structured research rejects invented evidence and model validation, persists hypotheses and processes newer snapshots',async()=>{const s=fixture();try{
 const e=evidence(),ref=archiveIntelligenceEvidence(s,1,e).ref,leased=leaseJob(s.db,'fixture'),result=report(ref);
 assert.equal(leased.kind,'competitive_intelligence');validateBrainResult(leased.kind,result);assert.throws(()=>validateBrainResult(leased.kind,{...result,status:'validated'}),/unexpected field/);
 const bad=structuredClone(result);bad.findings[0].evidence[0].ref='evidence:999';await assert.rejects(submitBrainJob(s,{id:leased.id,owner:'fixture',result:bad}),/outside snapshot/);
 assert.equal(s.db.prepare('SELECT status FROM jobs WHERE id=?').get(leased.id).status,'leased');
 const quote=structuredClone(result);quote.findings[0].evidence[0].quote='invented quote';await assert.rejects(submitBrainJob(s,{id:leased.id,owner:'fixture',result:quote}),/outside snapshot/);
 archiveIntelligenceEvidence(s,1,{...e,visibleText:e.visibleText+' New menu.',context:'New menu'});
 await submitBrainJob(s,{id:leased.id,owner:'fixture',result});await submitBrainJob(s,{id:leased.id,owner:'fixture',result});
 assert.equal(s.db.prepare('SELECT count(*) n FROM intelligence_reports').get().n,1);
 assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='research'").get().n,1);
 const research=JSON.parse(s.db.prepare("SELECT input_json FROM jobs WHERE kind='research'").get().input_json);
 assert.equal(research.intelligence.reports[0].findings[0].status,'hypothesis');
 const stored=intelligenceContext(s,1).reports[0].findings[0];assert.equal(stored.classification,'estimate');assert.equal(stored.status,'hypothesis');assert.ok(stored.hypothesisId);
 assert.deepEqual(intelligenceContext(s,1).validatedInsights,[]);assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='competitive_intelligence'").get().n,2);
 assert.throws(()=>s.db.exec('DELETE FROM intelligence_reports'),/immutable/);assert.equal(s.db.prepare('SELECT count(*) n FROM insights').get().n,0);
 }finally{s.close();}});

test('legacy archives remain readable and seed market and strategy intelligence without relabeling historical jobs',()=>{const s=fixture();try{
 const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'fixture',hypothesis:'direct'});
 archiveCompetitorObservation(s,id,{url:'https://t.me/samplebot',checkedAt:new Date().toISOString(),source:'support-web',section:'start',visibleText:'Tarot in English',
 menuLabels:[],keywords:['Tarot'],advertisedFeatures:[],observedFeatures:[],limitations:['Pricing uninspected'],artifacts:[]});
 for(const jobId of [queueStrategy(s,id),queueMarketResearch(s,1)]){const input=JSON.parse(s.db.prepare('SELECT input_json FROM jobs WHERE id=?').get(jobId).input_json);
 assert.equal(input.intelligence.evidence[0].ref,'observation:1');assert.equal(input.intelligence.evidence[0].language,null);assert.equal(input.intelligence.evidence[0].facts.length,0);}
 assert.ok(queueIntelligenceResearch(s,1));assert.ok(SCHEMAS.competitive_intelligence);
 }finally{s.close();}});

test('public collector archives original audience labels and links sampled posts without fabricated MAU or duplicate analysis',()=>{const s=fixture();try{
 const proof={kind:'bots',url:'https://t.me/samplebot',checkedAt:new Date().toISOString(),title:'Tarot',description:'Read your cards',
 audience:{unit:'monthly_users',value:24000,raw:'24 000 monthly users'},sampledPosts:[]};
 const first=archivePublicPeerIntelligence(s,1,proof);archivePublicPeerIntelligence(s,1,proof);
 let facts=intelligenceContext(s,1).evidence[0].facts;assert.equal(facts[1].metric.value,24000);assert.match(facts[1].metric.period,/unknown/);
 assert.equal(facts[0].kind,'competitor-claim');
 archivePublicPeerIntelligence(s,1,{...proof,audience:{unit:'monthly_users',value:999999,raw:'bot'},description:'No count shown'});
 facts=intelligenceContext(s,1).evidence[0].facts;assert.equal(facts.length,1);
 const page=intelligenceArchive(s,1,{limit:1});assert.equal(page.entries.length,1);assert.ok(page.nextBeforeId);
 assert.equal(intelligenceArchive(s,1,{limit:1,beforeId:page.nextBeforeId}).entries[0].id,first.id);
 assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='competitive_intelligence'").get().n,1);
 }finally{s.close();}});

test('observed advertisement placement notes retain their exact quote field and cannot masquerade as public ad copy',async()=>{const s=fixture();try{
 const id=addCandidate(s.db,{projectId:1,surface:'bots',value:'@samplebot',source:'fixture',hypothesis:'direct'});
 archiveCompetitorObservation(s,id,{url:'https://t.me/samplebot',checkedAt:new Date().toISOString(),source:'support-web',section:'profile',visibleText:'10000 monthly users',
 menuLabels:[],keywords:[],advertisedFeatures:[],observedFeatures:[],limitations:['No performance data'],artifacts:[],advertisements:[{kind:'telegram-sponsored',text:'Tarot reading',
 location:'Ad-labelled banner above messages; click opened another public bot',destinationUrl:'https://t.me/otherbot',relevance:'related',relevanceReason:'Tarot mentioned'}]});
 const job=leaseJob(s.db,'fixture'),result=report('observation:1');result.findings[0].evidence[0].quote='Ad-labelled banner above messages; click opened another public bot';
 await submitBrainJob(s,{id:job.id,owner:'fixture',result});
 assert.equal(intelligenceContext(s,1).reports[0].findings[0].evidence[0].quoteField,'legacy.advertisements[0].location');
 }finally{s.close();}});
