// 📊 گزارشِ شبانه‌ی مالک (v3.140.0 تاروت، خواسته‌ی مالک ۱۴۰۵/۰۷/۰۹).
//
// هر شب ساعتِ ۰۰:۰۰ تهران، خلاصه‌ی **روزِ تمام‌شده**ی تاروتِ فارسی به تلگرامِ مالک می‌رود:
// سود، درآمد، هزینه، کاربرِ فعال/نیو/ریتنشن، فال‌گرفته‌ها و گفتگو با تاروت‌خوان.
//
// ═══ چرا داشبورد می‌سازد و ربات می‌فرستد ═══
// ۱) **سود تک‌منبع دارد** (`profitFor`، بند ۲الف ریشه): هزینه‌ی تبلیغ، نرخِ دلار و پرداختِ
//    سرگردان فقط در `platform.db`ِ داشبوردند. اگر ربات خودش سود را حساب می‌کرد، فرمول دو
//    نسخه می‌شد و عددِ گزارش با عددِ داشبورد دیر یا زود نمی‌خواند.
// ۲) **داشبورد توکنِ ربات ندارد** (عمدی). پس متنِ آماده را در صفِ `admin_actions`ِ ربات
//    می‌گذارد (اکشنِ `owner_report`) و sweepِ ۶۰ثانیه‌ایِ خودِ ربات آن را به OWNER_ID می‌رساند.
//    همان مسیری که تگ و کارت هم از آن می‌روند.
//
// ═══ سرعت (خواسته‌ی صریحِ مالک: «مثل پنل ادمین طول نکشه») ═══
// هر کوئری فقط **بازه‌ی همان روز** را می‌خواند و روی ایندکسِ پوششی می‌نشیند (بدونِ لمسِ
// متنِ سنگینِ فال یا پیامِ گفتگو). ایندکس‌ها را خودِ ربات در بوت می‌سازد
// (`idx_users_created`، `idx_chat_role_day`، `idx_events_ev_user`، `idx_readings_stats`).
// چکِ CI (`tools/check-owner-report.mjs`) پلنِ هر کوئری را روی دیتابیسِ بزرگ می‌سنجد.
//
// ═══ تعریف‌ها (تصمیمِ مالک) ═══
//  • فقط تاروتِ فارسی. حساب‌های ادمین/تستی حذف (همان قراردادِ داشبورد: درآمد بدونِ testUsers،
//    سنجه‌های محصولی بدونِ کاربرانِ `adm:1`).
//  • کاربرِ فعال = هر کسی که آن روز به ربات پیامی داد یا دکمه‌ای زد (رویدادِ `act`)، به‌علاوه‌ی
//    هر کاربرِ تازه‌ی همان روز. نیو یوزر = اولین بارش همان روز بود. ریتنشن = فعال منهای نیو.
//  • فال‌گرفته = فالِ تاروتِ کامل (تحویل‌شده و الماس‌خورده؛ `DONE`ِ مشترکِ `engage.js`).
//  • سؤالِ گفتگو = هر پیامِ کاربر در گفتگو با تاروت‌خوان (`chat_messages.role='user'`).
//  • روز = مرزِ تهران، همان روزی که داشبورد نشان می‌دهد.
// ⚠️ گزارشِ ۰۰:۰۰ رسیدی را که ۲۳:۵۹ آمده و ۰۰:۰۵ تأیید می‌شود هنوز نمی‌بیند؛ داشبورد
// بعداً می‌بیند. این فاصله کوچک و آگاهانه است (مالک ساعتِ ۱۲ را خواست).
import { instancesOf, withDb, withWritableDb, hasTable, rows, adminActionSupported } from './bots.js';
import { profitFor } from './profit.js';
import { DONE } from './engage.js';
import { getSetting, setSetting, audit } from './platform.js';
import { tehranDayStart, tehranDayStr } from './util.js';
import { log, logErr } from '../../../shared/logger.js';

/** رول‌بک: `false` ⟵ هیچ گزارشی ساخته یا صف نمی‌شود. */
export const OWNER_REPORT_ENABLED = true;
export const OWNER_REPORT_BOT = 'tarot';
export const OWNER_REPORT_ACTION = 'owner_report';
const LAST_KEY = 'owner_report_last_day';

/* ═══ شمارش‌های کاربرمحورِ یک روز ═══
 * روی یک اتصالِ فقط-خواندنی. هر شرط بازه‌ی `[d0, d1)` دارد و هیچ‌کدام ستونِ متنیِ سنگین
 * نمی‌خواند. خروجی عدد است نه لیست، ولی لیست‌ها برای حذفِ ادمین و تقاطعِ «نیو» لازم‌اند. */
export const DAY_SQL = {
  admins: "SELECT DISTINCT user_id AS u FROM events WHERE json_extract(props,'$.adm') = 1",
  acted: "SELECT DISTINCT user_id AS u FROM events WHERE event='act' AND created_at >= ? AND created_at < ?",
  joined: 'SELECT telegram_id AS u FROM users WHERE created_at >= ? AND created_at < ?',
  readers: `SELECT DISTINCT r.user_id AS u FROM readings r WHERE ${DONE} AND r.created_at >= ? AND r.created_at < ?`,
  asked: "SELECT user_id AS u, COUNT(*) AS n FROM chat_messages WHERE role='user' AND created_at >= ? AND created_at < ? GROUP BY user_id",
};

export function dayCounts(db, d0, d1) {
  const has = (t) => hasTable(db, t);
  const ids = (sql, p = []) => rows(db, sql, p).map((r) => r.u);
  const admins = new Set(has('events') ? ids(DAY_SQL.admins) : []);
  const keep = (xs) => new Set(xs.filter((u) => !admins.has(u)));
  const joined = keep(has('users') ? ids(DAY_SQL.joined, [d0, d1]) : []);
  const active = keep([...(has('events') ? ids(DAY_SQL.acted, [d0, d1]) : []), ...joined]);
  const readers = keep(has('readings') ? ids(DAY_SQL.readers, [d0, d1]) : []);
  const asked = has('chat_messages') ? rows(db, DAY_SQL.asked, [d0, d1]).filter((r) => !admins.has(r.u)) : [];
  const newReaders = [...readers].filter((u) => joined.has(u)).length;
  const questions = asked.reduce((a, r) => a + r.n, 0);
  return {
    active: active.size,
    newUsers: joined.size,
    retention: active.size - joined.size,
    readers: readers.size,
    newReaders,
    retentionReaders: readers.size - newReaders,
    chatUsers: asked.length,
    questions,
    avgQuestions: asked.length ? questions / asked.length : 0,
  };
}

const fa = (n) => Math.round(Number(n) || 0).toLocaleString('fa-IR');
const fa1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('fa-IR');
const faDate = (d0) => new Date((d0 + 12 * 3600) * 1000).toLocaleDateString('fa-IR',
  { timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

/** متنِ گزارشِ روزی که از `d0` (شروعِ روزِ تهران) شروع می‌شود. */
export function buildOwnerReport(d0, { botKey = OWNER_REPORT_BOT, profit = null } = {}) {
  const d1 = d0 + 86400;
  const day = tehranDayStr(d0);
  const c = { active: 0, newUsers: 0, retention: 0, readers: 0, newReaders: 0, retentionReaders: 0,
    chatUsers: 0, questions: 0, avgQuestions: 0 };
  for (const inst of instancesOf(botKey)) {
    const x = withDb(inst.file, (db) => dayCounts(db, d0, d1), null);
    if (x) for (const k of Object.keys(c)) c[k] += x[k];
  }
  if (c.chatUsers) c.avgQuestions = c.questions / c.chatUsers;
  // سود از **تنها** درِ ورودش. «هفته» روزِ دیروز را در بر دارد حتی چند ساعت بعد از نیمه‌شب.
  const p = profit || profitFor(botKey, 'week');
  const r = p.series.find((s) => s.d === day) || { rev: 0, costToman: 0, net: 0 };
  const money = p.hasRate
    ? [`💰 سود خالص: ${fa(r.net)} تومان`, `📥 درآمد: ${fa(r.rev)} تومان`, `📤 هزینه: ${fa(r.costToman)} تومان`]
    : [`📥 درآمد: ${fa(r.rev)} تومان`, '⚠️ نرخِ دلار در داشبورد ثبت نشده، پس هزینه و سود حساب نشد.'];
  const text = [
    `📊 گزارشِ روزِ ${faDate(d0)}`,
    'تاروت فارسی',
    '',
    ...money,
    '',
    `👥 کاربر فعال (به ربات اومدن): ${fa(c.active)}`,
    `🆕 نیو یوزر: ${fa(c.newUsers)}`,
    `🔁 ریتنشن یوزر: ${fa(c.retention)}`,
    '',
    `🔮 کل فال‌گرفته‌ها: ${fa(c.readers)}`,
    `🆕 نیو یوزرِ فال‌گرفته: ${fa(c.newReaders)}`,
    `🔁 ریتنشن یوزرِ فال‌گرفته: ${fa(c.retentionReaders)}`,
    '',
    `💬 کاربرانِ گفتگو با تاروت‌خوان: ${fa(c.chatUsers)}`,
    `❓ کل سؤال‌ها از تاروت‌خوان: ${fa(c.questions)}`,
    `📈 میانگین سؤال به ازای هر کاربر: ${fa1(c.avgQuestions)}`,
  ].join('\n');
  return { day, text, counts: c, money: { rev: r.rev, cost: r.costToman, net: r.net, hasRate: !!p.hasRate } };
}

/** متن را در صفِ رباتِ مالک می‌گذارد. `false` یعنی هیچ‌جا نوشته نشد (گارد یا خطا). */
export function enqueueOwnerReport(text, botKey = OWNER_REPORT_BOT) {
  let done = false;
  for (const inst of instancesOf(botKey)) {
    // ⚠️ گارد روی **قرارداد**، نه شکلِ جدول (بند ۲الف ریشه): رباتی که اکشن را اعلام نکرده
    // ردیف را بی‌صدا done می‌کرد و گزارش در سکوت گم می‌شد.
    if (!adminActionSupported(inst.bot, OWNER_REPORT_ACTION)) continue;
    withWritableDb(inst.file, (db) => {
      if (!hasTable(db, 'admin_actions')) return;
      db.prepare('INSERT INTO admin_actions (payment_id, action, note) VALUES (0, ?, ?)').run(OWNER_REPORT_ACTION, text);
      done = true;
    });
    if (done) break;          // فقط یک گیرنده: رباتی که مالک از آن پیام می‌گیرد
  }
  return done;
}

/** یک بار per روز: اگر گزارشِ دیروز هنوز صف نشده، بساز و صف کن. idempotent. */
export function runOwnerReport() {
  if (!OWNER_REPORT_ENABLED) return null;
  const d0 = tehranDayStart(-1);
  const day = tehranDayStr(d0);
  if (getSetting(LAST_KEY, '') === day) return null;
  const t0 = Date.now();
  try {
    const rep = buildOwnerReport(d0);
    const ms = Date.now() - t0;
    if (!enqueueOwnerReport(rep.text)) {
      logErr(`❌ OWNER_REPORT_ENQUEUE day=${day}: رباتِ مالک اکشنِ ${OWNER_REPORT_ACTION} را نمی‌پذیرد یا صف نیست`);
      return null;
    }
    // مهر **بعد از** صف‌شدن: شکست هرگز گزارشِ آن شب را بی‌صدا حذف نمی‌کند (دقیقه‌ی بعد دوباره).
    setSetting(LAST_KEY, day);
    audit('owner_report.enqueue', OWNER_REPORT_BOT, `day=${day} ms=${ms}`);
    log(`📊 OWNER_REPORT day=${day} ms=${ms} active=${rep.counts.active} readers=${rep.counts.readers}`);
    return rep;
  } catch (e) {
    logErr(`❌ OWNER_REPORT day=${day}:`, e.stack || e.message);
    return null;
  }
}

/** هر ۶۰ ثانیه چک؛ اولین بار ۲۰ ثانیه بعد از بوت (اگر داشبورد نیمه‌شب خاموش بود، همان وقت می‌رسد). */
export function scheduleOwnerReport() {
  if (!OWNER_REPORT_ENABLED) return;
  setTimeout(runOwnerReport, 20_000);
  setInterval(runOwnerReport, 60_000);
}
