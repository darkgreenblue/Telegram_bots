import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { nativeAccountProvider,searchNativeSources,searchAllDiscoverySources } from './native-source.js';

const seed=()=>{
  const store=openStore(':memory:');
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES(1,'pilot','Pilot','tarot-intl','https://t.me/examplebot','English global','en','fixture')`).run();
  return store;
};
const config={schema:1,enabled:true,projectIds:[1],expectedUserId:123,apiId:1,apiHash:'0'.repeat(32)};

test('native account is optional and cannot enable an unapproved project',async()=>{
  const store=seed();let opens=0;
  const provider=nativeAccountProvider(store,{load:async()=>JSON.stringify({...config,enabled:false}),
    open:async()=>{opens++;}});
  assert.equal(await provider.get(1),null);assert.equal(await provider.get(2),null);
  assert.equal(opens,0);
  const absent=nativeAccountProvider(store,{load:async()=>{throw Object.assign(new Error('absent'),{code:'ENOENT'});}});
  assert.equal(await absent.get(1),null);
  const scoped=nativeAccountProvider(store,{load:async()=>JSON.stringify(config),open:async()=>{opens++;}});
  assert.equal(await scoped.get(2),null);assert.equal(opens,0);store.close();
});

test('persistent native cooldown prevents reopening a session after a worker restart',async()=>{
  const store=seed();let opens=0;
  const options={clock:()=>100,load:async()=>JSON.stringify(config),
    open:async()=>{opens++;throw Object.assign(new Error('secret error'),{seconds:600});}};
  const first=nativeAccountProvider(store,options);
  await assert.rejects(first.get(1));
  assert.equal(store.db.prepare('SELECT until_at FROM api_cooldowns').get().until_at,700);
  const restarted=nativeAccountProvider(store,options);
  assert.equal((await restarted.get(1)).client,null);assert.equal(opens,1);
  const routes=await searchNativeSources(store,{projectId:1,query:'tarot',provider:restarted,clock:()=>100});
  assert.equal(routes[0].error,'native account cooldown');assert.equal(opens,1);store.close();
});

test('native peer seeds retain provenance without treating unknown MAU as zero',async()=>{
  const store=seed();let requests=0;
  const provider={get:async()=>({userId:123,client:{call:async req=>{
    requests++;assert.equal(req._,'contacts.search');return {users:[{bot:true,username:'tarot_bot'},
      {bot:true,username:'large_bot',botActiveUsers:25000}],chats:[]};}}})};
  const routes=await searchNativeSources(store,{projectId:1,query:'tarot',provider,clock:()=>100});
  assert.equal(requests,1);assert.equal(routes[0].seeds[0].nativeEvidence.monthlyActiveUsers,null);
  assert.equal(routes[0].seeds[1].nativeEvidence.monthlyActiveUsers,25000);
  assert.equal(routes[0].seeds[0].source,'contacts.search:tarot');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM operations').get().n,0);store.close();
});

test('an RPC flood wait blocks remaining recommendations and subsequent source jobs',async()=>{
  const store=seed();let requests=0;
  const provider={get:async()=>({userId:123,client:{call:async()=>{
    requests++;throw Object.assign(new Error('private details must not be persisted'),{seconds:1200});}}})};
  const arg={projectId:1,query:'tarot',provider,clock:()=>100};
  const routes=await searchNativeSources(store,arg);
  assert.equal(routes[0].retryAfter,1200);assert.equal(requests,1);
  await searchNativeSources(store,arg);assert.equal(requests,1);
  assert.equal(JSON.stringify(store.db.prepare('SELECT details_json FROM audit').all()).includes('private details'),false);
  store.close();
});

test('unavailable native login never breaks public discovery or exposes credentials',async()=>{
  const store=seed();const provider={get:async()=>{throw new Error('API_HASH_SECRET');}};
  const routes=await searchAllDiscoverySources(store,{projectId:1,query:'tarot',provider,
    publicSearch:async()=>[{provider:'public',status:'ok',seeds:[]}]});
  assert.equal(routes.length,2);assert.equal(routes[0].status,'ok');assert.equal(routes[1].status,'unavailable');
  assert.equal(JSON.stringify(routes).includes('API_HASH_SECRET'),false);store.close();
});

test('the provider reuses a session, closes it on credential changes and drains on shutdown',async()=>{
  const store=seed();let opens=0,closes=0,text=JSON.stringify(config);
  const provider=nativeAccountProvider(store,{load:async()=>text,
    open:async()=>{opens++;return {destroy:async()=>{closes++;}};}});
  const first=await provider.get(1),again=await provider.get(1);
  assert.equal(first.client,again.client);assert.equal(opens,1);
  text=JSON.stringify({...config,apiId:2});await provider.get(1);
  assert.equal(opens,2);assert.equal(closes,1);
  text=JSON.stringify({...config,enabled:false});assert.equal(await provider.get(1),null);assert.equal(closes,2);
  await provider.close();assert.equal(closes,2);store.close();
});
