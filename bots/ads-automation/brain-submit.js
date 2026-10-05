import { row,completeJob } from './db.js';
import { applyBrainResult,validateBrainResult } from './brain.js';
import { assertCurrentBannerQa } from './banner-state.js';
import { prepareBanner } from './images.js';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';

export async function submitBrainJob(store,input,{bannerDirectory='./data/banners',prepare=prepareBanner}={}){
  const job=row(store.db,'jobs',Number(input.id));
  const value=input.result;
  if(!job||!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid job submission');
  validateBrainResult(job.kind,value);
  // A lost SSH response must not apply the same output or enqueue children twice.
  if(job.status==='done'){
    if(!isDeepStrictEqual(JSON.parse(job.output_json),value))throw new Error('completed job result differs');
    return {done:job.id};
  }
  if(job.lease_owner!==input.owner||job.status!=='leased'||job.lease_until<Math.floor(Date.now()/1000))
    throw new Error('invalid or expired job lease');
  let preparedBanner=null;
  if(job.kind==='image_qa'){
    const spec=JSON.parse(job.input_json);
    assertCurrentBannerQa(store.db,spec);
    if(value.approved&&value.text_matches&&value.language_matches&&value.issues.length===0)
      preparedBanner=await prepare(spec.rawPath,resolve(bannerDirectory,`creative-${spec.creativeId}-${job.id}.jpg`));
  }
  store.db.transaction(()=>{
    // Validate ownership again after asynchronous image work, before side effects.
    completeJob(store.db,job.id,input.owner,value);
    applyBrainResult(store,job,value,{preparedBanner});
  })();
  return {done:job.id};
}
