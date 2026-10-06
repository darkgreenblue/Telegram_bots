import { readFile,stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openDiscoveryAccount,findPublicPeers,similarPublicBots,similarPublicChannels } from './mtproto.js';
import { peerReadiness } from './peer-evidence.js';
import { searchDiscoverySources } from './discovery-sources.js';

export function nativeAccountProvider(store,{configPath='./data/discovery-account-config.json',
  clock=()=>Math.floor(Date.now()/1000),
  open=openDiscoveryAccount,load=async path=>{
    const info=await stat(path);
    if(info.mode&0o077)throw new Error('discovery credential file must be private');
    return readFile(path,'utf8');
  }}={}){
  let fingerprint,client=null,pending=null;
  const close=async()=>{await pending?.catch(()=>{});
    try{if(client)await client.destroy();}finally{client=null;fingerprint=null;}};
  return {close,async get(projectId){
    let text;
    try{text=await load(configPath);}catch(error){if(error.code==='ENOENT'){await close();return null;}throw error;}
    const config=JSON.parse(text);
    if(config.schema!==1||!Array.isArray(config.projectIds)||config.projectIds.some(id=>!Number.isSafeInteger(id)||id<1))
      throw new Error('discovery account configuration invalid');
    if(config.enabled!==true){await close();return null;}
    if(!config.projectIds.includes(projectId))return null;
    if(!Number.isSafeInteger(config.expectedUserId)||config.expectedUserId<1)throw new Error('pinned discovery account ID required');
    const key=`native:telegram:${config.expectedUserId}`;
    const cooldown=store.db.prepare('SELECT until_at FROM api_cooldowns WHERE account_key=?').get(key);
    if(cooldown?.until_at>clock())return {userId:config.expectedUserId,client:null};
    const next=createHash('sha256').update(text).digest('hex');
    if(fingerprint!==next){await close();fingerprint=next;}
    if(!client){
      if(!pending)pending=open({apiId:config.apiId,apiHash:config.apiHash,expectedUserId:config.expectedUserId,
        storage:'./data/discovery-account',log:(event,detail)=>store.audit('discovery',event,projectId,detail)})
        .then(value=>{client=value;return value;}).finally(()=>{pending=null;});
      try{await pending;}catch(error){
        store.db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES (?,?,'native session unavailable')
          ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)`)
          .run(key,clock()+Math.max(300,Number(error.seconds)||0));throw error;
      }
    }
    return {client,userId:config.expectedUserId};
  }};
}

export async function searchNativeSources(store,{projectId,query,provider,limit=20,clock=()=>Math.floor(Date.now()/1000)}){
  const project=store.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if(!project)throw new Error('project absent');
  const routes=[],at=new Date(clock()*1000).toISOString();
  let account;
  try{account=await provider.get(projectId);}catch(error){
    // Do not embed library/JSON/config error messages containing credential data.
    store.audit('discovery','native.account_unavailable',projectId,{kind:error.name||'Error'});
    return [{provider:'telegram-native',url:'https://core.telegram.org/api',at,status:'unavailable',
      seeds:[],error:'dedicated session unavailable',retryAfter:300}];
  }
  if(!account)return routes;
  const key=`native:telegram:${account.userId}`;
  const cooldown=store.db.prepare('SELECT until_at FROM api_cooldowns WHERE account_key=?').get(key);
  if(cooldown?.until_at>clock())return [{provider:'telegram-native',url:'https://core.telegram.org/api',at,
    status:'unavailable',seeds:[],error:'native account cooldown',retryAfter:cooldown.until_at-clock()}];
  const tasks=[{name:'telegram-search',source:`contacts.search:${query}`,run:()=>findPublicPeers(account.client,query,limit)}];
  // Recommendations expand an already reviewed relevant peer, never an arbitrary
  // private account or unverified weak seed. Maximum two seeds per source job.
  const seeds=store.db.prepare(`SELECT * FROM candidates WHERE project_id=? AND surface IN ('channels','bots')
    ORDER BY score DESC,id`).all(projectId).filter(c=>peerReadiness(c,'competitor-first',clock()*1000).ready).slice(0,2);
  for(const seed of seeds)tasks.push({name:'telegram-recommendations',source:`similar:${seed.value}`,
    run:()=>seed.surface==='bots'?similarPublicBots(account.client,seed.value):similarPublicChannels(account.client,seed.value)});
  for(const task of tasks){
    try{
      const peers=await task.run();
      routes.push({provider:task.name,url:'https://core.telegram.org/api',at,status:'ok',seeds:peers.slice(0,limit)
        .map(peer=>({value:peer.value.toLowerCase(),source:peer.source||task.source,url:`https://t.me/${peer.value.slice(1).toLowerCase()}`,
          providerKind:peer.surface==='bots'?'bot':'channel',nativeEvidence:{title:peer.title??null,
            monthlyActiveUsers:peer.monthlyActiveUsers??null,observedAt:at,parent:task.source}}))});
    }catch(error){
      const seconds=Math.max(300,Number(error.seconds)||0);
      store.db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES (?,?,'native read failure')
        ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)`).run(key,clock()+seconds);
      store.audit('discovery','native.deferred',projectId,{method:task.name,floodSeconds:Number(error.seconds)||null,retryAfter:seconds});
      routes.push({provider:task.name,url:'https://core.telegram.org/api',at,status:'unavailable',seeds:[],
        error:'native request deferred',retryAfter:seconds});break;
    }
  }
  return routes;
}

export async function searchAllDiscoverySources(store,{projectId,query,provider,
  publicSearch=searchDiscoverySources,nativeSearch=searchNativeSources}){
  const project=store.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if(!project)throw new Error('project absent');
  const routes=await publicSearch(query,{language:project.language,store});
  return [...routes,...await nativeSearch(store,{projectId,query,provider})];
}
