#!/usr/bin/env node
/* گاردِ دو مکانیزمِ کران‌دار کردنِ انتظارِ کاربر (v3.105.0).
 *
 * چرا رفتاری و نه رجکسی: هر دو مکانیزم فقط **بینِ دو تلاش** و **وسطِ یک fetch** معنا
 * دارند. ادعای متنی می‌تواند بگوید «کلمه‌ی cutRetry در فایل هست» ولی نمی‌تواند بگوید
 * تلاشِ دوم واقعاً رد شد. پس این چک خودِ `orChatResilient` را با `fetch`ِ استاب می‌دواند
 * و **مدل‌هایی که واقعاً درخواست شدند** را می‌شمارد.
 *
 * 🐛 و دلیلِ وجودش از یک باگِ واقعیِ همین کار می‌آید: نسخه‌ی اولِ سقفِ زمان
 * `opts.timeoutMs` را داخلِ `orRequest` خواند، در حالی که آن تابع اصلاً `opts` ندارد
 * (امضایش `(body, meta)` است). یعنی یک `ReferenceError` روی **هر فال** رباتِ زنده، که
 * `node --check` نمی‌گیردش و تستِ دودِ CI هم نمی‌بیند (همان کلاسِ باگِ `decideReceipt`).
 */
process.env.LOCALE = 'fa';
process.env.OPENROUTER_API_KEY = 'test-key-not-real';

const { orChatResilient, OR_TIMEOUT_MS } = await import('../bots/tarot/reading-core.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`✅ ${m}`); } else { fail++; console.log(`❌ ${m}`); } };

const realFetch = global.fetch;
/** fetchِ استاب: مدلِ هر درخواست را ثبت می‌کند و خروجیِ دلخواه می‌دهد. */
function stub({ reply = '{"bad":1}', hang = false } = {}) {
  const seen = [];
  global.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body).model);
    if (hang) await new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(
      Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }], usage: {} }) };
  };
  return seen;
}

/* ═══ ۱) برشِ تلاشِ دوباره ═══ */
const PLAN = ['modelA', 'modelA', 'modelB', 'modelB'];
{
  const seen = stub();
  await orChatResilient('s', 'u', { validate: () => false, cutRetry: () => false }, PLAN);
  ok(seen.join(',') === 'modelA,modelA,modelB,modelB',
    `بدونِ برش، کلِ برنامه اجرا می‌شود (${seen.join(',')})`);
}
{
  const seen = stub();
  await orChatResilient('s', 'u', { validate: () => false, cutRetry: () => true }, PLAN);
  ok(seen.join(',') === 'modelA,modelB',
    `با برشِ همیشه‌روشن، از هر مدل **یک** تلاش می‌رود (${seen.join(',')})`);
}
{
  // برش فقط بعد از تلاشِ اول روشن می‌شود: مدلِ اول یک تلاش، بعد برنامه‌ی عادی
  let n = 0;
  const seen = stub();
  await orChatResilient('s', 'u', { validate: () => false, cutRetry: () => (++n === 1) }, PLAN);
  ok(seen.join(',') === 'modelA,modelB,modelB',
    `برشِ یک‌باره فقط تکرارِ همان مدل را می‌بُرد، نه بقیه‌ی برنامه (${seen.join(',')})`);
}
{
  // کنترلِ مثبت: روی برنامه‌ی بی‌تکرار، برش باید no-op باشد
  const seen = stub();
  await orChatResilient('s', 'u', { validate: () => false, cutRetry: () => true }, ['x', 'y', 'z']);
  ok(seen.join(',') === 'x,y,z', `کنترلِ مثبت: برنامه‌ی بی‌تکرار با برش هم کامل می‌رود (${seen.join(',')})`);
}
{
  // predicate خراب هرگز نباید فال را بشکند
  const seen = stub();
  let threw = false;
  try {
    await orChatResilient('s', 'u', { validate: () => false, cutRetry: () => { throw new Error('boom'); } }, PLAN);
  } catch { threw = true; }
  ok(!threw && seen.length === 4, `predicateِ پرتاب‌کننده = «نبُر» و بدونِ خطا (${seen.length} تلاش)`);
}
{
  // مسیرِ موفق: اولین خروجیِ معتبر برمی‌گردد و برش بی‌اثر است
  const seen = stub({ reply: 'GOOD' });
  const r = await orChatResilient('s', 'u', { validate: (o) => o === 'GOOD', cutRetry: () => true }, PLAN);
  ok(r && r.model === 'modelA' && r.attempts === 1 && seen.length === 1,
    'خروجیِ معتبرِ تلاشِ اول بی‌درنگ برمی‌گردد');
}

/* ═══ ۲) سقفِ زمانِ per فراخوانی ═══ */
ok(OR_TIMEOUT_MS === 10 * 60 * 1000,
  `سقفِ سراسری دست‌نخورده است (${OR_TIMEOUT_MS / 60000} دقیقه) — این آزمایش آن را عوض نمی‌کند`);
{
  /* ⚠️ خودِ این ادعا باید **سریع** شکست بخورد، نه با صبر کردن.
   * 🐛 نسخه‌ی اولش فقط `await` می‌کرد. در تستِ جهشِ «سقف نادیده گرفته شود» همان await
   * تبدیل شد به **ده دقیقه** انتظار، یعنی گاردی که در رگرسیون CI را قفل می‌کند به‌جای
   * اینکه قرمز بدهد. پس مسابقه‌ی صریح با یک مهلتِ خودی. */
  const seen = stub({ hang: true });
  const t0 = Date.now();
  const LIMIT = 8000;
  const raced = await Promise.race([
    orChatResilient('s', 'u', { validate: () => true, timeoutMs: 1200 }, ['slowModel']),
    new Promise((res) => setTimeout(() => res('DEADLINE'), LIMIT)),
  ]);
  const dt = Date.now() - t0;
  ok(raced !== 'DEADLINE', `سقفِ per فراخوانی واقعاً abort می‌کند (در ${dt}ms، مهلتِ تست ${LIMIT}ms)`);
  ok(raced === null, 'و نتیجه‌ی شکست `null` است، پس مسیرِ فالبک/ریفاند عادی می‌ماند');
  ok(seen.length === 1, 'یک تلاش رفت');
}
{
  /* کنترلِ مثبت برای همان: بدونِ `timeoutMs` باید سقفِ سراسری اعمال شود. ادعا را با
   * خواندنِ خودِ مقدارِ ارسالی به setTimeout می‌سنجیم، چون ده دقیقه صبر کردن ممکن نیست. */
  const spy = [];
  const realST = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => { spy.push(ms); return realST(fn, ms, ...a); };
  stub({ reply: 'GOOD' });
  await orChatResilient('s', 'u', { validate: () => true }, ['m']);
  global.setTimeout = realST;
  ok(spy.includes(OR_TIMEOUT_MS),
    `کنترلِ مثبت: بدونِ timeoutMs همان سقفِ سراسری به abort داده می‌شود (${spy.join(',')})`);
}
{
  // و `timeoutMs` نباید به **بدنه‌ی ریکوئست** برود (قاعده‌ی «لایه‌ی حسابداری روی خروجی اثر نگذارد»)
  let body = null;
  global.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'GOOD' } }], usage: {} }) };
  };
  await orChatResilient('s', 'u', { validate: () => true, timeoutMs: 5000, cutRetry: () => false }, ['m']);
  ok(body && !('timeoutMs' in body) && !('cutRetry' in body),
    `نه timeoutMs و نه cutRetry در بدنه‌ی ریکوئست نیستند (کلیدها: ${Object.keys(body || {}).join(',')})`);
}

/* ═══ ۳) سقفِ کلِ زنجیره ═══
 * یک timeout برای هر درخواست کافی نیست: اگر مدلِ اول کلِ زمانِ هندلر را بخورد، فالبک
 * هرگز شلیک نمی‌کند. deadlineAt باید درخواستِ در حال اجرا را با زمانِ باقی‌مانده ببندد
 * و پیش از تلاشِ بعدی هم زنجیره را متوقف کند. */
{
  const seen = stub({ hang: true });
  const t0 = Date.now();
  const r = await Promise.race([
    orChatResilient('s', 'u', { validate: () => true, deadlineAt: Date.now() + 1_200 }, ['slow', 'fallback']),
    new Promise((res) => setTimeout(() => res('DEADLINE'), 8_000)),
  ]);
  const dt = Date.now() - t0;
  ok(r !== 'DEADLINE' && r === null, `بودجه‌ی کل زنجیره، مدل آویزان را پیش از مهلت بیرونی می‌بندد (${dt}ms)`);
  ok(seen.join(',') === 'slow', 'بعد از اتمام بودجه، فالبکِ دیرهنگام اجرا نمی‌شود');
}
{
  // کنترلِ مثبت: اگر هنوز بودجه مانده باشد، timeout مدل اول باید **واقعاً** به فالبک برسد.
  const seen = [];
  global.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    seen.push(model);
    if (model === 'primary') {
      await new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(
        Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'GOOD' } }], usage: {} }) };
  };
  const r = await orChatResilient('s', 'u', {
    validate: (out) => out === 'GOOD', timeoutMs: 1_200,
    deadlineAt: Date.now() + 5_000, cutRetry: () => true,
  }, ['primary', 'primary', 'fallback']);
  ok(r?.model === 'fallback' && seen.join(',') === 'primary,fallback',
    'timeout مدل اول با بودجه‌ی باقی‌مانده به فالبکِ مستقل می‌رسد (نه refund زودرس)');
}

global.fetch = realFetch;
console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
