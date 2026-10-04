// 🕐 قاعده‌ی سومِ «کاربرِ مشکوک»: ساعتِ پرداختِ چاپ‌شده در رسید (v3.149.0، خواسته‌ی مالک ۱۴۰۵/۰۷/۱۱).
//
// ایجنتِ رسید فقط ساعت را **می‌خواند** (`extracted.paid_time`، `cardpay.js`)؛ هر مقایسه‌ای این‌جاست،
// در کدِ خالص و قابلِ‌تست (بند ۹ ریشه: «مدل فقط می‌خواند، کد حساب می‌کند»). سه حالتِ مشکوک، به ترتیب:
//   ۱) `no_time`: رسید ساعت ندارد (یا مدل نتوانست بخواند) ⟵ تصمیمِ فعلیِ مالک: مشکوک.
//   ۲) `repeat`: ساعت:دقیقه **دقیقاً** برابرِ یکی از رسیدهای قبلیِ همین کاربر است. این‌جا هیچ تبدیلِ
//      ۱۲/۲۴ ساعته‌ای انجام نمی‌شود: گوشیِ هر کاربر یک قالب دارد و رسیدهای بعدی‌اش هم با همان می‌آیند.
//   ۳) `window`: لحظه‌ی فرستادنِ رسید به ربات در بازه‌ی [ساعتِ رسید، ساعتِ رسید + ۳۰ دقیقه] نیست. یعنی
//      احتمالاً رسیدِ قدیمیِ گالری است. **فقط این‌جا** قالبِ ۱۲ساعته هم امتحان می‌شود (۸:۲۰ ⟵ ۲۰:۲۰)
//      و اگر یکی از دو خوانش بنشیند، مشکوک نمی‌شود. بدونِ ارفاق: یک دقیقه قبل از ساعتِ رسید هم مشکوک است.
//
// ⚠️ حدِ صداقتِ این قاعده: فقط ساعت سنجیده می‌شود نه تاریخ. رسیدی که دقیقاً یک روزِ قبل در همان ساعت
// گرفته شده از قاعده‌ی ۳ رد می‌شود (و اگر کاربر رسیدِ دیگری در همان دقیقه نداشته، از قاعده‌ی ۲ هم).

import { parsePaidTime } from './cardpay.js';

export const RECEIPT_TIME_WINDOW_MIN = 30;
const DAY_MIN = 24 * 60;

/** دقیقه‌ی روز (۰ تا ۱۴۳۹) به وقتِ تهران برای یک لحظه‌ی یونیکس (ثانیه). */
export function tehranMinuteOfDay(unixSec) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Number(unixSec) * 1000));
  const h = Number(parts.find((x) => x.type === 'hour')?.value);
  const m = Number(parts.find((x) => x.type === 'minute')?.value);
  return (h % 24) * 60 + m;
}

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** آیا ارسال در بازه‌ی [ساعتِ رسید، +windowMin] افتاده؟ عبور از نیمه‌شب هم درست حساب می‌شود. */
function fitsWindow(receiptMin, uploadMin, windowMin) {
  const diff = (uploadMin - receiptMin + DAY_MIN) % DAY_MIN;
  return diff <= windowMin;
}

/** خوانشِ ۱۲ساعته‌ی جایگزین: فقط برای ساعتِ ۱ تا ۱۲ معنی دارد (۱۲ ⟵ ۰۰، بقیه +۱۲). */
function altTwelveHour(receiptMin) {
  const h = Math.floor(receiptMin / 60);
  if (h < 1 || h > 12) return null;
  return ((h === 12 ? 0 : h + 12) * 60) + (receiptMin % 60);
}

/**
 * تصمیمِ قاعده‌ی ساعت. ورودی: ساعتِ خامِ مدل، لحظه‌ی ارسال (ثانیه‌ی یونیکس) و ساعت‌های رسیدهای قبلیِ
 * همین کاربر. خروجی: null یعنی سالم، وگرنه { code, hhmm, upload, alt? } برای لاگ و پیامِ ادمین.
 */
export function receiptTimeSuspicion({ paidTime, uploadSec, prevTimes = [], windowMin = RECEIPT_TIME_WINDOW_MIN }) {
  const { hhmm } = parsePaidTime(paidTime);
  const upMin = tehranMinuteOfDay(uploadSec);
  const upload = fmt(upMin);
  if (!hhmm) return { code: 'no_time', hhmm: null, upload };
  const prev = new Set((prevTimes || []).map((t) => parsePaidTime(t).hhmm).filter(Boolean));
  if (prev.has(hhmm)) return { code: 'repeat', hhmm, upload };
  const r = toMin(hhmm);
  if (fitsWindow(r, upMin, windowMin)) return null;
  const alt = altTwelveHour(r);
  if (alt !== null && fitsWindow(alt, upMin, windowMin)) return null;
  return { code: 'window', hhmm, upload };
}

const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/**
 * خطِ ادمین که می‌گوید چرا قاعده‌ی ساعت این رسید را مشکوک کرد (فقط رو-به-ادمین؛ کاربر هرگز نمی‌بیند).
 * ورودی همان خروجیِ `receiptTimeSuspicion` (یا null). خالی یعنی «هیچ خطی».
 */
export function timeFlagLine(sus) {
  if (!sus || !sus.code) return '';
  const w = faDigits(RECEIPT_TIME_WINDOW_MIN);
  if (sus.code === 'no_time') return '🕐 ساعتِ پرداخت در رسید پیدا نشد\n\n';
  if (sus.code === 'repeat') return `🕐 ساعتِ رسید (${faDigits(sus.hhmm)}) با یکی از رسیدهای قبلیِ همین کاربر یکی است\n\n`;
  if (sus.code === 'window') {
    return `🕐 ساعتِ رسید ${faDigits(sus.hhmm)}، ارسال ${faDigits(sus.upload)} (بیرون از بازه‌ی ${w} دقیقه)\n\n`;
  }
  return '';
}
