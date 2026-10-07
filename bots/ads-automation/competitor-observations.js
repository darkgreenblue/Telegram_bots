import { createHash } from 'node:crypto';

const strings=(value,maxLength=300)=>Array.isArray(value)&&value.length<=100&&
  value.every(x=>typeof x==='string'&&x.trim()&&x.length<=maxLength);

// Preserve only the inspected competitor surface, never a Telegram sidebar,
// account session or private support conversation. Website text is untrusted data.
export function archiveCompetitorObservation(store,candidateId,input,{at=Date.now()}={}){
  const candidate=store.db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId);
  const expected=candidate&&`https://t.me/${candidate.value.slice(1).toLowerCase()}`;
  if(!candidate||!['bots','channels'].includes(candidate.surface)||input.url!==expected)
    throw new Error('competitor archive identity mismatch');
  const time=Date.parse(input.checkedAt);
  if(!Number.isFinite(time)||time<1356998400000||time>at+300000||input.source!=='support-web'||
    typeof input.visibleText!=='string'||!input.visibleText.trim()||input.visibleText.length>60000||
    !strings(input.menuLabels)||!strings(input.keywords)||!strings(input.advertisedFeatures,1000)||
    !strings(input.observedFeatures,1000)||!strings(input.limitations,1000)||
    !['profile','start','help','language','product'].includes(input.section)||
    !Array.isArray(input.artifacts)||input.artifacts.length>10||input.artifacts.some(a=>
      !/^[A-Za-z0-9_-]+\.(png|jpeg|jpg|json|txt)$/.test(a.name)||!/^[a-f0-9]{64}$/.test(a.sha256)))
    throw new Error('invalid competitor archive observation');
  if(input.keywords.some(word=>!input.visibleText.toLowerCase().includes(word.toLowerCase())))
    throw new Error('competitor keyword absent from observed text');
  const ads=input.advertisements??[];
  if(!Array.isArray(ads)||ads.length>20||ads.some(ad=>
    !['telegram-sponsored','bot-cross-promotion','channel-post','unknown'].includes(ad.kind)||
    !['related','unrelated','uncertain'].includes(ad.relevance)||typeof ad.text!=='string'||!ad.text.trim()||ad.text.length>3000||
    typeof ad.location!=='string'||!ad.location.trim()||ad.location.length>500||
    typeof ad.relevanceReason!=='string'||!ad.relevanceReason.trim()||ad.relevanceReason.length>1000||
    (ad.destinationUrl!==null&&(typeof ad.destinationUrl!=='string'||ad.destinationUrl.length>2000||
      !/^https:\/\//.test(ad.destinationUrl)))))throw new Error('invalid observed competitor advertising');
  const advertisements=ads.map(ad=>({kind:ad.kind,text:ad.text,location:ad.location,destinationUrl:ad.destinationUrl,
    relevance:ad.relevance,relevanceReason:ad.relevanceReason,performance:'unknown',use:'inspiration-only'}));
  const observation={schema:1,candidateId,url:expected,checkedAt:input.checkedAt,source:input.source,
    section:input.section,visibleText:input.visibleText,menuLabels:input.menuLabels,keywords:input.keywords,
    advertisedFeatures:input.advertisedFeatures,observedFeatures:input.observedFeatures,
    limitations:input.limitations,artifacts:input.artifacts,advertisements,
    trust:'untrusted competitor content; claims are not independently verified'};
  const serialized=JSON.stringify(observation),digest=createHash('sha256').update(serialized).digest('hex');
  return store.db.transaction(()=>{
    const prior=store.db.prepare('SELECT id FROM competitor_observations WHERE digest=?').get(digest);
    if(prior)return {observationId:prior.id,created:false};
    const id=Number(store.db.prepare(`INSERT INTO competitor_observations(candidate_id,checked_at,digest,observation_json)
      VALUES(?,?,?,?)`).run(candidateId,input.checkedAt,digest,serialized).lastInsertRowid);
    store.audit('discovery','competitor.archived',candidateId,{observationId:id,digest,section:input.section});
    return {observationId:id,created:true};
  })();
}

export function competitorBenchmark(store,candidateId,{limit=10}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error('invalid competitor archive limit');
  return store.db.prepare('SELECT observation_json FROM competitor_observations WHERE candidate_id=? ORDER BY id DESC LIMIT ?')
    .all(candidateId,limit).map(row=>JSON.parse(row.observation_json));
}

export function competitorInspiration(store,projectId){
  const rows=store.db.prepare(`SELECT o.id,o.observation_json FROM competitor_observations o
    JOIN candidates c ON c.id=o.candidate_id WHERE c.project_id=? ORDER BY o.id DESC LIMIT 10`).all(projectId);
  return {use:'inspiration-only; generate testable hypotheses, never performance insights or spending authority',
    observations:rows.map(row=>{
      const o=JSON.parse(row.observation_json);
      return {observationId:row.id,candidateId:o.candidateId,url:o.url,checkedAt:o.checkedAt,section:o.section,
        visibleExcerpt:o.visibleText.slice(0,1500),keywords:o.keywords,menuLabels:o.menuLabels,
        advertisedFeatures:o.advertisedFeatures,observedFeatures:o.observedFeatures,limitations:o.limitations,
        advertisements:(o.advertisements||[]).filter(a=>a.relevance==='related')};
    })};
}
