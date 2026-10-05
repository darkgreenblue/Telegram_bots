import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openStore,row,leaseJob } from './db.js';
import { submitBannerImage } from './banner-state.js';
import { submitBrainJob } from './brain-submit.js';
import { prepareBanner } from './images.js';

const approved={approved:true,text_matches:true,language_matches:true,issues:[]};
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'ads-submit-'));
  const store=openStore(join(directory,'isolated.db'));
  store.db.prepare(`INSERT INTO projects(id,slug,name,scope,destination,market,language,context)
    VALUES (1,'fixture','Fixture','tarot-intl@en','https://t.me/examplebot','Global','en','test')`).run();
  store.db.prepare(`INSERT INTO creatives(id,project_id,angle,ad_text,banner_text,status)
    VALUES (1,1,'test','Read','Correct text','needs_image')`).run();
  store.db.prepare(`INSERT INTO banner_requests(id,creative_id,prompt,status) VALUES (1,1,'test','sent')`).run();
  const raw=join(directory,'input.png');
  await sharp({create:{width:1280,height:720,channels:3,background:'#111111'}}).png().toFile(raw);
  const id=submitBannerImage(store,1,raw);leaseJob(store.db,'fixture-owner');
  return {directory,store,id,raw,options:{bannerDirectory:directory},
    close:async()=>{store.close();await rm(directory,{recursive:true,force:true});}};
}

test('prepared image survives interrupted submission; lost acknowledgement cannot duplicate application',async()=>{
  const f=await fixture();
  try{
    const input={id:f.id,owner:'fixture-owner',result:approved};
    await assert.rejects(submitBrainJob(f.store,input,{...f.options,prepare:async(...args)=>{
      await prepareBanner(...args);throw new Error('interrupted before commit');
    }}),/interrupted/);
    assert.equal(row(f.store.db,'jobs',f.id).status,'leased');
    assert.equal(row(f.store.db,'creatives',1).status,'awaiting_qa');
    const first=await submitBrainJob(f.store,input,f.options);
    assert.deepEqual(await submitBrainJob(f.store,{...input,result:{issues:[],language_matches:true,text_matches:true,approved:true}},f.options),first);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='job.applied'").get().n,1);
    const creative=row(f.store.db,'creatives',1);
    assert.equal(creative.status,'approved');
    assert.equal((await sharp(await readFile(creative.image_path)).metadata()).width,1280);
    await assert.rejects(submitBrainJob(f.store,{...input,result:{...approved,approved:false}},f.options),/result differs/);
  }finally{await f.close();}
});

test('stale and expired image jobs cannot prepare an artifact',async()=>{
  const f=await fixture();
  try{
    const input={id:f.id,owner:'fixture-owner',result:approved};
    const options={...f.options,prepare:async()=>assert.fail('must reject before preparation')};
    f.store.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(f.id);
    await assert.rejects(submitBrainJob(f.store,input,options),/expired/);
    f.store.db.prepare('UPDATE jobs SET lease_until=unixepoch()+900 WHERE id=?').run(f.id);
    f.store.db.prepare("INSERT INTO banner_requests(creative_id,revision,prompt) VALUES (1,2,'new')").run();
    await assert.rejects(submitBrainJob(f.store,input,options),/stale/);
  }finally{await f.close();}
});

test('rejected visual QA and replay enqueue exactly one correction job',async()=>{
  const f=await fixture();
  try{
    const input={id:f.id,owner:'fixture-owner',result:{approved:false,text_matches:false,language_matches:true,issues:['missing exact text']}};
    await submitBrainJob(f.store,input,f.options);await submitBrainJob(f.store,input,f.options);
    assert.equal(row(f.store.db,'creatives',1).status,'qa_failed');
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='image_revision'").get().n,1);
  }finally{await f.close();}
});

test('an existing mismatched prepared artifact is never overwritten',async()=>{
  const f=await fixture();
  try{
    const output=join(f.directory,'prepared.jpg');await prepareBanner(f.raw,output);
    const original=await readFile(output);
    await sharp({create:{width:1280,height:720,channels:3,background:'#ffffff'}}).png().toFile(f.raw);
    await assert.rejects(prepareBanner(f.raw,output),/artifact differs/);
    assert.deepEqual(await readFile(output),original);
  }finally{await f.close();}
});
