// نمای کلی: وضعیت هر ربات (کاربر/فعال/درآمد به وقت تهران) + سلامت عملیاتی (صف رسید، حجم DB)
import { instancesOf, withDb, hasTable, scalar, rows, dbSizes, userCreatedExpr, moneyOf, revenueWhere, toToman, botByKey } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { tehranDayStart, nowSec, fmt, esc } from '../lib/util.js';
import { stat, cohortCount } from '../lib/html.js';
import { EVENTS } from '../../../shared/analytics.js';
import { FUNNELS } from '../lib/funnels-def.js';

// واژه‌نامه‌ی شناخته‌شده: هسته‌ی EVENTS + رویدادهای اختصاصی تعریف‌شده در فانل‌ها + موارد ثبت‌شده‌ی معلوم
const KNOWN_EVENTS = new Set([
  ...Object.values(EVENTS),
  ...Object.values(FUNNELS).flatMap(f => [...(f.steps || []), ...(f.payment || [])].map(([ev]) => ev)),
  'daily_card',
]);

const mb = (bytes) => (bytes / 1048576).toFixed(1);

export function overviewBody(url) {
  // داشبورد per ربات است: فقط instanceهای رباتِ انتخاب‌شده (منوی کشوییِ بالای منو)
  const bot = scopeBot(url);
  const today = tehranDayStart();
  const week = tehranDayStart(-6);
  const month = nowSec() - 30 * 86400;
  const insts = instancesOf(bot);
  if (!insts.length) return `<div class="card"><h2>${esc(botByKey(bot)?.title || bot)}</h2>`
    + `<p class="muted">برای این ربات دیتابیسی پیدا نشد. این صفحه روی سرور (کنار دیتابیس ربات‌ها) معنا دارد.</p></div>`;

  let out = '';
  for (const inst of insts) {
    const s = withDb(inst.file, (db) => {
      const ev = hasTable(db, 'events');
      const m = moneyOf(inst.bot);
      const pay = hasTable(db, m.table);
      const uCreated = userCreatedExpr(inst.bot);
      const rw = revenueWhere(inst.bot);
      const rev = (since) => toToman(inst.bot, scalar(db, `SELECT COALESCE(SUM(${rw.amountCol}),0) s FROM ${rw.table} WHERE ${rw.where}`, [since]));
      return {
        users: scalar(db, 'SELECT COUNT(*) c FROM users'),
        newToday: scalar(db, `SELECT COUNT(*) c FROM users WHERE ${uCreated} >= ?`, [today]),
        newWeek: scalar(db, `SELECT COUNT(*) c FROM users WHERE ${uCreated} >= ?`, [week]),
        dau: ev ? scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [today]) : null,
        wau: ev ? scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [week]) : null,
        revToday: pay ? rev(today) : null,
        revMonth: pay ? rev(month) : null,
        revTotal: pay ? toToman(inst.bot, scalar(db, `SELECT COALESCE(SUM(${m.amountCol}),0) s FROM ${m.table} WHERE status='${m.successStatus}'${m.testFilter ? ` AND ${m.testFilter}` : ''}`)) : null,
        waitingReview: pay ? scalar(db, `SELECT COUNT(*) c FROM ${m.table} WHERE status='${m.pendingStatus}'`) : null,
      };
    });
    const sizes = dbSizes(inst.file);
    if (!s) { out += `<div class="card"><h2>${esc(inst.title)}</h2><p class="muted">دیتابیس در دسترس نیست.</p></div>`; continue; }
    out += `<div class="card"><h2>${esc(inst.title)} <span class="muted mono">${esc(inst.id)}</span></h2><div class="grid">
      ${stat('کاربران', cohortCount(s.users, { k: 'users', bot: inst.bot, inst: inst.id }))}
      ${stat('جدید امروز', cohortCount(s.newToday, { k: 'users', bot: inst.bot, inst: inst.id, since: String(today) }))}
      ${stat('جدید ۷ روز', cohortCount(s.newWeek, { k: 'users', bot: inst.bot, inst: inst.id, since: String(week) }))}
      ${s.dau !== null ? stat('کاربر فعال امروز (DAU)', cohortCount(s.dau, { k: 'actives', bot: inst.bot, inst: inst.id, since: String(today) })) : ''}
      ${s.wau !== null ? stat('فعال ۷ روز (WAU)', cohortCount(s.wau, { k: 'actives', bot: inst.bot, inst: inst.id, since: String(week) })) : ''}
      ${s.revToday !== null ? stat('درآمد امروز', fmt(s.revToday) + ' ت') : ''}
      ${s.revMonth !== null ? stat('درآمد ۳۰ روز', fmt(s.revMonth) + ' ت') : ''}
      ${s.revTotal !== null ? stat('درآمد کل', fmt(s.revTotal) + ' ت') : ''}
      ${s.waitingReview ? stat('⏳ رسید در انتظار تأیید', fmt(s.waitingReview)) : ''}
      ${stat('حجم DB', `${mb(sizes.db)}MB` + (sizes.wal ? ` <span class="muted">(+${mb(sizes.wal)}MB WAL)</span>` : ''))}
    </div></div>`;
  }
  // ویجت drift واژه‌نامه: رویدادی که در قرارداد نیست = خطای قابل‌مشاهده، نه باگ خاموش در اعداد
  const unknown = [];
  for (const inst of insts) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events')) return;
      for (const r of rows(db, 'SELECT event, COUNT(*) c FROM events GROUP BY event')) {
        if (!KNOWN_EVENTS.has(r.event)) unknown.push(`${inst.id}: ${r.event} (${fmt(r.c)})`);
      }
    });
  }
  if (unknown.length) {
    out += `<div class="note">⚠️ رویدادهای خارج از واژه‌نامه (drift قرارداد آنالیتیکس؟): ${unknown.map(esc).join(' · ')}</div>`;
  }
  out += `<p class="muted">درآمد = مبلغ واقعاً پرداخت‌شده (بعد از تخفیف)، تأییدشده. مرز «امروز» = نیمه‌شب تهران. برای دیدنِ ربات دیگر، از منوی کشوییِ بالای منو عوضش کن.</p>`;
  return out;
}
