// هسته‌ی خالصِ «گفتگوی پس از فال» — همه‌چیزِ ساختنِ یک نوبتِ گفتگو که به تلگرام و SQLite
// کاری ندارد. دوقلوی `reading-core.js` و با همان قاعده: هیچ import از telegraf/
// better-sqlite3، هیچ دسترسی به db، هیچ state. هر چیزی که به کاربرِ مشخص یا رکوردِ
// دیتابیس نیاز دارد پارامتر است.
//
// چرا ماژولِ جدا و نه چند تابع در `index.js`: گارد و سنجه باید **یک** کد باشند. اگر
// آزمایشگاه کپیِ منطق داشته باشد، دیر یا زود چیزی را سبز گزارش می‌کند که ربات ردش
// می‌کند (درسِ ثبت‌شده‌ی گافِ تیزر و `v4Text`). سنجه‌ی «قلاب» و سنجه‌ی «لنگر» دقیقاً
// همان متنی را می‌بینند که به کاربر می‌رسد، چون از همین فایل می‌آیند.
import { CARD_BY_KEY } from './cards.js';
import { cardName, cardKeywords, positionName, spreadName, readText, noDash } from './reading-core.js';

const LOCALE = process.env.LOCALE?.trim() || 'fa';

/* ═══ بودجه‌ی عددیِ کانتکست ═══
 *
 * چرا عدد و نه «هرچه شد»: ورودیِ متورم هم گران است هم کیفیت را پایین می‌آورد (همان
 * قاعده‌ی v3.5.3 برای پرامپتِ خوانش). همه‌ی اجزا سقفِ عددی دارند، پس جمع **ریاضی‌وار
 * کران‌دار** است و چکِ CI همان کران را ادعا می‌کند: اگر فردا کسی سقفِ تاریخچه را
 * دو برابر کند، قرمز می‌شود.
 *
 * ⚠️ و مهم‌تر از سقف، **ترتیب** است: پیشوندِ ثابت (پرامپت + کانتکستِ فال) در طولِ یک
 * گفتگو بیت‌به‌بیت یکسان می‌ماند و نوبت‌ها فقط به دُمش اضافه می‌شوند. اندازه‌گیریِ
 * تأییدشده‌ی ۱۴۰۵/۰۶/۲۱ (`prompt_tokens_details.cached_tokens`) نشان داد پیشوندِ ثابتِ
 * فال با ~۶۵٪ نرخ کش می‌شود؛ این‌جا شرایط بهتر است چون نوبت‌های یک گفتگو در فاصله‌ی
 * ثانیه‌ای می‌آیند. بدونِ این چیدمان، اقتصادِ گفتگو **نمی‌ارزد** (هزینه‌ی هر پیام از
 * ۲۰٪ یک فال به ۵۹٪ می‌پرد)، پس این یک بهینه‌سازی نیست، یک شرطِ طراحی است. */
export const CHAT_BUDGET = {
  sys: 3500,      // پرامپتِ سیستم (سقفِ سورس هم همین است؛ چکِ CI قفلش کرده)
  question: 500,  // سؤالِ اصلیِ فال
  cards: 900,     // چیدمان و کارت‌ها
  reading: 2800,  // متنِ تحویل‌شده‌ی فال (چکیده)
  memory: 800,    // شناختِ انباشتی
  prev: 400,      // دو فالِ قبلی
  hist: 5400,     // تاریخچه‌ی گفتگو (فشرده + نوبت‌های خام)
  ask: 700,       // سؤالِ فعلی
  total: 15000,   // کرانِ بالای جمعِ همه (بدترین حالت)
};
/* ⚠️ `hist` یک **سقفِ اجراشونده** است، نه یک عددِ تزئینی در مستندات.
 * نسخه‌ی اول فقط هر نوبت را جدا می‌بُرید (۱۰ نوبت × ۷۰۰ + فشرده = ۸۰۰۰)، پس عددِ
 * اعلام‌شده از بودجه‌ی واقعی **کمتر** بود و «کرانِ کل» یک ادعای نادرست می‌شد. چکِ CI
 * جمعِ اجزا را با `total` می‌سنجد، پس این دو ساختاراً نمی‌توانند واگرا شوند. */
export const CHAT_RECENT_TURNS = 5;    // نوبت‌های کاملِ خام
export const CHAT_DIGEST_CHARS = 1000; // فشرده‌ی نوبت‌های قدیمی‌تر
export const CHAT_DIGEST_ITEM  = 120;  // سقفِ هر سؤالِ قدیمی در فشرده
export const CHAT_HARD_CHARS   = 900;  // سقفِ خروجیِ مدل (validate)
export const CHAT_MIN_CHARS    = 20;   // کفِ خروجیِ مدل (جوابِ تک‌کلمه‌ای = خرابی)

const cut = (s, n) => {
  const t = String(s == null ? '' : s).trim();
  return t.length <= n ? t : t.slice(0, n).trim();
};

/* ═══ چکیده‌ی فالِ تحویل‌شده ═══
 *
 * ⚠️ عمداً **تیزرها را نمی‌آورد**: تیزر معرفیِ کارت هنگام رو شدن است و کارِ همان لحظه
 * را کرده؛ در گفتگو فقط بودجه می‌خورد. و عمداً `card-knowledge` هم داده نمی‌شود:
 * متنِ تحویل‌شده از قبل **نتیجه‌ی** همان دانش است، پس فرستادنش یعنی ۳۰۰۰ کاراکترِ
 * تکراری (بزرگ‌ترین صرفه‌جوییِ رایگانِ این طراحی).
 *
 * ترتیب همان ترتیبِ خوانش است (سرخط ← ارجاع ← الگو ← کارت‌به‌کارت ← جمع‌بندی) تا مدل
 * همان نقشه‌ی ذهنی را ببیند که کاربر خوانده. */
export function chatReadingDigest(llm, cards = [], labels = []) {
  if (!llm) return '';
  const n = cards.length || (llm.reads || []).length;
  const readLines = (llm.reads || []).slice(0, n).map((x, i) => {
    const t = readText(x);
    if (!t) return '';
    return `${labels[i] || `کارت ${i + 1}`} ${cut(t, 220)}`;
  }).filter(Boolean);
  const parts = [
    llm.headline && `سرخط: ${cut(llm.headline, 300)}`,
    llm.callback && `ارجاع: ${cut(llm.callback, 250)}`,
    llm.pattern && `الگو: ${cut(llm.pattern, 400)}`,
    readLines.length ? `کارت‌به‌کارت:\n${readLines.join('\n')}` : '',
    llm.closing && `جمع‌بندی: ${cut(llm.closing, 500)}`,
  ].filter(Boolean);
  return cut(parts.join('\n'), CHAT_BUDGET.reading);
}

/* ═══ کانتکستِ فال (نیمه‌ی دومِ پیشوندِ ثابت) ═══
 *
 * ⚠️ نامِ کاربر نه به مدل داده می‌شود و نه کد می‌چسباند. در خوانش، کد **یک بار** اولِ
 * سرخط می‌چسباندش چون یک پیامِ رسمیِ واحد است؛ در یک گفتگوی چندنوبتی، صدا زدنِ اسم در
 * هر نوبت دقیقاً همان باگی است که v4 بست، فقط بدتر. */
export function buildChatCtx({ reading, llm, cards = [], spread = null, labels = [], memory = '', prev = [], L = null }) {
  const cardLines = cards.map((c, i) => {
    const kw = cardKeywords(c.key);
    const dir = c.reversed ? 'معکوس' : 'مستقیم';
    const words = (c.reversed ? kw.down : kw.up).slice(0, 4).join('، ');
    const pos = spread ? positionName(spread.positions?.[i]?.fa, i) : (labels[i] || '');
    return `${labels[i] || `کارت ${i + 1}`} ${cardName(c.key)} (${CARD_BY_KEY[c.key]?.en || ''}) ${dir}${pos ? ` · جایگاه: ${pos}` : ''}${words ? ` · ${words}` : ''}`;
  });
  const prevLines = prev.slice(0, 2).map((r) => cut(`${r.type}: ${r.summary || ''}`, 200));
  const block = [
    `سؤالِ اصلیِ این فال: ${cut(reading?.question, CHAT_BUDGET.question) || '-'}`,
    spread ? `چیدمان: ${spreadName(spread.fa)}` : '',
    cardLines.length ? `کارت‌های همین فال:\n${cut(cardLines.join('\n'), CHAT_BUDGET.cards)}` : '',
    `متنی که برایش نوشتی:\n${chatReadingDigest(llm, cards, labels)}`,
    memory ? `شناختی که از او داری: ${cut(memory, CHAT_BUDGET.memory)}` : '',
    prevLines.length ? `فال‌های قبلی‌اش:\n${cut(prevLines.join('\n'), CHAT_BUDGET.prev)}` : '',
  ].filter(Boolean).join('\n\n');
  return L?.prompts?.chatContext ? L.prompts.chatContext(block) : block;
}

/* ═══ بسته‌بندیِ تاریخچه ═══
 *
 * ⚠️ خلاصه‌سازی **بدونِ فراخوانیِ مدل** انجام می‌شود، و این یک تصمیم است نه میان‌بر:
 *   ۱) **قطعی است** — همان ورودی همیشه همان کانتکست را می‌دهد، پس مقایسه‌ی جفت‌شده‌ی
 *      آزمایشگاه سالم می‌ماند (کلِ متدولوژیِ این ریپو روی همین ایستاده).
 *   ۲) **رایگان است** — خلاصه‌ی رولینگ یعنی ~۳۰٪ هزینه‌ی بیشتر برای چیزی که نوبتِ ۱
 *      تا ۵ اصلاً لازمش ندارند.
 *   ۳) **نقطه‌ی خرابیِ تازه نمی‌سازد** — خلاصه‌ی خراب یعنی گفتگویی که بی‌صدا حافظه‌اش
 *      را از دست می‌دهد.
 * و چرا فقط **سؤال‌های خودِ کاربر** فشرده می‌شوند: آن‌ها پرچگال‌ترین سیگنالِ نخِ گفتگو
 * اند. جوابِ ما را می‌شود دور ریخت (مدل خودش نوشته و سبکش را می‌داند)، سؤالِ او را نه. */
export function packHistory(rows = [], { recent = CHAT_RECENT_TURNS, digestChars = CHAT_DIGEST_CHARS } = {}) {
  const clean = rows.filter(r => r && r.role && String(r.text || '').trim());
  const keep = recent * 2;                         // هر نوبت = یک سؤال + یک جواب
  const tail = keep > 0 ? clean.slice(-keep) : [];
  const old  = keep > 0 ? clean.slice(0, -keep) : clean;
  const asked = [];
  let used = 0;
  // از **تازه‌ترین** به عقب برداشته می‌شود تا وقتی بودجه تمام شد قدیمی‌ترها بیفتند،
  // بعد ترتیبِ زمانی برگردانده می‌شود (مدل باید سیرِ گفتگو را از قدیم به جدید ببیند).
  for (let i = old.length - 1; i >= 0; i--) {
    if (old[i].role !== 'user') continue;
    const t = cut(old[i].text, CHAT_DIGEST_ITEM);
    if (!t) continue;
    if (used + t.length + 2 > digestChars) break;
    asked.unshift(t);
    used += t.length + 2;
  }
  const digest = asked.length ? asked.map(t => `- ${t}`).join('\n') : '';
  let turns = tail.map(r => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: cut(r.text, CHAT_BUDGET.ask) }));
  // سقفِ کلِ تاریخچه: قدیمی‌ترین نوبت‌ها اول می‌افتند تا تازه‌ترین‌ها (که مدل واقعاً
  // به آن‌ها نیاز دارد) کامل بمانند. بدونِ این، `hist` فقط یک عددِ روی کاغذ بود.
  const room = Math.max(0, CHAT_BUDGET.hist - digest.length);
  let spent = turns.reduce((s, t) => s + t.content.length, 0);
  while (turns.length && spent > room) { spent -= turns[0].content.length; turns = turns.slice(1); }
  return { digest, turns };
}

/* ═══ ساختِ آرایه‌ی نقش‌ها ═══
 * پیشوندِ ثابت در **یک** پیامِ system می‌نشیند (نه دو پیام و نه داخلِ اولین پیامِ user)
 * تا یک بلوکِ پیوسته‌ی قابلِ کش بماند و نوبت‌ها append-only به دُمش اضافه شوند. */
export function toMessages(system, packed, question, L = null) {
  const msgs = [{ role: 'system', content: system }];
  if (packed?.digest) {
    const head = L?.prompts?.chatDigestHead || 'سؤال‌هایی که تا حالا در همین گفتگو پرسیده:';
    msgs.push({ role: 'user', content: `${head}\n${packed.digest}` });
    msgs.push({ role: 'assistant', content: L?.prompts?.chatDigestAck || 'باشه، یادم هست.' });
  }
  for (const t of (packed?.turns || [])) msgs.push({ role: t.role, content: t.content });
  msgs.push({ role: 'user', content: cut(question, CHAT_BUDGET.ask) });
  return msgs;
}

/** جمعِ کاراکترِ همه‌ی پیام‌ها — تنها عددی که چکِ CI کران‌دار بودنش را ادعا می‌کند. */
export const messagesChars = (msgs = []) => msgs.reduce((s, m) => s + String(m?.content || '').length, 0);

/* ═══ الگوهای زبانی ═══
 * fa پیش‌فرضِ هاردکد دارد (چون `langdata.fa.json` وجود ندارد و نباید ساخته شود)؛
 * بقیه‌ی زبان‌ها از `configureChatLang` پر می‌شوند — همان الگوی `defects[]` در repair.js.
 * ⚠️ زبانِ بی‌الگو **رفتارِ محافظه‌کارانه** می‌گیرد: گاردِ بحران خالی نمی‌ماند، چون
 * `CHAT_LOCALES` اجازه‌ی فعال شدنِ آن زبان را از اول نمی‌دهد. */
const FA_CRISIS = [
  'خودکشی', 'خودکُشی', 'خود کشی', 'بکشم', 'می‌کشم خودم', 'میکشم خودم',
  'به زندگیم پایان', 'تموم کنم زندگی', 'تمومش کنم زندگی', 'نمی‌خوام زنده',
  'نمیخوام زنده', 'دیگه نمی‌خوام باشم', 'رگم را', 'رگمو', 'قرص بخورم و بمیرم',
];
const FA_SMALLTALK = [
  'سلام', 'سلام!', 'درود', 'مرسی', 'ممنون', 'ممنونم', 'مرسی!', 'ممنون!',
  'دمت گرم', 'خداحافظ', 'بای', 'فعلا', 'فعلاً', 'باشه', 'اوکی', 'ok', 'اوک',
  'تشکر', 'سپاس', 'عالی', 'خوبه', 'قربونت',
];
/* ممنوعه‌های قلاب (chatbait). دو گروه، عمداً جدا:
 *   - تعارفِ بی‌محتوا: قلابِ توخالی که فقط مکالمه را کش می‌دهد.
 *   - چاپلوسی: تحسینِ خودِ سؤال. طبقِ Model Spec این ارزیابیِ **عملکردِ کاربر** است و
 *     یک فالگیر هیچ جایگاهی برای آن ندارد؛ و sycophancy حالتِ شکستِ مستندِ این الگوست. */
const FA_CHATBAIT = [
  'بیشتر بگم', 'بیشتر توضیح بدم', 'سؤال دیگه', 'سوال دیگه', 'در خدمتم',
  'کمکی از دستم', 'کمک دیگه', 'هر وقت خواستی بپرس', 'باز هم بپرس',
  'چیز دیگه‌ای', 'چیز دیگه ای', 'دوست داری بدونی دیگه چی',
  'سؤال خوبیه', 'سوال خوبیه', 'چه سؤال', 'چه سوال', 'آفرین', 'عالی پرسیدی',
];

let LANG = { crisis: FA_CRISIS, smallTalk: FA_SMALLTALK, chatbait: FA_CHATBAIT };
export function configureChatLang(d) {
  if (!d || typeof d !== 'object') return;
  const arr = (x, fb) => (Array.isArray(x) && x.length ? x.map(String) : fb);
  LANG = {
    crisis:    arr(d.crisis, LANG.crisis),
    smallTalk: arr(d.smallTalk, LANG.smallTalk),
    chatbait:  arr(d.chatbait, LANG.chatbait),
  };
}
export const chatLang = () => ({ ...LANG });

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[‌‏‎]/g, '')          // نیم‌فاصله و نشانه‌های جهت
  .replace(/[!؟?.,،؛:*_"'`()\[\]{}…]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** الگوی بحران که شلیک کرده، یا `''`. روی **هر طولی** از پیام اجرا می‌شود. */
export function crisisIn(text) {
  const t = norm(text);
  if (!t) return '';
  for (const p of LANG.crisis) { const n = norm(p); if (n && t.includes(n)) return p; }
  return '';
}

/* ⚠️ `smallTalkIn` عمداً **تنگ** است: کلِ پیام (بعد از نرمال‌سازی) باید خودش یکی از
 * الگوها باشد، نه اینکه شاملش باشد. یعنی «مرسی» رایگان است ولی «مرسی، ولی کارتِ دوم
 * رو نفهمیدم» یک سؤالِ واقعی است و کسر می‌شود.
 * جهتِ خطا آگاهانه است: فیلترِ گشاد یعنی سؤالِ واقعیِ کاربر بی‌جواب بماند، که از یک
 * الماسِ گاه‌به‌گاه خیلی بدتر است. چکِ CI هر دو جهت را با کنترلِ مثبت می‌سنجد. */
export const CHAT_SMALLTALK_MAX = 15;
export function smallTalkIn(text) {
  const t = norm(text);
  if (!t || t.length > CHAT_SMALLTALK_MAX) return false;
  return LANG.smallTalk.some(p => norm(p) === t);
}

/* ═══ سنجه‌ی قلاب ═══
 *
 * قاعده: خطِ آخرِ هر جواب باید به **نامِ یکی از کارت‌های همین فال** یا به یک کلمه‌ی
 * محتواییِ سؤال لنگر بخورد، و تعارفِ بی‌محتوا نباشد.
 *
 * ⚠️ حدِ صداقتِ این سنجه: «لنگر دارد» با «واقعاً کنجکاو می‌کند» یکی نیست. این کفِ
 * کیفیت است و سقفش کارِ روبریکِ سشن است. ولی همین کف دو تستِ ضدِ chatbait را
 * مکانیکی می‌کند: جمله‌ای که بشود بی‌تغییر زیرِ فالِ کاربرِ دیگری گذاشت، رد می‌شود. */
export const CHAT_HOOK_MIN = 30;
export function hookOk(reply, { cardNames = [], questionWords = [] } = {}) {
  const lines = String(reply || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, why: 'empty' };
  const last = lines[lines.length - 1];
  const nl = norm(last);
  for (const p of LANG.chatbait) { const n = norm(p); if (n && nl.includes(n)) return { ok: false, why: 'chatbait', hit: p }; }
  if (last.length < CHAT_HOOK_MIN) return { ok: false, why: 'short' };
  const anchors = [...cardNames, ...questionWords].map(norm).filter(w => w.length >= 3);
  if (!anchors.some(w => nl.includes(w))) return { ok: false, why: 'noanchor' };
  return { ok: true, why: '' };
}

/** کلماتِ محتواییِ یک سؤال (برای سنجه‌ی لنگر). حروفِ ربط و اضافه‌ی کوتاه می‌افتند. */
export function questionWordsOf(...texts) {
  const out = new Set();
  for (const t of texts) {
    for (const w of norm(t).split(' ')) if (w.length >= 4) out.add(w);
  }
  return [...out];
}

/* ═══ پاکسازیِ خروجی ═══
 * سه چیز، همه **قطعی و بدونِ مدل**: خط تیره‌ی بلند (بند ۱۰ ریشه)، برچسبی که مدل
 * خودسرانه جلوی جواب می‌گذارد، و نامِ کاربر اگر نشت کرد.
 * ⚠️ هیچ ویرایشِ معناییِ خودکاری انجام نمی‌شود: `repair.js` این‌جا صدا زده نمی‌شود
 * (یک فراخوانیِ ~۱٫۱ ثانیه‌ای برای متنی که یک‌دهمِ فال است صرف نمی‌کند). */
const LABEL_RE = /^\s*(?:تاروت[‌ ]?خوان|فالگیر|جواب|پاسخ|assistant)\s*[:：-]\s*/i;
export function cleanChatReply(text, { name = '' } = {}) {
  let t = noDash(String(text || '')).trim();
  t = t.replace(LABEL_RE, '').trim();
  if (name && name.length >= 2) {
    // فقط نامِ نشتی‌شده حذف می‌شود، نه هر کلمه‌ی مشابه: مرزِ واژه لازم است.
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(^|[\\s،,:!؟?])${esc}([\\s،,:!؟?]|$)`, 'g'), '$1$2').replace(/\s{2,}/g, ' ').trim();
  }
  return cut(t, CHAT_HARD_CHARS);
}

/** شرطِ پذیرشِ خروجیِ مدل. عمداً **کمینه**: کیفیتِ محتوا کارِ آزمایشگاه است نه retryِ کور. */
export const chatShapeOk = (out) => {
  const t = String(out || '').trim();
  return t.length >= CHAT_MIN_CHARS && t.length <= CHAT_HARD_CHARS;
};

export const chatLocale = () => LOCALE;
