import { lstatSync,readFileSync,readdirSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processFingerprint } from '../tarot/runtime-proof.js';

const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../tarot/data');
export function readProductRuntime(project,{dataDirectory=directory,at=Date.now(),fingerprint=processFingerprint}={}) {
  const unknown=reason=>({verified:false,source:'product-runtime',reason});
  if(!/^tarot(?:-intl)?(?:@[a-z]{2})?$/.test(project.scope))return unknown('unsupported product scope');
  const match=/^https:\/\/t\.me\/([A-Za-z0-9_]{5,32})\/?(?:\?.*)?$/.exec(project.destination);
  if(!match)return unknown('product destination identity unavailable');
  let files;try{files=readdirSync(dataDirectory).filter(x=>/^runtime-(fa|en|ru|es|pt)\.json$/.test(x));}
  catch{return unknown('runtime metadata missing');}
  const verified=[];
  for(const name of files){
    try{
      const source=join(dataDirectory,name),stat=lstatSync(source);
      if(!stat.isFile()||(stat.mode&0o077)||stat.size>8192)continue;
      const proof=JSON.parse(readFileSync(source,'utf8'));
      if(proof.schema!==1||!/^\d+\.\d+\.\d+$/.test(proof.version)||
        typeof proof.username!=='string'||proof.username.toLowerCase()!==match[1].toLowerCase()||
        !Array.isArray(proof.languages)||!proof.languages.includes(project.language)||
        !Number.isFinite(proof.at)||!Number.isFinite(proof.launchedAt)||proof.launchedAt>proof.at||
        at-proof.at< -5000||at-proof.at>60000||
        typeof proof.fingerprint!=='string'||proof.fingerprint!==fingerprint(proof.pid))continue;
      verified.push({...proof,verified:true,source});
    }catch{/* Missing, malformed or stale metadata remains unknown. */}
  }
  return verified.length===1?verified[0]:unknown(verified.length?'ambiguous product process':'fresh matching runtime proof unavailable');
}

export function sameProductRuntime(captured,current) {
  return sameProductVersion(captured,current)&&
    typeof captured.fingerprint==='string'&&!!captured.fingerprint&&captured.fingerprint===current.fingerprint&&
    typeof current.fingerprint==='string';
}

export function sameProductVersion(captured,current){
  return captured?.verified===true&&current?.verified===true&&typeof captured.version==='string'&&!!captured.version&&
    captured.version===current.version&&typeof captured.username==='string'&&typeof current.username==='string'&&
    captured.username.toLowerCase()===current.username.toLowerCase();
}
