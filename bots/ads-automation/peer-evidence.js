import { archivePublicPeerIntelligence } from './intelligence-collection.js';
import { htmlToText,parseCount,collectChannel } from '../../tools/benchmark/tme.mjs';
import { addJob } from './db.js';
import { channelFeatures } from './channel-evidence.js';

const username=value=>{
  if(!/^@[A-Za-z0-9_]{5,32}$/.test(value))throw new Error('public Telegram username required');
  return value.slice(1).toLowerCase();
};
const blocks=(html,name)=>Array.from(html.matchAll(new RegExp(`<div\\b[^>]*class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,'gi')),m=>htmlToText(m[1]));

export function parsePublicPeer(html,value,at=new Date().toISOString()){
  const name=username(value),extra=blocks(html,'tgme_page_extra');
  const monthly=extra.find(t=>/monthly users/i.test(t));
  const channel=extra.find(t=>/subscribers/i.test(t));
  const group=extra.find(t=>/members/i.test(t));
  const isBot=!!monthly||/>\s*Start Bot\s*</i.test(html);
  const kind=isBot?'bots':channel?'channels':group?'group':'unknown';
  const raw=monthly||channel;
  return {version:1,url:`https://t.me/${name}`,checkedAt:at,kind,
    title:blocks(html,'tgme_page_title')[0]??null,
    description:blocks(html,'tgme_page_description')[0]??null,
    publicLinks:[...new Set(Array.from(html.matchAll(/href="(https:\/\/t\.me\/[^"<>\s]+)"/gi),m=>m[1]))].slice(0,30),
    audience:{unit:isBot?'monthly_users':kind==='channels'?'subscribers':null,
      value:raw?parseCount(raw.replace(/monthly users|subscribers/gi,'').trim()):null,
      raw:raw??null,source:`https://t.me/${name}`},
    // An interface language or profile translation never proves audience share.
    audienceLanguageShare:null,adsInventory:'unverified'};
}

export async function collectPublicPeer(value,{fetcher=fetch,clock=()=>new Date().toISOString(),
  preview=collectChannel,wait=ms=>new Promise(r=>setTimeout(r,ms)),log=()=>{}}={}){
  const url=`https://t.me/${username(value)}`;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'manual',headers:{'accept-language':'en'}});
      if(r.status===429){
        const seconds=Number(r.headers.get('retry-after')||60);
        const error=new Error('public peer rate limited');error.retryAfter=Math.max(60,Number.isFinite(seconds)?seconds:60);throw error;
      }
      if(!r.ok){const error=new Error(`public peer HTTP ${r.status}`);error.permanent=r.status<500;throw error;}
      const html=await r.text();if(html.length>2_000_000)throw new Error('public peer response too large');
      const out=parsePublicPeer(html,value,clock());
      if(out.kind==='channels'){
        try{
          const snapshot=await preview(username(value),{pages:1});
          if(snapshot.error==='HTTP 429'){const error=new Error('public preview rate limited');error.retryAfter=60;throw error;}
          out.activity=channelFeatures(snapshot,Date.parse(out.checkedAt));
          out.sampledPosts=(snapshot.posts||[]).filter(p=>!p.isService).slice(0,12)
            .map(p=>({url:`https://t.me/${username(value)}/${p.id}`,date:p.date,text:(p.text||'').slice(0,800),
              views:p.views??null,links:p.externalLinks||[],forwarded:!!p.forwarded}));
        }catch(error){if(error.retryAfter)throw error;
          out.activity={availability:'unknown',error:String(error.message).slice(0,120)};out.sampledPosts=[];}
      }
      log('discovery.peer_collected',{value,kind:out.kind,audience:out.audience.value});return out;
    }catch(error){
      log('discovery.peer_error',{value,attempt:attempt+1,message:String(error.message).slice(0,180)});
      if(error.retryAfter||error.permanent||attempt===2)throw error;
      await wait((attempt+1)*1000);
    }
  }
}

export function peerReadiness(candidate,policy='standard',at=Date.now()){
  if(policy!=='competitor-first')return {ready:true};
  if(!['channels','bots'].includes(candidate.surface))
    return {ready:false,reason:'initial baseline is reserved for established direct public peers'};
  const features=typeof candidate.features_json==='string'?JSON.parse(candidate.features_json):candidate.features||{};
  const proof=features.publicPeer,review=features.initialReview;
  if(!proof||proof.kind!==candidate.surface||proof.url!==`https://t.me/${username(candidate.value)}`||
    !Number.isInteger(proof.audience?.value)||!(proof.audience.value>0)||
    proof.audience.unit!==(candidate.surface==='bots'?'monthly_users':'subscribers'))
    return {ready:false,reason:'public audience size and peer type have not been verified'};
  // Owner approved these initial-pilot floors on October 6. They are eligibility
  // floors, never a claim that a large audience will convert profitably.
  const minimum=candidate.surface==='channels'?5000:10000;
  if(proof.audience.value<minimum)return {ready:false,reason:`initial ${proof.audience.unit} floor is ${minimum}`};
  if(candidate.surface==='channels'&&(proof.activity?.availability!=='public-preview'||
    !proof.activity.recentPosts14d||!proof.sampledPosts?.length))
    return {ready:false,reason:'recent public channel content must be checked before initial testing'};
  const age=at-Date.parse(proof.checkedAt);
  if(!Number.isFinite(age)||age< -300000||age>86400000)
    return {ready:false,reason:'public peer evidence needs a current refresh'};
  const interfaceAge=at-Date.parse(features.botInterface?.checkedAt);
  if(features.botInterface&&(!Number.isFinite(interfaceAge)||interfaceAge< -300000||interfaceAge>86400000))
    return {ready:false,reason:'bot interface evidence needs a current refresh'};
  if(review?.status!=='eligible'||review.relevance!=='direct'||!review.reason||!review.marketEvidence)
    return {ready:false,reason:review?.reason||'direct competitor and market suitability review required'};
  if(review.peerCheckedAt!==proof.checkedAt||
      (review.interfaceCheckedAt??null)!==(features.botInterface?.checkedAt??null))
    return {ready:false,reason:'peer evidence changed; suitability review must be refreshed'};
  return {ready:true,audience:proof.audience.value,unit:proof.audience.unit};
}

export async function enrichPublicPeers(store,{limit=1,collect=collectPublicPeer,clock=()=>Date.now()}={}){
  const db=store.db;
  const cooldown=db.prepare('SELECT until_at FROM api_cooldowns WHERE account_key=?').get('public:t.me');
  if(cooldown?.until_at>Math.floor(clock()/1000))return 0;
  const peers=db.prepare(`SELECT c.*,p.name,p.market,p.language,p.context FROM candidates c
    JOIN projects p ON p.id=c.project_id WHERE p.initial_peer_policy='competitor-first'
    AND c.surface IN ('channels','bots') AND c.status IN ('found','prepared') ORDER BY c.score DESC,c.id`).all();
  let count=0;
  for(const candidate of peers){
    if(count>=limit)break;
    const features=JSON.parse(candidate.features_json),age=clock()-Date.parse(features.publicPeer?.checkedAt);
    if(Number.isFinite(age)&&age>=0&&age<86400000)continue;
    const retry=features.publicPeerRetryAt;
    if(Number.isFinite(retry)&&retry>clock())continue;
    try{
      const proof=await collect(candidate.value);
      recordPeerEvidence(store,candidate.id,proof);
      count++;
    }catch(error){
      features.publicPeerRetryAt=clock()+Math.max(300,Number(error.retryAfter)||0)*1000;
      db.prepare('UPDATE candidates SET features_json=? WHERE id=?').run(JSON.stringify(features),candidate.id);
      store.audit('discovery','peer.collect_failed',candidate.id,{message:String(error.message).slice(0,180),retryAt:features.publicPeerRetryAt});
      if(error.retryAfter){
        db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES ('public:t.me',?,'public rate limit')
          ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)`)
          .run(Math.floor(clock()/1000)+Math.ceil(error.retryAfter));
        break;
      }
      count++;
    }
  }
  return count;
}

export function recordPeerEvidence(store,candidateId,proof){
  const db=store.db;
  return db.transaction(()=>{
    const candidate=db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId);
    if(!candidate||proof.url!==`https://t.me/${username(candidate.value)}`)throw new Error('peer evidence identity mismatch');
    const project=db.prepare('SELECT * FROM projects WHERE id=?').get(candidate.project_id);
    const features=JSON.parse(candidate.features_json);
    if(!Number.isFinite(Date.parse(proof.checkedAt)))throw new Error('peer evidence timestamp required');
    if(Date.parse(features.publicPeer?.checkedAt)>=Date.parse(proof.checkedAt))return null;
    features.publicPeer=proof;
    features.initialReview={status:'pending',reason:'new public evidence requires relevance and market review'};
    delete features.publicPeerRetryAt;
    db.prepare('UPDATE candidates SET features_json=? WHERE id=?').run(JSON.stringify(features),candidateId);
    store.audit('discovery','peer.observed',candidateId,proof);
    archivePublicPeerIntelligence(store,project.id,proof);
    if(project.initial_peer_policy!=='competitor-first')return null;
    return addJob(db,project.id,'peer_review',{candidateId,peer:proof,botInterface:features.botInterface??null,
      project:{name:project.name,market:project.market,language:project.language,context:project.context},
      hypothesis:candidate.hypothesis,
      rule:'Initial tests prioritize established direct competitors. Minimum 5000 channel subscribers or 10000 bot monthly users. Review actual profile AND sampled posts (not title alone), measured size, freshness and English-market suitability. Defer tiny, unrelated, unknown-size or market-uncertain peers; do not fill a quota. Profile language does not prove audience language share. Do not infer country or invent metrics.'});
  })();
}

// Desktop inspection only: no message/RPC capability is exposed to the model.
// Observation languages are interface evidence, never audience proportions.
export function recordBotInterfaceEvidence(store,candidateId,evidence,{at=Date.now()}={}){
  const db=store.db,candidate=db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId);
  if(!candidate||candidate.surface!=='bots'||evidence.url!==`https://t.me/${username(candidate.value)}`)
    throw new Error('bot interface identity mismatch');
  const age=at-Date.parse(evidence.checkedAt);
  if(!Number.isFinite(age)||age< -300000||age>86400000||evidence.method!=='support-web-start'||
    !['observed','no-response','blocked'].includes(evidence.status)||
    !Array.isArray(evidence.observedLanguages)||evidence.observedLanguages.length>20||
    evidence.observedLanguages.some(l=>!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(l))||
    typeof evidence.excerpt!=='string'||!evidence.excerpt.trim()||evidence.excerpt.length>2000||
    typeof evidence.limitations!=='string'||!evidence.limitations.trim()||evidence.limitations.length>1000||
    (evidence.status!=='observed'&&evidence.observedLanguages.length))throw new Error('invalid bot interface evidence');
  const proof={version:1,url:evidence.url,checkedAt:evidence.checkedAt,method:evidence.method,
    status:evidence.status,observedLanguages:[...new Set(evidence.observedLanguages)],
    excerpt:evidence.excerpt,limitations:evidence.limitations,audienceLanguageShare:null,defaultLanguage:null};
  const selection=evidence.languageSelection??{status:'not-checked',offeredLanguages:[],selectedLanguage:null,verified:false};
  if(!['not-checked','not-observed','available','blocked'].includes(selection.status)||
    !Array.isArray(selection.offeredLanguages)||selection.offeredLanguages.length>20||
    selection.offeredLanguages.some(l=>!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(l))||typeof selection.verified!=='boolean'||
    (selection.selectedLanguage!==null&&!selection.offeredLanguages.includes(selection.selectedLanguage))||
    (selection.verified&&(!selection.selectedLanguage||!proof.observedLanguages.includes(selection.selectedLanguage)))||
    (selection.status!=='available'&&(selection.offeredLanguages.length||selection.selectedLanguage!==null||selection.verified)))
    throw new Error('invalid bot language selection evidence');
  proof.languageSelection={status:selection.status,offeredLanguages:[...new Set(selection.offeredLanguages)],
    selectedLanguage:selection.selectedLanguage,verified:selection.verified};
  return db.transaction(()=>{
    const features=JSON.parse(db.prepare('SELECT features_json FROM candidates WHERE id=?').get(candidateId).features_json);
    if(features.botInterface?.checkedAt===proof.checkedAt){
      if(JSON.stringify(features.botInterface)!==JSON.stringify(proof))throw new Error('conflicting bot interface observation');
      return null;
    }
    if(Date.parse(features.botInterface?.checkedAt)>Date.parse(proof.checkedAt))throw new Error('stale bot interface observation');
    features.botInterface=proof;
    features.initialReview={status:'pending',reason:'bot interface evidence changed; review required'};
    db.prepare('UPDATE candidates SET features_json=? WHERE id=?').run(JSON.stringify(features),candidateId);
    store.audit('discovery','bot.interface_observed',candidateId,proof);
    const project=db.prepare('SELECT * FROM projects WHERE id=?').get(candidate.project_id);
    if(!features.publicPeer||project.initial_peer_policy!=='competitor-first')return null;
    return addJob(db,project.id,'peer_review',{candidateId,peer:features.publicPeer,botInterface:proof,
      project:{name:project.name,market:project.market,language:project.language,context:project.context},
      hypothesis:candidate.hypothesis,
      rule:'Use supplied public profile/count and actual bot interface observation. Separate observed response language, offered language choices, verified selection and unknown default. A greeting or language menu is not proof of audience proportions or full reading flow. Not-observed is not unsupported. Unknown size stays in reserve; enforce floors and direct relevance. Do not browse or invent missing evidence.'});
  })();
}

export function requirePeerReadiness(candidate,project){
  const result=peerReadiness(candidate,project.initial_peer_policy);
  if(!result.ready)throw new Error(`discovery gate: ${result.reason}`);
}
