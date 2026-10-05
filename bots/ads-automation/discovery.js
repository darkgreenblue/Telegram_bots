import { collectChannel } from '../../tools/benchmark/tme.mjs';
import { addCandidate } from './db.js';

const median=xs=>{
  if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;
};
export function channelFeatures(snapshot,at=Date.now()){
  if(!snapshot.ok)return {availability:'unknown',error:snapshot.error};
  const mature=snapshot.posts.filter(p=>p.date && at-Date.parse(p.date)>=48*3600000 && !p.isService);
  const views=mature.map(p=>p.views).filter(Number.isFinite);
  const recent=snapshot.posts.filter(p=>p.date && at-Date.parse(p.date)<14*86400000 && !p.isService);
  return {availability:'public-preview',subscribers:snapshot.header?.subscribers??null,
    sampledPosts:snapshot.posts.length,maturePosts:mature.length,recentPosts14d:recent.length,
    medianViews48h:median(views),medianReactions48h:median(mature.map(p=>p.reactionTotal).filter(Number.isFinite)),
    sampledViewCoverage:mature.length?views.length/mature.length:0,
    latestPostAt:snapshot.posts[0]?.date??null};
}

const tgLinks=post=>post.externalLinks.flatMap(url=>{
  const m=/^https:\/\/t\.me\/(?:s\/)?([A-Za-z0-9_]{5,32})(?:[/?#]|$)/i.exec(url);
  return m?[`@${m[1]}`]:[];
});

// Bounded seed → public-link graph expansion follows tg-radar's MIT discovery pattern:
// https://github.com/bigidulka/tg-radar/blob/master/src/tg_radar/discovery.py
export async function expandPublicChannels(store,{projectId,seeds,max=100,depth=2,delayMs=1200}){
  const queue=seeds.map(s=>({username:s.replace(/^@/,''),level:0,source:'seed'})),seen=new Set(),out=[];
  while(queue.length && out.length<max){
    const item=queue.shift();const key=item.username.toLowerCase();
    if(seen.has(key)||!/^\w{5,32}$/.test(item.username))continue;seen.add(key);
    let snap;
    try{snap=await collectChannel(item.username,{pages:2,delayMs});}
    catch(e){snap={ok:false,error:String(e.message).slice(0,120),posts:[]};}
    const features=channelFeatures(snap);
    const score=(features.maturePosts>=5?2:0)+(features.recentPosts14d>=3?1:0)+
      (features.medianViews48h>=300?1:0)+(features.subscribers>=1000?1:0);
    const value=`@${item.username}`;
    const id=addCandidate(store.db,{projectId,surface:'channels',value,source:item.source,
      evidence:[{type:'public-preview',url:`https://t.me/s/${item.username}`,at:new Date().toISOString(),ok:snap.ok}],
      hypothesis:`Possible relevant audience discovered from ${item.source}`,features,score});
    out.push({id,value,features});
    if(snap.ok && item.level<depth){
      for(const post of snap.posts){for(const name of tgLinks(post))if(!seen.has(name.slice(1).toLowerCase()))queue.push({username:name.slice(1),level:item.level+1,source:value});}
    }
    if(queue.length)await new Promise(r=>setTimeout(r,delayMs));
  }
  return out;
}

export function shortlist(candidates,limit=20){
  const selected=[],left=[...candidates].filter(c=>c.status==='found');
  const surfaces=new Map(),hypotheses=new Map();
  while(selected.length<limit && left.length){
    left.sort((a,b)=>{
      const value=x=>x.score-0.8*(surfaces.get(x.surface)||0)-0.6*(hypotheses.get(x.hypothesis)||0);
      return value(b)-value(a)||a.id-b.id;
    });
    const next=left.shift();selected.push(next);
    surfaces.set(next.surface,(surfaces.get(next.surface)||0)+1);
    hypotheses.set(next.hypothesis,(hypotheses.get(next.hypothesis)||0)+1);
  }
  return selected;
}
