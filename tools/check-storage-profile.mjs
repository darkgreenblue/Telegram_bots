import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { storageProfile, verifyStorageIdentity, retainStorageLanguage } from '../bots/tarot/storage-profile.js';
const require = createRequire(new URL('../bots/tarot/index.js', import.meta.url));
const Database = require('better-sqlite3');
const dir = mkdtempSync(join(tmpdir(), 'tarot-handover-'));
const profile = storageProfile({ LOCALE: 'en', STORAGE_LOCALE: 'pt', LANGS: 'en,es,ru,pt' });
assert.equal(profile.storage, 'pt'); assert.equal(profile.locale, 'en');
assert.equal(storageProfile({ LOCALE: 'fa' }).handover, false);
for (const env of [{LOCALE:'fa',STORAGE_LOCALE:'pt'}, {LOCALE:'en',STORAGE_LOCALE:'../../secret'},
  {LOCALE:'en',STORAGE_LOCALE:'pt'}, {LOCALE:'pt',STORAGE_LOCALE:'en'}])
  assert.throws(() => storageProfile(env));
const response = username => async () => ({ json: async () => ({ ok: true, result: { username } }) });
assert.equal((await verifyStorageIdentity(profile, 'not-a-token', { fetcher: response('TAROT_PT_BOT') })).username, 'TAROT_PT_BOT');
await assert.rejects(() => verifyStorageIdentity(profile, 'not-a-token', { fetcher: response('TAROOT_RU_BOT') }), /mismatch/);
let calls=0;
await assert.rejects(() => verifyStorageIdentity(profile, 'not-a-token', { fetcher: async () => {
  calls++; return { status: 429, json: async () => ({ ok: false }) };
} })); assert.equal(calls, 1, 'no blind flood-limit retries');
const db = new Database(join(dir, 'bot-pt.db'));
try {
  db.exec(`CREATE TABLE users(telegram_id INTEGER PRIMARY KEY,lang TEXT,balance REAL,state TEXT,session_json TEXT);
    CREATE TABLE readings(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE payments(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE admin_actions(id INTEGER PRIMARY KEY,done_at INTEGER);
    INSERT INTO users VALUES(1,'',3,'choose_spread','{"messageId":99}'),(2,'es',2,'idle','{}');
    INSERT INTO readings VALUES(1,'delivered'); INSERT INTO payments VALUES(1,'canceled');`);
  const original = db.prepare('SELECT telegram_id,balance,state,session_json FROM users ORDER BY telegram_id').all();
  db.exec("INSERT INTO payments VALUES(2,'pending')");
  await assert.rejects(() => retainStorageLanguage(db, profile, {directory:dir}), /drained/);
  assert.equal(db.prepare('SELECT lang FROM users WHERE telegram_id=1').get().lang, '');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM storage_profile_migrations').get().n, 0);
  db.exec("UPDATE payments SET status='canceled' WHERE id=2");
  const result = await retainStorageLanguage(db, profile, {directory:dir});
  assert.equal(result.changedUsers, 1); assert.equal(statSync(result.backup).mode & 0o077, 0);
  assert.deepEqual(db.prepare('SELECT telegram_id,balance,state,session_json FROM users ORDER BY telegram_id').all(), original);
  assert.equal(db.prepare('SELECT lang FROM users WHERE telegram_id=1').get().lang, 'pt');
  assert.equal(db.prepare('SELECT lang FROM users WHERE telegram_id=2').get().lang, 'es');
  const archived = new Database(result.backup, {readonly:true});
  assert.equal(archived.prepare('SELECT lang FROM users WHERE telegram_id=1').get().lang, ''); archived.close();
  db.exec("INSERT INTO users VALUES(3,'',0,'new','{}')");
  assert.equal((await retainStorageLanguage(db, profile, {directory:dir})).applied, false);
  assert.equal(db.prepare('SELECT lang FROM users WHERE telegram_id=3').get().lang, '', 'new users retain the language picker');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM readings').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n, 2);
  console.log('PASS storage handover: identity, rate limit, wallets/history, backup, language and replay');
} finally { db.close(); rmSync(dir, {recursive:true,force:true}); }

const deploy=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
assert.ok(deploy.indexOf('node tools/prepare-tarot-handover.mjs') < deploy.indexOf('deploy_bot "tarot-$lang"'));
assert.ok(deploy.indexOf('pm2 delete tarot-ru') > deploy.indexOf('if [ -n "$HB_BAD" ]'));
assert.ok(!readFileSync(new URL('../ecosystem.config.cjs',import.meta.url),'utf8').includes("name: 'tarot-ru'"));
