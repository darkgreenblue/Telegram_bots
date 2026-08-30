// منوی عمودیِ سمت راست + «اسکوپِ ربات» — تک‌منبعِ ناوبریِ داشبورد.
//
// دو قرارداد این فایل:
//  ۱) **داشبورد per ربات است، نه یک داشبوردِ کلی.** هر صفحه دیتای همان رباتی را نشان
//     می‌دهد که در منوی کشوییِ بالای منو انتخاب شده. اسکوپ در `url.searchParams.bot`
//     می‌نشیند و `index.js` قبل از dispatch آن را resolve می‌کند، پس هیچ route ای لازم
//     نیست خودش کوکی/پیش‌فرض بخواند — همه فقط `scopeBot(url)` را صدا می‌زنند.
//  ۲) **منو درختی است.** آیتمِ ریشه‌ی «آمار تحلیلی» خودش یک صفحه دارد (داشبوردِ اصلی)
//     و زیرمنوهایش بقیه‌ی صفحه‌های تحلیلی‌اند، تا همه‌ی آمار در یک بخش متمرکز بماند.
import { BOTS, botByKey, instancesOf } from './bots.js';

/** تمرکزِ فعلیِ محصول (خواسته‌ی صریحِ مالک): تاروت پیش‌فرضِ داشبورد است. */
export const DEFAULT_BOT = 'tarot';

/** ربات‌هایی که «داشبوردِ اصلیِ BI» برایشان پیاده شده. بقیه همان صفحه‌های موجود را دارند. */
export const MASTER_DASH_BOTS = new Set(['tarot']);

export const NAV = [
  {
    href: '/dash', label: 'آمار تحلیلی', icon: '📊',
    children: [
      ['/dash', 'داشبورد اصلی'],
      ['/funnels', 'فانل‌ها'],
      ['/retention', 'ریتنشن و کوهورت'],
      ['/screens', 'صفحه‌ها'],
      ['/marketing', 'مارکتینگ'],
      ['/experiments', 'تست‌های A/B'],
    ],
  },
  { href: '/', label: 'نمای کلی', icon: '🏠' },
  { href: '/users', label: 'کاربران', icon: '👥' },
  { href: '/support', label: 'پشتیبانی', icon: '💬' },
  { href: '/finance', label: 'مالی', icon: '💳' },
  { href: '/costs', label: 'هزینه و درآمد', icon: '🧮' },
  { href: '/discounts', label: 'کد تخفیف', icon: '🏷' },
  { href: '/journal', label: 'ژورنال محصول', icon: '📓' },
];

/** همه‌ی مسیرهایی که زیرِ گروهِ «آمار تحلیلی» می‌نشینند (برای فعال‌شدنِ ریشه). */
const GROUP_PATHS = new Set(NAV.flatMap(n => (n.children || []).map(([h]) => h)));
export const inGroup = (path) => GROUP_PATHS.has(path);

/** ربات فعال. هرگز خطا نمی‌دهد: کلیدِ ناشناخته → پیش‌فرض. */
export function scopeBot(url) {
  const k = url?.searchParams?.get('bot') || '';
  return botByKey(k) ? k : DEFAULT_BOT;
}

/** کلیدِ معتبر از ورودیِ خام (query یا کوکی) — `index.js` برای resolve کردنِ اسکوپ. */
export const validBotKey = (raw) => (botByKey(String(raw || '')) ? String(raw) : '');

/** لینکِ داخلیِ داشبورد که اسکوپ را حفظ می‌کند. */
export function link(href, bot, extra = {}) {
  const q = new URLSearchParams({ bot, ...extra });
  return `${href}?${q.toString()}`;
}

/** ربات‌هایی که واقعاً دیتابیس دارند (بقیه در منوی کشویی «بدون دیتابیس» علامت می‌خورند). */
export const botsForPicker = () => BOTS.map(b => ({
  key: b.key, title: b.title, hasDb: instancesOf(b.key).length > 0,
}));

// کوکیِ چسبندگیِ اسکوپ: بدونش هر فرمِ فیلترِ قدیمی که `bot` را حمل نمی‌کند، کاربر را
// بی‌صدا به رباتِ پیش‌فرض برمی‌گرداند. مقدارش همیشه از whitelist می‌آید (نه متنِ خام).
export const botCookie = (bot) =>
  `dash_bot=${encodeURIComponent(bot)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${365 * 24 * 3600}`;
