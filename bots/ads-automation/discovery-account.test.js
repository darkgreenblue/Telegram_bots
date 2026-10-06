import test from 'node:test';
import assert from 'node:assert/strict';
import { openReadOnlyDiscoveryAccount,publicDiscoveryClient } from './discovery-account.js';
import { findPublicPeers,similarPublicBots,similarPublicChannels,findPublicPosts } from './mtproto.js';

test('discovery cannot send, join, read private history or bypass with wrapped RPCs',async()=>{
  let writes=0;const facade=publicDiscoveryClient({call:async()=>{writes++;},destroy:async()=>{}});
  for(const method of ['messages.sendMessage','messages.getHistory','messages.getDialogs',
    'contacts.getContacts','contacts.importContacts','channels.joinChannel','account.updateProfile',
    'auth.sendCode','invokeWithLayer','invokeWithoutUpdates','contacts.resolveUsername'])
    await assert.rejects(facade.call({_:method}),/prohibited/);
  await assert.rejects(facade.call({_: 'contacts.search',q:'tarot',limit:500}),/bounded/);
  await assert.rejects(facade.call({_: 'bots.getBotRecommendations',bot:{_: 'inputUser',userId:1,accessHash:2}}),/verified/);
  assert.equal(writes,0);assert.equal(facade.sendText,undefined);assert.equal(facade.storage,undefined);
  assert.ok(Object.isFrozen(facade));
});

test('public peer search filters human contacts and private groups before returning data',async()=>{
  const client=publicDiscoveryClient({call:async()=>({myResults:[{_: 'peerUser',userId:1}],
    results:[{_: 'peerUser',userId:1},{_: 'peerUser',userId:2},{_: 'peerChannel',channelId:3}],
    users:[{_:'user',id:1,username:'someone',phone:'private'},{_:'user',id:2,bot:true,username:'tarot_bot'}],
    chats:[{_: 'channel',id:3,broadcast:true,username:'tarotchannel'},{_: 'channel',id:4,megagroup:true,username:'tarotgroup'}]}),destroy:async()=>{}});
  const raw=await client.call({_: 'contacts.search',q:'tarot',limit:30});
  assert.equal(raw.users.length,1);assert.equal(raw.chats.length,1);assert.equal(raw.myResults.length,0);
  assert.equal(raw.results.length,2);assert.equal(JSON.stringify(raw).includes('private'),false);
  assert.equal((await findPublicPeers(client,'tarot')).length,2);
});

test('recommendations can only use a resolved public bot or broadcast channel',async()=>{
  const calls=[];const raw={call:async(req,options)=>{
    calls.push(req);assert.equal(options.timeout,15000);assert.equal(options.floodSleepThreshold,0);
    if(req._==='contacts.resolveUsername')return req.username==='tarot_bot'
      ?{users:[{_:'user',id:2,accessHash:22,bot:true,username:'tarot_bot'}]}
      :req.username==='tarotchannel'?{chats:[{_:'channel',id:3,accessHash:33,broadcast:true,username:'tarotchannel'}]}
      :{users:[{_:'user',id:4,accessHash:44,username:'human_user'}]};
    return {count:20,users:[{_:'user',id:5,bot:true,username:'other_bot',botActiveUsers:20000}],
      chats:[{_:'channel',id:6,broadcast:true,username:'otherchannel'}]};
  },destroy:async()=>{}};
  const client=publicDiscoveryClient(raw);
  assert.equal((await similarPublicBots(client,'tarot_bot'))[0].monthlyActiveUsers,20000);
  assert.equal((await similarPublicChannels(client,'tarotchannel'))[0].value,'@otherchannel');
  await assert.rejects(client.resolveUser('human_user'),/public bot not found/);
  await assert.rejects(client.getSimilarChannels('123'),/public username/);
  const before=calls.length;
  await assert.rejects(client.call({_: 'channels.getChannelRecommendations',channel:{_: 'inputChannel',channelId:999,accessHash:33}}),/verified/);
  assert.equal(calls.length,before);
});

test('post search requires manual initiation and still forbids paid Stars and private offsets',async()=>{
  let calls=0;const raw={call:async req=>{
    calls++;return req._==='channels.checkSearchPostsFlood'?{remains:0,queryIsFree:true}:{chats:[],messages:[]};
  },destroy:async()=>{}};
  await assert.rejects(findPublicPosts(publicDiscoveryClient(raw),{query:'tarot'}),/manual initiation/);
  assert.equal(calls,0);
  const client=publicDiscoveryClient(raw,{manualPostSearch:true});
  await findPublicPosts(client,{query:'tarot'});assert.equal(calls,2);
  const valid={_: 'channels.searchPosts',query:'tarot',limit:30,offsetRate:0,offsetId:0,offsetPeer:{_: 'inputPeerEmpty'}};
  await assert.rejects(client.call({...valid,allowPaidStars:1}),/Stars/);
  await assert.rejects(client.call({...valid,offsetPeer:{_: 'inputPeerUser',userId:99,accessHash:1}}),/first page/);
  assert.equal(calls,2);
});

test('runtime checks pinned identity with updates disabled and never starts a login',async()=>{
  let options,destroyed=0,auth=0,id=123;
  class Client{
    constructor(o){options=o;}
    start(){auth++;throw new Error('must never login');}
    async call(req){assert.equal(req._,'users.getUsers');return [{_: 'user',id}];}
    async destroy(){destroyed++;}
  }
  const config={apiId:1,apiHash:'0'.repeat(32),expectedUserId:123,clientFactory:Client,checkStorage:async()=>{}};
  const client=await openReadOnlyDiscoveryAccount(config);
  assert.equal(options.disableUpdates,true);assert.equal(options.updates,false);assert.equal(options.logLevel,0);
  assert.equal(auth,0);await client.destroy();assert.equal(destroyed,1);
  id=456;await assert.rejects(openReadOnlyDiscoveryAccount(config),/account mismatch/);
  assert.equal(destroyed,2);assert.equal(auth,0);
  await assert.rejects(openReadOnlyDiscoveryAccount({...config,expectedUserId:undefined}),/pinned/);
  await assert.rejects(openReadOnlyDiscoveryAccount({...config,checkStorage:async()=>{throw new Error('private existing session required');}}),/private/);
  assert.equal(destroyed,2);
});

test('flood limits are propagated once and logs contain no SDK error details',async()=>{
  const logs=[];let attempts=0;
  const failure=Object.assign(new Error('secret and private data'),{name:'FloodWaitError',seconds:600});
  const client=publicDiscoveryClient({call:async()=>{attempts++;throw failure;},destroy:async()=>{}},
    {log:(event,detail)=>logs.push({event,...detail})});
  await assert.rejects(findPublicPeers(client,'tarot'),e=>e===failure);
  assert.equal(attempts,1);assert.equal(logs.at(-1).floodSeconds,600);
  assert.equal(JSON.stringify(logs).includes('secret'),false);
});
