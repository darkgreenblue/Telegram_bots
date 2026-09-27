/* 🔎 خوانشِ «فقط ثبتِ» ایجنتِ رسید و (از فازِ ۶) تگ‌های اپ و بانکِ مبدأ.
 *
 * ماژولِ **خالص**: هیچ import از npm، هیچ دیتابیس، هیچ تلگرام. `index.js` ردیفِ
 * `receipt_analyses` را می‌خواند و از همین‌جا متن می‌سازد، پس
 * `tools/check-receipt-shadow.mjs` همین توابع را مستقیم اجرا می‌کند (نه کپیِ منطق).
 *
 * متن‌ها عمداً فارسیِ ثابت‌اند و در locale نیستند (همان استدلالِ `cards-admin.js`): این خط
 * فقط روی پیامِ رسیدِ **مالک** و فقط روی رباتِ فارسی (ریلِ کارت‌به‌کارت) دیده می‌شود. */

/** برچسبِ نمایشیِ اپ‌ها. کلیدها همان enumِ `BANK_APPS` در `cardpay.js` اند. */
export const APP_LABELS = {
  blu: 'بلو',
  ap: 'آپ',
  780: '۷۸۰',
  top: 'تاپ',
  hamrahcard: 'همراه‌کارت',
  mobilebank: 'موبایل‌بانک',
  other: 'سایر',
};

/** ارقامِ لاتین ⟵ فارسی (فقط برای نمایش). */
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** یک خطِ کوتاه برای پیامِ رسیدِ مالک از ردیفِ `receipt_analyses`. `''` یعنی چیزی برای
 *  گفتن نیست (ایجنت اجرا نشد، شکست خورد، یا هیچ فیلدی خوانده نشد): آن‌وقت خطی اضافه
 *  نمی‌شود تا پیامِ مالک با «نامشخص · نامشخص · نامشخص» شلوغ نشود. */
export function shadowLine(row) {
  if (!row || !row.ok) return '';
  const parts = [];
  if (row.app) parts.push(`اپ: ${APP_LABELS[row.app] || row.app}`);
  if (row.src_prefix) parts.push(`کارتِ مبدأ: ${faDigits(row.src_prefix)}…`);
  if (row.transfer_error) parts.push('⛔️ خطای انتقال');
  if (!parts.length) return '';
  return `🔎 ایجنت: ${parts.join(' · ')}`;
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
 *   • دو منبع: `admin` (دستیِ مالک) و `auto` (فازِ ۷). روی یک رسید و یک بُعد، **ادمین همیشه
 *     مقدم** است (`effectiveTags`).
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

/** مقدارهای اولیه. کلیدهای اپ **عمداً** همان enumِ `BANK_APPS` در `cardpay.js` اند (منهای
 *  `other`) تا تگِ خودکارِ فازِ ۷ بدونِ جدولِ نگاشت روی همین کلیدها بنشیند. فهرستِ بانک فقط
 *  **نام** است، نه پیش‌شماره (BIN): نگاشتِ پیش‌شماره به بانک کارِ فازِ ۷ است و منبعِ خوانده‌شده
 *  می‌خواهد (بند ۹/۰الف ریشه). بلو جدا از سامان است (تصمیمِ مالک، پاسخِ ۲۴). */
export const SEED_TAG_VALUES = {
  app: [
    ['blu', 'بلو'], ['ap', 'آپ'], ['780', '۷۸۰'], ['top', 'تاپ'],
    ['hamrahcard', 'همراه‌کارت'], ['mobilebank', 'موبایل‌بانک'],
  ],
  bank: [
    ['blu', 'بلو'], ['melli', 'ملی'], ['mellat', 'ملت'], ['saderat', 'صادرات'], ['tejarat', 'تجارت'],
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

/** بانکِ مؤثرِ **آخرین** رسیدِ تگ‌دارِ کاربر (بزرگ‌ترین `payment_id` که تگِ بانک دارد)، یا `null`.
 *  تعریفِ «کاربرِ بلو» (تصمیمِ مالک ۱۴۰۵/۰۷/۰۴: بر اساسِ آخرین رسید). ردنشده‌بودن را SQL فیلتر می‌کند. */
export function lastBank(rows) {
  const eff = effectiveTags(rows);
  let best = null;
  for (const [pid, slot] of Object.entries(eff)) if (slot.bank && (!best || Number(pid) > best.pid)) best = { pid: Number(pid), key: slot.bank.key };
  return best ? best.key : null;
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
export const TAG_CB = /^tg:(o|s|c|x):(\d+)(?::(app|bank))?(?::([a-z0-9_]{1,24}))?$/;
const btn = (text, data) => ({ text, callback_data: data });
export const isTagRow = (row) => Array.isArray(row) && row.length > 0
  && row.every((b) => typeof b?.callback_data === 'string' && b.callback_data.startsWith('tg:'));
const rowsOf = (kb) => {
  const m = kb && kb.reply_markup ? kb.reply_markup : kb;
  return Array.isArray(m?.inline_keyboard) ? m.inline_keyboard : [];
};
export const hasTagRows = (kb) => rowsOf(kb).some(isTagRow);
export const stripTagRows = (kb) => rowsOf(kb).filter((r) => !isTagRow(r));

/** ردیفِ جمع‌شده: «📱 اپ: بلو» و «🏦 بانک: —». `cur` = خروجیِ `effectiveTags` برای همین رسید. */
export function tagCollapsedRows(pid, cur, labelOf) {
  const lab = typeof labelOf === 'function' ? labelOf : (_d, k) => k;
  // 🤖 = تگِ خودکارِ فازِ ۷ (هنوز دستی تأیید/اصلاح نشده).
  return [TAG_DIMS.map((d) => btn(`${TAG_DIM_ICON[d]} ${TAG_DIM_LABEL[d]}: ${cur?.[d] ? lab(d, cur[d].key) + (cur[d].source === 'auto' ? ' 🤖' : '') : '—'}`, `tg:o:${pid}:${d}`))];
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * 🤖 فازِ ۷ (v3.129.0): تگِ خودکار از خروجیِ ایجنت. «مدل می‌خواند، کد حساب می‌کند»: مدل فقط
 * رقم‌های اولِ کارتِ مبدأ و نامِ اپ را می‌خواند؛ نگاشتِ پیش‌شماره ⟵ بانک این‌جا در کد است.
 *
 * منبعِ نگاشت (بند ۹/۰الف ریشه — فقط چیزی که باز شد): دو فهرستِ عمومیِ گیت‌هاب که ۱۴۰۵/۰۷/۰۴ باز و
 * خوانده شدند (gist.github.com/ahbanavi/7bc6dff01b13d7c718209a5785e6c495 و
 * gist.github.com/hasanparasteh/4744845b41a260a0128f275058b9c3b3). **منبعِ رسمیِ شاپرک نیست**؛
 * برای همین فقط پیش‌شماره‌هایی آمده‌اند که **هر دو** فهرست یکسان می‌گویند و در فهرستِ ۳۰ بانکِ
 * سید هستند. هرچه فقط در یکی بود (مثلاً 502806، 604932، 639217) عمداً کنار ماند: بی‌تگ‌ماندن از
 * تگِ غلط بهتر است، و تگِ دستیِ مالک همیشه مقدم است.
 * بلو (۸ رقمیِ 62198618/19) را خودِ مالک داده (بخشِ «تگ‌ها»ی plan). */
export const BIN_BANK = Object.freeze({
  603799: 'melli', 610433: 'mellat', 603769: 'saderat', 627353: 'tejarat', 585983: 'tejarat',
  589210: 'sepah', 603770: 'keshavarzi', 628023: 'maskan', 589463: 'refah', 502229: 'pasargad',
  621986: 'saman', 622106: 'parsian', 627412: 'eghtesad', 627488: 'karafarin', 639346: 'sina',
  639607: 'sarmayeh', 504706: 'shahr', 502938: 'day', 636214: 'ayandeh', 505416: 'gardeshgari',
  505809: 'khavarmianeh', 585947: 'khavarmianeh', 505785: 'iranzamin', 606373: 'mehr', 504172: 'resalat',
  606256: 'melal', 627760: 'postbank', 627648: 'tosee_saderat', 627961: 'sanat', 502908: 'tosee_taavon',
  507677: 'noor',
});
export const BIN8_BANK = Object.freeze({ 62198618: 'blu', 62198619: 'blu' });
/** پیش‌شماره‌ی ۶رقمی‌ای که بدونِ رقمِ ۷ و ۸ مبهم است (سامان یا بلو). رسیدها معمولاً وسطِ
 *  شماره را می‌پوشانند («6219 86** …»)، پس این حالت رایج است و **حدس زده نمی‌شود**. */
export const AMBIGUOUS_BIN6 = Object.freeze(['621986']);

/** بانکِ مبدأ از رقم‌های اولِ کارت، یا `null` (ناشناخته/مبهم/کوتاه). */
export function bankFromPrefix(prefix) {
  // همان قاعده‌ی `shadowFields`: فقط رقم‌های ابتداییِ پیوسته، وگرنه رقم‌های بعد از `**` می‌چسبیدند.
  const d = (String(prefix ?? '').replace(/[۰-۹]/g, (x) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(x))
    .replace(/[\s\-.\u200c]/g, '').match(/^\d+/) || [''])[0];
  if (d.length < 6) return null;
  if (d.length >= 8 && BIN8_BANK[d.slice(0, 8)]) return BIN8_BANK[d.slice(0, 8)];
  const six = d.slice(0, 6);
  if (d.length < 8 && AMBIGUOUS_BIN6.includes(six)) return null;
  return BIN_BANK[six] || null;
}

/** تگ‌های خودکارِ یک تحلیل: `[{dim, key}]`. ورودی = خروجیِ `shadowFields` (`app`, `src_prefix`).
 *  `other` هرگز تگ نیست («سایر» مقدار ندارد). مقدارِ غیرفعال/ناموجود را صداکننده کنار می‌گذارد. */
export function autoTagsFrom(sh) {
  const out = [];
  const app = String(sh?.app || '');
  if (app && app !== 'other' && TAG_KEY_RE.test(app)) out.push({ dim: 'app', key: app });
  let bank = bankFromPrefix(sh?.src_prefix);
  /* اپِ بلو ⟵ بانکِ بلو (تأییدِ مالک ۱۴۰۵/۰۷/۰۴)، **فقط** وقتی پیش‌شماره خودش چیزی نمی‌گوید: خوانده نشد،
     کوتاه بود، یا همان ۶ رقمِ مبهمِ سامان/بلو است. پیش‌شماره‌ای که صریحاً بانکِ دیگری را می‌گوید بر اپ
     مقدم است (رقم را کد می‌خواند، نامِ اپ را مدل حدس می‌زند). */
  if (!bank && app === 'blu') {
    const d = (String(sh?.src_prefix ?? '').match(/^\d+/) || [''])[0];
    if (d.length < 6 || AMBIGUOUS_BIN6.includes(d.slice(0, 6))) bank = 'blu';
  }
  if (bank) out.push({ dim: 'bank', key: bank });
  return out;
}
