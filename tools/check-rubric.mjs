#!/usr/bin/env node
/**
 * چکِ داورِ کیفیت (`tools/reading-lab/rubric.mjs`).
 *
 * ⚠️ چرا این چک لازم است: داور خودش یک **ابزار** است، و درسِ ثبت‌شده‌ی این پروژه این
 * است که ۱۱ باگ از ۱۳ در ابزارها بود نه در مدل. یک داورِ خراب بدتر از نداشتنِ داور
 * است، چون عددِ بی‌معنی را با اعتبارِ ظاهری وارد تصمیمِ انتخابِ مدل می‌کند.
 *
 * مهم‌ترین ادعا: **گاردِ نقلِ قول**. اگر داور بتواند بدونِ شاهد نمره بدهد، هر متنی
 * می‌تواند نمره‌ی بالا بگیرد و ما دوباره روی توهم تصمیم می‌گیریم.
 */
import { readFileSync } from 'fs';
import { RUBRIC, MAX, judgePrompt, judgeUser, scoreOf } from './reading-lab/rubric.mjs';

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) pass++; else errs.push(msg); };

/* ═══ ۱) شکلِ معیارها ═══ */
ok(RUBRIC.length >= 8, `دستِ‌کم ۸ معیار تعریف شده (${RUBRIC.length})`);
ok(RUBRIC.every(r => r.id && r.title && r.ask && r.good && r.bad && r.w && r.src),
   'هر معیار id/title/ask/good/bad/w/src دارد');
ok(new Set(RUBRIC.map(r => r.id)).size === RUBRIC.length, 'شناسه‌ها یکتا هستند');
ok(RUBRIC.every(r => r.w === 1 || r.w === 2), 'وزن‌ها فقط ۱ یا ۲ اند');
ok(MAX === RUBRIC.reduce((s, r) => s + r.w * 2, 0), 'نمره‌ی کامل با وزن‌ها می‌خواند');

/* ۲) دو معیاری که کلِ این کار برایشان ساخته شد باید وجود داشته باشند و وزنِ سخت بگیرند.
 * `unspoken` را STYLE.md «مهم‌ترین جمله‌ی کلِ خوانش» می‌نامد و `coherence` همان
 * «سر و ته داشتن» است که هیچ سنجه‌ی مکانیکی‌ای نمی‌بیندش. */
for (const id of ['unspoken', 'coherence', 'synthesis', 'reframe']) {
  const it = RUBRIC.find(r => r.id === id);
  ok(!!it, `معیارِ «${id}» تعریف شده`);
  ok(it?.w === 2, `«${id}» قاعده‌ی سخت است و باید وزنِ ۲ داشته باشد`);
}

/* ۳) هر معیار باید به بندِ منبعش در STYLE.md اشاره کند — نه یک معیارِ اختراعی */
const STYLE = readFileSync(new URL('../bots/tarot/STYLE.md', import.meta.url), 'utf8');
ok(/قاعده‌ی سخت/.test(STYLE) && /Shotgunning/.test(STYLE),
   'STYLE.md همان سندی است که معیارها از آن آمده‌اند');
ok(RUBRIC.filter(r => /قاعده‌ی سخت/.test(r.src)).length === 6,
   'هر شش قاعده‌ی سختِ STYLE.md یک معیار دارند');

/* ═══ ۴) داوری باید **کور** باشد ═══
 * اگر نامِ مدل به داور برسد، سوگیریِ خودپسندی کلِ مقایسه را بی‌اعتبار می‌کند. */
const P = judgePrompt();
const U = judgeUser({ question: 'س', cardNames: ['دیوانه'], text: 'م' });
for (const leak of ['gemini', 'luna', 'gpt', 'deepseek', 'model', 'مدلِ']) {
  ok(!P.toLowerCase().includes(leak.toLowerCase()) && !U.toLowerCase().includes(leak.toLowerCase()),
     `پرامپتِ داور نامِ مدل («${leak}») را لو نمی‌دهد`);
}
ok(/نقلِ قول/.test(P) && /۰|0/.test(P), 'پرامپت صریحاً نقلِ قولِ اجباری و مقیاس را می‌گوید');

/* ═══ ۵) گاردِ نقلِ قول — مهم‌ترین ادعا، رفتاری ═══ */
const TEXT = 'بله با احتمال نسبتا بالا، اما با تاخیر.\nکارت اولت ابهام و دودلی رو نشون میده.\nدر کل اگه صبر کنی، جواب می‌گیری.';
{
  const s = scoreOf({ items: { direct: { score: 2, quote: 'بله با احتمال نسبتا بالا، اما با تاخیر' } } }, TEXT);
  ok(s.items.direct.score === 2 && s.items.direct.proven, 'نقلِ قولِ واقعی پذیرفته می‌شود');
}
{
  const s = scoreOf({ items: { direct: { score: 2, quote: 'این جمله اصلاً در متن نیست و ساختگی است' } } }, TEXT);
  ok(s.items.direct.score === 0 && s.faked.includes('direct'),
     'نقلِ قولِ ساختگی رد می‌شود و معیار صفر می‌گیرد');
}
{
  const s = scoreOf({ items: { direct: { score: 2, quote: 'بله' } } }, TEXT);
  ok(s.items.direct.score === 0, 'نقلِ قولِ خیلی کوتاه ثابت‌کننده نیست و رد می‌شود');
}
{ // نمره بدونِ هیچ نقلِ قولی
  const s = scoreOf({ items: { coherence: { score: 2 } } }, TEXT);
  ok(s.items.coherence.score === 0, 'نمره‌ی بدونِ شاهد صفر می‌شود');
}
{ // نرمال‌سازی: نیم‌فاصله و «ي/ك» عربی نباید شاهدِ درست را رد کند
  const s = scoreOf({ items: { imagery: { score: 2, quote: 'كارت اولت ابهام و دودلي رو نشون ميده' } } }, TEXT);
  ok(s.items.imagery.score === 2, 'نویسه‌ی عربیِ ي/ك شاهدِ درست را رد نمی‌کند');
}
{ // نمره‌ی خارج از بازه و ورودیِ خصمانه
  const s = scoreOf({ items: { direct: { score: 99, quote: 'بله با احتمال نسبتا بالا' } } }, TEXT);
  ok(s.items.direct.score === 2, 'نمره‌ی بزرگ‌تر از ۲ به سقف می‌خورد');
  ok(scoreOf(null, TEXT).got === 0, 'خروجیِ خرابِ داور کلِ چک را نمی‌شکند');
  ok(scoreOf({}, '').pct === 0, 'متنِ خالی صفر می‌گیرد، نه NaN');
}

/* ═══ ۶) وزن واقعاً روی نمره اثر دارد ═══ */
{
  const hard = scoreOf({ items: { unspoken: { score: 2, quote: 'کارت اولت ابهام و دودلی رو نشون میده' } } }, TEXT);
  const soft = scoreOf({ items: { no_shotgun: { score: 2, quote: 'کارت اولت ابهام و دودلی رو نشون میده' } } }, TEXT);
  ok(hard.got > soft.got, 'قاعده‌ی سخت بیشتر از ضدالگو وزن دارد');
}

/* ═══ ۷) آزمایشگاه واقعاً از همین ماژول می‌خواند ═══ */
const LAB = readFileSync(new URL('./reading-lab.mjs', import.meta.url), 'utf8');
ok(/reading-lab\/rubric\.mjs/.test(LAB), 'آزمایشگاه داور را از همین ماژول import می‌کند');
ok(/const JUDGE = val\('judge', ''\)/.test(LAB), 'داور خاموش است مگر --judge داده شود');
ok(/model: JUDGE/.test(LAB), 'داور با مدلِ خودش صدا زده می‌شود، نه با مدلِ تحتِ آزمایش');

if (errs.length) {
  console.error(`\n❌ check-rubric: ${errs.length} خطا از ${pass + errs.length} ادعا`);
  for (const e of errs) console.error('   •', e);
  process.exit(1);
}
console.log(`✅ check-rubric: ${pass} ادعا سبز`);
