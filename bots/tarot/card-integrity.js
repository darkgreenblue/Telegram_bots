/* 🃏 یکپارچگیِ کارت و متنِ فال — ماژولِ **خالص** (بدونِ telegraf/db/npm).
 *
 * 🐛 باگِ واقعی (پیداشده از دلِ دیتای گفتگو، ۱۴۰۵/۰۷/۰۹): متنِ یک فال از ۸٬۷۶۱ فالِ اخیر
 * (#27576) درباره‌ی کارت‌هایی بود که **کشیده نشده بودند**؛ کاربر تصویرِ سه کارت را می‌دید و
 * تفسیرِ کارت‌های دیگری را می‌خواند، و گفتگو (که کارت‌های واقعی را دارد) بعد با فال تناقض
 * می‌گفت. مدل خطا کرده، پس درمانش رد کردن و دوباره ساختن است، نه وصله.
 *
 * ⚠️ قاعده عمداً **تنگ** است: فقط وقتی رد می‌کند که متن دست‌کم دو کارتِ کشیده‌نشده را نام
 * ببرد **و هیچ‌کدام** از کارت‌های کشیده‌شده را نه. روی همان ۸٬۷۶۱ فال دقیقاً همان یک مورد را
 * گرفت و هیچ مثبتِ کاذبی نداد (۸۰ فالِ دیگر کارتِ بیگانه داشتند ولی کنارِ کارت‌های خودشان؛
 * همه ارجاعِ عادی به فالِ قبلی). ارجاعِ عادی به فالِ قبلی («برجِ فالِ قبلی…») کنارِ کارت‌های
 * خودِ فال هیچ‌وقت رد نمی‌شود. گاردِ پرسروصدا یعنی هزینه و تأخیرِ بی‌دلیل روی فالِ سالم
 * (بند ۲و/۶ب-۲ ریشه).
 *
 * ⚠️ نام‌های تک‌کلمه‌ایِ روزمره (ماه، خورشید، مرگ، قدرت…) شمرده نمی‌شوند: «چند ماه دیگه»
 * کارتِ ماه نیست. زبانی که فهرستِ ابهامش را نداریم فقط با نام‌های چندکلمه‌ای سنجیده می‌شود. */
const AMBIG = {
  fa: new Set(['دیوانه', 'عاشقان', 'ارابه', 'قدرت', 'عدالت', 'مرگ', 'اعتدال', 'برج', 'ستاره', 'ماه', 'خورشید', 'رستاخیز', 'جهان']),
};
export const normCardText = (s) => String(s == null ? '' : s)
  .replace(/[‌‏‎]/g, '')
  .replace(/[ً-ٰٟ]/g, '')
  .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
  .replace(/\s+/g, ' ');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** همه‌ی متنِ کاربرپسندِ یک خروجیِ v4 (فیلدها رشته یا آبجکتِ `{text}`). */
export function readingText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const t = (x) => (x && typeof x === 'object' ? x.text : x) || '';
  const reads = Array.isArray(obj.reads) ? obj.reads.map(t) : [];
  const teasers = Array.isArray(obj.cards) ? obj.cards.map((c) => (c && typeof c === 'object' ? c.teaser : '') || '') : [];
  return [obj.headline, obj.pattern, ...reads, ...teasers, obj.callback, obj.closing].map(t).join(' \n ');
}
/** کلیدهای کارت‌هایی که نامشان در متن آمده. نام‌های بلندتر اول، و هر نامِ پیداشده مصرف می‌شود
 * تا نامِ کوتاه‌تری که داخلِ نامِ بلندترِ پیداشده است دوباره شمرده نشود. */
export function cardMentions(text, allKeys, nameOf, lang = 'fa') {
  const amb = AMBIG[lang];
  const names = allKeys
    .map((k) => ({ k, n: normCardText(nameOf(k)).trim() }))
    .filter((x) => x.n && (amb ? !amb.has(x.n) : x.n.includes(' ')))
    .sort((a, b) => b.n.length - a.n.length);
  let s = normCardText(text);
  const found = new Set();
  for (const x of names) {
    // پسوندِ اضافه/ملکی («سکه‌ی»، «جامش»، «شمشیرها») هم همان کارت است (نیم‌فاصله قبلاً حذف شده).
    const re = new RegExp(`(^|[^\\p{L}])${esc(x.n)}(?:ی|ای|اش|ش|ها|های)?(?![\\p{L}])`, 'u');
    if (re.test(s)) { found.add(x.k); s = s.split(x.n).join(' '); }
  }
  return found;
}
/** `bad` فقط وقتی true است که متن ≥۲ کارتِ کشیده‌نشده و صفر کارتِ کشیده‌شده را نام ببرد. */
export function cardMismatch(obj, drawnKeys, allKeys, nameOf, lang = 'fa') {
  const found = cardMentions(readingText(obj), allKeys, nameOf, lang);
  const drawn = new Set(drawnKeys);
  const foreign = [...found].filter((k) => !drawn.has(k));
  const hits = [...found].filter((k) => drawn.has(k));
  return { foreign, hits, bad: foreign.length >= 2 && hits.length === 0 };
}
