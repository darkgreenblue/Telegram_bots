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

/* ═══ 🔁 چرخشِ روزانه و سقفِ روزانه (فازِ ۲ی PAYMENT-V2-PLAN) ═══
 * تصمیمِ مالک: اولین کاربرِ هر روز (لحظه‌ی **صدورِ فاکتور**) کارتِ ۱ را می‌گیرد، دومی کارتِ
 * ۲ و حلقه‌ای جلو؛ هر کاربر تا آخرِ همان روز روی کارتش می‌ماند؛ فردا دوباره از کارتِ ۱.
 * مرزِ «روز» نیمه‌شب نیست، ۰۶:۰۰ تهران است (کم‌کارترین ساعت). سقفِ روزانه = تعدادِ
 * پرداخت‌های **تأییدشده** روی آن کارت در همان «روز»؛ کارتِ پر از چرخه بیرون می‌رود.
 * همه‌چیز این‌جا خالص است تا چکِ CI بدونِ DB و بدونِ تلگرام اجرایش کند. */
export const CARD_DAY_BOUNDARY_H = 6;
export const CARD_TZ = 'Asia/Tehran';
/** کلیدِ «روزِ کارت» برای یک لحظه (میلی‌ثانیه): تاریخِ تهرانِ `ms − ۶ساعت`، یعنی ۰۵:۵۹ هنوز دیروز است. */
export function cardDay(ms = Date.now(), tz = CARD_TZ, boundaryH = CARD_DAY_BOUNDARY_H) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Number(ms) - boundaryH * 3600_000));
}
/** سقفِ امروزِ کارت پر شده؟ سقفِ ۰ = بی‌سقف. */
export const capFull = (c, approvedToday) =>
  Number(c?.daily_cap) > 0 && Number(approvedToday || 0) >= Number(c.daily_cap);
const usable = (c, used) => !!c && Number(c.active) === 1 && !capFull(c, used?.get?.(c.id));
const byOrder = (cards) => [...(Array.isArray(cards) ? cards : [])]
  .sort((a, b) => (Number(a.sort) - Number(b.sort)) || (Number(a.id) - Number(b.id)));

/**
 * کارتِ فاکتورِ تازه. ورودی: فهرستِ کارت‌ها، `used` = Map از id به تعدادِ تأییدشده‌ی امروز،
 * `stickyId` = کارتی که این کاربر امروز گرفته (یا 0)، و `n` = چندمین کاربرِ چرخه‌ی امروز.
 * خروجی `{ card, via }`:
 *  - `sticky`: کاربر امروز کارت دارد و آن کارت هنوز فعال و زیرِ سقف است ⟵ همان.
 *  - `rotation`: کارتِ عادیِ فعالِ زیرِ سقف، به نوبت (`n % تعداد`).
 *  - `white`: همه‌ی عادی‌ها پر یا خاموش‌اند ⟵ اولین کارتِ سفیدِ فعالِ زیرِ سقف.
 *  - `overflow`: همه پرند ⟵ اولین کارتِ عادیِ فعال (فاکتور هرگز بی‌کارت نمی‌ماند؛
 *    سقف یک ترجیح است، نه دیوار).
 *  - `none`: هیچ کارتِ فعالی نیست ⟵ `card=null` (صداکننده به فالبکِ قدیمی می‌رود).
 */
export function pickDailyCard({ cards, used = new Map(), stickyId = 0, n = 0 } = {}) {
  const list = byOrder(cards);
  const sticky = stickyId ? list.find((c) => c.id === Number(stickyId)) : null;
  if (usable(sticky, used)) return { card: sticky, via: 'sticky' };
  const regular = list.filter((c) => c.kind === 'regular' && usable(c, used));
  if (regular.length) {
    const i = ((Math.floor(Number(n) || 0) % regular.length) + regular.length) % regular.length;
    return { card: regular[i], via: 'rotation' };
  }
  const white = list.find((c) => c.kind === 'white' && usable(c, used));
  if (white) return { card: white, via: 'white' };
  const any = list.find((c) => Number(c.active) === 1 && c.kind === 'regular') || list.find((c) => Number(c.active) === 1);
  return any ? { card: any, via: 'overflow' } : { card: null, via: 'none' };
}

/* ═══ 🔄 تعویضِ کارتِ فاکتور (فازِ ۳ی PAYMENT-V2-PLAN) ═══
 * تصمیمِ مالک: وقتی انتقالِ کاربر به کارتِ فاکتور خطا می‌دهد، یک بار در هر فاکتور کارتِ دیگری
 * بگیرد: «کارتِ بعدیِ همان ادمین ⟵ (نبود یا سقفش پر) کارتِ ادمینِ بعدی ⟵ (نبود) کارتِ سفید».
 * «بعدی» یعنی بعد از کارتِ فعلی به ترتیبِ `sort`، حلقه‌ای. فقط کارتِ فعالِ زیرِ سقف، و هرگز
 * خودِ کارتِ فعلی. `null` یعنی تعویض ممکن نیست ⟵ دکمه اصلاً ساخته نمی‌شود. */
export function pickSwitchCard({ cards, used = new Map(), currentId = 0 } = {}) {
  const list = byOrder(cards);
  const cur = list.find((c) => c.id === Number(currentId)) || null;
  const pool = list.filter((c) => c.id !== Number(currentId) && usable(c, used));
  // حلقه‌ای «بعد از کارتِ فعلی»: اول آن‌هایی که بعدش می‌آیند، بعد از اولِ فهرست.
  const after = (arr) => {
    if (!cur) return arr;
    const pos = (c) => byOrder([...arr, cur]).indexOf(c);
    const me = pos(cur);
    return [...arr.filter((c) => pos(c) > me), ...arr.filter((c) => pos(c) < me)];
  };
  const regular = pool.filter((c) => c.kind === 'regular');
  const sameAdmin = cur ? after(regular.filter((c) => Number(c.admin_id) === Number(cur.admin_id))) : [];
  if (sameAdmin.length) return { card: sameAdmin[0], via: 'same_admin' };
  const other = after(regular.filter((c) => !cur || Number(c.admin_id) !== Number(cur.admin_id)));
  if (other.length) return { card: other[0], via: 'next_admin' };
  // سفید: اولویت با کارتِ سفیدِ **همان ادمین** (تصمیمِ مالک، پاسخِ ۱۶)، بعد هر سفیدِ دیگر.
  const whites = pool.filter((c) => c.kind === 'white');
  const white = (cur && whites.find((c) => Number(c.admin_id) === Number(cur.admin_id))) || whites[0];
  return white ? { card: white, via: 'white' } : null;
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
