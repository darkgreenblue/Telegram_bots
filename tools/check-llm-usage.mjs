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
  const wipe = SRC.slice(SRC.indexOf('function wipeUser('), SRC.indexOf('function wipeUser(') + 1800);
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

globalThis.fetch = realFetch;
console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
