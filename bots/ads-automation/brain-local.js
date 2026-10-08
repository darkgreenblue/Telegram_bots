import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,readFile,rm,mkdir } from 'node:fs/promises';
import { tmpdir,hostname } from 'node:os';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promptFor } from './brain-prompts.js';
import { isProviderQuotaError } from './brain-errors.js';

const owner=`${hostname()}-${randomUUID().slice(0,12)}`;
const remote=process.env.ADS_SSH_TARGET;
const remoteRoot=process.env.ADS_REMOTE_ROOT;
const provider=process.env.ADS_BRAIN_PROVIDER||'codex';
if(!['codex','claude'].includes(provider))throw new Error('unknown brain provider');
if(!remote||!/^[\w.@-]+$/.test(remote)||!remoteRoot||!/^\/[\w./-]+$/.test(remoteRoot))throw new Error('ADS_SSH_TARGET and safe ADS_REMOTE_ROOT required');

function run(bin,args,stdin,cwd=process.cwd(),timeout=600000){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(bin,args,{cwd,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error(`${bin} timed out`));},timeout);
    child.stdout.on('data',x=>{stdout+=x;if(stdout.length>12_000_000)child.kill();});
    child.stderr.on('data',x=>{stderr+=x;if(stderr.length>2000)stderr=stderr.slice(-2000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code===0)return resolveRun(stdout);
      const quota=['codex','claude'].includes(bin)&&isProviderQuotaError(stderr);
      const error=new Error(`${quota?'Provider usage limit reached. ':''}${bin} exited ${code}: ${stderr.slice(-500)}`);
      error.providerQuota=quota;reject(error);
    });
    child.stdin.end(stdin);
  });
}
const remoteCommand=`cd ${remoteRoot}/bots/ads-automation && node jobs-cli.js`;
const ssh=async(cmd,body)=>JSON.parse(await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',remote,`${remoteCommand} ${cmd}`],JSON.stringify(body)));
const redact=value=>String(value).replace(/\b\d{7,}:[A-Za-z0-9_-]{20,}\b/g,'[redacted]');
const log=(event,details={})=>process.stdout.write(`${JSON.stringify({at:new Date().toISOString(),event,...details})}\n`);


async function execute(job){
  const folder=await mkdtemp(join(tmpdir(),'ads-brain-'));
  try{
    const schema=join(folder,'schema.json'),output=join(folder,'result.json');
    await writeFile(schema,JSON.stringify(job.schema));
    let image;
    if(job.imageBase64){image=join(folder,'banner.png');await writeFile(image,Buffer.from(job.imageBase64,'base64'));}
    if(provider==='codex'){
      const args=['exec','-s','read-only','--ephemeral','--output-schema',schema,'-o',output,'-'];
      if(['peer_review','competitive_intelligence'].includes(job.kind))args.splice(1,0,'--ignore-user-config','--skip-git-repo-check',
        '-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.apps=false');
      if(image)args.splice(args.length-1,0,'-i',image);
      await run('codex',args,promptFor(job),['peer_review','competitive_intelligence'].includes(job.kind)?folder:resolve('.'));
      const result=JSON.parse(await readFile(output,'utf8'));
      if(job.kind==='research'){
        for(const candidate of result.candidates||[])
          candidate.evidence_urls=candidate.evidence_urls.map(url=>new URL(url).href);
      }
      return result;
    }
    if(provider==='claude'){
      const args=['-p','--output-format','json','--json-schema',JSON.stringify(job.schema),
        '--allowedTools','WebSearch,WebFetch,Read'];
      if(['peer_review','competitive_intelligence'].includes(job.kind))args.push('--tools','','--strict-mcp-config','--safe-mode');
      // Claude headless accepts stdin; image QA currently uses Codex image input only.
      if(image)throw new Error('image QA needs Codex provider');
      const response=JSON.parse(await run('claude',args,promptFor(job),['peer_review','competitive_intelligence'].includes(job.kind)?folder:resolve('.')));
      return response.structured_output||JSON.parse(response.result);
    }
    throw new Error('unknown brain provider');
  }finally{await rm(folder,{recursive:true,force:true});}
}

async function once(){
  const job=await ssh('lease',{owner,provider});
  if(!job)return false;
  log('brain.job.leased',{jobId:job.id,kind:job.kind});
  let result;
  try{
    result=await execute(job);
    await ssh('submit',{owner,id:job.id,result});
    log('brain.job.completed',{jobId:job.id,kind:job.kind});
  }catch(e){
    // Preserve rejected output for review; do not silently lose research evidence.
    const folder=resolve('./data/brain-failures');await mkdir(folder,{recursive:true,mode:0o700});
    const artifact=join(folder,`job-${job.id}-${randomUUID()}.json`);
    await writeFile(artifact,JSON.stringify({jobId:job.id,kind:job.kind,error:redact(e.message),result},null,2),{mode:0o600});
    await ssh('fail',{owner,id:job.id,error:redact(e.message),provider,quota:e.providerQuota===true}).catch(()=>{});
    log(e.providerQuota?'brain.quota.wait':'brain.job.failed',{jobId:job.id,kind:job.kind,error:redact(e.message),artifact});
    throw e;
  }
  return true;
}

if(process.argv.includes('--watch')){
  for(;;){try{await once();}catch(e){log('brain.worker.error',{error:redact(e.message)});}await new Promise(r=>setTimeout(r,30000));}
}else{await once();}
