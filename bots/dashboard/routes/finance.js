// مالی: پرداخت‌های همه‌ی ربات‌ها (schema-agnostic با پروفایل) + فیلتر + CSV (با audit) + دفتر ممیزی
// هر ربات جدول/ستون/واحد مالی خودش را دارد (payments/امتیاز تومان vs transactions/amount_rial)؛
// این‌جا همه به یک رکورد نرمالِ تومان تبدیل می‌شوند تا جدول و جمع‌ها قابل‌مقایسه بمانند.
import { instances, getInstance, withDb, hasTable, rows, moneyOf, unixOf, toToman } from '../lib/bots.js';
import { listAudit, audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, nowSec } from '../lib/util.js';
import { table, statusBadge, stat } from '../lib/html.js';

// وضعیت‌های همه‌ی مدل‌های مالی (کیف‌پول + اشتراک tabir)
const STATUSES = ['', 'pending', 'waiting_review', 'approved', 'paid', 'rejected', 'cancelled', 'canceled'];

function readFilters(url) {
  const instId = url.searchParams.get('inst') || '';
  const status = STATUSES.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '';
  const days = Math.max(0, parseInt(url.searchParams.get('days') || '30', 10) || 0); // 0 = همه
  return { instId, status, days };
}

// یک رکورد نرمالِ مشترک برای همه‌ی ربات‌ها (مبلغ به تومان)
function collectPayments({ instId, status, days }) {
  const since = days ? nowSec() - days * 86400 : 0;
  const targets = instId ? [getInstance(instId)].filter(Boolean) : instances();
  const all = [];
  for (const inst of targets) {
    withDb(inst.file, (db) => {
      const m = moneyOf(inst.bot);
      if (!hasTable(db, m.table)) return;
      const catExpr = unixOf(m.createdKind, 'created_at');
      const conds = [`${catExpr} >= ?`];
      const params = [since];
      if (status) { conds.push('status = ?'); params.push(status); }
      for (const p of rows(db, `SELECT *, ${catExpr} AS _cat FROM ${m.table} WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT 300`, params)) {
        const uat = p.updated_at != null ? (m.createdKind === 'iso' ? Math.floor(Date.parse(p.updated_at) / 1000) || null : p.updated_at) : null;
        all.push({
          inst, id: p.id, userId: p.user_id,
          amount: toToman(inst.bot, p[m.amountCol]),
          original: p.original_amount != null ? toToman(inst.bot, p.original_amount) : null,
          status: p.status,
          step: p.step ?? (p.tier ? `اشتراک ${p.tier}` : null), // tabir: به‌جای مرحله، نوع اشتراک
          created: p._cat, updated: uat || p._cat,
        });
      }
    });
  }
  all.sort((a, b) => b.created - a.created);
  return all;
}

export function financeBody(url) {
  const f = readFilters(url);
  const all = collectPayments(f);

  const totals = {};
  for (const p of all) {
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

  const rowsHtml = all.slice(0, 150).map((p) => [
    esc(p.inst.title),
    `#${p.id}`,
    `<a href="/support/user?inst=${encodeURIComponent(p.inst.id)}&id=${p.userId}" class="mono">${p.userId}</a>`,
    fmt(p.amount) + ' ت' + (p.original && p.original !== p.amount ? ` <span class="muted">(اصل ${fmt(p.original)})</span>` : ''),
    statusBadge(p.status),
    esc(p.step || '-'),
    tehranDateTime(p.created),
    tehranDateTime(p.updated),
  ]);

  const auditHtml = table(
    ['زمان', 'عمل', 'هدف', 'جزئیات'],
    listAudit(30).map(a => [tehranDateTime(a.created_at), esc(a.action), esc(a.target), `<span class="muted">${esc(a.details)}</span>`]),
    'خالی'
  );

  return `<div class="card"><h2>💰 مالی</h2>${filterForm}<div class="grid" style="margin-top:12px">${totalsHtml}</div></div>
  <div class="card"><h2>پرداخت‌ها (${fmt(all.length)}${all.length > 150 ? ' — نمایش ۱۵۰ ردیف اول' : ''})</h2>
  ${table(['ربات', 'شماره', 'کاربر', 'مبلغ', 'وضعیت', 'مرحله/اشتراک', 'ساخت', 'به‌روزرسانی'], rowsHtml)}
  <p class="muted">مبلغ همه‌جا به تومان (اشتراک‌های ریالیِ تعبیر خواب ÷۱۰ شده‌اند). پرداخت واقعی بعد از تخفیف؛ پرداخت‌های تستی تعبیر خواب (SKIP/SIMULATED) در «درآمد» نمای کلی نمی‌آیند ولی این‌جا برای شفافیت دیده می‌شوند.</p></div>
  <div class="card"><h2>🧾 دفتر ممیزی داشبورد (writeها و exportها)</h2>${auditHtml}</div>`;
}

export function financeCsv(url) {
  const f = readFilters(url);
  const all = collectPayments(f);
  audit('export.csv', 'finance', `inst=${f.instId || 'all'} status=${f.status || 'all'} days=${f.days} rows=${all.length}`);
  const header = 'bot,payment_id,user_id,amount_toman,original_toman,status,step,created_at,updated_at';
  const lines = all.map((p) =>
    [p.inst.id, p.id, p.userId, p.amount ?? '', p.original ?? '', p.status ?? '', p.step ?? '', p.created ?? '', p.updated ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header, ...lines].join('\n');
}
