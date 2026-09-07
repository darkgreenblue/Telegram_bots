// پشتیبانی: سرچ کاربر در همه‌ی ربات‌ها + پروفایل و تایم‌لاین معکوس (طلایی‌ترین صفحه‌ی دیباگ)
// مرجع هویت همیشه telegram_id است؛ username فقط hint است (ممکن است عوض شده باشد).
import { instances, instancesOf, getInstance, withDb, withWritableDb, assertColumns, hasTable, rows, userPk, userNameCol, moneyOf, unixOf, toToman, coinOf, creditText, creditNum, moneyText, familyOf, adminActionSupported } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, parseJsonSafe } from '../lib/util.js';
import { parseSupportCode } from '../../../shared/support.js';
import { table, statusBadge, stat } from '../lib/html.js';
import { groupSessions, screenText } from '../lib/journey.js';

// created_at ممکن است unix یا ISO باشد → همیشه به رشته‌ی قابل‌نمایش تبدیل شود
const showTime = (v) => (typeof v === 'string' ? v : tehranDateTime(v));
const toUnix = (v) => (typeof v === 'string' ? Math.floor(Date.parse(v) / 1000) || 0 : (v || 0));

export function supportBody(url) {
  const bot = scopeBot(url);
  const q = (url.searchParams.get('q') || '').trim();
  // کدِ پیگیریِ پشتیبانی (#TRT-123456789) که کاربر در چتِ پشتیبانی فرستاده: کلِ پیامش را هم
  // می‌شود paste کرد؛ کد از داخلش بیرون کشیده و به آی‌دیِ عددی تبدیل می‌شود (shared/support.js).
  const code = parseSupportCode(q);
  const form = `<div class="card"><h2>🔎 جستجوی کاربر</h2>
  <form method="get" action="/support" class="inline">
    <input type="hidden" name="bot" value="${esc(bot)}">
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
  // جستجو در رباتِ انتخاب‌شده. اگر کدِ پشتیبانی ربات دیگری را نشان بدهد، همان ربات
  // جستجو می‌شود (کد خودش مبدأ را می‌گوید و کاربر نباید دستی اسکوپ را عوض کند).
  const searchBot = (code?.bot && instancesOf(code.bot).length) ? code.bot : bot;
  for (const inst of instancesOf(searchBot)) {
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
      // 💎 موجودی = اعتبار، پس همیشه به واحدِ خودِ ربات. این همان جایی بود که مالک
      // «۹۶۰٬۰۰۰ تومان» می‌دید در حالی که کاربر ۹۶ الماس داشت.
      if (k === 'balance') val = creditText(inst.bot, v);
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
        // screenText اعداد را ماسک می‌کند: نمونه‌ی هر صفحه فقط یک‌بار (اولین کاربر) ذخیره
        // شده، پس عددِ داخلش مالِ این کاربر نیست. مبلغِ واقعی از ردیفِ payments همین
        // تایم‌لاین خوانده می‌شود. جزئیات: کامنتِ screenText در lib/journey.js
        const txt = p.k === 'content' ? `متنِ محتوا (${fmt(p.n || 0)} کاراکتر)`
          : screenText(s, p.k, 110);
        items.push({ ts: e.ts, icon: '💬', label: txt, detail: 'ربات نشان داد (متنِ نمونه)', micro: true });
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
      // ⚠️ دو واحدِ متفاوت در یک خط: `amount` پولِ واقعی (تومان) و `original_amount`
      // اعتبار (الماس در tarot). هرگز با هم مقایسه یا هم‌فرمت نمی‌شوند.
      const amt = moneyText(botKey, p[m.amountCol]);
      const credit = p.original_amount != null && p.original_amount !== p[m.amountCol]
        ? creditText(botKey, p.original_amount) : null;
      items.push({
        ts: toUnix(p.created_at), icon: '💳',
        label: `پرداخت #${p.id} — ${amt}` + (credit ? ` (اعتبار ${credit})` : '') + (p.tier ? ` · اشتراک ${p.tier}` : ''),
        detail: `${p.status}${p.step ? ` · مرحله: ${p.step}` : ''}`, status: p.status,
      });
    }
  }
  if (familyOf(botKey) === 'tarot' && hasTable(db, 'readings')) {
    for (const r of rows(db, 'SELECT * FROM readings WHERE user_id=? ORDER BY id DESC LIMIT 100', [uid])) {
      items.push({ ts: r.created_at, icon: '🔮', label: `فال ${r.type} — ${creditText(botKey, r.price)}`, detail: `${r.status}${r.feedback ? ` · بازخورد: ${r.feedback.slice(0, 60)}` : ''}`, status: r.status });
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
      + openStateCard(inst, uid)
      + `<div class="card"><h2>🕓 سشن‌ها و بازپخشِ مسیر</h2>
         <p class="muted">هر سشن = فعالیتِ پیوسته با فاصله‌ی کمتر از ۳۰ دقیقه. ردیف‌های کم‌رنگ، قدم‌های ریز
           (پیامی که ربات نشان داد یا دکمه‌ای که کاربر زد) هستند.</p>${tlHtml}</div>`
      + `<div class="card"><p class="muted">همین کاربر در ربات‌های دیگر: ${others}</p></div>`;
  }, `<div class="card"><p class="muted">دیتابیس در دسترس نیست.</p></div>`);
}

/* ===== 🛠 اقدام‌های دستیِ پشتیبانی =====
   قرارداد نشکستنی (همان مسیرِ تأییدِ رسید): داشبورد **هرگز مستقیم پول را دست نمی‌زند**.
   هر اقدام در جدولِ `admin_actions` خودِ ربات صف می‌شود و sweepِ ۶۰ثانیه‌ایِ ربات آن را با
   منطقِ واقعی (اعتبار + پیام به کاربر + ادامه‌ی فالِ رزروشده) اجرا می‌کند. دلیلش این است که
   داشبورد توکنِ ربات را ندارد و منطقِ پول باید تک‌منبع بماند؛ دو منبعِ حقیقت برای پول همان
   چیزی است که این هفته پنج بار ازش باگ درآمد. */
const SUPPORT_ACTIONS = {
  force_approve: 'تأیید دستیِ پرداخت',
  approve_accounting: 'ثبتِ درآمد بدونِ اعتبار',
  reject: 'ردِ پرداخت',
  credit: 'شارژ دستی',
  debit: 'کسرِ اعتبار',
  unlock_reading: 'بازکردنِ فالِ رزروشده',
};
const MAX_MANUAL = 5_000_000;   // سقفِ ایمنیِ یک اقدامِ دستیِ **تومانی** (ضدِ صفرِ اضافه)
// سقفِ جدا برای رباتِ الماسی: بعد از مهاجرتِ الماسِ بومی ضریب ۱ شد، پس اگر سقف از
// روی MAX_MANUAL ساخته می‌شد، ۵٬۰۰۰٬۰۰۰ **الماس** هم قبول می‌شد.
const MAX_MANUAL_COINS = 1_000;

// وضعیت‌های بازِ کاربر: چیزی که پشتیبانی باید در یک نگاه ببیند و بتواند تعیین تکلیف کند
function openStateCard(inst, uid) {
  const m = moneyOf(inst.bot);
  const coin = coinOf(inst.bot);   // null = ربات تومانی → فرم دقیقاً مثل قبل
  if (!inst.bot || !hasTable) return '';
  return withDb(inst.file, (db) => {
    if (!hasTable(db, 'admin_actions')) {
      return `<div class="card"><h2>🛠 اقدام‌های پشتیبانی</h2>
        <p class="muted">این ربات صفِ اقدامِ داشبوردی (<code>admin_actions</code>) ندارد.</p></div>`;
    }
    const cat = unixOf(m.createdKind, 'created_at');
    const pays = rows(db, `SELECT id, ${m.amountCol} AS amount, original_amount, status, step, ${cat} AS t
        FROM ${m.table} WHERE user_id=? AND status IN ('pending','waiting_review','rejected')
        ORDER BY id DESC LIMIT 12`, [uid]);
    const reads = hasTable(db, 'readings')
      ? rows(db, `SELECT id, type, price, created_at AS t FROM readings
          WHERE user_id=? AND status='pending_payment' ORDER BY id DESC LIMIT 12`, [uid]) : [];
    const queued = rows(db, 'SELECT id, action, payment_id, ref_id, amount FROM admin_actions WHERE done_at IS NULL ORDER BY id');
    const qFor = (a, id) => queued.some(q => q.action === a && (q.payment_id === id || q.ref_id === id));

    const hidden = `<input type="hidden" name="inst" value="${esc(inst.id)}"><input type="hidden" name="uid" value="${uid}">`;
    /* 🛠 دکمه‌ای که ربات اجرایش نمی‌کند اصلاً رندر نمی‌شود.
       🐛 چرا (۱۴۰۵/۰۶/۱۵، پیش از مرج): این صفحه شش اکشن صف می‌کرد و **هیچ گاردی**
       نداشت — نه سرِ رندر، نه سرِ نوشتن. sweepِ voice2text فقط approve/reject را
       می‌فهمد و بقیه را بی‌قید `markActionDone` می‌زند، پس «شارژ دستی» برای آن ربات
       یعنی ردیفی که بی‌صدا done می‌شود و کاربر هیچ اعتباری نمی‌گیرد.
       امروز `assertColumns` تصادفاً جلویش را می‌گیرد (voice2text ستون‌های
       user_id/amount/ref_id/note را ندارد)، ولی آن یک گاردِ **اتفاقی** است: اولین
       مهاجرتِ افزایشیِ بی‌ضررِ آینده سبزش می‌کند و سیاه‌چاله برمی‌گردد. پس گارد باید
       روی خودِ قرارداد بنشیند، نه روی شکلِ جدول. */
    const btns = (list, extra = '') => {
      const on = list.filter(([a]) => adminActionSupported(inst.bot, a));
      return on.length ? `<form method="post" action="/support/action" style="display:inline">${hidden}${extra}`
        + on.map(([a, label, cls]) =>
          `<button name="act" value="${a}" type="submit"${cls ? ` class="${cls}"` : ''}>${label}</button>`).join('')
        + '</form>' : '';
    };
    const payRows = pays.map(p => [
      `#${p.id}`,
      `${fmt(toToman(inst.bot, p.amount))} ت` +
        (p.original_amount && p.original_amount !== p.amount
          ? ` <span class="muted">(اعتبار ${esc(creditText(inst.bot, p.original_amount))})</span>` : ''),
      statusBadge(p.status),
      esc(p.step || '-'),
      tehranDateTime(p.t),
      qFor('force_approve', p.id) || qFor('reject', p.id) || qFor('approve_accounting', p.id)
        ? '<span class="badge warn">در صف (تا ۱ دقیقه)</span>'
        : (btns([['force_approve', '✅ تأیید + اعتبار', ''], ['approve_accounting', '🧾 فقط درآمد', 'ghost'],
          ['reject', '❌ رد', 'ghost']], `<input type="hidden" name="pid" value="${p.id}">`)
          || '<span class="muted">این ربات اجرا نمی‌کند</span>'),
    ]);
    const readRows = reads.map(r => [
      `#${r.id}`, esc(r.type), `${fmt(r.price)} ت`, tehranDateTime(r.t),
      qFor('unlock_reading', r.id)
        ? '<span class="badge warn">در صف (تا ۱ دقیقه)</span>'
        : (btns([['unlock_reading', '🔓 پرداختش کن', '']], `<input type="hidden" name="rid" value="${r.id}">`)
          || '<span class="muted">این ربات اجرا نمی‌کند</span>'),
    ]);

    return `<div class="card"><h2>🛠 اقدام‌های پشتیبانی</h2>
      <p class="muted">هر اقدام در صفِ خودِ ربات می‌نشیند و تا ۱ دقیقه با منطقِ واقعی اجرا می‌شود
        (اعتبار + پیام به کاربر). داشبورد هیچ‌وقت مستقیم موجودی را دست نمی‌زند.</p>

      <h3 style="margin-top:14px;font-size:13px">پرداخت‌های باز و ردشده</h3>
      ${table(['شماره', 'مبلغ', 'وضعیت', 'مرحله', 'زمان', 'اقدام'], payRows, 'پرداختِ بازی نیست')}
      <p class="muted"><b>✅ تأیید + اعتبار</b> روی پرداختِ <b>ردشده</b> هم کار می‌کند: درآمد
        به‌اندازه‌ی مبلغِ واریزشده بالا می‌رود <i>و</i> کاربر اعتبارِ کاملِ اصل را می‌گیرد
        (همان دو ستونِ amount و original_amount).<br>
        <b>🧾 فقط درآمد</b> برای وقتی است که پول واقعاً رسیده ولی کاربر ارزشش را از راهِ دیگری
        گرفته (جبرانِ دستی یا کدِ هدیه): وضعیت approved می‌شود تا درآمد درست شمرده شود، ولی
        <b>هیچ اعتباری داده نمی‌شود و هیچ پیامی به کاربر نمی‌رود</b>. برای دوبار جبران‌نکردن.</p>

      <h3 style="margin-top:14px;font-size:13px">فال‌های منتظرِ پرداخت</h3>
      ${table(['شماره', 'نوع', 'قیمت', 'زمان', 'اقدام'], readRows, 'فالِ منتظرِ پرداختی نیست')}

      <h3 style="margin-top:14px;font-size:13px">شارژ یا کسرِ دستی</h3>
      ${adminActionSupported(inst.bot, 'credit') || adminActionSupported(inst.bot, 'debit')
        ? `<form method="post" action="/support/action" class="inline">${hidden}
        <label>${coin ? `تعداد ${coin.name}` : 'مبلغ (تومان)'}<input type="number" name="amount" min="1" max="${coin ? MAX_MANUAL_COINS : MAX_MANUAL}" required style="width:140px"></label>
        <label>یادداشت<input type="text" name="note" maxlength="120" placeholder="دلیل (در دفتر ممیزی می‌ماند)"></label>
        ${adminActionSupported(inst.bot, 'credit') ? '<button name="act" value="credit" type="submit">➕ شارژ کن</button>' : ''}
        ${adminActionSupported(inst.bot, 'debit') ? '<button name="act" value="debit" type="submit" class="ghost">➖ کسر کن</button>' : ''}
      </form>`
        : '<p class="muted">sweepِ این ربات اکشنِ شارژ/کسرِ داشبوردی را اجرا نمی‌کند، پس فرمش نمایش داده نمی‌شود.</p>'}
      <p class="muted">${coin
        ? `عدد را به <b>${coin.name}</b> بنویس، نه تومان (این ربات کیفش ${coin.name}ی است). داشبورد خودش به واحدِ داخلی تبدیل می‌کند.`
        : ''} شارژِ دستی به کاربر پیام می‌دهد («مبلغ X توسط پشتیبانی اضافه شد») و اگر فالِ
        رزروشده داشته باشد خودکار ادامه‌اش می‌دهد. کسر بی‌صدا و با کفِ صفر است. هیچ‌کدام ردیفِ
        <code>payments</code> نمی‌سازند، پس درآمد را آلوده نمی‌کنند.</p>
    </div>`;
  }, '');
}

export function supportAction(body) {
  const inst = getInstance(body.get('inst') || '');
  if (!inst) throw new Error('ربات نامعتبر');
  const uid = parseInt(body.get('uid'), 10);
  if (!uid) throw new Error('کاربر نامعتبر');
  const act = body.get('act') || '';
  if (!SUPPORT_ACTIONS[act]) throw new Error('اقدام نامعتبر');
  /* ⛔ گاردِ واقعی این‌جاست، نه سرِ رندر: فرمِ POST از هر جایی می‌آید (دکمه‌ی کهنه‌ی یک
     تبِ باز، یا یک ربات که در فاصله‌ی رندر و ارسال عوض شده). نبودِ این خط یعنی ردیف در
     صفِ رباتی بنشیند که آن را نمی‌فهمد، sweep بی‌صدا done علامتش بزند، و پیامِ سبزِ
     «در صف قرار گرفت» به مالک بگوید کار انجام شد در حالی که کاربر هیچ‌وقت اعتبارش را
     نمی‌گیرد. خطای صریح بی‌نهایت بهتر از موفقیتِ دروغین است (بند ۸ ریشه). */
  if (!adminActionSupported(inst.bot, act)) {
    throw new Error(`sweepِ «${inst.bot}» اکشنِ «${SUPPORT_ACTIONS[act]}» را اجرا نمی‌کند، `
      + 'پس این ردیف بی‌صدا در صف می‌مرد. یا از خودِ ربات انجامش بده، یا اول یک شاخه برایش '
      + 'در sweep بنویس و نامش را به `adminActions` در رجیستری اضافه کن.');
  }
  const note = (body.get('note') || '').slice(0, 120);

  let msg = '';
  withWritableDb(inst.file, (db) => {
    assertColumns(db, 'admin_actions', ['payment_id', 'action', 'user_id', 'amount', 'ref_id', 'note']);
    const ins = db.prepare(
      'INSERT INTO admin_actions (payment_id, action, user_id, amount, ref_id, note) VALUES (?,?,?,?,?,?)');
    const dupPay = (id) => db.prepare('SELECT 1 FROM admin_actions WHERE payment_id=? AND done_at IS NULL').get(id);

    if (act === 'force_approve' || act === 'reject' || act === 'approve_accounting') {
      const pid = parseInt(body.get('pid'), 10);
      if (!pid) throw new Error('شماره‌ی پرداخت نامعتبر');
      const p = db.prepare(`SELECT id, user_id, status FROM ${moneyOf(inst.bot).table} WHERE id=?`).get(pid);
      if (!p) throw new Error('پرداخت پیدا نشد');
      if (p.user_id !== uid) throw new Error('این پرداخت مالِ این کاربر نیست');
      const okFor = act === 'approve_accounting'
        ? ['pending', 'waiting_review', 'rejected', 'canceled']
        : ['pending', 'waiting_review', 'rejected'];
      if (!okFor.includes(p.status)) throw new Error(`روی وضعیتِ «${p.status}» این اقدام معنا ندارد`);
      if (dupPay(pid)) throw new Error('برای این پرداخت یک اقدام در صف است؛ صبر کن');
      ins.run(pid, act, uid, null, null, note);
      msg = `«${SUPPORT_ACTIONS[act]}» برای پرداخت #${pid} در صف ربات قرار گرفت`;
    } else if (act === 'unlock_reading') {
      const rid = parseInt(body.get('rid'), 10);
      if (!rid) throw new Error('شماره‌ی فال نامعتبر');
      const r = db.prepare('SELECT id, user_id, status, price FROM readings WHERE id=?').get(rid);
      if (!r) throw new Error('فال پیدا نشد');
      if (r.user_id !== uid) throw new Error('این فال مالِ این کاربر نیست');
      if (r.status !== 'pending_payment') throw new Error(`این فال «${r.status}» است، منتظرِ پرداخت نیست`);
      if (db.prepare("SELECT 1 FROM admin_actions WHERE action='unlock_reading' AND ref_id=? AND done_at IS NULL").get(rid)) {
        throw new Error('برای این فال یک اقدام در صف است؛ صبر کن');
      }
      ins.run(0, act, uid, r.price, rid, note);
      msg = `فال #${rid} (${creditText(inst.bot, r.price)}) در صف بازکردن قرار گرفت`;
    } else {
      // 💎 ورودی به زبانِ همان ربات است: برای رباتِ الماسی عدد = تعدادِ الماس و همین‌جا
      // به واحدِ داخلی تبدیل می‌شود. تبدیل عمداً **این‌جا** انجام می‌شود نه در sweepِ ربات:
      // ریلِ پول دست‌نخورده می‌ماند (بند ۹ ریشه) و `admin_actions.amount` همان معنیِ
      // همیشگی‌اش را دارد، پس ردیف‌های قدیمیِ در صف هم درست اجرا می‌شوند.
      const coin = coinOf(inst.bot);
      const raw = parseInt(body.get('amount'), 10);
      const unit = coin ? coin.name : 'تومان';
      const maxIn = coin ? MAX_MANUAL_COINS : MAX_MANUAL;
      if (!Number.isFinite(raw) || raw < 1 || raw > maxIn) {
        throw new Error(`عدد باید بین ۱ و ${fmt(maxIn)} ${unit} باشد`);
      }
      const amount = coin ? raw * coin.value : raw;
      ins.run(0, act, uid, amount, null, note);
      msg = `«${SUPPORT_ACTIONS[act]}» به مقدار ${fmt(raw)} ${unit} برای کاربر ${uid} در صف قرار گرفت`;
    }
  });
  audit('support.action', `${inst.id}/${uid}`, `${act} ${note}`.trim());
  return `${msg} (تا ۱ دقیقه اجرا می‌شود)`;
}
