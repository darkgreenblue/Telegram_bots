/* 💳 مدیریتِ کارت‌های پرداخت داخلِ ربات (v3.123.0، فازِ ۱bِ `PAYMENT-V2-PLAN.md`).
 *
 * ماژولِ **خالص**: هیچ import از npm، هیچ دیتابیس، هیچ تلگرام. فقط اعتبارسنجیِ ورودیِ مالک،
 * گاردهای «کارتِ آخر» و ساختِ متنِ صفحه‌ها. هندلرها در `index.js` اند و از همین‌جا می‌خوانند،
 * پس `tools/check-cards-admin.mjs` همین توابع را مستقیم اجرا می‌کند (نه کپیِ منطق).
 *
 * متن‌ها عمداً فارسیِ ثابت‌اند و در locale نیستند: این صفحه فقط برای **مالک** و فقط روی
 * رباتِ فارسی (ریلِ کارت‌به‌کارت) ساخته می‌شود؛ ربات‌های استارز اصلاً کارت ندارند. */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** ارقامِ فارسی/عربی ⟵ لاتین. */
export function latinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d);
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d));
  });
}

/** شماره‌ی کارت ⟵ ۱۶ رقمِ لاتینِ بدونِ فاصله و خط تیره، یا `null`. */
export function normCardNumber(s) {
  const d = latinDigits(s).replace(/[\s\-_.‌]/g, '');
  return /^\d{16}$/.test(d) ? d : null;
}

/** الگوریتمِ Luhn. همه‌ی کارت‌های بانکیِ ایران از آن پیروی می‌کنند، پس رقمِ اشتباه‌تایپ‌شده
 *  همین‌جا گرفته می‌شود نه وقتی کاربر به یک شماره‌ی ناموجود پول واریز کرده. */
export function luhnOk(num) {
  if (!/^\d{12,19}$/.test(num)) return false;
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** نمایشِ چهارتا-چهارتا (همان شکلِ فاکتور). */
export const fmtCardNo = (n) => String(n).replace(/(\d{4})(?=\d)/g, '$1-');

// سقف‌ها: هر عددی بالاتر از این‌ها تقریباً یقیناً اشتباهِ تایپی است.
const MAX_SORT = 999;
const MAX_CAP = 10000;

/**
 * اعتبارسنجیِ یک فیلد. خروجی: `{ ok: true, value }` یا `{ ok: false, err }`.
 * فیلدها: number | holder | bank | admin | sort | cap.
 * ⚠️ `number` فقط موقعِ **افزودن** پذیرفته می‌شود (ویرایشِ شماره عمداً وجود ندارد؛ پایین).
 */
export function parseCardField(field, raw) {
  const t = String(raw ?? '').trim();
  if (t.includes('\n')) return { ok: false, err: 'فقط یک خط بنویس.' };
  if (field === 'number') {
    const n = normCardNumber(t);
    if (!n) return { ok: false, err: 'شماره‌ی کارت باید دقیقاً ۱۶ رقم باشد.' };
    if (!luhnOk(n)) return { ok: false, err: 'این شماره‌ی کارت معتبر نیست؛ احتمالاً یک رقم اشتباه تایپ شده. دوباره بفرست.' };
    return { ok: true, value: n };
  }
  if (field === 'holder') {
    if (t.length < 2 || t.length > 40) return { ok: false, err: 'نامِ صاحب کارت باید بین ۲ تا ۴۰ حرف باشد.' };
    return { ok: true, value: t };
  }
  if (field === 'bank') {
    if (t === '-' || t === '—') return { ok: true, value: '' };
    if (t.length < 2 || t.length > 30) return { ok: false, err: 'نامِ بانک باید بین ۲ تا ۳۰ حرف باشد (یا «-» برای خالی).' };
    return { ok: true, value: t };
  }
  const d = latinDigits(t);
  if (field === 'admin') {
    if (!/^\d{5,15}$/.test(d)) return { ok: false, err: 'آیدیِ عددیِ تلگرامِ ادمین را بفرست (فقط رقم).' };
    return { ok: true, value: Number(d) };
  }
  if (field === 'sort') {
    if (!/^\d{1,3}$/.test(d) || Number(d) > MAX_SORT) return { ok: false, err: `ترتیب یک عدد بین ۰ تا ${MAX_SORT} است.` };
    return { ok: true, value: Number(d) };
  }
  if (field === 'cap') {
    if (!/^\d{1,5}$/.test(d) || Number(d) > MAX_CAP) return { ok: false, err: `سقفِ روزانه یک عدد بین ۰ تا ${MAX_CAP} است (۰ یعنی بی‌سقف).` };
    return { ok: true, value: Number(d) };
  }
  return { ok: false, err: 'فیلدِ ناشناخته.' };
}

// فیلدهای قابلِ ویرایش ⟵ ستونِ جدول. **`number` عمداً نیست:** فاکتورهای باز و رسیدهای
// در صف با `card_id` به همین ردیف اشاره می‌کنند، پس عوض‌کردنِ شماره یعنی فاکتوری که کاربر
// رویش به شماره‌ی قبلی پول زده، شماره‌ی تازه نشان بدهد و ایجنتِ رسید چهار رقمِ آخرِ اشتباه
// را بسنجد. شماره‌ی تازه = کارتِ تازه + غیرفعال‌کردنِ قبلی.
export const EDITABLE = Object.freeze({
  holder: 'holder', bank: 'bank', admin: 'admin_id', sort: 'sort', cap: 'daily_cap',
});
export const FIELD_LABEL = Object.freeze({
  number: 'شماره‌ی کارت', holder: 'نامِ صاحب کارت', bank: 'نامِ بانک', admin: 'آیدیِ ادمین',
  sort: 'ترتیب', cap: 'سقفِ روزانه',
});

// هیچ فاکتوری نباید بی‌کارت بماند: همیشه دستِ‌کم یک کارتِ **عادیِ فعال** لازم است
// (`defaultInvoiceCard` فقط کارتِ عادی را برای فاکتورِ تازه برمی‌دارد).
const activeRegular = (cards) => cards.filter((c) => c.active && c.kind === 'regular');
/** آیا غیرفعال‌کردنِ این کارت مجاز است؟ */
export function canDeactivate(cards, id) {
  const c = cards.find((x) => x.id === id);
  if (!c || !c.active) return true;
  return c.kind !== 'regular' || activeRegular(cards).length > 1;
}
/** آیا تبدیلِ این کارت از عادی به سفید مجاز است؟ */
export function canMakeWhite(cards, id) {
  const c = cards.find((x) => x.id === id);
  if (!c || c.kind !== 'regular' || !c.active) return true;
  return activeRegular(cards).length > 1;
}

const kindFa = (k) => (k === 'white' ? 'سفید' : 'عادی');
const adminFa = (id, ownerId) => `${id}${Number(id) === Number(ownerId) ? ' (شما)' : ''}`;
const capFa = (n) => (Number(n) > 0 ? `${n} پرداختِ تأییدشده در روز` : 'ندارد');

/** مصرفِ امروز (فازِ ۲). `used` اختیاری است: بدونش خط ساخته نمی‌شود و متن بیت‌به‌بیت قبلی است. */
const usedLine = (c, used) => {
  if (!used) return null;
  const u = Number(used.get?.(c.id)) || 0;
  return `امروز: ${u} پرداختِ تأییدشده${capFull(c, u) ? ' · 🔴 سقف پر شد' : ''}`;
};

/** یک کارت، چندخطی. */
export function cardBlock(c, ownerId, used) {
  return [
    `${c.active ? '✅' : '⏸'} ${kindFa(c.kind)} · ${c.bank || 'بدونِ نامِ بانک'}`,
    fmtCardNo(c.number),
    `${c.holder}`,
    `ادمین: ${adminFa(c.admin_id, ownerId)} · ترتیب: ${c.sort} · سقفِ روزانه: ${capFa(c.daily_cap)}`,
    usedLine(c, used),
  ].filter((x) => x !== null).join('\n');
}

/** صفحه‌ی فهرست. */
export function listText(cards, ownerId, used) {
  if (!cards.length) return '💳 کارت‌های پرداخت\n\nهنوز هیچ کارتی نیست.';
  const body = cards.map((c, i) => `${i + 1}) ${cardBlock(c, ownerId, used)}`).join('\n\n');
  return `💳 کارت‌های پرداخت\n\n${body}\n\n✅ فعال · ⏸ غیرفعال. برای ویرایش روی کارت بزن.`;
}

/** برچسبِ دکمه‌ی هر کارت در فهرست. */
export const cardButtonLabel = (c, i) =>
  `${c.active ? '✅' : '⏸'} ${i + 1}) ${c.bank || c.holder} …${String(c.number).slice(-4)}`;

/** صفحه‌ی یک کارت. */
export function viewText(c, ownerId, used) {
  return `💳 کارتِ #${c.id}\n\n${cardBlock(c, ownerId, used)}\n\n`
    + 'شماره‌ی کارت ویرایش نمی‌شود؛ برای شماره‌ی تازه، کارتِ جدید بساز و این یکی را غیرفعال کن.';
}

/** متنِ خبرِ تغییر برای مالک (وقتی تغییردهنده خودِ مالک نیست — مثلاً از داشبورد).
 *  `actorId` صفر یعنی داشبورد (صفِ `admin_actions` تغییردهنده‌ی انسانیِ مشخصی ندارد). */
export const changeNotice = (actorId, what) =>
  `🔔 تغییرِ کارت‌ها (${Number(actorId) ? `توسط ${actorId}` : 'از داشبورد'}): ${what}`;

const last4 = (n) => `…${String(n).slice(-4)}`;

/**
 * 🗂 تک‌منبعِ اعتبارسنجیِ یک تغییرِ کارت که از **صف** می‌آید (داشبورد، فازِ ۱c).
 * هم داشبورد قبل از صف‌کردن صدایش می‌زند (خطای فوری به مالک) و هم sweepِ ربات لحظه‌ی
 * اجرا (روی فهرستِ **همان لحظه**، چون بینِ صف و اجرا ممکن است کارت‌ها عوض شده باشند).
 *
 * ⚠️ اکشن‌ها **مقدارِ هدف** می‌گیرند نه «برعکس کن»: ردیفِ صف ممکن است دو بار ثبت شود
 * (دو تبِ باز، دوبار-کلیک) و «برعکس کن»ِ دوم کارِ اولی را خنثی می‌کرد. با مقدارِ هدف،
 * دومی یک no-op است.
 *
 * خروجی: `{ ok:false, err }` یا `{ ok:true, noop, apply, what }` که `apply` یکی از:
 *   `{ t:'add', number, holder, bank, admin, kind }` · `{ t:'active', id, value }` ·
 *   `{ t:'kind', id, value }` · `{ t:'field', id, field, value }`.
 */
export function planCardOp(op, cards) {
  if (!op || typeof op !== 'object') return { ok: false, err: 'دستورِ نامعتبر' };
  const list = Array.isArray(cards) ? cards : [];
  if (op.op === 'add') {
    const out = {};
    for (const f of ['number', 'holder', 'bank', 'admin']) {
      const r = parseCardField(f, op[f]);
      if (!r.ok) return { ok: false, err: `${FIELD_LABEL[f]}: ${r.err}` };
      out[f] = r.value;
    }
    const kind = op.kind === 'white' ? 'white' : op.kind === 'regular' ? 'regular' : null;
    if (!kind) return { ok: false, err: 'نوعِ کارت باید عادی یا سفید باشد.' };
    const dup = list.find((c) => String(c.number) === out.number);
    if (dup) return { ok: false, err: `این شماره قبلاً ثبت شده (کارتِ #${dup.id}).` };
    return { ok: true, noop: false, apply: { t: 'add', ...out, kind },
      what: `کارتِ تازه ${last4(out.number)} (${kind === 'white' ? 'سفید' : 'عادی'}، ادمین ${out.admin})` };
  }
  const id = Number(op.id);
  const c = list.find((x) => x.id === id);
  if (!c) return { ok: false, err: `کارتِ #${op.id} پیدا نشد.` };
  if (op.op === 'active') {
    const value = op.value ? 1 : 0;
    if (Number(c.active) === value) return { ok: true, noop: true, apply: null, what: '' };
    if (!value && !canDeactivate(list, id)) return { ok: false, err: 'این آخرین کارتِ عادیِ فعال است؛ اول یک کارتِ عادیِ دیگر فعال کن.' };
    return { ok: true, noop: false, apply: { t: 'active', id, value }, what: `${value ? 'فعال' : 'غیرفعال'} شد (${last4(c.number)})` };
  }
  if (op.op === 'kind') {
    const value = op.value === 'white' ? 'white' : op.value === 'regular' ? 'regular' : null;
    if (!value) return { ok: false, err: 'نوعِ کارت باید عادی یا سفید باشد.' };
    if (c.kind === value) return { ok: true, noop: true, apply: null, what: '' };
    if (value === 'white' && !canMakeWhite(list, id)) return { ok: false, err: 'این آخرین کارتِ عادیِ فعال است؛ اول یک کارتِ عادیِ دیگر اضافه یا فعال کن.' };
    return { ok: true, noop: false, apply: { t: 'kind', id, value }, what: `نوع ⟵ ${value === 'white' ? 'سفید' : 'عادی'} (${last4(c.number)})` };
  }
  if (op.op === 'edit') {
    if (!Object.prototype.hasOwnProperty.call(EDITABLE, op.field)) return { ok: false, err: 'این فیلد ویرایش‌پذیر نیست.' };
    const r = parseCardField(op.field, op.value);
    if (!r.ok) return { ok: false, err: `${FIELD_LABEL[op.field]}: ${r.err}` };
    if (String(c[EDITABLE[op.field]] ?? '') === String(r.value)) return { ok: true, noop: true, apply: null, what: '' };
    return { ok: true, noop: false, apply: { t: 'field', id, field: op.field, value: r.value },
      what: `${FIELD_LABEL[op.field]} ⟵ ${r.value === '' ? '(خالی)' : r.value} (${last4(c.number)})` };
  }
  return { ok: false, err: 'دستورِ ناشناخته' };
}

/* ═══ 🔁 انتخابِ کارت بر اساسِ مبلغِ فاکتور (v3.132.0، تصمیمِ مالک ۱۴۰۵/۰۷/۰۵) ═══
 * چرا: بانک‌ها روی «یک مبلغِ ثابت، تعدادِ زیاد، یک کارت» حساس‌اند و کارت را می‌بندند. پس
 * کارت per **فاکتور** انتخاب می‌شود، نه per کاربر، و هر مبلغ فقط با خودش رقابت می‌کند
 * (۱۵ هزاری‌ها با هم، ۶۰ هزاری‌ها با هم). «مبلغ» همان عددی است که از کاربر خواسته‌ایم
 * (`payments.amount`)، نه نامِ بسته، چون بسته‌ها و قیمت‌ها عوض می‌شوند.
 *
 * بینِ کارت‌های **عادیِ فعالِ زیرِ سقف**، به ترتیب:
 *   ۱) کمترین پرداختِ **تأییدشده** با همین مبلغ در امروز،
 *   ۲) مساوی ⟵ کمترین فاکتورِ **باز** با همین مبلغ در امروز (صادرشده و بی‌رسید، یا رسیدِ
 *      منتظرِ تصمیم)،
 *   ۳) باز مساوی ⟵ ترتیبِ فهرستِ کارت‌ها (`sort`, `id`).
 * «امروز» از ۰۰:۰۰ تهران شروع می‌شود (مرزِ روزِ بانکی). سقفِ روزانه (پیش‌فرض ۰ = بی‌سقف) هنوز
 * کارتِ پر را از رقابت بیرون می‌برد. همه‌ی عادی‌ها پر یا خاموش ⟵ کارتِ سفید. همه‌چیز این‌جا خالص
 * است تا چکِ CI بدونِ DB و تلگرام اجرایش کند؛ شمارش‌ها را ربات از SQLiteِ محلی می‌دهد. */
export const CARD_DAY_BOUNDARY_H = 0;
export const CARD_TZ = 'Asia/Tehran';
/** کلیدِ «روزِ کارت» برای یک لحظه (میلی‌ثانیه): تاریخِ تهران، مرزِ نیمه‌شب. */
export function cardDay(ms = Date.now(), tz = CARD_TZ, boundaryH = CARD_DAY_BOUNDARY_H) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Number(ms) - boundaryH * 3600_000));
}
/** اختلافِ ساعتِ منطقه با UTC در یک لحظه (میلی‌ثانیه). بدونِ فرضِ ثابت‌بودن (اگر روزی ساعتِ
 *  تابستانی برگردد، همین تابع درست می‌ماند). */
function tzOffsetMs(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** لحظه‌ی شروعِ روزِ کارتِ `ms` (ثانیه‌ی یونیکس): نیمه‌شبِ تهرانِ همان روز. */
export function cardDayStartSec(ms = Date.now(), tz = CARD_TZ) {
  const guess = Date.parse(`${cardDay(ms, tz)}T00:00:00Z`);
  return Math.floor((guess - tzOffsetMs(guess, tz)) / 1000);
}
/** سقفِ امروزِ کارت پر شده؟ سقفِ ۰ = بی‌سقف (پیش‌فرض). */
export const capFull = (c, approvedToday) =>
  Number(c?.daily_cap) > 0 && Number(approvedToday || 0) >= Number(c.daily_cap);
const usable = (c, used) => !!c && Number(c.active) === 1 && !capFull(c, used?.get?.(c.id));
const byOrder = (cards) => [...(Array.isArray(cards) ? cards : [])]
  .sort((a, b) => (Number(a.sort) - Number(b.sort)) || (Number(a.id) - Number(b.id)));
const cnt = (m, id) => Number(m?.get?.(id)) || 0;

/**
 * کارتِ یک فاکتور. ورودی: فهرستِ کارت‌ها؛ `used` = Map از id به کلِ تأییدشده‌های امروز (سقف)؛
 * `wins` و `open` = Map از id به تأییدشده/بازِ امروز **با همین مبلغ**؛ `excludeId` = کارتی که
 * نباید انتخاب شود (دکمه‌ی تعویض: کارتِ فعلی). خروجی `{ card, via }`:
 *  - `amount`: برنده‌ی رقابتِ کارت‌های عادی.
 *  - `white`: هیچ عادیِ قابلِ‌استفاده‌ای نیست ⟵ کارتِ سفید (اولویت با سفیدِ همان ادمینِ کارتِ
 *    کنارگذاشته، بعد اولین سفید به ترتیب).
 *  - `overflow`: فقط برای فاکتورِ تازه، وقتی همه پرند ⟵ اولین کارتِ عادیِ فعال (فاکتور هرگز
 *    بی‌کارت نمی‌ماند؛ سقف یک ترجیح است، نه دیوار).
 *  - `none`: `card=null`. برای تعویض یعنی «کارتِ دیگری نیست» ⟵ دکمه ساخته نمی‌شود.
 */
export function pickAmountCard({ cards, used = new Map(), wins = new Map(), open = new Map(), excludeId = 0 } = {}) {
  const all = byOrder(cards);
  const ex = Number(excludeId) || 0;
  const cur = ex ? all.find((c) => c.id === ex) || null : null;
  const list = all.filter((c) => c.id !== ex);
  const regular = list.filter((c) => c.kind === 'regular' && usable(c, used));
  if (regular.length) {
    // `reduce` با مقایسه‌ی اکید ⟵ در تساوی، اولیِ فهرست (ترتیبِ `sort`) می‌ماند.
    const best = regular.reduce((b, c) => {
      const dw = cnt(wins, c.id) - cnt(wins, b.id);
      return dw < 0 || (dw === 0 && cnt(open, c.id) < cnt(open, b.id)) ? c : b;
    });
    return { card: best, via: 'amount' };
  }
  const whites = list.filter((c) => c.kind === 'white' && usable(c, used));
  const white = (cur && whites.find((c) => Number(c.admin_id) === Number(cur.admin_id))) || whites[0];
  if (white) return { card: white, via: 'white' };
  if (ex) return { card: null, via: 'none' };
  const any = list.find((c) => Number(c.active) === 1 && c.kind === 'regular') || list.find((c) => Number(c.active) === 1);
  return any ? { card: any, via: 'overflow' } : { card: null, via: 'none' };
}

/** ⛔️ مقصدِ اقدامِ خودکارِ «نتوانستم واریز کنم» (v3.127.0، فازِ ۵). **فقط کارتِ سفید** (تصمیمِ
 *  مالک، پاسخِ ۱۲ و ۱۶): اولویت با سفیدِ **همان ادمینِ** کارتِ ناموفق، بعد اولین سفیدِ دیگر به
 *  ترتیبِ `sort`. کارتِ فعلی هرگز مقصد نیست و کارتِ غیرفعال یا پرشده هم نه. `null` یعنی هیچ
 *  سفیدِ قابلِ‌استفاده‌ای نیست ⟵ اقدامِ خودکار نه، مستقیم به ادمین. */
export function pickWhiteCard({ cards, used = new Map(), currentId = 0 } = {}) {
  const list = byOrder(cards);
  const cur = list.find((c) => c.id === Number(currentId)) || null;
  const whites = list.filter((c) => c.id !== Number(currentId) && c.kind === 'white' && usable(c, used));
  return (cur && whites.find((c) => Number(c.admin_id) === Number(cur.admin_id))) || whites[0] || null;
}

/** مراحلِ افزودن، به ترتیب. نوع با دکمه انتخاب می‌شود نه متن. */
export const ADD_STEPS = Object.freeze(['number', 'holder', 'bank', 'admin']);
export const ADD_PROMPT = Object.freeze({
  number: '➕ کارتِ جدید (۱ از ۵)\n\nشماره‌ی ۱۶ رقمیِ کارت را بفرست:',
  holder: '➕ کارتِ جدید (۲ از ۵)\n\nنامِ صاحب کارت را دقیقاً همان‌طور که در اپِ بانک دیده می‌شود بفرست:',
  bank: '➕ کارتِ جدید (۳ از ۵)\n\nنامِ بانک را بفرست (مثلاً «بلوبانک»). برای خالی: -',
  admin: '➕ کارتِ جدید (۴ از ۵)\n\nآیدیِ عددیِ تلگرامِ ادمینِ این کارت را بفرست. رسیدهای این کارت با دکمه‌ها برای او می‌رود.',
  kind: '➕ کارتِ جدید (۵ از ۵)\n\nنوعِ کارت؟\nعادی = برای فاکتورهای معمولی. سفید = کارتِ پشتیبان برای وقتی انتقال به کارتِ عادی خطا بدهد.',
});
