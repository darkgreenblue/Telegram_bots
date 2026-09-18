/* 🌍 زبانِ **هر کاربر**، نه زبانِ پروسه — پایه‌ی رباتِ چندزبانه (بند ۲و CLAUDE.md ریشه).
 *
 * ── مسئله ──────────────────────────────────────────────────────────────────
 * تا امروز هر زبان یک اپِ pm2 جدا بود و `LOCALE` یک ثابتِ سرِ boot: یک پروسه، یک زبان.
 * استراتژیِ تازه یک رباتِ واحد برای همه‌ی زبان‌های غیرفارسی می‌خواهد، یعنی **یک پروسه
 * که هم‌زمان به چند زبان جواب می‌دهد**. در آن دنیا «زبان» دیگر یک ثابتِ ماژول نیست،
 * یک خاصیتِ همان آپدیتی است که دارد پردازش می‌شود.
 *
 * ── چرا AsyncLocalStorage و نه یک آرگومانِ `lang` در ۵۵۷ نقطه ──────────────
 * `index.js` امروز ۵۵۷ بار `L.` می‌نویسد. تبدیلِ مکانیکیِ همه‌شان به `Lof(uid).` یک
 * دیفِ غیرقابلِ ریویو روی رباتِ زنده‌ی درآمدزا می‌سازد و هر نقطه‌ای که `uid` در دسترس
 * نداشته باشد یک باگِ تازه است. ALS همان کاری را می‌کند که «زبانِ این آپدیت» معنی
 * می‌دهد: یک مقدارِ ضمنی که با زنجیره‌ی async خودش جابه‌جا می‌شود (شاملِ await،
 * setTimeout و then)، پس هندلرِ همان کاربر بدونِ هیچ تغییری زبانِ درستش را می‌بیند.
 *
 * ── مرزِ صداقتِ این مکانیزم ────────────────────────────────────────────────
 * ALS فقط جایی کار می‌کند که یک **زمینه** وجود داشته باشد. کدی که از یک `setInterval`
 * سرِ boot اجرا می‌شود (جاروهای شبانه، صفِ `admin_actions`، بازیابیِ فلوهای یتیم) هیچ
 * زمینه‌ای ندارد، پس **باید صریح** `withLang(lang, fn)` بپیچد. این نقص نیست، خودِ
 * قرارداد است: مسیری که کاربرش را نمی‌شناسد حق ندارد زبانش را حدس بزند.
 *
 * برای اینکه این «باید» یک آرزو نماند، پروسه‌ی چندزبانه در نبودِ زمینه یک مارکرِ
 * greppable چاپ می‌کند (`❌ LANG_UNSET`) و بعد به زبانِ پیش‌فرض برمی‌گردد. یعنی
 * بدترین حالت «کاربرِ روس یک پیامِ انگلیسی می‌گیرد **و لاگ می‌گوید کجا**» است، نه
 * خرابیِ بی‌صدا — همان چیزی که این ریپو بارها بابتش هزینه داده (بند ۶ب-۲).
 * `LANG_STRICT=1` همان حالت را به پرتابِ خطا تبدیل می‌کند؛ فقط برای چک‌های CI.
 *
 * ── پروسه‌ی تک‌زبانه بیت‌به‌بیت دست‌نخورده است ──────────────────────────────
 * `LANGS` وقتی ست نشده باشد دقیقاً `[LOCALE]` است. آن‌وقت `currentLang()` همیشه همان
 * یک زبان را می‌دهد، هیچ هشداری ممکن نیست (چون فقط یک جواب وجود دارد)، و `L` همان
 * آبجکتی است که قبلاً مستقیم import می‌شد. پس `tarot` (فارسی) و `tarot-pt` هیچ تغییرِ
 * رفتاری نمی‌بینند.
 *
 * گاردِ CI: `tools/check-locale-ctx.mjs` (رفتاری — زمینه‌های موازی را واقعاً می‌دواند).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** زبانِ پیش‌فرضِ این پروسه. برای ربات‌های تک‌زبانه تنها زبانش. */
export const DEFAULT_LANG = process.env.LOCALE?.trim() || 'fa';

/* فهرستِ زبان‌هایی که این پروسه سرو می‌کند. `LANGS` خالی = تک‌زبانه (رفتارِ امروز).
 * پیش‌فرض همیشه اولِ فهرست می‌نشیند تا «اولین زبان» و «زبانِ پیش‌فرض» یکی بماند و
 * جایی که به ترتیب تکیه می‌کند (منوی انتخابِ زبان) غافلگیر نشود. */
export const LANGS = (() => {
  const raw = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
  const list = raw.length ? raw : [DEFAULT_LANG];
  return [DEFAULT_LANG, ...list.filter(l => l !== DEFAULT_LANG)];
})();

/** آیا این پروسه واقعاً چندزبانه است؟ تک‌زبانه هیچ‌وقت هشدار نمی‌دهد. */
export const MULTI_LANG = LANGS.length > 1;

const STRICT = process.env.LANG_STRICT === '1';
const KNOWN  = new Set(LANGS);

/** زبانِ ناشناخته → پیش‌فرض. هرگز پرتاب نمی‌کند: ورودی‌اش از دیتابیس و از تپِ کاربر می‌آید. */
export const normLang = (lang) => {
  const s = String(lang ?? '').trim().toLowerCase();
  return KNOWN.has(s) ? s : DEFAULT_LANG;
};

/** آیا این رشته یکی از زبان‌های همین پروسه است؟ (`normLang` را قورت نمی‌دهد) */
export const isLang = (lang) => KNOWN.has(String(lang ?? '').trim().toLowerCase());

const als = new AsyncLocalStorage();

/* هشدارِ «زمینه نداریم» با dedup روی ردِ پشته، وگرنه یک حلقه‌ی پرتکرار لاگ را غرق
 * می‌کند و دقیقاً همان بی‌معنا شدنِ هشدار را می‌سازد که بند ۳ ریشه ثبتش کرده. */
const warned = new Set();
function warnUnset() {
  if (!MULTI_LANG) return;                      // تک‌زبانه: یک جواب بیشتر وجود ندارد
  const at = (new Error().stack || '').split('\n').slice(2, 5).join(' | ');
  if (STRICT) throw new Error(`LANG_UNSET: زبان بیرونِ زمینه خوانده شد — ${at}`);
  if (warned.has(at) || warned.size > 200) return;
  warned.add(at);
  console.error(`❌ LANG_UNSET زبان بیرونِ زمینه خوانده شد (به ${DEFAULT_LANG} برگشت) — ${at}`);
}

/** زبانِ آپدیتی که همین حالا در حالِ پردازش است. */
export function currentLang() {
  const s = als.getStore();
  if (s) return s.lang;
  warnUnset();
  return DEFAULT_LANG;
}

/** آیا همین حالا داخلِ یک زمینه‌ی زبانی هستیم؟ (بدونِ هشدار — برای خودِ گاردها) */
export const hasLangCtx = () => Boolean(als.getStore());

/**
 * `fn` را داخلِ زمینه‌ی زبانِ داده‌شده اجرا می‌کند. ALS خودش از await و timer و then
 * عبور می‌کند، پس هرچه از دلِ `fn` صدا زده شود همین زبان را می‌بیند.
 * خروجی = خروجیِ خودِ `fn` (پس روی میدل‌ورِ تلگراف هم مستقیم می‌نشیند).
 */
export function withLang(lang, fn) {
  return als.run({ lang: normLang(lang) }, fn);
}

/* ── بسته‌های زبانی ────────────────────────────────────────────────────────
 * همه‌ی زبان‌های این پروسه سرِ boot بار می‌شوند، نه تنبل. دلیلش صداقتِ خرابی است:
 * یک `locales/xx.js` خرابِ کشف‌نشده باید ربات را همان لحظه پایین بیاورد، نه ساعت‌ها
 * بعد وسطِ فالِ اولین کاربرِ آن زبان. */
const BUNDLES = Object.create(null);
for (const lang of LANGS) {
  BUNDLES[lang] = (await import(`./locales/${lang}.js`)).default;
}

/** بسته‌ی یک زبانِ مشخص. برای مسیرهایی که زبان را **می‌دانند** (پیامِ جارو به کاربر X). */
export const Lfor = (lang) => BUNDLES[normLang(lang)];

/**
 * `L` — همان نامی که ۵۵۷ نقطه‌ی `index.js` می‌شناسند، ولی حالا به زبانِ **زمینه‌ی
 * جاری** وصل است. هیچ کلیدی بینِ زبان‌ها fallback نمی‌شود: کلیدِ جاافتاده یک باگِ
 * ترجمه است که `check-locale-shape` باید قرمزش کند، نه چیزی که در زمانِ اجرا با
 * متنِ زبانِ دیگر پنهان شود (وگرنه کاربرِ روس بی‌صدا یک جمله‌ی انگلیسی می‌بیند).
 */
export const L = new Proxy(Object.create(null), {
  get:  (_t, k) => BUNDLES[currentLang()][k],
  has:  (_t, k) => k in BUNDLES[currentLang()],
  ownKeys: () => Reflect.ownKeys(BUNDLES[currentLang()]),
  getOwnPropertyDescriptor: (_t, k) =>
    Reflect.getOwnPropertyDescriptor(BUNDLES[currentLang()], k),
  set: () => { throw new Error('locale فقط-خواندنی است'); },
});

/**
 * جدولِ «یک مقدار per زبان» با همان قفلِ زمینه. هر ماژولی که دادهٔ زبانی دارد
 * (جدولِ دانشِ کارت، لغتنامه‌ی تعمیر، گاردهای گفتگو) از همین استفاده می‌کند تا
 * نقطه‌ی انتخابِ زبان در کلِ ریپو **یکی** بماند.
 *
 *   const tbl = langTable();  tbl.set('ru', x);  tbl.get()  // ← زبانِ زمینه
 */
export function langTable(fallback = undefined) {
  const byLang = Object.create(null);
  return {
    set: (lang, value) => { byLang[normLang(lang)] = value; },
    get: () => (currentLang() in byLang ? byLang[currentLang()] : fallback),
    for: (lang) => (normLang(lang) in byLang ? byLang[normLang(lang)] : fallback),
    has: (lang) => normLang(lang) in byLang,
  };
}

/**
 * همان کلید، در **همه‌ی** زبان‌های این پروسه (یکتا، بدونِ مقدارِ خالی).
 *
 * ⚠️ چرا لازم است و کجا اجباری است: `bot.hears(...)` و `KB_LABELS` **لحظه‌ی ثبت** ارزیابی
 * می‌شوند، یعنی بیرونِ هر زمینه‌ای. اگر آن‌جا `L.buttons.reading` نوشته شود، فقط برچسبِ
 * زبانِ پیش‌فرض ثبت می‌شود و تپِ کاربرِ روسی روی دکمه‌ی خودش **به هیچ هندلری نمی‌رسد** —
 * بی‌صدا، چون تلگراف چیزی که match نشود را به هندلرِ متنِ آزاد می‌دهد.
 *
 * و یک خاصیتِ جانبیِ لازم: کیبوردِ reply روی گوشیِ کاربر کش می‌شود، پس کاربری که زبانش
 * را عوض کرده هنوز مدتی برچسبِ **زبانِ قبلی** را دارد. اتحادِ همه‌ی زبان‌ها همان را هم
 * پوشش می‌دهد، بدونِ هیچ کدِ اضافه.
 *
 *   allLabels(l => l.buttons.reading)   // ['🔮 فال بگیر', '🔮 Погадать', …]
 */
export function allLabels(pick) {
  const out = new Set();
  for (const lang of LANGS) {
    let v; try { v = pick(BUNDLES[lang]); } catch { v = null; }
    if (typeof v === 'string' && v) out.add(v);
  }
  return [...out];
}

/**
 * یک آبجکتِ **زنده** از یک زیرشاخه‌ی locale: هر بار که مصرف‌کننده یک کلید می‌خواند،
 * از زبانِ زمینه‌ی جاری خوانده می‌شود.
 *
 * ⚠️ کجا اجباری است: هر جا یک آبجکتِ متن **لحظه‌ی ثبت** به یک ماژول پاس داده می‌شود
 * ولی کلیدهایش **لحظه‌ی درخواست** خوانده می‌شوند (`registerSupport`, `starspay`). یک
 * `texts: L.support` خام آن‌جا یعنی همان زیرشاخه‌ی زبانِ پیش‌فرض برای همیشه قفل می‌شود
 * و کاربرِ روس تا ابد متنِ انگلیسی می‌گیرد — بی‌صدا، چون هیچ کلیدی گم نیست.
 *
 * فرقش با `allLabels`: آن برای جایی است که خودِ **مقدار** لحظه‌ی ثبت لازم است
 * (`bot.hears`)، این برای جایی که فقط **ارجاع** پاس می‌شود و بعداً خوانده می‌شود.
 *
 *   texts: liveL(l => l.support)
 */
export function liveL(pick) {
  const cur = () => { try { return pick(BUNDLES[currentLang()]) ?? {}; } catch { return {}; } };
  return new Proxy(Object.create(null), {
    get: (_t, k) => cur()[k],
    has: (_t, k) => k in cur(),
    ownKeys: () => Reflect.ownKeys(cur()),
    // configurable اجباری است: ویژگی روی خودِ target وجود ندارد، پس پروکسی حق ندارد
    // آن را non-configurable گزارش کند (نامتغیرِ زبان).
    getOwnPropertyDescriptor: (_t, k) => {
      const d = Reflect.getOwnPropertyDescriptor(cur(), k);
      return d ? { ...d, configurable: true } : undefined;
    },
    set: () => { throw new Error('locale فقط-خواندنی است'); },
  });
}
