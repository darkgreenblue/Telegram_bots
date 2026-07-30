// پشتیبانی: سرچ کاربر در همه‌ی ربات‌ها + پروفایل و تایم‌لاین معکوس (طلایی‌ترین صفحه‌ی دیباگ)
// مرجع هویت همیشه telegram_id است؛ username فقط hint است (ممکن است عوض شده باشد).
import { instances, getInstance, withDb, hasTable, rows, userPk, userNameCol, moneyOf, unixOf, toToman } from '../lib/bots.js';
import { fmt, esc, tehranDateTime, parseJsonSafe } from '../lib/util.js';
import { parseSupportCode } from '../../../shared/support.js';
import { table, statusBadge, stat } from '../lib/html.js';
import { groupSessions } from '../lib/journey.js';

// created_at ممکن است unix یا ISO باشد → همیشه به رشته‌ی قابل‌نمایش تبدیل شود
const showTime = (v) => (typeof v === 'string' ? v : tehranDateTime(v));
const toUnix = (v) => (typeof v === 'string' ? Math.floor(Date.parse(v) / 1000) || 0 : (v || 0));

export function supportBody(url) {
  const q = (url.searchParams.get('q') || '').trim();
  // کدِ پیگیریِ پشتیبانی (#TRT-123456789) که کاربر در چتِ پشتیبانی فرستاده: کلِ پیامش را هم
  // می‌شود paste کرد؛ کد از داخلش بیرون کشیده و به آی‌دیِ عددی تبدیل می‌شود (shared/support.js).
  const code = parseSupportCode(q);
  const form = `<div class="card"><h2>🔎 جستجوی کاربر</h2>
  <form method="get" action="/support" class="inline">
    <label>آی‌دی عددی، یوزرنیم، یا کد پشتیبانی<input name="q" dir="ltr" value="${esc(q)}" autofocus></label>
    <button type="submit">بگرد</button>
  </form>
  <p class="muted">مرجع، آی‌دی عددی است؛ یوزرنیم ممکن است قدیمی باشد. کدِ پشتیبانی (مثل <span class="mono">#TRT-123456789</span>) یا کلِ پیامِ کاربر را هم می‌توانی همین‌جا بگذاری.</p></div>`;
  if (!q) return form;

  const hint = code
    ? `<p class="muted">کدِ پشتیبانی خوانده شد: ربات <b>${esc(code.bot || code.botCode)}</b>، کاربر <span class="mono">${code.userId}</span></p>`
    : '';
  const numeric = code ? true : /^\d+$/.test(q.replace(/^@/, ''));
  const uname = code ? String(code.userId) : q.replace(/^@/, '');
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
  return form + `<div class="card"><h2>نتایج</h2>${hint}${list}</div>`;
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
  // کاتالوگِ صفحه‌ها: کلیدِ هشیِ رویدادهای view را به متنِ واقعیِ پیام تبدیل می‌کند
  const screens = new Map();
  if (hasTable(db, 'screens')) {
    for (const s of rows(db, 'SELECT k, label, sample FROM screens')) screens.set(s.k, s);
  }
  if (hasTable(db, 'events')) {
    for (const e of rows(db, 'SELECT created_at ts, event, props FROM events WHERE user_id=? ORDER BY id DESC LIMIT 400', [uid])) {
      const p = parseJsonSafe(e.props);
      // رویدادهای ریزِ مسیر (shared/journey.js) خواناتر نمایش داده می‌شوند: خودِ پیام / خودِ دکمه
      if (e.event === 'view') {
        const s = screens.get(p.k);
        const txt = p.k === 'content' ? `متنِ محتوا (${fmt(p.n || 0)} کاراکتر)`
          : (s?.label || (s?.sample || '').replace(/\s+/g, ' ').trim().slice(0, 110) || `صفحه ${p.k}`);
        items.push({ ts: e.ts, icon: '💬', label: txt, detail: 'ربات نشان داد', micro: true });
        continue;
      }
      if (e.event === 'act') {
        items.push({ ts: e.ts, icon: '👆', label: p.d || p.a, detail: 'کاربر انجام داد', micro: true });
        continue;
      }
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
  return items.slice(0, 400).reverse(); // صعودی، تا سشن‌بندی و «بازپخشِ» مسیر درست خوانده شود
}

export function supportUserBody(url) {
  const inst = getInstance(url.searchParams.get('inst') || '');
  const uid = parseInt(url.searchParams.get('id') || '', 10);
  if (!inst || !uid) return `<div class="card"><p class="muted">پارامتر نامعتبر.</p></div>`;
  return withDb(inst.file, (db) => {
    const u = db.prepare(`SELECT * FROM users WHERE ${userPk(inst.bot)}=?`).get(uid);
    if (!u) return `<div class="card"><p class="muted">کاربر در این ربات نیست.</p></div>`;
    // سشن = فعالیت‌های پشت‌سرهم با فاصله‌ی کمتر از نیم‌ساعت. جدیدترین سشن اول، ولی **داخلِ هر
    // سشن به ترتیبِ وقوع** — یعنی دقیقاً همان چیزی که کاربر تجربه کرده، مثل بازپخش.
    const sessions = groupSessions(buildTimeline(db, inst.bot, uid));
    const tlHtml = sessions.length ? sessions.map((s, i) => {
      const mins = Math.max(0, Math.round((s.end - s.start) / 60));
      return `<h3 style="margin:14px 0 6px;font-size:13px">
          سشن ${fmt(sessions.length - i)} · ${esc(tehranDateTime(s.start))}
          <span class="muted">· ${fmt(mins)} دقیقه · ${fmt(s.items.length)} قدم</span></h3>`
        + table(['زمان', '', 'چه شد', 'جزئیات'], s.items.map(it => [
          tehranDateTime(it.ts), it.icon,
          (it.micro ? '<span class="muted">' : '') + esc(it.label) + (it.micro ? '</span>' : '')
            + (it.status ? ' ' + statusBadge(it.status) : ''),
          `<span class="muted">${esc(it.detail || '')}</span>`,
        ]));
    }).join('') : '<p class="muted">هنوز فعالیتی ثبت نشده.</p>';

    const others = instances().filter(x => x.id !== inst.id)
      .map(x => `<a href="/support/user?inst=${encodeURIComponent(x.id)}&id=${uid}">${esc(x.title)}</a>`).join(' · ');
    return profileCard(inst, u)
      + `<div class="card"><h2>🕓 سشن‌ها و بازپخشِ مسیر</h2>
         <p class="muted">هر سشن = فعالیتِ پیوسته با فاصله‌ی کمتر از ۳۰ دقیقه. ردیف‌های کم‌رنگ، قدم‌های ریز
           (پیامی که ربات نشان داد یا دکمه‌ای که کاربر زد) هستند.</p>${tlHtml}</div>`
      + `<div class="card"><p class="muted">همین کاربر در ربات‌های دیگر: ${others}</p></div>`;
  }, `<div class="card"><p class="muted">دیتابیس در دسترس نیست.</p></div>`);
}
