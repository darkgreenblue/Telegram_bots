import { readFileSync,writeFileSync,renameSync,mkdirSync,unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

// PID alone can be reused. Bind metadata to the kernel boot and process start.
export function processFingerprint(pid,{read=readFileSync}={}) {
  if(!Number.isSafeInteger(pid)||pid<=0)return null;
  try{
    const stat=read(`/proc/${pid}/stat`,'utf8'),end=stat.lastIndexOf(')');
    if(end<0)return null;
    const fields=stat.slice(end+2).trim().split(/\s+/);
    if(fields[0]==='Z'||!/^\d+$/.test(fields[19]||''))return null;
    const boot=read('/proc/sys/kernel/random/boot_id','utf8').trim();
    if(!/^[a-f0-9-]{36}$/i.test(boot))return null;
    return `${boot}:${pid}:${fields[19]}`;
  }catch{return null;}
}

export function startRuntimeProof(file,{version,username,languages,pid=process.pid,
  fingerprint=processFingerprint(pid),clock=()=>Date.now(),intervalMs=20000,logErr=()=>{}}) {
  const base={schema:1,version,username,languages,pid,fingerprint,launchedAt:clock()};
  let previousError=null;
  const beat=()=>{
    const temporary=`${file}.${pid}.tmp`;
    try{
      if(!fingerprint||!/^\d+\.\d+\.\d+$/.test(version)||!/^\w{5,32}$/.test(username||'')||
        !Array.isArray(languages)||!languages.length||languages.some(x=>!/^\w{2,8}$/.test(x)))
        throw new Error('runtime identity unavailable');
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(temporary,JSON.stringify({...base,at:clock()}),{mode:0o600});
      renameSync(temporary,file);previousError=null;return true;
    }catch(error){
      try{unlinkSync(temporary);}catch{}
      if(error.message!==previousError)logErr('runtime_proof.write_failed',error.message);
      previousError=error.message;return false;
    }
  };
  beat();const timer=setInterval(beat,intervalMs);timer.unref?.();
  return ()=>clearInterval(timer);
}
