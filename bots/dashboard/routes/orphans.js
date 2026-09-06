// 🧾 پرداخت‌های سرگردان — پولی که رسید، ولی کاربرش معلوم نیست.
//
// مسئله‌ی واقعی (مالک، ۱۴۰۵/۰۶/۱۵): کاربر کارت‌به‌کارت می‌کند و یادش می‌رود رسید را
// به ربات بفرستد. پول در حساب هست، ولی در جدولِ `payments` ربات **هیچ ردیفی ندارد**،
// پس نه در درآمد می‌آید نه کسی می‌داند مالِ کیست.
//
// این صفحه سه کار می‌کند و هر سه عمدی‌اند:
//   ۱) ثبتِ دستیِ آن پول با همه‌ی نشانه‌هایش (مبلغ، تاریخ، بسته، شماره‌ی پیگیری،
//      یادداشت، اسکرین‌شات) تا بعداً قابلِ تطبیق باشد.
//   ۲) شمردنش در درآمد — چون پولِ واقعی است و نبودنش سود را کم‌برآورد می‌کند.
//   ۳) دکمه‌ی «صاحبش پیدا شد» با **دو** مسیرِ متفاوت که تفاوتشان حسابداری است:
//        • «رسید را دیر فرستاد» → پرداختش حالا از مسیرِ خودِ ربات ثبت شده، پس این
//          ردیف باید از درآمد **خارج** شود وگرنه یک پول دو بار شمرده می‌شود.
//        • «به پشتیبانی پیام داد» → هیچ ردیفی در ربات نیست، پس این ردیف در درآمد
//          **می‌ماند** و به‌جایش الماسش به کاربر داده می‌شود.
//      این انتخاب سلیقه‌ای نیست؛ هر کدامِ دیگری یا پول را ناپدید می‌کند یا دو برابر.
//
// دادنِ الماس از مسیرِ موجود می‌رود (`admin_actions` + sweepِ خودِ ربات)، نه مستقیم:
// داشبورد هرگز پول و اعتبار را دست نمی‌زند (قراردادِ بند ۹ ریشه).
import { botByKey, instancesOf, getInstance, withWritableDb, assertColumns, hasTable, coinOf, creditText } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, nowSec, tehranDayStr } from '../lib/util.js';
import { stat, table, cardHead } from '../lib/html.js';
import { addOrphan, listOrphans, getOrphan, resolveOrphan, deleteOrphan, audit } from '../lib/platform.js';

const MAX_AMOUNT = 50_000_000;   // سقفِ عاقلانه‌ی یک کارت‌به‌کارت؛ جلوی صفرِ اضافی را می‌گیرد
const MAX_COINS = 10_000;

const STATUS_FA = {
  orphan: '🟡 صاحبش پیدا نشده',
  resolved_support: '✅ از راه پشتیبانی (الماس داده شد)',
  resolved_late: '↩️ رسید را دیر فرستاد (از درآمد خارج)',
};

/** تاریخِ ورودیِ فرم (YYYY-MM-DD) → ثانیه‌ی ظهرِ همان روزِ تهران. */
function dayToSec(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0) / 1000;
  return Number.isFinite(t) ? t - 12600 : null;
}

export function orphansBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  const coin = coinOf(bot);
  const list = listOrphans(bot);
  const open = list.filter(r => r.status === 'orphan');
  const counted = list.filter(r => r.status !== 'resolved_late');
  const sum = (a) => a.reduce((x, r) => x + (Number(r.amount) || 0), 0);
  const today = tehranDayStr(nowSec());

  const rowsHtml = list.map(r => [
    esc(tehranDayStr(r.paid_at)),
    `<b>${fmt(r.amount)}</b> ت`,
    r.pkg ? esc(r.pkg) : '<span class="muted">-</span>',
    r.coins ? (coin ? creditText(bot, r.coins) : fmt(r.coins)) : '<span class="muted">-</span>',
    esc(r.ref || '') || '<span class="muted">-</span>',
    `${esc(STATUS_FA[r.status] || r.status)}${r.owner_id ? ` <span class="mono">${r.owner_id}</span>` : ''}`,
    `${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}${r.shot ? `<div class="muted mono">${esc(r.shot)}</div>` : ''}`,
    r.status === 'orphan' ? ownerForm(bot, r, coin) : `<form method="post" action="/orphans/delete" class="inline">
        <input type="hidden" name="bot" value="${esc(bot)}"><input type="hidden" name="id" value="${r.id}">
        <button type="submit" class="ghost">حذف ردیف</button></form>`,
  ]);

  return `<div class="card"><h2 style="margin:0">🧾 پرداخت‌های سرگردان — ${esc(title)}</h2>
      <p class="muted" style="margin:6px 0 0">پولی که به حساب رسیده ولی کاربر رسیدش را به ربات نفرستاده،
        پس ربات ازش خبر ندارد. این‌جا ثبتش کن تا در درآمد بیاید و بعداً قابلِ تطبیق باشد.</p></div>

    <div class="card">
      ${cardHead('➕ ثبتِ پرداختِ سرگردان')}
      <form method="post" action="/orphans/add" class="inline">
        <input type="hidden" name="bot" value="${esc(bot)}">
        <label>مبلغ (تومان)<input name="amount" type="number" min="1" max="${MAX_AMOUNT}" required placeholder="مثلاً 60000"></label>
        <label>تاریخ واریز<input name="paid" type="date" value="${esc(today)}" required></label>
        <label>بسته<input name="pkg" maxlength="24" placeholder="basic / gold / magic"></label>
        <label>الماسِ متناظر<input name="coins" type="number" min="0" max="${MAX_COINS}" placeholder="مثلاً 30"></label>
        <label>شماره پیگیری / ۴ رقم آخر<input name="ref" maxlength="64" placeholder="اختیاری"></label>
        <label>اسکرین‌شات<input name="shot" maxlength="200" placeholder="نام یا لینکِ فایل"></label>
        <label>یادداشت<input name="note" maxlength="300" placeholder="اختیاری"></label>
        <button type="submit">ثبت</button>
      </form>
      <p class="muted" style="margin-top:8px">«الماسِ متناظر» را حتماً پر کن: اگر بعداً صاحبش
        از راهِ پشتیبانی پیدا شود، همین عدد به او داده می‌شود.</p>
    </div>

    <div class="card">
      ${cardHead('📋 ردیف‌ها')}
      <div class="grid">
        ${stat('سرگردانِ باز', fmt(open.length))}
        ${stat('مبلغِ سرگردانِ باز', `${fmt(sum(open))} ت`)}
        ${stat('در درآمد شمرده می‌شود', `${fmt(sum(counted))} ت`)}
      </div>
      ${table(['تاریخ واریز', 'مبلغ', 'بسته', 'الماس', 'پیگیری', 'وضعیت', 'توضیح', 'اقدام'],
        rowsHtml, 'هنوز پرداختِ سرگردانی ثبت نشده')}
      <p class="muted">ردیفِ «رسید را دیر فرستاد» از درآمد <b>خارج</b> می‌شود چون پرداختش
        حالا از مسیرِ خودِ ربات ثبت شده و ماندنش یعنی یک پول دو بار شمرده شود. ردیفِ
        «از راه پشتیبانی» در درآمد <b>می‌ماند</b>، چون هیچ‌وقت در ربات ثبت نشد.</p>
    </div>`;
}

/** دو مسیرِ «صاحبش پیدا شد»، هر کدام یک فرمِ جدا تا تپِ اشتباه ممکن نباشد. */
function ownerForm(bot, r, coin) {
  const unit = coin ? coin.name : 'تومان';
  return `<details class="msg"><summary>صاحبش پیدا شد</summary>
    <form method="post" action="/orphans/resolve" class="inline" style="margin-top:6px">
      <input type="hidden" name="bot" value="${esc(bot)}"><input type="hidden" name="id" value="${r.id}">
      <input type="hidden" name="kind" value="late">
      <button type="submit" class="ghost">رسید را دیر به ربات فرستاد</button>
      <span class="muted">(ردیف از درآمد خارج می‌شود)</span>
    </form>
    <form method="post" action="/orphans/resolve" class="inline" style="margin-top:6px">
      <input type="hidden" name="bot" value="${esc(bot)}"><input type="hidden" name="id" value="${r.id}">
      <input type="hidden" name="kind" value="support">
      <label>آی‌دی کاربر<input name="uid" type="number" min="1" required placeholder="عددی"></label>
      <button type="submit">به پشتیبانی پیام داد → ${fmt(r.coins)} ${esc(unit)} بده</button>
    </form>
    ${r.coins ? '' : '<p class="muted">⚠️ الماسِ متناظرِ این ردیف صفر است، پس گزینه‌ی پشتیبانی چیزی نمی‌دهد.</p>'}
  </details>`;
}

export function orphanAdd(body) {
  const bot = scopeBot(new URL(`http://x/?bot=${encodeURIComponent(body.get('bot') || '')}`));
  const amount = parseInt(body.get('amount'), 10);
  const paidAt = dayToSec(body.get('paid'));
  const coins = Math.max(0, parseInt(body.get('coins'), 10) || 0);
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_AMOUNT) throw new Error('مبلغ نامعتبر است');
  if (paidAt === null) throw new Error('تاریخ نامعتبر است');
  if (paidAt > nowSec() + 86400) throw new Error('تاریخ واریز در آینده است');
  if (coins > MAX_COINS) throw new Error('تعدادِ الماس نامعتبر است');
  const id = addOrphan({
    bot, amount, paidAt, coins,
    pkg: String(body.get('pkg') || '').slice(0, 24),
    ref: String(body.get('ref') || '').slice(0, 64),
    note: String(body.get('note') || '').slice(0, 300),
    shot: String(body.get('shot') || '').slice(0, 200),
  });
  audit('orphan.add', `${bot}/${id}`, `${amount} ت · ${coins} coin`);
  return `پرداختِ سرگردان #${id} ثبت شد و در درآمد می‌آید`;
}

export function orphanResolve(body) {
  const id = parseInt(body.get('id'), 10);
  const kind = String(body.get('kind') || '');
  const r = getOrphan(id);
  if (!r) throw new Error('ردیف پیدا نشد');
  if (r.status !== 'orphan') throw new Error('این ردیف قبلاً حل شده');

  if (kind === 'late') {
    if (!resolveOrphan(id, 'resolved_late')) throw new Error('گذار انجام نشد');
    audit('orphan.resolve', `${r.bot}/${id}`, 'late');
    return `ردیف #${id} بسته شد و از درآمد خارج شد (پرداختش از خودِ ربات ثبت شده)`;
  }
  if (kind !== 'support') throw new Error('نوع نامعتبر است');

  const uid = parseInt(body.get('uid'), 10);
  if (!Number.isFinite(uid) || uid < 1) throw new Error('آی‌دی کاربر نامعتبر است');
  if (!r.coins) throw new Error('الماسِ متناظرِ این ردیف صفر است؛ اول مقدارش را ثبت کن');

  /* الماس از مسیرِ موجود می‌رود: enqueue در `admin_actions` و اجرا توسط sweepِ خودِ ربات.
     ⚠️ گذارِ ردیف **بعد از** enqueue انجام می‌شود: اگر enqueue خطا بدهد، ردیف سرگردان
     می‌ماند و می‌شود دوباره تلاش کرد. ترتیبِ برعکس یعنی ردیف بسته شود و الماس نرود. */
  const inst = instancesOf(r.bot)[0];
  if (!inst) throw new Error('دیتابیسِ این ربات پیدا نشد');
  const coin = coinOf(r.bot);
  withWritableDb(inst.file, (db) => {
    if (!hasTable(db, 'admin_actions')) throw new Error('این ربات صفِ اقدامِ داشبوردی ندارد');
    assertColumns(db, 'admin_actions', ['payment_id', 'action', 'user_id', 'amount', 'ref_id', 'note']);
    db.prepare('INSERT INTO admin_actions (payment_id, action, user_id, amount, ref_id, note) VALUES (?,?,?,?,?,?)')
      .run(0, 'credit', uid, coin ? r.coins * coin.value : r.coins, null, `پرداختِ سرگردان #${id}`);
  });
  if (!resolveOrphan(id, 'resolved_support', uid)) throw new Error('گذار انجام نشد');
  audit('orphan.resolve', `${r.bot}/${id}`, `support uid=${uid} coins=${r.coins}`);
  return `${fmt(r.coins)} ${coin ? coin.name : 'تومان'} برای کاربر ${uid} در صف قرار گرفت (تا ۱ دقیقه)؛ ردیف در درآمد می‌ماند`;
}

export function orphanDelete(body) {
  const id = parseInt(body.get('id'), 10);
  const r = getOrphan(id);
  if (!r) throw new Error('ردیف پیدا نشد');
  if (r.status === 'orphan') throw new Error('ردیفِ باز حذف نمی‌شود؛ اول وضعیتش را مشخص کن');
  deleteOrphan(id);
  audit('orphan.delete', `${r.bot}/${id}`, r.status);
  return `ردیف #${id} حذف شد`;
}
