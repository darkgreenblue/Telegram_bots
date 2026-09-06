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

/* ═══════════════════════════════════════════════════════════════════════════
   🔁 کدنسِ چسبندگی — «هر چند روز یک‌بار برمی‌گردد؟»
   ═══════════════════════════════════════════════════════════════════════════
   خواسته‌ی مالک: به‌جای یک عددِ «فعال»، بدانیم چند کاربر **هر روز**، چند کاربر **هر دو
   روز**، … و چند کاربر **هفته‌ای یک‌بار** اکشنِ ارزشمند انجام می‌دهند.

   تعریفِ «حداقل هر N روز یک‌بار» (سخت‌گیرانه و تحت‌اللفظی): در کلِ پنجره‌ی مشاهده،
   **هیچ فاصله‌ای بینِ دو اکشنِ پیاپیِ کاربر بیشتر از N روز نبوده**، و از آخرین اکشنش
   هم بیشتر از N روز نگذشته. یعنی «بیشترین وقفه ≤ N».

   چرا «بیشترین وقفه» و نه «میانگینِ فاصله»: کاربری که ۱۰ روز پشت‌سرهم بیاید و بعد ۲۰
   روز غیبش بزند، میانگینش خوب می‌شود ولی عادتش مرده است. عادت را بدترین وقفه می‌گوید.

   سه گاردِ ضدِ خودفریبی:
     ۱) **حداقل دو روزِ متفاوت** لازم است. یک اکشنِ تکی «عادتِ روزانه» نیست؛ بدونِ این
        گارد، کاربری که همین امروز اولین کارش را کرده در سطلِ «هر روز» می‌نشست.
     ۲) **وقفه‌ی دنباله** (از آخرین اکشن تا امروز) هم شمرده می‌شود، وگرنه کاربری که سه
        ماه پیش منظم بوده و حالا رفته، هنوز «کاربرِ روزانه» گزارش می‌شد.
     ۳) فقط کاربرانی که **حداقل ۳ روز از عضویتشان** گذشته (شرطِ صریحِ مالک).

   سطل‌ها **تجمعی** هستند: کسی که هر روز می‌آید، طبیعتاً «حداقل هر ۲ روز» را هم دارد.
   این ذاتیِ «حداقل هر N روز» است و در خودِ صفحه هم گفته می‌شود. */

export const CADENCE_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const CADENCE_MIN_AGE_DAYS = 3;   // شرطِ عضویت (مالک)
export const CADENCE_MIN_ACTIVE_DAYS = 2; // حداقل دو روزِ متفاوت

/** شماره‌ی روزِ تهرانیِ «امروز» — واحدِ همه‌ی محاسبه‌های کدنس. */
export const tehranDayNo = (unixSec) => Math.floor((unixSec + 3.5 * 3600) / 86400);

/* ── لایه‌ی دوم: «اکشنِ مفید» ──────────────────────────────────────────────
   تعریفِ مالک: هر تعاملِ مفید با ربات، به‌جز اکشن‌های منفی.

   عمداً **allowlist** است نه denylist: واژه‌نامه‌ی رویدادها پر از رویدادهایی است که
   خودِ ربات می‌سازد (`night_reminder_sent`, `stuck_reading_reminder`, `credit_granted`,
   `paywall_shown`, …). با denylist، هر رویدادِ سیستمیِ **جدیدی** که فردا اضافه شود
   بی‌صدا عددِ «کاربرِ مفید» را باد می‌کرد — یعنی سنجه به‌مرور دروغ می‌گفت بدونِ اینکه
   کسی بفهمد. این لیست فقط کارهایی است که **کاربر خودش شروع می‌کند و ارزشی می‌گیرد**.
   افزودنِ قلابِ رایگانِ جدید = یک خط این‌جا. */
export const USEFUL_EVENTS = [
  'daily_card',          // کارت روز
  'lucky_card',          // کارت شانس
  'hafez_taken',         // فال حافظ
  'estekhare_taken',     // استخاره
  'quiz_done',           // کوییز کارت
  'coffee_taken',        // فال قهوه
  'card_meaning_viewed', // کتابخانه‌ی کارت
  'product_delivered',   // فالِ کامل (پولی — بالاترین ارزش، این‌جا هم می‌آید)
  'feedback',            // نمره دادن به فال
];

/* اکشن‌های منفی — از سنجه‌ی بالا **بیرون‌اند** و جدا شمرده می‌شوند (کارتِ «سیگنالِ منفی»).
   ⚠️ صادقانه: **بلاک‌کردنِ ربات ثبت نمی‌شود.** تلگرام موقعِ بلاک فقط خطای ۴۰۳ به
   ارسالِ بعدی می‌دهد و هیچ رویدادی در جدولِ ما نمی‌نشیند. تا وقتی خودِ ربات آن خطا را
   به‌صورتِ یک رویداد ثبت نکند، این عدد را نداریم و از خودمان نمی‌سازیم. */
export const NEGATIVE_EVENTS = [
  { event: 'daily_reminder_off', label: 'خاموش‌کردنِ یادآوریِ روزانه', cond: '' },
  { event: 'lucky_reminder', label: 'خاموش‌کردنِ یادآوریِ کارت شانس', cond: " AND json_extract(e.props,'$.on') = 0" },
];

/* حذفِ ادمین روی جدولِ رویدادها (هم‌قرارداد با notAdminReadings) */
const notAdminEvents = (hasEvents) => (hasEvents
  ? " AND e.user_id NOT IN (SELECT user_id FROM events WHERE json_extract(props,'$.adm') = 1)"
  : '');

/* هسته‌ی مشترکِ هر دو لایه: از یک «جدولِ روزهای فعال» به شرطِ بیشترین‌وقفه می‌رسد.
   `daysCte` باید ستون‌های (uid, d) بدهد. هیچ رشته‌ای از URL این‌جا نمی‌آید. */
function cadenceFrom(daysCte, params, { maxGap, todayNo, joinedBefore }) {
  return {
    sql: `WITH days AS (${daysCte}),
               gaps AS (SELECT uid, d, d - LAG(d) OVER (PARTITION BY uid ORDER BY d) AS gap FROM days)
          SELECT uid FROM gaps
          GROUP BY uid
          HAVING COUNT(*) >= ${CADENCE_MIN_ACTIVE_DAYS}
             AND COALESCE(MAX(gap), 0) <= ?
             AND (? - MAX(d)) <= ?
             AND uid IN (SELECT telegram_id FROM users WHERE created_at <= ?)`,
    params: [...params, maxGap, todayNo, maxGap, joinedBefore],
  };
}

/** لایه‌ی ۱ — کاربرانی که حداقل هر `maxGap` روز یک‌بار **الماس خرج می‌کنند**. */
export function spendCadenceSql(maxGap, nowSec, hasEvents, { windowDays = 0 } = {}) {
  const since = windowDays ? nowSec - windowDays * 86400 : 0;
  return cadenceFrom(
    `SELECT r.user_id AS uid, ${RDAY} AS d FROM readings r
      WHERE ${DONE}${notAdminReadings(hasEvents)} AND r.created_at >= ?
      GROUP BY r.user_id, ${RDAY}`,
    [since],
    { maxGap, todayNo: tehranDayNo(nowSec), joinedBefore: nowSec - CADENCE_MIN_AGE_DAYS * 86400 },
  );
}

/** لایه‌ی ۲ — کاربرانی که حداقل هر `maxGap` روز یک‌بار **اکشنِ مفید** انجام می‌دهند.
 *
 * ⚠️ روزهای «فالِ کامل» با UNION به روزهای رویدادی اضافه می‌شوند، نه اینکه فقط به
 * رویدادِ `product_delivered` تکیه شود. دو دلیل:
 *   ۱) **درستیِ تعریف:** فالِ پولی مفیدترین اکشنِ ربات است؛ لایه‌ی ۲ که ادعا می‌کند
 *      «هر تعاملِ مفید» را می‌شمارد، نمی‌تواند آن را جا بیندازد.
 *   ۲) **درستیِ رابطه‌ی دو لایه:** جدولِ `readings` رکوردِ قطعی است و از قبل از نصبِ
 *      آنالیتیکس هم دیتا دارد، ولی رویداد ندارد. بدونِ این UNION، کاربری که فالِ
 *      قدیمی گرفته در لایه‌ی ۱ می‌آمد و در لایه‌ی ۲ نه — یعنی «زیرمجموعه‌ی مفیدها»
 *      از «مفیدها» بزرگ‌تر می‌شد و هر دو عدد بی‌معنا. حالا لایه‌ی ۲ **ساختاراً**
 *      ابرمجموعه‌ی لایه‌ی ۱ است (چکِ CI همین را قفل کرده). */
export function usefulCadenceSql(maxGap, nowSec, hasEvents, { windowDays = 0 } = {}) {
  const since = windowDays ? nowSec - windowDays * 86400 : 0;
  const ph = USEFUL_EVENTS.map(() => '?').join(',');
  return cadenceFrom(
    `SELECT e.user_id AS uid, ${tehranDayExpr('e.created_at')} AS d FROM events e
      WHERE e.event IN (${ph}) AND e.created_at >= ?${notAdminEvents(hasEvents)}
      GROUP BY e.user_id, ${tehranDayExpr('e.created_at')}
     UNION
     SELECT r.user_id AS uid, ${RDAY} AS d FROM readings r
      WHERE ${DONE}${notAdminReadings(hasEvents)} AND r.created_at >= ?
      GROUP BY r.user_id, ${RDAY}`,
    [...USEFUL_EVENTS, since, since],
    { maxGap, todayNo: tehranDayNo(nowSec), joinedBefore: nowSec - CADENCE_MIN_AGE_DAYS * 86400 },
  );
}

/** مخرجِ درستِ هر دو لایه: کاربرانی که **فرصتِ** نشان‌دادنِ عادت را داشته‌اند
 *  (حداقل ۳ روز از عضویتشان گذشته). بدونِ این، درصدها با موجِ کاربرِ تازه می‌پاشند. */
export const eligibleUsersSql = (nowSec) => ({
  sql: 'SELECT telegram_id AS uid FROM users WHERE created_at <= ?',
  params: [nowSec - CADENCE_MIN_AGE_DAYS * 86400],
});

/** کاربرانی که یک سیگنالِ منفیِ مشخص داده‌اند (کارتِ ضدّ-درگیری). */
export function negativeUsersSql(idx, hasEvents) {
  const n = NEGATIVE_EVENTS[idx];
  if (!n) return null;
  return {
    sql: `SELECT DISTINCT e.user_id AS uid FROM events e
          WHERE e.event = ?${n.cond}${notAdminEvents(hasEvents)}`,
    params: [n.event],
  };
}
