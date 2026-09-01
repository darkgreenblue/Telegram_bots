#!/usr/bin/env node
/**
 * چکِ فهرستِ معیارهای کیفیت (`tools/reading-lab/rubric.mjs`).
 *
 * ⚠️ **داور سشن است، نه یک مدلِ دیگر.** نسخه‌ی اولِ این ماژول یک پرامپتِ داوری داشت
 * که یک مدلِ سومِ OpenRouter را روی کلیدِ محصول صدا می‌زد. تصمیمِ صریحِ مالک
 * (۱۴۰۵/۰۶/۱۰) آن را رد کرد و مسیر کاملاً حذف شد. بخشِ ۴ همین چک جلوی برگشتنش را
 * می‌گیرد.
 *
 * پس کارِ این فایل دو چیز است: فهرستِ معیارها **نوشته و ثابت** بماند (تا ارزیابی روی
 * حافظه‌ی لحظه‌ای ننشیند)، و راستی‌آزماییِ شاهد سالم بماند (تا نقلِ قولی که در متن
 * نیست نتواند نمره بسازد — چه نقلِ قولِ من، چه هر کسِ دیگر).
 */
import { readFileSync } from 'fs';
import { RUBRIC, MAX, scoreOf } from './reading-lab/rubric.mjs';

let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) pass++; else errs.push(msg); };

/* ═══ ۱) شکلِ معیارها ═══ */
ok(RUBRIC.length >= 8, `دستِ‌کم ۸ معیار تعریف شده (${RUBRIC.length})`);
ok(RUBRIC.every(r => r.id && r.title && r.ask && r.good && r.bad && r.w && r.src),
   'هر معیار id/title/ask/good/bad/w/src دارد');
ok(new Set(RUBRIC.map(r => r.id)).size === RUBRIC.length, 'شناسه‌ها یکتا هستند');
ok(RUBRIC.every(r => r.w === 1 || r.w === 2), 'وزن‌ها فقط ۱ یا ۲ اند');
ok(MAX === RUBRIC.reduce((s, r) => s + r.w * 2, 0), 'نمره‌ی کامل با وزن‌ها می‌خواند');

/* ۲) دو معیاری که کلِ این کار برایشان ساخته شد. `unspoken` را STYLE.md «مهم‌ترین
 * جمله‌ی کلِ خوانش» می‌نامد و `coherence` همان «سر و ته داشتن» است که هیچ سنجه‌ی
 * مکانیکی‌ای نمی‌بیندش. */
for (const id of ['unspoken', 'coherence', 'synthesis', 'reframe']) {
  const it = RUBRIC.find(r => r.id === id);
  ok(!!it, `معیارِ «${id}» تعریف شده`);
  ok(it?.w === 2, `«${id}» قاعده‌ی سخت است و باید وزنِ ۲ داشته باشد`);
}

/* ═══ ۳) هیچ معیاری اختراعی نیست ═══ */
const STYLE = readFileSync(new URL('../bots/tarot/STYLE.md', import.meta.url), 'utf8');
ok(/قاعده‌ی سخت/.test(STYLE) && /Shotgunning/.test(STYLE),
   'STYLE.md همان سندی است که معیارها از آن آمده‌اند');
ok(RUBRIC.filter(r => /قاعده‌ی سخت/.test(r.src)).length === 6,
   'هر شش قاعده‌ی سختِ STYLE.md یک معیار دارند');

/* ═══ ۴) هیچ مسیرِ داوریِ خودکاری نباید برگردد ═══ */
const RUB = readFileSync(new URL('./reading-lab/rubric.mjs', import.meta.url), 'utf8');
const LAB = readFileSync(new URL('./reading-lab.mjs', import.meta.url), 'utf8');
ok(!/judgePrompt|judgeUser/.test(RUB), 'پرامپتِ داوریِ خودکار در rubric.mjs نیست');
ok(!/--judge|const JUDGE/.test(LAB), 'پرچمِ --judge در آزمایشگاه نیست');
ok(!/model: JUDGE/.test(LAB), 'هیچ فراخوانیِ مدلی برای داوری در آزمایشگاه نیست');
ok(/داور انسان/.test(RUB), 'خودِ ماژول صریح می‌گوید داور سشن است نه مدل');

/* ═══ ۵) راستی‌آزماییِ شاهد — مهم‌ترین ادعا، رفتاری ═══ */
const TEXT = 'بله با احتمال نسبتا بالا، اما با تاخیر.\nکارت اولت ابهام و دودلی رو نشون میده.\nدر کل اگه صبر کنی، جواب می‌گیری.';
{
  const s = scoreOf({ items: { direct: { score: 2, quote: 'بله با احتمال نسبتا بالا، اما با تاخیر' } } }, TEXT);
  ok(s.items.direct.score === 2 && s.items.direct.proven, 'نقلِ قولِ واقعی پذیرفته می‌شود');
}
{
  const s = scoreOf({ items: { direct: { score: 2, quote: 'این جمله اصلاً در متن نیست و ساختگی است' } } }, TEXT);
  ok(s.items.direct.score === 0 && s.faked.includes('direct'),
     'نقلِ قولی که در متن نیست رد می‌شود و معیار صفر می‌گیرد');
}
{
  const s = scoreOf({ items: { direct: { score: 2, quote: 'بله' } } }, TEXT);
  ok(s.items.direct.score === 0, 'نقلِ قولِ خیلی کوتاه ثابت‌کننده نیست و رد می‌شود');
}
{
  const s = scoreOf({ items: { coherence: { score: 2 } } }, TEXT);
  ok(s.items.coherence.score === 0, 'نمره‌ی بدونِ شاهد صفر می‌شود');
}
{
  const s = scoreOf({ items: { imagery: { score: 2, quote: 'كارت اولت ابهام و دودلي رو نشون ميده' } } }, TEXT);
  ok(s.items.imagery.score === 2, 'نویسه‌ی عربیِ ي/ك شاهدِ درست را رد نمی‌کند');
}
{
  const s = scoreOf({ items: { direct: { score: 99, quote: 'بله با احتمال نسبتا بالا' } } }, TEXT);
  ok(s.items.direct.score === 2, 'نمره‌ی بزرگ‌تر از ۲ به سقف می‌خورد');
  ok(scoreOf(null, TEXT).got === 0, 'ورودیِ خراب کلِ چک را نمی‌شکند');
  ok(scoreOf({}, '').pct === 0, 'متنِ خالی صفر می‌گیرد، نه NaN');
}

/* ═══ ۶) وزن واقعاً روی نمره اثر دارد ═══ */
{
  const q = 'کارت اولت ابهام و دودلی رو نشون میده';
  ok(scoreOf({ items: { unspoken: { score: 2, quote: q } } }, TEXT).got
     > scoreOf({ items: { no_shotgun: { score: 2, quote: q } } }, TEXT).got,
     'قاعده‌ی سخت بیشتر از ضدالگو وزن دارد');
}

/* ═══ ۷) بدونِ دیدنِ متن ارزیابی ممکن نیست ═══
 * لاگِ Actions فقط از **انتها** برداشت می‌شود، پس رونوشت باید آخرین چیزِ لاگ باشد. */
ok(/reading-lab\/rubric\.mjs/.test(LAB), 'آزمایشگاه معیارها را از همین ماژول import می‌کند');
ok(/function dumpTranscripts/.test(LAB), 'آزمایشگاه رونوشتِ کاملِ فال‌ها را چاپ می‌کند');
ok(LAB.indexOf('dumpTranscripts(all)') > LAB.indexOf('function dumpTranscripts'),
   'رونوشت در انتهای اجرا چاپ می‌شود تا با یک tail خوانده شود');

if (errs.length) {
  console.error(`\n❌ check-rubric: ${errs.length} خطا از ${pass + errs.length} ادعا`);
  for (const e of errs) console.error('   •', e);
  process.exit(1);
}
console.log(`✅ check-rubric: ${pass} ادعا سبز`);
