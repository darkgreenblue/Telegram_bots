#!/usr/bin/env node
// چکِ «متنِ فال درباره‌ی همین کارت‌های کشیده‌شده است» (bots/tarot/card-integrity.js).
//
// چرا: متنِ یک فال از ۸٬۷۶۱ فالِ اخیر (#27576) کلاً درباره‌ی کارت‌هایی بود که کشیده نشده
// بودند. کاربر عکسِ سه کارت را دید و تفسیرِ سه کارتِ دیگر را خواند. گارد عمداً تنگ است:
// فقط «≥۲ کارتِ بیگانه و صفر کارتِ خودی» رد می‌شود، چون ۸۰ فالِ سالم کارتِ فالِ قبلی را
// کنارِ کارت‌های خودشان نام برده بودند. این چک هر دو جهت را قفل می‌کند (گرفتنِ خطا، و
// رد نکردنِ فالِ سالم) به‌علاوه‌ی سیم‌کشی در index.js.

import { readFileSync } from 'node:fs';
import CARDS, { CARD_BY_KEY } from '../bots/tarot/cards.js';
import { cardMismatch, cardMentions, readingText, normCardText } from '../bots/tarot/card-integrity.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`❌ ${name}`); } };

const KEYS = CARDS.map((c) => c.key);
const nameOf = (k) => CARD_BY_KEY[k]?.fa || '';
const v4 = (texts) => ({
  headline: texts[0] || '', pattern: texts[1] || '',
  reads: (texts[2] || []).map((t) => ({ text: t })),
  cards: (texts[3] || []).map((t) => ({ teaser: t })), closing: texts[4] || '',
});
const mm = (obj, drawn) => cardMismatch(obj, drawn, KEYS, nameOf, 'fa');

// ---------- ۱) خطای واقعی: متن درباره‌ی کارت‌های دیگر ----------
const foreignOnly = v4([
  'آره محتمله، ولی باید صبور باشی.',
  'شاهِ جام و ملکه شمشیر کنارِ هم یعنی احساس و منطق.',
  ['شاه جام می‌گه آروم باش.', 'ملکه شمشیر می‌گه رک باش.', 'ده سکه یعنی ثبات.'],
]);
ok('متنِ کاملاً بیگانه رد می‌شود', mm(foreignOnly, ['m00', 'm07', 'w03']).bad === true);
ok('کارت‌های بیگانه گزارش می‌شوند', mm(foreignOnly, ['m00', 'm07', 'w03']).foreign.length >= 2);

// ---------- ۲) فالِ سالم با ارجاع به فالِ قبلی هرگز رد نمی‌شود ----------
const withPrev = v4([
  'آره، ولی با صبر.',
  'ارابه و سه چوبدست با هم حرکت رو نشون می‌دن؛ برجِ فالِ قبلیت هم یادت هست.',
  ['دیوانه شروعِ تازه‌ست.', 'ارابه یعنی کنترل.', 'سه چوبدست یعنی انتظار.'],
  [], 'شاه جام و ملکه شمشیرِ دفعه‌ی پیش هم همین رو گفته بودن.',
]);
const r2 = mm(withPrev, ['m00', 'm07', 'w03']);
ok('ارجاع به کارتِ قبلی کنارِ کارت‌های خودی رد نمی‌شود', r2.bad === false);
ok('کنترلِ مثبت: کارت‌های بیگانه دیده شدند (ادعای بالا پوچ نیست)', r2.foreign.length >= 2);
ok('کارتِ خودی دیده شد', r2.hits.length >= 1);

// ---------- ۳) یک کارتِ بیگانه به‌تنهایی کافی نیست ----------
ok('فقط یک کارتِ بیگانه رد نمی‌شود', mm(v4(['آره ولی.', 'شاه جام آرومت می‌کنه.']), ['m00', 'm07', 'w03']).bad === false);

// ---------- ۴) واژه‌های روزمره کارت شمرده نمی‌شوند ----------
const everyday = v4(['تا چند ماه دیگه، ولی با قدرت و عدالت.', 'خورشید درمیاد و ستاره‌ها پیدا می‌شن؛ جهان منتظره.']);
ok('«ماه/قدرت/عدالت/خورشید/ستاره/جهان» در متنِ عادی کارت نیستند',
  cardMentions(readingText(everyday), KEYS, nameOf, 'fa').size === 0);
ok('کنترلِ مثبت: نامِ چندکلمه‌ای واقعاً گرفته می‌شود',
  cardMentions('مرد آویخته اینجاست', KEYS, nameOf, 'fa').has('m12'));

// ---------- ۵) پسوند و نیم‌فاصله ----------
const suffixed = cardMentions('شاه‌جامِ بالا و ملکه شمشیری که آمد و چهار سکه‌اش', KEYS, nameOf, 'fa');
ok('پسوندِ ملکی/اضافه هم همان کارت است', suffixed.has(KEYS.find((k) => nameOf(k) === 'ملکه شمشیر')));
ok('نامِ داخلِ نامِ بلندتر دوباره شمرده نمی‌شود («کاهن اعظم» داخلِ «کاهنهٔ اعظم»)',
  !cardMentions('کاهنهٔ اعظم ساکته', KEYS, nameOf, 'fa').has('m05')
  && cardMentions('کاهنهٔ اعظم ساکته', KEYS, nameOf, 'fa').has('m02'));
// مصرفِ نامِ پیداشده: در جدولِ فارسیِ امروز هیچ نامی کاملاً داخلِ نامِ دیگر نیست، پس با
// جدولِ ساختگی سنجیده می‌شود (زبانِ دیگری ممکن است داشته باشد).
const FAKE = { a: 'ملکه جام بزرگ', b: 'ملکه جام' };
const fk = cardMentions('ملکه جام بزرگ آمد', ['a', 'b'], (k) => FAKE[k], 'xx');
ok('نامِ کوتاه‌تر داخلِ نامِ بلندتر دوباره شمرده نمی‌شود', fk.has('a') && !fk.has('b'));
ok('نرمال‌سازی ی/ک عربی', normCardText('ملكه شمشير') === 'ملکه شمشیر');

// ---------- ۶) ورودیِ بد خطا نمی‌دهد ----------
ok('آبجکتِ خالی امن است', mm({}, ['m00']).bad === false);
ok('null امن است', mm(null, ['m00']).bad === false);

// ---------- ۷) سیم‌کشی در index.js ----------
const src = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('import از card-integrity.js', /import\s*\{\s*cardMismatch\s*\}\s*from\s*'\.\/card-integrity\.js'/.test(src));
ok('پرچمِ رول‌بک روشن است', /const CARD_INTEGRITY = true;/.test(src));
const tries = Number((src.match(/const CARD_MISMATCH_EXTRA_TRIES = (\d+);/) || [])[1]);
ok('سقفِ تلاشِ اضافه کوچک است (۱ تا ۳) تا هرگز به ریفاند نرسد', tries >= 1 && tries <= 3);
const v = src.indexOf('validate: (out) =>');
const iShape = src.indexOf('checkV4Shape(obj, cards.length)', v);
const iCard = src.indexOf('cardMismatch(obj,', v);
const iHead = src.indexOf('headlineOk(obj.headline)', v);
ok('چکِ کارت داخلِ validate است', v > 0 && iCard > v);
ok('بعد از چکِ شکل', iShape > 0 && iCard > iShape);
ok('قبل از چکِ سرخط', iHead > 0 && iCard < iHead);
const block = src.slice(iCard, iHead);
ok('پشتِ پرچم است', /if \(CARD_INTEGRITY\)/.test(src.slice(iShape, iHead)));
ok('شمارنده سقف دارد (رد فقط زیرِ سقف)', /cardMismatchTries\+\+ < CARD_MISMATCH_EXTRA_TRIES\) return false/.test(block));
ok('خروجیِ بیگانه fallback نمی‌شود', !/fallback\s*=/.test(block));
ok('مارکرِ greppable در لاگ', /CARD_MISMATCH/.test(block));

console.log(`check-card-integrity: ${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
