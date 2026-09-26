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
const capFa = (n) => (Number(n) > 0 ? `${n} پرداختِ تأییدشده (هنوز اعمال نمی‌شود)` : 'ندارد');

/** یک کارت، چندخطی. */
export function cardBlock(c, ownerId) {
  return [
    `${c.active ? '✅' : '⏸'} ${kindFa(c.kind)} · ${c.bank || 'بدونِ نامِ بانک'}`,
    fmtCardNo(c.number),
    `${c.holder}`,
    `ادمین: ${adminFa(c.admin_id, ownerId)} · ترتیب: ${c.sort} · سقفِ روزانه: ${capFa(c.daily_cap)}`,
  ].join('\n');
}

/** صفحه‌ی فهرست. */
export function listText(cards, ownerId) {
  if (!cards.length) return '💳 کارت‌های پرداخت\n\nهنوز هیچ کارتی نیست.';
  const body = cards.map((c, i) => `${i + 1}) ${cardBlock(c, ownerId)}`).join('\n\n');
  return `💳 کارت‌های پرداخت\n\n${body}\n\n✅ فعال · ⏸ غیرفعال. برای ویرایش روی کارت بزن.`;
}

/** برچسبِ دکمه‌ی هر کارت در فهرست. */
export const cardButtonLabel = (c, i) =>
  `${c.active ? '✅' : '⏸'} ${i + 1}) ${c.bank || c.holder} …${String(c.number).slice(-4)}`;

/** صفحه‌ی یک کارت. */
export function viewText(c, ownerId) {
  return `💳 کارتِ #${c.id}\n\n${cardBlock(c, ownerId)}\n\n`
    + 'شماره‌ی کارت ویرایش نمی‌شود؛ برای شماره‌ی تازه، کارتِ جدید بساز و این یکی را غیرفعال کن.';
}

/** متنِ خبرِ تغییر برای مالک (وقتی تغییردهنده خودِ مالک نیست — مثلاً از داشبورد). */
export const changeNotice = (actorId, what) => `🔔 تغییرِ کارت‌ها (توسط ${actorId}): ${what}`;

/** مراحلِ افزودن، به ترتیب. نوع با دکمه انتخاب می‌شود نه متن. */
export const ADD_STEPS = Object.freeze(['number', 'holder', 'bank', 'admin']);
export const ADD_PROMPT = Object.freeze({
  number: '➕ کارتِ جدید (۱ از ۵)\n\nشماره‌ی ۱۶ رقمیِ کارت را بفرست:',
  holder: '➕ کارتِ جدید (۲ از ۵)\n\nنامِ صاحب کارت را دقیقاً همان‌طور که در اپِ بانک دیده می‌شود بفرست:',
  bank: '➕ کارتِ جدید (۳ از ۵)\n\nنامِ بانک را بفرست (مثلاً «بلوبانک»). برای خالی: -',
  admin: '➕ کارتِ جدید (۴ از ۵)\n\nآیدیِ عددیِ تلگرامِ ادمینِ این کارت را بفرست. رسیدهای این کارت با دکمه‌ها برای او می‌رود.',
  kind: '➕ کارتِ جدید (۵ از ۵)\n\nنوعِ کارت؟\nعادی = برای فاکتورهای معمولی. سفید = کارتِ پشتیبان برای وقتی انتقال به کارتِ عادی خطا بدهد.',
});
