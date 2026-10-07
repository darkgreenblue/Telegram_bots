import test from 'node:test';
import assert from 'node:assert/strict';
import { findPublicPeers,similarPublicBots,similarPublicChannels,findPublicPosts } from './mtproto.js';

test('native peer and similar-bot discovery excludes groups, private peers and human users',async()=>{
  const result={chats:[{_:'channel',broadcast:true,username:'tarotchannel',title:'Tarot'},{_:'channel',megagroup:true,username:'tarotgroup'}],
    users:[{bot:true,username:'large_bot',botActiveUsers:40000},{bot:true,username:'hidden_bot'},{username:'human_user'}],count:99};
  const client={call:async()=>result,resolveUser:async()=>({_:'inputUser',userId:1,accessHash:2})};
  const peers=await findPublicPeers(client,'tarot');
  assert.equal(peers.length,3);assert.equal(peers.at(-1).monthlyActiveUsers,null);
  const bots=await similarPublicBots(client,'large_bot');
  assert.equal(bots.length,2);assert.equal(bots[0].totalAvailable,99);
  await assert.rejects(()=>findPublicPeers(client,'tarot',101),/limit/);
});

test('free post search exhaustion does not send a search or permit Stars',async()=>{
  const calls=[];const client={call:async request=>{calls.push(request);return {remains:0,waitTill:123};}};
  await assert.rejects(()=>findPublicPosts(client,{query:'tarot'}),e=>e.retryAt===123&&/paid Stars/.test(e.message));
  assert.deepEqual(calls.map(c=>c._),['channels.checkSearchPostsFlood']);
});

test('public content discovery collects dated source posts, never requests payment or private history',async()=>{
  const calls=[];const client={call:async request=>{
    calls.push(request);if(request._==='channels.checkSearchPostsFlood')return {queryIsFree:true,remains:0};
    return {chats:[{_:'channel',broadcast:true,id:7,username:'tarotchannel',title:'Tarot'}],
      messages:[{_:'message',id:18,peerId:{_:'peerChannel',channelId:7},date:123,message:'Love tarot'}]};}};
  const peers=await findPublicPosts(client,{query:'tarot'});
  assert.equal(peers[0].evidence[0].url,'https://t.me/tarotchannel/18');
  await findPublicPosts(client,{hashtag:'#tarot'});
  assert.equal(calls.at(-1).hashtag,'tarot');assert.equal(calls.at(-1).query,undefined);
  for(const request of calls)assert.equal('allowPaidStars' in request,false);
  const before=calls.length;await assert.rejects(()=>findPublicPosts(client,{query:'x',hashtag:'y'}),/exactly one/);
  assert.equal(calls.length,before);
});

test('native discovery propagates rate limit without rotating accounts or replaying',async()=>{
  let attempts=0;const error=Object.assign(new Error('FLOOD_WAIT_600'),{seconds:600});
  await assert.rejects(()=>findPublicPeers({call:async()=>{attempts++;throw error;}},'tarot'),e=>e===error);
  assert.equal(attempts,1);
});

test('native channel recommendations keep broadcast channels and exclude other public chat types',async()=>{
  const result=Object.assign([{username:'tarotchannel',chatType:'channel'},
    {username:'tarotgroup',chatType:'supergroup'},{username:'tarotcommunity',chatType:'community'},
    {chatType:'channel'}],{total:30});
  const peers=await similarPublicChannels({getSimilarChannels:async()=>result},'seedchannel');
  assert.deepEqual(peers,[{surface:'channels',value:'@tarotchannel',source:'recommendation:seedchannel',totalAvailable:30}]);
});
