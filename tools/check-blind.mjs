#!/usr/bin/env node
/* گاردِ ابزارِ نمره‌دهیِ کور (`tools/reading-lab/blind.mjs`).
 *
 * چرا این گارد **رفتاری** است و نه رجکسی: کلِ ارزشِ آن ابزار یک ادعای منفی است
 * («هیچ ردی از بازو در متنِ کور نیست»). و طبقِ بند ۶ب-۲ ریشه، یک ادعای منفیِ سبز دو
 * معنیِ کاملاً متفاوت دارد: «چیزی نیست» یا «چیزی را که هست نمی‌بینم». پس هر ادعای
 * منفی این‌جا یک **کنترلِ مثبت** کنارش دارد که ثابت می‌کند همان ادعا روی یک ورودیِ
 * عمداً آلوده **قرمز** می‌شود. بدونِ آن، یک پارسرِ همیشه-خالی همه‌ی ادعاهای منفی را
 * پاس می‌کرد.
 */
import { parseTranscripts, splitBlind } from './reading-lab/blind.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`✅ ${m}`); } else { fail++; console.log(`❌ ${m}`); } };

const ARM_A = 'openai/gpt-5.6-luna';
const ARM_B = 'deepseek/deepseek-v4-flash-0731:free';

const block = (arm, persona, step, spread, q, cards, body) =>
  [`▓ ${arm} | ${persona}.${step} | ${spread}`, `؟ ${q}`, `🃏 ${cards}`, body].join('\n');

const LOG = [
  '═'.repeat(72),
  '📄 رونوشتِ کاملِ فال‌ها (برای ارزیابیِ دستیِ کیفیت)',
  '═'.repeat(72),
  '',
  block(ARM_A, 'P1', 1, 'سه کارتِ شغلی', 'کارم رو عوض کنم؟', 'برجِ آسمان، سه شمشیر', 'سرخطِ الف\nمتنِ بدنه‌ی الف\nجمع‌بندیِ الف'),
  '',
  block(ARM_B, 'P1', 1, 'سه کارتِ شغلی', 'کارم رو عوض کنم؟', 'برجِ آسمان، سه شمشیر', 'سرخطِ ب\nمتنِ بدنه‌ی ب\nجمع‌بندیِ ب'),
  '',
  block(ARM_A, 'P2', 3, 'پنج کارتِ پول', 'وام بگیرم؟', 'شاهِ سکه، دو سکه', 'سرخطِ پ\nمتنِ بدنه‌ی پ\nجمع‌بندیِ پ'),
  '',
  block(ARM_B, 'P2', 3, 'پنج کارتِ پول', 'وام بگیرم؟', 'شاهِ سکه، دو سکه', 'سرخطِ ت\nمتنِ بدنه‌ی ت\nجمع‌بندیِ ت'),
].join('\n');

/* ═══ ۱) پارس روی هر دو شکلِ واقعیِ منبع ═══ */
const rows = parseTranscripts(LOG);
ok(rows.length === 4, `چهار فال از لاگِ محلی پارس شد (${rows.length})`);
ok(rows.filter(r => r.arm === ARM_A).length === 2 && rows.filter(r => r.arm === ARM_B).length === 2,
  'بازوی هر فال درست خوانده شد');
ok(rows[0].question === 'کارم رو عوض کنم؟' && rows[0].cards.includes('برجِ آسمان'),
  'سؤال و کارت‌ها به فالِ خودشان چسبیده‌اند');

// لاگِ گیت‌هاب مهرِ زمانِ ISO دارد؛ هر دو منبع باید کار کنند
const STAMPED = LOG.split('\n').map((l, i) =>
  `2026-09-19T09:3${i % 10}:0${i % 10}.1234567Z ${l}`).join('\n');
const rowsTs = parseTranscripts(STAMPED);
ok(rowsTs.length === 4, `همان لاگ با مهرِ زمانِ گیت‌هاب هم ۴ فال داد (${rowsTs.length})`);
ok(rowsTs[0]?.arm === ARM_A && rowsTs[0]?.question === rows[0].question,
  'مهرِ زمان به بازو و سؤال نچسبیده');

/* کنترلِ مثبت: هدرِ عوض‌شده باید **صفر** بدهد، نه اینکه بی‌صدا چیزِ اشتباه بسازد.
 * بدونِ این، تغییرِ فردایِ فرمتِ رونوشت یک نمره‌دهیِ روی هیچ می‌ساخت. */
ok(parseTranscripts(LOG.replace(/^▓ /gm, '# ')).length === 0,
  'کنترلِ مثبت: هدرِ ناشناخته ⟵ صفر فال (نه پارسِ خاموش)');

/* ═══ ۲) ادعای مرکزی: خروجیِ کور هیچ ردی از بازو ندارد ═══ */
const { blind, key } = splitBlind(rows, 'seed-1');
const leaks = [ARM_A, ARM_B, 'openai', 'deepseek', 'luna', 'flash', ':free']
  .filter(s => blind.toLowerCase().includes(s.toLowerCase()));
ok(leaks.length === 0, `متنِ کور هیچ نامِ بازو ندارد${leaks.length ? ` (نشت: ${leaks.join(', ')})` : ''}`);

/* کنترلِ مثبت برای همان ادعا: عینِ همان بررسی روی یک رندرِ **عمداً برچسب‌دار** باید
 * قرمز شود. اگر نشود، یعنی فهرستِ نشت اشتباه است و ادعای بالا بی‌معنا. */
{
  const dirty = rows.map(r => `## X\n- بازو: ${r.arm}\n${r.body.join('\n')}`).join('\n');
  const found = ['openai', 'deepseek'].filter(s => dirty.toLowerCase().includes(s));
  ok(found.length === 2, 'کنترلِ مثبت: همان بررسی روی متنِ برچسب‌دار نشت را می‌گیرد');
}

/* شناسه‌ی سناریو هم عمداً بیرون است (وگرنه «سه بارِ P1.1» به حدسِ ترتیبِ بازوها
 * وسوسه می‌کند)، با کنترلِ مثبتِ خودش. */
ok(!/\bP1\.1\b/.test(blind) && !/\bP2\.3\b/.test(blind),
  'شناسه‌ی سناریو در متنِ کور نیست');
ok(/\bP1\.1\b/.test('پیش‌نویسِ آلوده: P1.1'),
  'کنترلِ مثبت: همان الگو شناسه‌ی سناریو را می‌گیرد');

/* ═══ ۳) چیزهایی که باید **بمانند** ═══ */
// بدونِ کارت‌ها معیارِ `card_anchor` و بدونِ سؤال معیارِ `direct` قابلِ داوری نیستند.
ok(blind.includes('برجِ آسمان، سه شمشیر') && blind.includes('شاهِ سکه، دو سکه'),
  'فهرستِ کارت‌ها در متنِ کور مانده (لازمِ معیارِ لنگرِ کارت)');
ok(blind.includes('کارم رو عوض کنم؟') && blind.includes('وام بگیرم؟'),
  'سؤالِ کاربر در متنِ کور مانده (لازمِ معیارِ جوابِ صریح)');
ok(rows.every(r => blind.includes(r.body[0])), 'متنِ هر چهار فال کامل منتقل شد');

/* ═══ ۴) کلید: round-trip و یکتایی ═══ */
const ids = Object.keys(key);
ok(ids.length === 4, `کلید برای هر چهار فال ردیف دارد (${ids.length})`);
ok(new Set(ids).size === ids.length, 'شناسه‌ها یکتا هستند');
ok(ids.every(id => new RegExp(`^## ${id}$`, 'm').test(blind)),
  'هر شناسه‌ی کلید در متنِ کور بخشِ خودش را دارد');
{
  const back = ids.map(id => key[id].arm).sort();
  ok(JSON.stringify(back) === JSON.stringify(rows.map(r => r.arm).sort()),
    'کلید همان توزیعِ بازوها را برمی‌گرداند (round-trip)');
  ok(ids.every(id => key[id].persona && key[id].step && key[id].spread),
    'کلید سناریوی هر شناسه را هم نگه داشته (لازمِ تفاضلِ جفت‌شده)');
}

/* ═══ ۵) شافل: هم واقعاً بُر می‌زند، هم قطعی است ═══ */
{
  const many = Array.from({ length: 12 }, (_, i) =>
    ({ arm: i % 2 ? ARM_A : ARM_B, persona: `P${i}`, step: 1, rep: 1, spread: 'س',
       question: `سؤالِ ${i}`, cards: 'کارت', body: [`متنِ ${i}`] }));
  const order = (o) => Object.values(o.key).map(k => k.persona).join(',');
  const a = splitBlind(many, 'x'), b = splitBlind(many, 'x'), c = splitBlind(many, 'y');
  ok(order(a) === order(b), 'با seedِ یکسان ترتیب عیناً بازتولید می‌شود');
  ok(order(a) !== order(c), 'با seedِ متفاوت ترتیب عوض می‌شود');
  ok(order(a) !== many.map(r => r.persona).join(','), 'ترتیبِ خروجی با ترتیبِ ورودی یکی نیست');
  /* و مهم‌تر: بازوها نباید **متناوب** بمانند، وگرنه داور از الگوی یک‌درمیانِ ورودی
   * می‌تواند بازو را حدس بزند و کوری فقط اسمی است. */
  const armSeq = Object.values(a.key).map(k => k.arm === ARM_A ? 'A' : 'B').join('');
  ok(!/^(AB)+$|^(BA)+$/.test(armSeq), `الگوی متناوبِ بازوها شکسته شد (${armSeq})`);
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
