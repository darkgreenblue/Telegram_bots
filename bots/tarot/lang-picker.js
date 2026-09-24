/* 🌍 انتخابگرِ زبانِ رباتِ واحدِ چندزبانه (خواسته‌ی مالک ۱۴۰۵/۰۶/۲۶).
 *
 * ── چه می‌کند ─────────────────────────────────────────────────────────────
 * اولین پیامِ رباتِ چندزبانه بعد از `/start`. عمداً **انگلیسی** است (زبانِ پیش‌فرض)،
 * چون هنوز نمی‌دانیم کاربر چه زبانی دارد. ۱۵ زبانِ پرکاربردِ تلگرام با پرچم و نامِ
 * **بومی** نشان داده می‌شوند و ✅ کنارِ انگلیسی است.
 *
 * زبانی که ساخته شده (`LANGS` همین پروسه) سفرِ کاربر را عادی ادامه می‌دهد. زبانی که
 * هنوز ساخته نشده پیامِ «به‌زودی» می‌گیرد و فقط زبان‌های ساخته‌شده را می‌بیند؛ و همان
 * کلیک ثبت می‌شود (`lang_picked`، propِ `supported:0`) چون هدفِ اصلیِ این لیستِ بلند
 * **تحقیقِ بازار** است: پرکلیک‌ترین زبانِ ناموجود اولویتِ بعدیِ ساخت است.
 *
 * ── چرا متن‌ها این‌جا هستند و نه در `locales/` ────────────────────────────
 * این پیام **قبل از** دانستنِ زبانِ کاربر می‌آید، پس ساختاراً فقط یک زبان دارد. گذاشتنش
 * در هر پنج locale یعنی چهار ترجمه‌ی کدِ مرده (و افزودنِ کلید به `fa.js`، که قرار نیست
 * لمس شود). استثنای زبانیِ ثبت‌شده در `bots/tarot/CLAUDE.md` است.
 *
 * ماژولِ **خالص** است (بدونِ telegraf و دیتابیس) تا چکِ CI بتواند مستقیم اجرایش کند.
 */

/** ۱۵ زبان، به ترتیبِ نمایش. انگلیسی اول (پیش‌فرض). کد = همان کدِ `locales/<code>.js`. */
export const PICKER_LANGS = Object.freeze([
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'es', flag: '🇪🇸', name: 'Español' },
  { code: 'ru', flag: '🇷🇺', name: 'Русский' },
  { code: 'pt', flag: '🇧🇷', name: 'Português' },
  { code: 'fr', flag: '🇫🇷', name: 'Français' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'tr', flag: '🇹🇷', name: 'Türkçe' },
  { code: 'ar', flag: '🇸🇦', name: 'العربية' },
  { code: 'hi', flag: '🇮🇳', name: 'हिन्दी' },
  { code: 'id', flag: '🇮🇩', name: 'Indonesia' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська' },
  { code: 'uz', flag: '🇺🇿', name: 'Oʻzbek' },
  { code: 'pl', flag: '🇵🇱', name: 'Polski' },
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
]);
export const PICKER_BY_CODE = Object.freeze(Object.fromEntries(PICKER_LANGS.map(l => [l.code, l])));

/** متن‌های انگلیسیِ ثابت (پیام قبل از انتخابِ زبان). بدونِ «—» (بند ۱۰ ریشه). */
export const PICKER_TEXT = Object.freeze({
  ask: '🌍 Please choose your language:',
  unsupported: '😔 Sorry, this language isn’t available yet. We’ll add it very, very soon!\n\nPlease choose one of these languages:',
});

/* callback_data: `lang:<code>` برای لیستِ کامل، `lang:<code>:s` برای لیستِ کوتاهِ
 * «فقط زبان‌های ساخته‌شده». پسوند لازم است تا ✅ روی **همان** لیستی جابه‌جا شود که
 * کاربر رویش زده، بدونِ اینکه چیزی در سشن نگه داریم (دکمه‌ی کهنه هم درست کار می‌کند). */
export const LANG_CB = /^lang:([a-z]{2,3})(?::([st]))?$/;
// پسوندها: '' = لیستِ کامل (اولین پیام) · 's' = فقط ساخته‌شده‌ها (بعد از زبانِ ناموجود) ·
// 't' = فقط ساخته‌شده‌ها داخلِ تنظیمات (همراهِ دکمه‌ی بازگشت به تنظیمات).

/**
 * ردیف‌های کیبوردِ اینلاین. خروجی آرایه‌ی ساده‌ی `{text, callback_data}` است تا این
 * ماژول به telegraf وابسته نشود؛ `index.js` مستقیم در `inline_keyboard` می‌گذاردش.
 * @param {string[]} codes   کدهای قابلِ نمایش به ترتیبِ `PICKER_LANGS`
 * @param {string} checked   کدی که ✅ می‌گیرد
 * @param {''|'s'|'t'} suffix  نوعِ لیست (بالا)
 */
export function pickerRows(codes, checked, suffix = '') {
  const set = new Set(codes);
  const items = PICKER_LANGS.filter(l => set.has(l.code)).map(l => ({
    text: `${l.flag} ${l.name}${l.code === checked ? ' ✅' : ''}`,
    callback_data: `lang:${l.code}${suffix ? ':' + suffix : ''}`,
  }));
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

/** لیستِ کامل برای اولین پیام. */
export const fullCodes = () => PICKER_LANGS.map(l => l.code);

/** فقط زبان‌هایی که این پروسه واقعاً می‌سازد، به ترتیبِ نمایش. */
export const supportedCodes = (langs) => PICKER_LANGS.map(l => l.code).filter(c => langs.includes(c));

/* متن‌های کوتاهِ تغییرِ زبان برای کاربرِ **آنبوردشده** (از تنظیمات یا `/language`). این‌ها
 * به زبانِ خودِ کاربرند، ولی فقط پروسه‌ی چندزبانه صدایشان می‌زند؛ برای همین این‌جا هستند
 * و نه در `locales/` (فارسی و پرتغالیِ تک‌زبانه هرگز این مسیر را ندارند). */
export const LANG_UI = Object.freeze({
  en: { button: '🌍 Language', ask: '🌍 Choose your language:', saved: '✅ Done! From now on I’ll talk to you in English.' },
  es: { button: '🌍 Idioma',   ask: '🌍 Elige tu idioma:',      saved: '✅ ¡Listo! Desde ahora te hablo en español.' },
  ru: { button: '🌍 Язык',     ask: '🌍 Выбери язык:',          saved: '✅ Готово! Теперь я говорю с тобой по-русски.' },
  pt: { button: '🌍 Idioma',   ask: '🌍 Escolha seu idioma:',   saved: '✅ Pronto! A partir de agora falo com você em português.' },
});
export const langUi = (lang) => LANG_UI[lang] || LANG_UI.en;

/* 🪪 نام و بیوی رباتِ واحد — انگلیسی (خواسته‌ی مالک). فقط برای پروسه‌ی چندزبانه نصب
 * می‌شود؛ ربات‌های تک‌زبانه (فارسی، پرتغالی) هرگز این را لمس نمی‌کنند. سقف‌های Bot API:
 * نام ≤۶۴، توضیحِ کوتاه (بیو) ≤۱۲۰، توضیح ≤۵۱۲ نویسه. چکِ CI هر سه را می‌سنجد. */
export const UNIFIED_PROFILE = Object.freeze({
  name: 'Tarot Reading 🔮 Card of the Day',
  short: 'Ask any question and get a real tarot reading. Free card of the day, every day. 🔮',
  description:
    '🔮 A real tarot reading, right here in Telegram.\n\n'
    + 'Ask anything: love, work, a big decision. Shuffle the deck, pick your cards with your heart, '
    + 'and get a clear answer with the signs behind it.\n\n'
    + '🎴 Free card of the day, every day\n'
    + '🎲 A daily lucky card to win diamonds\n'
    + '🌍 English · Español · Русский · Português\n\n'
    + 'Tap Start to begin.',
});
