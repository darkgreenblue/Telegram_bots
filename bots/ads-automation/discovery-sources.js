import { htmlToText } from '../../tools/benchmark/tme.mjs';
import { publicUsernames,expandPublicPeers } from './discovery-graph.js';
import { addCandidate } from './db.js';
import { randomUUID } from 'node:crypto';

async function readSource(url,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetcher(url,{signal:AbortSignal.timeout(15000),headers:{accept:'application/json,text/html'}});
      if(response.status===429){const e=new Error('discovery source rate limited');
        e.retryAfter=Math.max(60,Number(response.headers.get('retry-after'))||60);throw e;}
      if(!response.ok){const e=new Error(`discovery source HTTP ${response.status}`);e.permanent=response.status<500;throw e;}
      const body=await response.text();if(body.length>2_000_000){const e=new Error('discovery source response too large');e.permanent=true;throw e;}
      return body;
    }catch(error){if(error.retryAfter||error.permanent||attempt===2)throw error;await wait((attempt+1)*1000);}
  }
}

export function parseLyzem(html,url){
  if(!/class="[^"]*\b(?:page-search|search-result)\b/.test(html))throw new Error('unexpected Lyzem search page');
  const out=[];
  // Read result cards only. Footer/support bots and unrelated page links are
  // not search results. Directory peer type is a hint, checked against t.me.
  for(const m of html.matchAll(/<li\b[^>]*class="search-result"[^>]*>([\s\S]*?)<\/li>/gi)){
    const kind=m[1].match(/title="(bot|channel|group)"/i)?.[1]?.toLowerCase();
    if(!['bot','channel'].includes(kind))continue;
    for(const value of publicUsernames(m[1]).slice(0,1))out.push({value,source:'lyzem',url,
      providerKind:kind,summary:htmlToText(m[1]).slice(0,500)});
  }
  return [...new Map(out.map(r=>[r.value,r])).values()];
}

export function parseCatalog(data,{url,kind}){
  if(!data||data.isDemo===true||data.demo===true||data.meta?.isDemo===true)
    throw new Error('demo catalog is not real discovery evidence');
  if(!Array.isArray(data.data))throw new Error('unexpected catalog response');
  const out=[];
  for(const item of data.data.slice(0,50)){
    const name=kind==='channels'?item.username:item.ctaTargetUsername;
    if(!/^[a-z0-9_]{5,32}$/i.test(name||''))continue;
    out.push({value:`@${name.toLowerCase()}`,source:kind==='channels'?'telemetr-catalog':'telemetr-ad-destination',url,
      // Third-party language, audience and inventory values are source claims,
      // never substituted for independently observed Telegram evidence.
      providerClaims:{title:item.title,language:item.lang,audience:item.members??null,
        snapshotAt:item.lastSnapshotAt??item.lastSeenAt??null,sponsoredEligible:item.isSponsoredEligible??null,
        placementCount:item.placementCount??null},
      summary:String(kind==='channels'?item.title:item.text||item.title||'').slice(0,800)});
  }
  return [...new Map(out.map(r=>[r.value,r])).values()];
}

export function parseBotDirectory(html,{url,provider}){
  if(!['grambots','telegramic'].includes(provider))throw new Error('unknown bot directory');
  const marker=provider==='grambots'?'Search Telegram bots':'search-form-right';
  if(!html.includes(marker))throw new Error('unexpected bot directory page');
  const pattern=provider==='grambots'?/href="\/bots\/([a-z0-9_]{5,32})"/gi:
    /href="\/bot\/([a-z0-9_]{5,32})\/"/gi;
  // Directory cards use these singular resource paths. Category, login,
  // support and advertisement links are excluded by construction.
  return [...new Set(Array.from(html.matchAll(pattern),m=>m[1].toLowerCase()))].slice(0,50)
    .map(name=>({value:`@${name}`,source:provider,url,providerKind:'bot'}));
}

export async function searchDiscoverySources(query,{limit=20,language,store,clock=()=>Math.floor(Date.now()/1000),...options}={}){
  if(typeof query!=='string'||!query.trim()||query.length>200||!Number.isInteger(limit)||limit<1||limit>50)
    throw new Error('invalid source discovery query or limit');
  if(language!==undefined&&!/^[a-z]{2,3}$/.test(language))throw new Error('invalid discovery language');
  const routes=[{provider:'lyzem',url:`https://lyzem.com/search?${new URLSearchParams({q:query,'per-page':String(limit)})}`},
    ...['channels','ads'].map(kind=>({provider:`telemetr-${kind}`,kind,
      url:`https://tgadsspy.com/api/v1/${kind}?${new URLSearchParams({q:query,limit:String(limit),
        ...(language?{lang:language}:{}),...(kind==='ads'?{dest:'telegram'}:{})})}`})),
    {provider:'grambots',url:`https://www.grambots.com/?${new URLSearchParams({q:query,sort:'mau'})}`},
    {provider:'telegramic',url:`https://telegramic.org/bots/?${new URLSearchParams({q:query})}`}];
  const output=[];
  for(const route of routes){
    const at=new Date().toISOString();
    const key=`source:${new URL(route.url).hostname}`;
    const cooldown=store?.db.prepare('SELECT until_at FROM api_cooldowns WHERE account_key=?').get(key);
    if(cooldown?.until_at>clock()){
      output.push({...route,at,status:'unavailable',seeds:[],error:'provider cooldown',retryAfter:cooldown.until_at-clock()});continue;
    }
    try{
      const body=await readSource(route.url,options);
      const seeds=route.kind?parseCatalog(JSON.parse(body),route):route.provider==='lyzem'?
        parseLyzem(body,route.url):parseBotDirectory(body,route);
      output.push({...route,at,status:'ok',seeds});
    }catch(error){
      if(error.retryAfter&&store)store.db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES (?,?,'discovery source rate limit')
        ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)`).run(key,clock()+Math.ceil(error.retryAfter));
      output.push({...route,at,status:'unavailable',seeds:[],error:String(error.message).slice(0,180),retryAfter:error.retryAfter??null});
    }
    if(options.wait)await options.wait(1200);else await new Promise(r=>setTimeout(r,1200));
  }
  return output;
}

export async function discoverFromSources(store,{projectId,query,max=30,search=searchDiscoverySources,collect}){
  const project=store.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if(!project)throw new Error('project absent');
  const routes=await search(query,{language:project.language,store}),ordered=[];
  // A large provider must not consume the entire validation budget before
  // smaller independent directories get a chance to contribute.
  for(let i=0;i<Math.max(0,...routes.map(r=>r.seeds.length));i++)
    for(const route of routes)if(route.seeds[i])ordered.push(route.seeds[i].value);
  const seeds=[...new Set(ordered)];
  for(const route of routes)store.audit('discovery','source.searched',projectId,{query,provider:route.provider,
    url:route.url,at:route.at,status:route.status,seeds:route.seeds.length,error:route.error??null});
  if(!routes.some(r=>r.status==='ok')){
    const error=new Error('all discovery sources unavailable; no valid empty result');
    error.retryAfter=Math.max(300,...routes.map(r=>Number(r.retryAfter)||0));throw error;
  }
  let peers,interrupted;
  try{peers=await expandPublicPeers(store,{projectId,seeds,max,depth:0,...(collect?{collect}:{})});}
  catch(error){if(!error.retryAfter)throw error;peers=error.peers||[];interrupted=error;}
  for(const peer of peers){
    for(const seed of routes.flatMap(r=>r.seeds).filter(s=>s.value===peer.value)){
      addCandidate(store.db,{projectId,surface:peer.surface,value:peer.value,source:seed.source,
        hypothesis:`${query}: source suggestion requires direct relevance and market review`,
        evidence:[{type:'directory-source',...seed,query}],score:0});
    }
  }
  const summary={query,routes:routes.map(r=>({provider:r.provider,status:r.status,seeds:r.seeds.length})),
    uniqueSeeds:seeds.length,verifiedPublicPeers:peers.length};
  store.audit('discovery',interrupted?'sources.partial':'sources.completed',projectId,summary);
  if(interrupted)throw interrupted;
  return {...summary,peers};
}

export function queueSourceDiscovery(store,projectId,query){
  if(typeof query!=='string'||query.trim().length<3||query.length>200)throw new Error('invalid source discovery query');
  const normalized=query.trim().toLowerCase();
  store.db.prepare(`INSERT INTO discovery_runs(project_id,query) VALUES (?,?)
    ON CONFLICT(project_id,query) DO UPDATE SET status='queued',attempts=0,error=NULL,next_at=0
    WHERE discovery_runs.status='done' AND discovery_runs.completed_at<unixepoch()-86400`).run(projectId,normalized);
  return store.db.prepare('SELECT id FROM discovery_runs WHERE project_id=? AND query=?').get(projectId,normalized).id;
}

export async function runSourceDiscovery(store,{discover=discoverFromSources,clock=()=>Math.floor(Date.now()/1000)}={}){
  const db=store.db,run=db.transaction(()=>{
    const now=clock();
    db.prepare(`UPDATE discovery_runs SET status='failed',lease_until=NULL,lease_token=NULL,error='discovery retry limit reached after interrupted run'
      WHERE status='running' AND lease_until<? AND attempts>=3`).run(now);
    const job=db.prepare(`SELECT * FROM discovery_runs WHERE
      (status='queued' AND next_at<=?) OR (status='running' AND lease_until<?) ORDER BY id LIMIT 1`).get(now,now);
    if(!job)return null;
    const token=randomUUID();
    db.prepare("UPDATE discovery_runs SET status='running',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=?").run(now+3600,token,job.id);
    store.audit('discovery','sources.started',job.id,{query:job.query,attempt:job.attempts+1,leaseUntil:now+3600});
    return {...job,token};
  })();
  if(!run)return false;
  try{
    const result=await discover(store,{projectId:run.project_id,query:run.query,max:30});
    db.prepare("UPDATE discovery_runs SET status='done',response_json=?,completed_at=?,lease_until=NULL,lease_token=NULL,error=NULL WHERE id=? AND lease_token=?")
      .run(JSON.stringify(result),clock(),run.id,run.token);
  }catch(error){
    const failed=run.attempts>=2;
    db.prepare('UPDATE discovery_runs SET status=?,next_at=?,lease_until=NULL,lease_token=NULL,error=? WHERE id=? AND lease_token=?')
      .run(failed?'failed':'queued',clock()+Math.max(300,Number(error.retryAfter)||0),String(error.message).slice(0,180),run.id,run.token);
    store.audit('discovery','sources.failed',run.id,{attempt:run.attempts+1,terminal:failed,message:String(error.message).slice(0,180)});
  }
  return true;
}
