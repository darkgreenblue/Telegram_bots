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

const YES = new Set(['اره', 'بله', 'اری', 'مثبت', 'یس', 'yes', 'y', 'true']);
const NO = new Set(['نه', 'خیر', 'منفی', 'نو', 'no', 'n', 'false']);
const FIRST = new Set(['اول', 'اولی', 'اولین', 'یک', 'یکم', '1', 'a', 'الف', 'patha']);
const SECOND = new Set(['دوم', 'دومی', 'دومین', 'دو', 'دویی', '2', 'b', 'ب', 'pathb']);

// عبارت‌هایی که خودشان یعنی «جواب ندادم». باید **قبل از** تطبیقِ توکنی چک شوند،
// وگرنه دامی مثل «هر دو» به‌خاطر کلمه‌ی «دو» به‌اشتباه «مسیر دوم» خوانده می‌شود.
const AMBIGUOUS = [
  'هر دو', 'هردو', 'هیچ کدام', 'هیچکدام', 'هیچ کدوم', 'هیچکدوم',
  'فرقی', 'شاید', 'بستگی', 'نامشخص', 'مشخص نیست', 'نمی دونم', 'نمیدونم', 'معلوم نیست',
];

// یکی از دو سمت را انتخاب می‌کند؛ اگر هر دو یا هیچ‌کدام دیده شوند یعنی جواب مبهم است.
// (پرامپت صریحاً یک کلمه می‌خواهد و شرط/زمان‌بندی جای خودش را در فیلدِ nuance دارد،
// پس «هم آره هم نه» یعنی مدل دستور را نادیده گرفته و باید دوباره تلاش شود.)
function pickSide(value, setA, setB, outA, outB) {
  const flat = norm(value);
  if (AMBIGUOUS.some((p) => flat.includes(p))) return null;
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
    setA: new Set([...FIRST, ...a]),
    setB: new Set([...SECOND, ...b]),
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
    answer = pickSide(raw.answer, YES, NO, BINARY_ANSWERS.YES, BINARY_ANSWERS.NO);
  } else if (mode === VERDICT_MODES.CHOICE) {
    const cl = labelSets(opts.choiceLabels);
    answer = cl
      ? pickSide(raw.answer, cl.setA, cl.setB, cl.outA, cl.outB)
      : pickSide(raw.answer, FIRST, SECOND, CHOICE_ANSWERS.FIRST, CHOICE_ANSWERS.SECOND);
  } else if (mode === VERDICT_MODES.DIRECT) {
    // متنِ آزاد، ولی همان سخت‌گیری: جوابی که خودش «جواب ندادم» است رد می‌شود.
    // یک جمله‌ی کوتاه هم لازم است (تک‌کلمه‌ای مثل «بله» بدونِ ادامه، جوابِ سؤالِ باز نیست).
    const v = clean(raw.answer, VERDICT_LIMITS.answer);
    const flat = norm(v);
    if (v && !AMBIGUOUS.some((p) => flat.includes(p)) && tokens(v).length >= 3) answer = v;
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

const DIRECTION = [
  'بله', 'اره', 'اری', 'نه', 'خیر', 'محتمل', 'احتمال', 'احتمالا',
  'می شه', 'میشه', 'می رسی', 'میرسی', 'هست', 'نیست',
];
// عبارت‌هایی که یعنی «جواب ندادم» — حتی اگر «ولی» هم داشته باشند
const NO_DIRECTION = [
  'بستگی به خودت', 'بستگی داره', 'شاید اره شاید نه', 'هم این هم اون',
  'فقط خودت می دونی', 'فقط خودت میدونی', 'به شهودت', 'کائنات',
];
const BUT = ['اما', 'ولی', 'اگر', 'اگه', 'مگر', 'مگه'];

/**
 * سرخط را اعتبارسنجی می‌کند. `false` یعنی دوباره تلاش کن.
 * @param {string} raw متنِ سرخط
 * @returns {boolean}
 */
export function headlineOk(raw) {
  const t = norm(raw);
  if (!t || t.split(' ').filter(Boolean).length < 4) return false;
  if (NO_DIRECTION.some((p) => t.includes(norm(p)))) return false;
  if (!DIRECTION.some((d) => t.includes(norm(d)))) return false;
  return BUT.some((b) => t.split(' ').includes(norm(b)));
}
