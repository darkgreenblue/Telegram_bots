// ابزارهای مشترک داشبورد: زمان تهران، فرمت اعداد، escape
// همه‌ی تجمیع‌های «روزانه» باید با مرز روزِ تهران محاسبه شوند نه UTC (باگ کلاسیک شیفت ۳.۵ ساعته).
const TEHRAN_OFFSET_S = 3.5 * 3600; // ایران از ۲۰۲۲ تغییر ساعت فصلی ندارد

export const nowSec = () => Math.floor(Date.now() / 1000);

// unix شروعِ روزِ تهرانِ امروز (+offsetDays)
export function tehranDayStart(offsetDays = 0) {
  const teh = nowSec() + TEHRAN_OFFSET_S;
  return Math.floor(teh / 86400) * 86400 - TEHRAN_OFFSET_S + offsetDays * 86400;
}
// تاریخ تهرانِ یک unix (YYYY-MM-DD میلادی برای مرتب‌سازی/گروه‌بندی)
export const tehranDayStr = (unixSec) => new Date((unixSec + TEHRAN_OFFSET_S) * 1000).toISOString().slice(0, 10);
// نمایش تاریخ‌وقت تهران برای UI
export function tehranDateTime(unixSec) {
  if (!unixSec) return '-';
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(unixSec * 1000));
}

/* هفته‌های شنبه‌محورِ تهران (ریتنشن + کوهورت‌ها) — epoch یونیکس پنجشنبه است؛ +۲ روز → مرز شنبه */
export const WEEK = 7 * 86400;
export const weekIdx = (unixSec) => Math.floor((unixSec + TEHRAN_OFFSET_S - 2 * 86400) / WEEK);
// همان محاسبه به‌صورت عبارت SQL روی یک ستون/عبارتِ unix (برای کوئری مستقیم روی DB)
export const weekExpr = (col) => `CAST((${col} + ${TEHRAN_OFFSET_S} - ${2 * 86400}) / ${WEEK} AS INTEGER)`;
// تاریخ شروع هفته (برچسب ستون/ردیف)
export const weekLabel = (w) => new Date((w * WEEK + 2 * 86400 - TEHRAN_OFFSET_S) * 1000).toISOString().slice(0, 10);

export const fmt = (n) => (Number(n) || 0).toLocaleString('fa-IR');

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseJsonSafe(s, fallback = {}) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/* برچسبِ خوانای «پستِ کانال» از روی postrefِ قراردادِ لینکِ پست: <YYMMDD>s<slot> (مثل 260801s4).
   تبدیل به تقویم شمسی با خودِ Intl انجام می‌شود (locale فارسی = تقویم فارسی)؛ هیچ کتابخانه‌ای
   اضافه نمی‌شود. اگر شکلِ رشته ناشناخته بود یا تاریخ نامعتبر (مثل ماه ۱۳)، همان رشته‌ی خام
   برگردانده می‌شود — هرگز تاریخی از خودمان ساخته نمی‌شود. */
export function postRefLabel(ref) {
  const raw = String(ref ?? '');
  const m = /^(\d{2})(\d{2})(\d{2})s(\d{1,2})$/.exec(raw);
  if (!m) return raw;
  const [, yy, mm, dd, slot] = m;
  const d = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
  // rollover تاریخ (۲۶۱۳۰۱ → ژانویه‌ی سال بعد) نباید بی‌صدا برچسبِ اشتباه بسازد
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) return raw;
  try {
    const day = new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
    }).format(d);
    return `${day} · اسلات ${fmt(slot)}`;
  } catch { return raw; }
}
