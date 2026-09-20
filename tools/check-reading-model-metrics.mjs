#!/usr/bin/env node
// 📐 چکِ کارتِ متریک‌های تکمیلیِ آزمایشِ مدلِ خوانش (`reading_model_ds`) در داشبورد.
//
// بندِ «⏳ چیزی که عمداً هنوز انجام نشد» در bots/tarot/CLAUDE.md می‌گفت رضایت/تأخیر/
// P90/برگشتِ فالِ دوم روی صفحه‌ی «تست‌ها» دیده نمی‌شوند چون rate/value معمولی این سه
// شکل (میانگینِ یک prop، صدک، شمارشِ آستانه‌دار) را نمی‌فهمند. این چک رفتاری است:
// یک دیتابیسِ واقعیِ SQLite با ab_exposures و events می‌سازد، صفحه‌ی آزمایش را واقعاً
// رندر می‌کند، و عددهای چاپ‌شده را با محاسبه‌ی مستقلِ خودش (نه کدِ کپی‌شده) مقایسه می‌کند.
//
// اجرا: node tools/check-reading-model-metrics.mjs
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const root = mkdtempSync(path.join(tmpdir(), 'readingmetrics-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const now = Math.floor(Date.now() / 1000);
const KEY = 'reading_model_ds';

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
  `);
  db.prepare(`INSERT INTO experiments (key, name, mode, metric_kind, variants_json, status, primary_metric, guardrails_json, started_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    KEY, 'مدلِ خوانش', 'split', 'rate',
    JSON.stringify([{ key: 'control', weight: 50 }, { key: 'ds', weight: 50 }]),
    'running', 'payment_approved', JSON.stringify(['refund', 'payment_rejected']), now - 10000);

  const expose = db.prepare('INSERT INTO ab_exposures (experiment_key,user_id,variant,created_at) VALUES (?,?,?,?)');
  const ev = db.prepare('INSERT INTO events (user_id,event,props,created_at) VALUES (?,?,?,?)');

  // control: ۳ کاربر — رضایت [4,5]، تأخیر [8000,12000]ms، یکی برمی‌گردد برای فالِ دوم
  const controlUsers = [101, 102, 103];
  const controlScores = [4, 5];
  const controlWaits = [8000, 12000];
  for (const [i, uid] of controlUsers.entries()) {
    const t0 = now - 5000;
    expose.run(KEY, uid, 'control', t0);
    if (i < controlScores.length) ev.run(uid, 'feedback', JSON.stringify({ score: controlScores[i], scale: 5 }), t0 + 100);
    if (i < controlWaits.length) ev.run(uid, 'reading_wait', JSON.stringify({ reading_id: 900 + i, arm: 'control', ms: controlWaits[i] }), t0 + 50);
    ev.run(uid, 'product_delivered', '{}', t0 + 10);
    if (uid === 101) ev.run(uid, 'product_delivered', '{}', t0 + 200); // برگشت به فالِ دوم
  }

  // ds: ۲ کاربر — رضایت [2]، تأخیر [30000, 60000]ms (کندتر)، هیچ‌کس برنمی‌گردد
  const dsUsers = [201, 202];
  for (const [i, uid] of dsUsers.entries()) {
    const t0 = now - 5000;
    expose.run(KEY, uid, 'ds', t0);
    if (i === 0) ev.run(uid, 'feedback', JSON.stringify({ score: 2, scale: 5 }), t0 + 100);
    ev.run(uid, 'reading_wait', JSON.stringify({ reading_id: 950 + i, arm: 'ds', ms: [30000, 60000][i] }), t0 + 50);
    ev.run(uid, 'product_delivered', '{}', t0 + 10);
  }

  // exposure قبل از exposure ثبت نمی‌شود: رویدادِ قبل از created_at نباید شمرده شود.
  expose.run(KEY, 999, 'control', now);
  ev.run(999, 'feedback', JSON.stringify({ score: 1, scale: 5 }), now - 999999); // خیلی قبل‌تر
  db.close();
}

process.env.TAROT_DB_DIR = dataDir;
process.chdir(root); // lib/platform.js یک ./data/platform.db نسبی می‌سازد

const base = path.resolve(import.meta.dirname, '../bots/dashboard');
const { experimentViewBody } = await import(`file://${base}/routes/experiments.js`);

const U = (qs) => new URL(`http://x/experiments/view?${qs}`);
const html = experimentViewBody(U(`inst=${encodeURIComponent('tarot:bot-fa.db')}&key=${KEY}`));

console.log('\n📐 کارتِ متریک‌های تکمیلیِ reading_model_ds\n');

ok(html.includes('متریک‌های تکمیلی'), 'کارتِ تازه واقعاً رندر شده');

// رضایت: control میانگینِ (4+5)/2=4.50، n=2 · ds تک‌نمونه‌ی 2.00، n=1
ok(/4\.50\/۵/.test(html) || html.includes('4.50/۵'), 'میانگینِ رضایتِ control درست حساب شده (4.50)');
ok(html.includes('2.00/۵'), 'میانگینِ رضایتِ ds درست حساب شده (2.00)');
ok(/n=۲/.test(html), 'تعدادِ بازخوردِ control (n=۲) چاپ می‌شود');

// تأخیر: control میانگینِ (8000+12000)/2=10000ms=10.0s؛ ds میانگینِ (30000+60000)/2=45000ms=45.0s
ok(html.includes('10.0 ثانیه'), 'میانگینِ تأخیرِ control به ثانیه و با یک رقمِ اعشار است (10.0)');
ok(html.includes('45.0 ثانیه'), 'میانگینِ تأخیرِ ds درست حساب شده (45.0)');

// P90 با دو نمونه: sort=[8000,12000]، idx=ceil(0.9*2)-1=1 ⟹ 12000ms=12.0s
ok(html.includes('12.0 ثانیه'), 'P90ِ تأخیرِ control با فرمولِ صدکِ درست حساب شده (12.0)');
// ds: sort=[30000,60000] ⟹ idx=1 ⟹ 60.0s
ok(html.includes('60.0 ثانیه'), 'P90ِ تأخیرِ ds با همان فرمول حساب شده (60.0)');

// برگشت به فالِ دوم: control ۱ از ۳ (۳۳.۳٪)، ds صفر از ۲ (۰.۰٪)
ok(html.includes('33.3٪'), 'نرخِ برگشتِ control محاسبه شده (33.3٪ = ۱ از ۳)');
ok(html.includes('0.0٪'), 'نرخِ برگشتِ ds محاسبه شده (0.0٪ = ۰ از ۲)');

// رویدادِ قبل از exposure نباید در رضایت شمرده شود — کاربرِ ۹۹۹ نباید n را ۳ کند
ok(!/n=۳/.test(html), 'بازخوردِ قبل از exposure در میانگینِ رضایت شمرده نمی‌شود');

/* ⚠️ کنترلِ مثبت: اگر READING_METRIC_EXPERIMENTS خالی بود یا این آزمایش در آن نبود،
 * همه‌ی ادعاهای بالا با یک تابعِ همیشه-خالی هم پاس می‌شدند. با یک کلیدِ ناشناخته
 * ثابت می‌کنیم کارت فقط برای آزمایشِ اعلام‌شده رندر می‌شود، نه بی‌قید برای هر آزمایشی. */
{
  const db2 = new Database(file);
  db2.prepare(`INSERT INTO experiments (key, name, mode, metric_kind, variants_json, status, primary_metric, guardrails_json, started_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'some_other_experiment', 'x', 'split', 'rate',
    JSON.stringify([{ key: 'control', weight: 50 }, { key: 'b', weight: 50 }]),
    'running', 'payment_approved', '[]', now - 100);
  db2.close();
  const other = experimentViewBody(U(`inst=${encodeURIComponent('tarot:bot-fa.db')}&key=some_other_experiment`));
  ok(!other.includes('متریک‌های تکمیلی'), 'کارتِ تازه برای آزمایشِ دیگری رندر نمی‌شود (allowlist واقعاً محدود است)');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
