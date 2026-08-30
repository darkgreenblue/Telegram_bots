// lib/journey.js — کوئری‌های «مسیرِ ریزِ کاربر» (رویدادهای view/act که shared/journey.js می‌نویسد).
//
// سه سؤالی که این فایل جواب می‌دهد:
//   ۱) بین دو مرحله‌ی قیف، کاربر دقیقاً چه پیام‌هایی دید و چه دکمه‌هایی زد، و کجا ریخت؟  microSteps
//   ۲) کسانی که دیگر برنگشتند، آخرین چیزی که دیدند/زدند چه بود؟                          exitPoints
//   ۳) هر پیامِ ربات چقدر نشان داده شده و چند درصد بعدش اقدامی کردند؟                     screensReport
//
// قواعد امنیتیِ داشبورد این‌جا هم برقرار است: هیچ رشته‌ای از URL داخل SQL نمی‌رود؛ نام ستون/جدول
// از پروفایلِ lib/bots.js می‌آید و هر مقدارِ ورودی bound parameter است.
//
// نکته: رویدادهای ادمین با prop `adm:1` تگ شده‌اند و به‌صورت پیش‌فرض از همه‌ی این گزارش‌ها حذف
// می‌شوند (تستِ خودِ مالک نباید قیف را آلوده کند). با includeAdmin=true برمی‌گردند.
import { instancesOf, withDb, hasTable, rows, userPk } from './bots.js';
import { CHANNELS, verCond } from './funnels-def.js';

// فاصله‌ی بیش از این بین دو رویداد = سشنِ جدید (کاربر رفته و بعداً برگشته)
export const SESSION_GAP_S = 30 * 60;
// «دیگر برنگشت» = آخرین فعالیتش از این مدت قبل‌تر بوده (وگرنه شاید همین الان وسط فلوست)
export const EXIT_IDLE_S = 24 * 3600;
// پنجره‌ای که در آن یک اکشن بعد از دیدنِ پیام «پاسخ به همان پیام» شمرده می‌شود
const ACT_WINDOW_S = 30 * 60;

// کلیدِ نمایشیِ یک رویدادِ ریز: view → props.k ، act → props.a
// (export شده تا lib/cohorts.js هم دقیقاً همین شرط را بسازد؛ وگرنه عدد و لیستِ کاربرانش از هم می‌پاشند)
export const KEY_EXPR = (t = 'e') => `COALESCE(json_extract(${t}.props,'$.k'), json_extract(${t}.props,'$.a'), '')`;
/* حذفِ ادمین‌ها از همه‌ی گزارش‌ها (تستِ خودِ مالک نباید قیف را آلوده کند).
   تگِ adm فقط روی رویدادهای ریز نوشته می‌شود، ولی مرحله‌های milestone (start/paywall_shown/…) آن را
   ندارند؛ پس به‌جای «رویدادِ بدونِ تگ»، **کاربرِ ادمین** را کنار می‌گذاریم تا عددِ مرحله و عددِ
   قدم‌های ریزش از یک جمعیت حساب شوند (وگرنه درصدها بی‌معنا می‌شدند). */
export const notAdmin = (t = 'e') =>
  `${t}.user_id NOT IN (SELECT user_id FROM events WHERE json_extract(props,'$.adm') = 1)`;

/* ═══ کاتالوگِ صفحه‌ها: کلید → متنِ واقعیِ پیام (تا داشبورد هشِ کور نشان ندهد) ═══ */
export function screenMap(botKey) {
  const map = new Map();
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'screens')) return;
      for (const r of rows(db, 'SELECT k, label, kind, sample, buttons FROM screens')) {
        if (!map.has(r.k)) map.set(r.k, r);
      }
    });
  }
  return map;
}

/* ═══ متنِ صفحه برای نمایش — چرا اعداد ماسک می‌شوند ═══
   کلیدِ صفحه عمداً اعداد را حذف می‌کند (تا یک صفحه برای همه‌ی کاربران یک کلید بدهد)، ولی
   `screens.sample` با `INSERT OR IGNORE` **فقط یک‌بار** نوشته می‌شود: متنِ اولین کاربری که
   آن صفحه را دید. یعنی عددِ داخلِ نمونه مالِ آن کاربرِ اول است، نه کاربری که داریم تایم‌لاینش
   را می‌خوانیم.

   باگِ واقعی (۱۴۰۵/۰۵/۱۳): در تایم‌لاینِ کاربر ۱۰۴۳۰۷۴۴۶۷ فاکتور «۱۰۰٬۰۰۰ تومان» نشان داده
   شد در حالی که فاکتورِ واقعیِ او ۴۰٬۰۰۰ بود (نمونه از کاربرِ ۳۱ جولای مانده بود). مالک آن را
   باگِ پرداخت فهمید؛ پول سالم بود، **نمایش** دروغ می‌گفت. این دقیقاً همان جایی است که تحلیلِ
   جرنی رویش تصمیم می‌گیرد، پس عددِ گمراه‌کننده بدتر از نبودنِ عدد است.

   درمان: عدد را با `⋯` ماسک می‌کنیم. مبلغِ واقعی همیشه از جدولِ `payments` خوانده می‌شود
   (تایم‌لاین همان را جدا نشان می‌دهد)، پس هیچ اطلاعاتِ درستی از دست نمی‌رود. */
const maskNums = (s) => String(s ?? '').replace(/[0-9۰-۹٠-٩][0-9۰-۹٠-٩,،٬.]*/g, '⋯');

/* متنِ خوانای یک صفحه: برچسبِ دستی (ctx.step) اگر هست، وگرنه نمونه‌ی ماسک‌شده. */
export function screenText(s, key, maxLen = 90) {
  if (s?.label) return s.label;
  const sample = maskNums((s?.sample || '').replace(/\s+/g, ' ').trim());
  return sample.slice(0, maxLen) || `صفحه ${key}`;
}

/* برچسبِ خوانای یک قدمِ ریز برای نمایش در جدول.
   سه جنسِ ردیف: پیامِ ربات (view)، اکشنِ کاربر (act)، و رویدادِ milestone (هر نامِ دیگر —
   فقط در گزارشِ خروج دیده می‌شود، چون «آخرین ردپا» می‌تواند یک رویدادِ قیف باشد). */
export function stepLabel(ev, key, screens) {
  if (ev === 'act') {
    return { icon: '👆', text: ACT_LABELS[key] || key || 'اکشن', kind: 'act', note: ACT_NOTES[key] || '' };
  }
  if (ev && ev !== 'view') {
    return { icon: '🏁', text: EVENT_LABELS[ev]?.text || ev, kind: 'event', note: EVENT_LABELS[ev]?.note || '' };
  }
  if (key === 'content') return { icon: '📄', text: 'متنِ محتوا (خروجی مدل)', kind: 'content' };
  const s = screens.get(key);
  return {
    icon: '💬',
    text: screenText(s, key),
    kind: 'view',
    full: maskNums((s?.sample || '').replace(/\s+/g, ' ').trim()),
    buttons: s?.buttons || '',
  };
}

// برچسبِ فارسیِ اکشن‌های عمومی؛ بقیه با خودِ کلیدِ callback نمایش داده می‌شوند (که خوانا هستند)
const ACT_LABELS = {
  cmd: 'دستور', kb: 'دکمه‌ی منوی پایین', text: 'نوشتنِ متن',
  voice: 'فرستادنِ ویس', photo: 'فرستادنِ عکس', doc: 'فرستادنِ فایل', inline: 'اشتراک‌گذاری اینلاین',
  my_chat_member: 'بلاک/آنبلاک کردنِ ربات',
};
const ACT_NOTES = {
  my_chat_member: 'آپدیتِ سرویسیِ تلگرام، نه اقدامی داخلِ ربات. وقتی آخرین ردپا باشد یعنی کاربر ربات را بلاک کرده. «قدمِ قبلی» می‌گوید چه چیزی او را به این‌جا رساند.',
};

/* ═══ برچسبِ رویدادهای قیف ═══
   بدونِ این نگاشت، گزارشِ خروج نامِ خامِ کد را نشان می‌دهد و خواننده باید سورس بخواند تا
   بفهمد کاربر چه دیده. باگِ واقعیِ ۹ شهریور ۱۴۰۵: صدرِ جدولِ ریزش `ab_exposure` و
   `my_chat_member` بود و هیچ‌کدام «صفحه» نبودند، پس گزارش عملاً کور بود.
   فقط رویدادهای مشترکِ shared/analytics.js + دو یادآوریِ push این‌جا نام دارند؛ بقیه با
   نامِ خودشان می‌آیند (که snake_case و نسبتاً خوانا است). */
export const EVENT_LABELS = {
  start: { text: 'استارت زد' },
  onboard_done: { text: 'آنبوردینگ را تمام کرد' },
  first_value: { text: 'اولین ارزش را گرفت' },
  paywall_shown: { text: 'پی‌وال را دید' },
  recharge_started: { text: 'شارژ را شروع کرد' },
  receipt_submitted: { text: 'رسید فرستاد' },
  payment_approved: { text: 'پرداختش تأیید شد' },
  payment_rejected: { text: 'پرداختش رد شد' },
  product_delivered: { text: 'محصول تحویل گرفت' },
  refund: { text: 'جبرانِ خودکار گرفت' },
  feedback: { text: 'بازخورد داد' },
  reset: { text: 'حسابش را ریست کرد' },
  ab_exposure: {
    text: 'واردِ آزمایشِ A/B شد',
    note: 'یک رویدادِ **داخلی** است، نه پیامی که کاربر دیده باشد. اگر بالای این جدول باشد یعنی جایی شاخه‌ی آزمایش حساب شده ولی پیامِ متناظرش رویدادی ثبت نکرده؛ آن پیام را باید ثبت‌پذیر کرد.',
  },
  night_reminder_sent: { text: 'یادآوریِ شبانه برایش رفت', note: 'پیامِ push ساعت ۲۲؛ کاربر آن را دید و دیگر برنگشت.' },
  lucky_reminder_sent: { text: 'یادآوریِ کارتِ شانس برایش رفت', note: 'پیامِ push؛ کاربر آن را دید و دیگر برنگشت.' },
};

/* شرطِ مشترکِ چنل/نسخه/ادمین (همان قراردادِ صفحه‌ی فانل‌ها) */
function slice({ ch = 0, ver = '', includeAdmin = false }) {
  const ci = Math.min(CHANNELS.length - 1, Math.max(0, Number(ch) || 0));
  const v = verCond(ver);
  return {
    cond: `${CHANNELS[ci][1]} AND ${v.cond}${includeAdmin ? '' : ` AND ${notAdmin('e')}`}`,
    params: v.params,
    label: CHANNELS[ci][0],
  };
}

/* ═══ ۱) قدم‌های ریزِ بینِ دو مرحله‌ی قیف ═══
   برای کاربرانی که به مرحله‌ی stageEv رسیده‌اند: همه‌ی view/act هایی که **بعد از اولین** stageEv و
   **قبل از اولین** nextEv انجام داده‌اند (اگر هرگز به nextEv نرسیدند، تا آخرین رویدادشان).
   ترتیبِ قدم‌ها از خودِ دیتا کشف می‌شود (میانگینِ جایگاهشان در مسیرِ کاربران)، نه از لیستِ دستی —
   برای همین هیچ پیامِ جدیدی در آینده از قیف جا نمی‌ماند. */
export function microSteps(botKey, { stageEv, nextEv = '', since = 0, ch = 0, ver = '', includeAdmin = false } = {}) {
  const s = slice({ ch, ver, includeAdmin });
  const pk = userPk(botKey);
  const agg = new Map(); // key -> { ev, k, users, hits, ordSum }
  let stageUsers = 0;

  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events') || !hasTable(db, 'users')) return;
      const sql = `
        WITH st AS (SELECT user_id, MIN(id) sid FROM events WHERE event=? AND created_at>=? GROUP BY user_id),
             nx AS (SELECT user_id, MIN(id) nid FROM events WHERE event=? AND created_at>=? GROUP BY user_id),
             win AS (
               SELECT e.user_id uid, e.event ev, ${KEY_EXPR('e')} kk,
                      ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.id) rn
               FROM events e
               JOIN st ON st.user_id = e.user_id
               LEFT JOIN nx ON nx.user_id = e.user_id
               JOIN users u ON u.${pk} = e.user_id
               WHERE e.event IN ('view','act')
                 AND e.id > st.sid AND (nx.nid IS NULL OR e.id < nx.nid)
                 AND e.created_at >= ? AND ${s.cond}
             )
        SELECT ev, kk, COUNT(DISTINCT uid) users, COUNT(*) hits, SUM(rn) ordSum
        FROM win GROUP BY ev, kk`;
      for (const r of rows(db, sql, [stageEv, since, nextEv, since, since, ...s.params])) {
        const id = `${r.ev}|${r.kk}`;
        const cur = agg.get(id) || { ev: r.ev, k: r.kk, users: 0, hits: 0, ordSum: 0 };
        cur.users += r.users; cur.hits += r.hits; cur.ordSum += r.ordSum;
        agg.set(id, cur);
      }
      // پایه‌ی درصدها: کاربرانی که اصلاً به این مرحله رسیدند
      stageUsers += rows(db, `SELECT COUNT(DISTINCT e.user_id) c FROM events e JOIN users u ON u.${pk} = e.user_id
        WHERE e.event=? AND e.created_at>=? AND ${s.cond}`, [stageEv, since, ...s.params])[0]?.c || 0;
    });
  }

  const list = [...agg.values()]
    .map(r => ({ ...r, ord: r.hits ? r.ordSum / r.hits : 0 }))
    .sort((a, b) => a.ord - b.ord);
  // افت = نسبت به قدمِ ریزِ قبلی در همین ترتیب (همان قراردادِ جدولِ قیفِ اصلی)
  list.forEach((r, i) => { r.drop = i > 0 ? Math.max(0, list[i - 1].users - r.users) : 0; });
  return { steps: list, stageUsers, channel: s.label };
}

/* ═══ ۲) نقاطِ خروج: کسانی که دیگر برنگشتند، آخرین کارشان چه بود؟ ═══
   هر ردیف **قدمِ قبلی**اش را هم می‌آورد: پرتکرارترین رویدادی که بلافاصله قبل از آخرین ردپا
   آمده. چرا لازم است: بعضی «آخرین ردپا»ها خودشان علت نیستند، فقط درِ خروجی‌اند (بلاک‌کردنِ
   ربات، یا یک رویدادِ داخلی مثل exposure). علتِ واقعی همیشه یک قدم عقب‌تر است، و بدونِ این
   ستون باید برای هر ردیف دستی تایم‌لاینِ کاربران را باز کرد. */
export function exitPoints(botKey, { since = 0, ch = 0, ver = '', includeAdmin = false, limit = 25, now = 0 } = {}) {
  const s = slice({ ch, ver, includeAdmin });
  const pk = userPk(botKey);
  const idleBefore = (now || Math.floor(Date.now() / 1000)) - EXIT_IDLE_S;
  const agg = new Map();
  const blocks = new Map(); // وضعیتِ my_chat_member (kicked|member|…) → تعداد

  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events') || !hasTable(db, 'users')) return;
      /* یک کوئری هم شمارشِ ردیف را می‌دهد هم قدمِ قبلی را. `LEFT JOIN` عمدی است: کاربری که
         هیچ رویدادِ قبلی ندارد (اولین و آخرین ردپایش یکی است) نباید از شمارش بیفتد، وگرنه
         عددِ این جدول با لیستِ کوهورتِ پشتش یکی نمی‌ماند (قراردادِ «هیچ عددی بن‌بست نیست»). */
      const sql = `
        WITH last AS (SELECT user_id, MAX(id) mid FROM events WHERE created_at>=? GROUP BY user_id),
             ex AS (
               SELECT e.user_id uid, e.id eid, e.event ev, ${KEY_EXPR('e')} kk
               FROM events e
               JOIN last ON last.mid = e.id
               JOIN users u ON u.${pk} = e.user_id
               WHERE e.created_at < ? AND ${s.cond}
             ),
             pv AS (
               SELECT ex.ev ev, ex.kk kk, p.event pev, ${KEY_EXPR('p')} pkk,
                      ROW_NUMBER() OVER (PARTITION BY ex.uid ORDER BY p.id DESC) rn
               FROM ex LEFT JOIN events p ON p.user_id = ex.uid AND p.id < ex.eid
             )
        SELECT ev, kk, COALESCE(pev,'') pev, COALESCE(pkk,'') pkk, COUNT(*) n
        FROM pv WHERE rn = 1 GROUP BY ev, kk, pev, pkk`;
      for (const r of rows(db, sql, [since, idleBefore, ...s.params])) {
        const id = `${r.ev}|${r.kk}`;
        const cur = agg.get(id) || { ev: r.ev, k: r.kk, n: 0, prevs: new Map() };
        cur.n += r.n;
        if (r.pev) {
          const pid = `${r.pev}|${r.pkk}`;
          cur.prevs.set(pid, (cur.prevs.get(pid) || 0) + r.n);
        }
        agg.set(id, cur);
      }
      /* تفکیکِ بلاک از آنبلاک. عمداً یک کوئریِ جداست و در کلیدِ گروه‌بندی نمی‌نشیند: کلیدِ
         گروه (KEY_EXPR) بین این گزارش و lib/cohorts.js مشترک است و دست‌زدن به آن، عدد را از
         لیستِ کاربرانِ پشتش جدا می‌کند. */
      for (const r of rows(db, `
        SELECT COALESCE(json_extract(e.props,'$.d'),'') st, COUNT(*) n
        FROM events e
        JOIN (SELECT user_id, MAX(id) mid FROM events WHERE created_at>=? GROUP BY user_id) last ON last.mid = e.id
        JOIN users u ON u.${pk} = e.user_id
        WHERE e.created_at < ? AND e.event='act'
          AND json_extract(e.props,'$.a')='my_chat_member' AND ${s.cond}
        GROUP BY st`, [since, idleBefore, ...s.params])) {
        blocks.set(r.st, (blocks.get(r.st) || 0) + r.n);
      }
    });
  }
  const list = [...agg.values()]
    .map((r) => {
      const top = [...r.prevs.entries()].sort((a, b) => b[1] - a[1])[0];
      const [pev, pkk] = top ? top[0].split('|') : ['', ''];
      return { ev: r.ev, k: r.k, n: r.n, prev: top ? { ev: pev, k: pkk, n: top[1] } : null };
    })
    .sort((a, b) => b.n - a.n);
  const total = list.reduce((t, r) => t + r.n, 0);
  return { list: list.slice(0, limit), total, idleBefore, blocks };
}

/* ═══ ۳) گزارشِ صفحه‌ها: هر پیام چقدر دیده شده و چند درصد بعدش اقدام کردند ═══
   «نرخ عبور» پایین = پیامی که کاربر را متوقف می‌کند → لیستِ اولویت‌دارِ چیزهایی که باید بهتر شوند. */
export function screensReport(botKey, { since = 0, includeAdmin = false } = {}) {
  const agg = new Map();
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events')) return;
      const sql = `
        SELECT k, COUNT(*) imps, COUNT(DISTINCT uid) users,
               SUM(CASE WHEN na IS NOT NULL THEN 1 ELSE 0 END) acted,
               SUM(CASE WHEN na IS NOT NULL THEN na - ts ELSE 0 END) secSum
        FROM (
          SELECT json_extract(e.props,'$.k') k, e.user_id uid, e.created_at ts,
                 (SELECT MIN(a.created_at) FROM events a
                   WHERE a.user_id = e.user_id AND a.event='act'
                     AND a.id > e.id AND a.created_at <= e.created_at + ${ACT_WINDOW_S}) na
          FROM events e
          WHERE e.event='view' AND e.created_at >= ?${includeAdmin ? '' : ` AND ${notAdmin('e')}`}
        ) GROUP BY k`;
      for (const r of rows(db, sql, [since])) {
        if (!r.k) continue;
        const cur = agg.get(r.k) || { k: r.k, imps: 0, users: 0, acted: 0, secSum: 0 };
        cur.imps += r.imps; cur.users += r.users; cur.acted += r.acted; cur.secSum += r.secSum;
        agg.set(r.k, cur);
      }
    });
  }
  return [...agg.values()].map(r => ({
    ...r,
    pass: r.imps ? r.acted / r.imps : 0,
    avgSec: r.acted ? Math.round(r.secSum / r.acted) : null,
  }));
}

/* ═══ ۴) سشن‌های یک کاربر ═══
   سشن = رویدادهای پشت‌سرهم با فاصله‌ی کمتر از SESSION_GAP_S. عمداً در زمانِ **خواندن** حساب
   می‌شود (نه ستونی در DB): صفر ریسکِ schema، صفر هزینه‌ی نوشتن، و آستانه هر وقت لازم شد
   بدونِ مهاجرتِ دیتا عوض می‌شود. ورودی: آیتم‌ها به ترتیبِ صعودیِ زمان (ts یا created_at). */
export function groupSessions(items) {
  const at = (e) => e.ts ?? e.created_at ?? 0;
  const out = [];
  let cur = null;
  for (const e of items) {
    if (!cur || at(e) - cur.end > SESSION_GAP_S) {
      cur = { start: at(e), end: at(e), items: [] };
      out.push(cur);
    }
    cur.end = at(e);
    cur.items.push(e);
  }
  return out.reverse(); // جدیدترین سشن اول (داخلِ هر سشن، ترتیبِ وقوع حفظ می‌شود)
}
