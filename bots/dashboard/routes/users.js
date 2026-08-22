// تب «کاربران»: همه‌ی کاربرانِ همه‌ی ربات‌ها در یک جا، با جستجو/فیلتر/مرتب‌سازی و CSV.
// هدف (خواسته‌ی مالک): هیچ کاربری در هیچ رباتی نباشد که از داشبورد پیدا نشود و نشود journey اش را دید.
//
// schema-agnostic: هر ستونی که ممکن است در یک ربات نباشد (balance/state/last_seen) قبل از استفاده
// با PRAGMA چک می‌شود؛ جمعِ پرداخت و شمارشِ رویداد از پروفایلِ مالیِ همان ربات می‌آید.
import {
  instances, instancesOf, BOTS, withDb, hasTable, rows,
  userPk, userNameCol, moneyOf, unixOf, userCreatedExpr, toToman, creditText, creditNum } from '../lib/bots.js';
import { audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, nowSec } from '../lib/util.js';
import { table } from '../lib/html.js';
import { userLink } from './cohort.js';

const PER_PAGE = 50;
const PER_INSTANCE_CAP = 3000; // سقفِ خواندن per دیتابیس (ضدِ کوئریِ سنگین روی ربات زنده)

const SORTS = [
  ['new', 'جدیدترین ورود'],
  ['old', 'قدیمی‌ترین ورود'],
  ['active', 'آخرین فعالیت'],
  ['paid', 'بیشترین پرداخت'],
  ['events', 'بیشترین استفاده'],
  ['balance', 'بیشترین موجودی'],
];

function readFilters(url) {
  const bot = BOTS.some(b => b.key === url.searchParams.get('bot')) ? url.searchParams.get('bot') : '';
  const sortKey = SORTS.some(([k]) => k === url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'new';
  const days = Math.max(0, parseInt(url.searchParams.get('days') || '0', 10) || 0);
  const payers = url.searchParams.get('payers') === '1';
  return {
    bot, sort: sortKey, days, payers,
    q: (url.searchParams.get('q') || '').trim().slice(0, 64),
    page: Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1),
  };
}

// یک ردیفِ نرمالِ کاربر از هر ربات (ستون‌های نبود = null)
function collectUsers(f) {
  const since = f.days ? nowSec() - f.days * 86400 : 0;
  const targets = f.bot ? instancesOf(f.bot) : instances();
  const out = [];
  for (const inst of targets) {
    withDb(inst.file, (db) => {
      const pk = userPk(inst.bot);
      const nameCol = userNameCol(inst.bot);
      const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
      const has = (c) => cols.includes(c);
      const createdExpr = userCreatedExpr(inst.bot, 'u.created_at');
      const m = moneyOf(inst.bot);
      const hasMoney = hasTable(db, m.table);
      const hasEvents = hasTable(db, 'events');
      const test = m.testFilter ? ` AND ${m.testFilter}` : '';

      // ستون‌های اختیاری: هر ربات مدل خودش را دارد (tabir بدون balance/state)
      const stateCol = has('state') ? 'u.state' : has('pending_state') ? 'u.pending_state' : `''`;
      const balCol = has('balance') ? 'u.balance' : 'NULL';
      const seenCol = has('last_seen') ? 'u.last_seen' : 'NULL';
      const evCount = hasEvents ? `(SELECT COUNT(*) FROM events e WHERE e.user_id = u.${pk})` : '0';
      const evLast = hasEvents ? `(SELECT MAX(e.created_at) FROM events e WHERE e.user_id = u.${pk})` : 'NULL';
      const paidSum = hasMoney ? `(SELECT COALESCE(SUM(p.${m.amountCol}),0) FROM ${m.table} p WHERE p.user_id = u.${pk} AND p.status='${m.successStatus}'${test})` : '0';
      const paidCnt = hasMoney ? `(SELECT COUNT(*) FROM ${m.table} p WHERE p.user_id = u.${pk} AND p.status='${m.successStatus}'${test})` : '0';

      const conds = [];
      const params = [];
      if (since) { conds.push(`${createdExpr} >= ?`); params.push(since); }
      if (f.q) {
        if (/^\d+$/.test(f.q)) { conds.push(`u.${pk} = ?`); params.push(parseInt(f.q, 10)); }
        else {
          const like = `%${f.q.replace(/^@/, '')}%`;
          conds.push(`(u.username LIKE ? OR u.${nameCol} LIKE ?)`);
          params.push(like, like);
        }
      }
      if (f.payers) conds.push(`${paidCnt} > 0`);

      const sql = `SELECT u.${pk} id, u.${nameCol} nm, u.username un, ${createdExpr} created,
          ${stateCol} st, ${balCol} bal, ${seenCol} seen,
          ${evCount} ev, ${evLast} ev_last, ${paidSum} paid, ${paidCnt} paid_n
        FROM users u ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY ${createdExpr} DESC LIMIT ${PER_INSTANCE_CAP}`;

      for (const u of rows(db, sql, params)) {
        out.push({
          instId: inst.id, instTitle: inst.title, bot: inst.bot,
          uid: u.id, name: u.nm || '', username: u.un || '',
          created: u.created || 0, state: u.st || '',
          // عددِ خام برای مرتب‌سازی می‌ماند (یکنواخت است، پس ترتیب عوض نمی‌شود)؛
          // نمایش و CSV از creditText/creditNum می‌آیند تا واحدِ هر ربات درست بماند.
          balanceRaw: u.bal,
          balance: u.bal == null ? null : creditNum(inst.bot, u.bal),
          balanceText: u.bal == null ? null : creditText(inst.bot, u.bal),
          lastSeen: Math.max(Number(u.seen) || 0, Number(u.ev_last) || 0),
          events: Number(u.ev) || 0,
          paid: toToman(inst.bot, u.paid || 0), paidCount: Number(u.paid_n) || 0,
        });
      }
    });
  }
  const cmp = {
    new: (a, b) => b.created - a.created,
    old: (a, b) => a.created - b.created,
    active: (a, b) => b.lastSeen - a.lastSeen,
    paid: (a, b) => b.paid - a.paid,
    events: (a, b) => b.events - a.events,
    balance: (a, b) => (b.balance || 0) - (a.balance || 0),
  }[f.sort];
  out.sort(cmp);
  return out;
}

export function usersBody(url) {
  const f = readFilters(url);
  const all = collectUsers(f);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const page = Math.min(f.page, pages);
  const slice = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // فیلترهای فعلی را در لینک‌ها (صفحه‌بندی/CSV) نگه می‌دارد؛ مقدارهای خالی/پیش‌فرض حذف می‌شوند
  const qs = (over = {}) => {
    const merged = {
      bot: f.bot, q: f.q, sort: f.sort,
      days: f.days ? String(f.days) : '', payers: f.payers ? '1' : '',
      page: String(page), ...over,
    };
    return new URLSearchParams(
      Object.entries(merged).filter(([, v]) => v !== '' && v != null)
    ).toString();
  };

  const filterForm = `<form method="get" action="/users" class="inline">
    <label>ربات<select name="bot"><option value="">همه‌ی ربات‌ها</option>
      ${BOTS.map(b => `<option value="${esc(b.key)}" ${b.key === f.bot ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
    </select></label>
    <label>جستجو (آی‌دی / یوزرنیم / نام)<input name="q" dir="ltr" value="${esc(f.q)}" placeholder="مثلاً 100257975 یا ali"></label>
    <label>ورود در<select name="days">
      ${[['0', 'همه‌ی زمان‌ها'], ['1', 'امروز'], ['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز']]
        .map(([v, l]) => `<option value="${v}" ${Number(v) === f.days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>مرتب‌سازی<select name="sort">
      ${SORTS.map(([k, l]) => `<option value="${k}" ${k === f.sort ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>فقط خریدارها<input type="checkbox" name="payers" value="1" ${f.payers ? 'checked' : ''}></label>
    <button type="submit">اعمال</button>
    <a href="/users.csv?${esc(qs({ page: '' }))}"><button type="button" class="ghost">⬇ CSV</button></a>
  </form>`;

  const body = slice.map(u => [
    esc(u.instTitle),
    userLink(u.instId, u.uid),
    esc(u.name || '-'),
    u.username ? `<span class="mono">@${esc(u.username)}</span>` : '-',
    tehranDateTime(u.created),
    u.lastSeen ? tehranDateTime(u.lastSeen) : '-',
    fmt(u.events),
    u.paidCount ? `${fmt(u.paidCount)} × <b>${fmt(u.paid)}</b> ت` : '<span class="muted">-</span>',
    u.balanceText ?? '-',
    u.state ? `<span class="badge">${esc(u.state)}</span>` : '-',
    `<a href="/support/user?inst=${encodeURIComponent(u.instId)}&id=${u.uid}">journey ←</a>`,
  ]);

  const pager = pages > 1
    ? `<p class="muted">صفحه ${fmt(page)} از ${fmt(pages)} · `
      + (page > 1 ? `<a href="/users?${esc(qs({ page: String(page - 1) }))}">قبلی</a> ` : '')
      + (page < pages ? `<a href="/users?${esc(qs({ page: String(page + 1) }))}">بعدی</a>` : '')
      + `</p>`
    : '';

  return `<div class="card"><h2>👥 کاربران همه‌ی ربات‌ها</h2>${filterForm}
    <p class="muted">${fmt(all.length)} کاربر با این فیلتر. «رویداد» = تعداد کل رویدادهای ثبت‌شده (میزان استفاده)، «پرداخت» = تعداد و جمعِ پرداخت‌های موفق (تومان؛ اشتراکِ ریالی ÷۱۰). روی آی‌دی یا «journey» بزن تا پروفایل و تایم‌لاینِ کاملش باز شود.</p></div>
    <div class="card">${table(
      ['ربات', 'آی‌دی', 'نام', 'یوزرنیم', 'ورود', 'آخرین فعالیت', 'رویداد', 'پرداخت', 'موجودی', 'وضعیت', ''],
      body, 'کاربری با این فیلتر پیدا نشد.'
    )}${pager}</div>`;
}

export function usersCsv(url) {
  const f = readFilters(url);
  const all = collectUsers(f).slice(0, 5000);
  audit('export.csv', 'users', `bot=${f.bot || 'all'} q=${f.q || '-'} sort=${f.sort} days=${f.days} rows=${all.length}`);
  const header = 'bot_instance,user_id,name,username,created_at,last_activity,events,payments_count,paid_toman,credit,state';
  const lines = all.map(u => [
    u.instId, u.uid, u.name, u.username, u.created || '', u.lastSeen || '',
    u.events, u.paidCount, u.paid, u.balance ?? '', u.state,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  return [header, ...lines].join('\n');
}
