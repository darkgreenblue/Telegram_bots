import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { AdsApi } from './api.js';

test('persisted idempotency prevents duplicate funding after worker restart',async()=>{
  const store=openStore(':memory:');let writes=0;
  const fetcher=async()=>{writes++;return {ok:true,status:200,json:async()=>({ok:true,result:{ad_id:10}})};};
  const a=new AdsApi({token:'test',store,fetcher,live:true});
  const first=await a.call('createAd',{title:'one'},'stable-op');
  const restarted=new AdsApi({token:'test',store,fetcher,live:true});
  const again=await restarted.call('createAd',{title:'one'},'stable-op');
  assert.deepEqual(first,again);assert.equal(writes,1);
  await assert.rejects(restarted.call('createAd',{title:'different'},'stable-op'),/changed request/);
  store.close();
});
test('unresolved operation older than provider retention is never blindly replayed',async()=>{
  const store=openStore(':memory:');let writes=0;
  store.db.prepare(`INSERT INTO operations(op_key,method,request_json,created_at) VALUES ('old','createAd','{}',unixepoch()-86400)`).run();
  const api=new AdsApi({token:'test',store,live:true,fetcher:async()=>{writes++;throw new Error('should not call');}});
  await assert.rejects(api.call('createAd',{},'old'),/reconcile/);assert.equal(writes,0);store.close();
});
