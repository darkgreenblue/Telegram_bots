#!/usr/bin/env node
// چکِ CI برای آزمایشِ مدلِ خوانش (v3.105.0 — «دیپ‌سیکِ پولی با برشِ ریترای در برابرِ luna»).
//
// 🏁 v3.150.0: کلیدِ اول (`reading_model_ds`، ۵۰/۵۰) بسته شد و `reading_model_ds2` جایش آمد:
// ۹۰٪ دیپ‌سیک به‌جز «خریدارانِ لونا» (`isLunaBuyer`)، ۱۰٪ گروهِ نگه‌داشته‌ی luna. بخشِ «د»
// همان قاعده را روی SQLiteِ واقعی و با هر حالتِ مرزی اجرا می‌کند.
//
// خواسته‌ی صریحِ مالک، دو تکه:
//   ۱) «هیچوقت دمی که میگی اتفاق نیفته … اگه تا قبل از پیام در حال تفسیر نرسیده بود
//      دیگه اصلا سراغ ریترای دوم نریم و یکراست فالبک لونا فعال بشه.»
//   ۲) «به صورت تستی روی نیمی از کاربرها به صورت کاملا رندم … مطمئن بشی همه این دیتاها
//      ثبت میشه … اگه چیزی به طرز محسوسی داره بد میشه تست رو سریع خاموش کرد.»
//
// این چک سه لایه دارد:
//   الف) آزمایش واقعاً روی SQLite واقعی seed می‌شود (۵۰/۵۰، running) — نه فقط ادعای متنی
//        که «سی‌ای وجود دارد»، وگرنه `peekVariant` تا ابد literal 'control' می‌دهد و
//        بازوی ds به هیچ کاربری نمی‌رسد (همان تله‌ی ثبت‌شده‌ی هر آزمایشِ seedشده‌ی دیگر
//        در این فایل).
//   ب) `awaitReadingLLM` از سورس بریده و با استاب اجرا می‌شود: بازو فقط یک‌بار (لحظه‌ی
//      ورود به `llmInflight`) تعیین می‌شود، فالِ صوتی هرگز وارد `readingArm` نمی‌شود،
//      و بازوی `ds` دقیقاً برنامه‌ی مدلِ درست را می‌سازد. قواعدِ مهلت/برش عمداً
//      مشترک‌اند و در check-retry-cut.mjs پوشش رفتاری دارند؛ وگرنه A/B با تفاوتِ
//      قابلیت اطمینان آلوده می‌شد.
//   ج) `waitLLMWithLoading` از سورس بریده و اجرا می‌شود: `loadingShown` قبل از فراخوانی
//      پر و در هر حالت (حتی خطا) خالی می‌شود، exposure/`reading_wait` فقط برای فالِ
//      وارد `readingArm`شده و **بعد از** برگشتنِ فراخوانی ثبت می‌شود، و `readingArm`
//      بعد از مصرف پاک می‌شود (وگرنه بازیابیِ `rview:` دوباره‌شماری می‌کند).
//
// طبقِ بند ۶ب-۲ ریشه هر ادعای منفی یک کنترلِ مثبت دارد؛ بخشِ مهش (mutation) هم همین را
// با تغییرِ سورس و اجرای دوباره‌ی همان ادعاها می‌سنجد.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { ensureAnalytics, EVENTS } from '../shared/analytics.js';
import { ensureAb, peekVariant } from '../shared/ab.js';
import { hardTimeout } from '../bots/tarot/reading-core.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC0 = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');

// بدنه‌ی یک تابع را از سورس بیرون می‌کشد (شمارشِ آکولاد، نه regex ساده)
function bodyOf(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return null;
}

// یک `db.prepare(...).run(...)` را از روی نشانه‌اش بیرون می‌کشد (شمارشِ پرانتز)
function stmtAfter(src, marker) {
  const mi = src.indexOf(marker);
  if (mi < 0) return null;
  // خودِ نشانه (اسمِ آزمایش) داخلِ آرگومان‌های `.run(...)` است، یعنی **بعد** از
  // `db.prepare(...)` می‌آید — پس باید نزدیک‌ترین `db.prepare(` را قبلش بگردیم.
  const start = src.lastIndexOf('db.prepare(', mi);
  if (start < 0) return null;
  const endOfCall = (from) => {
    let depth = 0, k = src.indexOf('(', from);
    if (k < 0) return -1;
    for (let j = k; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') { depth--; if (depth === 0) return j + 1; }
    }
    return -1;
  };
  const afterPrepare = endOfCall(start);
  if (afterPrepare < 0) return null;
  const runIdx = src.indexOf('.run(', afterPrepare);
  if (runIdx < 0 || runIdx > afterPrepare + 4) return null;
  const afterRun = endOfCall(runIdx);
  if (afterRun < 0) return null;
  return src.slice(start, afterRun) + ';';
}

const SEED_MARKER = 'مدلِ خوانش ۲: دیپ‌سیک (به‌جز خریدارانِ لونا) با ۱۰٪ نگه‌داشته‌ی luna';
const KEY = 'reading_model_ds2';
const KEY_V1 = 'reading_model_ds';

function seedExperimentInto(db, src) {
  const stmt = stmtAfter(src, SEED_MARKER);
  if (!stmt) return null;
  const fn = new Function('db', 'READING_MODEL_EXP', 'EVENTS', stmt);
  fn(db, KEY, EVENTS);
  return stmt;
}

function makeDb() {
  const db = new Database(':memory:');
  ensureAnalytics(db);
  ensureAb(db);
  return db;
}

console.log('▶ الف) seedِ آزمایشِ مدلِ خوانش روی SQLite واقعی');
{
  const db = makeDb();
  const stmt = seedExperimentInto(db, SRC0);
  ok(!!stmt, 'ردیفِ INSERT OR IGNORE برای آزمایش پیدا و اجرا شد');
  if (stmt) {
    ok(/INSERT OR IGNORE/.test(stmt), 'ایمن به اجرای دوباره است (OR IGNORE)، نه REPLACE');
    const row = db.prepare('SELECT * FROM experiments WHERE key=?').get(KEY);
    ok(!!row, 'ردیف واقعاً در جدولِ experiments نشست');
    if (row) {
      ok(row.status === 'running', `status باید running باشد، بود «${row.status}»`);
      const variants = JSON.parse(row.variants_json);
      ok(Array.isArray(variants) && variants.length === 2, 'دقیقاً دو بازو');
      const control = variants.find(v => v.key === 'control');
      const ds = variants.find(v => v.key === 'ds');
      ok(!!control && !!ds, 'بازوهای control و ds هر دو هستند');
      ok(control?.weight === 10 && ds?.weight === 90, 'وزن‌ها ۱۰ (گروهِ نگه‌داشته‌ی luna) و ۹۰ (دیپ‌سیک) است');
      ok(row.primary_metric === EVENTS.PAYMENT_APPROVED, 'متریکِ اصلی روی payment_approved نشسته');
      const guardrails = JSON.parse(row.guardrails_json);
      ok(guardrails.includes(EVENTS.REFUND) && guardrails.includes(EVENTS.PAYMENT_REJECTED),
        'گاردریل‌ها شاملِ refund و payment_rejected اند');
    }
    // idempotent: اجرای دوباره نباید ردیف را عوض کند یا خطا بدهد
    seedExperimentInto(db, SRC0);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM experiments WHERE key=?').get(KEY);
    ok(rows.n === 1, 'اجرای دوباره‌ی seed دوباره ردیف نمی‌سازد (idempotent)');
  }

  // کنترلِ مثبت: بدونِ seed، peekVariant باید همیشه 'control' بدهد — یعنی seed واقعاً
  // چیزی را عوض می‌کند، نه اینکه peekVariant به‌هرحال control می‌داد.
  const dbUnseeded = makeDb();
  const arms = new Set();
  for (let uid = 1; uid <= 40; uid++) arms.add(peekVariant(dbUnseeded, uid, KEY));
  ok(arms.size === 1 && arms.has('control'), 'کنترلِ مثبت: بدونِ seed، peekVariant همیشه control می‌دهد');

  // با seed، هر دو بازو واقعاً دیده می‌شوند (روی نمونه‌ی کافی)
  const seeded = new Set();
  for (let uid = 1; uid <= 200; uid++) seeded.add(peekVariant(db, uid, KEY));
  ok(seeded.has('control') && seeded.has('ds'), 'با seed، هر دو بازو روی نمونه‌ی ۲۰۰ کاربر دیده می‌شوند');
  let nCtl = 0;
  for (let uid = 1; uid <= 4000; uid++) if (peekVariant(db, 1_000_000 + uid * 7, KEY) === 'control') nCtl++;
  ok(nCtl > 4000 * 0.07 && nCtl < 4000 * 0.13, `سهمِ گروهِ نگه‌داشته حدودِ ۱۰٪ است (${nCtl}/4000)`);

  // کلیدِ اول در بوت stop می‌شود (و مرزِ «خریدارِ لونا» همان stopped_atِ اوست)
  db.prepare("INSERT INTO experiments (key, status, variants_json, started_at) VALUES (?, 'running', '[]', 1)").run(KEY_V1);
  const stopV1 = stmtAfter(SRC0, '`).run(READING_MODEL_EXP_V1);');
  ok(!!stopV1 && /status='stopped'/.test(stopV1) && /status<>'stopped'/.test(stopV1),
    'بوت کلیدِ اول را یک بار stop می‌کند (idempotent؛ stopped_atش بعداً عوض نمی‌شود)');
  if (stopV1) {
    new Function('db', 'READING_MODEL_EXP_V1', stopV1)(db, KEY_V1);
    const v1 = db.prepare('SELECT status, stopped_at FROM experiments WHERE key=?').get(KEY_V1);
    ok(v1?.status === 'stopped' && v1.stopped_at > 0, 'کلیدِ اول واقعاً stopped شد و stopped_at گرفت');
    db.prepare('UPDATE experiments SET stopped_at=123 WHERE key=?').run(KEY_V1);
    new Function('db', 'READING_MODEL_EXP_V1', stopV1)(db, KEY_V1);
    ok(db.prepare('SELECT stopped_at FROM experiments WHERE key=?').get(KEY_V1).stopped_at === 123,
      'اجرای دوباره‌ی بوت مرزِ زمانی را جابه‌جا نمی‌کند');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// هارنسِ awaitReadingLLM
// ─────────────────────────────────────────────────────────────────────────
function buildAwaitReadingLLM(src, {
  readingRow, armFor = () => 'control', callReadingLLM,
  readingArm = new Map(), llmInflight = new Map(), loadingShown = new Set(),
  inflightMaxMs = 60_000, lunaBuyer = () => false,
} = {}) {
  const body = bodyOf(src, 'async function awaitReadingLLM(uid, readingId) {');
  if (!body) return null;
  const peekVariantCalls = [];
  const lunaCalls = [];
  const stmts = { getReading: { get: () => readingRow } };
  const peekVariantStub = (db, uid, key) => { peekVariantCalls.push({ uid, key }); return armFor(); };
  const fn = new Function(
    'stmts', 'llmInflight', 'peekVariant', 'db', 'READING_MODEL_EXP', 'readingArm',
    'DS_MODEL', 'READING_MODEL',
    'callReadingLLM', 'hardTimeout', 'READING_INFLIGHT_MAX_MS', 'logErr', 'alertHang', 'isLunaBuyer',
    `return (${body});`,
  );
  const awaitReadingLLM = fn(
    stmts, llmInflight, peekVariantStub, {}, KEY, readingArm,
    'DS_MODEL_X', 'READING_MODEL_Y',
    callReadingLLM, hardTimeout, inflightMaxMs, () => {}, () => {},
    (u) => { lunaCalls.push(u); return lunaBuyer(u); },
  );
  return { awaitReadingLLM, peekVariantCalls, readingArm, llmInflight, loadingShown, lunaCalls };
}

console.log('\n▶ ب) awaitReadingLLM — تعیینِ بازو');
{
  // ۱) فالِ صوتی: هرگز peekVariant صدا نمی‌شود، هرگز وارد readingArm نمی‌شود، armOpts=null
  {
    const calls = [];
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: '', question_audio: 'file123', question: '', user_id: 7 },
      callReadingLLM: (id, opts) => { calls.push({ id, opts }); return Promise.resolve({ ok: true }); },
    });
    ok(!!h, 'awaitReadingLLM استخراج شد');
    if (h) {
      await h.awaitReadingLLM(7, 501);
      ok(h.peekVariantCalls.length === 0, 'فالِ صوتی: peekVariant اصلاً صدا زده نمی‌شود');
      ok(!h.readingArm.has(501), 'فالِ صوتی: وارد readingArm نمی‌شود (فیلترِ متقارن)');
      ok(calls.length === 1 && calls[0].opts === null, 'فالِ صوتی: armOpts همیشه null است');
    }
  }

  // ۲) بازوی control: readingArm پر می‌شود، armOpts هنوز null
  {
    const calls = [];
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: '', question_audio: '', question: 'سؤالِ متنی', user_id: 8 },
      armFor: () => 'control',
      callReadingLLM: (id, opts) => { calls.push({ id, opts }); return Promise.resolve({ ok: true }); },
    });
    if (h) {
      await h.awaitReadingLLM(8, 502);
      ok(h.readingArm.get(502) === 'control', 'بازوی control در readingArm ثبت می‌شود');
      ok(calls[0].opts === null, 'بازوی control: armOpts همچنان null (بیت‌به‌بیت رفتارِ قبلی)');
    }
  }

  // ۳) بازوی ds: فقط برنامه‌ی مدل را عوض می‌کند؛ سیاست زمان/فالبک برای هر دو بازو مشترک است
  {
    const calls = [];
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: '', question_audio: '', question: 'سؤالِ متنی', user_id: 9 },
      armFor: () => 'ds',
      callReadingLLM: (id, opts) => { calls.push({ id, opts }); return Promise.resolve({ ok: true }); },
    });
    if (h) {
      await h.awaitReadingLLM(9, 503);
      ok(h.readingArm.get(503) === 'ds', 'بازوی ds در readingArm ثبت می‌شود');
      const opts = calls[0]?.opts;
      ok(!!opts, 'بازوی ds: armOpts ساخته می‌شود');
      if (opts) {
        ok(JSON.stringify(opts.plan) === JSON.stringify(['DS_MODEL_X', 'DS_MODEL_X', 'READING_MODEL_Y', 'READING_MODEL_Y']),
          'برنامه: دو تلاشِ DS_MODEL بعد دو تلاشِ READING_MODEL', `دیده شد: ${JSON.stringify(opts.plan)}`);
        ok(Object.keys(opts).length === 1 && Array.isArray(opts.plan),
          'armOpts فقط برنامه را حمل می‌کند؛ تفاوت زمانی بین بازوها وارد A/B نمی‌شود');
      }
    }
  }

  // ۳ب) بازوی ds ولی «خریدارِ لونا»: بازو همان ds ثبت می‌شود (ITT) ولی برنامه‌ی luna (armOpts=null)
  {
    const calls = [];
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: '', question_audio: '', question: 'سؤالِ متنی', user_id: 19 },
      armFor: () => 'ds',
      lunaBuyer: (u) => u === 19,
      callReadingLLM: (id, opts) => { calls.push({ id, opts }); return Promise.resolve({ ok: true }); },
    });
    if (h) {
      await h.awaitReadingLLM(19, 513);
      ok(h.readingArm.get(513) === 'ds', 'خریدارِ لونا در بازوی ds: بازو همان ds ثبت می‌شود (مقایسه‌ی ITT)');
      ok(calls[0]?.opts === null, 'خریدارِ لونا: armOpts=null، یعنی همان برنامه‌ی luna');
      ok(h.lunaCalls.length === 1 && h.lunaCalls[0] === 19, 'قاعده با user_idِ خودِ فال سنجیده می‌شود');
    }
  }
  // ۳ج) بازوی control: قاعده‌ی خریدارِ لونا اصلاً صدا زده نمی‌شود (هزینه‌ی کوئری فقط روی ds)
  {
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: '', question_audio: '', question: 'q', user_id: 20 },
      armFor: () => 'control',
      lunaBuyer: () => true,
      callReadingLLM: () => Promise.resolve({ ok: true }),
    });
    if (h) {
      await h.awaitReadingLLM(20, 514);
      ok(h.lunaCalls.length === 0, 'بازوی control: isLunaBuyer صدا زده نمی‌شود');
    }
  }

  // ۴) llmInflight از قبل پر است: peekVariant دوباره صدا زده نمی‌شود، callReadingLLM هم نه
  {
    const calls = [];
    const pending = Promise.resolve({ already: true });
    const readingArm = new Map([[505, 'control']]); // شبیه‌سازیِ اینکه قبلاً تعیین شده
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: '', question_audio: '', question: 'q', user_id: 12 },
      armFor: () => 'ds', // اگر دوباره صدا زده شود این جواب می‌دهد و تست را رد می‌کند
      callReadingLLM: (id, opts) => { calls.push({ id, opts }); return Promise.resolve({ ok: true }); },
      readingArm,
      llmInflight: new Map([[505, pending]]),
    });
    if (h) {
      const result = await h.awaitReadingLLM(12, 505);
      ok(h.peekVariantCalls.length === 0, 'llmInflightِ از قبل پر: peekVariant دوباره صدا زده نمی‌شود');
      ok(calls.length === 0, 'llmInflightِ از قبل پر: callReadingLLM دوباره صدا زده نمی‌شود');
      ok(readingArm.get(505) === 'control', 'readingArmِ از قبل‌موجود دست‌نخورده می‌ماند');
      ok(result?.already === true, 'نتیجه از همان promiseِ در جریان می‌آید');
    }
  }

  // ۶) llm_json از قبل موجود: هیچ‌چیزِ دیگری لمس نمی‌شود
  {
    const calls = [];
    const readingArm = new Map();
    const h = buildAwaitReadingLLM(SRC0, {
      readingRow: { llm_json: JSON.stringify({ done: true }), user_id: 13 },
      armFor: () => 'ds',
      callReadingLLM: (id, opts) => { calls.push({ id, opts }); return Promise.resolve({ ok: true }); },
      readingArm,
    });
    if (h) {
      const result = await h.awaitReadingLLM(13, 506);
      ok(result?.done === true, 'llm_jsonِ موجود مستقیم پارس و برگردانده می‌شود');
      ok(h.peekVariantCalls.length === 0, 'llm_jsonِ موجود: peekVariant صدا زده نمی‌شود');
      ok(calls.length === 0, 'llm_jsonِ موجود: callReadingLLM صدا زده نمی‌شود');
      ok(!readingArm.has(506), 'llm_jsonِ موجود: readingArm دست نمی‌خورد');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// هارنسِ waitLLMWithLoading
// ─────────────────────────────────────────────────────────────────────────
function buildWaitLLMWithLoading(src, {
  awaitReadingLLMImpl, readingArm = new Map(), loadingShown = new Set(), loadingMinMs = 0,
} = {}) {
  const body = bodyOf(src, 'async function waitLLMWithLoading(ctx, uid, readingId, onFinalFailure = null) {');
  if (!body) return null;
  const exposeCalls = [];
  const trackCalls = [];
  const ctx = {
    chat: { id: 1 },
    reply: async () => ({ message_id: 42 }),
    telegram: { editMessageText: async () => {}, deleteMessage: async () => {} },
  };
  const fn = new Function(
    'loadingFrame', 'L', 'loadingShown', 'sleep', 'pace', 'awaitReadingLLM',
    'readingArm', 'expose', 'db', 'READING_MODEL_EXP', 'track', 'LOADING_MIN_MS', 'LOADING_LONG_WAIT_MS',
    'LOADING_MAX_MS',
    `return (${body});`,
  );
  const waitLLMWithLoading = fn(
    (label) => (i) => `frame${i}:${label}`,
    { reading: { loadingLabel: 'در حال تفسیر' } },
    loadingShown,
    (ms) => new Promise((res) => setImmediate(res)), // سریع، بدونِ بستگی به مقدارِ ms
    () => 0,
    awaitReadingLLMImpl,
    readingArm,
    (db, uid, key) => { exposeCalls.push({ uid, key }); },
    {},
    KEY,
    (db, uid, event, props) => { trackCalls.push({ uid, event, props }); },
    loadingMinMs,
    20_000,
    10 * 60_000,
  );
  return { waitLLMWithLoading, ctx, exposeCalls, trackCalls, readingArm, loadingShown };
}

console.log('\n▶ ج) waitLLMWithLoading — loadingShown و exposureِ متقارن');
{
  // ۱) فالِ بازوداده‌شده: loadingShown درست شکل می‌گیرد و بعد پاک می‌شود، exposure/track می‌روند
  {
    const readingArm = new Map([[601, 'ds']]);
    let sawLoadingDuringCall = null;
    const h = buildWaitLLMWithLoading(SRC0, {
      readingArm,
      awaitReadingLLMImpl: async (uid, readingId) => {
        sawLoadingDuringCall = h.loadingShown.has(readingId);
        await new Promise((r) => setTimeout(r, 5));
        return { headline: 'ok' };
      },
    });
    ok(!!h, 'waitLLMWithLoading استخراج شد');
    if (h) {
      const result = await h.waitLLMWithLoading(h.ctx, 99, 601);
      ok(sawLoadingDuringCall === true, 'loadingShown قبل از فراخوانیِ awaitReadingLLM پر می‌شود');
      ok(!h.loadingShown.has(601), 'loadingShown بعد از برگشتن پاک می‌شود');
      ok(!h.readingArm.has(601), 'readingArm بعد از مصرف پاک می‌شود (ضدِ دوباره‌شماریِ rview)');
      ok(h.exposeCalls.length === 1 && h.exposeCalls[0].key === KEY, 'expose دقیقاً یک بار صدا زده می‌شود');
      ok(h.trackCalls.length === 1 && h.trackCalls[0].event === 'reading_wait', "رویدادِ 'reading_wait' ثبت می‌شود");
      const props = h.trackCalls[0]?.props;
      ok(props?.reading_id === 601 && props?.arm === 'ds', 'پراپ‌های reading_id/arm درست‌اند');
      ok(typeof props?.ms === 'number' && props.ms >= 0, 'ms عددی و غیرمنفی است');
      ok(result?.headline === 'ok', 'نتیجه‌ی نهایی از awaitReadingLLM عبور می‌کند');
    }
  }

  // ۲) فالی که در readingArm نیست (مثلِ فالِ صوتی): نه expose نه track
  {
    const readingArm = new Map();
    const h = buildWaitLLMWithLoading(SRC0, {
      readingArm,
      awaitReadingLLMImpl: async () => ({ headline: 'ok' }),
    });
    if (h) {
      await h.waitLLMWithLoading(h.ctx, 99, 602);
      ok(h.exposeCalls.length === 0, 'فالِ بدونِ بازو: expose صدا زده نمی‌شود');
      ok(h.trackCalls.length === 0, "فالِ بدونِ بازو: 'reading_wait' ثبت نمی‌شود");
    }
  }

  // ۳) awaitReadingLLM شکست می‌خورد (throw): loadingShown همچنان پاک می‌شود
  {
    const readingArm = new Map([[603, 'control']]);
    const h = buildWaitLLMWithLoading(SRC0, {
      readingArm,
      awaitReadingLLMImpl: async () => { throw new Error('boom'); },
    });
    if (h) {
      let threw = false;
      try { await h.waitLLMWithLoading(h.ctx, 99, 603); }
      catch { threw = true; }
      ok(threw, 'خطای awaitReadingLLM بالا می‌رود (رفتارِ قبلی حفظ شده)');
      ok(!h.loadingShown.has(603), 'حتی روی خطا، loadingShown پاک می‌شود (finally)');
    }
  }

  // ۴) کفِ نمایش صفر نیست: ms باید نسبت به کف حساب و به صفر clamp شود
  {
    const readingArm = new Map([[604, 'ds']]);
    const h = buildWaitLLMWithLoading(SRC0, {
      readingArm, loadingMinMs: 10 ** 9, // کفی خیلی بزرگ‌تر از هر فاصله‌ی واقعی تست
      awaitReadingLLMImpl: async () => ({ headline: 'ok' }),
    });
    if (h) {
      // کفِ ۱۰^۹ میلی‌ثانیه یعنی sleep(remain) واقعی صدها روز طول می‌کشد؛ چون sleepِ
      // تزریق‌شده مقدارِ ms را نادیده می‌گیرد و همیشه فوری resolve می‌کند، تست معطل
      // نمی‌ماند و فقط عددِ ثبت‌شده در track را می‌سنجیم.
      await h.waitLLMWithLoading(h.ctx, 99, 604);
      const props = h.trackCalls[0]?.props;
      ok(props?.ms === 0, 'وقتی فاصله‌ی واقعی خیلی کمتر از کف است، ms دقیقاً صفر می‌شود (نه منفی)');
    }
  }

  // ۵) شکستِ نهایی: communication باید پیش از پاک‌شدنِ پیام لودینگ تمام شود. این
  // ترتیب برای کاربر مهم است: بینِ «در حال تفسیر» و خبرِ بازگشت، صفحه‌ی خالی نمی‌بیند.
  {
    const order = [];
    const h = buildWaitLLMWithLoading(SRC0, {
      awaitReadingLLMImpl: async () => null,
    });
    if (h) {
      h.ctx.telegram.deleteMessage = async () => { order.push('delete-loading'); };
      const result = await h.waitLLMWithLoading(h.ctx, 99, 605, async () => {
        order.push('refund-notified');
      });
      ok(result === null && order.join('>') === 'refund-notified>delete-loading',
        'شکستِ نهایی: پیامِ refund/retry پیش از حذفِ لودینگ communicate می‌شود');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// د) قاعده‌ی «خریدارِ لونا» روی SQLiteِ واقعی
// ─────────────────────────────────────────────────────────────────────────
function buildLunaBuyer(src, db) {
  const from = src.indexOf('let _lunaBuyerStmt = null;');
  const to = src.indexOf('\n};', src.indexOf('const isLunaBuyer = (uid) => {', from));
  if (from < 0 || to < 0) return null;
  const errs = [];
  const fn = new Function('db', 'READING_MODEL_EXP_V1', 'logErr',
    `${src.slice(from, to + 3)}\nreturn isLunaBuyer;`);
  const f = fn(db, KEY_V1, (...a) => errs.push(a.join(' ')));
  f.errs = errs;
  return f;
}
const V1_START = 1_000_000, V1_STOP = 2_000_000;
function lunaDb() {
  const db = makeDb();
  db.exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, created_at INTEGER)');
  db.prepare("INSERT INTO experiments (key, status, variants_json, started_at, stopped_at) VALUES (?, 'stopped', '[]', ?, ?)")
    .run(KEY_V1, V1_START, V1_STOP);
  const pay = db.prepare('INSERT INTO payments (user_id, status, created_at) VALUES (?,?,?)');
  const exp = db.prepare('INSERT INTO ab_exposures (experiment_key, user_id, variant, created_at) VALUES (?,?,?,?)');
  // ۱: قبل از آزمایش خرید (با luna) ⟵ بعداً بازوی ds هم گرفت ⟵ خریدارِ لونا
  pay.run(1, 'approved', V1_START - 500); exp.run(KEY_V1, 1, 'ds', V1_START + 100);
  // ۲: داخلِ آزمایش در بازوی control خرید ⟵ خریدارِ لونا
  exp.run(KEY_V1, 2, 'control', V1_START + 100); pay.run(2, 'approved', V1_START + 900);
  // ۳: داخلِ آزمایش در بازوی ds، بعد از گرفتنِ دیپ‌سیک خرید ⟵ خریدارِ دیپ‌سیک
  exp.run(KEY_V1, 3, 'ds', V1_START + 100); pay.run(3, 'approved', V1_START + 900);
  // ۴: هیچ پرداختی ندارد
  exp.run(KEY_V1, 4, 'control', V1_START + 100);
  // ۵: بازوی control ولی اولین خریدش بعد از بسته‌شدنِ کلیدِ اول (سیاستِ تازه) ⟵ نه
  exp.run(KEY_V1, 5, 'control', V1_START + 100); pay.run(5, 'approved', V1_STOP + 10);
  // ۶: فقط پرداختِ ردشده/لغوشده دارد ⟵ نه
  pay.run(6, 'rejected', V1_START - 500); pay.run(6, 'canceled', V1_START + 10);
  // ۷: قبل از آزمایش خرید، بعد با دیپ‌سیک هم خرید ⟵ هنوز خریدارِ لونا (اولین پرداخت ملاک است)
  pay.run(7, 'approved', V1_START - 500); exp.run(KEY_V1, 7, 'ds', V1_START + 100); pay.run(7, 'approved', V1_START + 900);
  // ۸: هرگز expose نشد (فقط فالِ صوتی = همیشه luna) و داخلِ آزمایش خرید ⟵ خریدارِ لونا
  pay.run(8, 'approved', V1_START + 900);
  // ۹: پرداختِ قبل از آزمایش که بعد از بسته‌شدن تأیید شد (created_at ملاک است) ⟵ خریدارِ لونا
  pay.run(9, 'approved', V1_START - 50);
  return db;
}
const LUNA_EXPECT = { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false, 7: true, 8: true, 9: true };
const lunaMismatches = (src) => {
  const db = lunaDb();
  const f = buildLunaBuyer(src, db);
  if (!f) return ['extract'];
  const bad = Object.entries(LUNA_EXPECT).filter(([u, want]) => f(Number(u)) !== want).map(([u]) => u);
  if (f.errs.length) bad.push('errors');
  return bad;
};
console.log('\n▶ د) isLunaBuyer روی SQLiteِ واقعی');
{
  const db = lunaDb();
  const f = buildLunaBuyer(SRC0, db);
  ok(!!f, 'isLunaBuyer از سورس استخراج شد');
  if (f) {
    const names = {
      1: 'قبل از آزمایش خرید و بعد بازوی ds گرفت ⟵ خریدارِ لونا',
      2: 'در بازوی control آزمایشِ اول خرید ⟵ خریدارِ لونا',
      3: 'در بازوی ds بعد از گرفتنِ دیپ‌سیک خرید ⟵ دیپ‌سیک می‌ماند',
      4: 'بدونِ پرداخت ⟵ دیپ‌سیک',
      5: 'اولین خرید بعد از بسته‌شدنِ آزمایشِ اول ⟵ دیپ‌سیک (گروه بزرگ نمی‌شود)',
      6: 'فقط پرداختِ رد/لغوشده ⟵ دیپ‌سیک',
      7: 'اولین خرید با luna، خریدِ بعدی با دیپ‌سیک ⟵ هنوز خریدارِ لونا',
      8: 'هرگز expose نشد (فقط صوتی) و خرید ⟵ خریدارِ لونا',
      9: 'فاکتورِ قبل از آزمایش (ملاک created_at است) ⟵ خریدارِ لونا',
    };
    for (const [u, want] of Object.entries(LUNA_EXPECT)) ok(f(Number(u)) === want, `کاربرِ ${u}: ${names[u]}`);
    ok(f.errs.length === 0, 'هیچ خطایی لاگ نشد');
    const db2 = makeDb();
    db2.exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, created_at INTEGER)');
    db2.prepare("INSERT INTO payments (user_id, status, created_at) VALUES (1, 'approved', 5)").run();
    const f2 = buildLunaBuyer(SRC0, db2);
    ok(f2 && f2(1) === false, 'بدونِ ردیفِ آزمایشِ اول (زبان‌های دیگر/دیتابیسِ تازه) هیچ‌کس خریدارِ لونا نیست');
    const f3 = buildLunaBuyer(SRC0, makeDb());
    ok(f3 && f3(1) === false && f3.errs.length === 1, 'خطای SQL (جدولِ payments نیست) ⟵ false + لاگ، نه کرش');
  }
}

console.log('\n▶ جهش‌ها (باید هر کدام دستِ‌کم یک ادعا را قرمز کنند)');
function countFails(mutSrc, section) {
  const before = fail;
  if (section === 'seed') {
    const db = makeDb();
    const stmt = seedExperimentInto(db, mutSrc);
    if (!stmt) return 1;
    const row = db.prepare('SELECT * FROM experiments WHERE key=?').get(KEY);
    if (!row) return 1;
    let bad = 0;
    if (row.status !== 'running') bad++;
    const variants = JSON.parse(row.variants_json);
    const control = variants.find(v => v.key === 'control');
    const ds = variants.find(v => v.key === 'ds');
    if (!(control?.weight === 10 && ds?.weight === 90)) bad++;
    return bad;
  }
  return 0;
}

const mutations = [
  {
    name: 'وزنِ گروهِ نگه‌داشته از ۱۰ به ۵۰ برگردد',
    apply: (s) => s.replace("{ key: 'control', weight: 10 }, { key: 'ds', weight: 90 }", "{ key: 'control', weight: 50 }, { key: 'ds', weight: 50 }"),
    section: 'seed',
  },
  {
    name: 'status از running به draft برگردد (آزمایش هیچ‌کس را نمی‌گیرد)',
    apply: (s) => s.replace(
      "VALUES (?,?,?,'split','rate',?,'running',?,?,unixepoch())\n  `).run(\n    READING_MODEL_EXP,",
      "VALUES (?,?,?,'split','rate',?,'draft',?,?,unixepoch())\n  `).run(\n    READING_MODEL_EXP,",
    ),
    section: 'seed',
  },
  {
    name: 'برنامه‌ی بازوی ds به‌جای DS با luna شروع شود',
    apply: (s) => s.replace(
      'plan: [DS_MODEL, DS_MODEL, READING_MODEL, READING_MODEL],',
      'plan: [READING_MODEL, DS_MODEL, READING_MODEL, READING_MODEL],',
    ),
    check: async (mutSrc) => {
      const h = buildAwaitReadingLLM(mutSrc, {
        readingRow: { llm_json: '', question_audio: '', question: 'q', user_id: 1 },
        armFor: () => 'ds',
        callReadingLLM: (id, opts) => { global.__plan = opts?.plan; return Promise.resolve({}); },
      });
      if (!h) return 1;
      await h.awaitReadingLLM(1, 700);
      return JSON.stringify(global.__plan) === JSON.stringify(['DS_MODEL_X', 'DS_MODEL_X', 'READING_MODEL_Y', 'READING_MODEL_Y']) ? 0 : 1;
    },
  },
  {
    name: 'فالِ صوتی هم وارد readingArm شود (فیلترِ متقارن شکسته می‌شود)',
    apply: (s) => s.replace(
      'const arm = audio ? \'control\' : peekVariant(db, r?.user_id ?? uid, READING_MODEL_EXP);\n    let armOpts = null;\n    if (!audio) {',
      'const arm = audio ? \'control\' : peekVariant(db, r?.user_id ?? uid, READING_MODEL_EXP);\n    let armOpts = null;\n    if (true) {',
    ),
    check: async (mutSrc) => {
      const h = buildAwaitReadingLLM(mutSrc, {
        readingRow: { llm_json: '', question_audio: 'x', question: '', user_id: 1 },
        callReadingLLM: () => Promise.resolve({}),
      });
      if (!h) return 1;
      await h.awaitReadingLLM(1, 701);
      return h.readingArm.has(701) ? 1 : 0; // با جهش باید true شود ⟵ ادعای اصلی این را رد می‌کرد
    },
  },
  {
    name: 'loadingShown.delete در finally برداشته شود (نشتِ ست)',
    apply: (s) => s.replace(
      'let result;\n  try {\n    result = await awaitReadingLLM(uid, readingId);\n  } finally {\n    loadingShown.delete(readingId);\n  }',
      'let result;\n  result = await awaitReadingLLM(uid, readingId);',
    ),
    check: async (mutSrc) => {
      const readingArm = new Map();
      const h = buildWaitLLMWithLoading(mutSrc, { readingArm, awaitReadingLLMImpl: async () => ({}) });
      if (!h) return 1;
      await h.waitLLMWithLoading(h.ctx, 1, 702);
      return h.loadingShown.has(702) ? 1 : 0; // نشت یعنی جهش گرفته شد
    },
  },
  {
    name: 'readingArm.delete پاک‌سازی حذف شود (دوباره‌شماریِ rview)',
    apply: (s) => s.replace('    readingArm.delete(readingId);\n    try { expose(db, uid, READING_MODEL_EXP); }',
      '    try { expose(db, uid, READING_MODEL_EXP); }'),
    check: async (mutSrc) => {
      const readingArm = new Map([[703, 'ds']]);
      const h = buildWaitLLMWithLoading(mutSrc, { readingArm, awaitReadingLLMImpl: async () => ({}) });
      if (!h) return 1;
      await h.waitLLMWithLoading(h.ctx, 1, 703);
      return h.readingArm.has(703) ? 1 : 0; // باقی‌ماندن یعنی جهش گرفته شد
    },
  },
  {
    name: 'Math.max(0, …) از محاسبه‌ی ms حذف شود (عددِ منفی ممکن می‌شود)',
    apply: (s) => s.replace('ms: Math.max(0, resolvedAt - startedAt - LOADING_MIN_MS),', 'ms: resolvedAt - startedAt - LOADING_MIN_MS,'),
    check: async (mutSrc) => {
      const readingArm = new Map([[704, 'ds']]);
      const h = buildWaitLLMWithLoading(mutSrc, { readingArm, loadingMinMs: 10 ** 9, awaitReadingLLMImpl: async () => ({}) });
      if (!h) return 1;
      await h.waitLLMWithLoading(h.ctx, 1, 704);
      const ms = h.trackCalls[0]?.props?.ms;
      return (typeof ms === 'number' && ms < 0) ? 1 : 0; // منفی‌شدن یعنی جهش گرفته شد
    },
  },
  {
    name: 'گاردِ خریدارِ لونا از awaitReadingLLM برداشته شود',
    apply: (s) => s.replace("if (arm === 'ds' && !isLunaBuyer(r?.user_id ?? uid)) {", "if (arm === 'ds') {"),
    check: async (mutSrc) => {
      const h = buildAwaitReadingLLM(mutSrc, {
        readingRow: { llm_json: '', question_audio: '', question: 'q', user_id: 1 },
        armFor: () => 'ds', lunaBuyer: () => true,
        callReadingLLM: (id, opts) => { global.__opts = opts; return Promise.resolve({}); },
      });
      if (!h) return 1;
      await h.awaitReadingLLM(1, 710);
      return global.__opts !== null ? 1 : 0; // خریدارِ لونا برنامه‌ی دیپ‌سیک گرفت ⟵ گرفته شد
    },
  },
  {
    name: 'مرزِ «قبل از بسته‌شدنِ آزمایشِ اول» برداشته شود (گروه بی‌پایان بزرگ می‌شود)',
    apply: (s) => s.replace(' AND f.t < COALESCE(e.stopped_at, 9000000000)', ''),
    check: async (mutSrc) => lunaMismatches(mutSrc).length,
  },
  {
    name: 'اولین پرداخت ⟵ آخرین پرداخت (MIN ⟵ MAX)',
    apply: (s) => s.replace("(SELECT MIN(created_at) AS t FROM payments WHERE user_id=@uid AND status='approved') f",
      "(SELECT MAX(created_at) AS t FROM payments WHERE user_id=@uid AND status='approved') f"),
    check: async (mutSrc) => lunaMismatches(mutSrc).length,
  },
  {
    name: 'شرطِ «بعد از گرفتنِ بازوی ds» برداشته شود',
    apply: (s) => s.replace(" AND x.variant='ds' AND x.created_at <= f.t)", " AND x.variant='ds')"),
    check: async (mutSrc) => lunaMismatches(mutSrc).length,
  },
  {
    name: 'شرطِ status=approved برداشته شود',
    apply: (s) => s.replace("FROM payments WHERE user_id=@uid AND status='approved') f", 'FROM payments WHERE user_id=@uid) f'),
    check: async (mutSrc) => lunaMismatches(mutSrc).length,
  },
];

for (const m of mutations) {
  const mutSrc = m.apply(SRC0);
  ok(mutSrc !== SRC0, `جهش «${m.name}» واقعاً سورس را عوض کرد (وگرنه هیچ‌چیزی سنجیده نمی‌شود)`);
  let bad = 0;
  if (m.check) bad = await m.check(mutSrc);
  else bad = countFails(mutSrc, m.section);
  ok(bad > 0, `جهش «${m.name}» را می‌گیریم`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ادعا سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
