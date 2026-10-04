import { spawn } from 'node:child_process';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
export async function dashboardBridge(request){
  const cwd=resolve(here,'../dashboard');
  return await new Promise((resolveResult,reject)=>{
    const p=spawn(process.execPath,[resolve(here,'dashboard-bridge.js')],{cwd,env:process.env,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>{p.kill();reject(new Error('dashboard bridge timeout'));},120000);
    p.stdout.on('data',b=>{out+=b;if(out.length>100000)p.kill();});
    p.stderr.on('data',b=>{err+=b;if(err.length>2000)p.kill();});
    p.on('error',e=>{clearTimeout(timer);reject(e);});
    p.on('close',code=>{
      clearTimeout(timer);
      if(code!==0)return reject(new Error(`dashboard bridge failed: ${err.slice(-500)}`));
      try{resolveResult(JSON.parse(out));}catch(e){reject(e);}
    });
    p.stdin.end(JSON.stringify(request));
  });
}
