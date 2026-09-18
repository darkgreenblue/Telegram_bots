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
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
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

/* 🌍 دو سنجه‌ی کیفیت باید در **هر چهار زبان** الگو داشته باشند (بند ۲و/۱).
 *
 * ⚠️ چرا این بلوک لازم شد: تا ۱۴۰۵/۰۶/۱۰ «نشتِ برچسب» و «لحنِ کتابی» فقط الگوی
 * فارسی داشتند و هاردکد بودند. یعنی سه زبانِ دیگر روی این دو محور **همیشه صفر**
 * گزارش می‌شدند و حکمِ مدلشان روی نیمی از تعریفِ کیفیت گرفته شده بود — دقیقاً همان
 * شکافی که این دو سنجه برای بستنش ساخته شده بودند، یک لایه بالاتر.
 *
 * هر زبان **هم** نمونه‌ی مثبت دارد هم منفی. اگر فقط منفی داشت، یک الگوی خرابِ
 * `undefined` هم سبز رد می‌شد (همان درسِ `genderedPast` در check-langdata). */
console.log('\n▶ الگوهای کیفیت per زبان');
{
  const SAMPLES = {
    fa: {
      leakBad:  'حسِ ناگفته‌ات اینه که منتظری یکی جات تصمیم بگیره.',
      leakOk:   'انگار منتظری یکی جات تصمیم بگیره، و همین نگهت داشته.',
      bookBad:  'این کارت نشان می‌دهد که مسیر باز است و تلاشِ تو نتیجه می‌دهد.',
      bookOk:   'این کارت می‌گه مسیر بازه و تلاشت جواب می‌ده، فقط یکم دیرتر.',
    },
    ru: {
      leakBad:  'Твоё невысказанное чувство в том, что ты ждёшь решения от других.',
      leakOk:   'Похоже, ты ждёшь, что решение примет кто-то за тебя.',
      bookBad:  'Данная карта является указанием, в связи с чем необходимо действовать.',
      bookOk:   'Эта карта говорит, что путь открыт, только не так быстро.',
    },
    pt: {
      leakBad:  'O seu sentimento não dito é que você está esperando alguém decidir.',
      leakOk:   'Parece que você está esperando alguém decidir no seu lugar.',
      bookBad:  'Encontra-se aqui um caminho, e faz-se necessário deve-se agir.',
      bookOk:   'Essa carta diz que o caminho tá aberto, só que não tão rápido.',
    },
    es: {
      leakBad:  'Tu sentimiento no dicho es que estás esperando que alguien decida.',
      leakOk:   'Parece que estás esperando a que alguien decida por ti.',
      bookBad:  'Se encuentra aquí un camino; asimismo resulta necesario actuar, por ende decide.',
      bookOk:   'Esta carta dice que el camino está abierto, solo que no tan pronto.',
    },
  };
  for (const [code, sm] of Object.entries(SAMPLES)) {
    const L = (await import(`./reading-lab/lang/${code}.mjs`)).default;
    ok(!!L.labelLeak, `«${code}» الگوی نشتِ برچسب دارد`);
    ok(!!L.bookish?.re, `«${code}» الگوی لحنِ کتابی دارد`);
    if (!L.labelLeak || !L.bookish?.re) continue;
    ok(L.labelLeak.test(sm.leakBad), `«${code}» نشتِ برچسب را می‌گیرد`);
    ok(!L.labelLeak.test(sm.leakOk), `«${code}» جمله‌ی سالم را نشت نمی‌شمارد`);
    const count = (t) => { L.bookish.re.lastIndex = 0; return (t.match(L.bookish.re) || []).length; };
    const min = L.bookish.min || 3;
    ok(count(sm.bookBad) >= min, `«${code}» متنِ کتابی را می‌گیرد (${count(sm.bookBad)} ≥ ${min})`);
    ok(count(sm.bookOk) < min, `«${code}» متنِ گفتاری را کتابی نمی‌شمارد (${count(sm.bookOk)} < ${min})`);
  }
}

console.log('\n▶ لحنِ رسمی');
{
  const llm = base();
  llm.closing = 'در کل، شما باید صبر کنید تا مسیر باز شود.';
  ok(has(run(llm), 'لحنِ رسمی'), '«شما» گرفته می‌شود');
  ok(!has(run(base()), 'لحنِ رسمی'), 'متنِ گفتاری گرفته نمی‌شود');
  // استثنای جمعِ دو نفره در فالِ عشق: «شما» درباره‌ی «تو و او» فارسیِ درست است و سه
  // دورِ پیاپی به‌غلط قرمز شد. باید معاف باشد — ولی فقط وقتی نشانه‌ی زوج در **همان**
  // جمله باشد، وگرنه استثنا به درِ پشتیِ خطابِ رسمی تبدیل می‌شود.
  {
    const l = base();
    l.closing = 'در کل، رابطه‌تون می‌تونه شما رو به یه ثبات برسونه.';
    ok(!has(run(l), 'لحنِ رسمی'), 'جمعِ دو نفره در فالِ عشق معاف است');
  }
  {
    const l = base();
    l.pattern = 'رابطه‌تون داره جلو می‌ره.';
    l.closing = 'در کل، شما باید صبر کنید تا مسیر باز شود.';
    ok(has(run(l), 'لحنِ رسمی'), 'استثنا فقط در همان جمله کار می‌کند، نه کلِ متن');
  }
  /* ⚠️ چهار پرچمِ کاذبِ دورِ ۱۴۰۵/۰۶/۱۰ (بند ۹/۰ب ریشه: اول ابزار مقصر است).
   * هر ۴ پرچمِ «لحنِ رسمی» در ۹۰ فالِ واقعی از این دو شکل آمدند و هر دو جمعِ
   * درستِ فارسی‌اند. چون تنها ایرادِ باقی‌مانده‌ی یک بازو بودند، سنجه داشت
   * مقایسه‌ی دو مدل را وارونه نشان می‌داد. جمله‌ها **عیناً** از خروجیِ واقعی‌اند. */
  for (const [sent, why] of [
    ['ممکنه یکی از شما واقعاً پای کار بیاد، ولی اگر فقط تو چکش بزنی فایده نداره.', 'کمّی‌سازِ دونفره «یکی از شما»'],
    ['باعث شده تو و خواهرت تو این شرایط گیر کنید.', 'جفتِ «تو و <کسی>ت»'],
  ]) {
    const l = base();
    l.closing = sent;
    ok(!has(run(l), 'لحنِ رسمی'), `${why} معاف است`);
  }
  // و استثنا نباید به درِ پشتیِ خطابِ رسمیِ واقعی تبدیل شود
  {
    const l = base();
    l.closing = 'لطفاً بفرمایید چه کاری از دستم برمیاد و کِی تشریف میارید.';
    ok(has(run(l), 'لحنِ رسمی'), 'خطابِ رسمیِ واقعی همچنان گرفته می‌شود');
  }
  /* ⚠️ «تو» در فارسیِ گفتاری هم ضمیر است هم حرفِ اضافه («تو این شرایط»). اگر الگوی
   * جفت به «تو و <هرچیزی>» باز شود، این جمله هم معاف می‌شود و استثنا به درِ پشتی
   * تبدیل می‌گردد. این ادعا دقیقاً همان بازشدنِ بیش از حد را قرمز می‌کند. */
  {
    const l = base();
    l.closing = 'حس می‌کنی گیر افتادی تو و بیرون اومدن سخته، ولی شما می‌تونید صبر کنید.';
    ok(has(run(l), 'لحنِ رسمی'), '«تو»ی حرفِ اضافه استثنا نمی‌سازد');
  }
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

console.log('\n▶ طفره‌رفتن، واژه‌ی لحنی، ایموجی و خط تیره');
{
  // تفکیکِ عمدی (v3.6.2): طفره‌رفتن ایراد است چون قولِ محصول را می‌شکند و ارزشِ
  // یک بازتولید را دارد؛ «کائنات» فقط نکته است چون ارزشش را ندارد. تستِ هر دو
  // جهت لازم است وگرنه تفکیک بی‌صدا از بین می‌رود.
  const b = base(); b.pattern = 'این کاملاً بستگی داره.';
  ok(has(run(b), 'طفره‌رفتن'), 'طفره‌رفتن ایراد است');
  const k = base(); k.pattern = 'انرژیِ کائنات همراهته و مسیر باز می‌شه.';
  const rk = run(k);
  ok(hasNote(rk, 'واژه‌ی لحنیِ نامطلوب'), '«کائنات» فقط نکته است');
  ok(!has(rk, 'طفره‌رفتن'), '«کائنات» به‌عنوان طفره‌رفتن شمرده نمی‌شود');
  const sh = base(); sh.closing = 'در کل، به شهودت اعتماد کن و جلو برو.';
  ok(has(run(sh), 'طفره‌رفتن'), '«به شهودت اعتماد کن» طفره‌رفتن است، نه لحنی');
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

console.log('\n▶ تعمیرِ نقطه‌ای (به‌جای بازتولیدِ کلِ فال)');
{
  const rep = await import('../bots/tarot/repair.js');
  const base = () => ({
    headline: 'بله می‌شه ولی صبر می‌خواد', pattern: 'الگو',
    reads: [{ text: 'برج می‌گه یه چیزی می‌ریزه' }, { text: 'ده جام آرومه' }],
    closing: 'در کل، بستگی داره به خودت.', cards: [{ teaser: 'ت۱' }, { teaser: 'ت۲' }],
  });

  // ۱) تشخیص: کدام فیلد و کدام عبارت
  const hits = rep.findDefects(base());
  ok(hits.length === 1 && hits[0].path === 'closing', 'فیلدِ معیوب دقیق پیدا می‌شود');
  ok(hits[0].phrase === 'بستگی داره', 'خودِ عبارت گزارش می‌شود');
  ok(rep.findDefects({ ...base(), closing: 'در کل، بله می‌شه ولی صبر لازمه.' }).length === 0,
    'متنِ سالم تعمیر نمی‌خواهد');

  // ۲) ورودیِ پرامپتِ تعمیر فقط همان تکه است، نه کلِ فال — دلیلِ ارزان‌بودنش همین است
  const u = rep.repairUser(hits);
  ok(u.includes('بستگی داره') && !u.includes('ده جام'),
    'فقط فیلدِ معیوب به مدل می‌رود، نه کلِ خوانش');

  // ۳) جایگذاری: بقیه‌ی خوانش بیت‌به‌بیت دست‌نخورده می‌ماند
  const fixed = rep.applyFixes(base(), hits, ['در کل، بیشتر به این می‌خوره که پیش بره.']);
  ok(fixed.closing.includes('بیشتر به این می‌خوره'), 'فیلدِ معیوب عوض شد');
  ok(fixed.reads[0].text === 'برج می‌گه یه چیزی می‌ریزه' && fixed.headline === base().headline,
    'بقیه‌ی فیلدها دست‌نخورده‌اند');

  // ۴) مسیرِ موفق: **دقیقاً یک** فراخوانی
  let calls = 0;
  const okCall = (sys, usr, opts) => {
    calls++;
    const out = JSON.stringify({ fixes: ['در کل، بیشتر به این می‌خوره که جلو بره، ولی صبر می‌خواد.'] });
    return opts.validate(out) ? { out, usages: [{ prompt_tokens: 100, completion_tokens: 50 }] } : null;
  };
  const good = await rep.repairDefects(base(), okCall);
  ok(calls === 1, 'فقط یک فراخوانیِ تعمیر (نه حلقه)');
  ok(good.repaired && !rep.findDefects(good.llm).length, 'خروجیِ تعمیرشده دیگر طفره ندارد');

  // ۵) مسیرِ شکست: تعمیرِ خراب هرگز خوانش را نمی‌شکند
  const badCall = (sys, usr, opts) => {
    const out = JSON.stringify({ fixes: ['خب بستگی داره دیگه.'] });   // باز هم طفره
    return opts.validate(out) ? { out, usages: [] } : null;
  };
  const bad = await rep.repairDefects(base(), badCall);
  ok(!bad.repaired && bad.llm.closing === base().closing,
    'تعمیرِ ناموفق = متنِ اصلی برمی‌گردد (نه خوانشِ شکسته)');
  ok(bad.fired === true, 'تعمیرِ ناموفق «شلیک‌شده» شمرده می‌شود، نه «شلیک‌نشده»');
  ok(rep.findDefects({ cards: [{ teaser: 'کارتِ برج، بستگی داره.' }] }).length === 1,
    'تیزر هم دیده می‌شود (گارد و سنجه یک متن را می‌بینند)');

  // نوعِ دومِ ضعف: اشاره‌ی زمانیِ ساختگی به گذشته. مدل تاریخِ جلسه‌های قبل را ندارد،
  // پس هر «دفعه‌ی قبل که» ساخته‌ی خودش است.
  const pt = { ...base(), closing: 'در کل، دفعه‌ی قبل که حرف زدیم فرق داشت.' };
  const ptHits = rep.findDefects(pt);
  ok(ptHits.length === 1 && ptHits[0].kind === 'pastTime', 'زمانِ ساختگیِ گذشته هم تشخیص داده می‌شود');

  // و مهم‌تر: دو نوعِ متفاوت در **یک** فراخوانی، نه دو تا (وگرنه فالِ بدشانس دو بار معطل می‌شود)
  const both = { ...base(), closing: 'در کل، دفعه‌ی قبل که حرف زدیم فرق داشت.', reads: [{ text: 'بستگی داره.' }] };
  const bothHits = rep.findDefects(both);
  ok(bothHits.length === 2 && new Set(bothHits.map(h => h.kind)).size === 2,
    'دو نوعِ ضعف با هم پیدا می‌شوند');
  let n = 0;
  const twoCall = (sys, usr, opts) => {
    n++;
    const out = JSON.stringify({ fixes: ['در کل، همون موضوع هنوز بازه.', 'بیشتر به این می‌خوره که پیش بره.'] });
    return opts.validate(out) ? { out, usages: [{ prompt_tokens: 90, completion_tokens: 40 }] } : null;
  };
  const fixedBoth = await rep.repairDefects(both, twoCall);
  ok(n === 1, 'هر دو ضعف در یک فراخوانی تعمیر می‌شوند');
  ok(fixedBoth.repaired && rep.findDefects(fixedBoth.llm).length === 0, 'هیچ ضعفی باقی نمی‌ماند');
  ok(rep.repairUser(bothHits).includes('[ایراد:'), 'هر تکه با ایرادِ خودش به مدل می‌رود');
  const throwCall = () => { throw new Error('boom'); };
  const boom = await rep.repairDefects(base(), throwCall);
  ok(!boom.repaired && boom.llm.closing === base().closing, 'خطای شبکه هم خوانش را نمی‌شکند');

  /* ═══ تکه‌ی تعمیرنشدنی نباید تکه‌های سالم را هم دور بریزد (v3.43.0) ═══
   *
   * 🐛 آرِنای تعمیر نشان داد `validate` که `every` بود، با **یک** تکه‌ی سرسخت کلِ
   * خروجی را رد می‌کرد و همه‌ی تعمیرهای سالمِ همان فال هم دور ریخته می‌شدند. فالِ
   * اسپانیاییِ C1.1 با سه تکه (که یکی‌شان مثبتِ کاذب بود و هیچ رونویسی‌ای نمی‌توانست
   * از آن الگو فرار کند) هر شش تلاشِ هر دو مدل را کشت — عددِ گزارش `0/9` برای هر دو
   * بازو بود که شبیهِ «هیچ مدلی نمی‌تواند» می‌شد در حالی که خرابیِ ابزار بود.
   *
   * این‌جا با **همان شکل** آزموده می‌شود: دو تکه، مدل یکی را درست می‌کند و یکی را نه. */
  {
    const two = { ...base(), closing: 'در کل، بستگی داره به خودت.', reads: [{ text: 'دفعه‌ی قبل که حرف زدیم فرق داشت.' }] };
    const twoHits = rep.findDefects(two);
    ok(twoHits.length === 2, 'فیکسچرِ دوتکه‌ای واقعاً دو hit دارد');
    // ترتیبِ hitها همان ترتیبِ `findDefects` است: اول `closing`، بعد `reads.0`.
    // مدل تکه‌ی اول را درست می‌کند و تکه‌ی دوم را با همان ایراد پس می‌دهد.
    ok(twoHits[0].path === 'closing' && twoHits[1].path === 'reads.0', 'ترتیبِ hitها همان ترتیبِ فیلدهاست');
    const halfCall = (sys, usr, opts) => {
      const out = JSON.stringify({ fixes: ['بیشتر به این می‌خوره که پیش بره.', 'دفعه‌ی قبل که حرف زدیم فرق داشت.'] });
      return opts.validate(out) ? { out, usages: [{}] } : null;
    };
    const half = await rep.repairDefects(two, halfCall);
    ok(half.repaired, 'یک تکه‌ی سرسخت کلِ تعمیر را باطل نمی‌کند');
    ok(half.applied === 1 && half.hitCount === 2 && half.partial === true,
      `تعمیرِ جزئی گزارش می‌شود (شد ${half.applied}/${half.hitCount})`);
    ok(half.llm.closing.includes('بیشتر به این می‌خوره'), 'تکه‌ی سالم واقعاً جایگذاری شد');
    ok(half.llm.reads[0].text === two.reads[0].text,
      'تکه‌ی ردشده متنِ اصلیِ خودش را نگه می‌دارد (نه متنِ معیوبِ مدل)');
    // و مرزِ دیگر: اگر **هیچ** تکه‌ای سالم نباشد، تعمیر همچنان ناموفق است.
    const noneCall = (sys, usr, opts) => {
      const out = JSON.stringify({ fixes: ['دفعه‌ی قبل که حرف زدیم', 'خب بستگی داره دیگه.'] });
      return opts.validate(out) ? { out, usages: [] } : null;
    };
    const none = await rep.repairDefects(two, noneCall);
    ok(!none.repaired && none.llm.closing === two.closing,
      'خروجیِ کاملاً معیوب همچنان رد می‌شود و متنِ اصلی برمی‌گردد');
    ok(/REPAIR_PARTIAL/.test(readFileSync(new URL('../bots/tarot/repair.js', import.meta.url), 'utf8')),
      'رول‌بکِ یک‌خطی (REPAIR_PARTIAL) سرِ جایش است');
  }
}

/* ═══ ریشه‌یابیِ سنجه‌ی «لنگر» per زبان ═══
 *
 * ⚠️ چرا این تست وجود دارد: سنجه‌ی لنگر عیناً تطبیق می‌داد و برای فارسی درست بود
 * (اسم صرفِ حالت نمی‌شود). روی روسی که شش حالت دارد، **هر** ارجاعِ صرف‌شده به کارت یا
 * به سؤال «بی‌لنگر» شمرده می‌شد. عددِ ۴۶٪ دورِ اولِ روسی عمدتاً همین بود، نه شکافِ
 * کیفیت. اگر بدونِ این تست جلو می‌رفتیم، ده دور پرامپت را علیه یک عددِ خراب تنظیم
 * می‌کردیم — همان چیزی که آزمایشگاه برای حذفش ساخته شد.
 *
 * تست هر دو جهت را می‌سنجد: ریشه باید صرف‌های یک کلمه را یکی کند، و **نباید** دو
 * کلمه‌ی بی‌ربط را یکی کند (تطبیقِ کاذب عدد را خوش‌بینانه خراب می‌کند). */
{
  console.log('\n▶ ریشه‌یابیِ سنجه per زبان');
  const fa = (await import('./reading-lab/lang/fa.mjs')).default;
  ok(typeof fa.stem === 'function' && fa.stem('کارت‌ها') === 'کارت‌ها',
    'ریشه‌یابیِ فارسی همانی است (خطِ پایه‌ی ۱۶ دور نباید عوض شود)');
  const ru = (await import('./reading-lab/lang/ru.mjs')).default;
  const same = [['работы', 'работе'], ['Кубков', 'Кубка'], ['Тройка', 'Тройки'],
    ['желания', 'желание'], ['ситуации', 'ситуация']];
  const diff = [['работа', 'работник'], ['любовь', 'любой'], ['карта', 'карман'],
    ['мужчина', 'мужество'], ['деньги', 'день']];
  const badSame = same.filter(([a, b]) => ru.stem(a) !== ru.stem(b));
  const badDiff = diff.filter(([a, b]) => ru.stem(a) === ru.stem(b));
  ok(badSame.length === 0, `صرف‌های یک کلمه یک ریشه می‌گیرند${badSame.length ? ` (${badSame.map(p => p.join('/')).join(', ')})` : ''}`);
  ok(badDiff.length === 0, `کلمه‌های بی‌ربط ریشه‌ی جدا دارند${badDiff.length ? ` (${badDiff.map(p => p.join('/')).join(', ')})` : ''}`);
  // حداقلِ طولِ ریشه: بدونش «дом» به «д» می‌رسید و با هر چیزی تطبیق می‌خورد
  ok(ru.stem('дом').length >= 3, 'ریشه‌ی کلمه‌ی کوتاه بریده نمی‌شود');
}

/* ── بازوی مدل باید کلِ خطِ لوله را بپوشاند ───────────────────────────────────
   دورِ ۵ با `--model` گرفته شد ولی مسیرِ **تعمیر** همچنان روی مدلِ پیش‌فرضِ محصول
   می‌رفت، پس آن جدول «مدلِ خوانش» را می‌سنجید نه «کلِ خطِ لوله» — یک شکافِ
   روش‌شناختیِ بی‌صدا که فقط با خواندنِ لاگِ خام پیدا شد. */
{
  console.log('\n▶ بازوی مدل');
  const LAB = readFileSync(new URL('./reading-lab.mjs', import.meta.url), 'utf8');
  ok(/repairDefects\([\s\S]{0,400}?plan: \[MODEL\]/.test(LAB),
    'مسیرِ تعمیر هم با همان مدلِ بازو اجرا می‌شود');
  // `const` یا `let` هر دو قبول‌اند: حالتِ چندبازویی عمداً `let` کرد تا بینِ بازوها عوض شود.
  ok(/(const|let) PLAN = \[MODEL, MODEL, MODEL, FALLBACK, FALLBACK\];/.test(LAB),
    'برنامه‌ی خوانش از همان بازو ساخته می‌شود');
  /* و اگر `let` شد، باید سرِ **هر** بازو دوباره ساخته شود؛ وگرنه بازوی دوم با برنامه‌ی
   * بازوی اول اجرا می‌شود و کلِ مقایسه بی‌معنی است، بدونِ هیچ خطایی. */
  /* شکلِ بازو حالا `model@variant` است، پس انتساب دو خط شد. ادعا همان می‌ماند: با
   * تعویضِ بازو باید **هم** مدل و **هم** برنامه‌ی خوانش بازساخته شوند، وگرنه بازوی
   * دوم با برنامه‌ی بازوی اول اجرا می‌شود و مقایسه بی‌صدا بی‌معنی است. */
  ok(!/let PLAN =/.test(LAB)
    || /MODEL = armModel\(arm\); VARIANT = armVariant\(arm\);[\s\S]{0,80}?PLAN = \[MODEL, MODEL, MODEL, FALLBACK, FALLBACK\];/.test(LAB),
    'با تعویضِ بازو، مدل و برنامه‌ی خوانش هر دو همان‌جا بازساخته می‌شوند');

  /* 💵 هزینه باید **واقعی** باشد، نه توکن ضربدرِ یک قیمتِ هاردکد.
   * 🐛 دورِ ۹ این را لو داد: گزارش دلار را با نرخِ ثابتِ Gemini Flash حساب می‌کرد، پس
   * روی بازوی DeepSeek — که per توکن چند برابر ارزان‌تر است — «گران‌ترین مدلِ دور»
   * گزارش شد. عددی که واحدش دلار نوشته شده ولی دلار نیست، بدتر از نبودنش است، چون
   * مستقیم واردِ تصمیمِ انتخابِ مدل می‌شود. خودِ OpenRouter `usage.cost` را در هر پاسخ
   * برمی‌گرداند (همان چیزی که ربات در `llm_usage` می‌نویسد). */
  ok(!/1e6 \* 0\.30|1e6 \* 2\.50/.test(LAB),
    'قیمتِ هاردکد در گزارشِ هزینه نمانده (وگرنه مقایسه‌ی مدل‌ها دلار نیست)');
  ok(/usd: a\.usd \+ \(Number\(u\?\.cost\) \|\| 0\)/.test(LAB),
    'هزینه از `usage.cost` واقعیِ OpenRouter جمع می‌شود');
  ok(/usd > 0 \?/.test(LAB),
    'هزینه‌ی نیامده سکوت است، نه یک تخمینِ ساختگی');

  /* 🚦 پیش‌پروازِ locale: زبانی که بلوکِ `verdict` ندارد یک دورِ کاملِ پولی را می‌سوزاند
   * بدونِ خطا (`configureVerdict` ورودیِ خالی را بی‌صدا رد می‌کند، ماژول فارسی می‌ماند،
   * و `headlineOk` هر سرخط را رد می‌کند). همان چیزی که سرِ روسی رخ داد. */
  ok(/بلوکِ verdict کامل ندارد/.test(LAB) && /process\.exit\(1\)/.test(LAB),
    'دورِ زبانی که verdict ندارد قبل از خرجِ پول متوقف می‌شود');
  ok(/\['yes', 'no', 'direction', 'evasion', 'but'\]/.test(LAB),
    'پیش‌پرواز همان کلیدهایی را می‌خواهد که گاردِ سرخط لازم دارد');
  /* 🐛 و پیش‌پروازِ سناریو: `focus`ِ ناشناخته خطا نمی‌دهد، `focusFa[k] || k` عینِ همان
   * کلمه را داخلِ پرامپت می‌گذارد. سناریوهای پرتغالیِ من `work`/`self` داشتند و یک
   * دورِ کاملِ پولی با انگلیسیِ نشت‌کرده در پرامپتِ پرتغالی اجرا شد، بی‌صدا. */
  ok(/focus ناشناخته/.test(LAB) && /!L\?\.focusFa\?\.\[f\]/.test(LAB),
    'سناریو با focusِ ناشناخته قبل از خرجِ پول متوقف می‌شود');
  ok(/چیدمانِ ناشناخته →/.test(LAB),
    'سناریو با چیدمانِ ناشناخته هم قبل از خرجِ پول متوقف می‌شود');
  /* 🎲 تنوعِ سناریو و واریانتِ پرامپت — تذکرِ مالک: سه **پاس** روی همان ۹ سؤال تنوع
   * نیست، فقط تکرار. یک دور می‌تواند شانسی خوب دربیاید. */
  ok(/--set|const SET/.test(LAB), 'لابراتوار مجموعه‌ی سناریوی جایگزین را می‌پذیرد (`--set`)');
  ok(/PROMPT_VARIANTS/.test(LAB), 'واریانتِ پرامپت به‌عنوان بُعدِ بازو وجود دارد');
  /* و مهم‌ترین گاردِ این مکانیزم: اگر جایگزینیِ واریانت هیچ اثری نداشته باشد، ما
   * داریم دو پرامپتِ **یکسان** را با هزینه‌ی کامل مقایسه می‌کنیم و نتیجه بی‌معنی
   * است. باید بلند شکست بخورد، نه بی‌صدا. (همین گارد در اولین تست کار کرد.) */
  ok(/هیچ تغییری در پرامپت نداد/.test(LAB),
    'واریانتی که چیزی را عوض نکند قبل از خرجِ پول می‌ترکد');
}

/* 🅰️🅱️ مقایسه‌ی جفت‌شده: تنها راهِ دیدنِ تفاوتِ مدل زیرِ نویزِ ۱۳ واحدی. */
{
  console.log('\n▶ مقایسه‌ی جفت‌شده‌ی بازوها');
  const LAB = readFileSync(new URL('./reading-lab.mjs', import.meta.url), 'utf8');
  ok(/--arms|ARM_LIST/.test(LAB), 'لابراتوار حالتِ چندبازویی دارد');
  ok(/let MODEL = val\('model'/.test(LAB),
    'MODEL بینِ بازوها قابلِ تعویض است (`let` نه `const`)');
  // برچسبِ بازو حالا `model@variant` است تا خلاصه واریانت‌ها را هم جدا کند.
  ok(/arm: VARIANT \? `\$\{MODEL\}@\$\{VARIANT\}` : MODEL/.test(LAB),
    'نامِ بازو (همراهِ واریانت) روی هر ردیفِ نتیجه ثبت می‌شود');
  ok(/میانگینِ تفاضلِ per سناریو/.test(LAB),
    'گزارش تفاضلِ per سناریو می‌دهد، نه فقط دو درصدِ تجمیعی');
  ok(/قطعی نیست/.test(LAB),
    'وقتی الگو یک‌دست نیست، گزارش صریحاً می‌گوید تفاوت قطعی نیست');
  /* ⚠️ ادعای اول ساده‌لوحانه بود: کلِ فایل را می‌گشت و به **کامنتی** می‌خورد که توضیح
   * می‌داد چرا p-value چاپ نمی‌کنیم. یعنی چک به توضیحِ خودش گیر کرده بود. حالا فقط
   * خطوطِ چاپ سنجیده می‌شوند. */
  const printed = LAB.split('\n').filter(l => /console\.log/.test(l)).join('\n');
  ok(!/p-value|pValue/.test(printed),
    'p-value چاپ نمی‌شود (با ۹ سناریو فقط اعتمادِ کاذب می‌سازد)');
  const wf = readFileSync(new URL('../.github/workflows/reading-lab.yml', import.meta.url), 'utf8');
  ok(/inputs\.arms/.test(wf), 'ورک‌فلو ورودیِ arms را پاس می‌دهد');
  /* سنجه‌ی «تکرارِ بین‌فالی» باید per بازو گروه شود. اگر فقط per پاس گروه شود، یک
   * ۶کلمه‌ایِ مشترکِ `A/R1.1` و `B/R1.2` تکرار شمرده می‌شود در حالی که دو مدلِ متفاوت‌اند
   * و این عدد قرار است تکرارِ **یک** مدل را بسنجد. خرابیِ کاملاً بی‌صدا. */
  ok(/groupsSeen/.test(LAB) && /String\(x\.arm \|\| ''\) === gArm/.test(LAB),
    'تکرارِ بین‌فالی per بازو گروه می‌شود، نه فقط per پاس');
  /* 🐛 `arm` باید در خروجیِ JSON هم بنشیند. آن map فیلدها را صریح انتخاب می‌کند، پس
   * فیلدی که فقط به `all` اضافه شود به artifact و به خلاصه‌ی انتهای لاگ نمی‌رسد و
   * همه‌ی بازوها در یک سطل می‌افتند: تفکیکی که کلِ تصمیم روی آن است، بی‌صدا گم. */
  ok(/arm: r\.arm/.test(LAB),
    'نامِ بازو در خروجیِ JSON هم ذخیره می‌شود، نه فقط در حافظه');
}

/* ═══ سنجه‌ی «لنگر» خودش تست می‌شود، نه فقط کدش خوانده می‌شود ═══
 *
 * 🐛 باگِ ۱۴۰۵/۰۶/۰۹: جمله‌ای که صریحاً نامِ کارتِ کشیده‌شده را در حالتِ **صرف‌شده**
 * برده بود، «بی‌لنگر» شمرده می‌شد. دو گلوگاهِ مستقل با هم: `minWordLen` کلمه‌ی کوتاه را
 * قبل از ریشه‌یابی دور می‌ریخت، و کفِ طولِ ریشه‌ی خودِ استمر ۴ بود پس «Туз» و «Туза»
 * به یک ریشه نمی‌رسیدند. اثرش **نامتقارن** بود: فارسی صرف نمی‌کند پس از مسیرِ تطبیقِ
 * عینی رد می‌شد و دست‌نخورده ماند، ولی روسی کاملاً به مسیرِ ریشه وابسته بود. یعنی
 * «شکافِ کیفیتِ فارسی و روسی» روی خط‌کشِ کج اندازه‌گیری شده بود.
 *
 * درس: خواندنِ کدِ سنجه کافی نیست، باید **اجرا** شود. این بلوک همان کاری را با سنجه
 * می‌کند که `check-locale-shape` با locale کرد. */
{
  console.log('\n▶ سنجه‌ی لنگر واقعاً اجرا می‌شود (ضدِ خط‌کشِ کج)');
  const CASES = [
    ['ru', [['Туза Кубков тут говорит о начале нежности в твоей жизни', false],
            ['Луны в этом раскладе достаточно чтобы понять твою тревогу', false],
            ['У Тройки Кубков есть своя радость которую ты давно не чувствовала', false],
            ['Ты сильная женщина и у тебя все обязательно получится в жизни', true]]],
    ['fa', [['آس جام این‌جا از شروعِ یک مهربانیِ تازه حرف می‌زنه برات', false],
            ['ماه نشون می‌ده که ابهام هنوز هست و باید صبر کنی کمی', false],
            ['تو آدمِ قوی‌ای هستی و حتماً همه چیز درست می‌شه برات', true]]],
  ];
  const cards = [{ key: 'c01' }, { key: 'm18' }, { key: 'c03' }];
  const ctx = { question: 'x', memory: '', previous: [] };
  for (const [loc, cases] of CASES) {
    const prev = process.env.LOCALE;
    process.env.LOCALE = loc;
    // هر زبان در یک پروسه‌ی جدا اجرا می‌شود: ماژولِ سنجه زبان را در زمانِ import قفل می‌کند.
    const src = `
      process.env.LOCALE=${JSON.stringify(loc)};
      const { anchorScore } = await import(${JSON.stringify(new URL('../tools/reading-lab/checks.mjs', import.meta.url).href)});
      const cards=${JSON.stringify(cards)}, ctx=${JSON.stringify(ctx)};
      const out=${JSON.stringify(cases)}.map(([t,e])=>{
        const l=anchorScore({llm:{headline:'',pattern:t,callback:'',closing:'',reads:[]},cards,ctx}).loose>0;
        return l===e;});
      console.log(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8' });
    process.env.LOCALE = prev;
    let res = null;
    try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch {}
    ok(Array.isArray(res) && res.length === cases.length && res.every(Boolean),
      `سنجه‌ی لنگر روی «${loc}» هر ${cases.length} حالت را درست می‌گوید` +
      (Array.isArray(res) ? ` (${res.filter(Boolean).length}/${res.length})` : ' (اجرا نشد)'));
  }
}

/* 🅰️ بازوی تک‌عضوی باید واقعاً اعمال شود — ادعای **رفتاری**، نه شکلِ کد.
 * 🐛 باگِ واقعی: انتسابِ `MODEL = armModel(arm)` داخلِ شرطِ `ARM_LIST.length > 1`
 * بود، پس `--arms <یک مدل>` بی‌صدا نادیده گرفته می‌شد و کلِ دور روی مدلِ پیش‌فرض
 * اجرا می‌شد، در حالی که گزارش همان بازوی خواسته‌شده را چاپ می‌کرد. سه دورِ واقعی
 * به همین شکل سوختند. رجکس این را نمی‌گرفت چون خودِ رشته سرِ جایش بود؛ فقط
 * **اجرا** لوش می‌دهد. */
{
  console.log('\n▶ بازوی تک‌عضوی واقعاً اعمال می‌شود');
  const cases = [
    [['--arms', 'openai/gpt-5.6-luna'], 'openai/gpt-5.6-luna', 'بازوی تک‌عضوی'],
    [['--arms', 'openai/gpt-5.6-luna@nopast'], 'openai/gpt-5.6-luna@nopast', 'بازوی تک‌عضوی با واریانت'],
    [['--model', 'deepseek/deepseek-v3.2'], 'deepseek/deepseek-v3.2', '`--model` بدونِ arms'],
    // پیش‌فرض = مدلِ خودِ محصول برای همین زبان. این دور با `--locale ru` اجرا می‌شود،
    // پس انتظار همان چیزی است که رباتِ روسی واقعاً روی آن فال می‌سازد.
    [[], 'openai/gpt-5.6-luna', 'بدونِ arms و بدونِ model (پیش‌فرضِ همان زبان)'],
  ];
  for (const [args, want, label] of cases) {
    const out = `/tmp/armchk-${Math.random().toString(36).slice(2)}.json`;
    const r = spawnSync(process.execPath, [
      new URL('../tools/reading-lab.mjs', import.meta.url).pathname,
      '--locale', 'ru', '--set', 'c', '--fake', '--only', 'C1', '--out', out, ...args,
    ], { encoding: 'utf8', env: { ...process.env, LOCALE: 'ru' } });
    let arms = [];
    try { arms = [...new Set(JSON.parse(readFileSync(out, 'utf8')).map(x => x.arm))]; } catch {}
    try { unlinkSync(out); } catch {}
    ok(arms.length === 1 && arms[0] === want,
      `${label} → «${want}»` + (arms.length ? ` (گرفت: ${arms.join(',')})` : ' (اجرا نشد)'));
  }
}


/* ▶ وفاداریِ آزمایشگاه به پروداکشن: اسپرد باید **ترجمه‌شده** به پرامپت برود.
 *
 * 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۲۷ که دورِ اولِ انگلیسی لو داد: `locSpread` فقط در `index.js`
 * تعریف شده بود، پس تنها پروداکشن از آن رد می‌شد و آزمایشگاه اسپردِ **خام** می‌داد.
 * یعنی مدل در هر دورِ غیرفارسی نامِ فارسیِ اسپرد و موقعیت‌ها را می‌دید:
 *     «Расклад: «گذشته، حال، آینده», 3 карт»
 * ترجمه گم نشده بود (`positionNames` هر چهار زبان کامل است)؛ **مسیرِ رسیدن** نبود
 * (بند ۲و/۶ب). و این مستقیماً قراردادِ خودِ آزمایشگاه را نقض می‌کرد: «هرگز چیزی را
 * تست نمی‌کند که با پروداکشن فرق دارد». همه‌ی دورهای غیرفارسیِ تا آن روز روی پرامپتی
 * اندازه‌گیری شده بودند که محصول اجرا نمی‌کرد. */
console.log('\n▶ وفاداریِ اسپردِ آزمایشگاه به پروداکشن');
{
  const PROD = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
  const CORE = readFileSync(new URL('../bots/tarot/reading-core.js', import.meta.url), 'utf8');
  const LABSRC = readFileSync(new URL('./reading-lab.mjs', import.meta.url), 'utf8');
  const CHATLAB = readFileSync(new URL('./chat-lab.mjs', import.meta.url), 'utf8');

  // ── ساختاری: یک تعریف، نه دو تا که واگرا شوند
  ok(/export const locSpread/.test(CORE),
     '`locSpread` در reading-core تعریف و export شده (تک‌منبع)');
  ok(!/^const locSpread/m.test(PROD),
     'index.js نسخه‌ی محلیِ خودش را ندارد (وگرنه دو تعریف واگرا می‌شوند)');

  // ── هیچ صداکننده‌ای اسپردِ خام به پرامپت ندهد
  for (const [name, src] of [['reading-lab.mjs', LABSRC], ['chat-lab.mjs', CHATLAB], ['index.js', PROD]]) {
    const raw = [...src.matchAll(/readerSystemV[0-9]?\(\s*spread\s*,/g)].length;
    ok(raw === 0, `${name}: هیچ فراخوانیِ readerSystem با اسپردِ **خام** ندارد`);
  }
  ok([...LABSRC.matchAll(/readerSystemV4\(locSpread\(spread\)/g)].length >= 2,
     'reading-lab هر دو مسیرش اسپردِ ترجمه‌شده می‌دهد');

  /* ── رفتاری، و این مهم‌ترین ادعاست: ادعای ساختاری بالا فقط می‌گوید «تابع صدا زده شد»،
   * نه اینکه واقعاً **ترجمه کرد**. پس خودِ locSpread در یک زبانِ غیرفارسی اجرا می‌شود و
   * نتیجه‌اش شمرده می‌شود (بند ۲و/۶ب: گاردِ آینه‌ای همیشه گاردِ رفتاری هم لازم دارد). */
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const s  = await import('${new URL('../bots/tarot/spreads.js', import.meta.url).pathname}');
    const rc = await import('${new URL('../bots/tarot/reading-core.js', import.meta.url).pathname}');
    const lb = await import('${new URL('../bots/tarot/locale-boot.js', import.meta.url).pathname}');
    lb.configureAllLocales();
    const m  = (await import('${new URL('../bots/tarot/locales/ru.js', import.meta.url).pathname}')).default;
    const fa = (x) => (String(x).match(/[\\u0600-\\u06FF]+/g) || []).length;
    const sp = s.SPREAD_BY_ID.three;
    console.log(JSON.stringify({
      raw:   fa(m.prompts.readerSystemV4(sp, {})),
      fixed: fa(m.prompts.readerSystemV4(rc.locSpread(sp), {})),
    }));
  `], { encoding: 'utf8', env: { ...process.env, LOCALE: 'ru' } });
  let r = {}; try { r = JSON.parse((probe.stdout || '').trim().split('\n').pop()); } catch {}
  ok(r.fixed === 0,
     `پرامپتِ روسی با locSpread صفر واژه‌ی فارسی دارد (گرفت: ${r.fixed})`);
  // کنترلِ مثبت: بدونِ آن واقعاً فارسی نشت می‌کند، وگرنه ادعای بالا پوچ بود
  ok(r.raw > 0,
     `کنترلِ مثبت: بدونِ locSpread فارسی واقعاً نشت می‌کند (${r.raw} واژه)`);
}

/* ═══════════════ ۹) ممیزیِ سنجه‌ها روی **انگلیسی** ═══════════════
 *
 * چرا جدا و چرا فقط انگلیسی: `lang/en.mjs` تازه است و برخلافِ چهار زبانِ دیگر هرگز
 * روی دورهای واقعیِ آزمایشگاه نچرخیده. سنجه‌ی سبزِ نچرخیده دو معنی دارد («چیزی نیست»
 * یا «چیزی را که هست نمی‌بینم») و تنها راهِ تفکیک، زدنش روی نمونه‌ی شناخته‌شده‌ی نقض
 * است (بند ۲و/۶ب-۲ ریشه). اجرا در پروسه‌ی جدا اجباری است، چون `checks.mjs` زبان را
 * **لحظه‌ی بارگذاری** از `LOCALE` می‌خواند و کشِ ESM اجازه‌ی بارگذاریِ دوم را نمی‌دهد.
 * بدونِ شبکه و بدونِ هیچ فراخوانیِ مدل. */
{
  console.log('\n▶ ممیزیِ سنجه‌ها روی انگلیسی');
  const r = spawnSync(process.execPath, [new URL('./reading-lab/metric-audit.en.mjs', import.meta.url).pathname],
    { encoding: 'utf8' });
  let out = {};
  try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { out = { pass: 0, fails: ['خروجیِ ممیزی خوانده نشد: ' + (r.stderr || '').slice(-300)] }; }
  for (const f of out.fails || []) ok(false, `ممیزیِ en: ${f}`);
  // کنترلِ مثبت: اگر روزی خودِ هارنس بی‌صدا از کار بیفتد، «صفر شکست» نباید سبز بدهد.
  ok((out.pass || 0) >= 37, `ممیزیِ سنجه‌های en اجرا شد (${out.pass || 0} ادعا)`);
}

if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
