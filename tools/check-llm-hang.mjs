#!/usr/bin/env node
/* گاردِ «فالِ پول‌داده هرگز پشتِ یک فراخوانیِ آویزان گیر نمی‌کند» (v3.118.0).
 *
 * 🐛 باگِ واقعی (تیکتِ `#TRT-1686489477`، ۴ مهر ۱۴۰۵): فالِ #23153 بیش از یک ساعت نه
 * موفق شد، نه خطا داد، نه TIMEOUT. سقفِ هر تلاش (۶۰ ثانیه) و بودجه‌ی کل (۴ دقیقه) هر دو
 * روی `AbortController` بنا شده بودند و هیچ‌کدام اثر نکردند. ورودیِ `llmInflight` ماند،
 * پس **هر** اقدامِ کاربر (حتی `/start`) فقط «⌛️ در حال تفسیر کارت‌ها» گرفت و انیمیشنِ
 * لودینگ یک ساعت هر ۲ ثانیه ادیت شد. تنها راهِ نجات ری‌استارت بود.
 *
 * چرا چک‌های قبلی نگرفتند: هر استابِ `fetch` در `check-retry-cut` به abort **احترام
 * می‌گذاشت**. یعنی تست دنیایی را می‌سنجید که در آن abort همیشه کار می‌کند — دقیقاً همان
 * فرضی که روی سرور شکست. این چک برعکس است: استاب‌ها abort را **نادیده** می‌گیرند.
 *
 * سه لایه، هر کدام جدا:
 *   ۱) `hardTimeout` خودش (واحد).
 *   ۲) `orRequest`/`orChatResilient` با fetchی که abort را نادیده می‌گیرد، هم در
 *      مرحله‌ی headers و هم در مرحله‌ی خواندنِ بدنه.
 *   ۳) `awaitReadingLLM` از سورس بریده و با `callReadingLLM`ِ هرگز-settle اجرا می‌شود:
 *      باید `null` بدهد (= مسیرِ ریفاند) و ورودیِ `llmInflight` را پاک کند.
 * به‌علاوه‌ی ادعاهای ساختاری روی اعداد و سیم‌کشی، و جهش‌های واقعی روی سورس.
 */
process.env.LOCALE = 'fa';
process.env.OPENROUTER_API_KEY = 'test-key-not-real';

import { readFileSync } from 'fs';

const CORE_URL = new URL('../bots/tarot/reading-core.js', import.meta.url);
const core = await import(CORE_URL.href);
const { hardTimeout, orChatResilient, OR_HARD_GRACE_MS, OR_TIMEOUT_MS } = core;
const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const CORE_SRC = readFileSync(CORE_URL, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`✅ ${m}`); } else { fail++; console.log(`❌ ${m}`); } };
const NEVER = () => new Promise(() => {});
/** اجرای یک promise با سقفِ بیرونیِ تست، تا اگر فیکس برگشت چک **قرمز** شود نه آویزان. */
const within = (p, ms) => Promise.race([p.then((v) => ({ v }), (e) => ({ e })), new Promise((r) => setTimeout(() => r({ hung: true }), ms))]);

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
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const constMs = (name) => {
  const m = SRC.match(new RegExp(`const ${name}\\s*=\\s*([^;\\n]+)`));
  return m ? m[1].trim() : null;
};

/* ═══ ۱) hardTimeout ═══ */
console.log('\n▶ ۱) hardTimeout');
{
  const r = await within(hardTimeout(Promise.resolve('v'), 50), 2000);
  ok(r.v === 'v', 'promiseِ زودرس مقدارش را دست‌نخورده برمی‌گرداند');
}
{
  let expired = 0;
  const t0 = Date.now();
  const r = await within(hardTimeout(NEVER(), 80, () => { expired++; }), 2000);
  ok(!r.hung && r.e?.message === 'TIMEOUT', `promiseِ هرگز-settle بعد از سقف با TIMEOUT رد می‌شود (${Date.now() - t0}ms)`);
  ok(expired === 1, 'onExpire دقیقاً یک بار صدا زده می‌شود (همان‌جا که abort می‌خورد)');
}
{
  const r = await within(hardTimeout(Promise.reject(new Error('boom')), 50), 2000);
  ok(r.e?.message === 'boom', 'خطای خودِ promise دست‌نخورده عبور می‌کند (به TIMEOUT تبدیل نمی‌شود)');
}
{
  const r = await within(hardTimeout(NEVER(), 30, () => { throw new Error('x'); }), 2000);
  ok(r.e?.message === 'TIMEOUT', 'onExpireِ خطاده ردِ TIMEOUT را نمی‌خورد');
}

/* ═══ ۲) orRequest با fetchی که abort را نادیده می‌گیرد ═══
 * مهلتِ هر تست = سقفِ درخواست + OR_HARD_GRACE_MS + حاشیه. اگر سقفِ سخت برداشته شود،
 * `within` بعد از آن مهلت `hung` می‌دهد و ادعا قرمز می‌شود. */
console.log('\n▶ ۲) orRequest / orChatResilient — abortِ بی‌اثر');
const realFetch = global.fetch;
const LIMIT = 1000; // حداقلِ مجاز در orRequest
const WAIT = LIMIT + OR_HARD_GRACE_MS + 3000;
{
  // headers هرگز نمی‌رسند و abort هم کاری نمی‌کند (دقیقاً رفتارِ دیده‌شده روی سرور)
  const seen = [];
  global.fetch = async (url, init) => { seen.push(JSON.parse(init.body).model); return NEVER(); };
  const t0 = Date.now();
  const r = await within(orChatResilient('s', 'u', { validate: () => true, timeoutMs: LIMIT }, ['hang']), WAIT);
  const dt = Date.now() - t0;
  ok(!r.hung && r.v === null, `fetchِ آویزانِ بی‌اعتنا به abort: زنجیره با null تمام می‌شود، نه آویزان (${dt}ms)`);
  ok(dt < LIMIT + OR_HARD_GRACE_MS + 1500, `در حدِ سقف + مهلت (${dt}ms < ${LIMIT + OR_HARD_GRACE_MS + 1500})`);
}
{
  // headers می‌رسند ولی خواندنِ بدنه هرگز تمام نمی‌شود
  global.fetch = async () => ({ ok: true, status: 200, json: NEVER, text: NEVER });
  const r = await within(orChatResilient('s', 'u', { validate: () => true, timeoutMs: LIMIT }, ['bodyhang']), WAIT);
  ok(!r.hung && r.v === null, 'بدنه‌ی آویزانِ بی‌اعتنا به abort هم زنجیره را قفل نمی‌کند');
}
{
  // کنترلِ مثبت: وقتی بودجه هست، مدلِ آویزان باید **به فالبک برسد** نه فقط null بدهد
  const seen = [];
  global.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    seen.push(model);
    if (model === 'hang') return NEVER();
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'GOOD' } }], usage: {} }) };
  };
  const r = await within(orChatResilient('s', 'u', {
    validate: (o) => o === 'GOOD', timeoutMs: LIMIT, deadlineAt: Date.now() + 60_000, cutRetry: () => true,
  }, ['hang', 'fallback']), WAIT + 3000);
  ok(!r.hung && r.v?.model === 'fallback', `مدلِ آویزان به فالبکِ مستقل می‌رسد (${seen.join(',')})`);
}
{
  // کنترلِ مثبت: مسیرِ عادی بیت‌به‌بیت همان است (سقفِ سخت در حالتِ سالم بی‌اثر)
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'GOOD' } }], usage: {} }) });
  const r = await within(orChatResilient('s', 'u', { validate: () => true }, ['m']), 2000);
  ok(r.v?.out === 'GOOD', 'مسیرِ سالم دست‌نخورده: همان خروجی، بدونِ تأخیر');
}
global.fetch = realFetch;

/* ═══ ۳) awaitReadingLLM — سقفِ بیرونیِ ورودیِ llmInflight ═══ */
console.log('\n▶ ۳) awaitReadingLLM — سقفِ llmInflight');
function buildAwait({ callReadingLLM, maxMs = 150 }) {
  const body = bodyOf(SRC, 'async function awaitReadingLLM(uid, readingId) {');
  if (!body) return null;
  const llmInflight = new Map();
  const logs = [];
  const alerts = [];
  const fn = new Function(
    'stmts', 'llmInflight', 'peekVariant', 'db', 'READING_MODEL_EXP', 'readingArm',
    'DS_MODEL', 'READING_MODEL', 'callReadingLLM', 'hardTimeout', 'READING_INFLIGHT_MAX_MS', 'logErr', 'alertHang',
    `return (${body});`,
  );
  const awaitReadingLLM = fn(
    { getReading: { get: () => ({ llm_json: '', question_audio: '', question: 'q', user_id: 1 }) } },
    llmInflight, () => 'control', {}, 'x', new Map(), 'D', 'R', callReadingLLM, hardTimeout, maxMs,
    (...a) => logs.push(a.join(' ')),
    (id) => alerts.push(id),
  );
  return { awaitReadingLLM, llmInflight, logs, alerts };
}
{
  const h = buildAwait({ callReadingLLM: () => NEVER() });
  ok(!!h, 'awaitReadingLLM از سورس استخراج شد');
  if (h) {
    const p = h.awaitReadingLLM(1, 23153);
    ok(h.llmInflight.has(23153), 'حینِ فراخوانی، فال «در جریان» ثبت است');
    const r = await within(p, 3000);
    ok(!r.hung && r.v === null, 'callReadingLLMِ هرگز-settle بعد از سقف null می‌دهد (= مسیرِ ریفاند)');
    ok(!h.llmInflight.has(23153), 'و ورودیِ llmInflight پاک می‌شود، پس اقدامِ بعدیِ کاربر دیگر «⌛️» نمی‌گیرد');
    ok(h.logs.some((l) => l.includes('LLM_HANG') && l.includes('23153')), 'مارکرِ greppableِ LLM_HANG با شناسه‌ی فال لاگ می‌شود');
    ok(h.alerts.length === 1 && h.alerts[0] === 23153, 'ادمین‌ها دقیقاً یک خبرِ فوری درباره‌ی همین فال می‌گیرند');
  }
}
{
  const h = buildAwait({ callReadingLLM: () => Promise.reject(new Error('boom')) });
  if (h) {
    const r = await within(h.awaitReadingLLM(1, 7), 2000);
    ok(r.e?.message === 'boom', 'کنترلِ مثبت: خطای غیرِ TIMEOUT مثل قبل پرتاب می‌شود (بلعیده نمی‌شود)');
    ok(!h.llmInflight.has(7), 'و ورودی در این حالت هم پاک می‌شود');
  }
}
{
  const h = buildAwait({ callReadingLLM: () => Promise.resolve({ ok: 1 }), maxMs: 60_000 });
  if (h) {
    const t0 = Date.now();
    const r = await within(h.awaitReadingLLM(1, 8), 2000);
    ok(r.v?.ok === 1 && Date.now() - t0 < 1000, 'کنترلِ مثبت: مسیرِ سالم همان نتیجه را بی‌درنگ می‌دهد (سقف منتظرش نمی‌ماند)');
  }
}

/* ═══ ۴) ساختار: اعداد و سیم‌کشی ═══ */
console.log('\n▶ ۴) ساختار');
{
  const ev = (expr) => {
    const env = { READING_LLM_BUDGET_MS: 240_000, QUESTION_AUDIO_TIMEOUT_MS: 30_000 };
    return Function(...Object.keys(env), `return (${expr});`)(...Object.values(env));
  };
  const budget = ev(constMs('READING_LLM_BUDGET_MS'));
  const audio = ev(constMs('QUESTION_AUDIO_TIMEOUT_MS'));
  const max = Function('READING_LLM_BUDGET_MS', 'QUESTION_AUDIO_TIMEOUT_MS', `return (${constMs('READING_INFLIGHT_MAX_MS')});`)(budget, audio);
  const loadMin = Number(constMs('LOADING_MIN_MS')?.replace(/_/g, ''));
  ok(max > budget + audio, `سقفِ بیرونی بزرگ‌تر از بودجه + دانلودِ ویس است (${max} > ${budget + audio}) — در حالتِ عادی شلیک نمی‌کند`);
  ok(max + loadMin < OR_TIMEOUT_MS, `سقف + کفِ لودینگ زیرِ handlerTimeout است (${max + loadMin} < ${OR_TIMEOUT_MS}) — پیامِ ریفاند داخلِ همان هندلر می‌رسد`);
  ok(/new Telegraf\(BOT_TOKEN, \{ handlerTimeout: OR_TIMEOUT_MS \}\)/.test(SRC), 'handlerTimeout همان OR_TIMEOUT_MS است (مبنای ادعای بالا)');
}
{
  const aw = stripComments(bodyOf(SRC, 'async function awaitReadingLLM(uid, readingId) {') || '');
  ok(/hardTimeout\(callReadingLLM\(readingId, armOpts\), READING_INFLIGHT_MAX_MS\)/.test(aw),
    'ورودیِ llmInflight پشتِ سقفِ بیرونی ساخته می‌شود');
  ok(aw.indexOf('hardTimeout(') < aw.indexOf('llmInflight.set('), 'سقف **قبل از** ثبت در llmInflight روی promise می‌نشیند');
  const wl = stripComments(bodyOf(SRC, 'async function waitLLMWithLoading(ctx, uid, readingId, onFinalFailure = null) {') || '');
  ok(/while \(!done && Date\.now\(\) - startedAt < LOADING_MAX_MS\)/.test(wl), 'انیمیشنِ لودینگ سقفِ زمانی دارد (ادیتِ بی‌پایان ممنوع)');
  const fq = stripComments(bodyOf(SRC, 'async function fetchQuestionAudio(r) {') || '');
  ok(/signal: ctrl\.signal/.test(fq) && /hardTimeout\(/.test(fq) && /QUESTION_AUDIO_TIMEOUT_MS/.test(fq),
    'دانلودِ ویسِ سؤال هم abort و هم سقفِ سخت دارد');
  const orq = stripComments(bodyOf(CORE_SRC, 'export async function orRequest(body, meta = null) {') || '');
  ok(/hardTimeout\(work, limitMs \+ OR_HARD_GRACE_MS/.test(orq), 'orRequest پشتِ سقفِ سخت اجرا می‌شود');
  const stt = stripComments(bodyOf(CORE_SRC, 'async function sttRequest(model, dataB64, format, meta) {') || '');
  ok(/hardTimeout\(work, OR_TIMEOUT_MS \+ OR_HARD_GRACE_MS/.test(stt), 'مسیرِ رونویسیِ ویس هم سقفِ سخت دارد');
  ok(OR_HARD_GRACE_MS > 0 && OR_HARD_GRACE_MS <= 10_000, `مهلتِ اضافه کوتاه است (${OR_HARD_GRACE_MS}ms)`);
}

/* ═══ ۴ب) ناظرِ بیرونی (hungCycle در tools/stuck-detect.mjs) روی SQLite واقعی ═══
 * اگر روزی سقفِ درون‌رباتی هم کار نکرد، مالک باید خبردار شود نه کاربر. معیار دو دوره‌ای
 * است؛ هر ادعای منفی یک کنترلِ مثبت کنارش دارد (بند ۶ب-۲ ریشه). */
console.log('\n▶ ۴ب) ناظرِ فالِ گیرکرده');
{
  const { default: Database } = await import('../bots/tarot/node_modules/better-sqlite3/lib/index.js');
  const { hungCycle, confirmHung, HANG_MIN_AGE_SEC: MIN_AGE_SEC } = await import('./stuck-detect.mjs');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, llm_json TEXT NOT NULL DEFAULT '', created_at INTEGER)`);
  const now = 2_000_000_000;
  const add = (id, status, llm, age) => db.prepare('INSERT INTO readings VALUES (?,?,?,?,?)').run(id, 100 + id, status, llm, now - age);
  add(1, 'started', '', MIN_AGE_SEC + 60);       // گیرکرده‌ی واقعی
  add(2, 'started', '', 60);                      // تازه — همین حالا در حالِ تفسیر
  add(3, 'delivered', '', MIN_AGE_SEC + 60);      // تحویل‌شده
  add(4, 'started', '{"x":1}', MIN_AGE_SEC + 60); // خروجی دارد، فقط افشا مانده
  add(5, 'paid', '', MIN_AGE_SEC + 60);           // هنوز افشا شروع نشده
  const state = {};
  ok(hungCycle(db, 'tarot', state, now) === null, 'دورِ اول هرگز هشدار نمی‌دهد (فقط کاندید ثبت می‌شود)');
  ok(JSON.stringify(state.hung.tarot) === '[1]', 'کاندیدها فقط started + بی‌خروجی + قدیمی‌اند (#2 تازه، #3 تحویل، #4 خروجی‌دار، #5 paid بیرون)');
  const p = hungCycle(db, 'tarot', state, now + 300);
  ok(p && p.key === 'reading_hang:tarot' && /#1/.test(p.text) && !/#2/.test(p.text), 'دورِ دوم با همان کاندید هشدار می‌دهد (کنترلِ مثبت)');
  ok(p && /LLM_HANG/.test(p.text), 'متنِ هشدار عبارتِ قابلِ جست‌وجو برای Claude Code را دارد');
  db.prepare("UPDATE readings SET status='refunded' WHERE id=1").run();
  ok(hungCycle(db, 'tarot', state, now + 600) === null, 'بعد از ریفاند/تحویل هشدار خاموش می‌شود');
  ok(confirmHung([], [{ id: 9 }]).length === 0 && confirmHung([9], [{ id: 9 }]).length === 1, 'تأییدِ دو دوره‌ای: یک دوره کافی نیست، دو دوره هست');
  ok(confirmHung(['9'], [{ id: 9 }]).length === 1, 'state از JSON می‌آید؛ رشته و عدد یکی شمرده می‌شوند');
  ok(hungCycle(db, 'other', {}, now) === null, 'state per ربات جداست (دورِ اولِ رباتِ دیگر هشدار نمی‌دهد)');
  const hw = readFileSync(new URL('./health-watch.mjs', import.meta.url), 'utf8');
  ok(/\.\.\.\(await checkHungReadings\(state, now\)\)/.test(hw), 'health-watch واقعاً این ناظر را در آرایه‌ی problems صدا می‌زند');
  ok(/readonly:\s*true/.test(hw.slice(hw.indexOf('async function checkHungReadings'))), 'اتصالِ ناظر به دیتابیسِ ربات readonly است');
  db.close();
}

/* ═══ ۵) جهش‌ها روی سورسِ واقعی ═══
 * هر جهش یک نسخه‌ی موقتِ reading-core می‌سازد و همان سناریوی آویزان را اجرا می‌کند؛
 * باید **آویزان** بماند (یعنی چک بدونِ فیکس قرمز می‌شد). */
console.log('\n▶ ۵) جهش');
{
  const { writeFileSync, unlinkSync } = await import('fs');
  const mutate = (label, from, to) => ({ label, from, to });
  const muts = [
    mutate('orRequest بدونِ سقفِ سخت', 'return await hardTimeout(work, limitMs + OR_HARD_GRACE_MS, () => {', 'return await ((p) => p)(work, () => {'),
  ];
  for (const m of muts) {
    ok(CORE_SRC.includes(m.from), `جهش «${m.label}» واقعاً سورس را عوض می‌کند`);
    const tmp = new URL(`../bots/tarot/.mut-${process.pid}.mjs`, import.meta.url);
    writeFileSync(tmp, CORE_SRC.replace(m.from, m.to));
    try {
      const mcore = await import(`${tmp.href}?m=${Date.now()}`);
      global.fetch = async () => NEVER();
      const r = await within(mcore.orChatResilient('s', 'u', { validate: () => true, timeoutMs: LIMIT }, ['hang']), WAIT);
      ok(r.hung, `جهش «${m.label}» را می‌گیریم (بدونِ آن، زنجیره آویزان می‌ماند)`);
    } catch (e) {
      ok(false, `جهش «${m.label}» اجرا نشد: ${e.message}`);
    } finally {
      global.fetch = realFetch;
      try { unlinkSync(tmp); } catch {}
    }
  }
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
