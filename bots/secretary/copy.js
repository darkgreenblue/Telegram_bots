// copy.js — همه‌ی متن‌های رو-به-کاربر (فارسی، لحن منشیِ گرم و در خدمت) + کیبوردها.
// قانون کپی‌رایتینگ ریشه (بند ۱۰): هیچ خط تیره‌ی بلند «—» یا دوتایی «--» در متن رو-به-کاربر.
import { Markup } from 'telegraf';

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
export const faNum = (n) => String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);

// برچسب فارسیِ نوع آیتم (برای جمع‌بندی و رسیدها)
export const KIND_FA = {
  event: 'جلسه',
  task: 'کار',
  read_later: 'خواندنی',
  thought: 'فکر',
};
const KIND_EMOJI = {
  event: '📅',
  task: '✅',
  read_later: '📖',
  thought: '🧵',
};

/* ---- پیام‌های ثابت ---- */
export const WELCOME =
  'سلام! من منشی شخصی‌ات هستم. 🌿\n\n' +
  'هر وقت چیزی به ذهنت رسید، همین‌جا برایم ویس بفرست یا بنویس؛ یک جلسه، یک کار، مقاله‌ای که باید بخوانی، یا فکری نصفه که نمی‌خواهی گم شود.\n\n' +
  'خودم می‌فهمم هر کدام کجا باید برود: جلسه‌ها را می‌گذارم توی تقویمت، بقیه را می‌فرستم به لیست «منشی» در تیک‌تیک تا خیالت راحت باشد.\n\n' +
  'بسپارش به من و دیگر بهش فکر نکن.';

export const NOT_ALLOWED = 'سلام! این ربات یک منشی شخصی است و فعلاً خصوصی کار می‌کند.';

export const ACK_VOICE = '🎧 گرفتمش، دارم گوش می‌دهم...';
export const ACK_TEXT = '📝 گرفتمش، دارم می‌خوانم...';
export const EXTRACTING = '🧠 دارم مرتبش می‌کنم...';
export const NOTHING = 'شنیدمت. چیز خاصی برای ثبت نبود، ولی حواسم بهت هست. 🌱';

export const ackChunkProgress = (done, total) =>
  `🎧 دارم گوش می‌دهم... (قطعه ${faNum(done)} از ${faNum(total)})`;

export const FILE_TOO_BIG =
  'تلگرام فایل‌های بالای ۲۰ مگابایت را به ربات‌ها نمی‌دهد. ویس معمولی تا حدود یک ساعت مشکلی ندارد؛ این یکی را لطفاً دو تکه برایم بفرست.';

export const TOO_LONG =
  'این ویس از حد من طولانی‌تر است (بیشتر از حدود یک ساعت). لطفاً کوتاه‌ترش کن یا دو تکه بفرست تا دقیق پیاده‌اش کنم.';

export const DAILY_LIMIT =
  'سهم صوت امروزم پر شد. فردا با انرژی تازه ادامه می‌دهیم؛ اگر چیز فوری هست همین‌جا بنویسش تا از دستش ندهیم.';

export const CAPTURE_FAILED =
  'یک جای کار گیر کرد و نتوانستم کامل انجامش بدهم. متنش پیش من محفوظ است؛ با این دکمه دوباره تلاش می‌کنم.';

export const retryCaptureKb = (captureId) =>
  Markup.inlineKeyboard([[Markup.button.callback('🔁 دوباره', `cap:retry:${captureId}`)]]);

/* ---- جمع‌بندیِ چند-آیتمی ---- */
export function summaryLine(counts) {
  const parts = [];
  for (const k of ['task', 'event', 'read_later', 'thought']) {
    if (counts[k]) parts.push(`${faNum(counts[k])} ${KIND_FA[k]}`);
  }
  if (!parts.length) return '';
  return `از این پیام ${parts.join('، ')} درآوردم:`;
}

/* ---- رسید آیتم کم‌ریسک (تحویل‌شده) ---- */
export function receiptText(item) {
  const emoji = KIND_EMOJI[item.kind] || '•';
  const where = item.dest === 'ticktick' ? 'لیست «منشی» در تیک‌تیک' : 'تقویمت';
  let head;
  if (item.kind === 'task') head = `${emoji} به ${where} اضافه شد`;
  else if (item.kind === 'read_later') head = `${emoji} برای خواندن گذاشتمش در ${where}`;
  else if (item.kind === 'thought') head = `${emoji} یادداشتش کردم در ${where}`;
  else head = `${emoji} ثبت شد در ${where}`;
  let t = `${head}:\n«${item.title}»`;
  if (item.due_at) t += `\n🗓 ${whenFa(item.due_at, item.all_day)}`;
  return t;
}
export const deliveredKb = (itemId) =>
  Markup.inlineKeyboard([[
    Markup.button.callback('↩️ برگردان', `it:undo:${itemId}`),
    Markup.button.callback('✏️ اصلاح', `it:edit:${itemId}`),
  ]]);

/* ---- کارت تأیید (آیتم پرریسک: جلسه/تقویم یا کم‌اطمینان) ---- */
export function confirmCardText(item) {
  const emoji = KIND_EMOJI[item.kind] || '•';
  const dest = item.dest === 'gcal' ? 'تقویمت' : 'لیست «منشی» در تیک‌تیک';
  let t = `${emoji} این را بگذارم توی ${dest}؟\n\n«${item.title}»`;
  if (item.body) t += `\n${item.body}`;
  if (item.due_at) t += `\n🗓 ${whenFa(item.due_at, item.all_day, item.end_at)}`;
  if (item.quote) t += `\n\nگفته بودی: «${item.quote}»`;
  return t;
}
export const confirmKb = (itemId) =>
  Markup.inlineKeyboard([[
    Markup.button.callback('✅ ثبت کن', `it:ok:${itemId}`),
    Markup.button.callback('✏️ ویرایش', `it:edit:${itemId}`),
    Markup.button.callback('❌ بی‌خیال', `it:no:${itemId}`),
  ]]);

/* ---- خطای تحویل (مثلاً تیک‌تیک وصل نیست) ---- */
export function deliverFailedText(item) {
  return `${KIND_EMOJI[item.kind] || '•'} «${item.title}»\nنتوانستم همین الان ثبتش کنم. نگه‌اش داشتم؛ با دکمه دوباره تلاش می‌کنم.`;
}
export const retryItemKb = (itemId) =>
  Markup.inlineKeyboard([[Markup.button.callback('🔁 دوباره بفرست', `it:retry:${itemId}`)]]);

/* ---- ویرایش ---- */
export const EDIT_PROMPT = 'بگو چه چیزش را عوض کنم، مثلاً: «ساعتش ۵ باشد» یا «عنوانش را بکن پیگیری قرارداد».';
export const EDIT_DONE = '✏️ اصلاحش کردم.';
export const EDIT_FAIL = 'نتوانستم اصلاحش را بفهمم. یک بار دیگر واضح‌تر بگو.';

/* ---- undo / dismiss ---- */
// برای پاک‌کردن دکمه‌های inline هنگام ویرایشِ پیام به حالت نهایی (undo/dismiss)
export const EMPTY_KB = Markup.inlineKeyboard([]);
export const UNDONE = '↩️ برگرداندمش، انگار نه انگار.';
export const UNDO_FAIL = 'موقع برگرداندن یک مشکل پیش آمد. کمی بعد دوباره امتحان کن.';
export const DISMISSED = '❌ بی‌خیالش شدم.';
export const ALREADY_DONE = 'این مورد قبلاً رسیدگی شد.';
export const BTN_EXPIRED = 'این دکمه دیگر معتبر نیست.';

/* ---- TickTick اتصال ---- */
export const TICKTICK_NOT_CONFIGURED =
  'اتصال تیک‌تیک هنوز روی سرور تنظیم نشده (کلیدهایش در Secrets نیست). فعلاً کارها را نمی‌توانم به تیک‌تیک بفرستم.';
export const ticktickAuthMsg = (url) =>
  'برای وصل‌کردن تیک‌تیک این لینک را باز کن و اجازه بده:\n' +
  url +
  '\n\nبعد از تأیید، صفحه‌ای باز می‌شود که آدرسش کد را دارد. کل آن آدرس (یا فقط کد) را با دستور زیر برایم بفرست:\n' +
  '/ticktick_code <کد>';
export const TICKTICK_CODE_MISSING = 'کدی پیدا نکردم. بعد از /ticktick_code آدرس یا کد را بگذار.';
export const TICKTICK_CONNECTED = '✅ تیک‌تیک وصل شد. از این به بعد کارها و خواندنی‌ها را به لیست «منشی» می‌فرستم.';
export const TICKTICK_CODE_FAIL = 'کد را نپذیرفت. ممکن است منقضی شده باشد؛ دوباره /ticktick را بزن و کد تازه بگیر.';
export const ticktickReauthMsg = (url) =>
  '🔑 اتصال تیک‌تیک دارد قدیمی می‌شود یا دیگر کار نمی‌کند. لطفاً دوباره وصلش کن:\n' + url +
  '\n\nبعد کد را با /ticktick_code بفرست.';

/* ---- Google Calendar ---- */
export const GCAL_NOT_CONFIGURED =
  'اتصال گوگل‌کلندر هنوز روی سرور تنظیم نشده (کلید Service Account در Secrets نیست). فعلاً جلسه‌ها را در تقویم ثبت نمی‌کنم.';

/* ---- /memory ---- */
export const memoryText = (m) =>
  m && m.trim()
    ? 'چیزهایی که تا حالا درباره‌ات یاد گرفته‌ام:\n\n' + m.trim()
    : 'هنوز چیز خاصی درباره‌ی سلیقه‌ها و حساسیت‌هایت یاد نگرفته‌ام. هرچه بیشتر باهم کار کنیم، بهتر می‌شناسمت.';

export const RESET_DONE = '🧹 همه‌چیز پاک شد؛ مثل روز اول شروع می‌کنیم.';

/* ---- نمایش تاریخ/ساعت فارسی (تقویم شمسیِ تهران) ---- */
const FA_WEEKDAY = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const FA_MONTH = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

// unixSec → «پنجشنبه ۲۶ تیر، ساعت ۱۵:۰۰» (به وقت تهران، تقویم شمسی). end اختیاری برای بازه.
export function whenFa(unixSec, allDay = 0, endSec = null) {
  if (!unixSec) return '';
  const d = new Date(unixSec * 1000);
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: 'Asia/Tehran', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const wdEn = get('weekday'); // Sun..Sat
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd = FA_WEEKDAY[wdMap[wdEn] ?? 6];
  const day = parseInt(get('day'), 10);
  const monthNum = parseInt(get('month'), 10); // 1..12 شمسی
  const mon = FA_MONTH[(monthNum - 1) % 12] || '';
  let s = `${wd} ${faNum(day)} ${mon}`;
  if (!allDay) {
    s += `، ساعت ${hm(unixSec)}`;
    if (endSec && endSec > unixSec) s += ` تا ${hm(endSec)}`;
  }
  return s;
}
function hm(unixSec) {
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(unixSec * 1000));
  return faNum(t);
}
