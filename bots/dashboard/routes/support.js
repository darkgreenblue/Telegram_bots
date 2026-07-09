// پشتیبانی: سرچ کاربر در همه‌ی ربات‌ها + پروفایل و تایم‌لاین معکوس (طلایی‌ترین صفحه‌ی دیباگ)
// مرجع هویت همیشه telegram_id است؛ username فقط hint است (ممکن است عوض شده باشد).
import { instances, getInstance, withDb, hasTable, rows, userPk, userNameCol, moneyOf, unixOf, toToman } from '../lib/bots.js';
import { fmt, esc, tehranDateTime, parseJsonSafe } from '../lib/util.js';
import { table, statusBadge, stat } from '../lib/html.js';

// created_at ممکن است unix یا ISO باشد → همیشه به رشته‌ی قابل‌نمایش تبدیل شود
const showTime = (v) => (typeof v === 'string' ? v : tehranDateTime(v));
const toUnix = (v) => (typeof v === 'string' ? Math.floor(Date.parse(v) / 1000) || 0 : (v || 0));

export function supportBody(url) {
  const q = (url.searchParams.get('q') || '').trim();
  const form = `<div class="card"><h2>🔎 جستجوی کاربر</h2>
  <form method="get" action="/support" class="inline">
    <label>آی‌دی عددی تلگرام یا یوزرنیم<input name="q" dir="ltr" value="${esc(q)}" autofocus></label>
    <button type="submit">بگرد</button>
  </form>
  <p class="muted">مرجع، آی‌دی عددی است؛ یوزرنیم ممکن است قدیمی باشد.</p></div>`;
  if (!q) return form;

  const numeric = /^\d+$/.test(q.replace(/^@/, ''));
  const uname = q.replace(/^@/, '');
  const results = [];
  for (const inst of instances()) {
    withDb(inst.file, (db) => {
      const pk = userPk(inst.bot);
      const nameCol = userNameCol(inst.bot);
      const found = numeric
        ? rows(db, `SELECT * FROM users WHERE ${pk}=?`, [parseInt(uname, 10)])
        : rows(db, `SELECT * FROM users WHERE username LIKE ? OR ${nameCol} LIKE ? LIMIT 20`, [`%${uname}%`, `%${uname}%`]);
      for (const u of found) results.push({ inst, u, pk, nameCol });
    });
  }
  const list = table(
    ['ربات', 'آی‌دی', 'نام', 'یوزرنیم', 'ورود', 'آخرین فعالیت', ''],
    results.map(({ inst, u, pk, nameCol }) => [
      esc(inst.title), `<span class="mono">${u[pk]}</span>`, esc(u[nameCol] || '-'),
      u.username ? `<span class="mono">@${esc(u.username)}</span>` : '-',
      showTime(u.created_at), showTime(u.last_seen ?? u.last_dream_date ?? '-'),
      `<a href="/support/user?inst=${encodeURIComponent(inst.id)}&id=${u[pk]}">پروفایل و تایم‌لاین ←</a>`,
    ]),
    'کاربری با این مشخصات پیدا نشد.'
  );
  return form + `<div class="card"><h2>نتایج</h2>${list}</div>`;
}

// ستون‌هایی که در پروفایل نمایش داده نمی‌شوند یا کوتاه می‌شوند
const HIDE_COLS = new Set(['session_json']);
const TRUNC = 120;

function profileCard(inst, u) {
  const cells = Object.entries(u)
    .filter(([k]) => !HIDE_COLS.has(k))
    .map(([k, v]) => {
      let val = String(v ?? '');
      if (/_at$|^last_seen$|^created/.test(k) && /^\d{9,}$/.test(val)) val = tehranDateTime(Number(val));
      if (k === 'balance') val = fmt(v) + ' ت';
      if (val.length > TRUNC) val = val.slice(0, TRUNC) + '…';
      return stat(k, esc(val || '-'));
    }).join('');
  const nameCol = userNameCol(inst.bot), pk = userPk(inst.bot);
  return `<div class="card"><h2>👤 ${esc(u[nameCol] || u[pk])} — ${esc(inst.title)}</h2><div class="grid">${cells}</div></div>`;
}

// تایم‌لاین: merge معکوس رویدادها + پرداخت‌ها + رکوردهای اختصاصی هر ربات (ts نرمال به unix)
function buildTimeline(db, botKey, uid) {
  const items = [];
  if (hasTable(db, 'events')) {
    for (const e of rows(db, 'SELECT created_at ts, event, props FROM events WHERE user_id=? ORDER BY id DESC LIMIT 300', [uid])) {
      const p = parseJsonSafe(e.props);
      const detail = Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' ');
      items.push({ ts: e.ts, icon: '⚡', label: e.event, detail });
    }
  }
  const m = moneyOf(botKey);
  if (hasTable(db, m.table)) {
    for (const p of rows(db, `SELECT * FROM ${m.table} WHERE user_id=? ORDER BY id DESC LIMIT 100`, [uid])) {
      const amt = toToman(botKey, p[m.amountCol]);
      const orig = p.original_amount != null ? toToman(botKey, p.original_amount) : null;
      items.push({
        ts: toUnix(p.created_at), icon: '💳',
        label: `پرداخت #${p.id} — ${fmt(amt)} ت` + (orig && orig !== amt ? ` (اصل ${fmt(orig)})` : '') + (p.tier ? ` · اشتراک ${p.tier}` : ''),
        detail: `${p.status}${p.step ? ` · مرحله: ${p.step}` : ''}`, status: p.status,
      });
    }
  }
  if (botKey === 'tarot' && hasTable(db, 'readings')) {
    for (const r of rows(db, 'SELECT * FROM readings WHERE user_id=? ORDER BY id DESC LIMIT 100', [uid])) {
      items.push({ ts: r.created_at, icon: '🔮', label: `فال ${r.type} — ${fmt(r.price)} ت`, detail: `${r.status}${r.feedback ? ` · بازخورد: ${r.feedback.slice(0, 60)}` : ''}`, status: r.status });
    }
  }
  if (botKey === 'voice2text') {
    if (hasTable(db, 'usage_log')) {
      for (const l of rows(db, 'SELECT * FROM usage_log WHERE user_id=? ORDER BY id DESC LIMIT 100', [uid])) {
        items.push({ ts: l.created_at, icon: '🎙', label: `پردازش ${l.type || '-'} — ${fmt(l.cost)} ت`, detail: `${l.model} · ${Math.round(l.duration_sec || 0)}s`, status: l.success ? 'completed' : 'failed' });
      }
    }
    if (hasTable(db, 'voice_flows')) {
      for (const f of rows(db, "SELECT * FROM voice_flows WHERE user_id=? AND status!='completed' ORDER BY id DESC LIMIT 50", [uid])) {
        items.push({ ts: f.created_at, icon: '🌀', label: `فلوی ویس — ${f.status}`, detail: `مرحله: ${f.step || '-'}`, status: f.status });
      }
    }
  }
  if (botKey === 'tabir-khab' && hasTable(db, 'dreams')) {
    for (const d of rows(db, 'SELECT id, created_at, is_free_trial, full_delivered, image_generated FROM dreams WHERE user_id=? ORDER BY id DESC LIMIT 100', [uid])) {
      items.push({ ts: toUnix(d.created_at), icon: '🌙', label: `خواب #${d.id}${d.is_free_trial ? ' (رایگان)' : ''}`, detail: `${d.full_delivered ? 'تحویل کامل' : 'preview'}${d.image_generated ? ' · تصویر' : ''}`, status: d.full_delivered ? 'delivered' : 'pending_payment' });
    }
  }
  items.sort((a, b) => b.ts - a.ts);
  return items.slice(0, 300);
}

export function supportUserBody(url) {
  const inst = getInstance(url.searchParams.get('inst') || '');
  const uid = parseInt(url.searchParams.get('id') || '', 10);
  if (!inst || !uid) return `<div class="card"><p class="muted">پارامتر نامعتبر.</p></div>`;
  return withDb(inst.file, (db) => {
    const u = db.prepare(`SELECT * FROM users WHERE ${userPk(inst.bot)}=?`).get(uid);
    if (!u) return `<div class="card"><p class="muted">کاربر در این ربات نیست.</p></div>`;
    const tl = buildTimeline(db, inst.bot, uid);
    const tlHtml = table(
      ['زمان', '', 'چه شد', 'جزئیات'],
      tl.map(i => [
        tehranDateTime(i.ts), i.icon,
        esc(i.label) + (i.status ? ' ' + statusBadge(i.status) : ''),
        `<span class="muted">${esc(i.detail || '')}</span>`,
      ]),
      'هنوز فعالیتی ثبت نشده.'
    );
    const others = instances().filter(x => x.id !== inst.id)
      .map(x => `<a href="/support/user?inst=${encodeURIComponent(x.id)}&id=${uid}">${esc(x.title)}</a>`).join(' · ');
    return profileCard(inst, u)
      + `<div class="card"><h2>🕓 تایم‌لاین (جدید → قدیم)</h2>${tlHtml}</div>`
      + `<div class="card"><p class="muted">همین کاربر در ربات‌های دیگر: ${others}</p></div>`;
  }, `<div class="card"><p class="muted">دیتابیس در دسترس نیست.</p></div>`);
}
