// نمای کلی: وضعیت هر ربات (کاربر/فعال/درآمد به وقت تهران) + سلامت عملیاتی (صف رسید، حجم DB)
import { instances, withDb, hasTable, scalar, dbSizes } from '../lib/bots.js';
import { tehranDayStart, nowSec, fmt, esc } from '../lib/util.js';
import { stat } from '../lib/html.js';

const mb = (bytes) => (bytes / 1048576).toFixed(1);

export function overviewBody() {
  const today = tehranDayStart();
  const week = tehranDayStart(-6);
  const month = nowSec() - 30 * 86400;
  const insts = instances();
  if (!insts.length) return `<div class="card"><p class="muted">هیچ دیتابیسی پیدا نشد. این صفحه روی سرور (کنار دیتابیس ربات‌ها) معنا دارد.</p></div>`;

  let out = '';
  for (const inst of insts) {
    const s = withDb(inst.file, (db) => {
      const ev = hasTable(db, 'events');
      const pay = hasTable(db, 'payments');
      return {
        users: scalar(db, 'SELECT COUNT(*) c FROM users'),
        newToday: scalar(db, 'SELECT COUNT(*) c FROM users WHERE created_at >= ?', [today]),
        newWeek: scalar(db, 'SELECT COUNT(*) c FROM users WHERE created_at >= ?', [week]),
        dau: ev ? scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [today]) : null,
        wau: ev ? scalar(db, 'SELECT COUNT(DISTINCT user_id) c FROM events WHERE created_at >= ?', [week]) : null,
        revToday: pay ? scalar(db, "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND created_at >= ?", [today]) : null,
        revMonth: pay ? scalar(db, "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND created_at >= ?", [month]) : null,
        revTotal: pay ? scalar(db, "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved'") : null,
        waitingReview: pay ? scalar(db, "SELECT COUNT(*) c FROM payments WHERE status='waiting_review'") : null,
      };
    });
    const sizes = dbSizes(inst.file);
    if (!s) { out += `<div class="card"><h2>${esc(inst.title)}</h2><p class="muted">دیتابیس در دسترس نیست.</p></div>`; continue; }
    out += `<div class="card"><h2>${esc(inst.title)} <span class="muted mono">${esc(inst.id)}</span></h2><div class="grid">
      ${stat('کاربران', fmt(s.users))}
      ${stat('جدید امروز', fmt(s.newToday))}
      ${stat('جدید ۷ روز', fmt(s.newWeek))}
      ${s.dau !== null ? stat('کاربر فعال امروز (DAU)', fmt(s.dau)) : ''}
      ${s.wau !== null ? stat('فعال ۷ روز (WAU)', fmt(s.wau)) : ''}
      ${s.revToday !== null ? stat('درآمد امروز', fmt(s.revToday) + ' ت') : ''}
      ${s.revMonth !== null ? stat('درآمد ۳۰ روز', fmt(s.revMonth) + ' ت') : ''}
      ${s.revTotal !== null ? stat('درآمد کل', fmt(s.revTotal) + ' ت') : ''}
      ${s.waitingReview ? stat('⏳ رسید در انتظار تأیید', fmt(s.waitingReview)) : ''}
      ${stat('حجم DB', `${mb(sizes.db)}MB` + (sizes.wal ? ` <span class="muted">(+${mb(sizes.wal)}MB WAL)</span>` : ''))}
    </div></div>`;
  }
  out += `<p class="muted">درآمد = مبلغ واقعاً پرداخت‌شده (بعد از تخفیف)، تأییدشده. مرز «امروز» = نیمه‌شب تهران. tabir-khab در فاز بعدی به داشبورد وصل می‌شود.</p>`;
  return out;
}
