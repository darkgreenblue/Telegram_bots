// تعریفِ سنجه‌های «درگیری و ماندگاری» تاروت — تک‌منبعِ شرط‌ها.
//
// چرا این فایل جداست: قراردادِ آهنینِ داشبورد می‌گوید هر عددِ کاربرمحور باید با یک کلیک
// به لیستِ همان آدم‌ها باز شود (`lib/cohorts.js`). اگر «عدد» را صفحه‌ی داشبورد بسازد و
// «لیست» را لایه‌ی کوهورت، دیر یا زود از هم می‌پاشند. پس شرطِ SQL **یک‌بار** این‌جا
// نوشته می‌شود و هر دو طرف از همین می‌خوانند.
//
// امنیت: هیچ رشته‌ای از URL این‌جا نمی‌آید. تنها ورودیِ متغیر، عددهای بازه‌اند و همه
// bound parameter اند.
import { tehranDayExpr } from './util.js';

/* ═══ «فالِ کامل» ═══
   تعریفِ مالک: یکی از فال‌های اصلی (۳/۵/۱۰ کارتی) که کاربر برایش الماس خرج کرده.
   در دیتابیس دقیقاً یعنی: خوانشِ تحویل‌شده با قیمتِ بزرگ‌تر از صفر. کارتِ روز و
   سرگرمی‌های رایگان (`price = 0`) عمداً بیرون‌اند — کاربرِ درگیر با «پول خرج‌کردن»
   تعریف می‌شود، نه با تپ‌های رایگان. */
export const DONE = "r.status='delivered' AND r.price > 0";

/** روزِ تهرانیِ یک خوانش (مرزِ روز = نیمه‌شبِ تهران، نه UTC). */
export const RDAY = tehranDayExpr('r.created_at');

/* حذفِ ادمین از سنجه‌های محصولی: تستِ خودِ مالک نباید ماندگاری را باد کند.
   همان قراردادِ `lib/journey.js` (تگِ `adm:1`)، ولی این‌جا روی جدولِ خوانش‌ها.
   اگر جدولِ events نبود، رشته‌ی خالی برمی‌گردد و رفتار دقیقاً مثل قبل است. */
export const notAdminReadings = (hasEvents) => (hasEvents
  ? " AND r.user_id NOT IN (SELECT user_id FROM events WHERE json_extract(props,'$.adm') = 1)"
  : '');

/* ═══ کاربر فعال (مهم‌ترین سنجه‌ی این داشبورد) ═══
   تعریفِ صریحِ مالک، سه شرط با هم:
     ۱) حداقل ۳ روز از **اولین** فالِ کاملش گذشته باشد (کاربرِ سه‌روزِ اخیر «جدید» است،
        نه «فعال» — وگرنه هر موجِ تبلیغاتی عددِ فعال را دروغی بالا می‌برد).
     ۲) در **حداقل دو روزِ متفاوت** فالِ کامل گرفته باشد (چند فالِ پشت‌سرهم در روز اول
        درگیری نیست؛ برگشتن است که درگیری است).
     ۳) از **آخرین** فالِ کاملش بیش از پنجره‌ی انتخابی نگذشته باشد.
   پنجره (`windowDays`) عمداً پارامتر است: با ۱ روز «فعالِ روزانه» را می‌بینی، با ۷ روز
   «فعالِ هفتگی» را — همان چیزی که مالک خواست بتواند بین ۱ تا ۷ بچرخاند. */
export const ACTIVE_MIN_AGE_DAYS = 3;
export const ACTIVE_MIN_DAYS = 2;

export function activeUsersSql(nowSec, windowDays, hasEvents) {
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${DONE}${notAdminReadings(hasEvents)}
          GROUP BY r.user_id
          HAVING MIN(r.created_at) <= ?
             AND COUNT(DISTINCT ${RDAY}) >= ${ACTIVE_MIN_DAYS}
             AND MAX(r.created_at) >= ?`,
    params: [nowSec - ACTIVE_MIN_AGE_DAYS * 86400, nowSec - windowDays * 86400],
  };
}

/** کاربرانی که حداقل یک فالِ کامل گرفته‌اند (مخرجِ اغلب نسبت‌ها). */
export function readerUsersSql(hasEvents, since = 0) {
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${DONE}${notAdminReadings(hasEvents)} AND r.created_at >= ?
          GROUP BY r.user_id`,
    params: [since],
  };
}

/** کاربرانی که در ≥۲ روزِ متفاوت فالِ کامل گرفته‌اند (نرخِ بازگشت). */
export function repeatUsersSql(hasEvents) {
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${DONE}${notAdminReadings(hasEvents)}
          GROUP BY r.user_id HAVING COUNT(DISTINCT ${RDAY}) >= ${ACTIVE_MIN_DAYS}`,
    params: [],
  };
}

/* ═══ رضایت ═══
   نمره‌ی ۱ تا ۵ در `readings.feedback` با پیشوندِ `rate:` ذخیره می‌شود (نسخه‌ی v4).
   مقادیرِ قدیمیِ `yes/some/no` عمداً وارد میانگین نمی‌شوند: مقیاسشان فرق دارد و
   ترجمه‌شان به عدد یعنی ساختنِ داده‌ای که وجود ندارد. */
export const RATE_EXPR = "CAST(SUBSTR(r.feedback, 6) AS REAL)";
export const RATED = "r.feedback LIKE 'rate:%'";
/** «کاربر راضی» = میانگینِ نمره‌هایی که به فال‌هایش داده بالای ۴ باشد. */
export const SATISFIED_MIN_AVG = 4;

export function satisfiedUsersSql(hasEvents) {
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${RATED}${notAdminReadings(hasEvents)}
          GROUP BY r.user_id HAVING AVG(${RATE_EXPR}) > ${SATISFIED_MIN_AVG}`,
    params: [],
  };
}
export function ratersUsersSql(hasEvents) {
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${RATED}${notAdminReadings(hasEvents)} GROUP BY r.user_id`,
    params: [],
  };
}

/* ═══ دعوت از دوستان ═══
   «دعوتِ موفق» = ردیفی در `referrals` با `rewarded=1`. خودِ ربات این بیت را فقط وقتی
   می‌زند که دعوت‌شده اولین فالِ کاملش را گرفته و پاداش به دعوت‌کننده رسیده باشد، پس
   دقیقاً همان تعریفی است که مالک خواست و هیچ شرطِ دومی لازم ندارد. */
export const successfulReferrersSql = () => ({
  sql: 'SELECT referrer_id AS uid FROM referrals WHERE rewarded=1 GROUP BY referrer_id',
  params: [],
});

/* ═══ سطل‌های تعدادِ فال per کاربر (هیستوگرامِ عمقِ استفاده) ═══
   مرزها ثابت و از whitelist می‌آیند؛ کوهورت با **ایندکس** انتخاب می‌شود نه با متنِ خام. */
export const READ_BUCKETS = [
  { label: '۱ فال', min: 1, max: 1 },
  { label: '۲ فال', min: 2, max: 2 },
  { label: '۳ فال', min: 3, max: 3 },
  { label: '۴ تا ۵', min: 4, max: 5 },
  { label: '۶ تا ۱۰', min: 6, max: 10 },
  { label: '۱۱ و بیشتر', min: 11, max: 1e9 },
];

export function bucketUsersSql(idx, hasEvents) {
  const b = READ_BUCKETS[idx];
  if (!b) return null;
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${DONE}${notAdminReadings(hasEvents)}
          GROUP BY r.user_id HAVING COUNT(*) >= ? AND COUNT(*) <= ?`,
    params: [b.min, b.max],
  };
}

/* ═══ ماندگاریِ D+n از **اولین فال** (نه از ثبت‌نام) ═══
   سؤال: از کسانی که اولین فالشان حداقل n روز پیش بوده، چند درصد بعد از n روز باز هم
   فالِ کامل گرفتند؟ مخرج فقط کاربرانِ «رسیده» است (کسی که تازه آمده هنوز فرصتِ
   برگشتن نداشته و شمردنش عددِ ماندگاری را مصنوعاً پایین می‌آورد). */
export const RET_DAYS = [1, 3, 7, 14, 30];

export function retainedUsersSql(dayN, nowSec, hasEvents, { denominator = false } = {}) {
  const cutoff = nowSec - dayN * 86400;
  if (denominator) {
    return {
      sql: `SELECT r.user_id AS uid FROM readings r
            WHERE ${DONE}${notAdminReadings(hasEvents)}
            GROUP BY r.user_id HAVING MIN(r.created_at) <= ?`,
      params: [cutoff],
    };
  }
  return {
    sql: `SELECT r.user_id AS uid FROM readings r
          WHERE ${DONE}${notAdminReadings(hasEvents)}
          GROUP BY r.user_id
          HAVING MIN(r.created_at) <= ? AND MAX(r.created_at) >= MIN(r.created_at) + ?`,
    params: [cutoff, dayN * 86400],
  };
}
