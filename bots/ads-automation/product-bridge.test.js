import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { ensureAnalytics,captureStart } from '../../shared/analytics.js';

test('real dashboard bridge tracks a new and returning start and a delayed payment in isolated product databases',()=>{
  const directory=mkdtempSync(join(tmpdir(),'ads-product-bridge-'));
  const data=join(directory,'tarot');mkdirSync(data);
  const script=fileURLToPath(new URL('./dashboard-bridge.js',import.meta.url));
  // The Ads CI job installs Ads dependencies only. Run the actual dashboard
  // modules with this job's SQLite binding, without changing production paths.
  const sqlite=pathToFileURL(createRequire(import.meta.url).resolve('better-sqlite3')).href;
  const loader='data:text/javascript,'+encodeURIComponent(`export async function resolve(specifier,context,next){
    return next(specifier==='better-sqlite3'?${JSON.stringify(sqlite)}:specifier,context);
  }`);
  const bootstrap='data:text/javascript,'+encodeURIComponent(`import {register} from 'node:module';register(${JSON.stringify(loader)});`);
  const env={...process.env,TAROT_DB_DIR:data,DASH_CACHE_DIR:join(directory,'cache')};
  const bridge=input=>{
    const result=spawnSync(process.execPath,['--import',bootstrap,script],{cwd:directory,env,input:JSON.stringify(input),encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  };
  let db;
  try{
    db=new Database(join(data,'bot-en.db'));
    db.exec(`CREATE TABLE users(telegram_id INTEGER PRIMARY KEY,name TEXT DEFAULT '',created_at INTEGER DEFAULT 0);
      CREATE TABLE payments(id INTEGER PRIMARY KEY,user_id INTEGER,amount INTEGER,status TEXT,created_at INTEGER DEFAULT 0,approved_at INTEGER);`);
    ensureAnalytics(db);
    const platform=join(directory,'data');mkdirSync(platform);
    const settings=new Database(join(platform,'platform.db'));
    settings.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    settings.prepare('INSERT INTO settings VALUES (?,?)').run('username:tarot-intl@en','fixture_bot');settings.close();
    const request={action:'campaign',scope:'tarot-intl@en',marker:'ads-experiment-1',surface:'search',title:'isolated fixture'};
    const campaign=bridge(request);assert.deepEqual(bridge(request),campaign);
    assert.equal(campaign.url,`https://t.me/fixture_bot?start=c_${campaign.code}`);
    db.prepare('INSERT INTO users(telegram_id) VALUES (900001),(900002)').run();
    captureStart(db,900001,`c_${campaign.code}`,true,'fixture-v1');
    captureStart(db,900002,'',true,'fixture-v1');
    captureStart(db,900002,`c_${campaign.code}`,false,'fixture-v1');
    const stats=()=>bridge({action:'stats',scope:'tarot-intl@en',code:campaign.code});
    const before=stats();assert.equal(before.starts,2);assert.equal(before.newUsers,1);assert.equal(before.returning,1);
    assert.equal(before.revenue,0);assert.equal(before.revenueUnit,'star');
    db.prepare("INSERT INTO payments(user_id,amount,status) VALUES (900001,40,'approved'),(900001,99,'pending'),(900002,70,'approved')").run();
    const paid=stats();assert.equal(paid.payers,1);assert.equal(paid.revenue,40);
    // Returning paid organic user must not be reassigned to this acquisition cohort.
    assert.equal(db.prepare('SELECT first_source FROM users WHERE telegram_id=900002').get().first_source,'organic');
    db.prepare("UPDATE payments SET status='refunded' WHERE user_id=900001 AND status='approved'").run();
    assert.equal(stats().revenue,0);
    // This verifies exclusion by payment status, not per-campaign refund totals.
    const acquired=db.prepare("SELECT MIN(created_at) at FROM events WHERE user_id=900001 AND event='start'").get().at;
    db.prepare("UPDATE payments SET status='approved',approved_at=? WHERE user_id=900001 AND status='refunded'").run(acquired+2*86400);
    db.prepare("INSERT INTO payments(user_id,amount,status,approved_at) VALUES(900001,15,'approved',?)").run(acquired+9*86400);
    const cohorts=bridge({action:'stats_all',scope:'tarot-intl@en',cohortCodes:[campaign.code],at:acquired+40*86400});
    const age=cohorts.cohorts.instances[0].byCode[campaign.code];
    assert.equal(age[7].eligibleUsers,1);assert.equal(age[7].revenue,40);
    assert.equal(age[30].revenue,55);assert.equal(age[7].refunds,null);
    assert.equal(age[7].versions[0].productVersion,'fixture-v1');
  }finally{db?.close();rmSync(directory,{recursive:true,force:true});}
});
