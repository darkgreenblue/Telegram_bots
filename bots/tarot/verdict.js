// «جوابِ قاطع» برای فال‌های تصمیم‌محور (آری یا نه، دوراهی).
//
// چرا: فیدبکِ یک کاربرِ واقعی — «خیلی خوب بود فقط اون جوابی که می‌خواستم رو آخر
// نفهمیدم و نگرفتم... من قبلاً تجربه‌ی فال تاروت ویسی یا تلفنی داشتم و معمولاً یک
// بله یا خیرِ قطعی می‌گیرم». و نکته‌ی اصلی‌اش: «اگه توش نشونه‌ای بتونه ببینه توی اون
// جوابه، می‌تونه خودشو آروم کنه.» یعنی چیزی که کم بود فقط قاطعیت نبود، «نشونه» بود.
//
// این ماژول عمداً **خالص و بدونِ وابستگی** است (مثل reco.js) تا بشود بدونِ DB و
// بدونِ شبکه تستش کرد: tools/check-verdict.mjs.
//
// قانونِ اصلی: خروجیِ مبهم بهتر است **اصلاً نشان داده نشود** تا اینکه به‌عنوانِ
// «جوابِ قاطع» به کاربر داده شود. اگر مدل «شاید» یا «بستگی داره» برگرداند،
// normalizeVerdict مقدارِ null می‌دهد و ربات دوباره تلاش می‌کند؛ اگر باز هم نشد،
// خوانش مثلِ قبل و بدونِ بخشِ جواب تحویل می‌شود (هرگز خوانش را نمی‌شکند).

// `DIRECT` از بازنگریِ لحن آمد (نسخه‌ی دوم خوانش): **هر** فال باید به سؤالِ کاربر جواب
// بدهد، نه فقط فال‌های تصمیم‌محور. جواب این‌جا متنِ آزاد است (چون سؤال آزاد است) ولی از
// همان فیلترِ ابهام رد می‌شود: جوابی که «شاید» و «بستگی داره» باشد نمایش داده نمی‌شود.
export const VERDICT_MODES = { BINARY: 'binary', CHOICE: 'choice', DIRECT: 'direct' };

export const VERDICT_LIMITS = { sign: 300, because: 300, nuance: 200, answer: 240 };

export const BINARY_ANSWERS = { YES: 'آره', NO: 'نه' };
export const CHOICE_ANSWERS = { FIRST: 'مسیر اول', SECOND: 'مسیر دوم' };

const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

// نرمال‌سازی: عربی→فارسی، حذفِ اعراب و نیم‌فاصله، ارقامِ فارسی→لاتین، حذفِ نشانه‌گذاری
function norm(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, (d) => FA_DIGITS[d])
    .replace(/[يﻱﻲ]/g, 'ی')
    .replace(/[كﻙﻚ]/g, 'ک')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/[ً-ْ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const tokens = (s) => norm(s).split(' ').filter(Boolean);

/* 🌍 دادهٔ زبانیِ این ماژول از locale می‌آید (بند ۲و).
 *
 * ⚠️ چرا این لازم شد: تا اینجا همه‌ی مجموعه‌ها فارسیِ هاردکد بودند، یعنی روی یک
 * رباتِ روسی `normalizeVerdict` برای «Да» **null** برمی‌گرداند و `headlineOk` هر
 * سرخطِ روسی را رد می‌کرد. نتیجه‌اش خرابیِ بی‌صدا بود: بلوکِ جوابِ قاطع، که تمایزِ
 * اصلیِ محصول است (بند ۱۰)، بی‌هیچ خطایی از خوانش حذف می‌شد.
 *
 * پیش‌فرض‌ها فارسی می‌مانند تا اگر کسی `configureVerdict` را صدا نزد رفتار عوض
 * نشود، ولی index.js همیشه از روی locale صدایش می‌زند تا فارسی هم تک‌منبع باشد.
 * الگوی مرجع: `setUsageSink` در همین ربات. */
let LEX = {
  answers: { YES: 'آره', NO: 'نه', FIRST: 'مسیر اول', SECOND: 'مسیر دوم' },
  yes: ['اره', 'بله', 'اری', 'مثبت', 'یس', 'yes', 'y', 'true'],
  no: ['نه', 'خیر', 'منفی', 'نو', 'no', 'n', 'false'],
  first: ['اول', 'اولی', 'اولین', 'یک', 'یکم', '1', 'a', 'الف', 'patha'],
  second: ['دوم', 'دومی', 'دومین', 'دو', 'دویی', '2', 'b', 'ب', 'pathb'],
  ambiguous: [
    'هر دو', 'هردو', 'هیچ کدام', 'هیچکدام', 'هیچ کدوم', 'هیچکدوم',
    'فرقی', 'شاید', 'بستگی', 'نامشخص', 'مشخص نیست', 'نمی دونم', 'نمیدونم', 'معلوم نیست',
  ],
  direction: [
    'بله', 'اره', 'اری', 'نه', 'خیر', 'محتمل', 'احتمال', 'احتمالا',
    'می شه', 'میشه', 'می رسی', 'میرسی', 'هست', 'نیست',
  ],
  evasion: [
    'بستگی به خودت', 'بستگی داره', 'شاید اره شاید نه', 'هم این هم اون',
    'فقط خودت می دونی', 'فقط خودت میدونی', 'به شهودت',
  ],
  register: ['کائنات'],
  but: ['اما', 'ولی', 'اگر', 'اگه', 'مگر', 'مگه'],
  pastTime: /(پارسال|سالِ? ?(پیش|گذشته)|سال‌ها پیش|ماهِ? ?(پیش|گذشته)|ماه‌ها پیش|ماه‌های قبل|هفتهٔ? ?(پیش|گذشته)|هفته‌ی (پیش|گذشته)|هفته‌ها پیش|هفته‌های قبل|روزهای قبل|چند وقت پیش|دفعه‌ی قبل که|بارِ? قبل که)/,
};

/** دادهٔ زبانیِ ماژول را از locale می‌گیرد. یک‌بار موقعِ boot صدا زده می‌شود. */
export function configureVerdict(lex) {
  if (!lex || typeof lex !== 'object') return;
  LEX = { ...LEX, ...lex };
  // الگوی زمانی به‌صورت رشته می‌آید (تا شکلِ locale قابلِ مقایسه بماند) و این‌جا کامپایل می‌شود
  // ⚠️ پرچمِ `i` اجباری است: در زبان‌های لاتین و سیریلیک عبارتِ زمانی معمولاً **اولِ**
  // جمله می‌آید و با حرفِ بزرگ شروع می‌شود («В прошлом году…»). بدونِ `i` دقیقاً همان
  // حالتی که بیشتر رخ می‌دهد از گارد رد می‌شد. فارسی حرفِ بزرگ ندارد، پس بی‌اثر است.
  if (lex.pastTimePattern) { try { LEX.pastTime = new RegExp(lex.pastTimePattern, 'i'); } catch { /* الگوی خراب: همان قبلی می‌ماند */ } }
  // ⚠️ `EVASION`، `BINARY_ANSWERS` و `CHOICE_ANSWERS` از بیرون import می‌شوند (index.js
  // و دو چکِ CI)، پس **در جا** پر می‌شوند نه جایگزین. اگر به‌جایش دوباره تعریفشان
  // می‌کردیم، هر کسی که قبلاً import کرده بود به نسخه‌ی فارسیِ کهنه چسبیده می‌ماند.
  if (lex.evasion) { EVASION.length = 0; EVASION.push(...lex.evasion); }
  if (lex.answers) {
    if (lex.answers.YES) BINARY_ANSWERS.YES = lex.answers.YES;
    if (lex.answers.NO) BINARY_ANSWERS.NO = lex.answers.NO;
    if (lex.answers.FIRST) CHOICE_ANSWERS.FIRST = lex.answers.FIRST;
    if (lex.answers.SECOND) CHOICE_ANSWERS.SECOND = lex.answers.SECOND;
  }
}

const YES = () => new Set(LEX.yes);
const NO = () => new Set(LEX.no);
const FIRST = () => new Set(LEX.first);
const SECOND = () => new Set(LEX.second);

// عبارت‌هایی که خودشان یعنی «جواب ندادم». باید **قبل از** تطبیقِ توکنی چک شوند،
// وگرنه دامی مثل «هر دو» به‌خاطر کلمه‌ی «دو» به‌اشتباه «مسیر دوم» خوانده می‌شود.
const AMBIGUOUS = () => LEX.ambiguous;

/* آیا متن یکی از عبارت‌های «مبهم» را دارد؟
 *
 * 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۱۲ (ممیزیِ QA): این بررسی زیررشته‌ای بود، پس در روسی کلمه‌ی
 * «обе» داخلِ «ос-ОБЕ-нно» و «ОБЕ-щает» پیدا می‌شد. یعنی جوابِ کاملاً سالمِ
 * «Да, скорее всего, особенно если…» مبهم شمرده می‌شد، بلوکِ جوابِ قاطع بی‌صدا حذف
 * می‌شد و کلِ فال با هزینه‌ی کاملِ مدل دوباره تولید می‌شد.
 *
 * عبارتِ **چندکلمه‌ای** همچنان زیررشته‌ای می‌ماند (باید داخلِ جمله پیدا شود)، ولی
 * تک‌کلمه‌ای فقط وقتی می‌شمارد که **خودش یک توکن** باشد. این تمایز زبان‌مستقل است. */
function hasAmbiguous(value) {
  const flat = norm(value);
  if (!flat) return false;
  const t = flat.split(' ').filter(Boolean);
  return AMBIGUOUS().some((p) => {
    const q = norm(p);
    if (!q) return false;
    return q.includes(' ') ? flat.includes(q) : t.includes(q);
  });
}

// یکی از دو سمت را انتخاب می‌کند؛ اگر هر دو یا هیچ‌کدام دیده شوند یعنی جواب مبهم است.
// (پرامپت صریحاً یک کلمه می‌خواهد و شرط/زمان‌بندی جای خودش را در فیلدِ nuance دارد،
// پس «هم آره هم نه» یعنی مدل دستور را نادیده گرفته و باید دوباره تلاش شود.)
function pickSide(value, setA, setB, outA, outB) {
  const flat = norm(value);
  if (hasAmbiguous(value)) return null;
  const t = tokens(value);
  if (!t.length) return null;
  const hasA = t.some((w) => setA.has(w));
  const hasB = t.some((w) => setB.has(w));
  if (hasA === hasB) return null; // هر دو، یا هیچ‌کدام → مبهم
  return hasA ? outA : outB;
}

// برچسبِ اختصاصیِ دو سمتِ یک فالِ تقابلی (spreads.js → choiceLabels)، مثل «موندن»/«جدایی».
// چرا لازم شد: «مسیر دوم» جوابِ قابلِ لمسی برای «تعهد یا خیانت؟» نیست؛ کاربر باید همان
// کلمه‌ای را ببیند که در عنوانِ فال دیده. اگر برچسب‌ها توکنِ مشترک داشته باشند (یعنی
// تفکیک‌ناپذیرند) بی‌صدا به حالتِ عمومیِ «مسیر اول/دوم» برمی‌گردیم، نه اینکه اشتباه انتخاب کنیم.
function labelSets(labels) {
  if (!Array.isArray(labels) || labels.length !== 2) return null;
  const [a, b] = labels.map((l) => tokens(l));
  if (!a.length || !b.length) return null;
  if (a.some((w) => b.includes(w))) return null;
  return {
    setA: new Set([...FIRST(), ...a]),
    setB: new Set([...SECOND(), ...b]),
    outA: String(labels[0]).trim(),
    outB: String(labels[1]).trim(),
  };
}

const clean = (s, max) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max).trimEnd()}…` : v;
};

/**
 * خروجیِ خامِ مدل را به یک «جوابِ قاطعِ قابلِ نمایش» تبدیل می‌کند.
 * @param {any} raw آبجکتِ verdict که مدل برگردانده (هر چیزی می‌تواند باشد)
 * @param {string} mode یکی از VERDICT_MODES
 * @returns {{answer: string, sign: string, because: string, nuance: string}|null}
 *          null یعنی «قابلِ اتکا نیست» → نمایش نده و دوباره تلاش کن.
 */
export function normalizeVerdict(raw, mode, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  let answer = null;
  if (mode === VERDICT_MODES.BINARY) {
    answer = pickSide(raw.answer, YES(), NO(), BINARY_ANSWERS.YES, BINARY_ANSWERS.NO);
  } else if (mode === VERDICT_MODES.CHOICE) {
    const cl = labelSets(opts.choiceLabels);
    answer = cl
      ? pickSide(raw.answer, cl.setA, cl.setB, cl.outA, cl.outB)
      : pickSide(raw.answer, FIRST(), SECOND(), CHOICE_ANSWERS.FIRST, CHOICE_ANSWERS.SECOND);
  } else if (mode === VERDICT_MODES.DIRECT) {
    // متنِ آزاد، ولی همان سخت‌گیری: جوابی که خودش «جواب ندادم» است رد می‌شود.
    // یک جمله‌ی کوتاه هم لازم است (تک‌کلمه‌ای مثل «بله» بدونِ ادامه، جوابِ سؤالِ باز نیست).
    const v = clean(raw.answer, VERDICT_LIMITS.answer);
    const flat = norm(v);
    if (v && !hasAmbiguous(v) && tokens(v).length >= 3) answer = v;
  }
  if (!answer) return null;

  // «نشونه» اجباری است: بدونِ آن این فقط یک بله/خیرِ خالی است و همان چیزی می‌شود
  // که کاربر گفت کافی نبود.
  const sign = clean(raw.sign, VERDICT_LIMITS.sign);
  if (!sign) return null;

  return {
    answer,
    sign,
    because: clean(raw.because, VERDICT_LIMITS.because),
    nuance: clean(raw.nuance, VERDICT_LIMITS.nuance),
  };
}

/**
 * آیا این چیدمان جوابِ قاطع می‌خواهد؟
 * @param {object} spread چیدمان
 * @param {boolean} toneV2 در نسخه‌ی دوم لحن، **هر** فال جواب می‌دهد: چیدمانی که
 *   `decisive` ندارد حالتِ `direct` می‌گیرد (جوابِ متنیِ کوتاه به سؤالِ خودِ کاربر)
 *   به‌جای اینکه اصلاً جواب ندهد.
 */
export const decisiveMode = (spread, toneV2 = false) =>
  spread?.decisive || (toneV2 ? VERDICT_MODES.DIRECT : null);

// ───────────────────────────────────────────────────────────────────────────
// سرخطِ خوانش (v4) — «بله‌ی گران»
// ───────────────────────────────────────────────────────────────────────────
// از تحلیلِ خوانش‌های واقعی: سرخط همیشه یک فرمولِ ثابت دارد و همان فرمول، محصول است.
//
//     [جهت] + [قیدِ احتمال] + «اما/ولی/اگر» + [بهای مشخص]
//
// نمونه‌های واقعی: «بله با احتمال نسبتا بالا، اما با تاخیر»، «در کل: بله، اما نه به
// شکل فعلی»، «جواب در کل، بله اما آسون نخواهد بود».
//
// چرا هر دو شرط اجباری‌اند:
// - بدونِ **جهت**، کاربر با همان ابهامی می‌رود که با آن آمده بود (شکایتِ اصلیِ کاربران).
// - بدونِ **«ولی»**، جواب یک تعریفِ توخالی می‌شود؛ هر دو تحقیق هشدار می‌دهند که
//   خوش‌بینیِ کاذب (sugarcoating) اعتماد را می‌خورد و کاربر زود می‌فهمد.
// «ولی» نرم‌کننده نیست، خودِ ارزش است: هم جواب را باورپذیر می‌کند و هم چیزی را
// باز می‌گذارد که دلیلِ طبیعیِ برگشتن می‌شود.

const DIRECTION = () => LEX.direction;

/* 🌍 **چطور** تطبیق داده شود، per زبان — نه چه چیزی.
 *
 * ⚠️ باگی که آزمایشگاهِ روسی (دورِ ۵) لو داد: فارسی فعل و صفت را برای این کار صرف
 * نمی‌کند، پس `includes` روی کلمه‌ی کامل جواب می‌داد. روسی می‌کند: فهرست
 * «вероятно» داشت و مدل «вероятен» می‌نوشت، «получится» داشت و مدل «решится».
 * نتیجه: از ۱۰ تلاشِ ردشده‌ی آن دور، **۸ تا سرخطِ کاملاً درست** بودند که گارد
 * نشناخت — یعنی هر بار یک فالِ کاملِ دوباره‌تولیدشده (~$۰.۰۰۵) دور ریخته شد و دو
 * فال تا فالبکِ ارزان‌تر عقب رفتند. خرابی هم بی‌صدا بود: کاربر خوانشِ سالم می‌گرفت،
 * فقط ما پول و کیفیت می‌سوزاندیم.
 * بدتر اینکه رد کردن **تصادفی** بود نه سخت‌گیرانه: `да` به‌عنوان زیررشته داخلِ
 * «когда» و «правда» و «даже» می‌افتد، پس سرخطی که اتفاقاً یکی از آن‌ها را داشت
 * رد نمی‌شد. یعنی گارد نه سخت بود نه شل، **نویز** بود.
 *
 * درمان per زبان است نه سراسری: `directionStem: true` یعنی «تطبیق سرِ توکن
 * می‌نشیند»، و در آن حالت خودِ ردیف می‌گوید چطور: ستاره‌ی آخر (`вероят*`) یعنی
 * **ریشه**، و بدونِ ستاره (`да`) یعنی **کلمه‌ی کامل**. این تفکیک لازم است، نه
 * تزئینی: `да` یک ذرهٔ دوحرفی است و به‌عنوان ریشه داخلِ «давно» و «даже» می‌افتد،
 * یعنی همان نویزِ بالا از در دیگری برمی‌گشت. عبارتِ چندکلمه‌ای در هر حالت
 * `includes` می‌ماند، چون ریشه‌گیری روی توکن برایش بی‌معنی است.
 * فارسی این پرچم را ندارد، پس رفتارش بیت‌به‌بیت همان `includes`ِ قبلی می‌ماند و
 * رباتِ زنده اصلاً لمس نمی‌شود. */
const hasDirection = (t) => {
  const list = DIRECTION();
  if (!LEX.directionStem) return list.some((d) => t.includes(norm(d)));
  const words = t.split(' ').filter(Boolean);
  return list.some((d) => {
    const star = String(d).endsWith('*');
    const n = norm(star ? String(d).slice(0, -1) : d);
    if (!n) return false;
    if (n.includes(' ')) return t.includes(n);          // عبارتِ چندکلمه‌ای
    return star ? words.some((w) => w.startsWith(n))    // ریشه
      : words.includes(n);                              // کلمه‌ی کامل
  });
};
// عبارت‌هایی که یعنی «جواب ندادم» — حتی اگر «ولی» هم داشته باشند.
// این‌ها **قولِ اصلیِ محصول** را می‌شکنند: کاربر آمده جواب بگیرد و اینها جواب را به
// خودش پس می‌دهند. بازخوردِ واقعیِ کاربر همین بود: «اون جوابی که می‌خواستم رو آخر
// نفهمیدم و نگرفتم» (بند ۱۰ ریشه).
export const EVASION = [
  'بستگی به خودت', 'بستگی داره', 'شاید اره شاید نه', 'هم این هم اون',
  'فقط خودت می دونی', 'فقط خودت میدونی', 'به شهودت',
];
// «کائنات» از جنسِ دیگری است: طفره‌رفتن نیست، فقط واژگانِ عمومیِ نامطلوب است. در سرخط
// رد می‌شود (سرخط کوتاه است و یک کلمه‌ی این‌شکلی کلش را خراب می‌کند) ولی در متنِ بلند
// ارزشِ یک بازتولیدِ کامل را ندارد — تفکیکشان عمدی است، نه سهو.
const REGISTER = () => LEX.register;
const NO_DIRECTION = () => [...EVASION, ...LEX.register];

// اشاره‌ی زمانی به **گذشته**: مدل تاریخِ جلسه‌های قبل را ندارد، پس هر «پارسال» و
// «هفته‌ی پیش» ساخته‌ی خودش است — یعنی به کاربر دروغ می‌گوید. اینجاست نه در
// آزمایشگاه، چون گارد و سنجه باید از **یک** تعریف بخوانند (درسِ گافِ تیزر).
const PAST_TIME = () => LEX.pastTime;

/**
 * اشاره‌ی زمانیِ ساختگی به گذشته. برخلاف `evasionIn` روی متنِ **خام** کار می‌کند
 * (نه نرمال‌شده) چون الگوها نیم‌فاصله و «ی» دارند.
 * @returns {string|null}
 */
export function pastTimeIn(raw) {
  const m = String(raw || '').match(PAST_TIME());
  return m ? m[0] : null;
}

/**
 * طفره‌رفتن در **کلِ متنِ** خوانش. تا v3.6.2 این گارد فقط روی سرخط اجرا می‌شد، پس
 * «بستگی داره» یا «به شهودت اعتماد کن» در جمع‌بندی یا خوانشِ کارت‌ها آزادانه رد
 * می‌شد — و آزمایشگاه در ۸۱ فال سه بار همین را گرفت.
 * @param {string} raw کلِ متنی که به کاربر می‌رسد
 * @returns {string|null} عبارتِ پیداشده، یا null اگر تمیز بود
 */
export function evasionIn(raw) {
  const t = norm(raw);
  return EVASION.find((p) => t.includes(norm(p))) || null;
}
const BUT = () => LEX.but;

/**
 * سرخط را اعتبارسنجی می‌کند. `false` یعنی دوباره تلاش کن.
 * @param {string} raw متنِ سرخط
 * @returns {boolean}
 */
export function headlineOk(raw) {
  const t = norm(raw);
  if (!t || t.split(' ').filter(Boolean).length < 4) return false;
  if (NO_DIRECTION().some((p) => t.includes(norm(p)))) return false;
  if (!hasDirection(t)) return false;
  return BUT().some((b) => t.split(' ').includes(norm(b)));
}
