import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { addJob,row } from './db.js';
import { usableInsights } from './learning-context.js';

export const INTELLIGENCE_DOMAINS=['language-market','audience','onboarding','positioning','features','pricing',
  'subscription','affiliate','monetization','growth','advertising','creative','market-sizing','opportunity'];
const purposes=['creative','copywriting','market-selection','product-strategy','pricing','monetization',
  'market-sizing','competitor-revenue','business-opportunity','experiment'];
const text=(v,n=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const list=(v,n=1000)=>Array.isArray(v)&&v.length<=100&&v.every(x=>text(x,n));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date=(value,at)=>Number.isFinite(Date.parse(value))&&Date.parse(value)>=1356998400000&&Date.parse(value)<=at+300000;
const object=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));

// This validates public-source coordinates, not permission to fetch an arbitrary
// URL. Acquisition adapters retain their own network/public-read restrictions.
export function publicIntelligenceUrl(value){
  let u;try{u=new URL(value);}catch{throw new Error('invalid public intelligence URL');}
  if(!text(value)||u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname)||
    !u.hostname.includes('.')||/(^|\.)(localhost|local|internal|invalid|test)$/.test(u.hostname)||
    (u.hostname==='t.me'&&/^\/(\+|joinchat\/|c\/)/.test(u.pathname)))throw new Error('non-public intelligence URL');
  return value;
}

function saveImmutable(store,table,projectId,value){
  const hash=digest({projectId,value}),column=table==='intelligence_evidence'?'evidence_json':'estimate_json';
  const old=store.db.prepare(`SELECT id FROM ${table} WHERE digest=?`).get(hash);
  if(old)return {id:old.id,created:false};
  const id=Number(store.db.prepare(`INSERT INTO ${table}(project_id,digest,${column}) VALUES(?,?,?)`)
    .run(projectId,hash,JSON.stringify(value)).lastInsertRowid);
  store.audit('intelligence',table==='intelligence_evidence'?'evidence.archived':'estimate.created',id,{projectId,digest:hash});
  return {id,created:true};
}

export function intelligenceEvidence(store,projectId,{limit=40}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('invalid intelligence limit');
  const structured=store.db.prepare('SELECT id,evidence_json FROM intelligence_evidence WHERE project_id=? ORDER BY id DESC LIMIT ?')
    .all(projectId,limit).map(r=>({ref:`evidence:${r.id}`,...JSON.parse(r.evidence_json)}));
  // Historical archives are immutable: wrap them, do not relabel their content
  // as verified product behavior, default language or a monthly audience count.
  const legacy=store.db.prepare(`SELECT o.id,o.observation_json,c.value FROM competitor_observations o
    JOIN candidates c ON c.id=o.candidate_id WHERE c.project_id=? ORDER BY o.id DESC LIMIT ?`).all(projectId,limit)
    .map(r=>{const o=JSON.parse(r.observation_json);return {ref:`observation:${r.id}`,classification:'observed_fact',
      entityUrl:o.url,sourceUrl:o.url,hostUrl:o.url,checkedAt:o.checkedAt,source:o.source,language:null,
      context:o.section,visibleText:o.visibleText,facts:[],artifacts:o.artifacts,limitations:o.limitations,
      legacy:o,interpretation:'Fact of displayed text only; competitor claims are not verified outcomes.'};});
  return [...structured,...legacy].sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt)).slice(0,limit);
}

function evidenceByRef(store,projectId,ref){
  const match=/^(evidence|observation):([1-9]\d*)$/.exec(ref??'');
  if(!match)throw new Error('invalid intelligence evidence reference');
  let found;
  if(match[1]==='evidence')found=store.db.prepare('SELECT evidence_json json FROM intelligence_evidence WHERE project_id=? AND id=?')
    .get(projectId,Number(match[2]));
  else found=store.db.prepare(`SELECT o.observation_json json FROM competitor_observations o JOIN candidates c ON c.id=o.candidate_id
    WHERE c.project_id=? AND o.id=?`).get(projectId,Number(match[2]));
  if(!found)throw new Error('intelligence evidence absent or belongs to another project');
  return JSON.parse(found.json);
}

export function archiveIntelligenceEvidence(store,projectId,input,{at=Date.now()}={}){
  if(!row(store.db,'projects',projectId))throw new Error('project absent');
  if(!object(input,['entityUrl','hostUrl','sourceUrl','destinationUrl','checkedAt','source','language','context','visibleText',
    'facts','artifacts','limitations','parentRef'])||!date(input.checkedAt,at)||
    !['support-web','public-web','public-api'].includes(input.source)||!text(input.context)||!text(input.visibleText,60000)||
    !list(input.limitations)||!Array.isArray(input.artifacts)||input.artifacts.length>10||
    input.artifacts.some(a=>!object(a,['name','sha256'])||!/^[A-Za-z0-9_-]+\.(png|jpeg|jpg|json|txt)$/.test(a.name)||!/^[a-f0-9]{64}$/.test(a.sha256))||
    !(input.language===null||/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.language))||
    !Array.isArray(input.facts)||input.facts.length>100)throw new Error('invalid intelligence evidence');
  for(const url of [input.entityUrl,input.hostUrl,input.sourceUrl])publicIntelligenceUrl(url);
  if(input.destinationUrl!==null)publicIntelligenceUrl(input.destinationUrl);
  if(input.parentRef!==null)evidenceByRef(store,projectId,input.parentRef);
  if(!input.artifacts.length&&!input.limitations.length)throw new Error('missing artifact needs a limitation');
  for(const fact of input.facts){
    if(!object(fact,['domain','kind','quote','label','metric'])||!INTELLIGENCE_DOMAINS.includes(fact.domain)||
      !['visible-text','measured','competitor-claim'].includes(fact.kind)||!text(fact.label,500)||!text(fact.quote,3000)||
      !input.visibleText.includes(fact.quote))throw new Error('intelligence fact needs exact public quote and domain');
    if(fact.metric!==null){
      const m=fact.metric;
      if(!object(m,['value','unit','definition','population','period','asOf'])||
        !(m.value===null||(typeof m.value==='number'&&Number.isFinite(m.value)&&m.value>=0))||
        !text(m.unit,100)||!text(m.definition)||!text(m.population)||!text(m.period,500)||!date(m.asOf,at))
        throw new Error('invalid metric definition');
    }
  }
  return store.db.transaction(()=>{
    const saved=saveImmutable(store,'intelligence_evidence',projectId,{schema:1,classification:'observed_fact',...input,
      trust:'Untrusted public evidence. A competitor claim proves only that the claim was displayed.'});
    if(saved.created)queueIntelligenceResearch(store,projectId);
    return {...saved,ref:`evidence:${saved.id}`};
  })();
}

// Only bounded, reproducible scenario arithmetic is allowed. No model-generated
// executable formula, currency conversion, MAU=DAU, or gross revenue=profit.
export function calculateIntelligenceEstimate(store,projectId,input,{allowedRefs=null,at=Date.now()}={}){
  if(!object(input,['entityUrl','title','formula','unit','period','asOf','inputs','assumptions','caveats','confidence'])||
    !text(input.title)||input.formula!=='population * participation * spend_per_participant_period'||
    !text(input.unit,100)||!text(input.period,500)||!date(input.asOf,at)||
    !list(input.assumptions)||!input.assumptions.length||!list(input.caveats)||!input.caveats.length||
    !['low','medium'].includes(input.confidence)||!Array.isArray(input.inputs)||input.inputs.length!==3)
    throw new Error('invalid intelligence estimate');
  publicIntelligenceUrl(input.entityUrl);
  const keys=['population','participation','spend_per_participant_period'];
  for(let i=0;i<3;i++){
    const x=input.inputs[i];
    if(!object(x,['key','low','high','unit','definition','population','period','basis','evidenceRef','factIndex'])||x.key!==keys[i]||
      !Number.isFinite(x.low)||!Number.isFinite(x.high)||x.low<0||x.high<x.low||
      !text(x.definition)||!text(x.population)||!text(x.period)||!text(x.unit,100)||
      !['evidence','assumption'].includes(x.basis))throw new Error('invalid estimate input');
    if(x.basis==='evidence'){
      if(allowedRefs&&!allowedRefs.has(x.evidenceRef))throw new Error('estimate reference outside research snapshot');
      const e=evidenceByRef(store,projectId,x.evidenceRef),m=e.facts?.[x.factIndex]?.metric;
      if(e.entityUrl!==input.entityUrl||!m||m.value===null||x.low!==m.value||x.high!==m.value||
        x.definition!==m.definition||x.unit!==m.unit||x.population!==m.population||x.period!==m.period)
        throw new Error('estimate input differs from observed metric');
    }else if(x.evidenceRef!==null||x.factIndex!==null)throw new Error('assumption cannot impersonate evidence');
  }
  const sources=input.inputs.filter(x=>x.basis==='evidence').map(x=>{const e=evidenceByRef(store,projectId,x.evidenceRef);
    return {ref:x.evidenceRef,checkedAt:e.checkedAt,sourceUrl:e.sourceUrl,kind:e.facts[x.factIndex].kind,quote:e.facts[x.factIndex].quote};});
  const [n,p,s]=input.inputs;
  if(n.unit!=='users'||p.unit!=='fraction'||p.high>1||s.unit!==input.unit||
    n.population!==p.population||p.population!==s.population||p.period!==input.period||s.period!==input.period)
    throw new Error('estimate units, population or period mismatch');
  if(!input.inputs.some(x=>x.basis==='evidence'))throw new Error('estimate needs at least one evidenced input');
  const low=n.low*p.low*s.low,high=n.high*p.high*s.high;
  if(!Number.isFinite(low)||!Number.isFinite(high))throw new Error('estimate overflow');
  return {schema:1,classification:'estimate',nature:'scenario',...input,sources,result:{low,high,unit:input.unit,period:input.period},
    confidence:'low',modelConfidence:input.confidence,
    interpretation:'Conditional gross spend scenario; not verified revenue, market size, profit or payout.'};
}

export function archiveIntelligenceEstimate(store,projectId,input,options){
  const value=calculateIntelligenceEstimate(store,projectId,input,options);
  return store.db.transaction(()=>saveImmutable(store,'intelligence_estimates',projectId,value))();
}

export function intelligenceContext(store,projectId,{runtime}={}){
  const p=row(store.db,'projects',projectId);if(!p)throw new Error('project absent');
  return {schema:1,pipeline:'Competitor Evidence -> Market Intelligence -> Business Insight -> Hypothesis -> Test with our own data',
    policy:'Observed facts, conditional estimates and own-data validated insights are separate. No financial or product-change authority.',
    evidence:intelligenceEvidence(store,projectId).map(e=>({...e,visibleText:e.visibleText.slice(0,6000),
      ...(e.legacy?{legacy:{...e.legacy,visibleText:e.legacy.visibleText.slice(0,6000)}}:{})})),
    estimates:store.db.prepare('SELECT id,estimate_json FROM intelligence_estimates WHERE project_id=? ORDER BY id DESC LIMIT 20')
      .all(projectId).map(r=>({id:r.id,...JSON.parse(r.estimate_json)})),
    reports:store.db.prepare('SELECT id,report_json FROM intelligence_reports WHERE project_id=? ORDER BY id DESC LIMIT 5')
      .all(projectId).map(r=>({id:r.id,...JSON.parse(r.report_json)})),
    validatedInsights:usableInsights(store,p,runtime?{runtime}:{})};
}

export function queueIntelligenceResearch(store,projectId){
  const p=row(store.db,'projects',projectId),context=intelligenceContext(store,projectId);
  if(!context.evidence.length)return null;
  // Evidence-specific identity allows re-analysis after new observations, but
  // provider failures/replays cannot enqueue an identical snapshot again.
  const snapshot=context.evidence.map(e=>e.ref),snapshotDigest=digest({snapshot,market:p.market,language:p.language,context:p.context});
  const prior=store.db.prepare(`SELECT id FROM jobs WHERE project_id=? AND kind='competitive_intelligence'
    AND json_extract(input_json,'$.snapshotDigest')=?`).get(projectId,snapshotDigest);
  if(prior)return prior.id;
  const active=store.db.prepare("SELECT id FROM jobs WHERE project_id=? AND kind='competitive_intelligence' AND status IN ('queued','leased') ORDER BY id DESC LIMIT 1").get(projectId);
  if(active)return active.id;
  return addJob(store.db,projectId,'competitive_intelligence',{schema:1,project:{name:p.name,context:p.context,
    market:p.market,language:p.language},snapshotDigest,intelligence:context,
    coverageRequired:INTELLIGENCE_DOMAINS,purposes,limits:'Public only; no payment, human messaging, private data or binding terms. Unknowns stay unknown.'});
}

export function applyIntelligenceResearch(store,job,result){
  const input=JSON.parse(job.input_json),snapshot=input.intelligence?.evidence;
  if(!snapshot||input.schema!==1)throw new Error('intelligence job snapshot missing');
  const refs=new Set(snapshot.map(e=>e.ref));
  if(result.findings.length>20||result.estimates.length>10)throw new Error('intelligence report exceeds bound');
  if(result.coverage.length!==INTELLIGENCE_DOMAINS.length||new Set(result.coverage.map(c=>c.domain)).size!==INTELLIGENCE_DOMAINS.length||
    result.coverage.some(c=>!INTELLIGENCE_DOMAINS.includes(c.domain)||!text(c.limitations)))
    throw new Error('intelligence report needs every domain, including unknowns');
  const findings=result.findings.map(f=>{
    if(!INTELLIGENCE_DOMAINS.includes(f.domain)||!purposes.includes(f.purpose)||!text(f.claim)||!text(f.hypothesis)||!text(f.ownDataTest)||!f.caveats.length||!f.evidence.length||
      !text(f.scope.market)||!text(f.scope.language)||!text(f.scope.productVersion))throw new Error('intelligence finding needs scope, caveats and own-data test');
    const quotedEvidence=f.evidence.map(proof=>{
      const e=snapshot.find(e=>e.ref===proof.ref);
      const surfaces=e?[{field:'visibleText',text:e.visibleText},...(e.legacy?.advertisements??[]).flatMap((a,i)=>[
        {field:`legacy.advertisements[${i}].text`,text:a.text},{field:`legacy.advertisements[${i}].location`,text:a.location}])]:[];
      const match=surfaces.find(source=>text(proof.quote,3000)&&source.text.includes(proof.quote));
      if(!match)throw new Error('finding reference or quote outside snapshot');
      evidenceByRef(store,job.project_id,proof.ref);
      return {...proof,quoteField:match.field};
    });
    return {...f,evidence:quotedEvidence,classification:'estimate',nature:'qualitative-inference',status:'hypothesis',validatedBy:[],
      confidence:'low',interpretation:'Analytical business inference, not validated performance.'};
  });
  const estimates=result.estimates.map(e=>calculateIntelligenceEstimate(store,job.project_id,e,{allowedRefs:refs}));
  return store.db.transaction(()=>{
    const prior=store.db.prepare('SELECT id FROM intelligence_reports WHERE job_id=?').get(job.id);
    if(prior)return prior.id;
    for(const f of findings){
      store.db.prepare('INSERT OR IGNORE INTO hypotheses(project_id,claim) VALUES(?,?)').run(job.project_id,f.hypothesis.trim());
      f.hypothesisId=store.db.prepare('SELECT id FROM hypotheses WHERE project_id=? AND claim=?').get(job.project_id,f.hypothesis.trim()).id;
    }
    const report={schema:1,classification:'estimate',snapshotDigest:input.snapshotDigest,coverage:result.coverage,findings,
      estimateIds:estimates.map(e=>saveImmutable(store,'intelligence_estimates',job.project_id,e).id),
      authority:'advisory only; validation requires scoped own-data experiments'};
    const id=Number(store.db.prepare('INSERT INTO intelligence_reports(project_id,job_id,report_json) VALUES(?,?,?)')
      .run(job.project_id,job.id,JSON.stringify(report)).lastInsertRowid);
    store.audit('intelligence','research.applied',id,{jobId:job.id,projectId:job.project_id,snapshotDigest:input.snapshotDigest});
    queueIntelligenceResearch(store,job.project_id);
    return id;
  })();
}

export function intelligenceRows(store,projectId){
  const evidence=intelligenceEvidence(store,projectId,{limit:100});
  return {evidence,estimates:store.db.prepare('SELECT id,estimate_json FROM intelligence_estimates WHERE project_id=? ORDER BY id').all(projectId)
    .map(r=>({id:r.id,...JSON.parse(r.estimate_json)})),
    reports:store.db.prepare('SELECT id,report_json FROM intelligence_reports WHERE project_id=? ORDER BY id').all(projectId)
      .map(r=>({id:r.id,...JSON.parse(r.report_json)}))};
}

export function intelligenceArchive(store,projectId,{kind='evidence',beforeId=null,limit=50}={}){
  const table={evidence:['intelligence_evidence','evidence_json'],estimates:['intelligence_estimates','estimate_json'],
    reports:['intelligence_reports','report_json']}[kind];
  if(!table||!Number.isSafeInteger(limit)||limit<1||limit>100||
    (beforeId!==null&&(!Number.isSafeInteger(beforeId)||beforeId<1)))throw new Error('invalid intelligence archive cursor');
  const entries=store.db.prepare(`SELECT id,${table[1]} json FROM ${table[0]} WHERE project_id=?
    ${beforeId===null?'':'AND id<?'} ORDER BY id DESC LIMIT ?`).all(...[projectId,...(beforeId===null?[]:[beforeId]),limit])
    .map(r=>({id:r.id,...JSON.parse(r.json)}));
  return {kind,entries,nextBeforeId:entries.length===limit?entries.at(-1).id:null};
}
