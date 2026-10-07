// Dedicated user session. No member scraping, private history or paid Stars search.
// @mtcute/node docs: https://mtcute.dev/guide/ and https://ref.mtcute.dev/modules/_mtcute_node
export { openReadOnlyDiscoveryAccount as openDiscoveryAccount } from './discovery-account.js';

const boundedLimit=limit=>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('discovery limit must be 1..100');
  return limit;
};
const publicChannels=(chats,source)=>(chats||[]).filter(c=>c._==='channel'&&c.broadcast&&c.username)
  .map(c=>({surface:'channels',value:`@${c.username}`,title:c.title,source}));
const publicBots=(users,source)=>(users||[]).filter(u=>u.bot&&u.username)
  .map(u=>({surface:'bots',value:`@${u.username}`,title:u.firstName||u.username,
    monthlyActiveUsers:Number.isInteger(u.botActiveUsers)?u.botActiveUsers:null,source}));

export async function findPublicPeers(client,query,limit=30){
  if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('invalid discovery query');
  const result=await client.call({_: 'contacts.search',q:query,limit:boundedLimit(limit)});
  return [...publicChannels(result.chats,`contacts.search:${query}`),...publicBots(result.users,`contacts.search:${query}`)];
}

// Telegram recommends bots by audience similarity, not merely title overlap.
// Requires an authorized user session. This adapter never starts one itself.
export async function similarPublicBots(client,username){
  const bot=await client.resolveUser(username);
  const result=await client.call({_: 'bots.getBotRecommendations',bot});
  return publicBots(result.users,`bot-recommendation:${username}`)
    .map(peer=>({...peer,totalAvailable:result.count??result.users.length}));
}

// Search public post contents, including channels not joined by this account.
// One page only; no Stars permission is exposed. When free slots are exhausted
// the caller must defer, never retry with payment or another account.
export async function findPublicPosts(client,{query,hashtag,limit=30}){
  if(Boolean(query)===Boolean(hashtag))throw new Error('exactly one query or hashtag required');
  const term=query||hashtag;
  if(typeof term!=='string'||!term.trim()||term.length>200)throw new Error('invalid public post query');
  boundedLimit(limit);
  if(query){
    const allowance=await client.call({_: 'channels.checkSearchPostsFlood',query});
    if(!allowance.queryIsFree&&!(Number.isInteger(allowance.remains)&&allowance.remains>0)){
      const error=new Error('free public post search unavailable; paid Stars search prohibited');
      error.retryAt=allowance.waitTill??null;throw error;
    }
  }
  const result=await client.call({_: 'channels.searchPosts',...(query?{query}:{hashtag:hashtag.replace(/^#/, '')}),
    limit,offsetRate:0,offsetId:0,offsetPeer:{_: 'inputPeerEmpty'}});
  const source=`public-posts:${query||`#${hashtag.replace(/^#/, '')}`}`;
  return publicChannels(result.chats,source).map(peer=>({...peer,
    // Evidence is bounded public content. Do not read member lists or dialogs.
    evidence:(result.messages||[]).filter(m=>m._==='message'&&m.peerId?._==='peerChannel'&&
      String(m.peerId.channelId)===String((result.chats||[]).find(c=>`@${c.username}`===peer.value)?.id))
      .slice(0,5).map(m=>({url:`https://t.me/${peer.value.slice(1)}/${m.id}`,text:(m.message||'').slice(0,800),date:m.date}))}));
}

export async function similarPublicChannels(client,username){
  const result=await client.getSimilarChannels(username);
  return Array.from(result).filter(c=>c.username&&c.chatType==='channel').map(c=>({surface:'channels',value:`@${c.username}`,
    source:`recommendation:${username}`,totalAvailable:result.total??null}));
}
