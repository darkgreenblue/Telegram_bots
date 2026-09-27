/* 🔎 خوانشِ «فقط ثبتِ» ایجنتِ رسید و (از فازِ ۶) تگ‌های اپ و بانکِ مبدأ.
 *
 * ماژولِ **خالص**: هیچ import از npm، هیچ دیتابیس، هیچ تلگرام. `index.js` ردیفِ
 * `receipt_analyses` را می‌خواند و از همین‌جا متن می‌سازد، پس
 * `tools/check-receipt-shadow.mjs` همین توابع را مستقیم اجرا می‌کند (نه کپیِ منطق).
 *
 * متن‌ها عمداً فارسیِ ثابت‌اند و در locale نیستند (همان استدلالِ `cards-admin.js`): این خط
 * فقط روی پیامِ رسیدِ **مالک** و فقط روی رباتِ فارسی (ریلِ کارت‌به‌کارت) دیده می‌شود. */

/** ارقامِ لاتین ⟵ فارسی (فقط برای نمایش). */
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** یک خطِ کوتاه برای پیامِ رسیدِ مالک از ردیفِ `receipt_analyses`: فقط «خطای انتقال» (فازِ ۵).
 *  اپ و کارتِ مبدأ از v3.132.0 خوانده نمی‌شوند (تصمیمِ مالک: تشخیصِ اپ و بانک فقط دستِ ادمین).
 *  `''` یعنی چیزی برای گفتن نیست و خطی اضافه نمی‌شود. */
export function shadowLine(row) {
  if (!row || !row.ok || !row.transfer_error) return '';
  return '🔎 ایجنت: ⛔️ خطای انتقال';
}

/** کپشن + خطِ ایجنت، بدونِ اینکه خطِ ایجنت با سقفِ کپشن بریده شود: اگر جا نبود، از خودِ
 *  کپشن کم می‌شود نه از خط. */
export function withShadowLine(caption, line, limit) {
  if (!line) return String(caption).slice(0, limit);
  const tail = `\n\n${line}`;
  return String(caption).slice(0, Math.max(0, limit - tail.length)) + tail;
}

/* ⛔️ پیامِ اطلاعاتیِ «نتوانستم واریز کنم» (v3.127.0، فازِ ۵) — فقط ادمینِ کارتِ ناموفق و مالک. */
export const TERR_BTN = {
  sms: '📩 پیامکش اومده',
  yes: '✅ بله، پیامکش اومده (تأیید و شارژ)',
  no: '↩️ انصراف',
};
const last4 = (c) => String(c?.number ?? '').slice(-4);
/** متنِ پیامِ ادمین. `from` = کارتی که انتقال به آن ناموفق بود، `to` = کارتِ سفیدِ جدید. */
export function terrAdminText({ invoiceNo, userId, userName, amount, from, to, errText }) {
  return [
    `⛔️ کاربر نتوانست به کارتِ …${last4(from)} (${from?.bank || from?.holder || '-'}) واریز کند.`,
    `فاکتورِ #${invoiceNo} · ${Number(amount || 0).toLocaleString('fa-IR')} تومان · کاربر ${userId}${userName ? ` (${userName})` : ''}`,
    errText ? `پیامِ خطا: «${String(errText).slice(0, 160)}»` : '',
    `🔄 همان فاکتور خودکار به کارتِ سفیدِ …${last4(to)} منتقل شد.`,
    '',
    'اگر با وجودِ این خطا پیامکِ واریز به کارتِ بالا آمده، «پیامکش اومده» را بزن تا الماسِ کاملِ فاکتور داده شود.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * 🏷 فازِ ۶ (v3.128.0): تگِ دستیِ «اپ» و «بانکِ مبدأ» روی رسیدها — فقط مالک.
 *
 * قرارداد (پاسخ‌های مالک در `PAYMENT-V2-PLAN.md`):
 *   • دو بُعد: `app` و `bank`. هر رسید در هر بُعد حداکثر **یک** مقدار دارد، ولی هر کاربر
 *     در طولِ زمان چند مقدار می‌گیرد (یک‌به‌چند per کاربر).
 *   • تنها منبع `admin` است (دستیِ مالک). تگِ خودکارِ فازِ ۷ (`auto`) در v3.132.0 حذف و پاک شد؛
 *     `effectiveTags` هنوز ادمین را مقدم می‌گیرد تا ردیفِ کهنه‌ی احتمالی هرگز بر دستی غلبه نکند.
 *   • سابقه‌ی کاربر فقط از رسیدهای **ردنشده** شمرده می‌شود (SQL در `index.js` این را فیلتر
 *     می‌کند، این‌جا فقط شمارش است).
 *   • «سایر» عمداً مقدار نیست: رسیدی که با هیچ مقداری جور نیست بی‌تگ می‌ماند.
 *   • مقدارها از داشبورد اضافه/فعال/غیرفعال می‌شوند؛ هیچ مقداری حذف نمی‌شود (تگ‌های قدیمی
 *     باید همیشه برچسبِ خوانا داشته باشند).
 *
 * همه‌چیزِ این بخش خالص است تا `tools/check-receipt-tags.mjs` همان را اجرا کند؛ و
 * `planTagOp` **تک‌منبعِ اعتبارسنجی** است: داشبورد قبل از صف‌کردن و sweepِ ربات لحظه‌ی
 * اجرا، هر دو همین تابع را صدا می‌زنند (الگوی `CA.planCardOp`). */

export const TAG_DIMS = ['app', 'bank'];
export const TAG_DIM_LABEL = { app: 'اپ', bank: 'بانک' };
export const TAG_DIM_ICON = { app: '📱', bank: '🏦' };

/** مقدارهای اولیه (فقط نام، نه پیش‌شماره). بلو جدا از سامان است (تصمیمِ مالک، پاسخِ ۲۴). */
export const SEED_TAG_VALUES = {
  // v3.132.0 (تصمیمِ مالک ۱۴۰۵/۰۷/۰۵): «بلو» اپ نیست، یک موبایل‌بانک است ⟵ از فهرست بیرون (کاربرِ
  // بلو = بانکِ بلو + اپِ موبایل‌بانک). «خودپرداز» و «نمی‌تونم تشخیص بدم» اضافه شدند. «نمی‌تونم
  // تشخیص بدم» یعنی ادمین نگاه کرد و نفهمید؛ بی‌تگ یعنی هنوز کسی نگاه نکرده.
  app: [
    ['mobilebank', 'موبایل‌بانک'], ['ap', 'آپ'], ['780', '۷۸۰'], ['hamrahcard', 'همراه‌کارت'],
    ['top', 'تاپ'], ['atm', 'خودپرداز'], ['unknown', 'نمی‌تونم تشخیص بدم'],
  ],
  bank: [
    ['unknown', 'نمی‌تونم تشخیص بدم'], ['blu', 'بلو'], ['melli', 'ملی'], ['mellat', 'ملت'], ['saderat', 'صادرات'], ['tejarat', 'تجارت'],
    ['sepah', 'سپه'], ['keshavarzi', 'کشاورزی'], ['maskan', 'مسکن'], ['refah', 'رفاه'],
    ['pasargad', 'پاسارگاد'], ['saman', 'سامان'], ['parsian', 'پارسیان'], ['eghtesad', 'اقتصاد نوین'],
    ['karafarin', 'کارآفرین'], ['sina', 'سینا'], ['sarmayeh', 'سرمایه'], ['shahr', 'شهر'], ['day', 'دی'],
    ['ayandeh', 'آینده'], ['gardeshgari', 'گردشگری'], ['khavarmianeh', 'خاورمیانه'],
    ['iranzamin', 'ایران‌زمین'], ['mehr', 'مهر ایران'], ['resalat', 'رسالت'], ['melal', 'ملل'],
    ['postbank', 'پست‌بانک'], ['tosee_saderat', 'توسعه صادرات'], ['sanat', 'صنعت و معدن'],
    ['tosee_taavon', 'توسعه تعاون'], ['noor', 'نور'],
  ],
};

/** کلیدِ مقدار: لاتینِ کوچک/رقم/آندرلاین، حداکثر ۲۴. داخلِ `callback_data` می‌نشیند (سقفِ ۶۴ بایت). */
export const TAG_KEY_RE = /^[a-z0-9_]{1,24}$/;
/** برچسبِ مقدار: یک خط، ۱ تا ۲۴ نویسه، بدونِ نویسه‌ی کنترلی و بدونِ `<>` (در HTMLِ داشبورد می‌نشیند). */
export function cleanTagLabel(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 24 || /[\u0000-\u001f<>]/.test(t)) return null;
  return t;
}

/** تگِ مؤثرِ هر رسید در هر بُعد: `{ [pid]: { app: {key, source}, bank: {…} } }`. ادمین بر auto مقدم. */
export function effectiveTags(rows) {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !TAG_DIMS.includes(r.dim) || !r.value_key) continue;
    const slot = (out[r.payment_id] ||= {});
    const cur = slot[r.dim];
    if (!cur || (cur.source !== 'admin' && r.source === 'admin')) slot[r.dim] = { key: r.value_key, source: r.source };
  }
  return out;
}

/** شمارشِ سابقه‌ی یک کاربر از تگ‌های مؤثر: `{ app: [[key, n], …], bank: […] }` نزولی. */
export function tagHistory(rows) {
  const eff = effectiveTags(rows);
  const cnt = { app: new Map(), bank: new Map() };
  for (const slot of Object.values(eff)) {
    for (const d of TAG_DIMS) if (slot[d]) cnt[d].set(slot[d].key, (cnt[d].get(slot[d].key) || 0) + 1);
  }
  const out = {};
  for (const d of TAG_DIMS) out[d] = [...cnt[d]].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return out;
}

/** خطِ «🏷 سابقه» برای پیامِ رسیدِ مالک؛ `''` یعنی هیچ تگی نیست (خطی اضافه نمی‌شود). */
export function historyLine(hist, labelOf) {
  const lab = typeof labelOf === 'function' ? labelOf : (_d, k) => k;
  const parts = [];
  for (const d of TAG_DIMS) {
    const list = (hist?.[d] || []).map(([k, n]) => `${lab(d, k)} ×${faDigits(n)}`);
    if (list.length) parts.push(`${TAG_DIM_LABEL[d]}: ${list.join('، ')}`);
  }
  return parts.length ? `🏷 سابقه‌ی کاربر: ${parts.join(' · ')}` : '';
}

/* ── کیبورد ──────────────────────────────────────────────────────────────────────────
 * همه‌ی دکمه‌های تگ `callback_data`ی با پیشوندِ `tg:` دارند و **ردیفِ خودشان** را می‌گیرند
 * (هیچ ردیفی قاطیِ دکمه‌های اکشن نیست). پس `stripTagRows` بی‌ابهام همان‌ها را برمی‌دارد و
 * هر ادیتِ کیبوردِ یک هندلرِ اکشن می‌تواند ردیف‌های تگ را سالم نگه دارد (`preserveTagRows`). */
export const TAG_CB = /^tg:(o|s|c|x):(\d+)(?::(app|bank|card))?(?::([a-z0-9_]{1,24}))?$/;
const btn = (text, data) => ({ text, callback_data: data });
export const isTagRow = (row) => Array.isArray(row) && row.length > 0
  && row.every((b) => typeof b?.callback_data === 'string' && b.callback_data.startsWith('tg:'));
const rowsOf = (kb) => {
  const m = kb && kb.reply_markup ? kb.reply_markup : kb;
  return Array.isArray(m?.inline_keyboard) ? m.inline_keyboard : [];
};
export const hasTagRows = (kb) => rowsOf(kb).some(isTagRow);
export const stripTagRows = (kb) => rowsOf(kb).filter((r) => !isTagRow(r));

/** ردیفِ جمع‌شده: «📱 اپ: آپ» و «🏦 بانک: —». `cur` = خروجیِ `effectiveTags` برای همین رسید.
 *  `cardLabel` (فقط پیامِ مالک، v3.132.0) ⟵ یک ردیفِ دیگر: «💳 کارت: … · تغییر». */
export function tagCollapsedRows(pid, cur, labelOf, { cardLabel = '' } = {}) {
  const lab = typeof labelOf === 'function' ? labelOf : (_d, k) => k;
  const rows = [TAG_DIMS.map((d) => btn(`${TAG_DIM_ICON[d]} ${TAG_DIM_LABEL[d]}: ${cur?.[d] ? lab(d, cur[d].key) : '—'}`, `tg:o:${pid}:${d}`))];
  if (cardLabel) rows.push([btn(`💳 کارتِ تخصیص: ${cardLabel} · تغییر`, `tg:o:${pid}:card`)]);
  return rows;
}

/* ── 💳 «تغییر شماره کارت تخصیص» (v3.132.0، تصمیمِ مالک ۱۴۰۵/۰۷/۰۵) ─────────────────────────
 * کاربری که کارتِ دیگری گرفته ولی به کارتِ قبلی (یا کارتی که در گوشی ذخیره داشته) واریز کرده،
 * آمارِ «تأییدشده‌ی امروزِ هر کارت با هر مبلغ» را کج می‌کند و انتخابِ کارتِ فاکتورهای بعدی روی
 * همان عدد می‌نشیند. مالک از روی رسید کارتِ واقعی را انتخاب می‌کند و `card_id` همان می‌شود.
 * فقط مالک، فقط دستی (نه ایجنت، نه پشتیبانی). فهرست = **همه‌ی کارت‌های فعال** (عادی و سفید). */
export const cardShortLabel = (c) => `${c?.bank || c?.holder || '-'} …${String(c?.number ?? '').slice(-4)}`;
export function cardPickerRows(pid, cards, curId) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => Number(c.active) === 1)
    .sort((a, b) => (Number(a.sort) - Number(b.sort)) || (Number(a.id) - Number(b.id)));
  const rows = list.map((c) => [btn(`${Number(c.id) === Number(curId) ? '✅ ' : ''}${c.kind === 'white' ? '🤍' : '💳'} ${cardShortLabel(c)}`, `tg:s:${pid}:card:${c.id}`)]);
  rows.push([btn('↩️ بستن', `tg:x:${pid}`)]);
  return rows;
}
/** اعتبارسنجیِ تغییرِ کارتِ یک پرداخت: کارتِ مقصد باید وجود داشته باشد و **فعال** باشد. */
export function planCardCorrection(payment, cards, toId) {
  if (!payment) return { ok: false, err: 'پرداخت پیدا نشد.' };
  const to = (Array.isArray(cards) ? cards : []).find((c) => Number(c.id) === Number(toId));
  if (!to) return { ok: false, err: 'این کارت پیدا نشد.' };
  if (Number(to.active) !== 1) return { ok: false, err: 'این کارت غیرفعال است.' };
  if (Number(payment.card_id) === Number(to.id)) return { ok: true, noop: true, to: to.id };
  return { ok: true, noop: false, from: Number(payment.card_id) || 0, to: Number(to.id), label: cardShortLabel(to) };
}
/** ردیف‌های انتخابِ یک بُعد: سه‌تایی، مقدارِ فعلی با ✅، و ردیفِ «پاک کردن / بستن». */
export function tagPickerRows(pid, dim, values, curKey) {
  const rows = [];
  const list = (Array.isArray(values) ? values : []).filter((v) => v.dim === dim && Number(v.active) === 1);
  for (let i = 0; i < list.length; i += 3) {
    rows.push(list.slice(i, i + 3).map((v) => btn(`${v.key === curKey ? '✅ ' : ''}${v.label}`, `tg:s:${pid}:${dim}:${v.key}`)));
  }
  rows.push([btn('🗑 پاک کردن', `tg:c:${pid}:${dim}`), btn('↩️ بستن', `tg:x:${pid}`)]);
  return rows;
}
/** کیبوردِ تازه = ردیف‌های غیرتگِ `kb` + `tagRows`. */
export const withTagRows = (kb, tagRows) => ({ inline_keyboard: [...stripTagRows(kb), ...(tagRows || [])] });
/** وقتی یک هندلرِ اکشن کیبوردِ پیامِ مالک را عوض می‌کند (مثلاً بعد از تأیید، یا حذفِ کاملِ
 *  دکمه‌ها با `undefined`)، ردیف‌های تگِ قبلی باید بمانند: تگ‌زدن مستقل از تصمیمِ پرداخت است. */
export function preserveTagRows(oldKb, newKb) {
  const tags = rowsOf(oldKb).filter(isTagRow);
  if (!tags.length) return newKb;
  if (hasTagRows(newKb)) return newKb;
  const rest = rowsOf(newKb);
  return { inline_keyboard: [...rest, ...tags] };
}

/* ── اعتبارسنجیِ تک‌منبع (داشبورد + sweepِ ربات) ─────────────────────────────────────
 * `op`: `{op:'set', dim, key}` · `{op:'clear', dim}` · `{op:'value_add', dim, key, label}` ·
 *       `{op:'value_active', dim, key, active}`.
 * `ctx`: `{ values: tag_values[], payment: payments-row|null }` (برای set/clear رسید لازم است).
 * خروجی: `{ ok, err?, noop?, apply?, what? }`. `apply` فقط شکلِ تمیزشده است، نه ورودیِ خام. */
export function planTagOp(op, { values = [], payment = null } = {}) {
  if (!op || typeof op !== 'object') return { ok: false, err: 'دستورِ نامعتبر' };
  const dim = String(op.dim || '');
  if (!TAG_DIMS.includes(dim)) return { ok: false, err: 'بُعدِ تگ باید «اپ» یا «بانک» باشد.' };
  const vals = Array.isArray(values) ? values : [];
  const find = (k) => vals.find((v) => v.dim === dim && v.key === k);
  if (op.op === 'set' || op.op === 'clear') {
    if (!payment) return { ok: false, err: 'پرداخت پیدا نشد.' };
    if (op.op === 'clear') {
      return { ok: true, apply: { t: 'clear', pid: payment.id, uid: payment.user_id, dim },
        what: `پاک‌کردنِ ${TAG_DIM_LABEL[dim]} روی پرداختِ #${payment.id}` };
    }
    const key = String(op.key || '');
    const v = find(key);
    if (!TAG_KEY_RE.test(key) || !v) return { ok: false, err: `مقدارِ «${key}» برای ${TAG_DIM_LABEL[dim]} تعریف نشده.` };
    if (Number(v.active) !== 1) return { ok: false, err: `مقدارِ «${v.label}» غیرفعال است.` };
    return { ok: true, apply: { t: 'set', pid: payment.id, uid: payment.user_id, dim, key },
      what: `${TAG_DIM_LABEL[dim]} ⟵ ${v.label} روی پرداختِ #${payment.id}` };
  }
  if (op.op === 'value_add') {
    const key = String(op.key || '').trim().toLowerCase();
    const label = cleanTagLabel(op.label);
    if (!TAG_KEY_RE.test(key)) return { ok: false, err: 'کلید فقط حروفِ کوچکِ لاتین، رقم و _ (حداکثر ۲۴).' };
    if (!label) return { ok: false, err: 'برچسب ۱ تا ۲۴ نویسه، یک خط.' };
    const v = find(key);
    if (v && v.label === label && Number(v.active) === 1) return { ok: true, noop: true, apply: null, what: '' };
    return { ok: true, apply: { t: 'value_add', dim, key, label },
      what: `${v ? 'به‌روزرسانیِ' : 'افزودنِ'} مقدارِ ${TAG_DIM_LABEL[dim]}: ${label}` };
  }
  if (op.op === 'value_active') {
    const key = String(op.key || '');
    const v = find(key);
    if (!v) return { ok: false, err: `مقدارِ «${key}» پیدا نشد.` };
    const active = op.active ? 1 : 0;
    if (Number(v.active) === active) return { ok: true, noop: true, apply: null, what: '' };
    return { ok: true, apply: { t: 'value_active', dim, key, active },
      what: `${v.label} ⟵ ${active ? 'فعال' : 'غیرفعال'}` };
  }
  return { ok: false, err: 'دستورِ ناشناخته' };
}
