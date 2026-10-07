import test from 'node:test';
import assert from 'node:assert/strict';
import {adminAccess,bannerReply} from './admin-access.js';
import {openStore} from './db.js';
import {createAdminBot,sendAdminQueue} from './admin.js';

test('additional admins preserve owner and cannot route notifications to outsiders',()=>{
 const read=()=>JSON.stringify({schema:1,adminIds:[456,123,456],notificationId:456});
 assert.deepEqual(adminAccess(123,{read}),{adminIds:[123,456],notificationId:456});
 const logs=[];
 for(const c of [{schema:1,adminIds:[456],notificationId:789},{schema:1,adminIds:['456']},{schema:2,adminIds:[456]}])
  assert.deepEqual(adminAccess(123,{read:()=>JSON.stringify(c),log:(event,detail)=>logs.push({event,detail})}),
   {adminIds:[123],notificationId:123});
 assert.equal(logs.length,3);
 assert.deepEqual(adminAccess(123,{read:()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});}}),
  {adminIds:[123],notificationId:123});
});

test('both admins pass private-chat middleware; outsiders and groups are denied and actual actor is audited',async()=>{
 const store=openStore(':memory:');try{
  const commands=new Map();let middleware;
  const bot={use:f=>{middleware=f;},start:()=>{},command:(n,f)=>commands.set(n,f),on:()=>{},catch:()=>{}};
  createAdminBot(store,{token:'fixture',ownerId:123,adminIds:[456],bot});
  let allowed=0;
  for(const [id,type] of [[123,'private'],[456,'private'],[789,'private'],[456,'group']])
   await middleware({from:{id},chat:{type}},async()=>{allowed++;});
  assert.equal(allowed,2);
  await commands.get('pauseall')({from:{id:456},reply:async()=>{}});
  assert.equal(store.db.prepare("SELECT actor FROM audit WHERE action='projects.pauseall'").get().actor,'admin:456');
 }finally{store.close();}
});

test('chat-scoped banner delivery handles colliding message numbers, legacy replies and rerouting once',async()=>{
 const store=openStore(':memory:');try{
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
   VALUES(1,'x','x','x','https://t.me/samplebot','Global','en','fixture')`).run();
  for(const id of [1,2]){
   store.db.prepare("INSERT INTO creatives(id,project_id,angle,ad_text,status) VALUES(?,1,'love','Reading','needs_image')").run(id);
   store.db.prepare("INSERT INTO banner_requests(id,creative_id,prompt,message_id,status) VALUES(?,?,'prompt',?,'sent')").run(id,id,100+id);
  }
  assert.equal(bannerReply(store,{chatId:456,messageId:101,legacyOwnerId:123}),null);
  assert.equal(bannerReply(store,{chatId:123,messageId:101,legacyOwnerId:123}).id,1);
  let sends=0;const bot={telegram:{sendMessage:async()=>({message_id:100+(++sends)})}};
  await sendAdminQueue(store,bot,456,{legacyOwnerId:123});
  assert.equal(sends,2);
  assert.equal(bannerReply(store,{chatId:456,messageId:101,legacyOwnerId:123}).id,1);
  assert.equal(bannerReply(store,{chatId:789,messageId:101,legacyOwnerId:123}),null);
  await sendAdminQueue(store,bot,456,{legacyOwnerId:123});assert.equal(sends,2);
  assert.equal(store.db.prepare('SELECT message_id FROM banner_requests WHERE id=1').get().message_id,101);
  assert.equal(store.db.prepare('SELECT count(*) n FROM operations').get().n,0);
 }finally{store.close();}
});
