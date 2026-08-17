#!/usr/bin/env node
// تستِ واحدِ **سنجه‌های آزمایشگاه** (`tools/reading-lab/checks.mjs`).
//
// چرا وجود دارد: لایه‌ی سنجش تا امروز هیچ تستی نداشت. تنها راهِ اجرا شدنش یک دورِ کاملِ
// پولیِ آزمایشگاه بود، و حالتِ `--dry` که در CI می‌چرخد اصلاً صدایش نمی‌زند. نتیجه‌اش یک
// کرشِ واقعی شد (۱۴۰۵/۰۵/۲۶): سنجه فرض می‌کرد هر کارت دقیقاً یک خط است، متنِ مدل خطِ
// جدید داشت، `labels[i]` تعریف‌نشده شد و **کلِ اجرای ۹ فالی روی همان فالِ اول مرد**.
//
// روشِ این تست: برای هر سنجه دو حالت — یکی که **باید** قرمز کند و یکی که **نباید**.
// سنجه‌ای که فقط حالتِ سالم را ببیند هیچ‌چیز را تضمین نمی‌کند؛ همان درسی که در این ریپو
// با «صحتش با برگرداندنِ عمدیِ باگ تأیید شد» تکرار شده.
import { renderV4 } from '../bots/tarot/reading-core.js';
import { checkReading } from './reading-lab/checks.mjs';

const L = (await import('../bots/tarot/locales/fa.js')).default;

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

// دو کارتِ واقعی از دک تا نامشان با CARD_BY_KEY بخواند
const CARDS = [{ key: 'm16', reversed: false }, { key: 'c10', reversed: false }]; // برج، ده جام
const SPREAD = { fa: 'آری یا نه', size: 2, positions: [{ fa: 'قلب ماجرا' }, { fa: 'جهت انرژی' }] };

// خوانشِ پایه‌ی **سالم**: هیچ سنجه‌ای نباید رویش قرمز کند.
const base = () => ({
  headline: 'بله، به احتمالِ زیاد پیش می‌ره، ولی باید یه دوره‌ی صبر رو تحمل کنی.',
  pattern: 'حضورِ برج کنارِ ده جام می‌گه یه چیزی فرو می‌ریزه تا جای بهتری باز شه.',
  cards: [{ teaser: 'کارتِ برج، کارتِ فروریختنِ ناگهانیه.' }, { teaser: 'کارتِ ده جام، کارتِ آرامشِ خانوادگیه.' }],
  reads: [{ text: 'برج می‌گه یه ساختارِ سست داره می‌ریزه و این رهاییه.' },
    { text: 'ده جام نشون می‌ده اون آرامشی که می‌خوای دست‌یافتنیه.' }],
  callback: '', closing: 'در کل، مسیر باز می‌شه ولی تو این چند هفته صبر لازم داری.',
  summary: 'خلاصه', memory: 'حافظه',
});

const run = (llm, { ctx = { previous: [] }, cards = CARDS, spread = SPREAD } = {}) => {
  const labels = L.prompts.cardLabels(cards.length);
  return checkReading({ llm, rendered: renderV4(llm, cards, labels), spread, cards, ctx, L });
};
const has = (r, frag) => r.issues.some(i => i.includes(frag));
const hasNote = (r, frag) => r.notes.some(i => i.includes(frag));

console.log('▶ خوانشِ سالم هیچ ایرادی نمی‌گیرد (ضدِ false positive)');
{
  const r = run(base());
  ok(r.issues.length === 0, `خوانشِ سالم صفر ایراد دارد${r.issues.length ? ` — ولی گرفت: ${r.issues.join(' / ')}` : ''}`);
  ok(r.stats.named === 2, 'هر دو کارت با نامِ خودشان شناخته شدند');
}

console.log('\n▶ رگرسیونِ کرشِ ۱۴۰۵/۰۵/۲۶ — متنِ چندخطیِ کارت');
{
  // همان چیزی که کلِ اجرا را کشت: متنِ کارت خطِ جدید دارد، پس خطوط > کارت‌ها
  const llm = base();
  llm.reads[0] = { text: 'برج می‌گه یه ساختارِ سست داره می‌ریزه.\nو این خودش یه رهاییه.' };
  let r;
  ok((() => { try { r = run(llm); return true; } catch { return false; } })(), 'سنجه با متنِ چندخطی کرش نمی‌کند');
  ok(r && r.issues.length === 0, 'خطِ اضافه ایراد حساب نمی‌شود (ادامه‌ی همان کارت است)');
}

console.log('\n▶ سرخط');
{
  ok(has(run({ ...base(), headline: 'بستگی به خودت داره.' }), 'سرخط فرمول را ندارد'), 'سرخطِ بی‌جهت گرفته می‌شود');
  ok(!has(run(base()), 'سرخط فرمول را ندارد'), 'سرخطِ درست گرفته نمی‌شود');
}

console.log('\n▶ لحنِ رسمی');
{
  const llm = base();
  llm.closing = 'در کل، شما باید صبر کنید تا مسیر باز شود.';
  ok(has(run(llm), 'لحنِ رسمی'), '«شما» گرفته می‌شود');
  ok(!has(run(base()), 'لحنِ رسمی'), 'متنِ گفتاری گرفته نمی‌شود');
}

console.log('\n▶ بلوکِ کارت‌ها (باگِ اصلیِ اجرای اول)');
{
  const llm = base();
  llm.reads = [{ text: '' }, { text: '' }];
  ok(has(run(llm), 'بلوکِ کارت‌ها اصلاً نیامد'), 'غیبتِ کاملِ بلوکِ کارت‌ها گرفته می‌شود');

  const one = base();
  one.reads = [{ text: 'فقط یکی' }, { text: '' }];
  ok(has(run(one), 'پیدا نشد'), 'کارتِ جامانده گرفته می‌شود');

  // برچسبِ تکراری: مدل خودش «کارت دوم» گذاشته و کد هم اضافه کرده
  const dup = base();
  dup.reads[1] = { text: 'کارت دوم می‌گه آرامش میاد.' };
  const rd = run(dup);
  ok(!has(rd, 'برچسبِ تکراری'), 'برچسبِ خودِ مدل توسط stripCardLabel برداشته می‌شود، پس تکرار نیست');
}

console.log('\n▶ اشاره‌ی زمانی به گذشته');
{
  for (const t of ['پارسال', 'هفته‌های قبل', 'چند وقت پیش', 'ماه گذشته']) {
    const llm = base();
    llm.callback = `${t} هم سرِ همین موضوع بودی.`;
    ok(has(run(llm, { ctx: { previous: [{}] } }), 'اشاره‌ی زمانی به گذشته'), `«${t}» گرفته می‌شود`);
  }
  // بازه‌ی زمانیِ آینده عمداً مجاز است
  const fut = base();
  fut.closing = 'در کل تا آخر این فصل روشن می‌شه، و تو این چند هفته نشونه‌هاش رو می‌بینی.';
  ok(!has(run(fut), 'اشاره‌ی زمانی به گذشته'), 'بازه‌ی آینده ایراد حساب نمی‌شود');
}

console.log('\n▶ ارجاع به جلسه‌ی قبل');
{
  const llm = base();
  llm.callback = 'اون‌بار هم سرِ همین دودلی بودی.';
  ok(has(run(llm, { ctx: { previous: [] } }), 'اولین فال است ولی'), 'ارجاعِ توهمی در اولین فال گرفته می‌شود');
  ok(!has(run(llm, { ctx: { previous: [{}] } }), 'اولین فال است ولی'), 'با سابقه، ارجاع مجاز است');
  ok(hasNote(run(base(), { ctx: { previous: [{}] } }), 'هیچ ارجاعی'), 'نبودِ ارجاع با وجودِ سابقه یادداشت می‌شود');
}

console.log('\n▶ عبارتِ ممنوع و ایموجی و خط تیره');
{
  const b = base(); b.pattern = 'این کاملاً به کائنات بستگی داره.';
  ok(has(run(b), 'عبارتِ ممنوع'), 'عبارتِ ممنوع گرفته می‌شود');
  const e = base(); e.closing = 'در کل مسیر باز می‌شه 🌟 و تو این چند هفته می‌بینی.';
  ok(hasNote(run(e), 'ایموجی'), 'ایموجیِ مدل یادداشت می‌شود');
  const d = base(); d.pattern = 'برج و ده جام — دو روی یک سکه‌اند.';
  const rd = run(d);
  ok(hasNote(rd, 'خط تیره'), 'خط تیره‌ی مدل یادداشت می‌شود');
  ok(!has(rd, 'خط تیره در متنِ نهایی مانده'), 'ولی در متنِ نهایی نمانده (noDash پاکش کرد)');
}

console.log('\n▶ نامِ جایگاه و لنگرِ نامِ کارت');
{
  const p = base(); p.pattern = 'در جایگاهِ قلب ماجرا، برج نشسته.';
  ok(hasNote(run(p), 'نامِ جایگاه'), 'نشتِ نامِ جایگاه یادداشت می‌شود');
  const n = base();
  n.pattern = 'دو انرژی روبه‌روی هم‌اند.';
  n.reads = [{ text: 'یه ساختارِ سست داره می‌ریزه.' }, { text: 'آرامشی که می‌خوای دست‌یافتنیه.' }];
  n.cards = [{ teaser: 'کارتِ اول، کارتِ فروریختنه.' }, { teaser: 'کارتِ دوم، کارتِ آرامشه.' }];
  n.closing = 'در کل مسیر تو این چند هفته باز می‌شه.';
  ok(has(run(n), 'هیچ کارتی در متن با نامِ خودش'), 'نبودِ لنگر به نامِ کارت گرفته می‌شود');
}

console.log('\n▶ فشرده‌بودنِ چیدمانِ بزرگ');
{
  const big = { fa: 'صلیب سلتی', size: 10, positions: Array.from({ length: 10 }, (_, i) => ({ fa: `جایگاه ${i}` })) };
  const cards = Array.from({ length: 10 }, () => ({ key: 'm16', reversed: false }));
  const long = base();
  long.cards = cards.map(() => ({ teaser: 'کارتِ برج، کارتِ فروریختنه.' }));
  long.reads = cards.map(() => ({ text: `برج می‌گه ${'یه ساختارِ سست داره می‌ریزه و این خودش یه رهاییه. '.repeat(9)}` }));
  ok(has(run(long, { cards, spread: big }), 'چیدمانِ بزرگ باید یک جمله باشد'), 'دیوارِ متن در چیدمانِ ۱۰کارتی گرفته می‌شود');
  const short = base();
  short.cards = cards.map(() => ({ teaser: 'کارتِ برج، کارتِ فروریختنه.' }));
  short.reads = cards.map(() => ({ text: 'برج می‌گه یه ساختارِ سست داره می‌ریزه.' }));
  ok(!has(run(short, { cards, spread: big }), 'چیدمانِ بزرگ باید یک جمله باشد'), 'خوانشِ کوتاه در همان چیدمان ایراد ندارد');
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
