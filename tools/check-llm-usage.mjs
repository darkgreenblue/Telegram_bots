#!/usr/bin/env node
// 🧾 چکِ «حسابداریِ مصرفِ مدل هزینه را می‌شمارد، ولی به کیفیتِ فال دست نمی‌زند».
//
// چرا این فایل هست: تا امروز هزینه‌ی واقعیِ OpenRouter در هیچ دیتابیسی ثبت نمی‌شد و
// داشبورد خودش آن را «مهم‌ترین عددِ گمشده» نامیده بود. حالا ثبت می‌شود، ولی این ثبت
// روی همان مسیری نشسته که فالِ کاربرِ پولی از آن رد می‌شود. پس شرطِ صریحِ مالک این بود:
// «مطمئن شو هیچ تأثیری روی کیفیت ربات و فال‌ها ندارد».
//
// این چک همان شرط را **اجرا** می‌کند، نه اینکه فقط ادعایش را بخواند:
//   ۱) بدنه‌ی ریکوئست **بایت‌به‌بایت** همان قبلی است — هیچ فیلدی اضافه نشده. هزینه از
//      `usage.cost` خوانده می‌شود که OpenRouter در هر پاسخ می‌گذارد (پارامترِ قدیمیِ
//      `usage:{include:true}` رسماً منسوخ و بی‌اثر است). یعنی صفر تغییر روی سیم.
//   ۲) سینکِ ثبت اگر بترکد، متنِ فال سالم برمی‌گردد (خطا بلعیده می‌شود).
//   ۳) خودِ عددها درست به سینک می‌رسند (توکن، هزینه، برچسبِ مسیر).
//   ۴) رول‌بک: خاموش‌کردنِ ثبت هیچ ردیفی نمی‌سازد و بدنه باز هم دست‌نخورده است.
//   ۵) ریستِ حسابِ ادمین دفترِ هزینه را پاک نمی‌کند (دیتای مالی است، نه دیتای کاربر).
//
// اجرا: node tools/check-llm-usage.mjs
import { readFileSync } from 'fs';
import path from 'path';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const SRC = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
const CORE = readFileSync(path.resolve('bots/tarot/reading-core.js'), 'utf8');

/* ── استابِ شبکه: هیچ ریکوئستِ واقعی‌ای زده نمی‌شود ───────────────────────────── */
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540, cost: 0.00271 },
    }),
  };
};
process.env.OPENROUTER_API_KEY = 'test-key';
const core = await import('../bots/tarot/reading-core.js');

console.log('▶ ۱) بدنه‌ی ریکوئست بایت‌به‌بایت همان قبلی است');
{
  sent.length = 0;
  core.setUsageSink(null);
  await core.orChat('SYS', 'USR', { model: core.FLASH, maxTokens: 1600, temperature: 0.9 });
  const body = sent[0].body;
  ok(sent.length === 1, 'دقیقاً یک ریکوئست رفت');
  ok(body.model === core.FLASH, 'model عوض نشده');
  ok(body.temperature === 0.9, 'temperature عوض نشده');
  ok(body.max_tokens === 1600, 'max_tokens عوض نشده');
  ok(JSON.stringify(body.reasoning) === '{"enabled":false}', 'خاموشیِ reasoning عوض نشده');
  ok(body.messages.length === 2 && body.messages[0].content === 'SYS' && body.messages[1].content === 'USR',
    'پیام‌ها (سیستم و کاربر) عیناً همان‌اند');
  // ⚠️ مهم‌ترین ادعای این فایل: **هیچ** کلیدِ اضافه‌ای روی سیم نیست.
  const keys = Object.keys(body).sort().join(',');
  ok(keys === 'max_tokens,messages,model,reasoning,temperature',
    `کلیدهای بدنه دقیقاً همان‌های قبل از این تغییرند (دیده شد: ${keys})`);
  ok(!('usage' in body), 'هیچ پرچمِ حسابداری‌ای روی سیم نمی‌رود (OpenRouter هزینه را خودش می‌دهد)');
  // برچسبِ حسابداری هرگز نباید به سیم برود (وگرنه یک فیلدِ ناشناخته در ریکوئست است)
  ok(!('kind' in body) && !('refId' in body) && !('userId' in body),
    'برچسبِ مسیر/رکورد/کاربر روی سیم نمی‌رود');
  ok(core.USAGE_INCLUDE_FLAG === false, 'دریچه‌ی اضطراریِ پرچمِ منسوخ عمداً خاموش است');
}

console.log('\n▶ ۲) سینکِ خراب نمی‌تواند فال را بشکند');
{
  sent.length = 0;
  core.setUsageSink(() => { throw new Error('DB منفجر شد'); });
  const res = await core.orChat('SYS', 'USR', { model: core.FLASH, kind: 'reading', refId: 7, userId: 9 });
  ok(res?.text === '{"ok":true}', 'با وجودِ ترکیدنِ ثبت، متنِ مدل سالم برگشت');
}

console.log('\n▶ ۳) عددها و برچسب‌ها درست به دفتر می‌رسند');
{
  const rec = [];
  core.setUsageSink((u) => rec.push(u));
  await core.orChat('SYS', 'USR', { model: core.FLASH, kind: 'reading', refId: 42, userId: 100257975 });
  const u = rec[0] || {};
  ok(rec.length === 1, 'یک ردیف ثبت شد');
  ok(u.kind === 'reading' && u.refId === 42 && u.userId === 100257975, 'مسیر، رکورد و کاربر درست‌اند');
  ok(u.promptTokens === 1200 && u.completionTokens === 340 && u.totalTokens === 1540, 'توکن‌ها درست‌اند');
  ok(u.costUsd === 0.00271, 'هزینه‌ی دلاریِ خودِ OpenRouter ثبت می‌شود');
  ok(typeof u.ms === 'number', 'مدتِ فراخوانی هم ثبت می‌شود');

  // هزینه‌ی نیامده = صفر، نه یک عددِ حدسی از جدولِ قیمتِ داخلی
  rec.length = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 5 } }) });
  await core.orChat('S', 'U', {});
  globalThis.fetch = prevFetch;
  ok(rec[0]?.costUsd === 0, 'نبودِ هزینه در پاسخ = صفر (هیچ عددی از خودمان ساخته نمی‌شود)');
}

console.log('\n▶ ۴) رول‌بکِ یک‌خطی: ثبت خاموش می‌شود، بدنه همچنان دست‌نخورده');
{
  ok(/export const USAGE_ACCOUNTING = true;/.test(CORE), 'پرچمِ ثبت یک ثابتِ تک‌خطی است');
  ok(/export const USAGE_INCLUDE_FLAG = false;/.test(CORE), 'دریچه‌ی اضطراری هم یک ثابتِ تک‌خطیِ خاموش است');
  ok(/if \(usageSink && USAGE_ACCOUNTING\)/.test(CORE), 'خاموش‌کردنِ پرچم جلوی هر ثبتی را می‌گیرد');
  // اثباتِ رفتاریِ همان منطق: مقدارِ undefined اصلاً در JSON نوشته نمی‌شود
  const wire = JSON.stringify({ ...{ model: 'm', messages: [] }, usage: false ? { include: true } : undefined });
  ok(!wire.includes('usage'), 'با دریچه‌ی خاموش، رشته‌ی نهایی هیچ usage ای ندارد');
  const on = JSON.stringify({ ...{ model: 'm' }, usage: true ? { include: true } : undefined });
  ok(on.includes('"usage":{"include":true}'), 'و با روشن‌کردنش دقیقاً همان یک فیلد اضافه می‌شود، نه بیشتر');
}

console.log('\n▶ ۵) دفترِ هزینه دیتای کاربر نیست و با ریستِ ادمین پاک نمی‌شود');
{
  ok(/CREATE TABLE IF NOT EXISTS llm_usage/.test(SRC), 'جدولِ llm_usage ساخته می‌شود');
  ok(/idx_llm_usage_created/.test(SRC), 'ایندکسِ زمانی دارد (کوئریِ بازه‌ایِ داشبورد)');
  // ⚠️ کامنت‌ها **قبل از** سنجش حذف می‌شوند: بدونِ این، اولین کامنتی که نامِ جدول را
  // توضیحی ببرد یک ادعای کاملاً سالم را قرمزِ کاذب می‌کند. این ششمین بارِ ثبت‌شده‌ی
  // همین تله در این ریپوست (v3.56.0، v3.64.0، check-price-ladder، check-invoice-page…).
  const wipeRaw = SRC.slice(SRC.indexOf('function wipeUser('), SRC.indexOf('function wipeUser(') + 1800);
  const wipe = wipeRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/llm_usage/.test(wipe), 'wipeUser به دفترِ هزینه دست نمی‌زند');
  // ثبت باید خودش گاردِ دوم داشته باشد، نه اینکه فقط به try/catchِ هسته تکیه کند
  const sink = SRC.slice(SRC.indexOf('setUsageSink((u) =>'), SRC.indexOf('setUsageSink((u) =>') + 700);
  ok(/try \{/.test(sink) && /catch/.test(sink), 'خودِ ثبت‌کننده هم try/catch دارد (گاردِ دوم)');
}

console.log('\n▶ ۶) همه‌ی مسیرهای مدلِ تاروت برچسب دارند (وگرنه هزینه بی‌نام می‌شود)');
{
  for (const k of ['reading', 'repair', 'daily_card', 'feedback', 'transcribe']) {
    ok(SRC.includes(`kind: '${k}'`), `مسیرِ «${k}» برچسبِ حسابداری دارد`);
  }
}

/* ══ ۷) توکنِ کش‌شده و توکنِ استدلال (v3.82.0) ═══════════════════════════════
 *
 * چرا این بخش هست: بدونِ عددِ کشِ پرامپت نمی‌دانیم «۱۰٪ صرفه‌جویی روی میز است» یا
 * «صفر». ولی این عدد روی همان مسیری خوانده می‌شود که فالِ کاربرِ پولی از آن رد
 * می‌شود، پس همان شرطِ صریحِ مالک این‌جا هم برقرار است: **صفر تغییر روی سیم**.
 *
 * ⚠️ و نکته‌ی روشیِ این بخش: نامِ دقیقِ فیلدها **تأییدنشده** است (مستنداتِ OpenRouter
 * از این محیط باز نمی‌شود، بند ۹/۰الف ریشه). پس چک نمی‌تواند بگوید «نامِ درست همین
 * است»؛ چیزی که می‌تواند بگوید این است که استخراج‌کننده **چند شکلِ محتمل** را می‌بیند،
 * نامِ ناشناخته را به‌جای حدس‌زدن صفر می‌کند، و لاگِ تشخیصی یک بار شلیک می‌شود.
 */
console.log('\n▶ ۷) توکنِ کش‌شده و استدلال: خوانده می‌شوند، ولی چیزی از سرور خواسته نمی‌شود');
{
  const seen = [];
  core.setUsageSink((u) => seen.push(u));
  const prevFetch = globalThis.fetch;
  const withUsage = (usage) => async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }], usage }) };
  };
  const shapes = [
    ['سبکِ تودرتوی OpenAI/OpenRouter', { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 64 } }, 64],
    ['سبکِ تختِ Anthropic', { prompt_tokens: 100, cache_read_input_tokens: 55 }, 55],
    ['سبکِ DeepSeek', { prompt_tokens: 100, prompt_cache_hit_tokens: 33 }, 33],
    ['کلیدِ تختِ ساده', { prompt_tokens: 100, cached_tokens: 22 }, 22],
  ];
  for (const [name, usage, want] of shapes) {
    seen.length = 0;
    globalThis.fetch = withUsage(usage);
    await core.orChat('S', 'U', {});
    ok(seen[0]?.cachedTokens === want, `${name}: عددِ کش (${want}) خوانده شد`, );
  }
  // استدلال، هر دو شکل
  for (const [name, usage, want] of [
    ['تودرتو', { completion_tokens_details: { reasoning_tokens: 77 } }, 77],
    ['تخت', { reasoning_tokens: 12 }, 12],
  ]) {
    seen.length = 0;
    globalThis.fetch = withUsage(usage);
    await core.orChat('S', 'U', {});
    ok(seen[0]?.reasoningTokens === want, `توکنِ استدلال، شکلِ ${name} (${want}) خوانده شد`);
  }
  // ⚠️ کنترلِ منفی: نامِ ناشناخته **حدس زده نمی‌شود**. بدونِ این ادعا، یک استخراج‌کننده‌ی
  // بیش‌ازحد پهن (مثلاً «هر کلیدی که cache در آن باشد») هم سبز رد می‌شد.
  seen.length = 0;
  globalThis.fetch = withUsage({ prompt_tokens: 100, some_unknown_cache_field: 999, cost: 0.1 });
  await core.orChat('S', 'U', {});
  ok(seen[0]?.cachedTokens === 0 && seen[0]?.reasoningTokens === 0,
    'نامِ ناشناخته ⟵ صفر، نه حدس');
  ok(seen[0]?.costUsd === 0.1, 'و بقیه‌ی ثبت دست‌نخورده کار می‌کند (کنترلِ مثبت)');
  // نبودِ کلِ فیلدها هم صفر است، نه undefined (وگرنه ستونِ NOT NULL می‌ترکد)
  seen.length = 0;
  globalThis.fetch = withUsage({ prompt_tokens: 5 });
  await core.orChat('S', 'U', {});
  ok(seen[0]?.cachedTokens === 0 && seen[0]?.reasoningTokens === 0, 'نبودِ فیلد ⟵ صفرِ عددی');

  // 🔒 مهم‌ترین ادعای این بخش: با وجودِ خواندنِ دو عددِ تازه، بدنه **هنوز** همان است.
  sent.length = 0;
  globalThis.fetch = withUsage({ prompt_tokens: 9, prompt_tokens_details: { cached_tokens: 4 } });
  await core.orChat('SYS', 'USR', { model: core.FLASH, maxTokens: 1600, temperature: 0.9 });
  const keys2 = Object.keys(sent[0].body).sort().join(',');
  ok(keys2 === 'max_tokens,messages,model,reasoning,temperature',
    `بدنه بعد از افزودنِ این دو عدد هم بایت‌به‌بایت همان است (دیده شد: ${keys2})`);
  globalThis.fetch = prevFetch;
}

console.log('\n▶ ۷ب) لاگِ تشخیصیِ شکلِ usage دقیقاً یک بار در عمرِ پروسه شلیک می‌شود');
{
  // ماژولِ **تازه** (کش‌شکنیِ ESM) تا شمارنده‌ی یک‌باره از صفر شروع شود.
  const fresh = await import('../bots/tarot/reading-core.js?shape=1');
  fresh.setUsageSink(() => {});
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content: 'x' } }],
    usage: { prompt_tokens: 9, prompt_tokens_details: { cached_tokens: 4 }, cost: 0.001 },
  }) });
  await fresh.orChat('S', 'U', {});
  await fresh.orChat('S', 'U', {});
  globalThis.fetch = prevFetch;
  console.log = realLog;
  const hits = lines.filter(l => l.includes('USAGE_SHAPE'));
  ok(hits.length === 1, `دقیقاً یک بار (دیده شد: ${hits.length})`);
  ok(hits[0]?.includes('prompt_tokens_details.cached_tokens'),
    'کلیدِ تودرتو هم در لاگ باز می‌شود (وگرنه نامِ واقعی هرگز معلوم نمی‌شود)');
  ok(!hits[0]?.includes('"'), 'فقط کلیدها لاگ می‌شوند، نه محتوای پاسخ');
}

console.log('\n▶ ۸) ستون‌های تازه: مهاجرتِ افزایشی و هم‌خوانیِ INSERT با جدول');
{
  const { default: Database } = await import('../bots/tarot/node_modules/better-sqlite3/lib/index.js');
  // CREATE + ALTERها + خودِ INSERT، همه **از سورس**. اگر یکی‌شان با بقیه واگرا شود،
  // ثبت در پروداکشن می‌ترکد و چون داخلِ try/catch است **بی‌صدا** کلِ دفتر را می‌خشکاند.
  const create = SRC.slice(SRC.indexOf('CREATE TABLE IF NOT EXISTS llm_usage'));
  const createSql = create.slice(0, create.indexOf(');') + 2);
  const alters = [...SRC.matchAll(/db\.prepare\('(ALTER TABLE llm_usage ADD COLUMN [^']+)'\)/g)].map(m => m[1]);
  ok(alters.length === 2, `دو ستونِ افزایشی در سورس هست (دیده شد: ${alters.length})`);
  ok(alters.every(a => /NOT NULL DEFAULT 0/.test(a)),
    'هر دو ستون `NOT NULL DEFAULT 0` اند (ردیف‌های قدیمی معتبر می‌مانند، بند ۲ج/۱)');
  ok(alters.some(a => /cached_tokens/.test(a)) && alters.some(a => /reasoning_tokens/.test(a)),
    'نامِ هر دو ستون همان‌هایی است که سینک می‌نویسد');

  const db = new Database(':memory:');
  db.exec(createSql);
  // ردیفِ «قدیمی» قبل از مهاجرت، تا معتبر ماندنش اثبات شود.
  db.prepare("INSERT INTO llm_usage (user_id, kind, ref_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, ms) VALUES (1,'reading',5,'m',10,20,30,0.5,100)").run();
  for (const a of alters) db.prepare(a).run();
  ok(db.prepare('SELECT cached_tokens c FROM llm_usage WHERE user_id=1').get().c === 0,
    'ردیفِ قبل از مهاجرت صفر می‌گیرد، نه NULL');
  // اجرای دوباره (ری‌استارت) باید خطا بدهد و کد آن را بلعیده باشد — یعنی idempotent.
  let threw = false;
  try { db.prepare(alters[0]).run(); } catch { threw = true; }
  ok(threw, 'ALTERِ تکراری خطا می‌دهد (پس گاردِ try/catchِ سورس واقعاً لازم است)');
  ok(/try \{ db\.prepare\('ALTER TABLE llm_usage ADD COLUMN cached_tokens[^\n]*catch \{\}/.test(SRC),
    'و همان گارد در سورس هست (ری‌استارت بوت را نمی‌شکند)');

  // خودِ INSERTِ واقعیِ ربات با ۱۱ پارامتر روی همین جدول اجرا می‌شود.
  const insSql = SRC.match(/insertLlmUsage:\s*db\.prepare\(`([\s\S]*?)`\)/)?.[1];
  ok(!!insSql, 'SQLِ ثبت از سورس بریده شد');
  ok(insSql && /cached_tokens/.test(insSql) && /reasoning_tokens/.test(insSql),
    'INSERT هر دو ستونِ تازه را می‌نویسد');
  if (insSql) {
    const cols = insSql.match(/\(([^)]*)\)\s*VALUES/)?.[1].split(',').length;
    const marks = (insSql.match(/VALUES\s*\(([^)]*)\)/)?.[1].match(/\?/g) || []).length;
    ok(cols === marks, `تعدادِ ستون و placeholder یکی است (${cols} / ${marks})`);
    db.prepare(insSql).run(2, 'reading', 6, 'm', 100, 50, 150, 0.002, 900, 64, 0);
    const row = db.prepare('SELECT cached_tokens c, reasoning_tokens r FROM llm_usage WHERE user_id=2').get();
    ok(row.c === 64 && row.r === 0, 'ثبتِ واقعی روی جدولِ واقعی می‌نشیند');
  }

  /* 🔌 سیمِ بینِ استخراج‌کننده و SQL — تنها جایی که «مقدار وجود دارد» با «مقدار
   * می‌رسد» فرق می‌کند (بند ۲و/۶ب ریشه). بدونِ این ادعا، هاردکد کردنِ `0, 0` در سینک
   * از همه‌ی ادعاهای بالا سبز رد می‌شد: هم استخراج درست بود، هم جدول، هم INSERT —
   * و ستونِ کش برای همیشه صفر می‌ماند بدونِ هیچ خطایی. (این جهش واقعاً زنده ماند تا
   * وقتی این ادعا اضافه شد.) */
  const sinkSrc = SRC.slice(SRC.indexOf('setUsageSink((u) => {'));
  const sinkBody = sinkSrc.slice(0, sinkSrc.indexOf('\n});') + 4);
  ok(!!sinkBody && sinkBody.length < 1500, 'بدنه‌ی سینک از سورس بریده شد');
  const got = [];
  const fakeStmts = { insertLlmUsage: { run: (...a) => got.push(a) } };
  new Function('setUsageSink', 'stmts', 'logErr', sinkBody)(
    (fn) => fn({
      userId: 7, kind: 'reading', refId: 3, model: 'm',
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
      costUsd: 0.002, ms: 900, cachedTokens: 64, reasoningTokens: 12,
    }),
    fakeStmts, () => {},
  );
  ok(got.length === 1, 'سینک دقیقاً یک بار می‌نویسد');
  const args = got[0] || [];
  ok(args.length === 11, `سینک ۱۱ آرگومان پاس می‌دهد (دیده شد: ${args.length})`);
  ok(args[9] === 64, `عددِ کش واقعاً به SQL می‌رسد (دیده شد: ${args[9]})`);
  ok(args[10] === 12, `عددِ استدلال واقعاً به SQL می‌رسد (دیده شد: ${args[10]})`);
  // و همان آرگومان‌ها روی جدولِ واقعی همان ستون‌ها را پر می‌کنند (ترتیب هم درست است).
  if (insSql) {
    db.prepare(insSql).run(...args);
    const r2 = db.prepare('SELECT cached_tokens c, reasoning_tokens r FROM llm_usage WHERE user_id=7').get();
    ok(r2.c === 64 && r2.r === 12, 'و در ستونِ درست می‌نشینند (ترتیبِ آرگومان‌ها سالم است)');
  }
  db.close();
}

globalThis.fetch = realFetch;
console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
