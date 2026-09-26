// آمار A/B — طبق بنچمارک (GrowthBook/PostHog) و صادقانه برای نمونه‌ی کم:
//  - متریک نرخی (rate): chance-to-win بیزی با Beta-Binomial (prior یکنواخت Beta(1,1))
//    محاسبه با Monte Carlo قطعی (seed ثابت) — دقت ~±۰.۵٪ که برای تصمیم کافی است.
//  - متریک مقداری (value): فقط میانگین ± خطای استاندارد؛ CTW برایش تعریف نمی‌شود (صداقت آماری).
//  - چک SRM (chi-squared): انحراف توزیع exposure از وزن‌ها = باگ انتساب؛ هشدار در p<0.001.
//  - زیر MIN_SAMPLE exposure per variant: برچسب «کم‌نمونه؛ فقط جهت‌نما».

export const MIN_SAMPLE = 200;          // آستانه‌ی برچسب کم‌نمونه (بنچمارک ترافیک پایین)
export const SHIP_CTW = 0.85;           // قانون پیش‌فرض تصمیم: ship اگر CTW>85٪ و guardrail سالم
const MC_SAMPLES = 20000;

// PRNG قطعی (همان mulberry32 الگوی tarot) — نتیجه‌ی صفحه با هر refresh ثابت می‌ماند
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// نمونه‌گیری گاما (Marsaglia–Tsang) → Beta = Ga/(Ga+Gb)
function sampleGamma(shape, rnd) {
  if (shape < 1) {
    const u = rnd() || 1e-12;
    return sampleGamma(shape + 1, rnd) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Box–Muller
      const u1 = rnd() || 1e-12, u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd() || 1e-12;
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const sampleBeta = (a, b, rnd) => {
  const x = sampleGamma(a, rnd);
  return x / (x + sampleGamma(b, rnd));
};

// P(نرخ variant > نرخ control) با prior Beta(1,1)
export function chanceToWin(convVariant, nVariant, convControl, nControl) {
  if (!nVariant || !nControl) return null;
  const rnd = mulberry32(1234567);
  let wins = 0;
  for (let i = 0; i < MC_SAMPLES; i++) {
    const pv = sampleBeta(1 + convVariant, 1 + (nVariant - convVariant), rnd);
    const pc = sampleBeta(1 + convControl, 1 + (nControl - convControl), rnd);
    if (pv > pc) wins++;
  }
  return wins / MC_SAMPLES;
}

// بازه‌ی اطمینان ~۹۵٪ برای نرخ (تقریب نرمال روی Beta پسین)
export function rateCI(conv, n) {
  if (!n) return [0, 0];
  const a = 1 + conv, b = 1 + n - conv;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return [Math.max(0, mean - 1.96 * sd), Math.min(1, mean + 1.96 * sd)];
}

// erfc تقریبی (Abramowitz–Stegun 7.1.26) برای p-value کای‌دو با df=1
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
// survival function کای‌دو برای df=1 و df=2 (کافی برای ۲-۳ variant)
function chi2Sf(x, df) {
  if (x <= 0) return 1;
  if (df === 1) return erfc(Math.sqrt(x / 2));
  if (df === 2) return Math.exp(-x / 2);
  // تقریب Wilson–Hilferty برای df بالاتر
  const z = (Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return erfc(z / Math.SQRT2) / 2;
}

// چک SRM: exposureهای مشاهده‌شده در برابر وزن‌های تعریف‌شده. خروجی: {p, srm(bool)}
export function srmCheck(observed, weights) {
  const total = observed.reduce((s, c) => s + c, 0);
  const wTotal = weights.reduce((s, w) => s + w, 0);
  if (total < 50 || !wTotal) return { p: 1, srm: false }; // زیر ۵۰ نمونه چک بی‌معناست
  let x2 = 0;
  for (let i = 0; i < observed.length; i++) {
    const exp = total * (weights[i] / wTotal);
    if (exp > 0) x2 += (observed[i] - exp) ** 2 / exp;
  }
  const p = chi2Sf(x2, Math.max(1, observed.length - 1));
  return { p, srm: p < 0.001 };
}

// میانگین ± خطای استاندارد برای متریک مقداری
export function meanSE(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, se: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const varr = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, se: Math.sqrt(varr / n) };
}

/* P(میانگینِ variant > میانگینِ control) با تقریبِ نرمال روی دو {mean, se} از `meanSE`.
 * برای درآمدِ per کاربر استفاده می‌شود (صفرِ نپرداخته‌ها هم در میانگین هست). ⚠️ درآمد
 * دُمِ سنگین دارد و با پرداخت‌کننده‌ی کم این تقریب **شکننده** است؛ برای همین صفحه آن را
 * «تقریبی» برچسب می‌زند و تا هر دو طرف حداقل یک پرداخت نداشته باشند null برمی‌گرداند. */
export function chanceToWinMean(v, c) {
  if (!v?.n || !c?.n) return null;
  const sd = Math.sqrt(v.se ** 2 + c.se ** 2);
  if (!(sd > 0)) return v.mean === c.mean ? 0.5 : (v.mean > c.mean ? 1 : 0);
  const z = (v.mean - c.mean) / sd;
  return 1 - erfc(z / Math.SQRT2) / 2;
}
