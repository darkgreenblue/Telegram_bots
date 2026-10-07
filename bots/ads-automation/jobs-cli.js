import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { openStore,leaseJob } from './db.js';
import { SCHEMAS } from './brain.js';
import { submitBrainJob } from './brain-submit.js';
import { failBrainJob,recoverQuotaJobs } from './brain-recovery.js';

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
    const provider=input.provider||'codex';
    if(!['codex','claude'].includes(provider))throw new Error('invalid brain provider');
    const job=leaseJob(store.db,input.owner,Math.floor(Date.now()/1000),provider);
    if(job){
      out={id:job.id,kind:job.kind,input:job.input,schema:SCHEMAS[job.kind]};
      if(job.kind==='image_qa'){
        const bytes=await readFile(job.input.rawPath);
        if(bytes.length>10_000_000)throw new Error('image too large for QA');
        out.imageBase64=bytes.toString('base64');
      }
    }else out=null;
  }else if(command==='submit'){
    out=await submitBrainJob(store,input);
  }else if(command==='fail'){
    out=failBrainJob(store,input);
  }else if(command==='recover-quota'){
    out=recoverQuotaJobs(store);
  }else throw new Error('unknown command');
  process.stdout.write(JSON.stringify(out));
}catch(e){process.stderr.write(String(e.message));process.exitCode=1;}
finally{store.close();}
