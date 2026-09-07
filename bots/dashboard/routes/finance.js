// مالی: پرداخت‌های همه‌ی ربات‌ها (schema-agnostic با پروفایل) + فیلتر + CSV (با audit) + دفتر ممیزی
// هر ربات جدول/ستون/واحد مالی خودش را دارد (payments/امتیاز تومان vs transactions/amount_rial)؛
// این‌جا همه به یک رکورد نرمالِ تومان تبدیل می‌شوند تا جدول و جمع‌ها قابل‌مقایسه بمانند.
import { instancesOf, getInstance, withDb, withWritableDb, assertColumns, hasTable, rows, scalar, moneyOf, unixOf, toToman, receiptQueueSupported, revenueWhere, creditText, creditNum, coinOf, coinLegacyFloorOf } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { listAudit, audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, nowSec, tehranDayStart, tehranDayStr } from '../lib/util.js';
import { table, statusBadge, stat } from '../lib/html.js';

// وضعیت‌های همه‌ی مدل‌های مالی (کیف‌پول + اشتراک tabir)
const STATUSES = ['', 'pending', 'waiting_review', 'approved', 'paid', 'rejected', 'cancelled', 'canceled'];

// توضیح هر وضعیت (راهنمای کاربر) — cancelled/canceled یک معنی دارند (املای دو ربات فرق دارد)
const STATUS_LEGEND = [
  ['pending', 'کاربر دکمه‌ی شارژ را زده ولی هنوز رسید نفرستاده (اغلب مبلغ ۰ = حتی مبلغ هم وارد نکرده). شروع ناتمام، نه پول واقعی.'],
  ['waiting_review', 'رسید فرستاده و منتظر تأیید توست. تنها وضعیتی که از تو کار می‌خواهد.'],
  ['approved / paid', 'تأیید شد و اعتبار/اشتراک فعال شد. (paid = مدل اشتراکی تعبیر خواب.)'],
  ['rejected', 'رسید را رد کردی.'],
  ['cancelled / canceled', 'کاربر خودش وسط فلوی شارژ انصراف داد. (دو املا = voice2text با دو L، تاروت با یک L؛ یک معنی.)'],
];

function readFilters(url) {
  const bot = scopeBot(url);
  // instance فقط وقتی معتبر است که به همان رباتِ انتخاب‌شده تعلق داشته باشد
  // (وگرنه یک instId کهنه در URL، صفحه را روی رباتِ دیگری باز می‌کرد).
  const asked = url.searchParams.get('inst') || '';
  const instId = getInstance(asked)?.bot === bot ? asked : '';
  const status = STATUSES.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '';
  const days = Math.max(0, parseInt(url.searchParams.get('days') || '30', 10) || 0); // 0 = همه
  return { bot, instId, status, days };
}

// یک رکورد نرمالِ مشترک برای همه‌ی ربات‌ها (مبلغ به تومان)
function collectPayments({ bot, instId, status, days }) {
  const since = days ? nowSec() - days * 86400 : 0;
  const targets = instId ? [getInstance(instId)].filter(Boolean) : instancesOf(bot);
  const all = [];
  for (const inst of targets) {
    withDb(inst.file, (db) => {
      const m = moneyOf(inst.bot);
      if (!hasTable(db, m.table)) return;
      // اقدام‌های در صفِ ربات (تأیید/رد enqueue شده که هنوز sweep اجرا نکرده) — برای نشان‌دادن «در صف»
      const pendingActs = (receiptQueueSupported(inst.bot) && hasTable(db, 'admin_actions'))
        ? new Map(rows(db, 'SELECT payment_id, action FROM admin_actions WHERE done_at IS NULL').map(a => [a.payment_id, a.action]))
        : new Map();
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
          // 💎 متنِ خوانای اعتبار به زبانِ همان ربات. برای پرداختِ بسته، original_amount
          // اعتبار به واحدِ داخلی است (۱۰۰ الماس = ۱٬۰۰۰٬۰۰۰) و چاپش به‌عنوان تومان
          // عددِ بی‌معنی می‌داد. ستونِ CSV عمداً خام می‌ماند (دیتای تحلیل).
          originalText: p.original_amount != null ? creditText(inst.bot, p.original_amount) : null,
          status: p.status,
          step: p.step ?? (p.tier ? `اشتراک ${p.tier}` : null), // tabir: به‌جای مرحله، نوع اشتراک
          pendingAction: pendingActs.get(p.id) || null, // approve|reject در صف، یا null
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

  const instOptions = ['<option value="">همه‌ی نسخه‌های این ربات</option>',
    ...instancesOf(f.bot).map(i => `<option value="${esc(i.id)}" ${i.id === f.instId ? 'selected' : ''}>${esc(i.title)}</option>`)].join('');
  const statusOptions = STATUSES.map(s => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${s || 'همه‌ی وضعیت‌ها'}</option>`).join('');
  const filterForm = `<form method="get" action="/finance" class="inline">
    <input type="hidden" name="bot" value="${esc(f.bot)}">
    <label>نسخه<select name="inst">${instOptions}</select></label>
    <label>وضعیت<select name="status">${statusOptions}</select></label>
    <label>بازه<select name="days">
      ${[['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز'], ['0', 'همه']].map(([v, l]) => `<option value="${v}" ${Number(v) === f.days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <button type="submit">فیلتر</button>
    <a href="/finance.csv?bot=${encodeURIComponent(f.bot)}&inst=${encodeURIComponent(f.instId)}&status=${f.status}&days=${f.days}"><button type="button" class="ghost">⬇ CSV</button></a>
  </form>`;

  const rowsHtml = all.slice(0, 150).map((p) => {
    const pending = moneyOf(p.inst.bot).pendingStatus;
    const canAct = receiptQueueSupported(p.inst.bot) && p.status === pending;
    const actionCell = canAct
      ? `<form method="post" action="/finance/action" style="display:inline">
          <input type="hidden" name="inst" value="${esc(p.inst.id)}"><input type="hidden" name="pid" value="${p.id}">
          <button name="act" value="approve" type="submit">✅ تأیید</button>
          <button name="act" value="reject" type="submit" class="ghost">❌ رد</button></form>`
      : (p.pendingAction ? `<span class="badge warn">در صف ${esc(p.pendingAction)} (تا ۱ دقیقه)</span>` : '');
    return [
      esc(p.inst.title),
      `#${p.id}`,
      `<a href="/support/user?inst=${encodeURIComponent(p.inst.id)}&id=${p.userId}" class="mono">${p.userId}</a>`,
      fmt(p.amount) + ' ت' + (p.original && p.original !== p.amount ? ` <span class="muted">(اعتبار ${esc(p.originalText)})</span>` : ''),
      statusBadge(p.status),
      esc(p.step || '-'),
      tehranDateTime(p.created),
      actionCell,
    ];
  });

  const auditHtml = table(
    ['زمان', 'عمل', 'هدف', 'جزئیات'],
    listAudit(30).map(a => [tehranDateTime(a.created_at), esc(a.action), esc(a.target), `<span class="muted">${esc(a.details)}</span>`]),
    'خالی'
  );

  const legend = `<div class="card"><h2>ℹ️ معنی وضعیت‌ها</h2>
  ${table(['وضعیت', 'یعنی چه'], STATUS_LEGEND.map(([s, d]) => [statusBadge(s.split(' ')[0]), esc(d)]))}</div>`;

  return `<div class="card"><h2>💰 مالی</h2>${filterForm}<div class="grid" style="margin-top:12px">${totalsHtml}</div></div>
  <div class="card"><h2>پرداخت‌ها (${fmt(all.length)}${all.length > 150 ? ' — نمایش ۱۵۰ ردیف اول' : ''})</h2>
  ${table(['ربات', 'شماره', 'کاربر', 'مبلغ', 'وضعیت', 'مرحله/اشتراک', 'ساخت', 'اقدام'], rowsHtml)}
  <p class="muted">دکمه‌ی تأیید/رد فقط روی رسیدهای «منتظر تأیید» ربات‌های کیف‌پولی است؛ اقدام در صف ربات قرار می‌گیرد و تا ۱ دقیقه با منطق واقعی ربات (اعتبار + پیام به کاربر) اجرا می‌شود. مبلغ همه‌جا به تومان (اشتراک ریالی تعبیر خواب ÷۱۰).</p></div>
  ${legend}
  <div class="card"><h2>🧾 دفتر ممیزی داشبورد (writeها و exportها)</h2>${auditHtml}</div>`;
}

// تأیید/رد رسید از داشبورد: مستقیم پول را دست نمی‌زنیم (منطق اعتبار + پیام به کاربر فقط سمت ربات است)؛
// اقدام را در جدول admin_actions همان ربات enqueue می‌کنیم و sweepِ ۶۰ثانیه‌ایِ ربات با منطق واقعی اجرا می‌کند.
export function financeAction(body) {
  const inst = getInstance(body.get('inst') || '');
  if (!inst) throw new Error('ربات نامعتبر');
  if (!receiptQueueSupported(inst.bot)) throw new Error('این ربات صف تأیید داشبوردی ندارد');
  const pid = parseInt(body.get('pid'), 10);
  if (!pid) throw new Error('شماره‌ی پرداخت نامعتبر');
  const act = body.get('act') === 'reject' ? 'reject' : 'approve';

  withWritableDb(inst.file, (db) => {
    assertColumns(db, 'admin_actions', ['payment_id', 'action']);
    // فقط رسیدِ «منتظر تأیید» و بدون اقدامِ در صف — ضد دوبار enqueue و ضد اقدام روی رسید تأییدشده
    const p = db.prepare(`SELECT id, status FROM ${moneyOf(inst.bot).table} WHERE id=?`).get(pid);
    if (!p) throw new Error('پرداخت پیدا نشد');
    if (p.status !== moneyOf(inst.bot).pendingStatus) throw new Error(`این رسید دیگر «منتظر تأیید» نیست (وضعیت: ${p.status})`);
    const dup = db.prepare('SELECT 1 FROM admin_actions WHERE payment_id=? AND done_at IS NULL').get(pid);
    if (dup) throw new Error('برای این رسید یک اقدام در صف است؛ تا اجرا شدنش صبر کن');
    db.prepare('INSERT INTO admin_actions (payment_id, action) VALUES (?,?)').run(pid, act);
  });
  audit('finance.action', `${inst.id}/#${pid}`, act);
  return `اقدام «${act === 'approve' ? 'تأیید' : 'رد'}» برای پرداخت #${pid} در صف ربات قرار گرفت (تا ۱ دقیقه اجرا می‌شود)`;
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

/* ===== هزینه‌ها vs درآمد (روزانه) =====
   «هزینه» این‌جا یعنی **اعتباری که مجانی دادیم** و **تخفیفی که از درآمد گذشتیم** — هر دو به
   تومان و مستقیماً با درآمد قابل‌مقایسه. منبع: رویدادِ `credit_granted` (props: amount, kind)
   و جدولِ `discount_uses`. مرزِ روز همیشه تهران است (قرارداد بند ۲الف ریشه).
   ⚠️ هزینه‌ی LLM این‌جا نیست: هیچ ربات این ریپو مصرفِ توکن را ثبت نمی‌کند، پس عددی که
   نداریم را نمی‌سازیم. برای واردکردنش یا باید per-call هزینه ثبت شود یا از OpenRouter خوانده. */
export const COST_KINDS = { welcome: 'خوش‌آمد', streak: 'استریک', referral: 'رفرال', '': 'سایر' };

export function collectDaily(days, botKey) {
  const since = tehranDayStart(-(days - 1));
  const day = new Map(); // 'YYYY-MM-DD' → { rev, gift, disc, kinds:{} }
  const at = (d) => { if (!day.has(d)) day.set(d, { rev: 0, gift: 0, giftCoins: 0, disc: 0, kinds: {} }); return day.get(d); };
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      const m = moneyOf(inst.bot);
      // درآمدِ تأییدشده — از تک‌منبعِ revenueWhere (فیلترِ پرداختِ شبیه‌سازی‌شده‌ی tabir هم داخلش است)
      const rw = revenueWhere(inst.bot, '?');
      if (hasTable(db, rw.table)) {
        const catExpr = unixOf(m.createdKind, 'created_at');
        for (const r of rows(db, `SELECT ${catExpr} AS t, ${rw.amountCol} AS a FROM ${rw.table} WHERE ${rw.where}`, [since])) {
          at(tehranDayStr(r.t)).rev += toToman(inst.bot, r.a) || 0;
        }
      }
      // اعتبارِ هدیه‌شده. ⚠️ برای رباتِ الماسی این عدد **الماس** است و هرگز با تومان
      // جمع نمی‌شود (سطلِ جدا). دلیلِ حسابداری‌اش در کامنتِ costsBody پایین.
      if (hasTable(db, 'events')) {
        const coin = coinOf(inst.bot);
        for (const r of rows(db, `SELECT created_at AS t,
               COALESCE(json_extract(props,'$.amount'), 0) AS a,
               COALESCE(json_extract(props,'$.kind'), '') AS k
             FROM events WHERE event='credit_granted' AND created_at >= ?`, [since])) {
          const d = at(tehranDayStr(r.t));
          if (coin) { d.giftCoins += creditNum(inst.bot, r.a) || 0; }
          else { d.gift += toToman(inst.bot, r.a) || 0; }
          d.kinds[r.k] = (d.kinds[r.k] || 0) + (creditNum(inst.bot, r.a) || 0);
        }
      }
      // تخفیفِ داده‌شده (درآمدِ ازدست‌رفته)
      if (hasTable(db, 'discount_uses')) {
        for (const r of rows(db, 'SELECT used_at AS t, discount_amount AS a FROM discount_uses WHERE used_at >= ?', [since])) {
          at(tehranDayStr(r.t)).disc += toToman(inst.bot, r.a) || 0;
        }
      }
    });
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = tehranDayStr(tehranDayStart(-i));
    out.push({ d, ...(day.get(d) || { rev: 0, gift: 0, giftCoins: 0, disc: 0, kinds: {} }) });
  }
  return out;
}

/* اقتصادِ الماس (تجمعی، نه روزانه): چهار عددی که با هم یک ترازنامه‌ی ساده می‌سازند.
   صادرشده(هدیه) + خریداری‌شده = واردشده ؛ مصرف‌شده = بازخریدشده ؛ مانده = بدهیِ معوق. */
export function coinEconomy(botKey) {
  const out = [];
  for (const inst of instancesOf(botKey)) {
    const coin = coinOf(inst.bot);
    if (!coin) continue;
    withDb(inst.file, (db) => {
      const g = hasTable(db, 'events')
        ? scalar(db, "SELECT COALESCE(SUM(COALESCE(json_extract(props,'$.amount'),0)),0) FROM events WHERE event='credit_granted'")
        : 0;
      const m = moneyOf(inst.bot);
      /* 💎 **فقط ردیف‌هایی که واحدشان واقعاً الماس است.**
         🐛 گزارشِ مالک ۱۴۰۵/۰۶/۱۶: «خریداری‌شده ۶۳۵٬۹۵۹💎 — محاله». درست هم بود:
         ستونِ `original_amount` در دوره‌ی تومانی **تومان** بود و در دوره‌ی الماس
         **تعدادِ الماس**، و این جمع هر دو را با هم می‌ریخت. روی دیتای زنده:
         ۱۳ ردیفِ تومانی جمعاً ۶۳۵٬۰۰۰ + ۳۸ ردیفِ الماسی جمعاً ۹۵۹ = همان ۶۳۵٬۹۵۹.
         جداکننده `coinLegacyFloor` است (شکافِ ساختاریِ ۱۰۰ الماس ↔ ۱۰٬۰۰۰ تومان).
         ردیف‌های تومانی **حذف نمی‌شوند، جدا گزارش می‌شوند** — عددی که بی‌صدا کنار
         گذاشته شود همان‌قدر گمراه‌کننده است که عددی که بی‌صدا جمع شود. */
      const floor = coinLegacyFloorOf(inst.bot);
      const orig = `COALESCE(original_amount, ${m.amountCol})`;
      const boughtWhere = floor ? ` AND ${orig} < ${floor}` : '';
      const bought = hasTable(db, m.table)
        ? scalar(db, `SELECT COALESCE(SUM(${orig}),0) FROM ${m.table} WHERE status=?${boughtWhere}`, [m.successStatus])
        : 0;
      const legacy = (floor && hasTable(db, m.table))
        ? db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(${orig}),0) s FROM ${m.table} WHERE status=? AND ${orig} >= ${floor}`).get(m.successStatus)
        : { n: 0, s: 0 };
      const spent = hasTable(db, 'readings')
        ? scalar(db, "SELECT COALESCE(SUM(price),0) FROM readings WHERE status='delivered'")
        : 0;
      const held = scalar(db, 'SELECT COALESCE(SUM(balance),0) FROM users');
      out.push({
        inst, coin,
        gifted: creditNum(inst.bot, g),
        bought: creditNum(inst.bot, bought),
        spent: creditNum(inst.bot, spent),
        held: creditNum(inst.bot, held),
        legacyRows: legacy.n, legacyToman: legacy.s,
      });
    });
  }
  return out;
}

/* 🗑 `costsBody` حذف شد (۱۴۰۵/۰۶/۱۵ — ایرادِ صریحِ مالک: «چرا الان دو قسمت داره؟»).
   یک صفحه‌ی کاملِ دومِ «هزینه‌ها و درآمد» بود که داخلِ صفحه‌ی اقتصاد embed می‌شد، با
   `<h1>` خودش، **انتخابگرِ بازه‌ی جداگانه‌ی خودش** (۷/۳۰/۹۰/۱۸۰ روز، پیش‌فرض ۳۰) و
   عددِ «درآمدِ دریافتی»ِ خودش. یعنی یک صفحه، سه عددِ درآمد، سه بازه‌ی مستقل. کاربر
   حق داشت گیج شود؛ این تعریفِ ساختاریِ تناقض است، نه یک باگِ نمایشی.
   محتوای ارزشمندش (اقتصادِ الماس، تفکیکِ هدیه، تخفیفِ گزارشی) به کارت‌های
   `economics.js` منتقل شد و همان‌جا از **همان** بازه‌ی صفحه پیروی می‌کند.
   مسیرِ `/costs` هم حذف شد (در منو نبود و فقط با تایپِ دستیِ URL دیده می‌شد)، ولی
   به‌جای ۴۰۴ به `/economics` **ریدایرکت** می‌شود: بوکمارکِ کهنه‌ای که ۴۰۴ بدهد به مالک
   می‌گوید «داشبورد خراب شد»، نه «محتوا جابه‌جا شد». */
