import { addCandidate,addJob,row } from './db.js';
import { shortlist } from './discovery.js';
import { targetFor } from './targets.js';
import { assertCurrentBannerQa } from './banner-state.js';
import { paymentFeedback,paymentFingerprint } from './product.js';
import { peerReadiness } from './peer-evidence.js';
import { queueSourceDiscovery } from './discovery-sources.js';
import { usableInsights } from './learning-context.js';
import { competitorInspiration } from './competitor-observations.js';

export const SCHEMAS={
  peer_review:{type:'object',additionalProperties:false,required:['status','relevance','reason','marketEvidence'],properties:{
    status:{type:'string',enum:['eligible','deferred']},relevance:{type:'string',enum:['direct','adjacent','unrelated','unknown']},
    reason:{type:'string'},marketEvidence:{type:'string'}}},
  market:{type:'object',additionalProperties:false,required:['recommended_market','reasons','alternatives','sources'],properties:{
    recommended_market:{type:'string'},reasons:{type:'array',items:{type:'string'}},alternatives:{type:'array',items:{type:'string'}},
    sources:{type:'array',items:{type:'object',additionalProperties:false,required:['url','claim'],properties:{url:{type:'string'},claim:{type:'string'}}}}
  }},
  research:{type:'object',additionalProperties:false,required:['candidates','assumptions'],properties:{
    candidates:{type:'array',items:{type:'object',additionalProperties:false,required:['surface','value','target_json','hypothesis','source','evidence_urls','score'],properties:{
      surface:{type:'string',enum:['channels','bots','search','users']},value:{type:'string'},target_json:{type:'string'},
      hypothesis:{type:'string'},source:{type:'string'},evidence_urls:{type:'array',items:{type:'string'}},score:{type:'number'}}}},
    assumptions:{type:'array',items:{type:'string'}}
  }},
  strategy:{type:'object',additionalProperties:false,required:['angle','copy_brief','visual_brief','reason'],properties:{
    angle:{type:'string'},copy_brief:{type:'string'},visual_brief:{type:'string'},reason:{type:'string'}}},
  copy:{type:'object',additionalProperties:false,required:['ad_text','banner_text'],properties:{ad_text:{type:'string'},banner_text:{type:'string'}}},
  image_prompt:{type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string'}}},
  image_qa:{type:'object',additionalProperties:false,required:['approved','text_matches','language_matches','issues'],properties:{
    approved:{type:'boolean'},text_matches:{type:'boolean'},language_matches:{type:'boolean'},issues:{type:'array',items:{type:'string'}}}},
  image_revision:{type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string'}}}
};

export function validateBrainResult(kind,value){
  const schema=SCHEMAS[kind];
  if(!schema)throw new Error('unexpected brain job');
  const visit=(rule,item,path,depth)=>{
    if(depth>12)throw new Error(`${path}: output nesting too deep`);
    if(rule.type==='object'){
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`${path}: object required`);
      for(const key of rule.required||[])if(!(key in item))throw new Error(`${path}.${key}: required`);
      for(const [key,child] of Object.entries(item)){
        if(!rule.properties?.[key]){
          if(rule.additionalProperties===false)throw new Error(`${path}.${key}: unexpected field`);
          continue;
        }
        visit(rule.properties[key],child,`${path}.${key}`,depth+1);
      }
    }else if(rule.type==='array'){
      if(!Array.isArray(item)||item.length>100)throw new Error(`${path}: invalid array`);
      for(let i=0;i<item.length;i++)visit(rule.items,item[i],`${path}[${i}]`,depth+1);
    }else if(rule.type==='number'){
      if(typeof item!=='number'||!Number.isFinite(item))throw new Error(`${path}: finite number required`);
    }else if(rule.type==='string'){
      if(typeof item!=='string'||item.length>10000)throw new Error(`${path}: string required`);
    }else if(rule.type==='boolean'&&typeof item!=='boolean')throw new Error(`${path}: boolean required`);
    if(rule.enum&&!rule.enum.includes(item))throw new Error(`${path}: unsupported value`);
  };
  visit(schema,value,kind,0);
  return value;
}

export function queueMarketResearch(store,projectId){
  const p=row(store.db,'projects',projectId);if(!p)throw new Error('project absent');
  return addJob(store.db,p.id,'market',{name:p.name,context:p.context,availableLanguages:['en','es','ru','pt'],
    brief:'Compare viable Telegram Ads markets using current primary evidence, public inventory, product language and payment readiness. Do not infer profitability from religion or language alone.'});
}
export function queueResearch(store,projectId,feedback={}){
  const p=row(store.db,'projects',projectId);if(!p)throw new Error('project absent');
  const insights=usableInsights(store,p);
  const quality=paymentFeedback(store,p.id);
  return addJob(store.db,p.id,'research',{name:p.name,context:p.context,market:p.market,language:p.language,
    brief:p.initial_peer_policy==='competitor-first'?
      'Initial pilot: prioritize active direct tarot/relationship-reading competitors with real public audience counts and evidence of market language fit. First verify large relevant bots/channels. Do not fill a quota with tiny, unknown-size, movie-title or general app-discovery peers. Keep lateral ideas in reserve. A profile language is not proof of audience language share. Cite dated primary sources; do not invent usernames or counts.':
      'Find direct, competitor, persona-adjacent, search and user-filter hypotheses. Cite source URL for each public peer; qualify country. Do not invent Telegram usernames.',
    feedback,paymentQuality:quality,paymentFingerprint:paymentFingerprint(quality),insights,
    competitorInspiration:competitorInspiration(store,p.id)});
}
export function queueStrategy(store,candidateId){
  const c=row(store.db,'candidates',candidateId);if(!c)throw new Error('candidate absent');
  const p=row(store.db,'projects',c.project_id),insights=usableInsights(store,p);
  return addJob(store.db,p.id,'strategy',{candidateId,project:{name:p.name,context:p.context,market:p.market,language:p.language},
    candidate:{surface:c.surface,value:c.value,hypothesis:c.hypothesis,features:JSON.parse(c.features_json)},
    paymentQuality:paymentFeedback(store,p.id),insights,competitorInspiration:competitorInspiration(store,p.id)});
}

export function applyBrainResult(store,job,result,{preparedBanner=null}={}){
  const db=store.db,p=row(db,'projects',job.project_id);
  if(!p||!SCHEMAS[job.kind])throw new Error('unexpected brain job');
  validateBrainResult(job.kind,result);
  if(job.kind==='market'){
    if(!result.recommended_market||!Array.isArray(result.sources))throw new Error('invalid market report');
    // Research is advisory; the project's actual market is chosen separately.
  } else if(job.kind==='research'){
    if(!Array.isArray(result.candidates)||result.candidates.length>100)throw new Error('invalid candidate list');
    for(const c of result.candidates){
      if(!Array.isArray(c.evidence_urls)||!c.hypothesis||!c.source||c.target_json.length>2000)
        throw new Error('candidate missing evidence or target');
      let target;
      try{target=JSON.parse(c.target_json);}catch{throw new Error('candidate target is not JSON');}
      if(!target||typeof target!=='object'||Array.isArray(target))throw new Error('candidate target must be an object');
      if(['channels','bots'].includes(c.surface)&&!c.evidence_urls.some(url=>url.startsWith('https://t.me/')))
        throw new Error('public peer needs a direct Telegram evidence URL');
      for(const url of c.evidence_urls){
        let parsed;try{parsed=new URL(url);}catch{throw new Error('invalid evidence URL');}
        if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||/\s/.test(url))
          throw new Error('invalid evidence URL');
      }
      targetFor({...c,target});
      addCandidate(db,{projectId:p.id,...c,target,
        evidence:c.evidence_urls.map(url=>({type:'research-source',url}))});
    }
    if(p.initial_peer_policy==='competitor-first'){
      for(const c of result.candidates.filter(c=>c.surface==='search'&&c.value.trim().length>=3)
        .sort((a,b)=>b.score-a.score).slice(0,6))queueSourceDiscovery(store,p.id,c.value);
    }
    const candidates=shortlist(db.prepare(`SELECT * FROM candidates WHERE project_id=? AND status='found'`).all(p.id),20,{policy:p.initial_peer_policy});
    for(const c of candidates.filter(c=>peerReadiness(c,p.initial_peer_policy).ready)){
      const queued=db.prepare(`SELECT 1 FROM jobs WHERE project_id=? AND kind='strategy' AND json_extract(input_json,'$.candidateId')=?`).get(p.id,c.id);
      if(!queued)queueStrategy(store,c.id);
    }
  } else if(job.kind==='peer_review'){
    const input=JSON.parse(job.input_json),candidate=row(db,'candidates',input.candidateId);
    if(!candidate||candidate.project_id!==p.id)throw new Error('peer review candidate differs');
    const features=JSON.parse(candidate.features_json);
    if(features.publicPeer?.checkedAt!==input.peer?.checkedAt||
      (features.botInterface?.checkedAt??null)!==(input.botInterface?.checkedAt??null))throw new Error('stale peer review');
    const proposed={...result,peerCheckedAt:input.peer.checkedAt,interfaceCheckedAt:input.botInterface?.checkedAt??null};
    if(!result.reason.trim()||!result.marketEvidence.trim())throw new Error('peer review evidence required');
    features.initialReview=proposed;
    if(result.status==='eligible'&&!peerReadiness({...candidate,features_json:JSON.stringify(features)},'competitor-first').ready)
      throw new Error('eligible peer review lacks direct, current measurable evidence');
    db.prepare('UPDATE candidates SET features_json=? WHERE id=?').run(JSON.stringify(features),candidate.id);
    if(result.status==='eligible'){
      const queued=db.prepare(`SELECT 1 FROM jobs WHERE project_id=? AND kind='strategy' AND json_extract(input_json,'$.candidateId')=?`).get(p.id,candidate.id);
      if(!queued)queueStrategy(store,candidate.id);
    }
  } else if(job.kind==='strategy'){
    const input=JSON.parse(job.input_json);
    if(!result.angle||!result.copy_brief)throw new Error('invalid strategy');
    addJob(db,p.id,'copy',{candidateId:input.candidateId,strategy:result,language:p.language,
      surface:row(db,'candidates',input.candidateId).surface,
      rules:'Telegram ad copy <=160 characters, truthful, no guaranteed fortune or invented product claims.'});
  } else if(job.kind==='copy'){
    const input=JSON.parse(job.input_json),c=row(db,'candidates',input.candidateId);
    if(!c||Array.from(result.ad_text||'').length<1||Array.from(result.ad_text).length>160)throw new Error('invalid ad copy');
    const banner=c.surface==='channels'?result.banner_text:'';
    if(c.surface==='channels'&&!banner)throw new Error('channel banner text missing');
    const id=Number(db.prepare(`INSERT INTO creatives(project_id,candidate_id,angle,ad_text,banner_text,status) VALUES (?,?,?,?,?,?)`).run(
      p.id,c.id,input.strategy.angle,result.ad_text,banner,c.surface==='channels'?'awaiting_prompt':'approved').lastInsertRowid);
    if(c.surface==='channels')addJob(db,p.id,'image_prompt',{creativeId:id,language:p.language,market:p.market,
      angle:input.strategy.angle,visualBrief:input.strategy.visual_brief,
      competitorInspiration:competitorInspiration(store,p.id),
      exactBannerText:banner,rules:'Write prompt in English; exact destination-language banner text in quotes; 16:9; no hardcoded overlay; visually verify spelling.'});
  } else if(job.kind==='image_prompt'||job.kind==='image_revision'){
    const input=JSON.parse(job.input_json),id=input.creativeId;
    if(!row(db,'creatives',id)||!result.prompt||result.prompt.length>6000)throw new Error('invalid image prompt');
    db.prepare(`UPDATE creatives SET image_prompt=?,status='needs_image' WHERE id=?`).run(result.prompt,id);
    db.prepare(`INSERT INTO banner_requests(creative_id,revision,prompt) VALUES (?,?,?)`).run(id,
      db.prepare('SELECT COALESCE(MAX(revision),0)+1 n FROM banner_requests WHERE creative_id=?').get(id).n,result.prompt);
  } else if(job.kind==='image_qa'){
    const input=JSON.parse(job.input_json),creative=row(db,'creatives',input.creativeId);
    if(!creative)throw new Error('creative absent');
    assertCurrentBannerQa(db,input);
    if(result.approved&&result.text_matches&&result.language_matches&&Array.isArray(result.issues)&&!result.issues.length){
      if(!preparedBanner?.path||!preparedBanner?.sha256)throw new Error('approved banner was not prepared');
      db.prepare(`UPDATE creatives SET image_path=?,image_sha256=?,qa_json=?,status='approved' WHERE id=?`).run(
        preparedBanner.path,preparedBanner.sha256,JSON.stringify(result),creative.id);
    } else {
      db.prepare(`UPDATE creatives SET qa_json=?,status='qa_failed' WHERE id=?`).run(JSON.stringify(result),creative.id);
      addJob(db,p.id,'image_revision',{creativeId:creative.id,previousPrompt:creative.image_prompt,
        exactBannerText:creative.banner_text,issues:result.issues||['visual QA uncertain'],
        rule:'Revise English prompt to correct these issues; keep exact destination-language text.'});
    }
  }
  store.audit('brain','job.applied',job.id,{kind:job.kind});
}
