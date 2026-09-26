#!/usr/bin/env node
/* 🔗 چکِ زنجیره‌های فالبک (تصمیمِ صریحِ مالک ۱۴۰۵/۰۶/۱۰).
 *
 * سه مسیرِ پولی این ریپو تا امروز فالبکِ کامل نداشتند و هر سه fail-safe اند، یعنی
 * خرابیشان **بی‌صدا** است:
 *   ۱) خوانش      — فالبک داشت، ولی مستقیم دیپ‌سیک؛ حالا جمنای پله‌ی میانی است.
 *   ۲) رونویسیِ ویس — **هیچ** فالبکی نداشت، و حالا تنها راهِ ورودِ ویس به محصول است
 *      (هر چهار زبان روی `luna` اند که صدا نمی‌فهمد).
 *   ۳) تعمیرِ نقطه‌ای — عمداً تک‌فراخوانی بود؛ دورِ هشتمِ روسی نشان داد اگر آن یک
 *      فراخوانی روی یک مدل بمیرد، کلِ گاردِ زبانی با صفر توکن و بی‌هیچ خطایی می‌رود.
 *
 * چک عمداً **رفتاری** است: `fetch` استاب می‌شود و ترتیبِ واقعیِ فراخوانی‌ها سنجیده
 * می‌شود، نه شکلِ آرایه‌ها. آرایه‌ی درست با کدی که آن را اجرا نمی‌کند بی‌ارزش است.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

process.env.OPENROUTER_API_KEY ||= 'test-key';
const core = await import('../bots/tarot/reading-core.js');
const rp = await import('../bots/tarot/repair.js');
const IDX = fs.readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');

/* ═══ ۱) زنجیره‌ی خوانش ═══ */
console.log('\n▶ زنجیره‌ی خوانش');
{
  const p = core.READING_PLAN;
  ok(p.length === 6, `شش تلاش (${p.length})`);
  ok(p[0] === core.READING_MODEL && p[1] === core.READING_MODEL && p[2] === core.READING_MODEL,
    'سه تلاشِ اول روی مدلِ خودِ زبان');
  ok(p[3] === core.FLASH, `فالبکِ اول جمنای است (${p[3]})`);
  ok(p[4] === core.GEMINI3_FLASH, `فالبکِ دوم جمنای ۳ است (${p[4]})`);
  ok(p[5] === core.FALLBACK_MODEL && /deepseek/.test(p[5]), `فالبکِ آخر دیپ‌سیک است (${p[5]})`);
  // ترتیب تزئینی نیست: جمنای تنها مدلی است که روی هر چهار زبان سنجیده شده و صدا هم
  // می‌فهمد؛ دیپ‌سیک در دورِ ۹ روسی هم بی‌لنگرِ بدتر داد هم دُمِ تأخیرِ ۳۱ثانیه‌ای.
  ok(p.indexOf(core.FLASH) < p.indexOf(core.FALLBACK_MODEL), 'جمنای قبل از دیپ‌سیک می‌آید');
}

/* ═══ ۲) زنجیره‌ی رونویسی — رفتاری، با استابِ fetch ═══ */
console.log('\n▶ زنجیره‌ی رونویسیِ ویس');
{
  const realFetch = globalThis.fetch;
  const calls = [];
  // `fail` می‌گوید کدام فراخوانی‌ها باید بشکنند (شبیه‌سازیِ خرابیِ مدلِ اول)
  const stub = (failFirstN, text = 'سلام دنیا') => async (url, opt) => {
    const body = JSON.parse(opt.body);
    // فرمت در دو شکلِ متفاوت می‌نشیند: endpointِ رونویسی آن را ریشه‌ای می‌گیرد و
    // chat completions داخلِ content-part. هر دو باید سنجیده شوند.
    const part = body.messages?.[0]?.content?.find?.((c) => c.type === 'input_audio');
    calls.push({ url: String(url), model: body.model, format: body.input_audio?.format || part?.input_audio?.format });
    if (calls.length <= failFirstN) return { ok: false, status: 503, text: async () => 'boom' };
    return { ok: true, json: async () => (String(url).includes('/audio/transcriptions')
      ? { text, usage: {} }
      : { choices: [{ message: { content: text } }], usage: {} }) };
  };
  const buf = Buffer.from('fake-audio');

  globalThis.fetch = stub(0);
  calls.length = 0;
  let out = await core.orTranscribe(buf, 'ogg');
  ok(out === 'سلام دنیا' && calls.length === 1, `مسیرِ سالم یک فراخوانی دارد (${calls.length})`);
  ok(calls[0].url.includes('/chat/completions') && calls[0].model === core.FLASH,
    'پله‌ی اول جمنای روی chat completions است');

  globalThis.fetch = stub(2);
  calls.length = 0;
  out = await core.orTranscribe(buf, 'ogg');
  ok(out === 'سلام دنیا' && calls.length === 3, `با شکستِ دو پله‌ی جمنای ۲٫۵، پله‌ی سوم جواب می‌دهد (${calls.length})`);
  ok(calls[2].url.includes('/chat/completions') && calls[2].model === core.GEMINI3_FLASH,
    `پله‌ی سوم جمنای ۳ روی chat completions است (${calls[2].model})`);

  globalThis.fetch = stub(3);
  calls.length = 0;
  out = await core.orTranscribe(buf, 'ogg');
  ok(out === 'سلام دنیا', 'با شکستِ سه پله‌ی جمنای، رونویسی همچنان جواب می‌دهد');
  ok(calls.length === 4, `دقیقاً چهار پله (${calls.length})`);
  ok(calls[3].url.includes('/audio/transcriptions'),
    'پله‌ی آخر به endpointِ اختصاصیِ رونویسی می‌رود، نه chat completions');
  ok(!/:stt$/.test(calls[3].model), `پسوندِ :stt به مدل نمی‌چسبد (${calls[3].model})`);
  ok(calls[3].model === 'openai/whisper-1', `فالبکِ نهایی ویسپر است (${calls[3].model})`);
  // ⚠️ بدونِ این ادعا، بایتِ ogg با برچسبِ mp3 به endpointِ رونویسی می‌رفت و **همیشه**
  // رد می‌شد؛ یعنی فالبک وجود داشت ولی هرگز کار نمی‌کرد. باگِ ثبت‌شده‌ی بندِ ۹ سندِ STT.
  ok(calls.every((c) => c.format === 'ogg'), 'برچسبِ فرمت در همه‌ی پله‌ها دست‌نخورده می‌ماند');

  globalThis.fetch = stub(99);
  calls.length = 0;
  out = await core.orTranscribe(buf, 'ogg');
  ok(out === null, 'با شکستِ همه‌ی پله‌ها null برمی‌گردد (خوانش نمی‌شکند)');
  ok(calls.length === core.TRANSCRIBE_PLAN.length, 'بیشتر از پلن تلاش نمی‌کند');

  // خروجیِ خالی هم شکست است، نه موفقیت: مدلی که رشته‌ی تهی بدهد باید پله‌ی بعد را باز کند
  globalThis.fetch = stub(0, '   ');
  calls.length = 0;
  out = await core.orTranscribe(buf, 'ogg');
  ok(out === null && calls.length === core.TRANSCRIBE_PLAN.length,
    'خروجیِ خالی موفقیت حساب نمی‌شود و پله‌ی بعد را باز می‌کند');

  globalThis.fetch = realFetch;
}

/* ═══ ۳) برچسبِ فرمتِ صدا ═══ */
console.log('\n▶ برچسبِ فرمتِ صدا (باگِ بمبِ ساعتی)');
{
  const m = IDX.match(/const AUDIO_FORMATS = \[[\s\S]*?const audioFormatOf = [^;]+;/);
  ok(!!m, 'بلوکِ نگاشتِ فرمت در index.js هست');
  if (m) {
    const fmt = new Function(`${m[0]}; return audioFormatOf;`)();
    ok(fmt('audio/ogg') === 'ogg', 'ویسِ تلگرام (audio/ogg) برچسبِ ogg می‌گیرد');
    ok(fmt('audio/ogg; codecs=opus') === 'ogg', 'ogg با codec هم درست است');
    ok(fmt('audio/webm; codecs=opus') === 'webm', 'نگاشت روی ظرف است نه کدک (webm/opus → webm)');
    /* ⚠️ صداقتِ تستِ جهش: برداشتنِ **ردیفِ** ogg از جدول این ادعاها را قرمز نمی‌کند،
     * چون پیش‌فرض خودش `ogg` است و خروجی برای هر ورودی‌ای عیناً همان می‌ماند. آن جهش
     * رفتار را عوض نمی‌کند، پس نگرفتنش نقصِ تست نیست. چیزی که واقعاً باید گرفته شود
     * «ogg برچسبِ mp3 بگیرد» است، و جهشِ پیش‌فرض دقیقاً همان را می‌سنجد. */
    ok(fmt('audio/mpeg') === 'mp3' && fmt('audio/wav') === 'wav', 'mp3 و wav هم درست‌اند');
    ok(fmt('audio/mp4') === 'm4a', 'm4a درست است');
    ok(fmt('') === 'ogg' && fmt(undefined) === 'ogg', 'پیش‌فرض ogg است نه mp3');
    ok(fmt('audio/ogg') !== 'mp3', 'خودِ باگِ قدیمی برنگشته (ogg دیگر mp3 برچسب نمی‌خورد)');
  }
}

/* ═══ ۴) زنجیره‌ی تعمیر ═══ */
console.log('\n▶ زنجیره‌ی تعمیرِ نقطه‌ای');
{
  ok(rp.REPAIR_PLAN.length === 3, `سه پله (${rp.REPAIR_PLAN.length})`);
  ok(rp.REPAIR_PLAN[0] === core.FLASH, `پله‌ی اول جمنای ۲٫۵ (${rp.REPAIR_PLAN[0]})`);
  ok(rp.REPAIR_PLAN[1] === core.GEMINI3_FLASH, `پله‌ی دوم جمنای ۳ (${rp.REPAIR_PLAN[1]})`);
  ok(!/^google\//.test(rp.REPAIR_PLAN[2]), `پله‌ی آخر غیرِجمنایی (${rp.REPAIR_PLAN[2]})`);
  ok(new Set(rp.REPAIR_PLAN).size === 3, 'هیچ دو پله‌ای یکی نیستند (فالبکِ بی‌اثر ممنوع)');
}

/* ═══ ۵) قاعده‌ی سراسری: بعد از آخرین FLASH در هر زنجیره، GEMINI3_FLASH (v3.121.0) ═══
 * اوپن‌روتر برای `gemini-2.5-flash` تاریخِ حذفِ 2026-10-20 گذاشته. ادعا روی **سورس**
 * است نه فقط export ها، تا زنجیره‌های درجای index.js (کارتِ روز، بازخورد، رسید، صوت) هم
 * پوشش بگیرند و زنجیره‌ی تازه‌ای که FLASH دارد و جمنای ۳ را جا انداخته قرمز شود. */
console.log('\n▶ جمنای ۳ بعد از جمنای ۲٫۵، در همه‌ی زنجیره‌ها');
{
  const files = ['../bots/tarot/index.js', '../bots/tarot/reading-core.js', '../bots/tarot/repair.js']
    .map((f) => [f, fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')]);
  let n = 0;
  for (const [f, src] of files) {
    for (const m of src.matchAll(/\[([A-Z_0-9, ]*\bFLASH\b[A-Z_0-9, ]*)\]/g)) {
      const items = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      if (!items.includes('FLASH')) continue;
      n++;
      const last = items.lastIndexOf('FLASH');
      ok(items[last + 1] === 'GEMINI3_FLASH', `${f.split('/').pop()}: [${items.join(', ')}] بعد از FLASH جمنای ۳ دارد`);
    }
  }
  ok(n >= 6, `دستِ‌کم شش زنجیره‌ی دارای FLASH پیدا شد (${n}) — کنترلِ مثبت`);
  // کنترلِ منفی: همان الگو روی زنجیره‌ی قدیمی قرمز می‌دهد
  const old = '[FLASH, FALLBACK_MODEL]'.match(/\[([A-Z_0-9, ]*\bFLASH\b[A-Z_0-9, ]*)\]/)[1].split(',').map((x) => x.trim());
  ok(old[old.lastIndexOf('FLASH') + 1] !== 'GEMINI3_FLASH', 'کنترلِ منفی: زنجیره‌ی قدیمی این ادعا را رد می‌کند');
  ok(core.GEMINI3_FLASH === 'google/gemini-3-flash-preview', `شناسه‌ی جمنای ۳ (${core.GEMINI3_FLASH})`);
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
for (const e of errs) console.log(`   - ${e}`);
assert.equal(errs.length, 0, `${errs.length} خطای زنجیره‌ی فالبک`);
