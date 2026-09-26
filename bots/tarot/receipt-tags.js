/* 🔎 خوانشِ «فقط ثبتِ» ایجنتِ رسید و (از فازِ ۶) تگ‌های اپ و بانکِ مبدأ.
 *
 * ماژولِ **خالص**: هیچ import از npm، هیچ دیتابیس، هیچ تلگرام. `index.js` ردیفِ
 * `receipt_analyses` را می‌خواند و از همین‌جا متن می‌سازد، پس
 * `tools/check-receipt-shadow.mjs` همین توابع را مستقیم اجرا می‌کند (نه کپیِ منطق).
 *
 * متن‌ها عمداً فارسیِ ثابت‌اند و در locale نیستند (همان استدلالِ `cards-admin.js`): این خط
 * فقط روی پیامِ رسیدِ **مالک** و فقط روی رباتِ فارسی (ریلِ کارت‌به‌کارت) دیده می‌شود. */

/** برچسبِ نمایشیِ اپ‌ها. کلیدها همان enumِ `BANK_APPS` در `cardpay.js` اند. */
export const APP_LABELS = {
  blu: 'بلو',
  ap: 'آپ',
  780: '۷۸۰',
  top: 'تاپ',
  hamrahcard: 'همراه‌کارت',
  mobilebank: 'موبایل‌بانک',
  other: 'سایر',
};

/** ارقامِ لاتین ⟵ فارسی (فقط برای نمایش). */
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** یک خطِ کوتاه برای پیامِ رسیدِ مالک از ردیفِ `receipt_analyses`. `''` یعنی چیزی برای
 *  گفتن نیست (ایجنت اجرا نشد، شکست خورد، یا هیچ فیلدی خوانده نشد): آن‌وقت خطی اضافه
 *  نمی‌شود تا پیامِ مالک با «نامشخص · نامشخص · نامشخص» شلوغ نشود. */
export function shadowLine(row) {
  if (!row || !row.ok) return '';
  const parts = [];
  if (row.app) parts.push(`اپ: ${APP_LABELS[row.app] || row.app}`);
  if (row.src_prefix) parts.push(`کارتِ مبدأ: ${faDigits(row.src_prefix)}…`);
  if (row.transfer_error) parts.push('⛔️ خطای انتقال');
  if (!parts.length) return '';
  return `🔎 ایجنت: ${parts.join(' · ')}`;
}

/** کپشن + خطِ ایجنت، بدونِ اینکه خطِ ایجنت با سقفِ کپشن بریده شود: اگر جا نبود، از خودِ
 *  کپشن کم می‌شود نه از خط. */
export function withShadowLine(caption, line, limit) {
  if (!line) return String(caption).slice(0, limit);
  const tail = `\n\n${line}`;
  return String(caption).slice(0, Math.max(0, limit - tail.length)) + tail;
}
