import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { openStore,leaseJob,row,completeJob } from './db.js';
import { applyBrainResult,SCHEMAS,validateBrainResult } from './brain.js';
import { prepareBanner } from './images.js';
import { resolve } from 'node:path';

const store=openStore();
const readInput=async()=>{
  let s='';for await(const chunk of process.stdin){s+=chunk;if(s.length>3_000_000)throw new Error('input too large');}
  return JSON.parse(s||'{}');
};
try{
  const command=process.argv[2],input=await readInput();
  let out;
  if(command==='lease'){
    if(!/^[\w.-]{8,100}$/.test(input.owner||''))throw new Error('invalid lease owner');
    const job=leaseJob(store.db,input.owner);
    if(job){
      out={id:job.id,kind:job.kind,input:job.input,schema:SCHEMAS[job.kind]};
      if(job.kind==='image_qa'){
        const bytes=await readFile(job.input.rawPath);
        if(bytes.length>10_000_000)throw new Error('image too large for QA');
        out.imageBase64=bytes.toString('base64');
      }
    }else out=null;
  }else if(command==='submit'){
    const job=row(store.db,'jobs',Number(input.id));
    if(!job||job.lease_owner!==input.owner||job.status!=='leased')throw new Error('invalid job lease');
    const value=input.result;
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid brain result');
    validateBrainResult(job.kind,value);
    let preparedBanner=null;
    if(job.kind==='image_qa'&&value.approved&&value.text_matches&&value.language_matches&&
      Array.isArray(value.issues)&&value.issues.length===0){
      const spec=JSON.parse(job.input_json);
      preparedBanner=await prepareBanner(spec.rawPath,resolve('./data/banners',`creative-${spec.creativeId}-${job.id}.jpg`));
    }
    store.db.transaction(()=>{
      applyBrainResult(store,job,value,{preparedBanner});
      completeJob(store.db,job.id,input.owner,value);
    })();
    out={done:job.id};
  }else if(command==='fail'){
    const job=row(store.db,'jobs',Number(input.id));
    if(!job||job.lease_owner!==input.owner||job.status!=='leased')throw new Error('invalid job lease');
    store.db.prepare(`UPDATE jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'error' END,
      error=?,lease_owner=NULL,lease_until=NULL WHERE id=?`).run(String(input.error||'worker error').slice(0,500),job.id);
    out={failed:job.id};
  }else throw new Error('unknown command');
  process.stdout.write(JSON.stringify(out));
}catch(e){process.stderr.write(String(e.message));process.exitCode=1;}
finally{store.close();}
