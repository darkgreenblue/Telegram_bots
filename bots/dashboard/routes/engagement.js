// 🔥 درگیری و چسبندگی — «کاربر هر چند وقت یک‌بار برمی‌گردد، و برای چه؟»
//
// دو لایه‌ی مجزا (خواسته‌ی صریحِ مالک)، چون یکی‌کردنشان هر دو را بی‌معنا می‌کند:
//   • لایه‌ی ۱ — **الماس خرج می‌کند**: تنها اکشنی که هم ارزشِ واقعی به کاربر می‌دهد و هم
//     برای ما هزینه/درآمد دارد. سنجه‌ی مرکزیِ محصول.
//   • لایه‌ی ۲ — **اکشنِ مفیدِ رایگان**: کارت روز، کارت شانس، حافظ، … . کم‌ارزش‌تر، ولی
//     نشان می‌دهد کاربر هنوز زنده است و قلاب‌های رایگان کار می‌کنند.
// اگر فقط لایه‌ی ۱ را می‌دیدیم، کاربرِ فعالی که پولش تمام شده «مرده» گزارش می‌شد؛ اگر
// فقط لایه‌ی ۲، هر تپِ رایگان «چسبندگی» حساب می‌شد.
import { instancesOf, withDb, hasTable, scalar, botByKey } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, nowSec, rangeOf, rangeSince, RANGES } from '../lib/util.js';
import { stat, cohortCount, table, cardHead, rangePicker } from '../lib/html.js';
import { hbars, ordinalBars, CAT } from '../lib/charts.js';
import {
  CADENCE_DAYS, CADENCE_MIN_AGE_DAYS, CADENCE_MIN_ACTIVE_DAYS, USEFUL_EVENTS, NEGATIVE_EVENTS,
  READ_BUCKETS, spendCadenceSql, usefulCadenceSql, eligibleUsersSql, negativeUsersSql,
  bucketUsersSql, readerUsersSql, CHAT_EVENTS, chatUsersSql,
} from '../lib/engage.js';

const countOf = (db, q) => (q ? scalar(db, `SELECT COUNT(*) c FROM (${q.sql})`, q.params) : 0);
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** برچسبِ خوانای هر سطلِ کدنس (۱ روز = «هر روز»، ۷ روز = «هفته‌ای یک‌بار»). */
export const cadenceLabel = (n) => (n === 1 ? 'هر روز' : n === 7 ? 'هفته‌ای یک‌بار' : `هر ${fmt(n)} روز`);

function gather(botKey, { winDays }) {
  const now = nowSec();
  const a = {
    eligible: 0, spend: CADENCE_DAYS.map(() => 0), useful: CADENCE_DAYS.map(() => 0),
    negatives: NEGATIVE_EVENTS.map(() => 0), buckets: READ_BUCKETS.map(() => 0),
    readers: 0, streaks: new Map(), usefulByEvent: new Map(),
  };
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      const ev = hasTable(db, 'events');
      a.eligible += countOf(db, eligibleUsersSql(now));
      if (hasTable(db, 'readings')) {
        CADENCE_DAYS.forEach((n, i) => { a.spend[i] += countOf(db, spendCadenceSql(n, now, ev, { windowDays: winDays })); });
        READ_BUCKETS.forEach((_, i) => { a.buckets[i] += countOf(db, bucketUsersSql(i, ev)); });
        a.readers += countOf(db, readerUsersSql(ev));
      }
      if (ev) {
        CADENCE_DAYS.forEach((n, i) => { a.useful[i] += countOf(db, usefulCadenceSql(n, now, ev, { windowDays: winDays })); });
        NEGATIVE_EVENTS.forEach((_, i) => { a.negatives[i] += countOf(db, negativeUsersSql(i, ev)); });
        // کدام قلابِ رایگان بیشتر استفاده می‌شود (کاربرِ یکتا در بازه)
        for (const e of USEFUL_EVENTS) {
          const c = scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE event=? AND created_at >= ?',
            [e, winDays ? now - winDays * 86400 : 0]);
          if (c) a.usefulByEvent.set(e, (a.usefulByEvent.get(e) || 0) + c);
        }
      }
      if (scalar(db, "SELECT COUNT(*) c FROM pragma_table_info('users') WHERE name='daily_streak'")) {
        for (const r of (hasTable(db, 'users') ? db.prepare(`SELECT CASE
              WHEN daily_streak = 0 THEN '۰' WHEN daily_streak = 1 THEN '۱'
              WHEN daily_streak BETWEEN 2 AND 3 THEN '۲ تا ۳'
              WHEN daily_streak BETWEEN 4 AND 6 THEN '۴ تا ۶' ELSE '۷ و بیشتر' END k,
            COUNT(*) c FROM users GROUP BY k`).all() : [])) {
          a.streaks.set(r.k, (a.streaks.get(r.k) || 0) + r.c);
        }
      }
    });
  }
  return a;
}

const EVENT_FA = {
  daily_card: '🎴 کارت روز', lucky_card: '🎲 کارت شانس', product_delivered: '🔮 فال کامل (پولی)',
};

/* ═══ 🗣 آمارِ گفتگوی پس از فال ═══
   شرطِ کاربرمحور از `lib/engage.js` می‌آید (تک‌منبع، تا عدد و لیست واگرا نشوند)؛ این‌جا
   فقط شمارشِ **رخداد** و عمقِ گفتگو اضافه می‌شود که کاربرمحور نیستند.

   ⚠️ عمقِ گفتگو از جدولِ `chat_messages` می‌آید نه از رویدادها: آن جدول رکوردِ قطعیِ
   فیچر است و اگر روزی رویدادی جا بیفتد، عمق همچنان درست می‌ماند. */
function chatStats(botKey, since) {
  const a = {
    users: CHAT_EVENTS.map(() => 0), hits: CHAT_EVENTS.map(() => 0),
    thinRefunded: 0, thinFree: 0, turns: [], any: false,
  };
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events')) return;
      CHAT_EVENTS.forEach((c, i) => {
        a.users[i] += countOf(db, chatUsersSql(i, since));
        a.hits[i] += scalar(db, 'SELECT COUNT(*) c FROM events WHERE event=? AND created_at >= ?', [c.event, since]);
      });
      a.thinRefunded += scalar(db,
        "SELECT COUNT(*) c FROM events WHERE event='chat_thin' AND created_at >= ? AND json_extract(props,'$.refunded') = 1", [since]);
      a.thinFree += scalar(db,
        "SELECT COUNT(*) c FROM events WHERE event='chat_thin' AND created_at >= ? AND json_extract(props,'$.free') = 1", [since]);
      if (hasTable(db, 'chat_messages')) {
        for (const r of db.prepare(
          `SELECT COUNT(*) n FROM chat_messages WHERE role='user' AND created_at >= ?
           GROUP BY reading_id`).all(since)) a.turns.push(r.n);
      }
    });
  }
  a.any = a.hits.some((n) => n > 0) || a.turns.length > 0;
  return a;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};

export function engagementBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  if (!instancesOf(bot).length) {
    return `<div class="card"><h2>🔥 درگیری و چسبندگی</h2><p class="muted">دیتابیسِ این ربات پیدا نشد.</p></div>`;
  }
  // پنجره‌ی مشاهده‌ی کدنس: «عادت» را در چه بازه‌ای می‌سنجیم
  const rk = rangeOf(url, 'rCad', 'month');
  const winDays = RANGES[rk].days;
  const a = gather(bot, { winDays });

  const cadRow = (vals, layer) => CADENCE_DAYS.map((n, i) => stat(
    cadenceLabel(n),
    cohortCount(vals[i], { k: 'tarot', bot, t: 'cadence', layer, n: String(n), win: String(winDays) })
      + ` <span class="muted">${fmt(pctOf(vals[i], a.eligible))}٪</span>`,
  )).join('');

  const layer1 = `<div class="card">
    ${cardHead('💎 لایه ۱ — هر چند روز یک‌بار الماس خرج می‌کند؟', rangePicker(url, 'rCad', rk, { label: 'پنجره‌ی سنجش' }))}
    <div class="grid">${cadRow(a.spend, 'spend')}</div>
    <div style="margin-top:14px">${ordinalBars(CADENCE_DAYS.map((n, i) => ({ label: cadenceLabel(n), value: a.spend[i] })))}</div>
    <p class="muted" style="margin-top:10px">
      «حداقل هر N روز یک‌بار» یعنی در کلِ پنجره‌ی سنجش <b>هیچ وقفه‌ای بیشتر از N روز</b> نداشته،
      و از آخرین خرجش هم بیشتر از N روز نگذشته. عمداً «بیشترین وقفه» ملاک است نه میانگین:
      کاربری که ده روز پیاپی بیاید و بعد بیست روز غیبش بزند میانگینِ خوبی دارد ولی عادتش مرده.
      سطل‌ها <b>تجمعی</b>‌اند (هر روز ⊂ هر ۲ روز ⊂ …). فقط کاربرانی شمرده می‌شوند که
      حداقل ${fmt(CADENCE_MIN_AGE_DAYS)} روز از عضویتشان گذشته (${fmt(a.eligible)} نفر) و حداقل
      ${fmt(CADENCE_MIN_ACTIVE_DAYS)} روزِ متفاوت فعال بوده‌اند — یک اکشنِ تکی عادت نیست.</p></div>`;

  const layer2 = `<div class="card">
    ${cardHead('🎁 لایه ۲ — هر چند روز یک‌بار اکشنِ مفید انجام می‌دهد؟')}
    <div class="grid">${cadRow(a.useful, 'useful')}</div>
    <div style="margin-top:14px">${ordinalBars(CADENCE_DAYS.map((n, i) => ({ label: cadenceLabel(n), value: a.useful[i] })), { color: CAT[2] })}</div>
    <p class="muted" style="margin-top:10px">«اکشنِ مفید» = ${USEFUL_EVENTS.map(e => esc(EVENT_FA[e] || e)).join(' · ')}.
      عمداً یک <b>لیستِ سفید</b> است نه «هر رویدادی بجز منفی‌ها»: واژه‌نامه پر از رویدادهایی است که خودِ ربات
      می‌سازد (یادآوری، هدیه، پی‌وال) و با لیستِ سیاه، هر رویدادِ سیستمیِ جدیدی که فردا اضافه شود
      بی‌صدا این عدد را باد می‌کرد. همان پنجره‌ی سنجشِ کارتِ بالا اعمال می‌شود.</p></div>`;

  const hooks = a.usefulByEvent.size ? `<div class="card">
    ${cardHead('🪝 کدام قلاب بیشتر کار می‌کند؟')}
    ${hbars([...a.usefulByEvent.entries()].sort((x, y) => y[1] - x[1])
      .map(([e, v]) => ({ label: EVENT_FA[e] || e, value: v })))}
    <p class="muted">کاربرِ یکتا در پنجره‌ی «${esc(RANGES[rk].label)}». یک کاربر می‌تواند در چند ردیف باشد.</p></div>` : '';

  const negative = `<div class="card">
    ${cardHead('🚫 سیگنال‌های منفی')}
    <div class="grid">${NEGATIVE_EVENTS.map((n, i) => stat(n.label,
      cohortCount(a.negatives[i], { k: 'tarot', bot, t: 'negative', i: String(i) }))).join('')}</div>
    <p class="muted" style="margin-top:8px">این‌ها از سنجه‌های بالا <b>حذف</b> شده‌اند و فقط این‌جا شمرده می‌شوند.
      ⚠️ صادقانه: <b>بلاک‌کردنِ ربات ثبت نمی‌شود</b> — تلگرام موقع بلاک فقط به ارسالِ بعدی خطای ۴۰۳ می‌دهد و
      رویدادی در دیتابیس نمی‌نشیند. تا وقتی خودِ ربات آن خطا را به‌عنوان یک رویداد ثبت نکند، این عدد را
      نداریم و از خودمان نمی‌سازیمش.</p></div>`;

  const depth = `<div class="card">
    ${cardHead('🎯 عمقِ استفاده (چند فالِ کامل per کاربر)')}
    ${ordinalBars(READ_BUCKETS.map((b, i) => ({ label: b.label, value: a.buckets[i] })))}
    <div class="grid" style="margin-top:12px">
      ${READ_BUCKETS.map((b, i) => stat(b.label, cohortCount(a.buckets[i], { k: 'tarot', bot, t: 'bucket', i: String(i) }))).join('')}
    </div>
    <p class="muted">از ${fmt(a.readers)} کاربری که حداقل یک فالِ کامل گرفته‌اند.</p></div>`;

  /* 🗣 گفتگوی پس از فال — و مهم‌ترین عددش «جوابِ زیرِ کفِ محتوا» است.
     خواسته‌ی صریحِ مالک (۱۴۰۵/۰۶/۱۹): «آن را به بخشِ آمارِ چتِ داشبورد اضافه کن و زیر
     نظر بگیر که آیا بالا می‌رود.» کارت فقط وقتی رندر می‌شود که واقعاً رویدادی هست، پس
     برای رباتی که گفتگو ندارد صفحه بیت‌به‌بیت مثلِ قبل است. */
  const rChatK = rangeOf(url, 'rChat', 'month');
  const chatSince = rangeSince(rChatK);
  const c = chatStats(bot, chatSince);
  const accept = pctOf(c.users[1], c.users[0]);          // باز کردن ÷ دیدنِ پیشنهاد
  const thinRate = pctOf(c.hits[3], c.hits[2]);          // جوابِ لاغر ÷ کلِ جواب‌ها
  const chat = c.any ? `<div class="card">
    ${cardHead('🗣 گفتگوی پس از فال', rangePicker(url, 'rChat', rChatK))}
    <div class="grid">
      ${CHAT_EVENTS.map((e, i) => stat(e.label,
        cohortCount(c.users[i], { k: 'tarot', bot, t: 'chat', i: String(i), since: String(chatSince) })
        + ` <span class="muted">${fmt(c.hits[i])} بار</span>`)).join('')}
    </div>
    <div class="grid" style="margin-top:12px">
      ${stat('نرخِ پذیرشِ گفتگو', `${fmt(accept)}٪`)}
      ${stat('میانه‌ی عمق (سؤال per گفتگو)', fmt(median(c.turns)))}
      ${stat('🪫 نرخِ جوابِ زیرِ کف', `${fmt(thinRate)}٪`)}
      ${stat('🪫 از آن‌ها الماس برگشت', `${fmt(c.thinRefunded)} از ${fmt(c.hits[3])}`)}
    </div>
    <p class="muted" style="margin-top:10px">
      <b>«جوابِ زیرِ کفِ محتوا»</b> یعنی جوابِ مدل حتی بعد از یک تلاشِ دوباره هم کوتاه‌تر از
      کفِ اعلام‌شده بود؛ در آن حالت الماسِ آن سؤال <b>برمی‌گردد</b> و کاربر هیچ پیامِ اضافه‌ای
      نمی‌بیند. این عدد سنجه‌ی اصلیِ کیفیتِ گفتگوست: <b>اگر بالا برود یعنی مکانیزمِ تلاشِ
      دوباره دارد شکست می‌خورد</b>، نه اینکه کاربر بد سؤال می‌پرسد.
      ${c.thinFree ? `از این‌ها ${fmt(c.thinFree)} مورد سؤالِ <b>رایگانِ</b> اول بود (چیزی برای برگشتن نداشت).` : ''}
      «${fmt(c.hits[3])} بار» شمارشِ رخداد است و عددِ کنارش کاربرِ یکتا.</p>
    <p class="muted" style="margin-top:6px">⚠️ <b>ادمین در این کارت حذف نشده، عمداً.</b>
      گفتگو هنوز فقط-ادمین است، پس تنها کسانی که این رویدادها را می‌سازند خودِ ادمین و
      تسترند و با فیلترِ ادمین هر شش عدد صفر می‌شد. لحظه‌ی باز شدن برای همه‌ی کاربران،
      فیلتر در یک PR جدا اضافه می‌شود.</p></div>` : '';

  const streak = a.streaks.size ? `<div class="card">
    ${cardHead('🎴 عادتِ روزانه (استریکِ کارت روز)')}
    ${hbars([...a.streaks.entries()].map(([label, value]) => ({ label, value })))}
    <p class="muted">استریک = روزهای پیاپی که کاربر کارتِ روزش را گرفته؛ ارزان‌ترین قلابِ بازگشتِ ربات.</p></div>` : '';

  return `<div class="card"><h2 style="margin:0">🔥 درگیری و چسبندگی — ${esc(title)}</h2>
      <p class="muted" style="margin:6px 0 0">دو لایه‌ی مجزا: چسبندگیِ <b>پولی</b> (الماس) و چسبندگیِ
        <b>رایگان</b> (اکشن‌های مفید). هر عدد با یک کلیک لیستِ همان کاربران را باز می‌کند.</p></div>
    ${layer1}${layer2}${hooks}${chat}${negative}${depth}${streak}`;
}
