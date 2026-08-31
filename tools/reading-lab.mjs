#!/usr/bin/env node
// 🧪 آزمایشگاهِ خوانش — شبیه‌سازیِ کاملِ کاربر بدونِ تلگرام و بدونِ دیتابیس.
//
// چرا هست: تا امروز تنها راهِ سنجیدنِ کیفیتِ خوانش، طی‌کردنِ دستیِ فلو در خودِ ربات بود
// (انتخابِ کارت، انتظار، و بعد کپیِ ده‌ها پیام). این یعنی هر دورِ بهبود ساعت‌ها کارِ دستی
// می‌خواست و عملاً بیشتر از دو سه فال تست نمی‌شد. حالا کلِ مسیرِ «کاربرِ جدید → چند فالِ
// پشتِ سرِ هم با حافظه‌ی انباشته» آفلاین اجرا می‌شود و خروجی با معیارهای مکانیکی سنجیده
// می‌شود، در چند دقیقه و با چند سنت.
//
// ⚠️ این کپیِ ربات نیست: پرامپت از `locales/fa.js`، کلاینتِ OpenRouter و موتورِ دک و
// کانتکست و رندر از `bots/tarot/reading-core.js`، و شرطِ پذیرش از همان‌جا + `verdict.js`
// می‌آید. یعنی هر چیزی که این‌جا می‌بینی دقیقاً همان چیزی است که کاربر می‌بیند.
//
// ⚠️ هزینه: هر فال یک فراخوانیِ واقعیِ OpenRouter است و روی **کلیدِ خودِ تاروت** می‌نشیند
// (همان `OPENROUTER_API_KEY`). یک فالِ سه‌کارتی حدود ۰.۶ سنت و صلیب سلتی حدود ۱.۳ سنت.
//
// اجرا:
//   node tools/reading-lab.mjs --dry              # بدونِ فراخوانی: فقط اندازه‌ی ورودی و سلامتِ خطِ لوله
//   node tools/reading-lab.mjs                    # اجرای کاملِ همه‌ی پرسوناها
//   node tools/reading-lab.mjs --only P1,P2       # فقط چند پرسونا
//   node tools/reading-lab.mjs --out out.json     # ذخیره‌ی خامِ همه‌چیز برای مقایسه‌ی دورِ بعد
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPREAD_BY_ID, topicOf } from '../bots/tarot/spreads.js';
import { CARD_BY_KEY } from '../bots/tarot/cards.js';

/* ⚠️ ترتیبِ این بلوک عمدی و شکننده است: `reading-core.js` مسیرِ جدولِ دانشِ کارت را
 * **لحظه‌ی بارگذاریِ ماژول** از `process.env.LOCALE` می‌خواند. اگر `--locale` بعد از
 * یک `import` ایستا خوانده شود، هسته از قبل با زبانِ اشتباه بار شده. برای همین
 * پرچم‌ها این‌جا و قبل از هر importِ وابسته‌به‌زبان پارس می‌شوند و آن import ها
 * پویا هستند. (`spreads.js` و `cards.js` به زبان کاری ندارند، پس ایستا مانده‌اند.) */
const argvEarly = process.argv.slice(2);
const earlyVal = (n, d) => { const i = argvEarly.indexOf(`--${n}`); return i >= 0 ? argvEarly[i + 1] : d; };
const LOCALE = earlyVal('locale', process.env.LOCALE?.trim() || 'fa');
process.env.LOCALE = LOCALE;
// ⚠️ سنجه‌ها که به checks.mjs منتقل شدند، این import با آن‌ها رفت — ولی خودِ آزمایشگاه
// هنوز در شرطِ پذیرشِ ریکوئست و در probe از آن استفاده می‌کند. نتیجه: ReferenceError
// داخلِ callbackِ validate که orChatResilient به‌عنوان «خطای LLM» می‌بلعید، پس هر ۴۵
// تلاش شکست خورد و کلِ دور با صفر فال تمام شد (درسِ decideReceipt، بارِ دوم).
const { headlineOk } = await import('../bots/tarot/verdict.js');
const { repairDefects } = await import('../bots/tarot/repair.js');
const {
  drawCards, buildReadingCtx, renderV4, checkV4Shape,
  orChat, orChatResilient, parseJsonLoose, FLASH, FALLBACK_MODEL, cardName, spreadName,
} = await import('../bots/tarot/reading-core.js');
// سنجه‌ها در ماژولِ خالصِ جدا هستند تا بدونِ اجرای پولی تست شوند
const { checkReading, modelText, ngrams } = await import('./reading-lab/checks.mjs');
const LANG = (await import(`./reading-lab/lang/${LOCALE}.mjs`)).default;
const { configureLocale } = await import('../bots/tarot/locale-boot.js');

const L = (await import(`../bots/tarot/locales/${LOCALE}.js`)).default;
// 🌍 **همان** تابعی که ربات سرِ boot صدا می‌زند. بدونِ این، `headlineOk` هر سرخطِ
// غیرفارسی را رد می‌کرد و هر ۵ تلاشِ هر فال می‌سوخت: یک دورِ صفر با هزینه‌ی کامل که
// شبیهِ «مدل بد است» به نظر می‌رسید.
configureLocale(L);

/* 🚦 پیش‌پرواز: زبانی که بلوکِ `verdict` ندارد، **یک دورِ کاملِ پولی را می‌سوزاند**
 * بدونِ اینکه خطایی بدهد. `configureVerdict` ورودیِ خالی را بی‌صدا نادیده می‌گیرد، پس
 * ماژول فارسی می‌ماند و `headlineOk` هر سرخطِ آن زبان را رد می‌کند: هر ۵ تلاشِ هر فال
 * می‌سوزد، بلوکِ جوابِ قاطع غایب می‌شود، و گزارش شبیهِ «این مدل برای این زبان بد است»
 * درمی‌آید. دقیقاً همان چیزی که سرِ روسی رخ داد. یک ثانیه چک، به‌جای یک دور هزینه. */
{
  const v = L?.verdict;
  const missing = ['yes', 'no', 'direction', 'evasion', 'but'].filter(k => !Array.isArray(v?.[k]) || !v[k].length);
  if (missing.length) {
    console.error(`❌ locale «${LOCALE}» بلوکِ verdict کامل ندارد (${missing.join(', ')}).`);
    console.error('   بدونِ آن هر سرخط رد می‌شود و کلِ دور با هزینه‌ی کامل می‌سوزد.');
    console.error('   اول `bots/tarot/locales/' + LOCALE + '.js` را کامل کن، بعد دور بگیر.');
    process.exit(1);
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag('dry');
// حالتِ fake: کلِ خطِ لوله **واقعاً** اجرا می‌شود (ساختِ پرامپت، callbackِ validate،
// رندر، همه‌ی سنجه‌ها، گزارش) ولی پاسخ از یک استابِ محلی می‌آید نه از شبکه.
// چرا لازم شد: `--dry` قبل از validate برمی‌گردد، پس مسیرِ پذیرش/رندر/سنجش را اصلاً
// لمس نمی‌کند. یک importِ جامانده (`headlineOk`) دقیقاً همان‌جا پنهان ماند، داخلِ
// try/catch به‌عنوان «خطای LLM» بلعیده شد، و کلِ دورِ چهارم با ۴۵ ریکوئستِ هدررفته و
// صفر فال تمام شد. با `--fake` همان باگ در دو ثانیه و با صفر هزینه پیدا می‌شود.
const FAKE = flag('fake');
const ONLY = (val('only', '') || '').split(',').filter(Boolean);
const OUT = val('out', '');
/* 🤖 مدلِ تحتِ آزمایش. پیش‌فرض دقیقاً همان چیزی است که محصول استفاده می‌کند، پس یک
 * اجرا بدونِ این پرچم‌ها عیناً پروداکشن را می‌سنجد. برنامه‌ی retry همان شکلِ همیشگی را
 * نگه می‌دارد (۳ تلاشِ مدلِ اصلی، بعد ۲ تلاشِ فالبک) تا مقایسه‌ی بین مدل‌ها منصفانه
 * بماند: اگر یکی سه شانس بگیرد و دیگری یکی، داریم برنامه‌ی retry را می‌سنجیم نه مدل را. */
/* ⚠️ `let` نه `const`: در حالتِ چندبازویی (`--arms`) بینِ بازوها عوض می‌شود.
 * `runStep` این‌ها را از closure می‌خواند، پس مقدارِ لحظه‌ی فراخوانی را می‌بیند. */
let MODEL = val('model', FLASH);
const FALLBACK = val('fallback', FALLBACK_MODEL);
let PLAN = [MODEL, MODEL, MODEL, FALLBACK, FALLBACK];
/* 🅰️🅱️ مقایسه‌ی **جفت‌شده‌ی** چند مدل در یک اجرا.
 *
 * چرا لازم شد (اندازه‌گیریِ ۱۴۰۵/۰۶/۰۹): یک دورِ سه‌پاسه‌ی فارسی روی کارت و سؤالِ
 * **کاملاً یکسان** نرخِ بی‌لنگرِ ۳۲ / ۱۹ / ۳۰ داد. یعنی نویزِ نمونه‌برداریِ خودِ مدل
 * ۱۳ واحد است، در حالی که تفاوتِ دو مدلی که می‌خواهیم تشخیص بدهیم ~۵ واحد است.
 * با این نسبت، مقایسه‌ی دو **اجرای جدا** عملاً سکه انداختن است.
 *
 * درمان، مقایسه‌ی جفت‌شده است: چون seed از `lab:<persona>:<step>` ساخته می‌شود و
 * `rep` در آن نیست، همه‌ی بازوها **عینِ همان کارت‌ها و همان سؤال‌ها** را می‌گیرند. پس
 * می‌شود اثرِ سناریو را (که تا ۵۰ واحد است: یک سناریو ۵٪ بی‌لنگر می‌دهد و دیگری ۵۵٪)
 * از معادله حذف کرد و فقط تفاوتِ per سناریو را نگاه کرد. همان کاری که آزمایشِ جفتی
 * در آمار می‌کند، و تنها راهی است که با این بودجه به سیگنال می‌رسیم. */
const ARMS = (val('arms', '') || '').split(',').map(x => x.trim()).filter(Boolean);
const ARM_LIST = ARMS.length ? ARMS : [MODEL];

/* 🌍 سناریوها per زبان. `fa` نامِ تاریخیِ خودش را نگه می‌دارد تا دیف صفر بماند.
 * ⚠️ عمداً به فارسی fallback **نمی‌کند**: یک اجرای روسی با سؤال‌های فارسی سبز تمام
 * می‌شد و ما فکر می‌کردیم روسی را سنجیده‌ایم. خرابیِ بی‌صدا بدتر از خطاست. */
const SCEN_FILE = path.join(HERE, 'reading-lab', LOCALE === 'fa' ? 'scenarios.json' : `scenarios.${LOCALE}.json`);
if (!fs.existsSync(SCEN_FILE)) {
  console.error(`❌ سناریویی برای زبانِ «${LOCALE}» نیست: ${SCEN_FILE}`);
  console.error('   سناریوی هر زبان باید به همان زبان نوشته شود، نه ترجمه‌ی خودکارِ فارسی.');
  process.exit(1);
}
const SCEN = JSON.parse(fs.readFileSync(SCEN_FILE, 'utf8'));
// ورودیِ حالتِ probe از همان فایل می‌آید تا هم‌زبان بماند (پیش‌فرض: اولین قدمِ اولین پرسونا).
const PROBE_Q = SCEN.probe?.question || SCEN.personas?.[0]?.steps?.[0]?.question || '';
const PROBE_NAME = SCEN.probe?.name || SCEN.personas?.[0]?.name || '';

/* ═══════════════ استابِ پاسخِ مدل (حالتِ fake) ═══════════════ */
// خروجیِ ساختگی ولی **معتبر**: باید از checkV4Shape و headlineOk رد شود تا مسیرِ
// «پذیرش» اجرا شود. متنش عمداً به کارت‌ها و سؤال لنگر می‌خورد تا سنجه‌ها هم کار کنند.
function fakeOut(spread, cards, ctx) {
  // 🌍 نامِ کارت و متن هر دو از زبانِ جاری می‌آیند، وگرنه استاب روی رباتِ روسی متنِ
  // فارسی می‌ساخت و سنجه‌های زبانی همه‌شان قرمزِ دروغین می‌دادند.
  const names = cards.map(c => cardName(c.key));
  // ⚠️ سؤال عیناً در متنِ استاب بازتاب می‌شود، و یکی از سناریوهای روسی عمداً سؤالِ
  // **انگلیسی** دارد (تستِ لغزشِ زبان). بدونِ این پاک‌سازی، خودِ استاب نویسه‌ی بیگانه
  // تولید می‌کرد و `--fake` قرمزِ دروغین می‌داد؛ یعنی ابزارِ تشخیص، خودش منبعِ خطا.
  const alienRe = (LANG.alien || []).map(a => a.re.source).join('|');
  const strip = (t) => (alienRe ? t.replace(new RegExp(alienRe, 'gu'), '') : t);
  const q = strip(String(ctx.question || '')).split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
  const F = LANG.fake;
  return JSON.stringify({
    cards: names.map(n => ({ teaser: F.teaser(n) })),
    headline: F.headline,
    pattern: F.pattern(names[0], names[names.length - 1], q),
    reads: names.map(n => ({ text: F.read(n, q) })),
    callback: (ctx.previous || []).length ? F.callback : '',
    // ⚠️ عمداً در **یک** چیدمانِ مشخص طفره‌رفتن تزریق می‌شود تا حالتِ fake کلِ مسیرِ
    // تعمیر را واقعاً اجرا کند (تشخیص، فراخوانی، اعتبارسنجی، جایگذاری). بدونِ این،
    // `--fake` سبز رد می‌شد در حالی که آن مسیر هرگز لمس نشده بود — همان اشتباهی که
    // یک بار با `--dry` تکرار شد و یک دورِ ۹ فالی را سوزاند.
    // شرط روی **موضوع** است نه آی‌دیِ کامل، وگرنه با هر تغییرِ نام‌گذاریِ چیدمان
    // (مثل عبورِ `yesno` به `yesno3` در نسل چهارم) این تزریق بی‌صدا خاموش می‌شود و
    // `--fake` دوباره سبزِ دروغین می‌دهد.
    closing: topicOf(spread.id) === 'yesno' || spread.id === 'yesno'
      ? F.closingEvasive(names[0], q)
      : F.closing(names[0], q),
    summary: F.summary, memory: F.memory,
  });
}

// استابِ تعمیر در حالتِ fake: خروجیِ معتبر می‌دهد تا کلِ مسیرِ تعمیر (پارس، اعتبارسنجی،
// جایگذاری) واقعاً اجرا شود، بدونِ شبکه. تعدادِ fixes از خودِ ورودی شمرده می‌شود.
function fakeRepair(sys, usr, opts) {
  const n = (usr.match(/^\d+\)/gm) || []).length || 1;
  // 🌍 به زبانِ جاری، وگرنه استابِ تعمیر روی رباتِ روسی متنِ فارسی جایگزین می‌کرد و
  // `--fake` قرمزِ دروغین می‌داد — همان دامی که خودِ سنجه‌ی نویسه‌ی بیگانه لو داد.
  const out = JSON.stringify({ fixes: Array.from({ length: n }, () => LANG.fake.repairFix) });
  return opts.validate(out) ? { out, model: 'fake', attempts: 1, usages: [{ prompt_tokens: 0, completion_tokens: 0 }] } : null;
}

/* ═══════════════ اجرای یک فال ═══════════════ */
async function runStep(persona, step, i, state) {
  const spread = SPREAD_BY_ID[step.spread];
  if (!spread) throw new Error(`چیدمانِ ناشناخته: ${step.spread}`);
  // seed ثابت per قدم: اجرای دوباره **همان کارت‌ها** را می‌کشد، پس وقتی پرامپت را عوض
  // می‌کنیم تفاوتِ خروجی فقط از پرامپت می‌آید نه از شانسِ کارت. این ستونِ فقراتِ مقایسه است.
  const seed = `lab:${persona.id}:${i}`;
  const cards = drawCards(seed, step.picks || [0, 1, 2], spread.size);

  state.nowSec += (step.afterMinutes || 0) * 60;
  const user = { telegram_id: 900000 + i, memory_json: state.memory, focus_area: persona.focus };
  const ctx = buildReadingCtx({
    user, spread, question: step.question, cards, focusKey: persona.focus, L,
    name: persona.name,
    // UX v2: نام به مدل داده **نمی‌شود** و کد خودش یک بار اولِ سرخط می‌گذاردش.
    // آزمایشگاه باید همین را بسنجد، وگرنه تکرارِ نام را در متنی می‌سنجیم که
    // کاربر اصلاً نمی‌بیند.
    hideName: true,
    kbOn: true,                 // لحنِ جدید برای همه روشن است (toneV2)
    prev: state.prev.slice(0, 4),
  });

  const labels = L.prompts.cardLabels(cards.length);
  const system = L.prompts.readerSystemV4(spread, labels);
  const userMsg = L.prompts.readingContext(ctx);
  const inputChars = system.length + userMsg.length;

  if (DRY) return { spread, cards, ctx, inputChars, dry: true };

  let parsed = null, fallback = null;
  // ⚠️ `orChatResilient` فقط «LLM invalid output» لاگ می‌کند و **دلیل** را نمی‌گوید.
  // دورِ اولِ روسی ۵ تلاشِ اضافه داشت و هیچ‌جا معلوم نبود شکلِ JSON رد شده یا سرخط —
  // یعنی گران‌ترین سیگنالِ هر دور خوانده‌نشده می‌ماند. حالا خودِ validate ثبتش می‌کند.
  const rejects = [];
  // در حالتِ fake همان callbackِ validate اجرا می‌شود، فقط ورودی‌اش از استاب می‌آید.
  const call = FAKE
    ? (sys, usr, opts) => {
        const out = fakeOut(spread, cards, ctx);
        return opts.validate(out)
          ? { out, model: 'fake', attempts: 1, usages: [{ prompt_tokens: 0, completion_tokens: 0 }] }
          : null;
      }
    : orChatResilient;
  const res = await call(system, userMsg, {
    maxTokens: spread.maxTokens,
    validate: (out) => {
      const obj = parseJsonLoose(out);
      if (!obj) { rejects.push('JSON خراب'); return false; }
      if (!checkV4Shape(obj, cards.length)) {
        const n = Array.isArray(obj.reads) ? obj.reads.length : 'ندارد';
        rejects.push(`شکلِ خروجی (reads: ${n}/${cards.length})`);
        return false;
      }
      if (!headlineOk(obj.headline)) {
        rejects.push(`سرخط فرمول را ندارد: «${String(obj.headline || '').slice(0, 80)}»`);
        fallback = obj;
        return false;
      }
      parsed = obj;
      return true;
    },
  }, PLAN);
  if (!parsed && fallback) parsed = fallback;
  if (!parsed) return { spread, cards, ctx, inputChars, rejects, failed: true };

  // تعمیرِ نقطه‌ای — **همان کدِ ربات**. اینجا اجرا می‌شود تا آزمایشگاه دقیقاً همان
  // چیزی را بسنجد که کاربر می‌گیرد، و هزینه/تأخیرِ واقعیِ این مسیر اندازه گرفته شود.
  const t0 = Date.now();
  // ⚠️ `meta` به‌صورت opts به کلاینت می‌رسد، پس `model` این‌جا مسیرِ تعمیر را هم روی
  // **مدلِ تحتِ آزمایش** می‌نشاند. بدونِ این، بازوی GPT یک تعمیرِ Gemini می‌گرفت و
  // مقایسه دیگر مقایسه‌ی دو مدل نبود.
  const rep = await repairDefects(parsed, FAKE ? fakeRepair : orChatResilient,
    // بازوی مدل باید **کلِ خطِ لوله** را بپوشاند، نه فقط خوانش: تا قبل از این تعمیر
    // همیشه روی مدلِ پیش‌فرضِ محصول می‌رفت و مقایسه‌ی مدل‌ها ناقص بود.
    { tag: `${persona.id}.${i + 1}`, meta: { model: MODEL }, plan: [MODEL] });
  parsed = rep.llm;
  const repair = { fired: !!rep.fired, ok: !!rep.repaired, ms: Date.now() - t0, usage: rep.usage || null };

  const rendered = renderV4(parsed, cards, labels, { name: persona.name });
  // اگر خودِ سنجه خطا داد، اجرا نباید بمیرد: فال‌های قبلی پول خرج کرده‌اند و نتیجه‌شان
  // نباید بابتِ یک باگِ ابزار از بین برود (درسِ کرشِ اجرای دوم).
  let check;
  try {
    check = checkReading({ llm: parsed, rendered, spread, cards, ctx, L });
  } catch (e) {
    check = { issues: [`خطای خودِ سنجه: ${e.message}`], notes: [], stats: { chars: 0, perCard: 0, named: 0, cards: cards.length } };
  }

  // حافظه و تاریخچه دقیقاً مثل ربات به قدمِ بعد منتقل می‌شوند
  if (typeof parsed.memory === 'string' && parsed.memory.trim()) state.memory = parsed.memory.trim().slice(0, 1200);
  state.prev.unshift({
    created_at: state.nowSec, type: spread.id,
    summary: String(parsed.summary || '').slice(0, 300), feedback: '-',
  });

  return {
    spread, cards, ctx, inputChars, llm: parsed, rendered, check, repair, rejects,
    model: res?.model, attempts: res?.attempts,
    /* ⚠️ `usd` هزینه‌ی **واقعیِ** همان درخواست است که OpenRouter در هر پاسخ برمی‌گرداند
     * (همان عددی که ربات در `llm_usage` می‌نویسد). لازم شد چون گزارشِ قبلی دلار را از
     * روی توکن با قیمتِ **هاردکدِ Gemini Flash** حساب می‌کرد؛ روی یک بازوی مدلِ دیگر
     * آن عدد دیگر پول نیست، فقط «حجمِ توکن با نرخِ Gemini». دورِ ۹ همین را لو داد:
     * DeepSeek که per توکن چند برابر ارزان‌تر است «گران‌ترین» گزارش شده بود. */
    usage: (res?.usages || []).reduce((a, u) => ({
      in: a.in + (u?.prompt_tokens || 0), out: a.out + (u?.completion_tokens || 0),
      usd: a.usd + (Number(u?.cost) || 0),
    }), { in: 0, out: 0, usd: 0 }),
    // هزینه‌ی تعمیر **جدا** شمرده می‌شود، وگرنه در هزینه‌ی کلی گم می‌شود و
    // نمی‌فهمیم این مسیر واقعاً ارزان است یا فقط ادعا کرده‌ایم.
    repairUsage: { in: rep.usage?.prompt_tokens || 0, out: rep.usage?.completion_tokens || 0, usd: Number(rep.usage?.cost) || 0 },
  };
}

/* ═══════════════ حالتِ probe: «چقدر متداول است و روی کدام فال؟» ═══════════════ */
// چرا لازم شد: اولین اجرا نشان داد در ۲ فال از ۹ بلوکِ کارت‌ها غایب می‌شود. سؤالِ درستِ
// بعدی «چطور وصله‌اش کنیم» نیست، «چند وقت یک‌بار و روی کدام چیدمان» است. بدونِ این عدد
// نمی‌شود تصمیم گرفت که آیا ارزشِ دو-ریکوئستی‌کردنِ چیدمانِ بزرگ را دارد یا نه.
//
// ⚠️ عمداً `orChat` را **خام** صدا می‌زند نه `orChatResilient`: رتراییِ خودکار دقیقاً همان
// چیزی را پنهان می‌کند که می‌خواهیم بشماریم. هر نمونه = یک تلاشِ اول، مثل چیزی که
// کاربر در بهترین حالت می‌گیرد.
const SHAPE = (obj, n) => {
  if (!obj) return 'JSON خراب';
  if (!Array.isArray(obj.reads)) return 'reads نیست';
  if (obj.reads.length < n) return `reads کوتاه (${obj.reads.length}/${n})`;
  const sample = obj.reads.slice(0, n);
  const withText = sample.filter(r => r && typeof r === 'object' && String(r.text || '').trim()).length;
  const strings = sample.filter(r => typeof r === 'string' && r.trim()).length;
  if (withText === n) return 'سالم: [{text}]';
  if (strings === n) return 'آرایه‌ی رشته';
  if (withText + strings === 0) return '🔴 همه خالی';
  return `مخلوط (${withText} شیء + ${strings} رشته)`;
};

async function probe(reps) {
  // چهار اندازه‌ی مختلف تا معلوم شود مسئله مالِ صلیب سلتی است یا سراسری
  const targets = ['yesno3', 'love3', 'personal5', 'personal10'];
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`🔬 probe — هر چیدمان ${reps} بار، تلاشِ اول، بدونِ retry`);
  console.log('═'.repeat(72));
  const rows = [];
  for (const id of targets) {
    const spread = SPREAD_BY_ID[id];
    const tally = {}; let okShape = 0, okHeadline = 0, outTok = 0, trunc = 0;
    for (let k = 0; k < reps; k++) {
      const cards = drawCards(`probe:${id}:${k}`, [k % 24, (k + 7) % 24, (k + 13) % 24], spread.size);
      const ctx = buildReadingCtx({
        user: { telegram_id: 1, memory_json: '', focus_area: spread.focus || 'question' },
        // سؤال و نام از سناریوهای همان زبان می‌آیند، وگرنه probe روی رباتِ روسی یک
        // سؤالِ فارسی می‌پرسید و شکلِ خروجی را در شرایطی می‌سنجید که هرگز رخ نمی‌دهد.
        spread, question: PROBE_Q, cards,
        focusKey: spread.focus || 'question', L, name: PROBE_NAME, kbOn: true, prev: [],
      });
      const labels = L.prompts.cardLabels(cards.length);
      let out = null, usage = {};
      try {
        const r = await orChat(L.prompts.readerSystemV4(spread, labels), L.prompts.readingContext(ctx),
          { maxTokens: spread.maxTokens, model: MODEL });
        out = r.text; usage = r.usage || {};
      } catch (e) { tally['خطای شبکه'] = (tally['خطای شبکه'] || 0) + 1; continue; }
      const obj = parseJsonLoose(out);
      const shape = SHAPE(obj, spread.size);
      tally[shape] = (tally[shape] || 0) + 1;
      if (checkV4Shape(obj, spread.size)) okShape++;
      if (obj && headlineOk(obj.headline)) okHeadline++;
      outTok += usage.completion_tokens || 0;
      // بریدگیِ خروجی: اگر به سقفِ توکن خورده باشیم مسئله «شکلِ خروجی» نیست، «جا نشدن» است
      if ((usage.completion_tokens || 0) >= spread.maxTokens - 40) trunc++;
    }
    rows.push({ id, fa: spreadName(spread.fa), size: spread.size, okShape, okHeadline, reps, tally,
      avgOut: Math.round(outTok / reps), max: spread.maxTokens, trunc });
  }
  console.log('\nچیدمان            کارت  شکلِ سالم  سرخطِ سالم  میانگینِ توکنِ خروجی (سقف)  بریدگی');
  for (const r of rows) {
    console.log(`${r.fa.padEnd(20)}${String(r.size).padEnd(6)}${`${r.okShape}/${r.reps}`.padEnd(11)}`
      + `${`${r.okHeadline}/${r.reps}`.padEnd(12)}${`${r.avgOut} (${r.max})`.padEnd(27)}${r.trunc}/${r.reps}`);
  }
  console.log('\nتوزیعِ شکلِ `reads`:');
  for (const r of rows) {
    const parts = Object.entries(r.tally).map(([k, v]) => `${k} ×${v}`).join('  |  ');
    console.log(`   ${r.fa}: ${parts}`);
  }
  const bad = rows.filter(r => r.okShape < r.reps);
  console.log(`\nحکم: ${bad.length ? bad.map(r => `${r.fa} (${r.reps - r.okShape} از ${r.reps} خراب)`).join('، ') : 'هیچ چیدمانی خرابی نداشت'}`);
  return rows;
}

if (flag('probe')) {
  await probe(parseInt(val('reps', '5'), 10));
  process.exit(0);
}

/* ═══════════════ اجرا ═══════════════ */
const personas = SCEN.personas.filter(p => !ONLY.length || ONLY.includes(p.id));
const all = [];

// چند **پاسِ کامل** روی همان سناریوها با همان کارت‌ها. تنها متغیرِ بین پاس‌ها
// نمونه‌برداریِ خودِ مدل است، یعنی دقیقاً همان نویزی که می‌خواهیم اندازه بگیریم.
//
// چرا اضافه شد (یافته‌ی دورِ هفتم، ۱۴۰۵/۰۵/۲۷): دور ۶ و دور ۷ **پرامپتِ یکسان**
// داشتند و متریکِ جمله‌ی بی‌لنگر ۲۲٪ و ۲۸٪ شد. یعنی یک اجرای ۹ فالی حدودِ ۶ واحد
// نویز دارد و هر «بهبودِ» کوچک‌تر از آن بی‌معناست — همان‌طور که «بهبودِ» ۲۴٪→۲۲٪
// دورِ پنجم در واقع نویز بود. بدونِ این پرچم، لوپِ بهبود دارد به خودش دروغ می‌گوید.
const REPS = Math.max(1, parseInt(val('reps', '1'), 10));

for (const arm of ARM_LIST) {
if (ARM_LIST.length > 1) {
  MODEL = arm; PLAN = [MODEL, MODEL, MODEL, FALLBACK, FALLBACK];
  console.log(`\n${'▓'.repeat(72)}`);
  console.log(`🅰️ بازو: ${arm}  (همان کارت‌ها و همان سؤال‌های بازوهای دیگر)`);
  console.log('▓'.repeat(72));
}
for (let rep = 0; rep < REPS; rep++) {
if (REPS > 1) {
  console.log(`\n${'█'.repeat(72)}`);
  console.log(`🔁 پاسِ ${rep + 1} از ${REPS} (همان کارت‌ها، همان پرامپت)`);
  console.log('█'.repeat(72));
}
for (const persona of personas) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`👤 ${persona.id} — ${persona.name}  (تمرکز: ${persona.focus})`);
  console.log(`   ${persona.why}`);
  console.log('═'.repeat(72));

  // کاربرِ کاملاً جدید: حافظه‌ی خالی، بدونِ هیچ فالِ قبلی
  const state = { memory: '', prev: [], nowSec: Math.floor(Date.now() / 1000) };

  for (let i = 0; i < persona.steps.length; i++) {
    const step = persona.steps[i];
    const r = await runStep(persona, step, i, state);
    all.push({ persona: persona.id, i, rep, arm: MODEL, step, ...r });

    const head = `\n── ${persona.id}.${i + 1} «${spreadName(r.spread.fa)}» (${r.spread.size} کارت) ${step.afterMinutes ? `+${step.afterMinutes} دقیقه` : 'قدمِ اول'}`;
  // دلیلِ هر تلاشِ ردشده — گران‌ترین سیگنالِ هر دور، و تا امروز چاپ نمی‌شد
  if (r.rejects?.length) for (const why of r.rejects) console.log(`   ↻ تلاشِ ردشده: ${why}`);
    console.log(head);
    console.log(`   سؤال: ${step.question}`);
    console.log(`   چالش: ${step.expect}`);
    console.log(`   کارت‌ها: ${r.cards.map(c => c.key + (c.reversed ? '↕' : '')).join(', ')}`);
    console.log(`   ورودیِ مدل: ${r.inputChars} کاراکتر ≈ ${Math.round(r.inputChars / 2.2)} توکن` +
      (r.ctx.previous.length ? ` | فال‌های قبلی: ${r.ctx.previous.map(p => p['چه‌وقت']).join(' / ')}` : ' | بدونِ سابقه'));
    if (r.dry) continue;
    if (r.failed) { console.log('   ❌ همه‌ی تلاش‌ها شکست خورد (مسیرِ REFUND)'); continue; }

    console.log(`   مدل: ${r.model} | تلاش: ${r.attempts} | توکن in/out: ${r.usage.in}/${r.usage.out}`);
    console.log('\n' + '┄'.repeat(72));
    console.log('🎴 تیزرها (چیزی که کاربر هنگام رو شدنِ هر کارت می‌بیند):');
    (r.llm.cards || []).slice(0, r.cards.length).forEach((c, k) => console.log(`   ${k + 1}) ${c?.teaser || '—'}`));
    console.log('\n📩 متنِ نهایی (عیناً همان سه پیامی که کاربر می‌گیرد):');
    console.log(r.rendered.headline);
    console.log('');
    console.log(r.rendered.body);
    console.log('');
    console.log(r.rendered.closing);
    console.log('┄'.repeat(72));

    const { issues, notes, stats } = r.check;
    const a = r.check.anchor || { loose: 0, total: 0, pct: 0, samples: [] };
    console.log(`\n   📏 ${stats.chars} کاراکتر | ${stats.perCard} کاراکتر per کارت | ${stats.named}/${stats.cards} کارت با نامِ خودش صدا زده شد`);
    console.log(`   🎯 جمله‌ی بی‌لنگر: ${a.loose}/${a.total} (${a.pct}٪)` + (a.samples.length ? ` — نمونه: «${a.samples[0]}»` : ''));
    if (issues.length) { console.log('   ❌ ایرادها:'); issues.forEach(x => console.log(`      - ${x}`)); }
    else console.log('   ✅ همه‌ی سنجه‌های قطعی سبز');
    if (notes.length) { console.log('   ⚠️ نکته‌ها:'); notes.forEach(x => console.log(`      - ${x}`)); }
  }
}
}
}  // ← پایانِ حلقه‌ی بازوها (`--arms`)

/* ═══════════════ تکرارِ بین‌فالی: مهم‌ترین سنجه ═══════════════ */
// تحقیق ۱ دلیلِ شماره‌یکِ رهاکردنِ محصولاتِ AI را «تکراری و قالبی» می‌داند، و دو بار هم
// همین‌جا نشتِ few-shot دیدیم. یک فال به‌تنهایی هرگز این را لو نمی‌دهد؛ فقط کنارِ هم
// گذاشتنِ چند فال نشان می‌دهد کدام جمله دارد از پرامپت تکرار می‌شود.
if (!DRY) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log('🔁 تکرارِ بین‌فالی (متنی که در بیش از یک فال عیناً آمده)');
  console.log('═'.repeat(72));
  const done = all.filter(r => r.llm);
  // ⚠️ مقایسه فقط **داخلِ هر پاس**. اگر پاس‌ها با هم مخلوط شوند، همان سناریو با همان
  // کارت‌ها در دو پاس طبیعتاً شبیهِ خودش درمی‌آید و عددِ تکرار را الکی باد می‌کند.
  /* ⚠️ گروه‌بندی باید **بازو و پاس** را با هم ببیند، نه فقط پاس. با دو بازو، پاسِ ۱ـِ
   * بازوی A و پاسِ ۱ـِ بازوی B در یک سطل می‌افتادند و یک ۶کلمه‌ایِ مشترکِ
   * `A/R1.1` و `B/R1.2` به‌عنوان «تکرارِ بین‌فالی» شمرده می‌شد، در حالی که اصلاً دو
   * مدلِ متفاوت‌اند و این عدد قرار است بگوید **یک** مدل خودش را تکرار می‌کند یا نه. */
  const groupsSeen = [...new Set(done.map(r => `${r.arm || ''}\u0000${r.rep}`))].sort();
  const repsSeen = [...new Set(done.map(r => r.rep))].sort();
  const perRep = [];
  for (const gk of groupsSeen) {
    const [gArm, gRep] = gk.split('\u0000');
    const rp = Number(gRep);
    const seen = new Map();
    for (const r of done.filter(x => String(x.arm || '') === gArm && x.rep === rp)) {
      for (const g of new Set(ngrams(modelText(r.llm), 6))) {
        if (!seen.has(g)) seen.set(g, new Set());
        seen.get(g).add(`${r.persona}.${r.i + 1}`);
      }
    }
    const rr = [...seen.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size);
    perRep.push(rr);
    const label = (ARM_LIST.length > 1 ? `${gArm} / ` : '') + `پاسِ ${rp + 1}`;
    if (repsSeen.length > 1 || ARM_LIST.length > 1) console.log(`\n   ── ${label}: ${rr.length} تکرار`);
    if (!rr.length) console.log('   ✅ هیچ ۶کلمه‌ای در دو فالِ متفاوت تکرار نشده');
    else for (const [g, s2] of rr.slice(0, groupsSeen.length > 1 ? 8 : 25)) console.log(`      [${[...s2].join(', ')}] «${g}»`);
  }
  const repeatCounts = perRep.map(x => x.length);

  console.log(`\n${'═'.repeat(72)}`);
  console.log('📊 جمع‌بندی');
  console.log('═'.repeat(72));
  const tokIn = done.reduce((a, r) => a + r.usage.in, 0), tokOut = done.reduce((a, r) => a + r.usage.out, 0);
  const bad = done.filter(r => r.check.issues.length);
  /* ⚠️ `attempts` روی فالی که خطا داده undefined است، و `undefined - 1` کلِ جمع را
   * `NaN` می‌کند. در اجرای تک‌پاسه هرگز دیده نشد و در دورِ ۱۰ (سه‌پاسه، ۲۷ فال) به‌صورتِ
   * «تلاشِ اضافه: NaN» بیرون زد. عددِ NaN در گزارشی که مبنای تصمیمِ مدل است، یعنی یکی از
   * دو سنجه‌ی هزینه‌ی همان دور خوانده نمی‌شود. */
  const extra = done.reduce((a, r) => a + Math.max(0, (Number(r.attempts) || 1) - 1), 0);
  console.log(`   فال‌ها: ${done.length} | با ایراد: ${bad.length} | تلاشِ اضافه: ${extra}`);
  // متریکِ کیفیِ اصلی برای مقایسه‌ی دورها: چند درصد از جمله‌ها به هیچ چیزِ مخصوصِ
  // همین فال گره نخورده‌اند. هرچه کمتر، خوانش شخصی‌تر و کمتر Barnum.
  const lo = done.reduce((s, r) => s + (r.check.anchor?.loose || 0), 0);
  const to = done.reduce((s, r) => s + (r.check.anchor?.total || 0), 0);
  console.log(`   🎯 جمله‌ی بی‌لنگر در کلِ دور: ${lo}/${to} (${to ? Math.round(lo * 100 / to) : 0}٪)`);
  /* 📏 «خط‌کش چقدر کج بود»: همان متن، با مسیرِ **قدیمیِ** نامِ کارت. تفاوتِ این دو عدد
   * اثرِ فیکسِ ریشه‌یابی را **بدونِ نویزِ اجرا** نشان می‌دهد، چون روی عینِ همان جمله‌ها
   * حساب می‌شود. برای فارسی همیشه صفر است (صرف ندارد) و همین صفر، خودش تأییدِ
   * ادعای «سوگیری فقط روی زبانِ صرفی بود» است. */
  const lsAll = done.reduce((s2, r) => s2 + (r.check.anchor?.looseStrict ?? r.check.anchor?.loose ?? 0), 0);
  if (lsAll !== lo) {
    console.log(`   📏 با سنجه‌ی قدیمی همین متن: ${lsAll}/${to} (${to ? Math.round(lsAll * 100 / to) : 0}٪)`
      + ` → فیکسِ ریشه‌یابی ${lsAll - lo} جمله را از «بی‌لنگر» نجات داد`);
  } else {
    console.log('   📏 سنجه‌ی قدیمی و جدید روی این متن یکی شدند (صفر جمله‌ی نجات‌یافته)');
  }
  // پراکندگیِ بین پاس‌ها = واحدِ سنجشِ نویز. بدونِ این عدد نمی‌شود فهمید یک تفاوتِ
  // چندواحدی «بهبود» است یا فقط شانسِ نمونه‌برداریِ مدل (یافته‌ی دورِ هفتم).
  if (repsSeen.length > 1) {
    const pcts = repsSeen.map(rp => {
      const d = done.filter(x => x.rep === rp);
      const l = d.reduce((s, r) => s + (r.check.anchor?.loose || 0), 0);
      const t = d.reduce((s, r) => s + (r.check.anchor?.total || 0), 0);
      return t ? Math.round(l * 100 / t) : 0;
    });
    const badPer = repsSeen.map(rp => done.filter(x => x.rep === rp && x.check.issues.length).length);
    console.log(`      per پاس: ${pcts.map(x => x + '٪').join(' , ')}  (دامنه ${Math.min(...pcts)} تا ${Math.max(...pcts)})`);
    console.log(`   🔁 تکرارِ بین‌فالی per پاس: ${repeatCounts.join(' , ')}`);
    console.log(`   ❌ فالِ ایرادناک per پاس: ${badPer.join(' , ')}`);
  }
  const usd = done.reduce((a, r) => a + (r.usage?.usd || 0), 0);
  // عددِ دلاری فقط وقتی چاپ می‌شود که **واقعی** باشد؛ نبودنش (مثلاً حالتِ fake) یعنی
  // سکوت، نه یک تخمینِ ساختگی که بعداً به‌عنوان «هزینه» نقل شود.
  console.log(`   توکن: ${tokIn} ورودی + ${tokOut} خروجی`
    + (usd > 0 ? ` | هزینه‌ی واقعی: $${usd.toFixed(4)} (per فال: $${(usd / done.length).toFixed(5)})` : ''));
  // مسیرِ تعمیر جدا گزارش می‌شود: چند بار شلیک کرد، چقدر طول کشید، چقدر خرج برداشت.
  // هر سه عدد لازم است — «ارزان» بدونِ تأخیر بی‌معناست و برعکس.
  {
    const fired = done.filter(r => r.repair?.fired);
    const failed = fired.filter(r => !r.repair.ok);
    /* ⚠️ «شلیک کرد و نشد» با «اصلاً به مدل نرسید» یکی نیست، و تفکیکشان از یک دورِ
     * واقعی درآمد: بازوی `gpt-5-mini` شش تعمیرِ «ناموفق» داشت با **صفر توکن** و
     * تأخیرِ ~۵۰ms، یعنی هر شش فراخوانی قبل از رسیدن به مدل رد شده بودند (احتمالاً
     * یک پارامترِ ناسازگار). آن دور شش فالِ ایرادناک گزارش کرد در حالی که مسیرِ
     * تعمیرش عملاً **وجود نداشت** — یعنی عددِ کیفیتِ آن مدل بدترِ واقعیت نمایش داده
     * می‌شد و علتش در گزارش نامرئی بود. هر مدلِ تازه‌ای می‌تواند همین را بدهد، پس
     * تشخیصش باید ساختاری باشد نه چشمی. */
    const dead = fired.filter(r => !r.repair.ok && !(r.repairUsage?.in || r.repairUsage?.out));
    const rin = done.reduce((a, r) => a + (r.repairUsage?.in || 0), 0);
    const rout = done.reduce((a, r) => a + (r.repairUsage?.out || 0), 0);
    const msList = fired.map(r => r.repair.ms).sort((a, b) => a - b);
    const cost = done.reduce((a, r) => a + (r.repairUsage?.usd || 0), 0);
    console.log(`   🔧 تعمیرِ نقطه‌ای: ${fired.length}/${done.length} فال` +
      (failed.length ? ` (${failed.length} ناموفق${dead.length ? `، ${dead.length} تای آن **اصلاً به مدل نرسید**` : ''})` : '') +
      (fired.length ? ` | تأخیر ${msList[0]} تا ${msList[msList.length - 1]}ms` +
        ` | توکن ${rin}+${rout}` + (cost > 0 ? ` | هزینه‌ی واقعی $${cost.toFixed(5)} (per فالِ کلِ دور: $${(cost / done.length).toFixed(6)})` : '') : ''));
    if (dead.length === fired.length && fired.length) {
      console.log('   ⚠️ مسیرِ تعمیر روی این مدل **کاملاً مرده بود** (صفر توکن در همه‌ی فراخوانی‌ها).'
        + ' عددِ «فالِ ایرادناک» این دور با مدل‌هایی که تعمیرشان کار کرده قابلِ مقایسه نیست.');
    }
  }
  // متنِ ایراد و درصدِ لنگرِ هر فال **همین‌جا** چاپ می‌شود، نه فقط بالاتر در بلوکِ خودش.
  // دلیلِ عملیاتی: خواندنِ لاگِ Actions فقط از **انتها** ممکن است و بلوکِ هر فال ده‌ها
  // خط است؛ بدونِ این خلاصه برای فهمیدنِ «کدام فال چه ایرادی داشت» باید کلِ لاگ خوانده
  // شود. با این خلاصه، ۳۰ خطِ آخر برای نتیجه‌گیریِ یک دور کافی است.
  for (const r of done) {
    const n = r.check.issues.length;
    const a = r.check.anchor;
    const pct = a?.total ? ` | بی‌لنگر ${a.loose}/${a.total}` : '';
    const tag = repsSeen.length > 1 ? `پ${r.rep + 1} ` : '';
    console.log(`   ${n ? '❌' : '✅'} ${tag}${r.persona}.${r.i + 1} ${spreadName(r.spread.fa)}${pct}`);
    r.check.issues.forEach(x => console.log(`        ↳ ${x}`));
  }
}

/* ═══ 🅰️🅱️ مقایسه‌ی جفت‌شده‌ی بازوها ═══
 *
 * چرا جفت‌شده و نه فقط دو درصدِ کلی: اثرِ **سناریو** تا ۵۰ واحد است (یک سناریو ۵٪
 * بی‌لنگر می‌دهد و دیگری ۵۵٪) و نویزِ نمونه‌برداریِ مدل ۱۳ واحد، در حالی که تفاوتی که
 * دنبالش هستیم ~۵ واحد است. اگر دو عددِ تجمیعی را مقایسه کنی، سیگنال زیرِ این دو
 * منبعِ واریانس دفن می‌شود. چون همه‌ی بازوها **عینِ همان کارت و همان سؤال** را
 * گرفته‌اند، می‌شود per سناریو تفاضل گرفت و اثرِ سناریو کاملاً حذف می‌شود.
 *
 * ⚠️ عمداً p-value چاپ نمی‌شود: با ۹ سناریو، آزمونِ علامت توانِ کافی ندارد و یک
 * عددِ آماریِ خوش‌قیافه فقط اعتمادِ کاذب می‌سازد. به‌جایش «چند سناریو را برد» و
 * «میانگینِ تفاضل» می‌آید، که هر دو خام و قابلِ بازبینی‌اند. */
if (!DRY && ARM_LIST.length > 1) {
  const done = all.filter(r => r.llm);
  const key = (r) => `${r.persona}.${r.i + 1}`;
  const scen = [...new Set(done.map(key))];
  const rate = (rows) => {
    const lo = rows.reduce((x, r) => x + (r.check?.anchor?.loose || 0), 0);
    const to = rows.reduce((x, r) => x + (r.check?.anchor?.total || 0), 0);
    return to ? (lo * 100 / to) : null;
  };
  const base = ARM_LIST[0];
  console.log(`\n${'═'.repeat(72)}`);
  console.log('🅰️🅱️ مقایسه‌ی جفت‌شده (هر سناریو با کارت و سؤالِ یکسان بینِ بازوها)');
  console.log('═'.repeat(72));
  for (const other of ARM_LIST.slice(1)) {
    const diffs = [], rowsOut = [];
    for (const sc of scen) {
      const a = rate(done.filter(r => key(r) === sc && r.arm === base));
      const b = rate(done.filter(r => key(r) === sc && r.arm === other));
      if (a == null || b == null) continue;
      diffs.push(b - a);
      rowsOut.push(`   ${sc.padEnd(7)} ${base.split('/').pop().slice(0, 22).padEnd(23)}${a.toFixed(0).padStart(3)}٪   →  ${b.toFixed(0).padStart(3)}٪   (${(b - a) >= 0 ? '+' : ''}${(b - a).toFixed(0)})`);
    }
    if (!diffs.length) { console.log('   (دادهٔ قابلِ جفت‌شدن نبود)'); continue; }
    const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
    const better = diffs.filter(d => d < 0).length;   // کمتر یعنی بهتر (بی‌لنگرِ کمتر)
    const worse = diffs.filter(d => d > 0).length;
    console.log(`\n   🅱️ ${other}  در برابرِ  🅰️ ${base}`);
    rowsOut.forEach(x => console.log(x));
    console.log(`   ─────`);
    console.log(`   میانگینِ تفاضلِ per سناریو: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} واحد` +
      ` (منفی یعنی «${other}» بهتر است)`);
    console.log(`   بردِ سناریویی: ${better} بهتر / ${worse} بدتر / ${diffs.length - better - worse} مساوی`);
    const decisive = Math.abs(mean) >= 5 && (better >= diffs.length * 0.7 || worse >= diffs.length * 0.7);
    console.log(decisive
      ? `   ✅ الگو یک‌دست است، این تفاوت قابلِ اتکاست`
      : `   ⚠️ الگو یک‌دست نیست؛ با ${diffs.length} سناریو این تفاوت **قطعی نیست**، پاسِ بیشتر لازم است`);
  }
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(all.map(r => ({
    persona: r.persona, step: r.i, rep: r.rep, spread: r.spread?.id, question: r.step?.question,
    cards: r.cards?.map(c => c.key + (c.reversed ? '↕' : '')),
    inputChars: r.inputChars, llm: r.llm, rendered: r.rendered, check: r.check,
  })), null, 2));
  console.log(`\n💾 خروجیِ خام: ${OUT}`);
}
