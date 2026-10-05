import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './db.js';
import { AdsApi } from './api.js';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('provider cooldown survives database reopen and prevents early calls across endpoints',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ads-api-'));let store;
  try{
    const file=join(directory,'api.db');store=openStore(file);let calls=0,time=1000;
    const fetcher=async()=>{calls++;return {status:429,headers:new Headers({'retry-after':'3600'})};};
    const api=new AdsApi({token:'test',store,fetcher,clock:()=>time,wait:async()=>assert.fail('must not block worker')});
    await assert.rejects(api.getAccount(),error=>error.retryAt===4600);
    store.close();store=openStore(file);
    const restarted=new AdsApi({token:'test',store,fetcher,clock:()=>time,live:true});
    await assert.rejects(restarted.call('createAd',{title:'one'},'new-op'),/cooling down/);
    assert.equal(calls,1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM operations').get().n,0);
    time=4600;
    await assert.rejects(restarted.getAccount(),error=>error.retryAt===8200);
    assert.equal(calls,2);
  }finally{store?.close();await rm(directory,{recursive:true,force:true});}
});

test('HTTP-date limits are respected and short transient retries remain bounded',async()=>{
  const store=openStore(':memory:');let calls=0;const waits=[];
  try{
    const api=new AdsApi({token:'test',store,clock:()=>1000,wait:async ms=>waits.push(ms),
      fetcher:async()=>++calls===1?{status:503,headers:new Headers({'retry-after':'2'})}:
        {ok:true,status:200,json:async()=>({ok:true,result:{balance:1}})}});
    assert.deepEqual(await api.getAccount(),{balance:1});assert.deepEqual(waits,[2000]);
    api.fetcher=async()=>({status:503,headers:new Headers({'retry-after':new Date(2000*1000).toUTCString()})});
    await assert.rejects(api.getAccount(),error=>error.retryAt===2000);
    await assert.rejects(api.getAccount(),/cooling down/);
    assert.deepEqual(waits,[2000]);
  }finally{store.close();}
});
test('unresolved operation older than provider retention is never blindly replayed',async()=>{
  const store=openStore(':memory:');let writes=0;
  store.db.prepare(`INSERT INTO operations(op_key,method,request_json,created_at) VALUES ('old','createAd','{}',unixepoch()-86400)`).run();
  const api=new AdsApi({token:'test',store,live:true,fetcher:async()=>{writes++;throw new Error('should not call');}});
  await assert.rejects(api.call('createAd',{},'old'),/reconcile/);assert.equal(writes,0);store.close();
});
