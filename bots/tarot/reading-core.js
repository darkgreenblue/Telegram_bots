// هسته‌ی خالصِ تولیدِ خوانش — همه‌چیزِ «ساختنِ یک فال» که به تلگرام و SQLite کاری ندارد.
//
// چرا این فایل هست: تا امروز کلِ این منطق داخلِ index.js بود و تنها راهِ تستش، طی‌کردنِ
// دستیِ فلو در خودِ ربات بود (انتخابِ کارت، انتظار، و بعد کپیِ ده‌ها پیام). حالا همان کد
// از دو جا صدا زده می‌شود: ربات (`index.js`) و آزمایشگاه (`tools/reading-lab.mjs`) که کاربر
// را آفلاین شبیه‌سازی می‌کند. **کپی نیست، همان کد است** — پس آزمایشگاه هرگز چیزی را تست
// نمی‌کند که با پروداکشن فرق داشته باشد، و هیچ drift ای ممکن نیست.
//
// قاعده‌ی این فایل: هیچ import از telegraf/better-sqlite3، هیچ دسترسی به db، هیچ state.
// هر چیزی که به کاربرِ مشخص یا رکوردِ دیتابیس نیاز دارد، به‌صورت پارامتر می‌آید.
import { createHash } from 'crypto';
import CARDS, { CARD_BY_KEY } from './cards.js';
import { log, logErr } from '../../shared/logger.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// دانشِ دست‌نویسِ کارت‌ها (نماد، تصویر، تفسیرِ مستقیم و معکوس). fail-safe: اگر فایل
// نباشد یا خراب باشد، خوانش دقیقاً مثل قبل کار می‌کند، فقط بدونِ این لایه‌ی دانش.
//
// 🌍 per زبان (بند ۲و): مسیر قبلاً `card-knowledge.fa.json` هاردکد بود، یعنی رباتِ روسی
// ۷۸ ردیف **متنِ فارسی** را داخلِ یک پرامپتِ روسی تزریق می‌کرد. همان الگوی `ganjineh.js`:
// نبودنِ فایلِ یک زبان فقط این لایه را برای همان زبان خاموش می‌کند.
const LOCALE = process.env.LOCALE?.trim() || 'fa';
export const CARD_KB = await import(`./card-knowledge.${LOCALE}.json`, { with: { type: 'json' } })
  .then(m => m.default).catch(() => ({}));

/* 🌍 دادهٔ زبانیِ ساختاری (نامِ کارت/جایگاه/چیدمان، کلیدواژه‌ها، پرامپتِ تعمیر).
 *
 * ⚠️ چرا فایلِ داده و نه داخلِ `locales/<code>.js`: `check-locale-shape` شکلِ هر locale
 * را با فارسی **دقیقاً** مقایسه می‌کند (کلیدِ اضافه هم خطاست). این جدول‌ها برای فارسی
 * اصلاً وجود ندارند (از `cards.js`/`spreads.js` می‌آیند)، پس گذاشتنشان در locale یا
 * چک را می‌شکست یا مجبورمان می‌کرد ۷۸ کلیدِ بی‌مصرف به فارسی اضافه کنیم. الگوی مرجع
 * همان دو فایلِ per زبانِ موجود است: `card-knowledge.<locale>.json` و
 * `daily-ganjineh.<locale>.json`. کلیدها رشته‌ی **فارسیِ canonical** اند. */
export const LANG_DATA = await import(`./langdata.${LOCALE}.json`, { with: { type: 'json' } })
  .then(m => m.default).catch(() => ({}));

/* 🌍 نامِ کارت، جایگاه و چیدمان — دادهٔ زبانی که تا امروز فارسیِ هاردکد بود.
 *
 * ⚠️ چرا این حیاتی است و نه یک تمیزکاری: `readingContext` در locale از قبل کلیدهای
 * روسی داشت، ولی **مقدارها** هنوز فارسی بودند (`c.fa`، `c.positionFa`، `ctx.spreadFa`).
 * یعنی مدلِ روسی برچسبِ روسی می‌گرفت که به محتوای فارسی اشاره می‌کرد. دو ضرر داشت:
 *   ۱) کاربرِ روسی در کپشنِ رو شدنِ کارت نامِ جایگاهِ **فارسی** می‌دید (باگِ رو-به-کاربر).
 *   ۲) مهم‌تر: سنجه‌ی «لنگر» آزمایشگاه خروجی را با `CARD_BY_KEY[key].fa` مقایسه می‌کند،
 *      و مدلِ روسی «Шут» می‌نویسد نه «دیوانه». یعنی مرکزی‌ترین متریکِ کیفیت برای هر
 *      زبانِ غیرفارسی **صفر** گزارش می‌شد و کلِ حلقه‌ی بهبود روی عددِ بی‌معنی می‌نشست.
 *
 * fa هیچ‌کدام از این جدول‌ها را ندارد، پس دقیقاً به همان فیلدهای هاردکدِ قبلی fallback
 * می‌کند و رفتارش بیت‌به‌بیت دست‌نخورده است. */
let NAMES = { cards: {}, positions: {}, spreads: {}, keywords: {} };
// ⚠️ برچسبِ «کارتِ بی‌جایگاه» عمداً پیش‌فرضِ فارسی دارد و از locale override می‌شود.
// اگر به‌جایش یک رشته‌ی خنثی می‌گذاشتیم، فارسی بی‌صدا عوض می‌شد: این fallback واقعاً
// شلیک می‌کند، چون فال‌های ۵کارتیِ ثبت‌شده‌ی نسل قبل از تعدادِ جایگاه‌های چیدمانِ
// امروز بیشترند (همان سازگاریِ با گذشته‌ای که بند ۲ج/۱ واجب می‌داند).
let POS_FALLBACK = (i) => `کارت ${i + 1}`;
export function configureCardData(d) {
  if (!d || typeof d !== 'object') return;
  NAMES = {
    cards: d.cardNames || {},
    positions: d.positionNames || {},
    spreads: d.spreadNames || {},
    keywords: d.cardKeywords || {},
  };
  // قالبِ رشته‌ای است نه تابع، چون از JSON می‌آید. `%n` = شماره‌ی کارت (از ۱).
  if (typeof d.positionFallback === 'string' && d.positionFallback.includes('%n')) {
    POS_FALLBACK = (i) => d.positionFallback.replace('%n', String(i + 1));
  }
}
// خودِ ماژول از فایلِ زبان پیکربندی می‌شود، پس هیچ مصرف‌کننده‌ای (ربات یا آزمایشگاه)
// نمی‌تواند صدا زدنش را جا بیندازد. برای `fa` فایل وجود ندارد و همه‌چیز پیش‌فرض می‌ماند.
configureCardData(LANG_DATA);
/** نامِ کارت به زبانِ جاری (fallback: نامِ فارسیِ `cards.js`). */
export const cardName = (key) => NAMES.cards[key] || CARD_BY_KEY[key]?.fa || '';
/** نامِ جایگاه؛ کلید خودِ رشته‌ی فارسی است، چون همان برچسبِ canonical است. */
export const positionName = (fa, i = 0) => NAMES.positions[fa] || fa || POS_FALLBACK(i);
/** نامِ چیدمان (همان‌طور: کلید رشته‌ی فارسی). */
export const spreadName = (fa) => NAMES.spreads[fa] || fa || '';
/** برچسبِ دو سمتِ فالِ تقابلی، به زبانِ جاری.
 * ⚠️ اینها مستقیم **جوابِ نهایی** می‌شوند (`verdict.js` عیناً چاپشان می‌کند)، پس بدونِ
 * ترجمه کاربرِ روسی «Ответ: موندن» می‌گرفت. همان جدولِ جایگاه‌ها کلیدشان است. */
export const choiceLabelsFor = (spread) =>
  Array.isArray(spread?.choiceLabels) ? spread.choiceLabels.map((l, i) => positionName(l, i)) : undefined;

/** کلیدواژه‌های مستقیم/معکوسِ کارت به زبانِ جاری. */
export const cardKeywords = (key) => NAMES.keywords[key] || {
  up: CARD_BY_KEY[key]?.up || [], down: CARD_BY_KEY[key]?.down || [],
};


/* ═══ مدل‌ها و کلاینتِ OpenRouter ═══ */
export const FLASH          = 'google/gemini-2.5-flash';
export const FALLBACK_MODEL = 'deepseek/deepseek-v3.2'; // هم‌سطح Flash و ارزان‌تر — وقتی Flash بعد از ۳ تلاش جواب نداد
export const OR_TIMEOUT_MS  = 10 * 60 * 1000;

// کلید از env خوانده می‌شود، نه از پارامتر: هم ربات و هم آزمایشگاه همان `OPENROUTER_API_KEY`
// را می‌بینند، پس هزینه‌ی تست دقیقاً روی همان کلیدِ تاروت می‌نشیند که خودِ محصول از آن
// استفاده می‌کند و در گزارشِ OpenRouter از هم جدا نمی‌شوند.
const keyOf = () => process.env.OPENROUTER_API_KEY;

/* ═══ حسابداریِ مصرفِ مدل — «چقدر خرج شد» بدونِ ذره‌ای دست‌زدن به «چه چیزی تولید شد» ═══
 *
 * چرا: تا امروز هزینه‌ی واقعیِ OpenRouter در هیچ دیتابیسی ثبت نمی‌شد و
 * `bots/dashboard/CLAUDE.md` خودش آن را «مهم‌ترین عددِ گمشده» نامیده بود. بدونش نه
 * هزینه‌ی هر فال معلوم است نه سودِ واقعی.
 *
 * ⚠️ قاعده‌ی آهنینِ این بخش (شرطِ صریحِ مالک): **کیفیتِ فال نباید ذره‌ای به این لایه
 * حساس باشد.** طراحی طوری است که این شرط نه با دقت، بلکه **ساختاراً** برقرار بماند:
 *
 *   ۱) **بدنه‌ی ریکوئست بایت‌به‌بایت همان قبلی است.** هیچ فیلدی اضافه نمی‌شود.
 *      OpenRouter از خودش `usage.cost` (هزینه‌ی دلاریِ همان درخواست) را در **هر**
 *      پاسخ برمی‌گرداند و پارامترِ قدیمیِ `usage:{include:true}` را رسماً منسوخ و
 *      بی‌اثر اعلام کرده. پس هزینه «خواندنِ چیزی است که از قبل می‌آمد و دور می‌ریختیم»،
 *      نه چیزی که ما از سرور بخواهیم. یعنی صفر تغییر روی سیم = صفر ریسک برای خروجی.
 *   ۲) **ثبت هرگز به مسیرِ تولید برنمی‌گردد:** بعد از استخراجِ متن و داخلِ try/catch
 *      صدا زده می‌شود، پس حتی اگر نوشتن در دیتابیس بترکد، فال سالم تحویل می‌شود.
 *   ۳) **برچسبِ حسابداری از مسیرِ opts می‌رود، نه بدنه** — پس نمی‌تواند به سیم برسد.
 *   ۴) **رول‌بکِ یک‌خطی:** `USAGE_ACCOUNTING = false` → هیچ ردیفی ثبت نمی‌شود.
 *
 * `USAGE_INCLUDE_FLAG` دریچه‌ی اضطراری است و **عمداً خاموش**: اگر روزی معلوم شد در
 * مسیری (مثلاً BYOK) هزینه بدونِ آن پرچم نمی‌آید، یک `true` کافی است. تا آن روز
 * روشن‌کردنش فقط یک فیلدِ منسوخ به ریکوئست اضافه می‌کند بدونِ هیچ فایده‌ای.
 * چکِ CI: `tools/check-llm-usage.mjs` (هر چهار ادعا را واقعاً اجرا می‌کند). */
export const USAGE_ACCOUNTING = true;
export const USAGE_INCLUDE_FLAG = false;

let usageSink = null;
/** ثبت‌کننده‌ی مصرف را تزریق می‌کند (ربات: نوشتن در `llm_usage`؛ آزمایشگاه: هیچ). */
export const setUsageSink = (fn) => { usageSink = typeof fn === 'function' ? fn : null; };

export async function orRequest(body, meta = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OR_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    // با پرچمِ خاموش (پیش‌فرض) این دقیقاً همان `body` است: `JSON.stringify` کلیدی را
    // که مقدارش undefined باشد اصلاً نمی‌نویسد، پس رشته‌ی نهایی بایت‌به‌بایت همان قبلی است.
    const wire = { ...body, usage: USAGE_INCLUDE_FLAG ? { include: true } : undefined };
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keyOf()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(wire),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      logErr(`❌ OpenRouter ${res.status} (${body.model}) after ${Date.now() - t0}ms:`, errBody.slice(0, 300));
      throw new Error(`OpenRouter error ${res.status}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    const u = data.usage || {};
    log(`✅ ${body.model} in ${Date.now() - t0}ms | tok(in/out)=${u.prompt_tokens ?? '?'}/${u.completion_tokens ?? '?'}`);
    // ثبت **بعد از** استخراجِ متن و کاملاً بلعیده‌شده: هیچ خطایی از این‌جا به فال نمی‌رسد.
    if (usageSink && USAGE_ACCOUNTING) {
      try {
        usageSink({
          model: body.model || '',
          kind: meta?.kind || '',
          refId: Number(meta?.refId) || 0,
          userId: Number(meta?.userId) || 0,
          promptTokens: Number(u.prompt_tokens) || 0,
          completionTokens: Number(u.completion_tokens) || 0,
          totalTokens: Number(u.total_tokens) || 0,
          // `cost` را خودِ OpenRouter در هر پاسخ می‌گذارد؛ اگر روزی نیامد یعنی صفر،
          // نه یک عددِ حدسی (هیچ جدولِ قیمتی این‌جا نگه داشته نمی‌شود که کهنه شود).
          costUsd: Number(u.cost) || 0,
          ms: Date.now() - t0,
        });
      } catch (e) { logErr('usage sink:', e.message); }
    }
    return { text, usage: u };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function orChat(system, user, opts = {}) {
  return orRequest({
    model: opts.model || FLASH,
    temperature: opts.temperature ?? 0.9,
    max_tokens: opts.maxTokens,
    // تفکر (reasoning) خاموش: وگرنه Gemini بخشی از max_tokens را صرف thinking می‌کند و
    // خروجی JSON وسط رشته بریده می‌شود (Unterminated string) — دیده‌شده در لاگ پروداکشن
    reasoning: { enabled: false },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  // برچسبِ حسابداری (کدام مسیر، کدام رکورد، کدام کاربر). عمداً **بیرونِ** بدنه‌ی ریکوئست
  // است تا هیچ‌وقت به سیم نرود و نتواند رفتارِ مدل را عوض کند.
  }, { kind: opts.kind, refId: opts.refId, userId: opts.userId });
}

// فراخوانی مقاوم: چند تلاش با مدل اصلی، بعد مدل فالبک؛ validate اختیاری برای ردکردن خروجی خراب.
// `usage` و شماره‌ی تلاش هم برمی‌گردند تا آزمایشگاه بتواند هزینه و نرخِ retry را گزارش کند
// (ربات فقط `out` و `model` را می‌خواند، پس این افزودنی چیزی را عوض نمی‌کند).
export async function orChatResilient(system, user, opts = {}, plan = [FLASH, FLASH, FLASH, FALLBACK_MODEL, FALLBACK_MODEL]) {
  const usages = [];
  for (let i = 0; i < plan.length; i++) {
    try {
      const { text: out, usage } = await orChat(system, user, { ...opts, model: plan[i] });
      usages.push(usage);
      if (!opts.validate || opts.validate(out)) return { out, model: plan[i], attempts: i + 1, usages };
      logErr(`LLM invalid output (attempt ${i + 1}, ${plan[i]})`);
    } catch (e) {
      logErr(`LLM error (attempt ${i + 1}, ${plan[i]}):`, e.message);
    }
    if (i < plan.length - 1) await sleep(1500);
  }
  return null;
}

export async function orTranscribe(audioBuffer, format, meta = null) {
  const { text } = await orRequest({
    model: FLASH,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.' },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ] }],
  }, meta);
  return text;
}

export function parseJsonLoose(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch (e) { logErr('JSON parse failed:', e.message, '| head:', t.slice(0, 120)); return null; }
}

/* ═══ موتور دک (شافل قطعی از seed) ═══ */
export const REVERSAL_PROB = 0.3;
export const GRID_SIZE     = 24; // ۶ ردیف × ۴

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedToInt(seedStr) {
  return createHash('sha256').update(seedStr).digest().readUInt32LE(0);
}
export function shuffledDeck(seedStr) {
  const rng = mulberry32(seedToInt(seedStr));
  const deck = CARDS.map(c => c.key);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.map(key => ({ key, reversed: rng() < REVERSAL_PROB }));
}
// کارت‌های نهایی خوانش: انتخاب‌های کاربر از گرید + بقیه از «جای بریدن دک»
// مهم: برای فال‌های کوچک‌تر از تعداد انتخاب (مثل آری/نه ۲کارتی) فقط size کارت اول
export function drawCards(seedStr, picks, size) {
  const deck = shuffledDeck(seedStr);
  const chosen = picks.slice(0, size).map(i => deck[i]);
  let cursor = GRID_SIZE;
  while (chosen.length < size) chosen.push(deck[cursor++]);
  return chosen;
}

/* ═══ هلپرهای متنِ خروجی ═══ */
// نشانه‌ی ابتدای هر بخشِ متنِ نهایی. عمداً در **کد** است نه در پرامپت: مدل اگر آزاد
// باشد هر بار سلیقه‌ای ایموجی می‌پاشد؛ این‌طوری ثابت، کم و قابلِ‌تغییر از یک نقطه است.
// (خوانش‌های واقعیِ انسانی اصلاً ایموجی ندارند؛ این یک انتخابِ آگاهانه‌ی محصولی است تا
// متنِ بلندِ تلگرام بخش‌بندیِ چشمی داشته باشد و دیوارِ متن نباشد.)
export const SECT = { headline: '🔮', callback: '🔁', pattern: '🧩', card: '🃏', closing: '🕯️' };

// برچسبِ ترتیبی‌ای که مدل شاید خودش جلوی جمله گذاشته باشد را برمی‌دارد («کارت سوم می‌گه…»،
// «اما کارتِ آخرت…»). شماره‌گذاری کارِ کد است نه مدل: قطعی، بدونِ تکرار و بدونِ جاافتادگی.
// عمداً فقط **ابتدای** جمله را می‌بیند تا اشاره‌های وسطِ متن به کارت‌ها دست‌نخورده بمانند.
const ORD_FA = 'اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|بعدی|آخر';
// `ً-ْ` = اعرابِ عربی. متنِ مدل اغلب «کارتِ آخرت» می‌نویسد (با کسره)، پس بدونِ
// این بازه، همان موردی که باگ را ساخته بود از فیلتر رد می‌شد.
const HAR = '[\\u064B-\\u0652]*';
const CARD_LABEL_RE = new RegExp(
  `^\\s*(?:و\\s+|اما\\s+|ولی\\s+)?کارت${HAR}[\\s\\u200c]*(?:${ORD_FA})${HAR}[\\s\\u200c]*(?:ت|تون|ی)?${HAR}\\s*[،:؛.]?\\s*`);
// تا وقتی برچسب می‌بیند برمی‌دارد: اگر مدل دو بار پشت‌سرهم برچسب بگذارد، یک‌بار
// پاک‌کردن باز هم یک برچسبِ اضافه باقی می‌گذارد.
export function stripCardLabel(t) {
  let s = String(t).trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(CARD_LABEL_RE, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

// خط تیره‌ی بلند امضای متنِ ماشینی است (بند ۱۰ ریشه). پرامپت ممنوعش کرده، ولی این
// شبکه‌ی ایمنیِ قطعی است: چیزی که کد می‌تواند تضمین کند نباید فقط به مدل سپرده شود.
/* جداکننده‌ای که جای خط‌تیره می‌نشیند. per زبان است: فارسی ویرگولِ فارسی («،»)
 * می‌خواهد و روسی ویرگولِ لاتین. تا قبل از این «، » هاردکد بود، یعنی متنِ روسی یک
 * کاراکترِ بیگانه‌ی عربی وسطش می‌گرفت. `configureSeparator` موقعِ boot صدا زده می‌شود. */
let DASH_TO = '، ';
export function configureSeparator(sep) { if (typeof sep === 'string' && sep) DASH_TO = sep; }
export const noDash = (t) => String(t).replace(/\s*—\s*/g, DASH_TO).replace(/\s*--\s*/g, DASH_TO);

// ⏱ `agoFa` (فاصله‌ی زمانی به فارسیِ گفتاری) حذف شد. تاریخچه‌ی کوتاهش درس دارد:
// اول مدل زمانِ فال‌های قبلی را از خودش می‌ساخت («پارسال» برای فالی که ۱۰ دقیقه قبل
// بود)، پس داده‌ی دقیق اضافه کردیم؛ بعد مدل همان داده را هم نادیده گرفت و «هفته‌های
// قبل» نوشت، پس قاعده‌ی پرامپت اضافه کردیم؛ بعد قاعده را سراسری کردیم. سه لایه وصله
// روی چیزی که **اصلاً لازم نبود**: کاربر در بخشِ یادآوری نمی‌خواهد بداند فالِ قبلی کِی
// بوده، می‌خواهد بداند یادش هست چه پرسیده. پس خودِ داده حذف شد و مسئله از بین رفت.
// (بازه‌ی زمانیِ **آینده** در جمع‌بندی سرِ جایش است؛ آن‌جا واقعاً ارزش دارد.)

export const tehranToday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d);

/* ═══ «کارتِ سنگینی که نیامده» — حذف شد (۱۴۰۵/۰۵/۲۷) ═══ */
// تاریخچه، چون درسش عمومی است: خوانشِ واقعیِ انسانی یک جمله‌ی مشخص داشت («کارت
// فروپاشی نیفتاد کلا») و ما خواستیم همان را بسازیم. نسل اول مدل را آزاد گذاشت و در ۷
// فال از ۷ یک قالبِ مبهمِ واحد داد. نسل دوم انتخابِ کارت را به **کد** سپرد و در پرامپت
// نامِ همان کارت را اجباری کرد. اندازه‌گیریِ دورِ چهارم: فقط ۲ فال از ۶ کارتِ داده‌شده
// را آورد؛ بقیه کارتِ دیگری گفتند و **دو بار کارتی گفتند که اصلاً در دستِ ۷۸تایی وجود
// ندارد** («کارتِ جنگجو»). یعنی این فیلد به‌جای نزدیک‌کردنِ ما به فالِ خوب، خطای
// واقعیِ محتوایی تولید می‌کرد.
//
// طبق بند ۹/۰ ریشه (حذف، نه تعمیر): این لایه‌ی دومِ وصله بود، پس لایه‌ی سوم نوشته
// نشد و خودِ فیلد برداشته شد. کدِ مرده‌اش (`absentHeavy`, `HEAVY`, `SECT.absent`)
// همان لحظه پاک شد.

/* ═══ کانتکستِ خوانش ═══ */
// ریکال کامل ارزان: در مقیاس ما کل تاریخچه‌ی مفید در کانتکست جا می‌شود — RAG لازم نیست.
// ⏱ فاصله‌ی زمانیِ هر خوانشِ قبلی **اجباری** است. باگ واقعی (۱۴۰۵/۰۵/۲۶): مدل هیچ
// تاریخی از فال‌های قبلی نداشت، فقط `today` را داشت، پس وقتی می‌خواست به جلسه‌ی قبل
// ارجاع بدهد زمانش را از خودش ساخت و نوشت «پارسال» برای فالی که ۱۰ دقیقه قبل بود.
// این توهمِ محض نبود، کمبودِ داده بود؛ پس با **داده** حل می‌شود نه با دستور.
//
// همه‌ی وابستگی‌های بیرونی (رکوردهای قبلی از DB، نامِ نمایشی، پرچمِ دانشِ کارت) پارامترند
// تا این تابع خالص بماند و آزمایشگاه بتواند بدونِ دیتابیس همان ورودی را بسازد.
export function buildReadingCtx({ user, spread, question, cards, focusKey, L, prev = [], kbOn = false, name = '', hideName = false }) {
  return {
    memory: user.memory_json || '',
    name, // فقط نام فارسیِ خودِ کاربر؛ نام تلگرام هرگز به مدل نمی‌رود
    hideName, // UX v2: نام اصلاً به مدل نمی‌رود و کد خودش یک بار می‌چسباند
    focusFa: L.focusFa[focusKey] || focusKey || L.focusFa[user.focus_area] || '-',
    question,
    spreadFa: spreadName(spread.fa),
    cards: cards.map((c, i) => ({
      positionFa: positionName(spread.positions[i]?.fa, i),
      fa: cardName(c.key),
      en: CARD_BY_KEY[c.key].en,
      reversed: c.reversed,
      up: cardKeywords(c.key).up,
      down: cardKeywords(c.key).down,
      // دانشِ همین کارت (فقط در لحنِ جدید). مهم‌ترین تکه‌اش `image` است: cards.js فقط
      // کلیدواژه‌ی انتزاعی دارد («آغاز تازه»)، پس تا امروز مدل مجبور بود نمادِ تصویریِ
      // کارت را از خودش بسازد — و دقیقاً همان‌جا خروجی بی‌ربط می‌شد.
      kb: (kbOn && CARD_KB[c.key]) || undefined,
    })),
    // بدونِ هیچ فیلدِ زمانی: مرتب‌شده از تازه‌ترین، و همین کافی است.
    previous: prev.map(r => ({
      'نوع فال': r.type,
      'خلاصه': r.summary,
      'بازخورد کاربر': r.feedback || '-',
    })),
    today: tehranToday(),
  };
}

// متنِ خوانشِ یک کارت. مدل گاهی به‌جای `[{text}]` آرایه‌ی رشته می‌دهد (دیده‌شده در
// آزمایشگاه، مخصوصاً در چیدمانِ ده‌کارتی که خروجی بلند است). هر دو شکل پذیرفته می‌شود،
// وگرنه محتوایی که مدل تولید کرده بی‌صدا دور ریخته می‌شود.
// کلِ متنی که مدل تولید کرده، در یک رشته. عمداً در هسته است نه در آزمایشگاه: گاردِ
// طفره‌رفتن در **ربات** روی همین اجرا می‌شود و سنجه‌ی آزمایشگاه هم باید دقیقاً همان
// متن را ببیند، وگرنه یکی چیزی را می‌گیرد که آن یکی نمی‌بیند.
export function v4Text(llm) {
  if (!llm) return '';
  return [llm.headline, llm.callback, llm.pattern, llm.closing,
    ...(llm.reads || []).map(readText), ...(llm.cards || []).map((c) => c?.teaser)]
    .filter(Boolean).join('\n');
}

export const readText = (x) => String(typeof x === 'string' ? x : (x?.text || '')).trim();

// شرطِ پذیرشِ شکلِ خروجیِ v4. عمداً این‌جاست نه داخلِ index.js: آزمایشگاه باید **همان**
// معیارِ پذیرش را داشته باشد، وگرنه چیزی را سبز گزارش می‌کند که ربات ردش می‌کند.
// (اعتبارسنجیِ سرخط جداست و در `verdict.js` می‌ماند چون قاعده‌ی محتوایی است نه ساختاری.)
//
// ⚠️ «طولِ آرایه» کافی نیست — باگِ واقعی که آزمایشگاه در اولین اجرا پیدا کرد (۱۴۰۵/۰۵/۲۶):
// در ۲ فال از ۹ فال، `reads` طولِ درست داشت ولی متنِ هیچ کارتی خوانده نمی‌شد، پس رندر
// همه را دور می‌ریخت و **کلِ بلوکِ کارت‌به‌کارت از خوانش غایب می‌شد**. یکی از آن دو
// صلیب سلتیِ ۱۰۰٬۰۰۰ تومانی بود: کاربر بهای ده کارت را می‌داد و چهار خط تحویل می‌گرفت.
// هیچ خطایی هم لاگ نمی‌شد. حالا خوانشِ خالی = خروجیِ نامعتبر = retry.
// ── فیلدهای **اجباری**: نبودشان یعنی محصول شکسته و ارزشِ retry دارد ──────────
//   `reads`  خودِ محصول است (کاربر بابتِ تفسیرِ کارت‌ها پول داده)
//   `teaser` مرحله‌ی افشا بدونش عکسِ بی‌کپشن می‌شود
//   `closing` جمع‌بندی و جوابِ بازشده است
// `pattern`، `callback` و **فرمولِ** سرخط عمداً این‌جا نیستند: نبودشان
// خوانش را نمی‌شکند، پس بازتولیدِ کلِ خروجی برایشان صرف نمی‌کند (بند ۹/۰ ریشه).
export function checkV4Shape(obj, cardCount) {
  if (!obj || !Array.isArray(obj.cards) || obj.cards.length < cardCount) return false;
  if (!Array.isArray(obj.reads) || obj.reads.length < cardCount) return false;
  if (!obj.closing) return false;
  if (!obj.cards.slice(0, cardCount).every(c => String(c?.teaser || '').trim())) return false;
  return obj.reads.slice(0, cardCount).every(r => readText(r).length > 0);
}

// ── فیلدهای **اختیاری**: نبودشان کاربر را ناراضی نمی‌کند، پس فقط شمرده می‌شوند ──
// چرا شمرده می‌شوند: «اختیاری» یعنی retry نمی‌کنیم، نه اینکه برایمان مهم نیست. اگر
// نرخِ نبودنشان بالا برود باید بفهمیم، و تنها راهش لاگ‌کردنِ همان لحظه است.
export function softMissesV4(obj) {
  const miss = [];
  if (!String(obj?.pattern || '').trim()) miss.push('pattern');
  if (!String(obj?.summary || '').trim()) miss.push('summary');
  if (!String(obj?.memory || '').trim()) miss.push('memory');
  return miss;
}

/* ═══ رندرِ متنِ نهایی v4 ═══ */
// ترتیب عمدی است: کاربر تازه پول داده و اولین چیزی که می‌بیند جوابِ سؤالش است،
// بعد الگو و کارت‌به‌کارت که «چرا»ی همان جواب‌اند، و آخر جمع‌بندی با «ولی» بازشده.
// خروجی سه تکه‌ی متنی است چون ربات آن‌ها را با مکث و به‌صورت سه پیامِ جدا می‌فرستد.
export function renderV4(llm, cards, labels, { name = '' } = {}) {
  // خوانشِ کارت‌ها **یک بلوکِ پیوسته** است، نه یک پاراگرافِ جدا با ایموجی per کارت.
  // بازخوردِ مالک از دورِ سوم، و تطبیق با خوانشِ واقعیِ انسانی: آن‌جا کارت‌ها پشتِ سرِ
  // هم و در یک تکه می‌آیند («کارت اولت می‌گه… کارت بعدیت می‌گه…»)؛ تیترِ ایموجی‌دار
  // برای هر کارت متن را رباتی می‌کند. ایموجیِ بخش می‌ماند، ولی فقط **یک بار**.
  const cardLines = (llm.reads || []).slice(0, cards.length).map((x, i) => {
    const t = readText(x);
    if (!t) return '';
    // شماره‌ی کارت **قطعی و از کد** می‌آید، نه از مدل: هر برچسبی که مدل خودش جلوی
    // جمله گذاشته باشد اول برداشته می‌شود و بعد برچسبِ درست چسبانده می‌شود.
    return `${labels[i]} ${noDash(stripCardLabel(t))}`;
  }).filter(Boolean);

  const body = [
    llm.callback && `${SECT.callback} ${noDash(llm.callback)}`,
    llm.pattern && `${SECT.pattern} ${noDash(llm.pattern)}`,
    cardLines.length ? `${SECT.card} ${cardLines.join('\n')}` : '',
  ].filter((x) => x && String(x).trim()).join('\n\n');

  // نامِ مخاطب **دقیقاً یک بار** و از کد، نه از مدل. تضمینِ ساختاری به‌جای دستورِ
  // پرامپتی که سه دور جواب نداد.
  const head = llm.headline
    ? `${SECT.headline} ${name ? `${name}، ` : ''}${noDash(llm.headline)}`
    : '';
  return {
    headline: head,
    body,
    closing: llm.closing ? `${SECT.closing} ${noDash(llm.closing)}` : '',
  };
}
