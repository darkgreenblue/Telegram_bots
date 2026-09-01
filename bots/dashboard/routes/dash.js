// 📊 داشبوردِ اصلی (BI) — «در یک نگاه، چقدر کاربر را درگیر کرده‌ایم؟»
//
// اولویتِ صریحِ مالک در این فاز **درآمد نیست، درگیریِ کاربر است**: چیدمانِ صفحه هم
// همان را می‌گوید — ردیفِ اولِ اعدادِ درشت درباره‌ی ماندگاری و رضایت است، و مالی
// پایین‌تر می‌آید. هر عددِ کاربرمحور طبقِ قراردادِ داشبورد قابلِ کلیک است و لیستِ
// همان آدم‌ها را باز می‌کند (تعریفِ شرط‌ها: `lib/engage.js`، لیست: `lib/cohorts.js`).
//
// دو فیلترِ بالای صفحه:
//   • بازه (امروز / هفته / ماه / کل) — روی همه‌ی بخش‌های بازه‌ای اثر می‌گذارد؛ پیش‌فرض هفته.
//   • پنجره‌ی «کاربر فعال» (۱ تا ۷ روز) — همان چرخاندنی که مالک خواست: با ۱ روز
//     «فعالِ روزانه» و با ۷ روز «فعالِ هفتگی» را می‌بینی.
import {
  instancesOf, withDb, hasTable, scalar, rows, botByKey,
  moneyOf, revenueWhere, toToman, moneyText, creditText, coinOf, baseKey,
} from '../lib/bots.js';
import { scopeBot, MASTER_DASH_BOTS } from '../lib/nav.js';
import { getSetting, setSetting, audit } from '../lib/platform.js';
import { fmt, esc, nowSec, tehranDayStart, tehranDayStr } from '../lib/util.js';
import { stat, cohortCount, table } from '../lib/html.js';
import { donut, hbars, ordinalBars, timeChart, CAT } from '../lib/charts.js';
import {
  DONE, RDAY, RATED, RATE_EXPR, RET_DAYS, READ_BUCKETS, SATISFIED_MIN_AVG,
  ACTIVE_MIN_AGE_DAYS, notAdminReadings,
  activeUsersSql, readerUsersSql, repeatUsersSql, satisfiedUsersSql, ratersUsersSql,
  successfulReferrersSql, bucketUsersSql, retainedUsersSql,
} from '../lib/engage.js';

/* کاتالوگِ فال‌ها از خودِ ربات خوانده می‌شود تا نامِ چیدمان‌ها هرگز در دو جا نوشته نشود.
   ⚠️ import پویا و در try/catch: اگر روزی آن فایل به npm وابسته شود یا جابه‌جا شود،
   داشبورد نباید بالا نیاید و بمیرد — فقط برچسبِ خامِ آی‌دی نشان می‌دهد. */
let SPREAD_BY_ID = {}, TOPIC_BY_KEY = {}, topicOf = () => null;
try {
  const m = await import('../../tarot/spreads.js');
  SPREAD_BY_ID = m.SPREAD_BY_ID || {};
  TOPIC_BY_KEY = m.TOPIC_BY_KEY || {};
  topicOf = m.topicOf || topicOf;
} catch { /* بدونِ کاتالوگ هم صفحه کار می‌کند */ }

const RANGES = {
  day: { label: 'امروز', days: 1 },
  week: { label: 'هفته‌ی اخیر', days: 7 },
  month: { label: 'ماه اخیر', days: 30 },
  all: { label: 'کل عمر ربات', days: 0 },
};
const GROWTH_DAYS = 30;
const USD_RATE_KEY = 'usd_toman';

const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const usd = (n) => `$${(Number(n) || 0).toFixed(Number(n) && Number(n) < 1 ? 4 : 2)}`;

/** میانه از یک هیستوگرامِ {مقدار: تعداد} — بدونِ کشیدنِ همه‌ی ردیف‌ها به حافظه. */
function medianOfHist(pairs) {
  const total = pairs.reduce((a, [, c]) => a + c, 0);
  if (!total) return null;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  let seen = 0;
  const mid = total / 2;
  for (const [v, c] of sorted) { seen += c; if (seen >= mid) return v; }
  return sorted[sorted.length - 1][0];
}

/** تعدادِ کاربرانِ یک شرطِ کوهورت (همان SQL ای که لیستش را هم می‌سازد). */
const countOf = (db, q) => (q ? scalar(db, `SELECT COUNT(*) c FROM (${q.sql})`, q.params) : 0);

/* ═══ جمع‌آوریِ همه‌ی سنجه‌ها ═══
   تاروت ممکن است چند instance (per locale) داشته باشد؛ کاربرانشان مجزا هستند، پس
   شمارش‌ها جمع می‌شوند و بیشینه‌ها max گرفته می‌شوند. اتصال‌ها readonly و کوتاه‌اند. */
function gather(botKey, { since, activeWindow }) {
  const now = nowSec();
  const agg = {
    users: 0, newInRange: 0, newToday: 0, newWeek: 0,
    readers: 0, active: 0, repeat: 0, satisfied: 0, raters: 0,
    readings: 0, readingsInRange: 0, firstReadingAt: null,
    revTotal: 0, revInRange: 0, revWeek: 0, revMonth: 0,
    dau: 0, wau: 0, mau: 0,
    referrers: 0, referralsOk: 0, maxReferrals: 0,
    coinsSpent: 0,
    costTotal: 0, costInRange: 0, costToday: 0, costWeek: 0, costMonth: 0,
    costRows: 0, costDays: 0, hasCostTable: false,
    rateHist: new Map(), ratedReadings: 0, rateSum: 0,
    sizeCounts: new Map(), topicCounts: new Map(),
    buckets: READ_BUCKETS.map(() => 0),
    retention: RET_DAYS.map(() => ({ num: 0, den: 0 })),
    growth: new Map(), readingsByDay: new Map(),
    streaks: new Map(),
    ttfv: [], churn: 0, powerUsers: [],
  };
  const today = tehranDayStart();
  const week = tehranDayStart(-6);
  const month = now - 30 * 86400;

  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      const ev = hasTable(db, 'events');
      const na = notAdminReadings(ev);
      const hasReadings = hasTable(db, 'readings');
      const m = moneyOf(botKey);

      agg.users += scalar(db, 'SELECT COUNT(*) c FROM users');
      agg.newInRange += scalar(db, 'SELECT COUNT(*) c FROM users WHERE created_at >= ?', [since]);
      agg.newToday += scalar(db, 'SELECT COUNT(*) c FROM users WHERE created_at >= ?', [today]);
      agg.newWeek += scalar(db, 'SELECT COUNT(*) c FROM users WHERE created_at >= ?', [week]);

      if (ev) {
        agg.dau += scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [today]);
        agg.wau += scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [week]);
        agg.mau += scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [month]);
      }

      /* ---- پول (تومان؛ هرگز با واحدِ الماس قاطی نمی‌شود) ---- */
      if (hasTable(db, m.table)) {
        const rw = revenueWhere(botKey);
        const rev = (s) => toToman(botKey, scalar(db, `SELECT COALESCE(SUM(${rw.amountCol}),0) s FROM ${rw.table} WHERE ${rw.where}`, [s]));
        agg.revTotal += rev(0);
        agg.revInRange += rev(since);
        agg.revWeek += rev(week);
        agg.revMonth += rev(month);
      }

      if (hasReadings) {
        agg.readings += scalar(db, `SELECT COUNT(*) c FROM readings r WHERE ${DONE}${na}`);
        agg.readingsInRange += scalar(db, `SELECT COUNT(*) c FROM readings r WHERE ${DONE}${na} AND r.created_at >= ?`, [since]);
        agg.coinsSpent += scalar(db, `SELECT COALESCE(SUM(r.price),0) s FROM readings r WHERE ${DONE}${na}`);
        const f = scalar(db, `SELECT MIN(r.created_at) t FROM readings r WHERE ${DONE}${na}`, [], 0);
        if (f && (!agg.firstReadingAt || f < agg.firstReadingAt)) agg.firstReadingAt = f;

        agg.readers += countOf(db, readerUsersSql(ev));
        agg.active += countOf(db, activeUsersSql(now, activeWindow, ev));
        agg.repeat += countOf(db, repeatUsersSql(ev));
        agg.satisfied += countOf(db, satisfiedUsersSql(ev));
        agg.raters += countOf(db, ratersUsersSql(ev));
        READ_BUCKETS.forEach((_, i) => { agg.buckets[i] += countOf(db, bucketUsersSql(i, ev)); });
        RET_DAYS.forEach((d, i) => {
          agg.retention[i].num += countOf(db, retainedUsersSql(d, now, ev));
          agg.retention[i].den += countOf(db, retainedUsersSql(d, now, ev, { denominator: true }));
        });

        // رضایت: هیستوگرامِ ۱ تا ۵ (میانگین و میانه هر دو از همین ساخته می‌شوند)
        for (const r of rows(db, `SELECT ${RATE_EXPR} v, COUNT(*) c FROM readings r WHERE ${RATED}${na} GROUP BY v`)) {
          const v = Math.round(Number(r.v));
          if (v >= 1 && v <= 5) {
            agg.rateHist.set(v, (agg.rateHist.get(v) || 0) + r.c);
            agg.ratedReadings += r.c; agg.rateSum += v * r.c;
          }
        }

        // محبوبیتِ چیدمان (اندازه و موضوع) در بازه‌ی انتخابی
        for (const r of rows(db, `SELECT r.type t, COUNT(*) c FROM readings r WHERE ${DONE}${na} AND r.created_at >= ? GROUP BY r.type`, [since])) {
          const sp = SPREAD_BY_ID[r.t];
          const size = sp?.size || 0;
          const sizeKey = size ? `${fmt(size)} کارتی` : 'نامشخص';
          agg.sizeCounts.set(sizeKey, (agg.sizeCounts.get(sizeKey) || 0) + r.c);
          const tk = topicOf(r.t);
          const label = (tk && TOPIC_BY_KEY[tk]) ? `${TOPIC_BY_KEY[tk].emoji} ${TOPIC_BY_KEY[tk].fa}` : (sp?.fa || r.t || 'نامشخص');
          agg.topicCounts.set(label, (agg.topicCounts.get(label) || 0) + r.c);
        }

        // سری‌های روزانه‌ی ۳۰ روزِ اخیر (رشد کاربر + تعداد فال)
        for (const r of rows(db, `SELECT ${RDAY} d, COUNT(*) c FROM readings r WHERE ${DONE}${na} AND r.created_at >= ? GROUP BY d`, [tehranDayStart(-(GROWTH_DAYS - 1))])) {
          agg.readingsByDay.set(r.d, (agg.readingsByDay.get(r.d) || 0) + r.c);
        }

        // ریزش: هفته‌ی قبل فالِ کامل داشت، این هفته نه
        agg.churn += scalar(db, `SELECT COUNT(*) c FROM (
          SELECT r.user_id FROM readings r WHERE ${DONE}${na} AND r.created_at >= ? AND r.created_at < ?
          GROUP BY r.user_id
          HAVING r.user_id NOT IN (SELECT user_id FROM readings WHERE status='delivered' AND price>0 AND created_at >= ?))`,
          [now - 14 * 86400, now - 7 * 86400, now - 7 * 86400]);

        // زمان تا اولین فال (میانه) — یک ردیف per کاربرِ فال‌گرفته، سقفِ ۵۰۰۰
        for (const r of rows(db, `SELECT MIN(r.created_at) - u.created_at d FROM readings r
            JOIN users u ON u.telegram_id = r.user_id WHERE ${DONE}${na}
            GROUP BY r.user_id LIMIT 5000`)) {
          if (Number.isFinite(r.d) && r.d >= 0) agg.ttfv.push(r.d);
        }

        // پرمصرف‌ترین‌ها (لینک به پروفایل — مسیرِ گفت‌وگو با کاربرِ وفادار)
        for (const r of rows(db, `SELECT r.user_id uid, COUNT(*) c, COALESCE(SUM(r.price),0) p FROM readings r
            WHERE ${DONE}${na} GROUP BY r.user_id ORDER BY c DESC LIMIT 8`)) {
          agg.powerUsers.push({ instId: inst.id, uid: r.uid, c: r.c, coins: r.p });
        }
      }

      // رشدِ کاربر (روزانه، ۳۰ روز)
      for (const r of rows(db, `SELECT CAST((created_at + 12600)/86400 AS INTEGER) d, COUNT(*) c
          FROM users WHERE created_at >= ? GROUP BY d`, [tehranDayStart(-(GROWTH_DAYS - 1))])) {
        agg.growth.set(r.d, (agg.growth.get(r.d) || 0) + r.c);
      }

      // عادتِ روزانه: توزیعِ استریکِ کارتِ روز (تنها سنجه‌ی «آیینِ روزانه» که مستقیم ثبت می‌شود)
      if (rows(db, "SELECT 1 FROM pragma_table_info('users') WHERE name='daily_streak'").length) {
        for (const r of rows(db, `SELECT CASE WHEN daily_streak = 0 THEN '۰'
              WHEN daily_streak = 1 THEN '۱' WHEN daily_streak BETWEEN 2 AND 3 THEN '۲ تا ۳'
              WHEN daily_streak BETWEEN 4 AND 6 THEN '۴ تا ۶' ELSE '۷ و بیشتر' END k,
            COUNT(*) c FROM users GROUP BY k`)) {
          agg.streaks.set(r.k, (agg.streaks.get(r.k) || 0) + r.c);
        }
      }

      /* ---- هزینه‌ی واقعیِ مدل (جدولِ llm_usage — از نسخه‌ی حسابداریِ مصرف به بعد) ---- */
      if (hasTable(db, 'llm_usage')) {
        agg.hasCostTable = true;
        const c = (s) => scalar(db, 'SELECT COALESCE(SUM(cost_usd),0) s FROM llm_usage WHERE created_at >= ?', [s]);
        agg.costTotal += c(0);
        agg.costInRange += c(since);
        agg.costToday += c(today);
        agg.costWeek += c(week);
        agg.costMonth += c(month);
        agg.costRows += scalar(db, 'SELECT COUNT(*) c FROM llm_usage');
        agg.costDays = Math.max(agg.costDays,
          scalar(db, `SELECT COUNT(DISTINCT ${'CAST((created_at + 12600)/86400 AS INTEGER)'}) c FROM llm_usage`));
      }

      // دعوت از دوستان
      if (hasTable(db, 'referrals')) {
        agg.referrers += countOf(db, successfulReferrersSql());
        agg.referralsOk += scalar(db, 'SELECT COUNT(*) c FROM referrals WHERE rewarded=1');
        agg.maxReferrals = Math.max(agg.maxReferrals,
          scalar(db, 'SELECT COALESCE(MAX(c),0) m FROM (SELECT COUNT(*) c FROM referrals WHERE rewarded=1 GROUP BY referrer_id)'));
      }
    });
  }
  agg.powerUsers.sort((a, b) => b.c - a.c);
  agg.powerUsers = agg.powerUsers.slice(0, 8);
  return agg;
}

/* ═══ رندر ═══ */
export function dashBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  if (!MASTER_DASH_BOTS.has(baseKey(bot))) {
    return `<div class="card"><h2>📊 داشبورد اصلی</h2>
      <p>داشبوردِ تحلیلیِ جامع فعلاً فقط برای <b>🔮 تاروت</b> ساخته شده (تمرکزِ فعلیِ محصول).</p>
      <p class="muted">برای «${esc(title)}» بقیه‌ی صفحه‌های تحلیلی (فانل‌ها، ریتنشن، مارکتینگ، مالی، کاربران)
        همچنان کار می‌کنند؛ فقط این صفحه هنوز سنجه‌های اختصاصیِ این ربات را ندارد.
        اضافه‌کردنش = یک ردیف در <span class="mono">MASTER_DASH_BOTS</span> به‌علاوه‌ی سنجه‌های همان محصول.</p></div>`;
  }
  if (!instancesOf(bot).length) {
    return `<div class="card"><h2>📊 داشبورد اصلی</h2><p class="muted">دیتابیسِ این ربات پیدا نشد.
      این صفحه روی سرور (کنارِ دیتابیسِ ربات‌ها) معنا دارد.</p></div>`;
  }

  const rk = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : 'week';
  const range = RANGES[rk];
  const since = range.days ? tehranDayStart(-(range.days - 1)) : 0;
  const aw = Math.min(7, Math.max(1, parseInt(url.searchParams.get('aw') || '7', 10) || 7));
  const growthMode = url.searchParams.get('g') === 'cum' ? 'cum' : 'inc';

  const a = gather(bot, { since, activeWindow: aw });
  const coin = coinOf(bot);
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const toman = (usdVal) => (rate ? `<span class="muted"> ≈ ${fmt(Math.round(usdVal * rate))} ت</span>` : '');
  const co = { k: 'tarot', bot, aw: String(aw) }; // پارامترهای پایه‌ی کوهورت‌های این صفحه

  /* ── فیلترها ── */
  const rangeTabs = Object.entries(RANGES).map(([k, v]) =>
    `<a href="?bot=${esc(bot)}&range=${k}&aw=${aw}&g=${growthMode}" class="pill ${k === rk ? 'on' : ''}">${esc(v.label)}</a>`).join('');
  const awOptions = [1, 2, 3, 4, 5, 6, 7].map(d =>
    `<option value="${d}" ${d === aw ? 'selected' : ''}>${fmt(d)} روز</option>`).join('');
  const filters = `<div class="card dash-filters">
    <div class="pills">${rangeTabs}</div>
    <form method="get" action="/dash" class="inline" style="margin-inline-start:auto">
      <input type="hidden" name="bot" value="${esc(bot)}">
      <input type="hidden" name="range" value="${esc(rk)}">
      <input type="hidden" name="g" value="${esc(growthMode)}">
      <label>پنجره‌ی «کاربر فعال»<select name="aw" data-autosubmit>${awOptions}</select></label>
      <noscript><button type="submit">اعمال</button></noscript>
    </form></div>`;

  /* ── ردیفِ ثابت: اعدادِ درشتِ مستقل از بازه ── */
  const satRatio = pctOf(a.satisfied, a.readers);
  const satOfRaters = pctOf(a.satisfied, a.raters);
  const heroes = `<div class="heroes">
    ${hero('کاربر فعال', cohortCount(a.active, { ...co, t: 'active' }),
      `درگیر و حفظ‌شده · پنجره‌ی ${fmt(aw)} روز`, true)}
    ${hero('کل کاربران فعال‌شده', cohortCount(a.users, { k: 'users', bot }), 'هرکس که وارد ربات شده')}
    ${hero('کل فال‌های کامل', fmt(a.readings), 'تحویل‌شده و الماس‌خرج‌شده')}
    ${hero('نسبت کاربران راضی', `${fmt(satRatio)}٪`, `${fmt(a.satisfied)} از ${fmt(a.readers)} فال‌گرفته`)}
  </div>`;

  /* ── درگیری و ماندگاری (اولویتِ فاز) ── */
  const stickiness = pctOf(a.dau, a.wau);
  const perUser = a.users ? Math.round((a.readings / a.users) * 100) / 100 : 0;
  const perReader = a.readers ? Math.round((a.readings / a.readers) * 100) / 100 : 0;
  const lifeDays = a.firstReadingAt ? Math.max(1, Math.ceil((nowSec() - a.firstReadingAt) / 86400)) : 1;
  const readingsPerDay = Math.round((a.readings / lifeDays) * 10) / 10;
  const ttfvMedian = a.ttfv.length ? a.ttfv.sort((x, y) => x - y)[Math.floor(a.ttfv.length / 2)] : null;

  const engagement = `<div class="card"><h2>🔥 درگیری و ماندگاری</h2>
    <div class="grid">
      ${stat('کاربران فال‌گرفته (حداقل ۱ فال)', cohortCount(a.readers, { ...co, t: 'readers' }))}
      ${stat('برگشتی (در ۲ روزِ متفاوت فال گرفته)', cohortCount(a.repeat, { ...co, t: 'repeat' })
        + ` <span class="muted">${fmt(pctOf(a.repeat, a.readers))}٪ از فال‌گرفته‌ها</span>`)}
      ${stat('چسبندگی (DAU÷WAU)', `${fmt(stickiness)}٪`)}
      ${stat('ریزشِ هفتگی', cohortCount(a.churn, { ...co, t: 'churn' })
        + ' <span class="muted">هفته‌ی قبل فال گرفت، این هفته نه</span>')}
      ${stat('میانگین فال به ازای هر کاربرِ واردشده', fmt(perUser))}
      ${stat('میانگین فال به ازای کاربرِ فال‌گرفته', fmt(perReader))}
      ${stat('میانگین فال در روز (کل عمر)', fmt(readingsPerDay))}
      ${stat('میانه‌ی زمان تا اولین فال', ttfvMedian === null ? '<span class="muted">-</span>'
        : (ttfvMedian < 3600 ? `${fmt(Math.round(ttfvMedian / 60))} دقیقه` : `${fmt(Math.round(ttfvMedian / 3600))} ساعت`))}
    </div>
    <p class="muted" style="margin-top:10px">«کاربر فعال» = سه شرط با هم: حداقل ${fmt(ACTIVE_MIN_AGE_DAYS)} روز از اولین فالش گذشته،
      در حداقل دو روزِ متفاوت فالِ کامل گرفته، و از آخرین فالش کمتر از ${fmt(aw)} روز گذشته.
      روی هر عدد بزن تا لیستِ همان آدم‌ها باز شود.</p></div>`;

  /* ── ماندگاری از اولین فال + عمقِ استفاده ── */
  const retentionCard = `<div class="card"><h2>📈 ماندگاری از اولین فال</h2>
    ${ordinalBars(RET_DAYS.map((d, i) => ({
      label: `D+${d}`, value: pctOf(a.retention[i].num, a.retention[i].den),
    })), { suffix: '٪' })}
    <div class="grid" style="margin-top:12px">
      ${RET_DAYS.map((d, i) => stat(`برگشتِ D+${d}`,
        cohortCount(a.retention[i].num, { ...co, t: 'ret', d: String(d) })
        + ` <span class="muted">از ${fmt(a.retention[i].den)}</span>`)).join('')}
    </div>
    <p class="muted" style="margin-top:8px">مخرج فقط کاربرانِ «رسیده» است (کسی که اولین فالش حداقل همان‌قدر روز پیش بوده)،
      وگرنه کاربرِ تازه‌وارد که هنوز فرصتِ برگشتن نداشته، عدد را مصنوعاً پایین می‌آورد.</p></div>`;

  const depthCard = `<div class="card"><h2>🎯 عمقِ استفاده (چند فال per کاربر)</h2>
    ${ordinalBars(READ_BUCKETS.map((b, i) => ({ label: b.label, value: a.buckets[i] })))}
    <div class="grid" style="margin-top:12px">
      ${READ_BUCKETS.map((b, i) => stat(b.label, cohortCount(a.buckets[i], { ...co, t: 'bucket', i: String(i) }))).join('')}
    </div></div>`;

  const streakCard = a.streaks.size ? `<div class="card"><h2>🎴 عادتِ روزانه (استریکِ کارت روز)</h2>
    ${hbars([...a.streaks.entries()].map(([label, value]) => ({ label, value })))}
    <p class="muted">استریک = روزهای پیاپی که کاربر کارت روزش را گرفته. تنها آیینِ روزانه‌ی ربات، و ارزان‌ترین قلاب بازگشت.</p></div>` : '';

  /* ── رضایت ── */
  const avgRate = a.ratedReadings ? Math.round((a.rateSum / a.ratedReadings) * 100) / 100 : null;
  const medRate = medianOfHist([...a.rateHist.entries()]);
  const satisfaction = `<div class="card"><h2>⭐ رضایت از فال‌ها</h2>
    <div class="grid">
      ${stat('میانگین نمره (۱ تا ۵)', avgRate === null ? '<span class="muted">هنوز نمره‌ای ثبت نشده</span>' : `<b>${fmt(avgRate)}</b>`)}
      ${stat('میانه‌ی نمره', medRate === null ? '<span class="muted">-</span>' : fmt(medRate))}
      ${stat('نسبت کاربران راضی', `${fmt(satRatio)}٪`)}
      ${stat('راضی از بین نمره‌دهندگان', `${fmt(satOfRaters)}٪`)}
      ${stat('کاربران راضی', cohortCount(a.satisfied, { ...co, t: 'satisfied' }))}
      ${stat('کاربرانی که نمره داده‌اند', cohortCount(a.raters, { ...co, t: 'raters' })
        + ` <span class="muted">${fmt(pctOf(a.raters, a.readers))}٪ از فال‌گرفته‌ها</span>`)}
    </div>
    <div style="margin-top:14px">${ordinalBars([1, 2, 3, 4, 5].map(v => ({ label: `${fmt(v)} ★`, value: a.rateHist.get(v) || 0 })))}</div>
    <p class="muted" style="margin-top:8px">«کاربر راضی» = میانگینِ نمره‌هایی که به فال‌هایش داده بالای ${fmt(SATISFIED_MIN_AVG)} باشد.
      «نسبت کاربران راضی» مخرجش همه‌ی فال‌گرفته‌هاست (پس نمره‌ندادن هم مثل نارضایتی حساب می‌شود)؛
      عددِ کناری همان نسبت را فقط بین کسانی می‌گیرد که واقعاً نمره داده‌اند.</p></div>`;

  /* ── فال‌ها ── */
  const sizeItems = [...a.sizeCounts.entries()]
    .sort((x, y) => parseInt(x[0], 10) - parseInt(y[0], 10))
    .map(([label, value], i) => ({ label, value, color: CAT[i % CAT.length] }));
  const topicItems = [...a.topicCounts.entries()].sort((x, y) => y[1] - x[1]).map(([label, value]) => ({ label, value }));
  const readingsCard = `<div class="card"><h2>🔮 فال‌ها — ${esc(range.label)}</h2>
    <div class="grid">
      ${stat('فال در این بازه', fmt(a.readingsInRange))}
      ${stat('کل فال‌های کامل', fmt(a.readings))}
      ${stat(`الماسِ خرج‌شده روی فال`, coin ? creditText(bot, a.coinsSpent) : fmt(a.coinsSpent))}
      ${stat('میانگین فال در روز (بازه)', fmt(range.days ? Math.round((a.readingsInRange / range.days) * 10) / 10 : readingsPerDay))}
    </div>
    <div class="two" style="margin-top:16px">
      <div><h3 class="ch">اندازه‌ی فال (${esc(range.label)})</h3>${donut(sizeItems)}</div>
      <div><h3 class="ch">محبوب‌ترین موضوع‌ها (${esc(range.label)})</h3>${hbars(topicItems.slice(0, 12))}</div>
    </div>
    <p class="muted" style="margin-top:8px">موضوع‌ها عمداً میله‌ی افقیِ مرتب‌شده‌اند نه دایره: با این تعداد دسته،
      دایره فقط زیباست و قابل‌مقایسه نیست.</p></div>`;

  /* ── نمودارهای زمانی ── */
  // برچسبِ محورِ افقی به تقویمِ شمسی (با خودِ Intl؛ هیچ کتابخانه‌ی تقویمی اضافه نشده)
  const jalali = (unix) => {
    try {
      return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'numeric', day: 'numeric' })
        .format(new Date(unix * 1000));
    } catch { return tehranDayStr(unix).slice(5); }
  };
  const dayKeys = Array.from({ length: GROWTH_DAYS }, (_, i) => {
    const ts = tehranDayStart(-(GROWTH_DAYS - 1 - i));
    return { key: Math.floor((ts + 12600) / 86400), label: jalali(ts) };
  });
  let running = 0;
  const growthPoints = dayKeys.map(d => {
    const v = a.growth.get(d.key) || 0;
    running += v;
    return { x: d.label, y: growthMode === 'cum' ? running : v };
  });
  const readingPoints = dayKeys.map(d => ({ x: d.label, y: a.readingsByDay.get(d.key) || 0 }));
  const growthToggle = ['inc', 'cum'].map(g =>
    `<a href="?bot=${esc(bot)}&range=${esc(rk)}&aw=${aw}&g=${g}" class="pill ${g === growthMode ? 'on' : ''}">${g === 'cum' ? 'تجمعی' : 'اضافه‌شده'}</a>`).join('');
  const charts = `<div class="card"><h2>📉 رشد کاربر (۳۰ روز)</h2>
      <div class="pills" style="margin-bottom:10px">${growthToggle}</div>
      ${timeChart(growthPoints, { label: 'کاربر' })}
      <p class="muted">«اضافه‌شده» = کاربر جدید در هر روز؛ «تجمعی» = جمعِ کاربرانِ اضافه‌شده در همین ۳۰ روز (نه کلِ عمرِ ربات).</p></div>
    <div class="card"><h2>🔮 فال‌های کامل در روز (۳۰ روز)</h2>${timeChart(readingPoints, { color: CAT[1], label: 'فال' })}</div>`;

  /* ── کاربران (بازه‌ای) ── */
  const usersCard = `<div class="card"><h2>👥 کاربران — ${esc(range.label)}</h2>
    <div class="grid">
      ${stat('کاربر جدید در این بازه', cohortCount(a.newInRange, { k: 'users', bot, since: String(since) }))}
      ${stat('کاربر جدید امروز', cohortCount(a.newToday, { k: 'users', bot, since: String(tehranDayStart()) }))}
      ${stat('کاربر جدید هفته‌ی اخیر', cohortCount(a.newWeek, { k: 'users', bot, since: String(tehranDayStart(-6)) }))}
      ${stat('فعال امروز (DAU)', cohortCount(a.dau, { k: 'actives', bot, since: String(tehranDayStart()) }))}
      ${stat('فعال ۷ روز (WAU)', cohortCount(a.wau, { k: 'actives', bot, since: String(tehranDayStart(-6)) }))}
      ${stat('فعال ۳۰ روز (MAU)', cohortCount(a.mau, { k: 'actives', bot, since: String(nowSec() - 30 * 86400) }))}
    </div>
    <p class="muted" style="margin-top:8px">DAU/WAU/MAU از جدولِ رویدادها می‌آید (هر تعاملی = فعال)؛ «کاربر فعال»ِ بالای صفحه
      سخت‌گیرتر است و فقط فالِ کاملِ پول‌داده را می‌شمارد.</p></div>`;

  /* ── دعوت ── */
  const referral = `<div class="card"><h2>🤝 دعوت از دوستان</h2>
    <div class="grid">
      ${stat('کاربران دعوت‌کننده‌ی موفق', cohortCount(a.referrers, { ...co, t: 'referrer' }))}
      ${stat('کل دعوت‌های موفق', fmt(a.referralsOk))}
      ${stat('بیشترین دعوت توسط یک کاربر', fmt(a.maxReferrals))}
      ${stat('میانگین دعوت per دعوت‌کننده', fmt(a.referrers ? Math.round((a.referralsOk / a.referrers) * 100) / 100 : 0))}
    </div>
    <p class="muted">«دعوتِ موفق» = دعوت‌شده وارد شد، فالِ کامل گرفت و پاداشِ دعوت‌کننده پرداخت شد
      (همان بیتی که خودِ ربات می‌زند؛ هیچ تعریفِ دومی ساخته نشده).</p></div>`;

  /* ── هزینه و درآمد ── */
  const avgDailyCost = a.costDays ? a.costTotal / a.costDays : 0;
  const costPerReading = a.readings ? a.costTotal / a.readings : 0;
  const costCard = `<div class="card"><h2>🧾 هزینه‌ی مدل (OpenRouter)</h2>
    ${a.hasCostTable ? `<div class="grid">
      ${stat('هزینه‌ی کل', usd(a.costTotal) + toman(a.costTotal))}
      ${stat('هزینه‌ی ماه اخیر', usd(a.costMonth) + toman(a.costMonth))}
      ${stat('هزینه‌ی هفته‌ی اخیر', usd(a.costWeek) + toman(a.costWeek))}
      ${stat('هزینه‌ی امروز', usd(a.costToday) + toman(a.costToday))}
      ${stat('میانگین هزینه‌ی روزانه', usd(avgDailyCost) + toman(avgDailyCost))}
      ${stat('هزینه به ازای هر فال', usd(costPerReading) + toman(costPerReading))}
      ${stat(`هزینه در ${esc(range.label)}`, usd(a.costInRange) + toman(a.costInRange))}
      ${stat('تعداد فراخوانیِ ثبت‌شده', fmt(a.costRows))}
    </div>` : ''}
    ${a.costRows ? '' : `<div class="note">ثبتِ هزینه تازه روشن شده و هنوز ردیفی ندارد.
      این عدد از لحظه‌ی انتشار به بعد پر می‌شود و <b>برای گذشته قابلِ بازسازی نیست</b> (هیچ‌جا ذخیره نشده بود).</div>`}
    <form method="post" action="/dash/rate" class="inline" style="margin-top:12px">
      <input type="hidden" name="bot" value="${esc(bot)}">
      <label>نرخ دلار به تومان (برای مقایسه با درآمد)<input name="rate" type="number" min="0" value="${rate || ''}" placeholder="مثلاً 90000"></label>
      <button type="submit">ذخیره</button>
    </form>
    <p class="muted">هزینه همان عددی است که خودِ OpenRouter برمی‌گرداند (اعتبارِ دلاری per فراخوانی). نرخِ ارز را
      خودت وارد می‌کنی؛ داشبورد هیچ نرخی از خودش نمی‌سازد. مسیرِ داوریِ رسید هنوز در این عدد نیست.</p></div>`;

  const revenueCard = `<div class="card"><h2>💳 درآمد</h2>
    <div class="grid">
      ${stat(`درآمد ${esc(range.label)}`, moneyText(bot, a.revInRange))}
      ${stat('درآمد هفته', moneyText(bot, a.revWeek))}
      ${stat('درآمد ماه', moneyText(bot, a.revMonth))}
      ${stat('درآمد کل', moneyText(bot, a.revTotal))}
      ${stat('درآمد به ازای هر کاربر', moneyText(bot, a.users ? Math.round(a.revTotal / a.users) : 0))}
      ${a.hasCostTable && rate ? stat('حاشیه‌ی ناخالص (درآمد کل − هزینه‌ی مدل)',
        moneyText(bot, Math.round(a.revTotal - a.costTotal * rate))) : ''}
    </div>
    <p class="muted">درآمد = مبلغِ واقعاً پرداخت‌شده و تأییدشده (بعد از تخفیف). واحدِ پول تومان است و هرگز با الماس قاطی نمی‌شود.</p></div>`;

  /* ── کاربرانِ وفادار ── */
  const power = a.powerUsers.length ? `<div class="card"><h2>🏅 وفادارترین کاربران</h2>
    ${table(['کاربر', 'فال کامل', 'الماسِ خرج‌شده'], a.powerUsers.map(u => [
      `<a href="/support/user?inst=${encodeURIComponent(u.instId)}&id=${u.uid}" class="mono">${u.uid}</a>`,
      fmt(u.c),
      coin ? creditText(bot, u.coins) : fmt(u.coins),
    ]))}
    <p class="muted">همان آدم‌هایی که ارزشِ پرسیدن دارند: چرا برمی‌گردند، و چه چیزی نگهشان داشته.</p></div>` : '';

  return `<div class="card dash-head"><h2 style="margin:0">📊 داشبورد اصلی — ${esc(title)}</h2>
      <p class="muted" style="margin:6px 0 0">تمرکزِ این صفحه درگیری و ماندگاریِ کاربر است، نه درآمد.
        اعدادِ ردیفِ بالا مستقل از بازه‌اند؛ بقیه با فیلترِ بازه عوض می‌شوند.</p></div>
    ${filters}${heroes}${engagement}${retentionCard}${depthCard}${streakCard}
    ${satisfaction}${readingsCard}${charts}${usersCard}${referral}${costCard}${revenueCard}${power}`;
}

const hero = (k, v, sub = '', big = false) => `<div class="hero${big ? ' big' : ''}">
  <div class="k">${esc(k)}</div><div class="v">${v}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

/** نرخِ دلار (ورودیِ انسانی؛ داشبورد هیچ نرخی از خودش نمی‌سازد). */
export function dashRate(body) {
  const v = Math.max(0, parseInt(body.get('rate') || '0', 10) || 0);
  if (v > 100_000_000) throw new Error('نرخ نامعتبر است');
  setSetting(USD_RATE_KEY, String(v));
  audit('dash.usd_rate', '', String(v));
  return v ? `نرخ دلار ذخیره شد: ${fmt(v)} تومان` : 'نرخ دلار پاک شد';
}
