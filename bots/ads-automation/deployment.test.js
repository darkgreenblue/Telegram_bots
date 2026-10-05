import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAdsDependencies,dependencyFingerprint } from '../../tools/install-ads-deps.mjs';

test('deployment preserves working native dependencies and retries failed installs',()=>{
  const directory=mkdtempSync(join(tmpdir(),'ads-install-'));
  try{
    writeFileSync(join(directory,'package.json'),'{}');writeFileSync(join(directory,'package-lock.json'),'{}');
    mkdirSync(join(directory,'node_modules'));
    let installs=0,healthy=true;
    const stamp=join(directory,'node_modules/.ads-dependencies');
    const options={probe:()=>healthy,install:()=>{installs++;},log:()=>{}};
    assert.equal(installAdsDependencies(directory,options),true);
    assert.equal(installAdsDependencies(directory,options),false);
    assert.equal(installs,1);
    // A code edit does not invalidate dependency identity.
    writeFileSync(join(directory,'index.js'),'// changed code');
    assert.equal(installAdsDependencies(directory,options),false);
    writeFileSync(join(directory,'package-lock.json'),'{"lockfileVersion":3}');
    assert.equal(installAdsDependencies(directory,options),true);
    assert.equal(installs,2);
    assert.equal(readFileSync(stamp,'utf8').trim(),dependencyFingerprint(directory));
    healthy=false;
    assert.throws(()=>installAdsDependencies(directory,options),/native dependency probe failed/);
    assert.equal(existsSync(stamp),false);
    healthy=true;
    assert.throws(()=>installAdsDependencies(directory,{...options,install:()=>{throw new Error('network failure');}}),/network failure/);
    assert.equal(existsSync(stamp),false);
    assert.equal(installAdsDependencies(directory,options),true);
    const changedRuntime={...process,version:'v99.0.0'};
    assert.notEqual(dependencyFingerprint(directory,changedRuntime),dependencyFingerprint(directory));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
