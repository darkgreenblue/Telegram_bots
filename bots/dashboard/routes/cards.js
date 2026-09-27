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
import { botByKey, instancesOf, withDb, withWritableDb, assertColumns, hasTable, rows, cardsPageSupported, testUserClause, moneyText } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, tehranDateTime, parseJsonSafe, RANGES, rangeOf } from '../lib/util.js';
import { table, cardHead, rangePicker } from '../lib/html.js';
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

    // 🔄 مصرفِ امروزِ هر کارت: همان شمارشی که ربات برای سقف می‌خواند (v3.132.0) — پرداخت‌های
    // **تأییدشده** با `approved_at` از نیمه‌شبِ تهرانِ امروز (`CA.cardDayStartSec`).
    const today = CA.cardDay();
    const hasAt = hasApprovedAt(db);
    const usedToday = new Map(hasAt ? rows(db,
      "SELECT card_id, COUNT(*) AS c FROM payments WHERE status='approved' AND approved_at>=? AND card_id>0 GROUP BY card_id", // not-revenue: همان شمارشِ سقفِ ربات
      [CA.cardDayStartSec()]).map((r) => [r.card_id, r.c]) : []);
    const capCell = (c) => {
      const u = usedToday.get(c.id) || 0;
      if (!(Number(c.daily_cap) > 0)) return `${fmt(u)} <span class="muted">امروز · بی‌سقف</span>`;
      return `${fmt(u)} از ${fmt(c.daily_cap)}${CA.capFull(c, u) ? ' <b>(پر شد)</b>' : ''}`;
    };

    const bodyRows = cards.map((c) => [
      `#${c.id}`,
      c.active ? '✅ فعال' : '⏸ غیرفعال',
      c.kind === 'white' ? '🤍 سفید' : '💳 عادی',
      esc(c.bank || '-'),
      `<span class="mono">${esc(CA.fmtCardNo(c.number))}</span>`,
      esc(c.holder),
      `<span class="mono">${esc(c.admin_id)}</span>`,
      fmt(c.sort),
      capCell(c),
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

    return head + cardStatsCard(db, bot, url, cards) + `<div class="card">${cardHead('📋 کارت‌ها')}
        ${table(['#', 'وضعیت', 'نوع', 'بانک', 'شماره', 'صاحب کارت', 'ادمین', 'ترتیب', `مصرفِ امروز / سقف (${esc(today)})`, 'اقدام'],
          bodyRows, 'هیچ کارتی نیست')}
        <p class="muted">همیشه دستِ‌کم یک کارتِ <b>عادیِ فعال</b> لازم است؛ فاکتورِ تازه با آن صادر می‌شود.
          رسیدِ هر فاکتور با دکمه‌ها فقط برای ادمینِ همان کارت می‌رود.
          <br>🔁 کارتِ هر فاکتور بر اساسِ <b>مبلغِ همان فاکتور</b> انتخاب می‌شود و کاربر هیچ نقشی ندارد: بینِ
          کارت‌های عادیِ فعال، کارتی که امروز کمترین پرداختِ تأییدشده با همین مبلغ را داشته؛ اگر مساوی
          بودند، کارتی که فاکتورِ بازِ کمتری با همین مبلغ دارد؛ باز مساوی ⟵ به ترتیبِ «ترتیب». روز از
          ساعتِ ۰۰:۰۰ تهران شروع می‌شود. سقفِ روزانه اختیاری است (۰ = بی‌سقف)؛ کارتی که به سقفش برسد
          کنار می‌رود و اگر همه‌ی عادی‌ها پر شوند، کارتِ سفید.</p></div>`
      + queuedHtml + addForm(bot) + historyHtml;
  }, head + `<div class="card"><p class="muted">دیتابیس در دسترس نیست.</p></div>`);
}

/* 📊 فازِ ۸ (v3.129.0): آمارِ روزانه‌ی هر کارت. «روز» همان روزِ کارت است (از v3.132.0 مرزِ ۰۰:۰۰ تهران،
 * `CA.cardDay`)، همان روزی که سقف و چرخش با آن کار می‌کنند.
 *
 * ⚠️ صدور، تعویض و خطای انتقال از **رویدادهای** ربات شمرده می‌شوند، نه از ستونِ `payments.card_id`:
 * آن ستون بعد از تعویض/خطا/«پیامکش اومده» جابه‌جا می‌شود (`swapToPrev`)، پس شمارش از روی آن
 * فاکتورِ دیروزِ کارتِ الف را امروز به کارتِ ب نسبت می‌داد. رویداد لحظه‌ی رخداد ثبت شده و عوض نمی‌شود.
 * «تأییدشده» عیناً شمارشِ سقفِ ربات است (`approved_at`، حسابِ تستی هم، چون پولش روی همان کارت
 * نشسته)؛ «مبلغ» درآمد است و حسابِ تستی از آن بیرون است. روزِ هر تأیید از لحظه‌ی `approved_at`
 * ساخته می‌شود (نه ستونِ کهنه‌ی `approved_day` که مرزِ ۰۶:۰۰ را در خودش قفل کرده بود). */
const hasApprovedAt = (db) => rows(db, "SELECT 1 FROM pragma_table_info('payments') WHERE name='approved_at'").length > 0;
const CARD_STAT_RANGES = ['day', 'week', 'month'];
export function cardDays(n, nowMs = Date.now()) {
  const out = [];
  for (let i = 0; out.length < n && i < n + 2; i++) {
    const d = CA.cardDay(nowMs - i * 86400_000);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}
function cardStatsCard(db, bot, url, cards) {
  const rk = rangeOf(url, 'rCard', 'week');
  const key = CARD_STAT_RANGES.includes(rk) ? rk : 'week';
  const days = cardDays(RANGES[key].days);
  const inDays = new Set(days);
  const since = Math.floor(Date.now() / 1000) - (RANGES[key].days + 1) * 86400;
  const stat = new Map();   // `${day}|${card}` ⟵ {issued, switched, terr, approved, sum}
  const at = (day, card) => {
    const k = `${day}|${card}`;
    if (!stat.has(k)) stat.set(k, { day, card: Number(card), issued: 0, incoming: 0, switched: 0, terr: 0, approved: 0, sum: 0 });
    return stat.get(k);
  };
  if (hasTable(db, 'events')) {
    for (const e of rows(db, `SELECT event, props, created_at FROM events
        WHERE event IN ('card_assigned','card_switched','transfer_error_switch') AND created_at >= ?`, [since])) {
      const day = CA.cardDay(Number(e.created_at) * 1000);
      if (!inDays.has(day)) continue;
      const p = parseJsonSafe(e.props, {});
      if (e.event === 'card_assigned' && Number(p.card_id) > 0) at(day, p.card_id).issued++;
      else if (e.event === 'card_switched' && Number(p.from) > 0) at(day, p.from).switched++;
      else if (e.event === 'transfer_error_switch' && Number(p.from) > 0) at(day, p.from).terr++;
      /* 🔁 v3.132.0 (تصمیمِ مالک): فاکتوری که بعد از «تعویض شماره کارت» یا «نتوانستم واریز کنم» برای کارتِ **مقصد**
         دوباره فرستاده شد، ستونِ جدا دارد، نه جزوِ «صادرشده». «صادرشده» تعدادِ فاکتورهای یکتا می‌ماند تا جمع‌ها
         دو بار شمرده نشوند (یک فاکتور، دو پیام). */
      if ((e.event === 'card_switched' || e.event === 'transfer_error_switch') && Number(p.to) > 0) at(day, p.to).incoming++;
    }
  }
  if (hasApprovedAt(db)) {
    const real = new Set(rows(db, `SELECT id FROM payments WHERE status='approved' AND card_id>0 AND approved_at >= ?${testUserClause(bot)}`, [since]).map((r) => r.id)); // بدونِ حسابِ تستی (فقط برای مبلغ)
    for (const r of rows(db, "SELECT id, card_id, amount, approved_at FROM payments WHERE status='approved' AND card_id>0 AND approved_at >= ?", [since])) { // not-revenue: همان شمارشِ سقفِ ربات؛ مبلغ پایین‌تر بدونِ حسابِ تستی
      const day = CA.cardDay(Number(r.approved_at) * 1000);
      if (!inDays.has(day)) continue;
      const cell = at(day, r.card_id);
      cell.approved++;
      if (real.has(r.id)) cell.sum += Number(r.amount) || 0;
    }
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  const label = (id) => {
    const c = byId.get(id);
    return c ? `#${c.id} ${c.kind === 'white' ? '🤍' : '💳'} ${esc(c.bank || c.holder)} …${esc(String(c.number).slice(-4))}` : `#${id}`;
  };
  const all = [...stat.values()];
  const tot = new Map();
  for (const r of all) {
    const t = tot.get(r.card) || { card: r.card, issued: 0, incoming: 0, switched: 0, terr: 0, approved: 0, sum: 0 };
    for (const f of ['issued', 'incoming', 'switched', 'terr', 'approved', 'sum']) t[f] += r[f];
    tot.set(r.card, t);
  }
  const line = (r) => [fmt(r.issued), fmt(r.incoming), fmt(r.switched), fmt(r.terr), fmt(r.approved), moneyText(bot, r.sum)];
  const order = (a, b) => ((byId.get(a.card)?.sort ?? 1e9) - (byId.get(b.card)?.sort ?? 1e9)) || (a.card - b.card);
  const sumRows = [...tot.values()].sort(order).map((t) => [label(t.card), ...line(t)]);
  const dayRows = all.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : order(a, b)))
    .slice(0, 200).map((r) => [esc(r.day), label(r.card), ...line(r)]);
  const H = ['فاکتورِ صادرشده', 'فاکتور از تعویض', 'تعویض به کارتِ دیگر', 'خطای انتقال', 'تأییدشده', 'مبلغِ تأییدشده'];
  return `<div class="card">${cardHead('📊 آمارِ روزانه‌ی کارت‌ها', rangePicker(url, 'rCard', key, { keys: CARD_STAT_RANGES }))}
    ${table(['کارت', ...H], sumRows, 'در این بازه فعالیتی روی کارت‌ها ثبت نشده')}
    ${dayRows.length > 1 ? `<details style="margin-top:10px"><summary>تفکیکِ روزبه‌روز</summary>${table(['روزِ کارت', 'کارت', ...H], dayRows)}</details>` : ''}
    <p class="muted">روزِ کارت از ۰۰:۰۰ تهران شروع می‌شود (تا v3.131.0 از ۰۶:۰۰ بود). «فاکتورِ صادرشده» = هر بار که کاربر روی یک بسته زد
      و فاکتور گرفت (فاکتورِ یکتا). «فاکتور از تعویض» = فاکتوری که بعد از تعویض/خطای انتقال برای <b>این</b> کارت دوباره فرستاده
      شد. «تعویض» و «خطای انتقال» روی کارتی شمرده می‌شوند که کاربر <b>از آن</b> رفت. «تأییدشده» همان عددِ سقفِ روزانه است (با حسابِ تستی)؛ «مبلغ» بدونِ حسابِ تستی.
      صدور از v3.124.0 و خطای انتقال از v3.127.0 ثبت می‌شوند؛ روزهای قبل‌تر در این ستون‌ها صفرند.</p></div>`;
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
