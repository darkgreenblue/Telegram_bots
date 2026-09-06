// تعریفِ قیف‌ها و بُرش‌ها — تک‌منبعِ حقیقت، مشترک بینِ صفحه‌ی فانل‌ها، نمای کلی و لایه‌ی کوهورت.
// این‌جا هیچ کوئری‌ای اجرا نمی‌شود؛ فقط «تعریف» است تا هم جدولِ عددها و هم لیستِ کاربرانِ پشتِ
// همان عدد از یک منبع ساخته شوند (وگرنه عدد و لیست از هم می‌پاشند).
//
// ⚠️ نکته‌ی امنیتی: نام جدول‌ها و statusExpr از همین فایل می‌آید (نه از URL) — هرگز رشته‌ای از
// ورودی کاربر داخل SQL تزریق نمی‌شود. عبارت‌ها با alias `t` نوشته شده‌اند چون در کوئریِ کوهورت
// به users جوین می‌شوند و ستون‌های هم‌نام (created_at/status) باید بدون ابهام باشند.

export const FUNNELS = {
  tarot: {
    title: '🔮 تاروت',
    steps: [
      ['start', 'استارت'],
      ['onboard_done', 'آنبوردینگ کامل'],
      ['spread_selected', 'انتخاب نوع فال'],
      ['question_submitted', 'ارسال سؤال'],
      ['cards_picked', 'انتخاب کارت‌ها'],
      ['paywall_shown', 'دیدن پی‌وال'],
      ['reading_started', 'باز کردن کارت‌ها (پرداخت)'],
      ['product_delivered', 'تحویل کامل فال'],
    ],
    payment: [
      ['recharge_started', 'شروع شارژ'],
      ['receipt_submitted', 'ارسال رسید'],
      ['payment_approved', 'تأیید پرداخت'],
    ],
    // ⚠️ قیفِ «سرگرمی‌های رایگان» عمداً این‌جا نیست. مراحلش پشتِ `FREE_MENU_ENABLED`
    // در خودِ ربات‌اند و آن فلگ **خاموش** است، پس هیچ کاربری به آن مسیر نمی‌رسد و
    // هر مرحله‌اش ساختاراً صفر می‌ماند. قیفی که نمی‌تواند داده بگیرد، گزارش نیست؛
    // فقط فیچری را به مالک تبلیغ می‌کند که کاربر ندارد. با روشن‌شدنِ آن فلگ برگردد.
    entity: { table: 'readings', title: 'وضعیت فال‌ها (رکورد قطعی — شامل قبل از آنالیتیکس)' },
  },
  voice2text: {
    title: '🎙 ویس به متن',
    steps: [
      ['start', 'استارت'],
      ['product_delivered', 'پردازش موفق'],
      ['payment_approved', 'پرداخت موفق'],
    ],
    entity: { table: 'voice_flows', title: 'وضعیت فلوهای ویس (رکورد قطعی — شامل قبل از آنالیتیکس)' },
  },
  'tabir-khab': {
    title: '🌙 تعبیر خواب',
    steps: [
      ['start', 'استارت'],
      ['first_value', 'اولین تعبیر (تریال)'],
      ['product_delivered', 'تعبیر کامل'],
      ['payment_approved', 'پرداخت اشتراک'],
    ],
    // قیف نمادیاب خواب (مرور رایگان نمادها → CTA → تعبیر کامل)
    free: [
      ['symbol_opened', 'باز کردن نمادیاب'],
      ['symbol_viewed', 'دیدن نماد'],
      ['symbol_search', 'جستجوی نماد'],
      ['symbol_not_found', 'نماد پیدا نشد'],
      ['symbol_cta_dream', 'CTA به تعریف خواب'],
      ['product_delivered', 'تعبیر کامل'],
    ],
    // dreams ستون status ندارد → از full_delivered یک برچسب می‌سازیم
    entity: { table: 'dreams', title: 'وضعیت خواب‌ها', statusExpr: "CASE WHEN t.full_delivered=1 THEN 'delivered' WHEN t.is_free_trial=1 THEN 'trial_preview' ELSE 'pending' END" },
  },
};

// ستون‌های breakdown چنل — شرط SQL روی users.first_source (کاربرِ join شده به رویداد؛ alias u)
export const CHANNELS = [
  ['همه', '1=1'],
  ['ارگانیک', "u.first_source = 'organic'"],
  ['رفرال', "u.first_source LIKE 'referral:%'"],
  ['کمپین‌ها', "u.first_source LIKE 'campaign:%'"],
];

// کوهورت نسخه: فیلتر اختیاری روی users.first_version ('' = همه؛ '_pre' = کاربران قبل از ردیابی نسخه)
export function verCond(ver) {
  if (!ver) return { cond: '1=1', params: [] };
  if (ver === '_pre') return { cond: "u.first_version = ''", params: [] };
  return { cond: 'u.first_version = ?', params: [ver] };
}
