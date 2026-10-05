import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function dependencyFingerprint(directory,runtime=process){
  return createHash('sha256').update(readFileSync(resolve(directory,'package.json')))
    .update(readFileSync(resolve(directory,'package-lock.json')))
    .update(JSON.stringify({node:runtime.version,abi:runtime.versions.modules,
      platform:runtime.platform,arch:runtime.arch,omit:'dev'})).digest('hex');
}

export function probeDependencies(directory){
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import Database from 'better-sqlite3';
    import sharp from 'sharp';
    await import('@mtcute/node');
    const db=new Database(':memory:');
    if(db.prepare('SELECT 1 n').get().n!==1)throw new Error('SQLite probe failed');
    db.close();
    await sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer();
  `],{cwd:directory,timeout:30000,stdio:'pipe'});
  return result.status===0;
}

export function installAdsDependencies(directory,{probe=probeDependencies,install,log=console.log}={}){
  const fingerprint=dependencyFingerprint(directory),stamp=resolve(directory,'node_modules/.ads-dependencies');
  let previous='';try{previous=readFileSync(stamp,'utf8').trim();}catch{}
  if(previous===fingerprint&&probe(directory)){
    log(JSON.stringify({event:'ads.dependencies.reused',fingerprint}));return false;
  }
  // A failed install must never leave a valid stamp behind.
  rmSync(stamp,{force:true});
  log(JSON.stringify({event:'ads.dependencies.install',fingerprint}));
  if(install)install(directory);
  else{
    const result=spawnSync('npm',['ci','--prefix',directory,'--omit=dev','--no-audit','--no-fund'],
      {stdio:'inherit',timeout:25*60*1000});
    if(result.error||result.status!==0)throw new Error('Ads dependency installation failed; no success stamp recorded');
  }
  if(!probe(directory))throw new Error('Ads native dependency probe failed; no success stamp recorded');
  const temporary=`${stamp}.${process.pid}.tmp`;
  writeFileSync(temporary,`${fingerprint}\n`,{mode:0o600});renameSync(temporary,stamp);
  log(JSON.stringify({event:'ads.dependencies.verified',fingerprint}));return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{installAdsDependencies(resolve(process.argv[2]||'bots/ads-automation'));}
  catch(error){console.error(JSON.stringify({event:'ads.dependencies.error',message:error.message}));process.exitCode=1;}
}
