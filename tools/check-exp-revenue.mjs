#!/usr/bin/env node
// 💰 چکِ ستون‌های درآمدِ per variant در صفحه‌ی نتایجِ آزمایش (داشبورد، «تست‌ها»).
//
// خواسته‌ی مالک (۱۴۰۵/۰۷/۰۴): کنارِ نرخ تبدیلِ هر گروه، مجموعِ مبلغی که آن گروه پرداخت
// کرده هم دیده شود، برای **همه‌ی** آزمایش‌ها. این چک رفتاری است: یک SQLiteِ واقعی با
// ab_exposures/payments/events می‌سازد، صفحه را واقعاً رندر می‌کند و عددها را با محاسبه‌ی
// دستیِ فیکسچر مقایسه می‌کند. سه تله‌ی واقعیِ تعریفِ درآمد هرکدام یک ادعا دارند، و هر
// ادعای منفی یک عددِ «غلطِ مشخص» را می‌گردد تا اگر گارد برداشته شد، قرمز شود:
//   ۱) پرداختِ قبل از exposure (مالِ قبل از دیدنِ treatment است)
//   ۲) پرداختِ غیرتأییدشده (waiting_review/pending پول نیست)
//   ۳) حساب‌های تستیِ ادمین (هم در صورت، هم در مخرجِ per exposure)
//
// اجرا: node tools/check-exp-revenue.mjs
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const fa = (n) => Number(n).toLocaleString('fa-IR');

const root = mkdtempSync(path.join(tmpdir(), 'exprevenue-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const now = Math.floor(Date.now() / 1000);
const KEY = 'price_test', VKEY = 'value_test', ZKEY = 'zero_test';
const ADMIN = 100257975; // در testUsersِ رجیستریِ tarot

{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE experiments (
      key TEXT PRIMARY KEY, name TEXT DEFAULT '', hypothesis TEXT DEFAULT '',
      mode TEXT DEFAULT 'split', metric_kind TEXT DEFAULT 'rate',
      variants_json TEXT NOT NULL, status TEXT DEFAULT 'running', decision TEXT DEFAULT '',
      primary_metric TEXT DEFAULT '', guardrails_json TEXT DEFAULT '[]',
      started_at INTEGER, stopped_at INTEGER, created_at INTEGER
    );
    CREATE TABLE ab_exposures (
      experiment_key TEXT NOT NULL, user_id INTEGER NOT NULL, variant TEXT NOT NULL,
      stratum TEXT DEFAULT '', created_at INTEGER NOT NULL,
      PRIMARY KEY (experiment_key, user_id)
    );
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT,
      props TEXT DEFAULT '{}', created_at INTEGER);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
  `);
  const mkExp = db.prepare(`INSERT INTO experiments (key, name, mode, metric_kind, variants_json, status, primary_metric, started_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const vj = JSON.stringify([{ key: 'control', weight: 50 }, { key: 'b', weight: 50 }]);
  mkExp.run(KEY, 'قیمت', 'split', 'rate', vj, 'running', 'payment_approved', now - 10000);
  mkExp.run(VKEY, 'مقداری', 'split', 'value', vj, 'running', 'product_delivered', now - 10000);
  mkExp.run(ZKEY, 'بی‌پرداخت', 'split', 'rate', vj, 'running', 'payment_approved', now - 10000);

  const expose = db.prepare('INSERT INTO ab_exposures (experiment_key,user_id,variant,created_at) VALUES (?,?,?,?)');
  const pay = db.prepare('INSERT INTO payments (user_id,amount,status,created_at) VALUES (?,?,?,?)');
  const t0 = now - 5000;
  for (const k of [KEY, VKEY]) {
    for (const u of [1, 2, 3, 4]) expose.run(k, u, 'control', t0);
    for (const u of [5, 6, 7, ADMIN]) expose.run(k, u, 'b', t0);
  }
  for (const u of [11, 12]) expose.run(ZKEY, u, 'control', t0);
  for (const u of [13]) expose.run(ZKEY, u, 'b', t0);

  // control: ۱۵k + ۱۵k شمرده می‌شوند ⟵ ۳۰٬۰۰۰ از ۴ exposure ⟵ ۷٬۵۰۰ per exposure
  pay.run(1, 15000, 'approved', t0 + 10);
  pay.run(2, 15000, 'approved', t0 + 20);
  pay.run(2, 30000, 'approved', t0 - 100);        // ✗ قبل از exposure
  pay.run(3, 60000, 'waiting_review', t0 + 30);   // ✗ تأییدنشده
  // b: ۲۵k + ۲۵k + ۶۰k ⟵ ۱۱۰٬۰۰۰ از ۳ exposure (ادمین حذف) ⟵ ۳۶٬۶۶۷ per exposure
  pay.run(5, 25000, 'approved', t0 + 10);
  pay.run(6, 25000, 'approved', t0 + 10);
  pay.run(6, 60000, 'approved', t0 + 40);
  pay.run(ADMIN, 150000, 'approved', t0 + 10);    // ✗ حسابِ تستی
  db.close();
}

process.env.TAROT_DB_DIR = dataDir;
process.chdir(root); // lib/platform.js یک ./data/platform.db نسبی می‌سازد

const base = path.resolve(import.meta.dirname, '../bots/dashboard');
const { experimentViewBody } = await import(`file://${base}/routes/experiments.js`);
const { chanceToWinMean } = await import(`file://${base}/lib/stats.js`);
const view = (k) => experimentViewBody(new URL(`http://x/experiments/view?inst=${encodeURIComponent('tarot:bot-fa.db')}&key=${k}`));

console.log('\n💰 ستون‌های درآمدِ آزمایش\n');
const html = view(KEY);

ok(html.includes('مجموع پرداخت') && html.includes('درآمد per exposure'), 'سرستون‌های درآمد کنارِ نرخ تبدیل رندر شده‌اند');
ok(html.includes(`${fa(30000)} تومان`), 'مجموعِ control درست است (۳۰٬۰۰۰ تومان)');
ok(html.includes(`${fa(110000)} تومان`), 'مجموعِ b درست است (۱۱۰٬۰۰۰ تومان)');
ok(html.includes(`${fa(7500)} تومان`), 'درآمدِ per exposureِ control درست است (۷٬۵۰۰ = ۳۰٬۰۰۰ ÷ ۴)');
ok(html.includes(`${fa(36667)} تومان`), 'درآمدِ per exposureِ b درست است (۳۶٬۶۶۷ = ۱۱۰٬۰۰۰ ÷ ۳، مخرج بدونِ ادمین)');
ok(html.includes('+388.9٪'), 'liftِ درآمد نسبت به control درست است (+388.9٪)');
ok(html.includes(`(${fa(2)} نفر، ${fa(2)} پرداخت)`), 'تعدادِ پرداخت‌کننده و پرداختِ control چاپ می‌شود');
ok(html.includes(`(${fa(2)} نفر، ${fa(3)} پرداخت)`), 'تعدادِ پرداخت‌کننده و پرداختِ b چاپ می‌شود');

// کنترل‌های منفی: هر تله یک عددِ «غلطِ» مشخص می‌سازد که نباید روی صفحه باشد.
ok(!html.includes(`${fa(60000)} تومان`), 'پرداختِ قبل از exposure شمرده نمی‌شود (۶۰٬۰۰۰ برای control نیست)');
ok(!html.includes(`${fa(90000)} تومان`), 'پرداختِ waiting_review شمرده نمی‌شود (۹۰٬۰۰۰ برای control نیست)');
ok(!html.includes(`${fa(260000)} تومان`), 'پرداختِ حسابِ تستی شمرده نمی‌شود (۲۶۰٬۰۰۰ برای b نیست)');
ok(!html.includes(`${fa(27500)} تومان`), 'مخرجِ per exposure هم بدونِ حسابِ تستی است (۲۷٬۵۰۰ = ۱۱۰k÷۴ نیست)');

// همه‌ی آزمایش‌ها، نه فقط rate
const vhtml = view(VKEY);
ok(vhtml.includes('مجموع پرداخت') && vhtml.includes(`${fa(110000)} تومان`), 'آزمایشِ مقداری (value) هم ستون‌های درآمد را دارد');

// بدونِ پرداخت در دو طرف: شانسِ برد نباید یک عددِ قطعیِ کاذب بدهد
const zhtml = view(ZKEY);
ok(zhtml.includes(`${fa(0)} تومان`), 'آزمایشِ بی‌پرداخت صفر نشان می‌دهد، نه خطا');
ok(!/شانس برد درآمد[\s\S]*?badge[^>]*>(100|0)\.0٪/.test(zhtml.split('مجموع پرداخت').slice(1).join('')), 'بی‌پرداخت‌ها «شانس برد درآمد»ِ قطعیِ کاذب نمی‌گیرند');

// stats: تقریبِ نرمال رفتارِ درستی دارد
const eq = chanceToWinMean({ n: 10, mean: 5, se: 1 }, { n: 10, mean: 5, se: 1 });
const up = chanceToWinMean({ n: 10, mean: 7, se: 1 }, { n: 10, mean: 5, se: 1 });
ok(Math.abs(eq - 0.5) < 1e-6, 'chanceToWinMean: میانگینِ برابر ⟵ ۵۰٪');
ok(Math.abs(up - 0.9214) < 0.001, 'chanceToWinMean: اختلافِ ۲ با SEِ ترکیبیِ √2 ⟵ Φ(1.414)≈92.1٪');
ok(chanceToWinMean({ n: 0 }, { n: 5, mean: 1, se: 1 }) === null, 'chanceToWinMean: بدونِ نمونه null');

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
