// 🎴 گنجینه — متنِ از-پیش-نوشته‌ی کارتِ روز، بر اساسِ **ماهِ تولد**.
//
// قاعده‌ی آهنین (تصمیمِ صریحِ مالک، ۱۴۰۵/۰۵/۲۷): کارتِ روز **هرگز** با LLM ساخته نمی‌شود.
// نه فراخوانیِ زنده، نه فالبک، نه «فقط این یک بار». دلیلش هم اقتصاد است و هم کیفیت:
// کارتِ روز رایگان است و روزی یک بار برای **هر** کاربر اجرا می‌شود، یعنی تنها مسیری که
// هزینه‌اش با تعدادِ کاربر خطی بالا می‌رود بدونِ اینکه درآمدی پشتش باشد. متنِ از پیش
// نوشته‌شده هم ارزان‌تر است، هم قابلِ بازبینیِ انسانی، هم همیشه همان کیفیت را می‌دهد.
//
// چرا JSON و نه جدولِ SQLite: این متن‌ها **محتوا** اند نه دیتای کاربر — نوشته می‌شوند،
// در گیت دیف می‌خورند، ریویو می‌شوند و با deploy می‌روند. دقیقاً مثل `card-knowledge.fa.json`.
// در جدولِ DB نه دیف دارند نه ریویو، و هر اصلاحِ تایپی یک مهاجرت می‌خواهد.
//
// ساختار: { "<ماه ۱..۱۲>": { "<کلیدِ کارت>": ["نسخه‌ی ۱", "نسخه‌ی ۲", "نسخه‌ی ۳"] } }
// ماه‌ها شمسی‌اند (۱ = فروردین). سه نسخه per کارت per ماه، طبق قاعده‌ی عدم‌تکرارِ پایین.
//
// ⏳ **وضعیتِ فعلی: نگارشِ انبوه در مرحله‌ی بعد.** ۱۲ ماه × ۷۸ کارت × ۳ نسخه = ۲۸۰۸ متن،
// و مالک تصمیم گرفت این حجم با یک مدلِ ارزان‌تر نوشته شود. تا آن موقع فایل فقط چند
// نمونه دارد و **همین کافی است که فلو کار کند**: کارتی که متن ندارد اصلاً وارد قرعه
// نمی‌شود (تابعِ `eligibleCards`)، پس هیچ کاربری به متنِ خالی نمی‌خورد.
import { readFileSync } from 'node:fs';
import { logErr } from '../../shared/logger.js';

let DATA = {};
try {
  DATA = JSON.parse(readFileSync(new URL('./daily-ganjineh.fa.json', import.meta.url), 'utf8'));
} catch (e) {
  // fail-safe: نبودنِ فایل نباید ربات را بکشد. نتیجه‌اش «هیچ کارتی واجد شرایط نیست» است
  // که خودِ کارتِ روز با پیامِ مؤدبانه هندلش می‌کند.
  logErr('گنجینه بارگذاری نشد:', e.message);
}

export const VARIANTS = 3;          // چند نسخه per کارت per ماه
export const NO_REPEAT_DAYS = 7;    // کارتِ دیده‌شده تا این تعداد روز دوباره نمی‌آید

export const MONTHS_FA = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
export const monthFa = (m) => MONTHS_FA[Number(m) - 1] || '';

/** آیا برای این ماه و این کارت متنی نوشته شده؟ */
export const hasText = (month, cardKey) =>
  Array.isArray(DATA?.[String(month)]?.[cardKey]) && DATA[String(month)][cardKey].length > 0;

/** متنِ نسخه‌ی مشخص. اگر آن نسخه نبود، اولین نسخه‌ی موجود. */
export function textOf(month, cardKey, variant = 0) {
  const arr = DATA?.[String(month)]?.[cardKey];
  if (!Array.isArray(arr) || !arr.length) return '';
  return String(arr[variant] || arr[0] || '').trim();
}

/** چند متن در کلِ گنجینه هست (برای گزارشِ پیشرفتِ نگارش و چکِ CI). */
export function stats() {
  let months = 0, cards = 0, texts = 0;
  for (const m of Object.keys(DATA || {})) {
    if (m.startsWith('_')) continue;   // کلیدهای توضیحی، نه ماه
    months++;
    for (const k of Object.keys(DATA[m] || {})) {
      cards++;
      texts += (DATA[m][k] || []).length;
    }
  }
  return { months, cards, texts };
}

/**
 * کارت‌هایی که **امروز** می‌توانند برای این کاربر بیایند.
 *
 * دو شرط، هر دو لازم:
 *   ۱) در `recentKeys` نباشد — یعنی در ۷ روزِ اخیر دیده نشده. این همان قاعده‌ای است که
 *      تضمین می‌کند کاربرِ هفت‌روزه هفت کارتِ **متفاوت** می‌بیند. روزِ هشتم کارتِ روزِ اول
 *      دوباره وارد قرعه می‌شود، ولی انتخابش شانسی است نه چرخشی.
 *   ۲) برای ماهِ تولدِ او متن داشته باشد — وگرنه کاربر به متنِ خالی می‌خورد. تا وقتی
 *      گنجینه کامل نشده، همین شرط عملاً قرعه را محدود به کارت‌های نوشته‌شده می‌کند.
 *
 * اگر هیچ کارتی نماند (گنجینه‌ی خیلی کوچک)، شرطِ ۷ روز کنار گذاشته می‌شود — چون
 * «تکرارِ کارت» از «کارتِ روزِ نداشتن» بهتر است. صفر برگرداندن یعنی گنجینه‌ی آن ماه خالی است.
 */
export function eligibleCards(allKeys, month, recentKeys = []) {
  const recent = new Set(recentKeys);
  const written = allKeys.filter((k) => hasText(month, k));
  const fresh = written.filter((k) => !recent.has(k));
  return fresh.length ? fresh : written;
}

/**
 * کدام نسخه‌ی این کارت به این کاربر نشان داده شود.
 *
 * قاعده: نسخه‌ای که **ندیده**. اگر چند نسخه‌ی ندیده مانده، شانسی از بینشان؛ اگر هر سه را
 * دیده، شانسی از کلِ سه‌تا (چرخه بسته شده و تکرار اجتناب‌ناپذیر است).
 * `rand` تزریق می‌شود تا تست قطعی باشد.
 */
export function pickVariant(seenVariants = [], rand = Math.random) {
  const seen = new Set(seenVariants.map(Number));
  const all = Array.from({ length: VARIANTS }, (_, i) => i);
  const unseen = all.filter((v) => !seen.has(v));
  const pool = unseen.length ? unseen : all;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

export default DATA;
