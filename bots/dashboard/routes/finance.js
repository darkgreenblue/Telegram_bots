// مالی: پرداخت‌های همه‌ی ربات‌ها با فیلتر وضعیت/بازه + خروجی CSV (با ثبت در audit) + دفتر ممیزی
import { instances, getInstance, withDb, hasTable, rows } from '../lib/bots.js';
import { listAudit, audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, nowSec } from '../lib/util.js';
import { table, statusBadge, stat } from '../lib/html.js';

const STATUSES = ['', 'pending', 'waiting_review', 'approved', 'rejected', 'cancelled', 'canceled'];

function readFilters(url) {
  const instId = url.searchParams.get('inst') || '';
  const status = STATUSES.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '';
  const days = Math.max(0, parseInt(url.searchParams.get('days') || '30', 10) || 0); // 0 = همه
  return { instId, status, days };
}

function collectPayments({ instId, status, days }) {
  const since = days ? nowSec() - days * 86400 : 0;
  const targets = instId ? [getInstance(instId)].filter(Boolean) : instances();
  const all = [];
  for (const inst of targets) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'payments')) return;
      const conds = ['created_at >= ?'];
      const params = [since];
      if (status) { conds.push('status = ?'); params.push(status); }
      for (const p of rows(db, `SELECT * FROM payments WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT 300`, params)) {
        all.push({ inst, p });
      }
    });
  }
  all.sort((a, b) => b.p.created_at - a.p.created_at);
  return all;
}

export function financeBody(url) {
  const f = readFilters(url);
  const all = collectPayments(f);

  const totals = {};
  for (const { p } of all) {
    totals[p.status] = totals[p.status] || { c: 0, s: 0 };
    totals[p.status].c += 1; totals[p.status].s += p.amount || 0;
  }
  const totalsHtml = Object.entries(totals)
    .map(([s, t]) => stat(s, `${fmt(t.c)} پرداخت / ${fmt(t.s)} ت`)).join('') || '<p class="muted">پرداختی در این بازه نیست.</p>';

  const instOptions = ['<option value="">همه‌ی ربات‌ها</option>',
    ...instances().map(i => `<option value="${esc(i.id)}" ${i.id === f.instId ? 'selected' : ''}>${esc(i.title)}</option>`)].join('');
  const statusOptions = STATUSES.map(s => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${s || 'همه‌ی وضعیت‌ها'}</option>`).join('');
  const filterForm = `<form method="get" action="/finance" class="inline">
    <label>ربات<select name="inst">${instOptions}</select></label>
    <label>وضعیت<select name="status">${statusOptions}</select></label>
    <label>بازه<select name="days">
      ${[['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز'], ['0', 'همه']].map(([v, l]) => `<option value="${v}" ${Number(v) === f.days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <button type="submit">فیلتر</button>
    <a href="/finance.csv?inst=${encodeURIComponent(f.instId)}&status=${f.status}&days=${f.days}"><button type="button" class="ghost">⬇ CSV</button></a>
  </form>`;

  const rowsHtml = all.slice(0, 150).map(({ inst, p }) => [
    esc(inst.title),
    `#${p.id}`,
    `<a href="/support/user?inst=${encodeURIComponent(inst.id)}&id=${p.user_id}" class="mono">${p.user_id}</a>`,
    fmt(p.amount) + ' ت' + (p.original_amount && p.original_amount !== p.amount ? ` <span class="muted">(اصل ${fmt(p.original_amount)})</span>` : ''),
    statusBadge(p.status),
    esc(p.step || '-'),
    tehranDateTime(p.created_at),
    tehranDateTime(p.updated_at),
  ]);

  const auditHtml = table(
    ['زمان', 'عمل', 'هدف', 'جزئیات'],
    listAudit(30).map(a => [tehranDateTime(a.created_at), esc(a.action), esc(a.target), `<span class="muted">${esc(a.details)}</span>`]),
    'خالی'
  );

  return `<div class="card"><h2>💰 مالی</h2>${filterForm}<div class="grid" style="margin-top:12px">${totalsHtml}</div></div>
  <div class="card"><h2>پرداخت‌ها (${fmt(all.length)}${all.length > 150 ? ' — نمایش ۱۵۰ ردیف اول' : ''})</h2>
  ${table(['ربات', 'شماره', 'کاربر', 'مبلغ', 'وضعیت', 'مرحله', 'ساخت', 'به‌روزرسانی'], rowsHtml)}
  <p class="muted">«مرحله» یعنی کاربر تا کجای فلوی شارژ رفته (نقطه‌ی رها کردن). مبلغ = پرداخت واقعی بعد از تخفیف.</p></div>
  <div class="card"><h2>🧾 دفتر ممیزی داشبورد (writeها و exportها)</h2>${auditHtml}</div>`;
}

export function financeCsv(url) {
  const f = readFilters(url);
  const all = collectPayments(f);
  audit('export.csv', 'finance', `inst=${f.instId || 'all'} status=${f.status || 'all'} days=${f.days} rows=${all.length}`);
  const header = 'bot,payment_id,user_id,amount,original_amount,status,step,created_at,updated_at';
  const lines = all.map(({ inst, p }) =>
    [inst.id, p.id, p.user_id, p.amount ?? '', p.original_amount ?? '', p.status ?? '', p.step ?? '', p.created_at ?? '', p.updated_at ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header, ...lines].join('\n');
}
