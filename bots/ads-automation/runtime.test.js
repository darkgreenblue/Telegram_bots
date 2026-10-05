import test from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime } from './runtime.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('work starts while launch is still polling, skips overlap and drains before closing',async()=>{
  const polling=deferred(),work=deferred();let tick,cycles=0,closed=false,cleared=false;
  const runtime=startRuntime({bot:{launch:async(_,ready)=>{ready();await polling.promise;},stop:()=>polling.resolve()},
    cycle:async()=>{cycles++;await work.promise;},close:()=>{closed=true;},
    setTimer:fn=>{tick=fn;return 1;},clearTimer:()=>{cleared=true;}});
  await flush();assert.equal(cycles,1);assert.equal(closed,false);
  tick();await flush();assert.equal(cycles,1);
  const stopping=runtime.stop();await flush();assert.equal(cleared,true);assert.equal(closed,false);
  work.resolve();await stopping;await runtime.done;assert.equal(closed,true);
  tick();await flush();assert.equal(cycles,1);
});

test('polling failure stops work, drains it, closes once and propagates failure',async()=>{
  const polling=deferred(),work=deferred();let tick,closes=0;const events=[];
  const runtime=startRuntime({bot:{launch:async(_,ready)=>{ready();await polling.promise;},stop:()=>{}},
    cycle:()=>work.promise,close:()=>{closes++;},log:event=>events.push(event),
    setTimer:fn=>{tick=fn;return 1;},clearTimer:()=>{tick=null;}});
  const failed=assert.rejects(runtime.done,/disconnected/);
  await flush();polling.reject(new Error('disconnected'));await flush();assert.equal(closes,0);assert.equal(tick,null);
  work.resolve();await failed;await runtime.stop();assert.equal(closes,1);assert.ok(events.includes('runtime.failed'));
});

test('failed initialization closes without starting any work',async()=>{
  let cycles=0,closed=false;
  const runtime=startRuntime({bot:{launch:async()=>{throw new Error('bad token');},stop:()=>{throw new Error('Bot is not running!');}},
    cycle:()=>{cycles++;},close:()=>{closed=true;}});
  await assert.rejects(runtime.done,/bad token/);assert.equal(cycles,0);assert.equal(closed,true);
});

test('stop during initialization waits for delayed polling creation without starting work',async()=>{
  const init=deferred(),webhook=deferred(),polling=deferred();let started=false,cycles=0,closed=false;
  const runtime=startRuntime({bot:{launch:async(_,ready)=>{await init.promise;ready();await webhook.promise;started=true;await polling.promise;},
    stop:()=>{if(!started)throw new Error('Bot is not running!');polling.resolve();}},
    cycle:()=>{cycles++;},close:()=>{closed=true;}});
  await flush();const stopped=runtime.stop();init.resolve();await flush();assert.equal(closed,false);
  webhook.resolve();await stopped;await runtime.done;
  assert.equal(cycles,0);assert.equal(closed,true);
});
