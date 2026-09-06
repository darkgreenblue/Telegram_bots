// 📈 سودِ خالص — تک‌منبعِ «آخرش چقدر ماند؟»
//
// خواسته‌ی صریحِ مالک (۱۴۰۵/۰۶/۱۵): «سود واقعی چیزیه که هر روز باید رصد کنیم و بفهمم
// کی مثبت شدم و چقدر مثبت هستم». پس این فایل یک عددِ تکی نمی‌سازد، یک **سریِ روزانه**
// می‌سازد که هم نقطه‌ی سربه‌سر را نشان می‌دهد هم روندِ بعدش را.
//
// ═══ فرمول، و اینکه چرا هر جمله‌اش عمدی است ═══
//   سودِ خالص = درآمدِ نقدی − هزینه‌ی مدل − هزینه‌ی تبلیغ
//
// ۱) **درآمد = `SUM(amount)`ِ تأییدشده، و تخفیف از آن کم نمی‌شود.**
//    ⚠️ باگِ واقعیِ کشف‌شده در ۱۴۰۵/۰۶/۱۵: صفحه‌ی `/costs` تخفیف را **دو بار** کم
//    می‌کرد. ستونِ `payments.amount` در خودِ ربات مبلغِ **بعد از** تخفیف است
//    (`setPaymentDiscount` در tarot: `original_amount=قیمتِ اصلی, amount=تخفیف‌خورده`)،
//    و `discount_uses.discount_amount` دقیقاً همان اختلاف است. پس کم‌کردنِ دوباره‌اش
//    سود را به اندازه‌ی کلِ تخفیف‌ها کم‌برآورد می‌کرد. تخفیف در چارچوبِ «درآمدِ ناخالص
//    منهای contra-revenue» معنا دارد؛ ولی وقتی نقطه‌ی شروع **خودِ پولِ دریافتی** است،
//    تخفیف از قبل داخلش لحاظ شده و بار دوم دوباره‌شماری است.
//
// ۲) **اعتبارِ هدیه هزینه نیست** (همان فلسفه‌ی `/costs`): دادنِ ۵ الماس هیچ ریالی از
//    جیب نمی‌برد؛ یک بدهیِ تبلیغاتی است. هزینه لحظه‌ای رخ می‌دهد که کاربر خرجش کند و
//    ما یک فال تحویل بدهیم — و آن هزینه از قبل در `llm_usage` هست. اگر هر دو را
//    می‌شمردیم، هزینه‌ی یک فالِ هدیه‌ای دو بار می‌آمد.
//
// ۳) **هزینه‌ی مدل تنها هزینه‌ی متغیرِ واقعی است** و از `llm_usage.cost_usd` می‌آید،
//    یعنی همان عددی که خودِ OpenRouter برمی‌گرداند (هیچ جدولِ قیمتی که کهنه شود).
//
// ۴) **هزینه‌ی تبلیغ** ورودیِ دستیِ دلاری است (`cpa_campaign_usd`) و به **روزِ ورودِ**
//    کاربرِ کمپین نسبت داده می‌شود، چون پولِ تبلیغ همان لحظه خرج شده.
//
// ═══ ⚠️ محدودیتِ صادقانه که هر مصرف‌کننده باید نمایش بدهد ═══
// `llm_usage` **تاریخچه ندارد**: از روزِ روشن‌شدنش پر می‌شود. درآمد ولی از روزِ اول
// هست. پس «سودِ کلِ عمر» یعنی درآمدِ دو ماه منهای هزینه‌ی یک هفته — عددی خوش‌بینانه و
// بی‌معنا. برای همین `costSince` برگردانده می‌شود و سنجه‌های تجمعی **از همان تاریخ**
// حساب می‌شوند، نه از ابتدای عمرِ ربات. کارت موظف است این را به کاربر بگوید.
//
// امنیت: هیچ رشته‌ای از URL وارد SQL نمی‌شود؛ همه‌ی ورودی‌ها عددی و bound اند.
import { instancesOf, withDb, hasTable, rows, scalar, revenueWhere, toToman, moneyOf, unixOf } from './bots.js';
import { tehranDayStart, tehranDayStr, nowSec } from './util.js';
// شماره‌ی روزِ تهران تک‌منبع است (`engage.js`): دو تعریفِ جدا دیر یا زود سرِ مرزِ روز واگرا می‌شوند.
import { tehranDayNo } from './engage.js';
import { orphanRevenueByDay } from './platform.js';

/** ورودی‌های انسانی که سود بدونشان کامل نیست (کلیدهای جدولِ settings). */
export const USD_RATE_KEY = 'usd_toman';
export const CAMPAIGN_CPA_KEY = 'cpa_campaign_usd';
/* هزینه‌ی دلاریِ مدل **قبل از** روشن‌شدنِ ثبتِ خودکار، خوانده‌شده از داشبوردِ خودِ
 * OpenRouter و واردشده به‌صورتِ دستی. بدونِ این، «سودِ کلِ عمر» یعنی درآمدِ دو ماه
 * منهای هزینه‌ی یک هفته؛ با این، همان شکاف با یک عددِ واقعی پر می‌شود. */
export const PRE_TRACK_COST_KEY = 'llm_cost_pretrack_usd';

/** اولین لحظه‌ی درآمدِ واقعی — ابتدای دوره‌ای که لُختِ دستی رویش پخش می‌شود. */
export function firstRevenueSec(botKey) {
  let min = null;
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      const rw = revenueWhere(inst.bot, '0');
      if (!hasTable(db, rw.table)) return;
      const t = scalar(db, `SELECT MIN(${unixOf(moneyOf(inst.bot).createdKind, 'created_at')}) FROM ${rw.table} WHERE ${rw.where}`);
      if (t && (min === null || t < min)) min = t;
    });
  }
  return min;
}

/** اولین لحظه‌ای که هزینه‌ی مدل ثبت شده — مرزِ اعتبارِ هر عددِ تجمعی. */
export function costTrackingSince(botKey) {
  let min = null;
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'llm_usage')) return;
      const t = scalar(db, 'SELECT MIN(created_at) FROM llm_usage');
      if (t && (min === null || t < min)) min = t;
    });
  }
  return min;
}

/* سریِ روزانه‌ی سود روی `days` روزِ اخیر (مرزِ روزِ تهران).
 *
 * `cum` عمداً **از اولین روزِ سری** جمع می‌شود، نه از ابتدای عمرِ ربات: چون هزینه
 * تاریخچه ندارد، هر تجمعی که از قبلِ `costSince` شروع شود سودِ ساختگی می‌سازد.
 * مصرف‌کننده باید بازه را طوری بدهد که داخلِ دوره‌ی ثبتِ هزینه بماند (یا خودش بگوید
 * که بخشی از بازه هزینه ندارد). */
export function profitDaily(botKey, { days = 30, usdToman = 0, campaignUsdPerUser = 0, preTrackUsd = 0 } = {}) {
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 3650);
  const since = tehranDayStart(-(n - 1));
  const day = new Map(); // 'YYYY-MM-DD' → { rev, llmUsd, adUsd }
  const at = (d) => {
    if (!day.has(d)) day.set(d, { rev: 0, llmUsd: 0, adUsd: 0, campaignUsers: 0, orphan: 0 });
    return day.get(d);
  };

  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      /* ── درآمدِ نقدی (تک‌منبعِ revenueWhere: پرداختِ شبیه‌سازی‌شده‌ی tabir خودکار بیرون است) ── */
      const rw = revenueWhere(inst.bot, '?');
      if (hasTable(db, rw.table)) {
        const tExpr = unixOf(moneyOf(inst.bot).createdKind, 'created_at');
        for (const r of rows(db, `SELECT ${tExpr} AS t, ${rw.amountCol} AS a FROM ${rw.table} WHERE ${rw.where}`, [since])) {
          at(tehranDayStr(r.t)).rev += toToman(inst.bot, r.a) || 0;
        }
      }
      /* ── هزینه‌ی مدل ── */
      if (hasTable(db, 'llm_usage')) {
        for (const r of rows(db, 'SELECT created_at AS t, cost_usd AS c FROM llm_usage WHERE created_at >= ?', [since])) {
          at(tehranDayStr(r.t)).llmUsd += Number(r.c) || 0;
        }
      }
      /* ── هزینه‌ی تبلیغ: روزِ **ورودِ** کاربرِ کمپین (لحظه‌ای که پولِ تبلیغ خرج شد) ── */
      if (campaignUsdPerUser > 0 && hasTable(db, 'users')) {
        const admin = hasTable(db, 'events')
          ? new Set(rows(db, "SELECT DISTINCT user_id FROM events WHERE json_extract(props,'$.adm') = 1").map(r => r.user_id))
          : new Set();
        for (const u of rows(db, "SELECT telegram_id AS uid, created_at AS t FROM users WHERE created_at >= ? AND first_source LIKE 'campaign:%'", [since])) {
          if (admin.has(u.uid)) continue;
          const d = at(tehranDayStr(u.t));
          d.campaignUsers += 1;
          d.adUsd += campaignUsdPerUser;
        }
      }
    });
  }

  /* ═══ 🧾 درآمدِ سرگردان ═══
     پولی که کارت‌به‌کارت رسیده ولی کاربر رسیدش را نفرستاده، پس در جدولِ `payments`
     ربات هیچ ردیفی ندارد. اگر این‌جا اضافه نشود، پولِ واقعیِ داخلِ حساب از سود غایب
     می‌ماند. ردیف‌های `resolved_late` عمداً **نمی‌آیند**: پرداختشان حالا از مسیرِ خودِ
     ربات ثبت شده و آوردنشان دوباره‌شماری بود. `orphanRev` جدا نگه داشته می‌شود تا کارت
     بتواند سهمش را صریح نشان بدهد و این عدد هیچ‌وقت بی‌صدا داخلِ درآمد گم نشود. */
  let orphanRev = 0;
  for (const [d, amt] of orphanRevenueByDay(botKey, since)) {
    const cell = at(d);
    cell.rev += amt;
    cell.orphan = (cell.orphan || 0) + amt;
    orphanRev += amt;
  }

  /* ═══ هزینه‌ی دوره‌ی قبل از ثبت، پخش‌شده روی روزهای همان دوره ═══
     ⚠️ نسخه‌ی اول این عدد را کنار می‌گذاشت و بالای کارت یک هشدار می‌نوشت که «۸۲ روز
     از محاسبه خارج شد». آن راه‌حل نبود، اعلامِ مسئله بود: کاربر یک عددِ ناقص می‌دید
     به‌علاوه‌ی یک متنِ نگران‌کننده. حالا لُختِ دلاری روی روزهایی که واقعاً پوشش می‌دهد
     (از اولین روزِ درآمد تا شروعِ ثبتِ خودکار) **یکنواخت** پخش می‌شود، پس هر بازه‌ای
     بدونِ استثنا حساب می‌شود و هیچ هشداری لازم نیست.
     صداقتِ روش: برای بازه‌ای که کلِ آن دوره را در بر می‌گیرد (مثلِ «کل عمر») جمع
     **دقیق** است. فقط بازه‌ای که وسطِ آن دوره بریده شود تقریبی می‌گیرد، و تقریبِ
     یکنواخت تنها انتخابِ ممکن است چون تفکیکِ روزانه‌اش اصلاً وجود ندارد. */
  const pre = Math.max(0, Number(preTrackUsd) || 0);
  if (pre > 0) {
    const trackStart = costTrackingSince(botKey);
    const firstRev = firstRevenueSec(botKey);
    if (trackStart && firstRev && firstRev < trackStart) {
      const d0 = tehranDayNo(firstRev), d1 = tehranDayNo(trackStart);
      const span = Math.max(1, d1 - d0);          // روزهای پوشش‌دادهٔ لُخت (تا روزِ قبل از ثبت)
      const perDay = pre / span;
      for (let d = d0; d < d1; d++) {
        const key = tehranDayStr(d * 86400 + 12 * 3600);
        if (day.has(key) || (d * 86400 >= since - 86400)) at(key).llmUsd += perDay;
      }
    }
  }

  /* قدیمی→جدید، تا `cum` معنیِ «تا این روز» بدهد و نقطه‌ی سربه‌سر درست پیدا شود. */
  const series = [];
  let cum = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = tehranDayStr(tehranDayStart(-i));
    const v = day.get(d) || { rev: 0, llmUsd: 0, adUsd: 0, campaignUsers: 0, orphan: 0 };
    const costUsd = v.llmUsd + v.adUsd;
    const costToman = usdToman ? Math.round(costUsd * usdToman) : 0;
    const net = v.rev - costToman;
    cum += net;
    series.push({ d, orphan: 0, ...v, costUsd, costToman, net, cum });
  }

  const totals = series.reduce((a, r) => ({
    rev: a.rev + r.rev, llmUsd: a.llmUsd + r.llmUsd, adUsd: a.adUsd + r.adUsd,
    costToman: a.costToman + r.costToman, net: a.net + r.net,
    campaignUsers: a.campaignUsers + r.campaignUsers, orphan: a.orphan + (r.orphan || 0),
  }), { rev: 0, llmUsd: 0, adUsd: 0, costToman: 0, net: 0, campaignUsers: 0, orphan: 0 });

  /* نقطه‌ی سربه‌سر = اولین روزی که تجمعی از صفر رد شد و **دیگر برنگشت**.
   * عمداً «اولین باری که مثبت شد» نیست: یک روزِ پرفروش می‌تواند تجمعی را لحظه‌ای مثبت
   * کند و فردا دوباره منفی شود؛ آن نقطه‌ی سربه‌سر نیست، نویز است. */
  let breakEven = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i].cum > 0 && series.slice(i).every(r => r.cum > 0)) { breakEven = series[i].d; break; }
  }

  return {
    series,
    totals,
    breakEven,
    costSince: costTrackingSince(botKey),
    hasRate: !!usdToman,
    // بازه‌ای که هزینه‌اش ثبت نشده = بخشی از سری که سودش خوش‌بینانه است
    seriesStart: tehranDayStr(since),
  };
}

/** خلاصه‌ی «از شروعِ ثبتِ هزینه تا امروز» — عددِ سرخطِ نمای کلی. */
export function profitSinceTracking(botKey, { usdToman = 0, campaignUsdPerUser = 0 } = {}) {
  const start = costTrackingSince(botKey);
  if (!start) return { ok: false, reason: 'no-usage', costSince: null };
  const days = Math.max(1, Math.ceil((nowSec() - start) / 86400) + 1);
  const p = profitDaily(botKey, { days, usdToman, campaignUsdPerUser });
  return { ok: true, ...p, days };
}
