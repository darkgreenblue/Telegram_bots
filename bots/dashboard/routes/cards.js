// 💳 کارت‌های پرداخت — فازِ ۱cِ `bots/tarot/PAYMENT-V2-PLAN.md` (v3.123.0).
//
// همان کارِ دکمه‌ی «💳 کارت‌ها»ی داخلِ ربات، از داشبورد: فهرست، افزودن، فعال/غیرفعال،
// عادی/سفید، ویرایشِ نامِ صاحب/بانک/ادمین/ترتیب/سقف. **حذف و ویرایشِ شماره وجود ندارد**
// (دلیلش در `bots/tarot/cards-admin.js`).
//
// قرارداد نشکستنی (همان مسیرِ پشتیبانی و رسید): داشبورد **مستقیم روی جدولِ `cards` نمی‌نویسد**.
// هر تغییر یک ردیفِ `card_update` در `admin_actions` می‌شود و sweepِ ۶۰ثانیه‌ایِ ربات آن را
// اجرا می‌کند. سه دلیل:
//   ۱) کارت تعیین می‌کند پولِ کاربر کجا برود؛ منطقش باید تک‌منبع بماند (همان `planCardOp`).
//   ۲) خبرِ تغییر به مالک (خواسته‌ی صریحش) فقط از ربات ممکن است؛ داشبورد توکنِ ربات را ندارد.
//   ۳) اعتبارسنجی لحظه‌ی **اجرا** دوباره روی فهرستِ همان لحظه انجام می‌شود، پس تبِ کهنه
//      نمی‌تواند آخرین کارتِ عادیِ فعال را خاموش کند.
// داشبورد هم قبل از صف‌کردن همان `planCardOp` را صدا می‌زند تا خطا همین‌جا دیده شود، نه
// یک دقیقه بعد در تلگرام.
import { botByKey, instancesOf, withDb, withWritableDb, assertColumns, hasTable, rows, cardsPageSupported } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, tehranDateTime, parseJsonSafe } from '../lib/util.js';
import { table, cardHead } from '../lib/html.js';
import { audit } from '../lib/platform.js';
import * as CA from '../../tarot/cards-admin.js';

const FIELDS = ['holder', 'bank', 'admin', 'sort', 'cap'];

/** تنها instanceِ ربات؛ رباتِ چنددیتابیسی عمداً رد می‌شود (تغییر به زبانِ تصادفی نرود). */
function soleInstance(bot) {
  const insts = instancesOf(bot);
  if (insts.length !== 1) return null;
  return insts[0];
}

export function cardsBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  const head = `<div class="card"><h2 style="margin:0">💳 کارت‌های پرداخت — ${esc(title)}</h2>
    <p class="muted" style="margin:6px 0 0">هر تغییر در صفِ ربات می‌نشیند و تا ۱ دقیقه اجرا می‌شود؛
      نتیجه (موفق یا ناموفق) در تلگرام به مالک خبر داده می‌شود. حذف و ویرایشِ شماره‌ی کارت
      وجود ندارد: برای شماره‌ی تازه، کارتِ جدید بساز و قبلی را غیرفعال کن.</p></div>`;
  if (!cardsPageSupported(bot)) {
    return head + `<div class="card"><p class="muted">این ربات کارتِ پرداخت ندارد (ریلِ کارت‌به‌کارت فقط
      برای تاروتِ فارسی است) یا sweepش تغییرِ کارت را اجرا نمی‌کند.</p></div>`;
  }
  const inst = soleInstance(bot);
  if (!inst) return head + `<div class="card"><p class="muted">دیتابیسِ یکتای این ربات پیدا نشد.</p></div>`;

  return withDb(inst.file, (db) => {
    if (!hasTable(db, 'cards')) {
      return head + `<div class="card"><p class="muted">جدولِ <code>cards</code> هنوز ساخته نشده (ربات هنوز v3.122.0 را اجرا نکرده).</p></div>`;
    }
    const cards = rows(db, 'SELECT * FROM cards ORDER BY sort, id');
    const queued = hasTable(db, 'admin_actions')
      ? rows(db, "SELECT id, note, created_at FROM admin_actions WHERE action='card_update' AND done_at IS NULL ORDER BY id")
      : [];
    const history = hasTable(db, 'events')
      ? rows(db, "SELECT props, created_at FROM events WHERE event='card_changed' ORDER BY id DESC LIMIT 20")
      : [];

    const bodyRows = cards.map((c) => [
      `#${c.id}`,
      c.active ? '✅ فعال' : '⏸ غیرفعال',
      c.kind === 'white' ? '🤍 سفید' : '💳 عادی',
      esc(c.bank || '-'),
      `<span class="mono">${esc(CA.fmtCardNo(c.number))}</span>`,
      esc(c.holder),
      `<span class="mono">${esc(c.admin_id)}</span>`,
      fmt(c.sort),
      Number(c.daily_cap) > 0 ? `${fmt(c.daily_cap)} <span class="muted">(هنوز اعمال نمی‌شود)</span>` : '<span class="muted">ندارد</span>',
      cardActions(bot, c),
    ]);

    const queuedHtml = queued.length
      ? `<div class="card">${cardHead(`⏳ در صفِ ربات (${fmt(queued.length)})`)}
          <ul>${queued.map((q) => `<li class="muted">${esc(describeOp(parseJsonSafe(q.note, null)))} · ${esc(tehranDateTime(q.created_at))}</li>`).join('')}</ul></div>`
      : '';
    const historyHtml = `<div class="card">${cardHead('🕓 آخرین تغییرها')}
      ${table(['زمان', 'تغییر', 'از'], history.map((h) => {
        const p = parseJsonSafe(h.props, {});
        return [esc(tehranDateTime(h.created_at)), esc(p.what || ''), p.via === 'dashboard' ? 'داشبورد' : 'ربات'];
      }), 'هنوز تغییری ثبت نشده')}</div>`;

    return head + `<div class="card">${cardHead('📋 کارت‌ها')}
        ${table(['#', 'وضعیت', 'نوع', 'بانک', 'شماره', 'صاحب کارت', 'ادمین', 'ترتیب', 'سقفِ روزانه', 'اقدام'],
          bodyRows, 'هیچ کارتی نیست')}
        <p class="muted">همیشه دستِ‌کم یک کارتِ <b>عادیِ فعال</b> لازم است؛ فاکتورِ تازه با آن صادر می‌شود.
          رسیدِ هر فاکتور با دکمه‌ها فقط برای ادمینِ همان کارت می‌رود.</p></div>`
      + queuedHtml + addForm(bot) + historyHtml;
  }, head + `<div class="card"><p class="muted">دیتابیس در دسترس نیست.</p></div>`);
}

function hidden(bot, op, extra = '') {
  return `<input type="hidden" name="bot" value="${esc(bot)}"><input type="hidden" name="op" value="${op}">${extra}`;
}

function cardActions(bot, c) {
  const id = `<input type="hidden" name="id" value="${c.id}">`;
  return `<form method="post" action="/cards/action" class="inline">${hidden(bot, 'active', id)}
      <input type="hidden" name="value" value="${c.active ? 0 : 1}">
      <button type="submit" class="ghost">${c.active ? '⏸ غیرفعال کن' : '▶️ فعال کن'}</button></form>
    <form method="post" action="/cards/action" class="inline">${hidden(bot, 'kind', id)}
      <input type="hidden" name="value" value="${c.kind === 'white' ? 'regular' : 'white'}">
      <button type="submit" class="ghost">${c.kind === 'white' ? '🔁 عادی کن' : '🔁 سفید کن'}</button></form>
    <details class="msg"><summary>✏️ ویرایش</summary>
      <form method="post" action="/cards/action" class="inline" style="margin-top:6px">${hidden(bot, 'edit', id)}
        <label>فیلد<select name="field">${FIELDS.map((f) => `<option value="${f}">${esc(CA.FIELD_LABEL[f])}</option>`).join('')}</select></label>
        <label>مقدارِ تازه<input name="value" maxlength="40" required placeholder="بانک: - یعنی خالی · سقف: ۰ یعنی بی‌سقف"></label>
        <button type="submit">ذخیره</button>
      </form></details>`;
}

function addForm(bot) {
  return `<div class="card">${cardHead('➕ افزودنِ کارت')}
    <form method="post" action="/cards/action" class="inline">${hidden(bot, 'add')}
      <label>شماره‌ی ۱۶ رقمی<input name="number" inputmode="numeric" maxlength="24" required placeholder="6219-8619-…"></label>
      <label>نامِ صاحب کارت<input name="holder" maxlength="40" required></label>
      <label>بانک<input name="bank" maxlength="30" placeholder="مثلاً بلوبانک، یا -"></label>
      <label>آیدیِ عددیِ ادمین<input name="admin" inputmode="numeric" maxlength="15" required></label>
      <label>نوع<select name="kind"><option value="regular">💳 عادی</option><option value="white">🤍 سفید</option></select></label>
      <button type="submit">افزودن</button>
    </form>
    <p class="muted">ادمینِ کارت باید یک بار ربات را استارت کرده باشد؛ وگرنه رسیدهای این کارت تا آن
      موقع با دکمه به مالک می‌رسد (ربات همین را در تلگرام هم هشدار می‌دهد).</p></div>`;
}

/** توضیحِ خوانای یک ردیفِ صف (برای کارتِ «در صف»). */
function describeOp(op) {
  if (!op) return 'دستورِ خراب';
  if (op.op === 'add') return `افزودنِ کارتِ …${String(op.number || '').replace(/\D/g, '').slice(-4)}`;
  if (op.op === 'active') return `کارتِ #${op.id} ⟵ ${op.value ? 'فعال' : 'غیرفعال'}`;
  if (op.op === 'kind') return `کارتِ #${op.id} ⟵ ${op.value === 'white' ? 'سفید' : 'عادی'}`;
  if (op.op === 'edit') return `کارتِ #${op.id}: ${CA.FIELD_LABEL[op.field] || op.field}`;
  return 'دستورِ ناشناخته';
}

/** ساختِ دستور از فرم. فقط کلیدهای شناخته‌شده خوانده می‌شوند. */
export function opFromForm(body) {
  const op = String(body.get('op') || '');
  const id = parseInt(body.get('id'), 10);
  if (op === 'add') {
    return { op, number: String(body.get('number') || ''), holder: String(body.get('holder') || ''),
      bank: String(body.get('bank') || '-'), admin: String(body.get('admin') || ''), kind: String(body.get('kind') || '') };
  }
  if (op === 'active') return { op, id, value: body.get('value') === '1' ? 1 : 0 };
  if (op === 'kind') return { op, id, value: String(body.get('value') || '') };
  if (op === 'edit') return { op, id, field: String(body.get('field') || ''), value: String(body.get('value') || '') };
  return null;
}

export function cardsAction(body) {
  const bot = scopeBot(new URL(`http://x/?bot=${encodeURIComponent(body.get('bot') || '')}`));
  /* ⛔ گارد قبل از هر نوشتن (همان درسِ `support.js`): فرمِ POST از تبِ کهنه هم می‌آید، پس
     گاردِ رندر کافی نیست. رباتی که `card_update` را اجرا نکند ردیف را بی‌صدا done می‌کرد. */
  if (!cardsPageSupported(bot)) throw new Error('این ربات تغییرِ کارت از داشبورد را اجرا نمی‌کند');
  const inst = soleInstance(bot);
  if (!inst) throw new Error('دیتابیسِ یکتای این ربات پیدا نشد');
  const op = opFromForm(body);
  if (!op) throw new Error('دستورِ نامعتبر');

  let msg = '';
  withWritableDb(inst.file, (db) => {
    if (!hasTable(db, 'cards')) throw new Error('جدولِ cards هنوز ساخته نشده');
    assertColumns(db, 'admin_actions', ['payment_id', 'action', 'user_id', 'amount', 'ref_id', 'note']);
    // همان تک‌منبعِ اعتبارسنجیِ ربات، روی فهرستِ همین لحظه — خطا همین‌جا، نه یک دقیقه بعد.
    const plan = CA.planCardOp(op, db.prepare('SELECT * FROM cards').all());
    if (!plan.ok) throw new Error(plan.err);
    if (plan.noop) { msg = 'تغییری لازم نبود (مقدار از قبل همین است)'; return; }
    // ⚠️ فقط شکلِ **اعتبارسنجی‌شده** در صف می‌نشیند، نه ورودیِ خام؛ ربات دوباره می‌سنجدش.
    const a = plan.apply;
    const clean = a.t === 'add' ? { op: 'add', number: a.number, holder: a.holder, bank: a.bank === '' ? '-' : a.bank, admin: String(a.admin), kind: a.kind }
      : a.t === 'active' ? { op: 'active', id: a.id, value: a.value }
        : a.t === 'kind' ? { op: 'kind', id: a.id, value: a.value }
          : { op: 'edit', id: a.id, field: a.field, value: String(a.value === '' ? '-' : a.value) };
    db.prepare('INSERT INTO admin_actions (payment_id, action, user_id, amount, ref_id, note) VALUES (?,?,?,?,?,?)')
      .run(0, 'card_update', null, null, a.t === 'add' ? null : a.id, JSON.stringify(clean));
    msg = `«${plan.what}» در صفِ ربات قرار گرفت (تا ۱ دقیقه؛ نتیجه در تلگرام)`;
  });
  audit('cards.action', `${inst.id}`, JSON.stringify(op).slice(0, 200));
  return msg;
}
