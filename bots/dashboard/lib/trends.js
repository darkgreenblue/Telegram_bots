// 📈 ترندها — هر عددِ سرخطِ «نمای کلی»، روز به روز (خواسته‌ی مالک ۱۴۰۵/۰۷/۱۰).
//
// «همه‌ی دیتاهای صفحه‌ی اصلی را می‌خوام در بعدِ زمان هم ببینم تا حسِ رشدمان را داشته باشیم.»
//
// ═══ دو نوع عدد، دو مسیرِ متفاوت (و این تفاوت عمدی است) ═══
// ۱) **سنجه‌های کاربرمحور** (فعال، فال‌گرفته، رضایت، ماندگاری، DAU، …) هر شب بعد از
//    نیمه‌شبِ تهران برای **روزِ تمام‌شده** حساب و در `trend_daily`ِ platform.db **یخ** می‌شوند.
//    ردیفِ نوشته‌شده دیگر بازنویسی نمی‌شود (`INSERT OR IGNORE`)، پس اگر فردا کاربری پاک
//    شود یا فالی برگردد، تاریخچه عوض نمی‌شود. اولین اجرا روزهای گذشته را از روی دیتای خام
//    **بازسازی** می‌کند (`src='rebuilt'`) تا نمودار از روزِ اول خالی نباشد.
// ۲) **پول** (درآمد، هزینه، سود) **یخ نمی‌شود** و هر بار زنده از `profitFor` می‌آید، چون
//    ورودی‌هایش (هزینه‌ی تبلیغِ روزانه، نرخِ دلار، پرداختِ سرگردان) را مالک **بعداً** دستی
//    وارد می‌کند. عددِ یخ‌زده‌ی دیشب یعنی سودی که هزینه‌ی تبلیغِ امروزِ واردشده را ندارد.
//    و قاعده‌ی تک‌منبعِ سود (بند ۲الف ریشه) هم همین را می‌خواهد: تنها درِ ورود `profitFor`.
//
// ═══ تعریف‌ها از کجا می‌آیند ═══
// **همان تعریف‌های نمای کلی** (`routes/dash.js: gather`)، با ثابت‌ها و شرط‌های SQLِ
// `lib/engage.js`. تفاوتِ تنها: «الان» به‌جای `nowSec()` پایانِ همان روز است. چکِ CI
// (`tools/check-trends.mjs`) موتور را با `T = now` اجرا می‌کند و تک‌تکِ عددها را با خودِ
// `gather` مقایسه می‌کند؛ اگر یکی از این دو عوض شود و دیگری نه، قرمز می‌شود.
//
// ═══ چرا در JS و نه یک کوئری per روز ═══
// سرور دیسک‌محدود است (~۱۵MB/s). «یک کوئری per روز per سنجه» یعنی ۴۰ سنجه × صدها روز
// اسکن. این‌جا هر جدول **یک بار** از ایندکسِ پوششی خوانده می‌شود (بدونِ لمسِ متنِ سنگینِ
// فال) و همه‌ی روزها در حافظه حساب می‌شوند.
//
// ═══ خطا هرگز صفر ثبت نمی‌شود ═══
// `rows()`ِ مشترک خطا را قورت می‌دهد و آرایه‌ی خالی برمی‌گرداند. برای صفحه‌ای که هر بار
// تازه ساخته می‌شود این قابلِ‌تحمل است؛ برای عددی که **برای همیشه یخ می‌شود** فاجعه است
// (یک قفلِ لحظه‌ای = یک روزِ صفر در تاریخچه، تا ابد). پس این‌جا همه‌ی خواندن‌ها
// `prepare().all()`ِ خام‌اند و هر خطا کلِ اجرا را لغو می‌کند؛ اجرای بعدی دوباره تلاش می‌کند.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { instancesOf, hasTable, langsOf, scopedKey, baseKey, userPk } from './bots.js';
import { MASTER_DASH_BOTS } from './nav.js';
import { pdb, getSetting, setSetting } from './platform.js';
import {
  DONE, RATED, RATE_EXPR, SATISFIED_MIN_AVG, ACTIVE_MIN_AGE_DAYS, ACTIVE_MIN_DAYS,
  RET_DAYS, notAdminReadings, tehranDayNo,
} from './engage.js';
import { tehranDayExpr, tehranDayStr, nowSec } from './util.js';

const D = 86400;
const TEHRAN_OFFSET_S = 3.5 * 3600;
/** شروعِ روزِ تهرانیِ شماره‌ی `d` (unix). */
export const dayStartOf = (d) => d * D - TEHRAN_OFFSET_S;
/** کلیدِ ذخیره‌ی روزِ شماره‌ی `d` — همان `YYYY-MM-DD`ِ مرزِ تهران که سریِ سود دارد. */
export const dayKeyOf = (d) => tehranDayStr(dayStartOf(d));
/** وارونه‌ی `dayKeyOf`: کلیدِ `YYYY-MM-DD` ⟵ شماره‌ی روزِ تهرانی. */
export const dayNoOfKey = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86400000);

/** رول‌بک: `false` ⟵ هیچ ثبتِ شبانه‌ای اجرا نمی‌شود؛ صفحه همان تاریخچه‌ی موجود را نشان می‌دهد. */
export const TRENDS_ENABLED = true;
/** سقفِ بازسازیِ گذشته در اولین اجرا (ربات‌های قدیمی هم نامحدود به عقب نمی‌روند). */
export const MAX_BACKFILL_DAYS = 400;
/** روزی که بیش از این بعد از پایانش ثبت شود «بازسازی‌شده» است، نه «ثبتِ شبانه». */
const NIGHT_GRACE_S = 36 * 3600;

/* ═══ کاتالوگِ سنجه‌ها ═══
 * `kind`: `stock` = مقدار در پایانِ روز (کل کاربران، نسبتِ راضی)، `flow` = اتفاقِ همان روز
 *   (کاربرِ جدید، DAU). نمودارِ `flow` یک خطِ میانگینِ ۷ روزه هم می‌گیرد، چون عددِ روزانه پرنوسان است.
 * `unit`: n عدد · pct درصد · dec اعشاری · dur ثانیه (نمایش دقیقه/ساعت) · toman
 * `good`: جهتِ خوب (برای رنگِ تغییر). `yMin`: کفِ محورِ عمودی اگر صفر بی‌معناست.
 * `v`: نسخه‌ی تعریف. ⚠️ اگر تعریفِ یک سنجه در `engage.js`/`gather` عوض شد، `v` همان سنجه
 *   را بالا ببر: اجرای بعدی تاریخچه‌اش را با تعریفِ تازه **از نو** می‌سازد. بدونِ این، نمودار
 *   نیمی با تعریفِ قدیم و نیمی با تعریفِ جدید است و یک «جهشِ» ساختگی نشان می‌دهد. */
export const TREND_METRICS = [
  // ── سرخط ──
  { k: 'active7', g: 'hero', label: 'کاربر فعال (پنجره‌ی ۷ روز)', unit: 'n', kind: 'stock', good: 'up',
    hint: `حداقل ${ACTIVE_MIN_AGE_DAYS} روز از اولین فال، فالِ کامل در ≥۲ روزِ متفاوت، و آخرین فال در ۷ روزِ اخیر` },
  { k: 'users', g: 'hero', label: 'کل کاربران واردشده', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'readings', g: 'hero', label: 'کل فال‌های کامل', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'sat_ratio', g: 'hero', label: 'نسبت کاربران راضی', unit: 'pct', kind: 'stock', good: 'up',
    hint: 'کاربرانِ راضی ÷ همه‌ی فال‌گرفته‌ها' },
  // ── درگیری و ماندگاری ──
  { k: 'readers', g: 'engage', label: 'کاربران فال‌گرفته (حداقل ۱ فال)', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'repeat', g: 'engage', label: 'برگشتی (فال در ۲ روزِ متفاوت)', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'repeat_pct', g: 'engage', label: 'نرخِ برگشت (از فال‌گرفته‌ها)', unit: 'pct', kind: 'stock', good: 'up' },
  { k: 'stickiness', g: 'engage', label: 'چسبندگی (DAU÷WAU)', unit: 'pct', kind: 'stock', good: 'up' },
  { k: 'churn', g: 'engage', label: 'ریزشِ هفتگی', unit: 'n', kind: 'stock', good: 'down',
    hint: 'هفته‌ی قبل فال گرفت، این هفته نه' },
  { k: 'per_user', g: 'engage', label: 'میانگین فال per کاربرِ واردشده', unit: 'dec', kind: 'stock', good: 'up' },
  { k: 'per_reader', g: 'engage', label: 'میانگین فال per کاربرِ فال‌گرفته', unit: 'dec', kind: 'stock', good: 'up' },
  { k: 'readings_per_day', g: 'engage', label: 'میانگین فال در روز (کل عمر)', unit: 'dec', kind: 'stock', good: 'up' },
  { k: 'ttfv', g: 'engage', label: 'میانه‌ی زمان تا اولین فال', unit: 'dur', kind: 'stock', good: 'down' },
  { k: 'active1', g: 'engage', label: 'کاربر فعال (پنجره‌ی ۱ روز)', unit: 'n', kind: 'stock', good: 'up' },
  // ── رضایت ──
  { k: 'avg_rate', g: 'sat', label: 'میانگین نمره (۱ تا ۵)', unit: 'dec', kind: 'stock', good: 'up', yMin: 1 },
  { k: 'med_rate', g: 'sat', label: 'میانه‌ی نمره', unit: 'dec', kind: 'stock', good: 'up', yMin: 1 },
  { k: 'sat_raters_pct', g: 'sat', label: 'راضی از بین نمره‌دهندگان', unit: 'pct', kind: 'stock', good: 'up' },
  { k: 'satisfied', g: 'sat', label: 'کاربران راضی', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'raters', g: 'sat', label: 'کاربرانی که نمره داده‌اند', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'raters_pct', g: 'sat', label: 'نرخِ نمره‌دادن (از فال‌گرفته‌ها)', unit: 'pct', kind: 'stock', good: 'up' },
  // ── فال‌ها ──
  { k: 'readings_day', g: 'readings', label: 'فالِ کامل در روز', unit: 'n', kind: 'flow', good: 'up' },
  { k: 'coins', g: 'readings', label: 'الماسِ خرج‌شده روی فال (تجمعی)', unit: 'n', kind: 'stock', good: 'up' },
  // ── کاربران ──
  { k: 'new_users', g: 'users', label: 'کاربرِ جدید در روز', unit: 'n', kind: 'flow', good: 'up' },
  { k: 'dau', g: 'users', label: 'فعالِ روزانه (DAU)', unit: 'n', kind: 'flow', good: 'up' },
  { k: 'wau', g: 'users', label: 'فعالِ ۷ روزه (WAU)', unit: 'n', kind: 'stock', good: 'up' },
  { k: 'mau', g: 'users', label: 'فعالِ ۳۰ روزه (MAU)', unit: 'n', kind: 'stock', good: 'up' },
  // ── ماندگاری از اولین فال ──
  ...RET_DAYS.map((d) => ({ k: `ret${d}`, g: 'ret', label: `ماندگاریِ D+${d}`, unit: 'pct', kind: 'stock', good: 'up' })),
  // ── دعوت ──
  { k: 'referrers', g: 'ref', label: 'کاربرانِ دعوت‌کننده‌ی موفق', unit: 'n', kind: 'stock', good: 'up',
    hint: 'روزِ پاداش = روزِ اولین فالِ کاملِ دعوت‌شده (تاریخچه‌ی بازسازی‌شده تقریبی است)' },
  { k: 'referrals_ok', g: 'ref', label: 'کل دعوت‌های موفق', unit: 'n', kind: 'stock', good: 'up' },
].map((m) => ({ v: 1, ...m }));

export const METRIC_BY_KEY = new Map(TREND_METRICS.map((m) => [m.k, m]));

/** اثرانگشتِ تعریف‌ها: اگر عوض شد، اجرای شبانه سنجه‌های تغییرکرده را از نو می‌سازد. */
export const TREND_DEFS_HASH = createHash('sha256')
  .update(TREND_METRICS.map((m) => `${m.k}:${m.v}`).join('|')).digest('hex').slice(0, 16);
const DEFS_KEY = 'trend_defs_hash';
/* آخرین «دیروزی» که اجرا برایش **موفق** تمام شد. «لازم است» یعنی همین، نه «ردیفِ دیروز هست؟»:
   اسکوپی که هیچ کاربری ندارد (دیتابیسِ زبانِ تازه) هرگز ردیفی نمی‌گیرد و با تعریفِ دوم،
   worker هر ۱۰ دقیقه تا ابد دوباره بالا می‌آمد. روزهای جاافتاده را خودِ اجرا پر می‌کند. */
const CHECKED_KEY = 'trend_checked_day';

/* ═══ اسکوپ‌ها ═══ هر رباتِ BI به‌علاوه‌ی تک‌تکِ زبان‌هایش (همان منوی کشویی). */
export function trendScopes() {
  const out = [];
  for (const key of MASTER_DASH_BOTS) {
    if (!instancesOf(key).length) continue;
    out.push(key);
    const langs = langsOf(key);
    if (langs.length > 1) for (const l of langs) out.push(scopedKey(key, l));
  }
  return out;
}

/* ═══ ۱) استخراج: هر جدول یک بار، از ایندکسِ پوششی ═══ */
const lowerBound = (arr, x) => { // اولین اندیس با arr[i] >= x
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
};
const countBefore = (arr, t) => lowerBound(arr, t);          // تعدادِ < t
const countAtMost = (arr, t) => lowerBound(arr, t + 1);       // تعدادِ ≤ t (زمان‌ها صحیح‌اند)

/* SQLِ استخراج — صادر می‌شود تا چکِ CI پلنش را روی schemaِ هم‌شکلِ پروداکشن بسنجد. */
export const EXTRACT_SQL = {
  admins: "SELECT DISTINCT user_id AS u FROM events WHERE json_extract(props,'$.adm') = 1",
  users: (pk) => `SELECT ${pk} AS u, created_at AS t FROM users`,
  // ⚠️ فقط ستون‌های `idx_readings_stats`؛ هر ستونِ دیگری یعنی برگشت به صفحه‌های متنِ فال
  readings: (na) => `SELECT r.user_id AS u, r.created_at AS t, r.price AS p, (${DONE}) AS done,
      CASE WHEN ${RATED} THEN ${RATE_EXPR} END AS rate
    FROM readings r WHERE ((${DONE}) OR (${RATED}))${na}`,
  events: `SELECT DISTINCT user_id AS u, ${tehranDayExpr('created_at')} AS d FROM events
    WHERE created_at >= ? AND user_id IS NOT NULL`,
  referrals: 'SELECT referrer_id AS a, referee_id AS b, created_at AS t FROM referrals WHERE rewarded=1',
};

/** همه‌ی دیتای خامِ یک instance که موتور لازم دارد. خطا ⟵ throw (هرگز آرایه‌ی خالیِ بی‌صدا). */
export function extractInstance(inst, eventsSince = 0) {
  const db = new Database(inst.file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const all = (sql, p = []) => db.prepare(sql).all(...p);
    const ev = hasTable(db, 'events');
    const adminIds = ev ? all(EXTRACT_SQL.admins).map((r) => Number(r.u)).filter(Number.isSafeInteger) : null;
    const na = notAdminReadings(ev, adminIds);

    const userRows = hasTable(db, 'users') ? all(EXTRACT_SQL.users(userPk(inst.bot))) : [];
    const userTimes = userRows.map((r) => Number(r.t)).filter(Number.isFinite).sort((a, b) => a - b);
    const userCreated = new Map(userRows.map((r) => [r.u, r.t]));

    /* per کاربر: زمان‌های فالِ کامل (+قیمت) و نمره‌ها، هر دو مرتب بر حسبِ زمان */
    const byUser = new Map();
    const at = (u) => {
      if (!byUser.has(u)) byUser.set(u, { times: [], prices: [], rates: [] });
      return byUser.get(u);
    };
    const doneAll = [];   // [t, p] همه‌ی فال‌های کامل (برای شمارش و الماسِ تجمعی)
    const rateAll = [];   // [t, round(v)] همه‌ی نمره‌ها (هیستوگرامِ ۱ تا ۵)
    if (hasTable(db, 'readings')) {
      for (const r of all(EXTRACT_SQL.readings(na))) {
        const t = Number(r.t);
        if (!Number.isFinite(t)) continue;
        if (r.done) { const x = at(r.u); x.times.push(t); x.prices.push(Number(r.p) || 0); doneAll.push([t, Number(r.p) || 0]); }
        if (r.rate !== null && r.rate !== undefined) {
          at(r.u).rates.push([t, Number(r.rate)]);
          rateAll.push([t, Math.round(Number(r.rate))]);
        }
      }
    }
    for (const x of byUser.values()) {
      const idx = x.times.map((t, i) => i).sort((a, b) => x.times[a] - x.times[b]);
      x.times = idx.map((i) => x.times[i]);
      x.prices = idx.map((i) => x.prices[i]);
      x.rates.sort((a, b) => a[0] - b[0]);
      // تعدادِ روزهای متفاوت تا هر فال (زمان‌ها مرتب‌اند، پس روزها هم نزولی نیستند)
      x.distinctUpTo = [];
      let last = null, c = 0;
      for (const t of x.times) { const d = tehranDayNo(t); if (d !== last) { c++; last = d; } x.distinctUpTo.push(c); }
    }
    doneAll.sort((a, b) => a[0] - b[0]);
    rateAll.sort((a, b) => a[0] - b[0]);
    const doneTimes = doneAll.map((x) => x[0]);
    const doneCoinsPrefix = [];
    { let s = 0; for (const [, p] of doneAll) { s += p; doneCoinsPrefix.push(s); } }

    /* DAU/WAU/MAU: جفت‌های یکتای (کاربر، روز) — همان شمارشِ `COUNT(DISTINCT user_id)`ِ نمای کلی */
    const dayUsers = new Map();
    if (ev) {
      for (const r of all(EXTRACT_SQL.events, [eventsSince])) {
        const d = Number(r.d);
        if (!dayUsers.has(d)) dayUsers.set(d, []);
        dayUsers.get(d).push(r.u);
      }
    }

    /* دعوتِ موفق: روزِ پاداش = اولین فالِ کاملِ دعوت‌شده (ربات بیتِ `rewarded` را همان‌جا می‌زند
       و زمانش را جدا ثبت نمی‌کند). نبودِ فال ⟵ زمانِ خودِ دعوت. */
    const refs = hasTable(db, 'referrals')
      ? all(EXTRACT_SQL.referrals).map((r) => ({ a: r.a, t: byUser.get(r.b)?.times[0] ?? Number(r.t) }))
      : [];

    return {
      id: inst.id, userTimes, userCreated, byUser,
      readerIds: [...byUser.keys()].filter((u) => byUser.get(u).times.length).sort((a, b) => a - b),
      raterIds: [...byUser.keys()].filter((u) => byUser.get(u).rates.length),
      doneTimes, doneCoinsPrefix, rateAll, dayUsers, refs,
      firstRead: doneTimes.length ? doneTimes[0] : null,
    };
  } finally {
    db.close();
  }
}

/* ═══ ۲) موتور: «نمای کلی» در لحظه‌ی دلخواهِ T، برای یک instance ═══
 * خروجی جمع‌پذیر است (شمارش‌ها، صورت/مخرج‌ها، هیستوگرام و آرایه‌ی میانه) تا چند instance
 * دقیقاً مثلِ `gather` با هم جمع شوند: شمارش‌ها جمع، میانه‌ها روی آرایه‌ی ادغام‌شده. */
const TTFV_LIMIT = 5000; // همان `LIMIT 5000`ِ نمای کلی

export function partialAt(ix, T) {
  const p = {
    users: countBefore(ix.userTimes, T),
    newUsers: 0, readings: 0, readingsDay: 0, coins: 0, readers: 0, repeat: 0,
    active7: 0, active1: 0, satisfied: 0, raters: 0, churn: 0,
    retNum: RET_DAYS.map(() => 0), retDen: RET_DAYS.map(() => 0),
    rateHist: [0, 0, 0, 0, 0, 0], rateCount: 0, rateSum: 0, ttfv: [],
    firstRead: ix.firstRead !== null && ix.firstRead < T ? ix.firstRead : null,
    dau: 0, wau: 0, mau: 0, referrers: 0, referralsOk: 0,
  };
  const today = tehranDayNo(T - 1);
  p.newUsers = p.users - countBefore(ix.userTimes, dayStartOf(today));

  const nRead = countBefore(ix.doneTimes, T);
  p.readings = nRead;
  p.coins = nRead ? ix.doneCoinsPrefix[nRead - 1] : 0;
  p.readingsDay = nRead - countBefore(ix.doneTimes, dayStartOf(today));

  let joined = 0;
  for (const u of ix.readerIds) {
    const x = ix.byUser.get(u);
    const k = countBefore(x.times, T);
    if (!k) continue;
    p.readers++;
    const first = x.times[0], last = x.times[k - 1], distinct = x.distinctUpTo[k - 1];
    if (distinct >= ACTIVE_MIN_DAYS) p.repeat++;
    // «کاربر فعال» — سه شرطِ `activeUsersSql` (≤ و ≥ دقیقاً همان‌جا)
    const old = first <= T - ACTIVE_MIN_AGE_DAYS * D && distinct >= ACTIVE_MIN_DAYS;
    if (old && last >= T - 7 * D) p.active7++;
    if (old && last >= T - 1 * D) p.active1++;
    // ماندگاریِ D+n (`retainedUsersSql`)
    RET_DAYS.forEach((d, i) => {
      if (first <= T - d * D) { p.retDen[i]++; if (last >= first + d * D) p.retNum[i]++; }
    });
    // ریزش: فال در [T−۱۴, T−۷) و هیچ فالی در [T−۷, T)
    const inPrev = countBefore(x.times, T - 7 * D) - countBefore(x.times, T - 14 * D);
    if (inPrev > 0 && countBefore(x.times, T - 7 * D) === k) p.churn++;
    // زمان تا اولین فال: فقط کاربرانی که ردیفِ users دارند (JOIN)، با همان سقفِ ۵۰۰۰
    if (ix.userCreated.has(u) && joined < TTFV_LIMIT) {
      joined++;
      const c = ix.userCreated.get(u);
      if (c !== null && c !== undefined) {
        const dt = first - Number(c);
        if (Number.isFinite(dt) && dt >= 0) p.ttfv.push(dt);
      }
    }
  }

  // رضایت: کاربرِ راضی = میانگینِ نمره‌هایش > ۴ (بدونِ گردکردن، مثلِ `AVG` در SQL)
  for (const u of ix.raterIds) {
    const rs = ix.byUser.get(u).rates;
    let n = 0, s = 0;
    for (const [t, v] of rs) { if (t >= T) break; n++; s += v; }
    if (!n) continue;
    p.raters++;
    if (s / n > SATISFIED_MIN_AVG) p.satisfied++;
  }
  // هیستوگرام: فقط ۱ تا ۵ پس از گرد کردن (همان فیلترِ `gather`)
  for (const [t, v] of ix.rateAll) {
    if (t >= T) break;
    if (v >= 1 && v <= 5) { p.rateHist[v]++; p.rateCount++; p.rateSum += v; }
  }

  // DAU = روزِ همین T؛ WAU = هفت روزِ تقویمیِ آخر؛ MAU = سی روزِ آخر
  const uniq = (from, to) => {
    const s = new Set();
    for (let d = from; d <= to; d++) for (const u of ix.dayUsers.get(d) || []) s.add(u);
    return s.size;
  };
  p.dau = uniq(today, today);
  p.wau = uniq(today - 6, today);
  p.mau = uniq(today - 29, today);

  const refs = ix.refs.filter((r) => r.t < T);
  p.referralsOk = refs.length;
  p.referrers = new Set(refs.map((r) => r.a)).size;
  return p;
}

const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
function medianOfHist(hist) { // همان `medianOfHist`ِ نمای کلی، روی آرایه‌ی ۱..۵
  const total = hist.reduce((a, c) => a + c, 0);
  if (!total) return null;
  let seen = 0;
  for (let v = 1; v <= 5; v++) { seen += hist[v]; if (seen >= total / 2) return v; }
  return 5;
}

/** جمعِ چند instance و ساختنِ عددِ نهاییِ هر سنجه (همان گرد کردن‌های نمای کلی). */
export function deriveMetrics(parts, T) {
  const s = {
    users: 0, newUsers: 0, readings: 0, readingsDay: 0, coins: 0, readers: 0, repeat: 0,
    active7: 0, active1: 0, satisfied: 0, raters: 0, churn: 0, rateCount: 0, rateSum: 0,
    dau: 0, wau: 0, mau: 0, referrers: 0, referralsOk: 0,
  };
  const retNum = RET_DAYS.map(() => 0), retDen = RET_DAYS.map(() => 0);
  const hist = [0, 0, 0, 0, 0, 0];
  const ttfv = [];
  let firstRead = null;
  for (const p of parts) {
    for (const k of Object.keys(s)) s[k] += p[k];
    p.retNum.forEach((v, i) => { retNum[i] += v; retDen[i] += p.retDen[i]; });
    p.rateHist.forEach((v, i) => { hist[i] += v; });
    ttfv.push(...p.ttfv);
    if (p.firstRead !== null && (firstRead === null || p.firstRead < firstRead)) firstRead = p.firstRead;
  }
  ttfv.sort((a, b) => a - b);
  const lifeDays = firstRead ? Math.max(1, Math.ceil((T - firstRead) / D)) : 1;
  const out = {
    active7: s.active7, users: s.users, readings: s.readings, sat_ratio: pctOf(s.satisfied, s.readers),
    readers: s.readers, repeat: s.repeat, repeat_pct: pctOf(s.repeat, s.readers),
    stickiness: pctOf(s.dau, s.wau), churn: s.churn,
    per_user: s.users ? Math.round((s.readings / s.users) * 100) / 100 : 0,
    per_reader: s.readers ? Math.round((s.readings / s.readers) * 100) / 100 : 0,
    readings_per_day: Math.round((s.readings / lifeDays) * 10) / 10,
    ttfv: ttfv.length ? ttfv[Math.floor(ttfv.length / 2)] : null,
    active1: s.active1,
    avg_rate: s.rateCount ? Math.round((s.rateSum / s.rateCount) * 100) / 100 : null,
    med_rate: medianOfHist(hist),
    sat_raters_pct: pctOf(s.satisfied, s.raters), satisfied: s.satisfied, raters: s.raters,
    raters_pct: pctOf(s.raters, s.readers),
    readings_day: s.readingsDay, coins: s.coins,
    new_users: s.newUsers, dau: s.dau, wau: s.wau, mau: s.mau,
    referrers: s.referrers, referrals_ok: s.referralsOk,
  };
  RET_DAYS.forEach((d, i) => { out[`ret${d}`] = pctOf(retNum[i], retDen[i]); });
  return out;
}

/** اعدادِ یک اسکوپ در لحظه‌ی T از روی استخراجِ آماده (`extracts`: Map از inst.id). */
export function metricsAt(scope, T, extracts) {
  return deriveMetrics(instancesOf(scope).map((i) => partialAt(extracts.get(i.id), T)), T);
}

/* ═══ ۳) ثبتِ شبانه ═══ */
const st = {
  dayCount: pdb.prepare('SELECT day, COUNT(*) AS c FROM trend_daily WHERE scope=? AND day >= ? GROUP BY day'),
  dropStale: pdb.prepare('DELETE FROM trend_daily WHERE scope=? AND metric=? AND v <> ?'),
  insert: pdb.prepare(`INSERT OR IGNORE INTO trend_daily (scope, day, metric, value, v, src, created_at)
    VALUES (?,?,?,?,?,?,?)`),
};

/** چکِ ارزانِ پروسه‌ی HTTP: آیا روزِ تمام‌شده‌ی دیروز (یا تعریفِ تازه) هنوز ثبت نشده؟ */
export function trendsDue(now = nowSec()) {
  if (!TRENDS_ENABLED) return false;
  const scopes = trendScopes();
  if (!scopes.length) return false;
  if (getSetting(DEFS_KEY, '') !== TREND_DEFS_HASH) return true;
  return getSetting(CHECKED_KEY, '') !== dayKeyOf(tehranDayNo(now) - 1);
}

/** همه‌ی روزهای ثبت‌نشده تا دیروز را می‌سازد و یخ می‌کند. idempotent؛ خطا ⟵ throw. */
export function runTrendSnapshot(now = nowSec()) {
  const t0 = Date.now();
  const scopes = trendScopes();
  if (!TRENDS_ENABLED || !scopes.length) return { scopes: 0, inserted: 0 };
  const yesterday = tehranDayNo(now) - 1;

  // تعریفِ عوض‌شده ⟵ تاریخچه‌ی همان سنجه پاک می‌شود و پایین‌تر از نو ساخته می‌شود
  if (getSetting(DEFS_KEY, '') !== TREND_DEFS_HASH) {
    pdb.transaction(() => {
      for (const s of scopes) for (const m of TREND_METRICS) st.dropStale.run(s, m.k, m.v);
    })();
  }

  /* شروعِ تاریخچه‌ی هر اسکوپ = روزِ اولین کاربرش (سقف: MAX_BACKFILL_DAYS) */
  const firstUserDay = new Map();
  for (const s of scopes) {
    let min = null;
    for (const inst of instancesOf(s)) {
      const db = new Database(inst.file, { readonly: true, fileMustExist: true });
      try {
        if (!hasTable(db, 'users')) continue;
        const t = db.prepare('SELECT MIN(created_at) AS t FROM users').get()?.t;
        if (Number.isFinite(t) && (min === null || t < min)) min = t;
      } finally { db.close(); }
    }
    if (min !== null) firstUserDay.set(s, Math.max(tehranDayNo(min), yesterday - MAX_BACKFILL_DAYS + 1));
  }

  /* روزهای ناقصِ هر اسکوپ (ردیف کمتر از تعدادِ سنجه‌ها) */
  const missing = new Map();
  for (const s of scopes) {
    const start = firstUserDay.get(s);
    if (start === undefined || start > yesterday) continue;
    const have = new Map(st.dayCount.all(s, dayKeyOf(start)).map((r) => [r.day, r.c]));
    const days = [];
    for (let d = start; d <= yesterday; d++) if ((have.get(dayKeyOf(d)) || 0) < TREND_METRICS.length) days.push(d);
    if (days.length) missing.set(s, days);
  }
  if (!missing.size) {
    setSetting(DEFS_KEY, TREND_DEFS_HASH);
    setSetting(CHECKED_KEY, dayKeyOf(yesterday));
    return { scopes: scopes.length, inserted: 0, ms: Date.now() - t0 };
  }

  /* استخراج یک بار per instance؛ رویدادها فقط از ۳۰ روز قبل از اولین روزِ ناقص (پنجره‌ی MAU) */
  const earliest = Math.min(...[...missing.values()].map((ds) => ds[0]));
  const eventsSince = dayStartOf(earliest - 30);
  const extracts = new Map();
  for (const s of missing.keys()) {
    for (const inst of instancesOf(s)) {
      if (!extracts.has(inst.id)) extracts.set(inst.id, extractInstance(inst, eventsSince));
    }
  }

  let inserted = 0;
  const write = pdb.transaction((s, days) => {
    for (const d of days) {
      const T = dayStartOf(d + 1);
      const vals = metricsAt(s, T, extracts);
      const src = now - T > NIGHT_GRACE_S ? 'rebuilt' : 'night';
      for (const m of TREND_METRICS) {
        const v = vals[m.k];
        inserted += st.insert.run(s, dayKeyOf(d), m.k, v === undefined ? null : v, m.v, src, now).changes;
      }
    }
  });
  for (const [s, days] of missing) write(s, days);
  setSetting(DEFS_KEY, TREND_DEFS_HASH);
  setSetting(CHECKED_KEY, dayKeyOf(yesterday));
  return { scopes: scopes.length, inserted, days: [...missing.values()].reduce((a, ds) => a + ds.length, 0), ms: Date.now() - t0 };
}

/* ═══ ۴) خواندن برای صفحه ═══ */
export function storedSeries(scope, fromDayKey) {
  const out = new Map(); // metric → Map(day → {value, src})
  for (const r of pdb.prepare(`SELECT day, metric, value, src FROM trend_daily
      WHERE scope=? AND day >= ? ORDER BY day`).all(scope, fromDayKey)) {
    if (!out.has(r.metric)) out.set(r.metric, new Map());
    out.get(r.metric).set(r.day, { value: r.value, src: r.src });
  }
  return out;
}

/** اولین روزی که «شبانه» ثبت شد (قبلش بازسازی است) — برای جمله‌ی صادقانه‌ی بالای صفحه. */
export const firstNightDay = (scope) =>
  pdb.prepare("SELECT MIN(day) AS d FROM trend_daily WHERE scope=? AND src='night'").get(scope)?.d || null;

/* ═══ ۵) زمان‌بندی: worker کم‌اولویت، نه داخلِ حلقه‌ی HTTP ═══
 * چک هر ۱۰ دقیقه ارزان است (فقط platform.db). اجرای واقعی در process جدا با `ionice`،
 * چون استخراجِ اولین بار کلِ تاریخچه را می‌خواند و نباید ورود و پشتیبانی را قفل کند.
 * خروجی و خطای worker به لاگِ pm2ِ داشبورد وصل است (`inherit`)، نه دور ریخته. */
const CHECK_EVERY_MS = 10 * 60 * 1000;
const WORKER_BUDGET_MS = 15 * 60 * 1000;
const RETRY_AFTER_FAIL_MS = 60 * 60 * 1000;

export function scheduleTrends() {
  if (!TRENDS_ENABLED) return;
  let running = false, failedAt = 0;
  const tick = async () => {
    try {
      if (running || Date.now() - failedAt < RETRY_AFTER_FAIL_MS || !trendsDue()) return;
      running = true;
      const { spawn } = await import('node:child_process');
      const { fileURLToPath } = await import('node:url');
      const worker = fileURLToPath(new URL('./trends-worker.js', import.meta.url));
      // `ionice` روی VPS هست؛ نبودش (لوکال/مک) فقط یعنی همان worker بدونِ اولویتِ دیسک
      const ionice = process.platform === 'linux' && existsSync('/usr/bin/ionice');
      const child = ionice
        ? spawn('/usr/bin/ionice', ['-c', '3', process.execPath, worker], { stdio: ['ignore', 'inherit', 'inherit'] })
        : spawn(process.execPath, [worker], { stdio: ['ignore', 'inherit', 'inherit'] });
      let finished = false;
      const done = (ok) => {
        if (finished) return;
        finished = true;
        clearTimeout(kill);
        running = false;
        if (!ok) failedAt = Date.now();
      };
      const kill = setTimeout(() => {
        console.error('❌ TRENDS worker exceeded its budget; killed (next try in 1h)');
        try { child.kill('SIGTERM'); } catch {}
      }, WORKER_BUDGET_MS);
      child.once('error', () => done(false));
      child.once('close', (code) => done(code === 0));
    } catch (e) {
      running = false;
      failedAt = Date.now();
      console.error('❌ TRENDS schedule:', e.message);
    }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, CHECK_EVERY_MS);
}
