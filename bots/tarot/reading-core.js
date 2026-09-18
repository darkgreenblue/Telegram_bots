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
import { langTable, LANGS, DEFAULT_LANG, currentLang } from './locale-ctx.js';

const LOCALE = process.env.LOCALE?.trim() || 'fa';
/* 🌍 **per زبانِ زمینه‌ی جاری**، نه per پروسه. رباتِ چندزبانه یک جدولِ دانش ندارد،
 * چهار تا دارد، و انتخابشان به آپدیتی بستگی دارد که همین حالا پردازش می‌شود.
 * شکل عمداً همان آبجکت است (`CARD_KB[c.key]`) تا مصرف‌کننده‌ها دست نخورند. */
const KB_T = langTable({});
for (const lang of LANGS) {
  KB_T.set(lang, await import(`./card-knowledge.${lang}.json`, { with: { type: 'json' } })
    .then(m => m.default).catch(() => ({})));
}
export const CARD_KB = new Proxy({}, {
  get: (_t, k) => KB_T.get()[k],
  has: (_t, k) => k in KB_T.get(),
  ownKeys: () => Reflect.ownKeys(KB_T.get()),
  getOwnPropertyDescriptor: (_t, k) => Reflect.getOwnPropertyDescriptor(KB_T.get(), k),
});

/* 🌍 دادهٔ زبانیِ ساختاری (نامِ کارت/جایگاه/چیدمان، کلیدواژه‌ها، پرامپتِ تعمیر).
 *
 * ⚠️ چرا فایلِ داده و نه داخلِ `locales/<code>.js`: `check-locale-shape` شکلِ هر locale
 * را با فارسی **دقیقاً** مقایسه می‌کند (کلیدِ اضافه هم خطاست). این جدول‌ها برای فارسی
 * اصلاً وجود ندارند (از `cards.js`/`spreads.js` می‌آیند)، پس گذاشتنشان در locale یا
 * چک را می‌شکست یا مجبورمان می‌کرد ۷۸ کلیدِ بی‌مصرف به فارسی اضافه کنیم. الگوی مرجع
 * همان دو فایلِ per زبانِ موجود است: `card-knowledge.<locale>.json` و
 * `daily-ganjineh.<locale>.json`. کلیدها رشته‌ی **فارسیِ canonical** اند. */
const LD_T = langTable({});
for (const lang of LANGS) {
  LD_T.set(lang, await import(`./langdata.${lang}.json`, { with: { type: 'json' } })
    .then(m => m.default).catch(() => ({})));
}
export const LANG_DATA = new Proxy({}, {
  get: (_t, k) => LD_T.get()[k],
  has: (_t, k) => k in LD_T.get(),
  ownKeys: () => Reflect.ownKeys(LD_T.get()),
  getOwnPropertyDescriptor: (_t, k) => Reflect.getOwnPropertyDescriptor(LD_T.get(), k),
});
/** دادهٔ زبانیِ یک زبانِ مشخص — برای `locale-boot.js` که هر زبان را جدا پیکربندی می‌کند. */
export const langDataFor = (lang) => LD_T.for(lang);

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
const NAMES_DEFAULT = { cards: {}, positions: {}, spreads: {}, keywords: {} };
const NAMES_T = langTable(NAMES_DEFAULT);
const NAMES = new Proxy({}, { get: (_t, k) => NAMES_T.get()[k] });
// ⚠️ برچسبِ «کارتِ بی‌جایگاه» عمداً پیش‌فرضِ فارسی دارد و از locale override می‌شود.
// اگر به‌جایش یک رشته‌ی خنثی می‌گذاشتیم، فارسی بی‌صدا عوض می‌شد: این fallback واقعاً
// شلیک می‌کند، چون فال‌های ۵کارتیِ ثبت‌شده‌ی نسل قبل از تعدادِ جایگاه‌های چیدمانِ
// امروز بیشترند (همان سازگاریِ با گذشته‌ای که بند ۲ج/۱ واجب می‌داند).
const POS_DEFAULT = (i) => `کارت ${i + 1}`;
const POS_T = langTable(POS_DEFAULT);
const POS_FALLBACK = (i) => POS_T.get()(i);
/**
 * برای **هر** زبانِ این پروسه یک‌بار موقعِ boot صدا زده می‌شود. `lang` نیامده = زبانِ
 * پیش‌فرض، پس صدازننده‌های قدیمی (چک‌های CI، آزمایشگاه) بدونِ تغییر کار می‌کنند.
 */
export function configureCardData(d, lang = DEFAULT_LANG) {
  if (!d || typeof d !== 'object') return;
  NAMES_T.set(lang, {
    cards: d.cardNames || {},
    positions: d.positionNames || {},
    spreads: d.spreadNames || {},
    keywords: d.cardKeywords || {},
  });
  // قالبِ رشته‌ای است نه تابع، چون از JSON می‌آید. `%n` = شماره‌ی کارت (از ۱).
  if (typeof d.positionFallback === 'string' && d.positionFallback.includes('%n')) {
    POS_T.set(lang, (i) => d.positionFallback.replace('%n', String(i + 1)));
  }
}
// خودِ ماژول از فایلِ زبان پیکربندی می‌شود، پس هیچ مصرف‌کننده‌ای (ربات یا آزمایشگاه)
// نمی‌تواند صدا زدنش را جا بیندازد. برای `fa` فایل وجود ندارد و همه‌چیز پیش‌فرض می‌ماند.
for (const lang of LANGS) configureCardData(LD_T.for(lang), lang);

/* کلیدهای آبجکتِ «فال‌های قبلی» در کانتکست. پیش‌فرض فارسی است تا `fa` که فایلِ زبانی
 * ندارد دقیقاً مثل قبل بماند. */
const ctxKeysOf = (lang) => ({
  type: LD_T.for(lang)?.ctxKeys?.type || 'نوع فال',
  summary: LD_T.for(lang)?.ctxKeys?.summary || 'خلاصه',
  feedback: LD_T.for(lang)?.ctxKeys?.feedback || 'بازخورد کاربر',
});
const CTX_T = langTable(ctxKeysOf(DEFAULT_LANG));
for (const lang of LANGS) CTX_T.set(lang, ctxKeysOf(lang));
const CTX_KEYS = new Proxy({}, {
  get: (_t, k) => CTX_T.get()[k],
  ownKeys: () => Reflect.ownKeys(CTX_T.get()),
  getOwnPropertyDescriptor: (_t, k) => Reflect.getOwnPropertyDescriptor(CTX_T.get(), k),
});
export const CONTEXT_KEYS = CTX_KEYS;
/** نامِ کارت به زبانِ جاری (fallback: نامِ فارسیِ `cards.js`). */
export const cardName = (key) => NAMES.cards[key] || CARD_BY_KEY[key]?.fa || '';
/** نامِ جایگاه؛ کلید خودِ رشته‌ی فارسی است، چون همان برچسبِ canonical است. */
export const positionName = (fa, i = 0) => NAMES.positions[fa] || fa || POS_FALLBACK(i);
/** نامِ چیدمان (همان‌طور: کلید رشته‌ی فارسی). */
export const spreadName = (fa) => NAMES.spreads[fa] || fa || '';

/* 🌍 نمای زبانیِ اسپرد — تنها شکلی که حق دارد به پرامپت برود.
 *
 * 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۲۷ که دورِ اولِ آزمایشگاهِ انگلیسی لو داد: این تابع در
 * `index.js` **محلی** تعریف شده بود، پس فقط پروداکشن از آن رد می‌شد. آزمایشگاه
 * (`reading-lab.mjs`, `chat-lab.mjs`) اسپردِ **خام** را می‌داد، یعنی مدل نامِ فارسیِ
 * اسپرد و موقعیت‌ها را می‌گرفت: «Расклад: «گذشته، حال، آینده», 3 карт».
 *
 * ترجمه گم نشده بود — `positionNames` هر چهار زبان کامل است («گذشته» ⟵ Past/Прошлое/
 * Passado/Pasado). فقط **مسیرِ رسیدن** در آزمایشگاه نبود (بند ۲و/۶ب: «ترجمه شده» با
 * «وصل شده» یکی نیست).
 *
 * ضررش دوبرابر بود: هم آزمایشگاه چیزی را می‌سنجید که محصول اجرا نمی‌کند (نقضِ
 * قراردادِ صریحِ خودش)، هم **همه‌ی دورهای غیرفارسیِ تا امروز** روی پرامپتی اندازه‌گیری
 * شده‌اند که با پروداکشن فرق داشت. پس این‌جا می‌نشیند تا یک تعریف بیشتر وجود نداشته
 * باشد، نه دو تا که واگرا شوند. */
export const locSpread = (sp) => (sp ? {
  ...sp,
  fa: spreadName(sp.fa) || sp.fa,
  positions: (sp.positions || []).map((q, i) => ({ ...q, fa: positionName(q?.fa, i) })),
} : sp);
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
/* 🌍 مدلِ **خوانش** per زبان. عمداً از `FLASH` جداست و جایگزینش نمی‌شود:
 * `FLASH` هنوز مدلِ عمومیِ صداشنو است و مسیرهای دیگر (رونویسیِ ویس، ایجنتِ رسید،
 * کارتِ روز) باید روی همان بمانند. اگر یک ثابت هر دو کار را می‌کرد، عوض‌کردنِ مدلِ
 * خوانشِ روسی بی‌صدا رونویسیِ ویس را هم می‌برد روی مدلی که صدا نمی‌فهمد.
 * از env می‌آید چون هر زبان یک اپِ pm2 با `.env` خودش است (همان الگوی `GATE_CHANNEL`)،
 * پس کد فورک نمی‌شود. نبودنِ متغیر یعنی دقیقاً رفتارِ امروز، پس فارسی دست‌نخورده است. */
/* 🌍 پیش‌فرضِ **اندازه‌گیری‌شده‌ی** هر زبان، نه یک حدس و نه یک رشته در deploy.yml.
 * آزمایشگاه هر زبان را روی سه مجموعه‌ی سناریوی **متفاوت** و در مقایسه‌ی **جفت‌شده**
 * سنجید (همان کارت‌ها و همان سؤال‌ها برای هر دو بازو) و `luna` در هر سه مجموعه‌ی هر
 * زبان روی سنجه‌ی مرکزیِ «جمله‌ی بی‌لنگر» برنده شد. اعداد و روش: I18N-MODEL-RESEARCH.md.
 *
 * ⚠️ چرا این‌جا و نه در `.env` که دیپلوی بنویسد: عددِ این تصمیم از یک حلقه‌ی
 * اندازه‌گیری آمده و باید همان‌جایی بنشیند که خوانده و تست می‌شود. یک نامِ مدل در
 * یک YAMLِ دیپلوی نه چکِ CI می‌بیندش نه کسی که کدِ ربات را می‌خواند — و درسِ همین
 * سشن دقیقاً همین بود: «آن‌چه گزارش شد و آن‌چه واقعاً اجرا شد یکی نبودند».
 * `process.env.READING_MODEL` همچنان override می‌کند (برای آزمایشِ موردی).
 *
 * ✅ `fa` هم از ۱۴۰۵/۰۶/۱۰ در جدول است (تصمیمِ صریحِ مالک). پیش از آن عمداً بیرون
 * بود تا رباتِ زنده دست‌نخورده بماند؛ سوییچ بعد از دو دورِ ۹۰فالیِ جفت‌شده انجام شد
 * که در دورِ دوم `luna` روی **هر دو** محور جلو افتاد: بی‌لنگر ۱۰٫۴٪ در برابرِ ۳۰٫۷٪،
 * و صفر ایرادِ سختِ STYLE.md در برابرِ ۶ (بخشِ «حکمِ فارسی برگشت» در CLAUDE.md).
 *
 * 🎙 مسیرِ ویس خودش را تطبیق می‌دهد و لازم نیست کسی یادش باشد: `luna` صدا نمی‌فهمد،
 * پس `READER_HEARS_AUDIO` در `index.js` false می‌شود و ویس اول با `orTranscribe`
 * (که روی مدل‌های صداشنو می‌ماند) به متن تبدیل می‌شود. یعنی حالا **هر چهار زبان**
 * مسیرِ دو-فراخوانی دارند و آن واگرایی از جدولِ استثناها برداشته شد.
 * رول‌بکِ یک‌خطی: برداشتنِ ردیفِ `fa` از این جدول. */
export const LUNA = 'openai/gpt-5.6-luna';
const READING_MODEL_BY_LOCALE = {
  fa: LUNA,
  en: LUNA,
  ru: LUNA,
  pt: LUNA,
  es: LUNA,
};
export const READING_MODEL  = (process.env.READING_MODEL || '').trim()
  || READING_MODEL_BY_LOCALE[LOCALE] || FLASH;
export const FALLBACK_MODEL = 'deepseek/deepseek-v3.2'; // آخرین پله‌ی زنجیره (پایین‌تر، `READING_PLAN`)
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

/* 🔎 توکنِ کش‌شده و توکنِ استدلال — دو عددی که از قبل در پاسخ بودند و دور می‌ریختیم.
 *
 * چرا لازم شد: تحلیلِ هزینه (`analytics/tarot/reports/2026-09-11-unit-economics.md`)
 * نشان داد هزینه‌ی مدل ۱٫۵ برابرِ درآمد است و ۹۸٪ آن مالِ خودِ فال است. اولین گزینه‌ی
 * کاهشِ هزینه «کشِ پرامپت» است، ولی **بدونِ این عدد نمی‌دانیم امروز چقدرش از قبل
 * کش می‌شود** — یعنی نمی‌شود گفت ۱۰٪ صرفه‌جویی روی میز است یا صفر. اندازه‌گیری قبل از
 * بهینه‌سازی (بند ۹/۰ب ریشه: اول ابزار، بعد نتیجه‌گیری).
 *
 * ⚠️ **نامِ دقیقِ این فیلدها در پاسخِ OpenRouter تأییدنشده است** (بند ۹/۰الف ریشه:
 * صفحه‌ی مستنداتش از این محیط باز نمی‌شود و از هیچ منبعِ خوانده‌نشده‌ای نقل نمی‌کنیم).
 * پس دو کارِ هم‌زمان: استخراج **چند شکلِ محتمل** را امتحان می‌کند، و یک لاگِ **یک‌باره**
 * شکلِ واقعیِ `usage` را چاپ می‌کند تا با اولین فراخوانیِ زنده نامِ درست معلوم شود.
 * اگر معلوم شد اسمی جا افتاده، افزودنش یک ردیف در همین آرایه است.
 *
 * ⚠️ و این هیچ چیزی به بدنه‌ی ریکوئست اضافه نمی‌کند: فقط چیزی که **از قبل** در پاسخ
 * هست خوانده می‌شود. قاعده‌ی آهنینِ بالا («صفر تغییر روی سیم») دست‌نخورده می‌ماند. */
const CACHED_PATHS = [
  ['prompt_tokens_details', 'cached_tokens'],
  ['prompt_tokens_details', 'cache_read_tokens'],
  ['cache_read_input_tokens'],
  ['prompt_cache_hit_tokens'],
  ['cached_tokens'],
];
const REASONING_PATHS = [
  ['completion_tokens_details', 'reasoning_tokens'],
  ['reasoning_tokens'],
];
const pickNum = (obj, paths) => {
  for (const path of paths) {
    let cur = obj;
    for (const key of path) cur = (cur && typeof cur === 'object') ? cur[key] : undefined;
    const n = Number(cur);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

let usageShapeLogged = false;
/* یک بار در عمرِ پروسه، **کلیدهای** آبجکتِ usage را چاپ می‌کند (نه محتوای کاربر —
 * این آبجکت فقط شمارنده‌ی توکن و هزینه دارد). تنها راهِ فهمیدنِ نامِ واقعیِ فیلدها
 * وقتی مستندات در دسترس نیست. بعد از اولین دیپلوی، `Ops logs app=tarot` را با
 * مارکرِ `USAGE_SHAPE` بگرد. */
function logUsageShape(u) {
  if (usageShapeLogged) return;
  usageShapeLogged = true;
  try {
    const flat = [];
    for (const [k, v] of Object.entries(u)) {
      if (v && typeof v === 'object') for (const k2 of Object.keys(v)) flat.push(`${k}.${k2}`);
      else flat.push(k);
    }
    log(`🔎 USAGE_SHAPE ${flat.sort().join(',').slice(0, 500)}`);
  } catch { /* لاگِ تشخیصی هرگز نباید مسیرِ فال را لمس کند */ }
}

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
        logUsageShape(u);
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
          cachedTokens: pickNum(u, CACHED_PATHS),
          reasoningTokens: pickNum(u, REASONING_PATHS),
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
    /* 🗣 `opts.messages` برای **گفتگوی چندنوبتی** (v3.84.0) است و کاملاً افزایشی:
     * با `undefined` (یعنی هر فراخوانیِ فال، تعمیر، کارتِ روز و رسید) رشته‌ی نهایی
     * بایت‌به‌بایت همان قبلی است، چون این شاخه دقیقاً همان دو پیامِ system/user را
     * می‌سازد. همان استدلالی که `usage:{include:true}` و برچسبِ حسابداری رویش
     * ساخته شدند: «صفر تغییر روی سیم» برای مسیری که کاربرِ پولی روی آن است.
     * چکِ CI بدنه‌ی مسیرِ فال را کلید-به-کلید دوباره می‌سنجد. */
    messages: opts.messages || [{ role: 'system', content: system }, { role: 'user', content: user }],
  // برچسبِ حسابداری (کدام مسیر، کدام رکورد، کدام کاربر). عمداً **بیرونِ** بدنه‌ی ریکوئست
  // است تا هیچ‌وقت به سیم نرود و نتواند رفتارِ مدل را عوض کند.
  }, { kind: opts.kind, refId: opts.refId, userId: opts.userId });
}

// فراخوانی مقاوم: چند تلاش با مدل اصلی، بعد مدل فالبک؛ validate اختیاری برای ردکردن خروجی خراب.
// `usage` و شماره‌ی تلاش هم برمی‌گردند تا آزمایشگاه بتواند هزینه و نرخِ retry را گزارش کند
// (ربات فقط `out` و `model` را می‌خواند، پس این افزودنی چیزی را عوض نمی‌کند).
/* 🔗 زنجیره‌ی فالبکِ خوانش (تصمیمِ صریحِ مالک ۱۴۰۵/۰۶/۱۰): سه تلاش روی مدلِ خودِ
 * زبان، بعد **جمنای**، بعد **دیپ‌سیک**.
 *
 * چرا ترتیب عوض شد: تا امروز فالبک مستقیم دیپ‌سیک بود، چون مدلِ اصلی خودش جمنای
 * بود و فالبکِ هم‌خانواده بی‌معنی است. حالا که هر چهار زبان روی `luna` اند، جمنای
 * از «همان مدل» به «نزدیک‌ترین مدلِ سنجیده‌شده‌ی دیگر» تبدیل شده: تنها مدلی که در
 * این ریپو روی هر چهار زبان اندازه‌گیری شده و **صدا هم می‌فهمد**. دیپ‌سیک یک پله
 * عقب‌تر می‌ماند چون در دورِ ۹ روسی هم بی‌لنگرِ بدتری داد و هم دُمِ تأخیرِ ۳۱ثانیه‌ای.
 *
 * ⚠️ اگر `READING_MODEL` دوباره `FLASH` شود (رول‌بک)، این آرایه به چهار تلاشِ جمنای
 * به‌علاوه‌ی یک دیپ‌سیک تبدیل می‌شود. بی‌ضرر است و عمداً ساده نگه داشته شده. */
export const READING_PLAN = [READING_MODEL, READING_MODEL, READING_MODEL, FLASH, FALLBACK_MODEL];

/* 🗣 زنجیره‌ی **گفتگوی پس از فال** (v3.84.0).
 *
 * چرا همان مدلِ خوانش: اولویتِ صریحِ مالک یکسان بودنِ لحن است، و تمامِ کارِ دو دورِ
 * ۹۰فالیِ جفت‌شده که `luna` را برای فارسی انتخاب کرد روی همین صدا نشسته. مدلِ دومِ
 * متفاوت یعنی دو صدا در یک تجربه: کاربر فال را با یک لحن می‌خواند و جوابِ سؤالش را
 * با لحنِ دیگری می‌گیرد.
 *
 * چرا **دو** تلاش روی مدلِ اصلی و نه سه (برخلافِ `READING_PLAN`): خروجی این‌جا کوتاه
 * است و `validate` فقط شکل را می‌سنجد، پس شکستِ تلاشِ اول تقریباً همیشه خرابیِ شبکه
 * است نه خرابیِ محتوا؛ تلاشِ سومِ همان مدل چیزی اضافه نمی‌کند و کاربر منتظر می‌ماند. */
export const CHAT_MODEL = (process.env.CHAT_MODEL || '').trim() || READING_MODEL;
export const CHAT_PLAN  = [CHAT_MODEL, CHAT_MODEL, FLASH, FALLBACK_MODEL];
export async function orChatResilient(system, user, opts = {}, plan = READING_PLAN) {
  const usages = [];
  for (let i = 0; i < plan.length; i++) {
    try {
      const { text: out, usage } = await orChat(system, user, { ...opts, model: plan[i] });
      usages.push(usage);
      /* ⚠️ گزارشِ «یک فراخوانی واقعاً به مدل رسید»، مستقل از اینکه validate قبولش کند
       * یا نه. بدونِ این، مسیرِ شکست (`return null` پایین) کلِ `usages` را دور می‌ریزد و
       * از بیرون هیچ راهی نیست بفهمی مدل جواب داد ولی جوابش رد شد، یا اصلاً فراخوانی
       * نشد. آزمایشگاه دقیقاً همین دو را از هم جدا می‌کند و با نبودِ این callback
       * «ردِ validate» را به‌غلط «به مدل نرسید» گزارش می‌کرد.
       * روی ربات بی‌اثر است: `onUsage` را فقط آزمایشگاه پاس می‌دهد، و `orChat` بدنه‌ی
       * ریکوئست را فیلدبه‌فیلد می‌سازد پس این گزینه هرگز به سیم نمی‌رود. */
      try { opts.onUsage?.(usage); } catch { /* هرگز نباید فال را بشکند */ }
      if (!opts.validate || opts.validate(out)) return { out, model: plan[i], attempts: i + 1, usages };
      logErr(`LLM invalid output (attempt ${i + 1}, ${plan[i]})`);
    } catch (e) {
      logErr(`LLM error (attempt ${i + 1}, ${plan[i]}):`, e.message);
    }
    if (i < plan.length - 1) await sleep(1500);
  }
  return null;
}

/* 🎙 ═══ مسیرِ رونویسیِ ویس ═══
 *
 * از ۱۴۰۵/۰۶/۱۰ هر چهار زبان روی `luna` اند و `luna` صدا نمی‌فهمد، پس **همه‌ی**
 * زبان‌ها از این مسیر رد می‌شوند. تا دیروز فارسی و روسی صدا را مستقیم به مدلِ خوانش
 * می‌دادند و این مسیر فقط یک شاخه‌ی فرعی بود؛ حالا تنها راهِ ورودِ ویس به محصول است.
 * یعنی یک نقطه‌ی خرابیِ بی‌فالبک وسطِ مسیرِ **پول‌داده‌شده** — که دقیقاً همان چیزی است
 * که این پلن می‌بندد (تصمیمِ صریحِ مالک).
 *
 * چرا دو تلاش روی جمنای و بعد ویسپر، نه مستقیم ویسپر:
 *   - شایع‌ترین خرابی خطای گذرا یا شلوغیِ لحظه‌ای است و تلاشِ دومِ همان مدل می‌گیردش،
 *     با هزینه‌ی ~$۰٫۰۰۰۷ per دقیقه.
 *   - ویسپر **مسیرِ واقعاً مستقل** است (وندورِ دیگر و endpointِ دیگر)، پس قطعیِ کاملِ
 *     جمنای را هم پوشش می‌دهد. ولی طبقِ اندازه‌گیریِ خودمان **۸٫۸ برابر** گران‌تر است
 *     ($۰٫۰۰۶ per دقیقه)، پس جایش پله‌ی آخر است نه اول. جزئیات: I18N-ES-STT-RESEARCH.md.
 *   - ⚠️ و شواهدی که جمع کردیم می‌گویند ویسپر روی اسپانیاییِ لاتین **بهتر نیست**؛
 *     این‌جا نقشش «در دسترس بودن» است نه «دقتِ بیشتر». اگر روزی خواستیم روی کیفیت
 *     انتخابش کنیم، اول `tools/stt-eval.mjs` روی صدای واقعی اجرا شود.
 *
 * `:stt` یعنی endpointِ اختصاصیِ رونویسی (`/audio/transcriptions`) نه chat completions.
 * ⚠️ آن endpoint برچسبِ فرمت را جدی می‌گیرد و بایتِ ogg با برچسبِ mp3 را رد می‌کند —
 * برای همین باگِ برچسبِ فرمت در `index.js` باید **قبل از** روشن‌شدنِ این پله درست
 * می‌شد، و شد. */
export const TRANSCRIBE_MODEL    = FLASH;
export const TRANSCRIBE_FALLBACK = 'openai/whisper-1:stt';
export const TRANSCRIBE_PLAN     = [TRANSCRIBE_MODEL, TRANSCRIBE_MODEL, TRANSCRIBE_FALLBACK];
export const TRANSCRIBE_PROMPT   =
  'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.';

// endpointِ اختصاصیِ رونویسی. جدا از `orRequest` است چون نه `messages` می‌گیرد نه
// `choices` برمی‌گرداند؛ ولی حسابداریِ مصرف عیناً از همان سینک می‌رود تا هزینه‌ی این
// پله هم در `llm_usage` دیده شود (وگرنه گران‌ترین پله نامرئی‌ترین هم می‌شد).
async function sttRequest(model, dataB64, format, meta) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OR_TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keyOf()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input_audio: { data: dataB64, format } }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      logErr(`❌ OpenRouter STT ${res.status} (${model}):`, errBody.slice(0, 300));
      throw new Error(`OpenRouter STT error ${res.status}`);
    }
    const data = await res.json();
    const u = data.usage || {};
    if (usageSink && USAGE_ACCOUNTING) {
      try {
        usageSink({
          model, kind: meta?.kind || '', refId: Number(meta?.refId) || 0, userId: Number(meta?.userId) || 0,
          promptTokens: 0, completionTokens: 0, totalTokens: 0,
          costUsd: Number(u.cost) || 0, ms: Date.now() - t0,
        });
      } catch (e) { logErr('usage sink:', e.message); }
    }
    return String(data.text || '').trim();
  } finally { clearTimeout(timer); }
}

export async function orTranscribe(audioBuffer, format, meta = null, plan = TRANSCRIBE_PLAN) {
  const dataB64 = audioBuffer.toString('base64');
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const isStt = entry.endsWith(':stt');
    const model = isStt ? entry.slice(0, -4) : entry;
    try {
      const text = isStt
        ? await sttRequest(model, dataB64, format, meta)
        : (await orRequest({
            model,
            messages: [{ role: 'user', content: [
              { type: 'text', text: TRANSCRIBE_PROMPT },
              { type: 'input_audio', input_audio: { data: dataB64, format } },
            ] }],
          }, meta)).text;
      if (text && text.trim()) return text;
      logErr(`TRANSCRIBE خروجیِ خالی (تلاشِ ${i + 1}، ${entry})`);
    } catch (e) {
      logErr(`TRANSCRIBE خطا (تلاشِ ${i + 1}، ${entry}):`, e.message);
    }
    if (i < plan.length - 1) await sleep(1500);
  }
  return null;   // همه‌ی پله‌ها سوختند؛ صدا زننده خودش fail-safe است (خوانش نمی‌شکند)
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
const DASH_T = langTable('، ');
/* جداکننده‌ی نام از سرخط. ⚠️ این هم مثل `DASH_TO` یک ویرگولِ **عربی** بود، پس هر فالِ
 * روسی با «Аня، …» شروع می‌شد: یک نویسه‌ی فارسی در **اولین خطِ** محصولِ پولی، در هر
 * فال. سنجه‌ی تازه‌ی نویسه‌ی بیگانه دقیقاً همین را گرفت. */
const NAME_T = langTable('، ');
export function configureSeparator(sep, nameSep, lang = DEFAULT_LANG) {
  const dash = (typeof sep === 'string' && sep) ? sep : DASH_T.for(lang);
  DASH_T.set(lang, dash);
  // پیش‌فرضِ جداکننده‌ی نام همان جداکننده‌ی خط‌تیره است: هر دو «ویرگولِ همان زبان» اند،
  // پس یک زبان با ست‌کردنِ یکی، دومی را هم درست می‌گیرد و نمی‌تواند نصفه بماند.
  NAME_T.set(lang, (typeof nameSep === 'string' && nameSep) ? nameSep : dash);
}
/* نشانه‌گذاریِ مارک‌داون که مدل خودسرانه تولید می‌کند.
 *
 * ⚠️ چرا این یک باگِ **رو-به-کاربر** است و نه زیبایی‌شناسی: متنِ v4 عمداً **بدونِ**
 * `parse_mode` فرستاده می‌شود (کامنتِ `deliverReading`), پس تلگرام هیچ نشانه‌گذاری‌ای
 * را تفسیر نمی‌کند و کاربر عیناً ستاره‌ها را می‌بیند. کامنتِ قبلی می‌گفت «خروجیِ v4
 * هیچ قالب‌بندی‌ای ندارد» — ولی این یک **فرض** درباره‌ی رفتارِ مدل بود، نه چیزی که
 * تضمین شده باشد. دورِ اولِ آزمایشگاهِ روسی خلافش را نشان داد: سرخطِ یک فال با
 * `**очень вероятно**` تحویل شد. زبانش هم مهم نیست، پس گارد برای **هر دو** است.
 *
 * فقط نشانه‌ها برداشته می‌شوند، نه متنِ داخلشان. `_` تکی عمداً دست نمی‌خورد چون در
 * وسطِ کلمه رایج است و برداشتنش متن را خراب‌تر می‌کند تا درست‌تر. */
const stripMarkup = (t) => String(t)
  .replace(/\*\*(.+?)\*\*/gs, '$1')      // **بولد**
  .replace(/__(.+?)__/gs, '$1')          // __بولد__
  .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/gs, '$1$2') // *ایتالیک*
  .replace(/`+/g, '')                    // بک‌تیک و بلوکِ کد
  .replace(/^\s{0,3}#{1,6}\s+/gm, '');   // تیترِ مارک‌داون

export const noDash = (t) => { const d = DASH_T.get(); return stripMarkup(String(t).replace(/\s*—\s*/g, d).replace(/\s*--\s*/g, d)); };

// ⏱ `agoFa` (فاصله‌ی زمانی به فارسیِ گفتاری) حذف شد. تاریخچه‌ی کوتاهش درس دارد:
// اول مدل زمانِ فال‌های قبلی را از خودش می‌ساخت («پارسال» برای فالی که ۱۰ دقیقه قبل
// بود)، پس داده‌ی دقیق اضافه کردیم؛ بعد مدل همان داده را هم نادیده گرفت و «هفته‌های
// قبل» نوشت، پس قاعده‌ی پرامپت اضافه کردیم؛ بعد قاعده را سراسری کردیم. سه لایه وصله
// روی چیزی که **اصلاً لازم نبود**: کاربر در بخشِ یادآوری نمی‌خواهد بداند فالِ قبلی کِی
// بوده، می‌خواهد بداند یادش هست چه پرسیده. پس خودِ داده حذف شد و مسئله از بین رفت.
// (بازه‌ی زمانیِ **آینده** در جمع‌بندی سرِ جایش است؛ آن‌جا واقعاً ارزش دارد.)

/* 🌍 مرزِ «روز» و ساعتِ یادآوری per زبان. تا امروز `Asia/Tehran` هاردکد بود و برای
 * رباتِ فارسی درست؛ ولی همان کد سه رباتِ دیگر را هم اجرا می‌کند و آن‌جا یعنی:
 *   • کارتِ رایگانِ روزانه‌ی کاربرِ برزیلی ساعتِ ۱۷:۳۰ بعدازظهرِ **روزِ قبل** ری‌ست
 *     می‌شد (نیمه‌شبِ تهران)، یعنی مهم‌ترین قلابِ رایگانِ محصول سرِ ساعتِ بی‌ربط.
 *   • «یادآوریِ شبانه»ی ساعت ۲۲ برای او ۱۵:۳۰ بعدازظهر می‌رسید — یعنی نه شبانه بود
 *     نه یادآوری، فقط یک پیامِ ناخواسته وسطِ روز (و دلیلِ بلاک شدن).
 * استریک هم روی همین مرز حساب می‌شود، پس اشتباه بودنش یعنی استریکِ اشتباه.
 *
 * `fa` عمداً همان `Asia/Tehran` است، پس رباتِ زنده بیت‌به‌بیت دست‌نخورده می‌ماند.
 * ⚠️ اسپانیاییِ آمریکای لاتین چند منطقه‌ی زمانی دارد و انتخابِ یک منطقه یک **تصمیم**
 * است نه یک حقیقت: بزرگ‌ترین بازار (مکزیک) انتخاب شد. اگر روزی دیتای واقعیِ کاربر
 * خلافش را گفت، همین یک ردیف عوض می‌شود. */
const TZ_BY_LOCALE = {
  fa: 'Asia/Tehran',
  /* ⚠️ انگلیسی یک کشور نیست، پس «منطقه‌ی زمانیِ درست» برایش وجود ندارد. UTC انتخاب شد
   * چون تنها گزینه‌ی بی‌طرف است: هر انتخابِ دیگری یک قاره را بی‌دلیل ترجیح می‌دهد.
   * وقتی دیتای واقعیِ کاربر آمد، همین یک ردیف عوض می‌شود. */
  en: 'UTC',
  ru: 'Europe/Moscow',
  pt: 'America/Sao_Paulo',
  es: 'America/Mexico_City',
};
/* 🌍 per زبانِ زمینه‌ی جاری. مرزِ روز روی مسیرِ **استریک و کارتِ روز** می‌نشیند، پس
 * یک پروسه‌ی چندزبانه نمی‌تواند یک منطقه‌ی زمانی داشته باشد: کاربرِ روس باید نیمه‌شبِ
 * مسکو روزِ تازه بگیرد و کاربرِ برزیلی نیمه‌شبِ سائوپائولو.
 * `BOT_TZ` در env همچنان همه را override می‌کند (تکِ رباتِ تک‌زبانه، و تست‌ها). */
export const botTz = () => process.env.BOT_TZ?.trim() || TZ_BY_LOCALE[currentLang()] || 'Asia/Tehran';
/** سازگاریِ با گذشته برای مصرف‌کننده‌های تک‌زبانه (چک‌های CI). زبانِ پیش‌فرضِ پروسه. */
export const BOT_TZ = process.env.BOT_TZ?.trim() || TZ_BY_LOCALE[LOCALE] || 'Asia/Tehran';

// «امروز» به وقتِ همان ربات. نامش عمداً دیگر «tehran» نیست: یک نامِ دروغ روی مسیرِ
// پول و استریک، همان چیزی است که شش ماه بعد کسی را گمراه می‌کند.
export const botToday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: botTz() }).format(d);
// n روز قبل، به وقتِ همان ربات (پنجره‌ی «۷ روزِ اخیر» و محاسبه‌ی استریک).
export const botDaysAgo = (n) => botToday(new Date(Date.now() - n * 86400_000));
// ساعتِ فعلیِ همان ربات، برای جاروی یادآوری.
export const botHour = () => parseInt(new Intl.DateTimeFormat('en-US', {
  timeZone: botTz(), hour: '2-digit', hour12: false,
}).format(new Date()), 10);

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
    /* 🌍 کلیدهای این آبجکت هم **متنِ پرامپت** اند، نه فقط ساختارِ داخلی: عیناً داخلِ
     * JSONِ ورودیِ مدل می‌روند. تا امروز فارسیِ هاردکد بودند، پس رباتِ روسی یک آبجکتِ
     * با کلیدِ فارسی می‌گرفت. دو ضرر داشت و هر دو بی‌صدا بودند:
     *   ۱) نویسه‌ی فارسی داخلِ پرامپتِ غیرفارسی، دقیقاً همان چیزی که
     *      `check-card-knowledge` برای دادهٔ کارت ممنوع کرده.
     *   ۲) سنجه‌ی «لنگرِ حافظه» در آزمایشگاه با `summaryKey`ِ همان زبان دنبالِ خلاصه
     *      می‌گشت و `undefined` می‌گرفت، پس جمله‌ای که به فالِ قبلی لنگر داشت
     *      **بی‌لنگر** شمرده می‌شد و نرخِ روسی الکی بالا می‌رفت.
     * برای `fa` این کلیدها عیناً همان‌های قبلی‌اند (پیش‌فرضِ زیر)، پس رفتارِ رباتِ
     * زنده بیت‌به‌بیت دست‌نخورده است. */
    previous: prev.map(r => ({
      [CTX_KEYS.type]: r.type,
      [CTX_KEYS.summary]: r.summary,
      [CTX_KEYS.feedback]: r.feedback || '-',
    })),
    today: botToday(),
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
    ? `${SECT.headline} ${name ? `${name}${NAME_T.get()}` : ''}${noDash(llm.headline)}`
    : '';
  return {
    headline: head,
    body,
    closing: llm.closing ? `${SECT.closing} ${noDash(llm.closing)}` : '',
  };
}
