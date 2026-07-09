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

export const fmt = (n) => (Number(n) || 0).toLocaleString('fa-IR');

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseJsonSafe(s, fallback = {}) {
  try { return JSON.parse(s); } catch { return fallback; }
}
