#!/usr/bin/env node
// تستِ رفتاریِ shared/ab.js روی SQLite واقعیِ Node، بدون better-sqlite3. این شیم فقط
// دو متد کمکی better-sqlite3 را می‌سازد؛ خودِ SQL، migration، transaction و شمارش‌ها
// روی SQLite اجرا می‌شوند.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureAnalytics } from '../shared/analytics.js';
import {
  ensureAb, reserveStratifiedVariant, exposeStratifiedVariant, releaseStratifiedReservation,
} from '../shared/ab.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.pragma = () => {}; // ensureAnalytics فقط busy_timeout را تنظیم می‌کند.
  db.transaction = (fn) => {
    const run = (...args) => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(...args); db.exec('COMMIT'); return result; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    };
    run.immediate = run;
    return run;
  };
  db.exec('CREATE TABLE users (telegram_id INTEGER PRIMARY KEY)');
  ensureAnalytics(db);
  ensureAb(db);
  return db;
}

const EXP = 'money_cta_style_v1';
const variants = JSON.stringify([{ key: 'control', weight: 50 }, { key: 'colored', weight: 50 }]);
const start = (db, status = 'running') => db.prepare(
  'INSERT INTO experiments (key, status, variants_json) VALUES (?,?,?)',
).run(EXP, status, variants);
const countBy = (db, table, stratum) => new Map(db.prepare(
  `SELECT variant, COUNT(*) c FROM ${table} WHERE experiment_key=? AND stratum=? GROUP BY variant`,
).all(EXP, stratum).map(r => [r.variant, Number(r.c)]));
const delta = (m) => Math.abs((m.get('control') || 0) - (m.get('colored') || 0));

console.log('\n🧪 تخصیص لایه‌بندی‌شده روی SQLite واقعی\n');
const db = freshDb();
start(db);
for (const stratum of ['price:price_ladder_p3:control', 'price:price_ladder_p3:bulk']) {
  for (let i = 0; i < 101; i++) {
    const uid = (stratum.endsWith('bulk') ? 20_000 : 10_000) + i;
    const reserved = reserveStratifiedVariant(db, uid, EXP, stratum);
    const exposed = exposeStratifiedVariant(db, uid, EXP, stratum);
    assert.equal(exposed, reserved, 'رنگِ رندرشده و exposure باید یکسان باشند');
    assert.equal(reserveStratifiedVariant(db, uid, EXP, 'wrong:later'), reserved,
      'یک کاربر پس از exposure نباید با تغییر لایه رنگ عوض کند');
  }
  const assigned = countBy(db, 'ab_assignments', stratum);
  const exposed = countBy(db, 'ab_exposures', stratum);
  assert.ok(delta(assigned) <= 1, `assignment در ${stratum} متعادل نیست`);
  assert.ok(delta(exposed) <= 1, `exposure در ${stratum} متعادل نیست`);
  assert.deepEqual([...assigned].sort(), [...exposed].sort(), 'فقط نمایشِ موفق exposure شده است');
  console.log(`  ✅ ${stratum}: control=${assigned.get('control') || 0}, colored=${assigned.get('colored') || 0}`);
}

const heldUser = 99_999;
reserveStratifiedVariant(db, heldUser, EXP, 'price:price_ladder_p3:control');
assert.equal(db.prepare('SELECT COUNT(*) c FROM ab_assignments WHERE user_id=?').get(heldUser).c, 1,
  'reservation قبل از نمایش ثبت می‌شود');
releaseStratifiedReservation(db, heldUser, EXP);
assert.equal(db.prepare('SELECT COUNT(*) c FROM ab_assignments WHERE user_id=?').get(heldUser).c, 0,
  'شکست ارسال reservation دیده‌نشده را آزاد می‌کند');
db.close();

const stopped = freshDb(); start(stopped, 'stopped');
assert.equal(reserveStratifiedVariant(stopped, 1, EXP, 'price:price_ladder_p3:control'), 'control',
  'kill switch برای کاربر تازه control می‌دهد');
assert.equal(stopped.prepare('SELECT COUNT(*) c FROM ab_assignments').get().c, 0,
  'kill switch هیچ assignment تازه‌ای نمی‌نویسد');
stopped.close();
console.log('\n✅ توازن، sticky بودن، exposure واقعی و kill switch برقرارند');
