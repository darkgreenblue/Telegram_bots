import { addCandidate } from './db.js';
import { collectPublicPeer,recordPeerEvidence } from './peer-evidence.js';

export function publicUsernames(text){
  const names=[...String(text).matchAll(/https:\/\/t\.me\/(?:s\/)?([a-z0-9_]{5,32})(?:[/?#\s"<>]|$)/gi)]
    .map(m=>m[1]);
  names.push(...Array.from(String(text).matchAll(/(?:^|[^\w@])@([a-z0-9_]{5,32})\b/gi),m=>m[1]));
  return [...new Set(names.map(name=>`@${name.toLowerCase()}`))];
}

// MIT tg-radar's seed/link expansion pattern, implemented using our durable
// store and bot-aware collector. No private history, joining or message sending.
export async function expandPublicPeers(store,{projectId,seeds,max=100,depth=2,delayMs=1200,
  collect=collectPublicPeer,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=()=>Math.floor(Date.now()/1000)}){
  if(!store.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw new Error('project absent');
  if(!Array.isArray(seeds)||!Number.isInteger(max)||max<1||max>500||!Number.isInteger(depth)||depth<0||depth>3)
    throw new Error('invalid discovery graph bounds');
  const queue=seeds.map(value=>({value:value.startsWith('@')?value:`@${value}`,level:0,source:'seed'}));
  const seen=new Set(),out=[];let attempted=0;
  while(queue.length&&attempted<max){
    const cooldown=store.db.prepare('SELECT until_at FROM api_cooldowns WHERE account_key=?').get('public:t.me');
    if(cooldown?.until_at>clock()){
      const error=new Error('public peer discovery cooldown');error.retryAfter=cooldown.until_at-clock();error.peers=out;throw error;
    }
    const edge=queue.shift(),value=edge.value.toLowerCase();
    if(seen.has(value)||!/^@[a-z0-9_]{5,32}$/.test(value))continue;
    seen.add(value);attempted++;
    try{
      const proof=await collect(value);
      if(['channels','bots'].includes(proof.kind)){
        const id=addCandidate(store.db,{projectId,surface:proof.kind,value,source:`public-graph:${edge.source}`,
          hypothesis:`Public relation from ${edge.source}; relevance requires review`,
          evidence:[{type:'public-graph',url:proof.url,parent:edge.source,depth:edge.level,at:proof.checkedAt}],score:0});
        recordPeerEvidence(store,id,proof);out.push({id,value,surface:proof.kind});
        if(edge.level<depth){
          const sources=[{text:`${proof.description||''} ${(proof.publicLinks||[]).join(' ')}`,url:proof.url},
            ...(proof.sampledPosts||[]).map(p=>({text:`${p.text} ${(p.links||[]).join(' ')}`,url:p.url}))];
          for(const source of sources)for(const next of publicUsernames(source.text))
            if(!seen.has(next))queue.push({value:next,level:edge.level+1,source:source.url});
        }
      }else store.audit('discovery','graph.unsupported_peer',value,{kind:proof.kind,source:edge.source});
    }catch(error){
      store.audit('discovery','graph.failed',value,{source:edge.source,message:String(error.message).slice(0,180)});
      if(error.retryAfter){
        store.db.prepare(`INSERT INTO api_cooldowns(account_key,until_at,reason) VALUES ('public:t.me',?,'public rate limit')
          ON CONFLICT(account_key) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)`).run(clock()+Math.ceil(error.retryAfter));
        error.peers=out;throw error;
      }
    }
    if(queue.length&&attempted<max)await wait(delayMs);
  }
  store.audit('discovery','graph.completed',projectId,{seeds,attempted,found:out.length,max,depth});
  return out;
}
