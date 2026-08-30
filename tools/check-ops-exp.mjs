#!/usr/bin/env node
// چکِ `tools/ops-exp.mjs` — تنها نقطه‌ی **نوشتنِ** Ops روی دیتابیسِ رباتِ زنده.
//
// چرا رفتاری است: این اسکریپت روی DBِ واقعیِ ربات اجرا می‌شود. یک اشتباه این‌جا به
// جدول‌های پول و کاربر می‌رسد، و هیچ تستِ ساختاری‌ای آن را نمی‌گیرد.
//
// اجرا: node tools/check-ops-exp.mjs
import fs from 'node:fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { runExp } from './ops-exp.mjs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const throws = (fn, m) => { try { fn(); ok(false, m); } catch { ok(true, m); } };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE payments (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL);
  CREATE TABLE experiments (key TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
    hypothesis TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'split',
    metric_kind TEXT NOT NULL DEFAULT 'rate', variants_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft', decision TEXT NOT NULL DEFAULT '',
    primary_metric TEXT NOT NULL DEFAULT '', guardrails_json TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER, stopped_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
`);
db.prepare('INSERT INTO users (telegram_id, balance) VALUES (?,?)').run(1, 42);
db.prepare('INSERT INTO payments (id, amount) VALUES (?,?)').run(1, 5000);
const V = [{ key: 'control', weight: 34 }, { key: 'feel', weight: 33 }, { key: 'exback', weight: 33 }];

console.log('\n▶ چرخه‌ی عمر');
ok(/ساخته شد/.test(runExp(db, { op: 'create', key: 'e1', variants: V })), 'ساختِ آزمایش (draft)');
ok(/دست نخورد/.test(runExp(db, { op: 'create', key: 'e1', variants: [{ key: 'control', weight: 1 }, { key: 'z', weight: 1 }] })),
  'ساختِ دوباره idempotent است و وزن‌ها را بازنویسی نمی‌کند');
ok(JSON.parse(db.prepare('SELECT variants_json v FROM experiments WHERE key=?').get('e1').v).length === 3,
  'وزن‌های آزمایشِ موجود واقعاً دست‌نخورده ماندند (وزن بعد از start فریز است)');
ok(/draft → running/.test(runExp(db, { op: 'status', key: 'e1', to: 'running' })), 'گذارِ draft → running');
ok(db.prepare('SELECT started_at s FROM experiments WHERE key=?').get('e1').s > 0,
  'started_at ست می‌شود (گاردِ دامنه‌ی love_slot از همین می‌خواند)');
const before = db.prepare('SELECT started_at s FROM experiments WHERE key=?').get('e1').s;
runExp(db, { op: 'status', key: 'e1', to: 'draining' });
ok(db.prepare('SELECT started_at s FROM experiments WHERE key=?').get('e1').s === before,
  'گذارِ بعدی started_at را جابه‌جا نمی‌کند (وگرنه دامنه‌ی کاربرانِ آزمایش عوض می‌شد)');

console.log('\n▶ گذارهای غیرمجاز (همان جدولِ داشبورد)');
throws(() => runExp(db, { op: 'status', key: 'e1', to: 'running' }), 'draining → running رد می‌شود');
throws(() => runExp(db, { op: 'status', key: 'e1', to: 'draft' }), 'draining → draft رد می‌شود');
throws(() => runExp(db, { op: 'status', key: 'ghost', to: 'running' }), 'آزمایشِ ناموجود رد می‌شود');

console.log('\n▶ ورودیِ خصمانه');
for (const bad of ['x; DROP TABLE users;--', "a' OR '1'='1", 'A_B', '', 'x'.repeat(41)]) {
  throws(() => runExp(db, { op: 'status', key: bad, to: 'running' }), `کلیدِ نامعتبر رد می‌شود: ${JSON.stringify(bad.slice(0, 24))}`);
}
throws(() => runExp(db, { op: 'create', key: 'e2', variants: [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }] }),
  'آزمایشِ بدونِ شاخه‌ی control رد می‌شود (بدونِ control رول‌بک وجود ندارد)');
throws(() => runExp(db, { op: 'create', key: 'e3', variants: [{ key: 'control', weight: 1 }] }), 'آزمایشِ تک‌شاخه رد می‌شود');
throws(() => runExp(db, { op: 'create', key: 'e4', variants: [{ key: 'control', weight: 0 }, { key: 'b', weight: 1 }] }), 'وزنِ صفر رد می‌شود');
throws(() => runExp(db, { op: 'nuke', key: 'e1' }), 'opِ ناشناخته رد می‌شود');

console.log('\n▶ دامنه‌ی نوشتن (مهم‌ترین بند)');
ok(db.prepare('SELECT balance b FROM users WHERE telegram_id=1').get().b === 42, '⭐ جدولِ users دست‌نخورده');
ok(db.prepare('SELECT amount a FROM payments WHERE id=1').get().a === 5000, '⭐ جدولِ payments دست‌نخورده');
ok(db.prepare("SELECT count(*) c FROM sqlite_master WHERE name IN ('users','payments')").get().c === 2,
  '⭐ هیچ جدولی حذف نشد (ورودی‌های تزریقی بی‌اثر بودند)');
ok(db.prepare('SELECT count(*) c FROM experiments').get().c === 1, 'فقط همان یک آزمایش ساخته شد');

console.log('\n▶ ops.yml واقعاً همین فایل را صدا می‌زند');
const YML = fs.readFileSync(new URL('../.github/workflows/ops.yml', import.meta.url), 'utf8');
ok(/node \.\.\/\.\.\/tools\/ops-exp\.mjs/.test(YML), 'اکشنِ exp اسکریپتِ فایلی را اجرا می‌کند، نه node -e درون‌خطی');
ok(/options: \[.*\bexp\b.*\]/.test(YML), 'اکشنِ exp در فهرستِ ورودی‌ها هست');
// درسِ گران: نسخه‌ی درون‌خطی به‌خاطرِ backtick و $ داخلِ رشته‌ی دابل‌کوتِ شل شکست.
const expCase = (YML.match(/\n\s+exp\)([\s\S]*?)\n\s+;;/) || ['', ''])[1];
ok(!/`/.test(expCase) && !/node -e/.test(expCase),
  'بدنه‌ی exp نه backtick دارد نه node -e (همان چیزی که یک بار شکست)');

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
