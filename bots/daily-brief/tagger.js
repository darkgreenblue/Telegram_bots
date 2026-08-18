// tagger.js — ایجنتِ دومِ خط تولید: «کارگردانِ صدا».
//
// تقسیمِ کار عمدی است و از خودِ توصیه‌ی گوگل می‌آید (بلاگِ Gemini 3.1 Flash TTS:
// «برای محتوای بلند، تگ‌گذاریِ دستی ناکارآمد است؛ متن را قبل از فرستادن به مدلِ TTS با یک
// مدلِ ارزان‌تر به‌صورت برنامه‌ای annotate کنید»):
//   ۱. نویسنده (`script.js`) فقط **چه گفتن** را می‌داند: متنِ تمیزِ فارسی، بدونِ هیچ تگی.
//   ۲. کارگردان (همین فایل) فقط **چطور گفتن** را می‌داند: تگ‌های اجرا را لای همان کلمات
//      می‌گذارد و یک خطِ کارگردانی هم بالای متن می‌گذارد.
// یک ایجنتِ واحد که هر دو کار را بکند، هر بار که پرامپتِ صدا را دست بزنیم کیفیتِ محتوا را
// هم تکان می‌دهد. جدا بودنشان یعنی هر کدام را می‌شود جدا عوض کرد و جدا سنجید.
//
// ── قواعدی که از مستندات و تجربه‌ی کاربرانِ همین مدل درآمده (مرداد ۱۴۰۵) ──
// - تگ‌ها **فقط انگلیسی** و داخلِ براکت‌اند، ولی با متنِ زبان‌های دیگر ترکیب می‌شوند.
// - هیچ دو تگی نباید کنارِ هم بیایند؛ بینشان باید متن یا علامت باشد (وگرنه خطای سیستم).
// - تگ در **شروعِ جمله** پایدارترین اثر را دارد.
// - پرتکرارترین شکستِ گزارش‌شده: مدل خودِ تگ را **بلند می‌خواند** («laughs» به‌جای خنده).
//   دو چیز جلویش را می‌گیرد: چانکِ کوتاه‌تر، و تگِ کم. برای همین اینجا سقفِ چگالی داریم.
// - جمله‌ی سبک (style prompt) به شکلِ «{دستور}: {متن}» می‌آید و **خوانده نمی‌شود**؛ همان
//   جمله باید روی همه‌ی چانک‌ها تکرار شود، وگرنه صدای هر تکه کمی فرق می‌کند (voice drift).
//
// این ماژول عمداً هیچ فراخوانیِ شبکه‌ای مستقیمی ندارد: کلاینتِ LLM تزریق می‌شود تا کلِ
// منطقِ اعتبارسنجی آفلاین در CI اجرا شود.

import { log, logErr } from '../../shared/logger.js';

// یک خط، انگلیسی، پایانش دو نقطه. کوتاه است چون دستورِ بلند احتمالِ خوانده‌شدنش بیشتر است،
// و انگلیسی است چون مستنداتِ خودِ مدل همین شکل را نمونه داده‌اند. «Persian» صراحتاً آمده
// تا لهجه‌ی متن جابه‌جا نشود.
export const STYLE_DIRECTIVE =
  'Read the following Persian podcast script warmly and clearly, like a friendly teacher '
  + 'talking to one person, unhurried, with natural Persian pronunciation:';

// تگ‌های مجاز. عمداً کوتاه است: کاتالوگِ مدل بیش از دویست تگ دارد ولی یک پادکستِ آموزشی
// به هیجانِ نمایشی احتیاج ندارد و هر تگِ اضافه یک شانسِ تازه برای بلندخوانده‌شدنِ تگ است.
// هر تگی بیرونِ این لیست در پاکسازی حذف می‌شود، حتی اگر مدل اسمِ معتبری ساخته باشد.
export const ALLOWED_TAGS = [
  // لحن
  'enthusiasm', 'curiosity', 'interest', 'awe', 'determination', 'hope', 'amusement', 'calm',
  // ریتم
  'slow', 'fast',
  // مکث
  'short pause', 'long pause',
];

// سقفِ چگالی: به‌ازای هر این تعداد کلمه حداکثر یک تگ. عددش محافظه‌کارانه است چون
// هزینه‌ی تگِ زیادی (خوانده‌شدنِ تگ وسطِ قسمت) خیلی بیشتر از سودِ تگِ اضافه است.
export const WORDS_PER_TAG = 45;
// حتی در متنِ خیلی بلند هم از این بیشتر نه: بالای این عدد دیگر «اجرا» نیست، شلوغی است.
export const MAX_TAGS = 40;

const TAG_RE = /\[([^\]\n]{1,24})\]/g;

export const stripTags = (s) => String(s || '').replace(TAG_RE, ' ');

// مقایسه‌ی «کلماتِ گفتنی». نرمال‌سازی عمداً سخاوتمند است (نیم‌فاصله، فاصله‌ی چندتایی،
// شکل‌های مختلفِ ی/ک عربی و فارسی) تا تفاوتِ بی‌ضررِ تایپی به‌عنوان دستکاری شمرده نشود.
export function normalizeWords(s) {
  return stripTags(s)
    .replace(/[‌‏‎]/g, ' ')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/* ===== پاکسازی و اعتبارسنجیِ خروجیِ کارگردان ===== */
// چرا کد این کار را می‌کند و نه پرامپت: پرامپت «معمولاً» رعایت می‌شود، ولی این متن مستقیم
// به یک سرویسِ پولی می‌رود و اشتباهش را کاربر در گوشش می‌شنود. قاعده‌ی ریپو: مدل می‌خواند،
// کد تصمیم می‌گیرد.
//
// خروجی: {text, tags, dropped, ok, reason}
//   ok=false یعنی متن دستکاری شده و باید همان متنِ اصلیِ بی‌تگ به TTS برود.
export function sanitizeTagged(tagged, original) {
  const raw = String(tagged || '');
  const src = String(original || '');
  if (!raw.trim()) return { text: src, tags: 0, dropped: 0, ok: false, reason: 'خروجیِ خالی' };

  // ۱. کلماتِ گفتنی نباید عوض شده باشند. کارگردان حقِ بازنویسی ندارد؛ اگر داشته باشد،
  //    کیفیتِ محتوا و اتصالش به یادداشتِ Notion بی‌صدا از دست می‌رود.
  if (normalizeWords(raw) !== normalizeWords(src)) {
    return { text: src, tags: 0, dropped: 0, ok: false, reason: 'متن دستکاری شده' };
  }

  const budget = Math.min(MAX_TAGS, Math.max(1, Math.floor(countWordsPlain(src) / WORDS_PER_TAG)));
  let kept = 0;
  let dropped = 0;
  let lastWasTag = false;

  // ۲. تگِ ناشناخته حذف، تگِ چسبیده به تگ حذف، و هرچه از سقف بیشتر بود حذف.
  let out = raw.replace(TAG_RE, (m, name) => {
    const tag = String(name).trim().toLowerCase();
    const okTag = ALLOWED_TAGS.includes(tag) && !lastWasTag && kept < budget;
    if (!okTag) { dropped++; return ' '; }
    kept++; lastWasTag = true;
    return `[${tag}]`;
  });

  // بینِ دو تگ باید متن باشد؛ اگر مدل با یک فاصله جداشان کرده بود، دومی بالا حذف شده.
  // اینجا فقط فاصله‌ی دور تگ‌ها را مرتب می‌کنیم تا به کلمه نچسبند (قاعده‌ی فاصله).
  out = out
    .replace(/\s*\[([^\]\n]+)\]\s*/g, ' [$1] ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // ۳. تگِ آخرِ متن هیچ کلمه‌ای برای اجرا ندارد و فقط ریسکِ خوانده‌شدن است.
  out = out.replace(/(?:\s*\[[^\]\n]+\])+\s*$/,'').trim();

  return { text: out, tags: (out.match(TAG_RE) || []).length, dropped, ok: true, reason: '' };
}

const countWordsPlain = (s) => stripTags(s).trim().split(/\s+/).filter(Boolean).length;

/* ===== پرامپتِ کارگردان ===== */
const SYSTEM = `تو کارگردانِ صدای یک پادکستِ آموزشیِ فارسی هستی. کارِ تو نوشتن نیست، اجراست.

متنِ نهایی به موتورِ صدای Gemini می‌رود. وظیفه‌ی تو فقط این است که تگ‌های اجرا را لای همین
متن بگذاری تا خواندنش زنده و طبیعی شود.

قواعدِ آهنین:
۱. حتی یک کلمه از متن را عوض، اضافه یا حذف نکن. ترتیبِ جمله‌ها هم دست‌نخورده بماند. تنها
   چیزی که اضافه می‌کنی تگ است.
۲. تگ‌ها فقط از این لیست‌اند و فقط انگلیسی و داخلِ براکت: ${ALLOWED_TAGS.map((t) => `[${t}]`).join(' ')}
۳. هیچ دو تگی کنارِ هم نیاید. بینِ هر دو تگ باید متن باشد.
۴. تگ را در شروعِ جمله بگذار، نه وسطِ عبارت.
۵. کم بگذار. حدوداً هر ${WORDS_PER_TAG} کلمه یک تگ، نه بیشتر. تگِ زیاد باعث می‌شود موتور
   خودِ تگ را بلند بخواند و کلِ قسمت خراب شود.
۶. تگ را جایی بگذار که واقعاً معنی دارد: [short pause] قبل از یک نکته‌ی مهم، [slow] روی
   تعریفِ کلیدی، [curiosity] روی سؤال، [enthusiasm] روی نتیجه‌ی جالب. تگِ تزئینی نگذار.
۷. خروجی فقط خودِ متنِ تگ‌خورده باشد. هیچ توضیح، عنوان، براکتِ غیرِ تگ یا علامتِ نقلِ قول
   اضافه نکن.`;

export function buildTagPrompt(text) {
  return `این متنِ قسمتِ امروز است. همین را با تگ‌های اجرا برگردان:\n\n${text}`;
}

/* ===== ورودیِ اصلی ===== */
// llm = همان کلاینتِ script.js (chatResilient). شکست هیچ‌وقت قسمت را نمی‌کشد: متنِ بی‌تگ
// خودش کاملاً قابلِ پخش است، پس این مرحله «بهبود» است نه «شرطِ لازم».
export async function tagScript(llm, text, { model = null } = {}) {
  const src = String(text || '');
  if (!src.trim()) return { text: src, tags: 0, usage: { in: 0, out: 0 }, ids: [], models: [], ok: false };

  const res = await llm.chatResilient(SYSTEM, buildTagPrompt(src), {
    temperature: 0.4, // اجرا، نه خلاقیت: دمای بالا یعنی تگِ پرت و بازنویسیِ ناخواسته
    ...(model ? { plan: [model, model] } : {}),
    validate: (out) => sanitizeTagged(out, src).ok,
  });
  if (!res) {
    logErr('🎭 tagger: هیچ خروجیِ سالمی نیامد، متنِ بی‌تگ می‌رود به صدا');
    return { text: src, tags: 0, usage: { in: 0, out: 0 }, ids: [], models: [], ok: false };
  }
  const clean = sanitizeTagged(res.text, src);
  if (!clean.ok) {
    logErr(`🎭 tagger: خروجی رد شد (${clean.reason})`);
    return { text: src, tags: 0, usage: res.usage, ids: [res.id].filter(Boolean), models: [res.model], ok: false };
  }
  log(`🎭 tagger: ${clean.tags} تگ گذاشته شد (${clean.dropped} تگ حذف شد)`);
  return {
    text: clean.text,
    tags: clean.tags,
    usage: res.usage,
    ids: [res.id].filter(Boolean),
    models: [res.model],
    ok: true,
  };
}
