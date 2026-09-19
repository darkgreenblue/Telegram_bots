#!/usr/bin/env node
// چکِ «قاعده‌ی آهنینِ هزینه» (بند ۹ CLAUDE.md ریشه):
//
//   تا وقتی از اعتبارِ کاربر کم نکرده‌ایم، هیچ فراخوانیِ پولیِ OpenRouter زده نمی‌شود.
//
// چرا این چک وجود دارد: باگِ واقعیِ ۱۴۰۵/۰۵/۲۵ که مالک با تستِ دستی پیدایش کرد. دو نقطه
// **قبل** از تصمیمِ کاربر پول خرج می‌کردند:
//   ۱) رونویسیِ ویس، لحظه‌ای که کاربر سؤالش را می‌فرستاد (خیلی قبل‌تر از پی‌وال)
//   ۲) پیش‌فراخوانیِ خوانش در finishPicking، درست قبل از نمایشِ پی‌وال
// یعنی کاربری که ویس می‌فرستاد و منصرف می‌شد، دو فراخوانی هزینه روی دستمان می‌گذاشت.
//
// این چک ساختاری **و** رفتاری است: هم می‌گوید گارد سرِ جایش هست، هم منطقش را واقعاً اجرا
// می‌کند، هم ترتیبِ کد را می‌سنجد (گاردی که بعد از خرجِ پول بیاید بی‌فایده است).
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
const LOC = fs.readFileSync(new URL('../bots/tarot/locales/fa.js', import.meta.url), 'utf8');
const CORE = fs.readFileSync(new URL('../bots/tarot/reading-core.js', import.meta.url), 'utf8');
// ماژول را واقعاً import می‌کنیم: پلنِ رونویسی باید **اجرا** سنجیده شود نه با رجکس
const core = await import('../bots/tarot/reading-core.js');
const TRANSCRIBE_PLAN = core.TRANSCRIBE_PLAN;

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); } };

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

// هر چیزی که به OpenRouter می‌رود و برای ما پول دارد
const PAID_CALLS = ['orChatResilient(', 'orTranscribe(', 'orChat(', 'orRequest('];

console.log('▶ گاردِ هزینه: هیچ فراخوانیِ پولی قبل از کسرِ اعتبار');
{
  // ۱) خودِ منطقِ گارد، واقعاً اجرا می‌شود (نه فقط وجود داشته باشد)
  const guardSrc = bodyOf(SRC, 'function paidForReading(');
  ok(!!guardSrc, 'تابعِ paidForReading وجود دارد');
  if (guardSrc) {
    const paidFor = new Function(`${guardSrc}; return paidForReading;`)();
    ok(paidFor({ price: 30000, status: 'pending_payment' }) === false,
      'فالِ پولیِ پرداخت‌نشده → فراخوانی ممنوع');
    ok(paidFor({ price: 30000, status: 'started' }) === true,
      'فالِ پولی بعد از کسرِ اعتبار (started) → فراخوانی مجاز');
    // v3.53.0: `paid` = پول همین حالا کسر شده (payForSpread در یک تراکنش)، پس مجاز است
    ok(paidFor({ price: 30000, status: 'paid' }) === true,
      'فالِ پولی که در لحظه‌ی انتخابِ اندازه کسر شده (paid) → فراخوانی مجاز');
    ok(paidFor({ price: 30000, status: 'canceled' }) === false, 'فالِ لغوشده → ممنوع');
    ok(paidFor({ price: 30000, status: 'refunded' }) === false,
      'فالِ ریفاندشده → ممنوع (تا retry دوباره کسر نکند)');
    ok(paidFor({ price: 30000, status: 'delivered' }) === false,
      'فالِ تحویل‌شده → ممنوع (خروجی از DB خوانده می‌شود، نه فراخوانیِ دوباره)');
    ok(paidFor({ price: 0, status: 'pending_payment' }) === true,
      'فالِ رایگان استثناست (چیزی برای کسر ندارد)');
  }

  // ۲) گارد باید **قبل از** هر خرجِ پول در همان تابع باشد
  const call = bodyOf(SRC, 'async function callReadingLLM(');
  ok(!!call, 'تابعِ callReadingLLM پیدا شد');
  if (call) {
    const gi = call.indexOf('paidForReading(');
    ok(gi > 0, 'callReadingLLM گاردِ paidForReading را صدا می‌زند');
    ok(/if \(!paidForReading\(r\)\) \{[\s\S]{0,200}return null;/.test(call),
      'گارد در صورتِ نقض، null برمی‌گرداند (نه ادامه‌ی بی‌صدا)');
    for (const c of PAID_CALLS) {
      const ci = call.indexOf(c);
      if (ci < 0) continue;
      ok(gi < ci, `«${c}» بعد از گارد می‌آید، نه قبلش`);
    }
  }
}

console.log('\n▶ نقاطی که قبلاً قاعده را می‌شکستند');
{
  // پیش‌فراخوانیِ قبل از پی‌وال کاملاً حذف شده — نه خاموش، حذف
  ok(!/function startPrefetch/.test(SRC), 'startPrefetch دیگر وجود ندارد');
  ok(!/startPrefetch\(/.test(SRC), 'هیچ‌جا startPrefetch صدا زده نمی‌شود');

  // finishPicking پیامِ بعدی‌اش پی‌وال است؛ اینجا هیچ خرجی مجاز نیست
  const fp = bodyOf(SRC, 'async function finishPicking(');
  ok(!!fp, 'تابعِ finishPicking پیدا شد');
  if (fp) {
    for (const c of PAID_CALLS) {
      ok(!fp.includes(c), `finishPicking هیچ «${c}» ندارد (کاربر هنوز تصمیم نگرفته)`);
    }
  }

  // هندلرِ ویس فقط ارجاعِ فایل را نگه می‌دارد؛ رونویسی آنجا یعنی خرجِ قبل از پرداخت
  const vh = bodyOf(SRC, "bot.on(['voice', 'audio']");
  ok(!!vh, 'هندلرِ ویس پیدا شد');
  if (vh) {
    for (const c of PAID_CALLS) {
      ok(!vh.includes(c), `هندلرِ ویس هیچ «${c}» ندارد`);
    }
    ok(/handleQuestion\(ctx, '', \{ id: media\.file_id/.test(vh),
      'هندلرِ ویس فقط file_id را جلو می‌برد (نه محتوای رونویسی‌شده)');
  }

  // رونویسی فقط داخلِ callReadingLLM مجاز است (یعنی پشتِ گارد)
  const transcribeCallers = [...SRC.matchAll(/orTranscribe\(/g)].length;
  const inReading = (bodyOf(SRC, 'async function callReadingLLM(') || '').match(/orTranscribe\(/g)?.length || 0;
  const defined = /function orTranscribe\(/.test(SRC) ? 1 : 0;
  ok(transcribeCallers - defined === inReading,
    `orTranscribe فقط از داخلِ callReadingLLM صدا زده می‌شود (${inReading} مورد)`);
}

/* 🚀 پیش‌فراخوانیِ بعد از سؤال (v3.53.0) — **رفتاری**.
 * این همان چیزی است که v3.4.0 حذفش کرد، ولی این‌بار پشتِ کسر است نه جلویش: فقط فالی که
 * `paid` است (payForSpread همین حالا پولش را کم کرده) پیش‌فراخوانی می‌شود. تابع از سورس
 * بریده و با استاب اجرا می‌شود تا ثابت شود روی هر وضعیتِ دیگری **هیچ** فراخوانی و هیچ
 * نوشتنی رخ نمی‌دهد. */
console.log('\n▶ پیش‌فراخوانی بعد از سؤال: فقط روی فالِ کسرشده');
{
  const pf = bodyOf(SRC, 'function prefetchReadingLLM(');
  ok(!!pf, 'تابعِ prefetchReadingLLM وجود دارد');
  ok(/const PREFETCH_AFTER_QUESTION = true;/.test(SRC), 'پرچمِ رول‌بکِ یک‌خطی هست و روشن است');
  for (const c of PAID_CALLS) ok(!pf.includes(c), `خودِ prefetchReadingLLM هیچ «${c}» ندارد (فقط awaitReadingLLM را صدا می‌زند)`);
  ok(pf.indexOf("r.status !== 'paid'") > 0 && pf.indexOf("r.status !== 'paid'") < pf.indexOf('awaitReadingLLM('),
    'شرطِ status=paid قبل از هر فراخوانی است');
  ok(pf.indexOf('setReadingCards') < pf.indexOf('awaitReadingLLM('),
    'کارت‌ها قبل از فراخوانی روی رکورد نوشته می‌شوند (مدل روی کارتِ واقعی می‌نویسد)');
  const hq = bodyOf(SRC, 'async function handleQuestion(');
  ok(hq.indexOf('patchSession(') < hq.indexOf('prefetchReadingLLM('),
    'پیش‌فراخوانی بعد از ثبتِ سؤال در سشن است');
  ok(!/await prefetchReadingLLM/.test(hq), 'پیش‌فراخوانی await نمی‌شود (پیامِ نیت معطل نمی‌ماند)');
  if (pf) {
    const rgp = bodyOf(SRC, 'function randomGridPicks(');
    const run = (row) => {
      const calls = [];
      const writes = [];
      const stmts = { getReading: { get: () => row }, setReadingCards: { run: (...a) => { writes.push(a); return { changes: 1 }; } } };
      const fn = new Function('PREFETCH_AFTER_QUESTION', 'stmts', 'SPREAD_BY_ID', 'drawCards', 'GRID_SIZE', 'randomInt',
        'getUser', 'patchSession', 'awaitReadingLLM', 'logErr',
        `${pf}\n${rgp}\nreturn prefetchReadingLLM(7, 42, { question: 'q' });`);
      const res = fn(true, stmts, { open3: { size: 3 } }, (seed, picks, size) => picks.slice(0, size).map(i => ({ key: 'k' + i })),
        24, (a, b) => a, () => ({}), () => {}, (uid, id) => { calls.push(id); return Promise.resolve(null); }, () => {});
      return { res, calls, writes };
    };
    const okRow = { id: 42, user_id: 7, status: 'paid', cards_json: '', type: 'open3' };
    const a = run(okRow);
    ok(a.res === true && a.calls.length === 1 && a.writes.length === 1, 'فالِ paidِ بی‌کارت → یک بار کارت نوشته و یک بار فراخوانی می‌شود');
    ok(JSON.parse(a.writes[0][1]).length === 3, 'دقیقاً به اندازه‌ی چیدمان کارت کشیده می‌شود');
    for (const st of ['pending_payment', 'started', 'refunded', 'canceled', 'delivered']) {
      const b = run({ ...okRow, status: st });
      ok(b.res === false && b.calls.length === 0 && b.writes.length === 0, `وضعیتِ ${st} → نه کارت، نه فراخوانی`);
    }
    const c = run({ ...okRow, cards_json: '[{"key":"x"}]' });
    ok(c.res === false && c.calls.length === 0 && c.writes.length === 0, 'فالِ کارت‌دار دوباره کشیده نمی‌شود');
    const d = run({ ...okRow, user_id: 8 });
    ok(d.res === false && d.calls.length === 0, 'رکوردِ کاربرِ دیگر رد می‌شود');
    // انتخابِ تصادفیِ گرید: یکتا و داخلِ بازه، روی هر سه اندازه
    const picksOf = new Function('GRID_SIZE', 'randomInt', `${rgp}; return randomGridPicks;`)(24, (lo, hi) => lo + Math.floor(Math.random() * (hi - lo)));
    for (const n of [3, 5, 10]) {
      const p = picksOf(n);
      ok(p.length === n && new Set(p).size === n && p.every(i => i >= 0 && i < 24), `${n} خانه‌ی یکتا از گریدِ ۲۴تایی`);
    }
  }
}

console.log('\n▶ سؤالِ صوتی: یک فراخوانی به‌جای دو تا');
{
  ok(/const AUDIO_DIRECT_ENABLED = true;/.test(SRC), 'پرچمِ AUDIO_DIRECT_ENABLED روشن است');
  // مهاجرتِ افزایشی (بند ۲ج/۱): فقط ADD COLUMN با DEFAULT
  ok(/ALTER TABLE readings ADD COLUMN question_audio TEXT NOT NULL DEFAULT ''/.test(SRC),
    'ستونِ question_audio افزایشی اضافه شده');
  ok(/ALTER TABLE readings ADD COLUMN question_audio_fmt TEXT NOT NULL DEFAULT ''/.test(SRC),
    'ستونِ question_audio_fmt افزایشی اضافه شده');
  ok(/INSERT INTO readings \([^)]*question_audio, question_audio_fmt\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?\)/.test(SRC),
    'insertReading هر دو ستون را می‌نویسد (۹ پارامتر)');

  // خودِ فایل به مدل می‌رود
  ok(/type: 'input_audio', input_audio: \{ data: audio\.data, format: audio\.format \}/.test(SRC),
    'فایلِ صوتی به‌عنوان content-part کنارِ پرامپت می‌رود');
  /* ⚠️ ادعا از «حتماً FLASH» به «حتماً بدونِ فالبکِ ناشنوا» تغییر کرد، چون مدلِ
   * خوانش حالا per زبان است (`READING_MODEL`). چیزی که باید تضمین شود همان است که
   * از اول بود: در ورودیِ صوتی هیچ مدلِ ناشنوایی وارد برنامه‌ی retry نشود. حالا دو
   * لایه این را تضمین می‌کنند: برنامه فقط از `READING_MODEL` ساخته می‌شود (نه
   * `FALLBACK_MODEL` که DeepSeek است)، و `audio` اصلاً غیرِ null نمی‌شود مگر
   * `READING_MODEL` صداشنو باشد (گاردِ `audioDirectOn`).
   * ⚠️ از v3.105.0 فقط **شاخه‌ی audio‌بودن** پین شده، نه کلِ خط: شاخه‌ی غیرِصوتی حالا
   * `armOpts?.plan`ِ آزمایشِ مدلِ خوانش را هم می‌گیرد (`check-reading-model-ab.mjs`
   * جدا همان را می‌سنجد)، و شاخه‌ی صوتی همچنان بیت‌به‌بیت ثابت است. */
  ok(/const plan = audio \? \[READING_MODEL, READING_MODEL, READING_MODEL\] : /.test(SRC),
    'برنامه‌ی retryِ صوتی فقط از READING_MODEL ساخته می‌شود و فالبکِ ناشنوا داخلش نیست');

  // نشتِ ویسِ فالِ قبلی به فالِ بعدی — باگی که موقعِ همین تغییر پیدا و بسته شد
  const hq = bodyOf(SRC, 'async function handleQuestion(');
  ok(!!hq, 'تابعِ handleQuestion پیدا شد');
  if (hq) {
    ok(/questionAudio: audio\?\.id \|\| ''/.test(hq) && /questionAudioFmt: audio\?\.fmt \|\| ''/.test(hq),
      'handleQuestion هر دو فیلد را همیشه می‌نویسد (سؤالِ متنی، ویسِ قبلی را پاک می‌کند)');
  }
  ok([...SRC.matchAll(/questionAudio:/g)].length === 1,
    'فقط یک نقطه در کل کد questionAudio را ست می‌کند (تک‌منبع)');

  // متنِ سؤال بدونِ فراخوانیِ دوم پر می‌شود
  ok(/if \(audio && parsed\.question_text\)/.test(SRC),
    'متنِ سؤالِ ویس از خروجیِ همان فراخوانی برداشته می‌شود، نه یک فراخوانیِ دوم');
  ok(/WHERE id=\? AND question=\?/.test(SRC),
    'ثبتِ متنِ سؤال شرط دارد تا متنِ موجود بازنویسی نشود');

  // گاردِ prompt-injection روی محتوای صوتی (بند ۹ ریشه: ورودی کاربر data است نه instruction)
  ok(/audioQuestionNote:/.test(LOC), 'بلوکِ راهنمای ورودی صوتی در locale است، نه در index.js');
  ok(/فقط \*\*داده\*\* است/.test(LOC), 'صریح گفته شده محتوای صوت داده است نه دستور');
  ok(/question_text/.test(LOC), 'پرامپت متنِ سؤال را می‌خواهد');
  // پرامپتِ مسیرِ متنی نباید عوض شده باشد: بلوکِ صوتی فقط وقتی audio هست چسبانده می‌شود
  ok(/const systemFinal = audio \? `\$\{system\}\\n\$\{L\.prompts\.audioQuestionNote\}` : system;/.test(SRC),
    'بلوکِ صوتی فقط در حالتِ صوتی به پرامپت اضافه می‌شود (مسیرِ متنی دست‌نخورده)');
}

console.log('\n▶ شبکه‌ی ایمنی بعد از پرداخت');
{
  // دانلودِ ویس بعد از کسرِ اعتبار است، پس شکستش باید به ریفاند برسد نه خوانشِ بی‌سؤال
  ok(/async function fetchQuestionAudio\(/.test(SRC), 'دانلودِ ویس تابعِ جدا دارد');
  ok(/logErr\(`reading#\$\{r\.id\} دانلودِ ویسِ سؤال شکست خورد:`/.test(SRC),
    'شکستِ دانلود لاگِ قابلِ grep دارد');
  ok(/buf\.length > MAX_VOICE_BYTES/.test(SRC),
    'حجمِ دانلودشده دوباره چک می‌شود (نه فقط موقعِ آپلود)');
  // مسیرِ ریفاند دست‌نخورده مانده
  ok(/REFUND path/.test(SRC), 'مسیرِ ریفاندِ شکستِ کاملِ LLM سرِ جایش است');
}

/* 🎙 گاردِ «مسیرِ مستقیمِ صدا فقط با مدلِ صداشنو».
 * 🐛 چرا: آزمایشگاه `gpt-5.6-luna` را برای زبان‌های غیرفارسی برنده کرد و آن مدل
 * ورودیِ صوتی نمی‌گیرد. بدونِ این گارد، اولین فالِ صوتیِ روسی **بعد از کسرِ
 * اعتبار** به مدلی می‌رفت که نمی‌تواند بشنود. این ادعا **رفتاری** است: بلوک از
 * سورس بریده و با چند مدل اجرا می‌شود، چون صرفِ وجودِ رشته چیزی را ثابت نمی‌کند. */
{
  const m = SRC.match(/const AUDIO_CAPABLE = \[[\s\S]*?const audioDirectOn = \(\) => AUDIO_DIRECT_ENABLED && READER_HEARS_AUDIO;/);
  ok(!!m, 'بلوکِ تشخیصِ صداشنو بودنِ مدل در index.js هست');
  if (m) {
    const run = (model, flag) =>
      new Function('READING_MODEL', 'AUDIO_DIRECT_ENABLED', `${m[0]}; return audioDirectOn();`)(model, flag);
    ok(run('google/gemini-2.5-flash', true) === true,
      'مدلِ زنده‌ی فارسی صداشنو است، پس مسیرِ تک‌فراخوانی دست‌نخورده می‌ماند');
    /* 🌍 گاردِ جداییِ دو مدل: `READING_MODEL` per زبان عوض می‌شود ولی `FLASH` که
     * رونویسیِ ویس و ایجنتِ رسید روی آن‌اند نباید همراهش برود. اگر یکی می‌شدند،
     * عوض‌کردنِ مدلِ خوانشِ روسی بی‌صدا رونویسی را هم می‌برد روی مدلی که صدا نمی‌فهمد. */
    /* ⚠️ از ۱۴۰۵/۰۶/۱۰ این ادعا **رفتاری** شد، نه رجکسی. قبلاً وجودِ رشته‌ی
     * `model: FLASH,` را می‌دید؛ حالا که رونویسی یک **پلن** است، همان رشته دیگر
     * وجود ندارد و ادعای رجکسی هم می‌شکست هم چیزی را ثابت نمی‌کرد. چیزی که واقعاً
     * باید تضمین شود دو چیز است و هر دو از خودِ ماژول خوانده می‌شود. */
    ok(TRANSCRIBE_PLAN[0] === core.FLASH,
      `پله‌ی اولِ رونویسی جمنای است نه مدلِ خوانش (${TRANSCRIBE_PLAN[0]})`);
    ok(!TRANSCRIBE_PLAN.includes(core.READING_MODEL) || core.READING_MODEL === core.FLASH,
      'مدلِ خوانش (که صدا نمی‌فهمد) در پلنِ رونویسی نیست');
    // فالبک باید واقعاً مستقل باشد: یک جمنایِ دوم قطعیِ خودِ جمنای را پوشش نمی‌دهد
    ok(TRANSCRIBE_PLAN.some((m) => !/^google\//.test(m)),
      'پلنِ رونویسی یک پله‌ی غیرِجمنایی دارد (فالبکِ واقعاً مستقل)');
    ok(/const READER_HEARS_AUDIO = AUDIO_CAPABLE\.some\(\(re\) => re\.test\(READING_MODEL\)\)/.test(SRC),
      'گاردِ صدا از READING_MODEL می‌خواند، نه از FLASH');
    for (const bad of ['openai/gpt-5.6-luna', 'deepseek/deepseek-v3.2', 'some/unknown-model'])
      ok(run(bad, true) === false, `«${bad}» صداشنو حساب نمی‌شود`);
    ok(run('google/gemini-2.5-flash', false) === false,
      'کلیدِ خاموشیِ دستیِ AUDIO_DIRECT_ENABLED هنوز کار می‌کند');
    ok(/if \(fetched && audioDirectOn\(\)\)/.test(SRC),
      'شاخه‌ی ویس از همین helper شاخه می‌گیرد، نه از پرچمِ خام');
  }
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);


if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
