#!/usr/bin/env node
/**
 * ممیزیِ سنجه‌های **انگلیسی**: هر سنجه روی یک نقضِ واقعی قرمز بدهد و روی متنِ سالم ساکت بماند.
 *
 * چرا لازم شد (بند ۲و/۶ب-۲ ریشه): `lang/en.mjs` تازه نوشته شده و برخلافِ چهار زبانِ
 * دیگر هیچ‌وقت روی ~۳۰۰ فالِ واقعی نچرخیده. یک سنجه‌ی سبز آن‌جا دو معنیِ کاملاً متفاوت
 * دارد — «چیزی نیست» یا «چیزی را که هست نمی‌بینم» — و تنها راهِ تفکیک، زدنش روی
 * نمونه‌ی **شناخته‌شده‌ی نقض** است. پس هر ادعای منفیِ این فایل یک کنترلِ مثبت دارد:
 * خطِ پایه‌ی سالم باید صفر ایراد بدهد، وگرنه بقیه‌ی ادعاها پوچ‌اند.
 *
 * 🐛 و همان دورِ اول یک باگِ واقعی گرفت: تطبیقِ `REGISTER` در `checks.mjs` حساس به
 * حروفِ بزرگ بود، پس «The universe» (پرتکرارترین شکلش، چون با حرفِ تعریف شروع می‌شود
 * و معمولاً اولِ جمله می‌آید) هرگز شمرده نمی‌شد.
 *
 * ⚠️ عمداً فقط انگلیسی: فیکسچرها به زبان گره خورده‌اند و چهار زبانِ دیگر اعتبارشان را
 * از دورهای واقعیِ آزمایشگاه گرفته‌اند، نه از این فایل. اگر زبانِ تازه‌ای اضافه شد،
 * کپیِ همین فایل با متنِ همان زبان قدمِ اولِ اعتبارسنجیِ سنجه‌هایش است.
 *
 * بدونِ شبکه و بدونِ هیچ فراخوانیِ مدل. خروجی: یک خطِ JSON + کدِ خروج.
 */
process.env.LOCALE = 'en';

const { SPREAD_BY_ID } = await import('../../bots/tarot/spreads.js');
const { configureLocale } = await import('../../bots/tarot/locale-boot.js');
const L = (await import('../../bots/tarot/locales/en.js')).default;
configureLocale(L);
const { renderV4, locSpread, cardName } = await import('../../bots/tarot/reading-core.js');
const { checkReading } = await import('./checks.mjs');

const spread = locSpread(SPREAD_BY_ID.personal3);
const cards = [{ key: 'm00', reversed: false }, { key: 'c03', reversed: true }, { key: 'p09', reversed: false }];
const labels = L.prompts.cardLabels(cards.length);
const ctx = { question: 'Should I take the job offer in Berlin?', memory: '', previous: [] };

// خطِ پایه‌ی **سالم**: هر سنجه‌ای که روی این قرمز بدهد قرمزِ کاذب است.
const healthy = () => ({
  headline: 'Yes, the move is likely to work out, but it will cost you the safety you have now.',
  pattern: 'The Fool next to the Three of Cups reversed says the Berlin offer is already decided in your gut.',
  callback: '',
  reads: [
    'The Fool is the part of you that already packed the bag for Berlin.',
    'Three of Cups reversed shows the friends you would leave behind, and how much that job costs you.',
    'Nine of Pentacles says the money side of this offer holds up on its own.',
  ],
  closing: 'Berlin opens up within two months, but only if you tell them yes before the offer cools.',
  cards: [{ teaser: 'A young man steps off a cliff with a small bag.' },
    { teaser: 'Three cups tipped over on the ground.' },
    { teaser: 'A woman in a garden with a falcon on her hand.' }],
  summary: 'job offer in Berlin',
  memory: 'considering a move',
});

const run = (llm, over = null) => checkReading({
  llm, rendered: renderV4(llm, cards, labels, { name: 'Anna' }), spread, cards, ctx: over || ctx, L,
});
const issue = (r, re) => r.issues.filter((i) => re.test(i)).length;
const note = (r, re) => r.notes.some((n) => re.test(n));

const fails = [];
let pass = 0;
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };

// ═══ کنترلِ مثبتِ کلِ فایل ═══
const base = run(healthy());
ok(base.issues.length === 0, `متنِ سالم ایراد گرفت: ${base.issues.join(' | ')}`);
ok(base.notes.length === 0, `متنِ سالم نکته گرفت: ${base.notes.join(' | ')}`);

const bad = (mut) => { const l = healthy(); mut(l); return run(l); };

// ۱) سرخط
ok(issue(bad((l) => { l.headline = 'The cards show many possibilities for you.'; }), /سرخط/) === 1,
  'سرخطِ بی‌فرمول گرفته نشد');
// ۲) رجیستر (انگلیسیِ شبه‌باستانی — خطرِ مخصوصِ این دامنه)
ok(issue(bad((l) => { l.closing = 'Verily, thou shalt find what thou seekest ere the moon turns, but only if thee act.'; }), /لحنِ رسمی/) >= 1,
  'انگلیسیِ باستانی گرفته نشد');
// ۳) خط تیره: `noDash` سرِ رندر پاکش می‌کند، پس **نکته** درست است نه ایراد
{
  const r = bad((l) => { l.pattern = 'The Fool and the Three of Cups reversed — both point to Berlin.'; });
  ok(note(r, /خط تیره/), 'تولیدِ خط تیره توسطِ مدل گزارش نشد');
  ok(issue(r, /خط تیره/) === 0, 'خط تیره ایراد شمرده شد در حالی که noDash پاکش کرده');
}
// ۳الف) نشتِ برچسبِ پرامپت
ok(issue(bad((l) => { l.pattern = 'Your unspoken feeling is that you already said yes to Berlin.'; }), /نشتِ برچسب/) === 1,
  'نشتِ برچسب گرفته نشد');
// ۳ج) LLM-ese (معادلِ канцелярит در انگلیسی)
ok(issue(bad((l) => { l.closing = 'It is important to note that you must navigate the complexities of this move, but the tapestry holds.'; }), /لحنِ کتابی/) === 1,
  'LLM-ese گرفته نشد');
// ۳ب) نویسه‌ی بیگانه — هر چهار خانواده، چون هر چهار زبان در یک پروسه زندگی می‌کنند
for (const [txt, lbl] of [['Дурак', 'سیریلیک'], ['运', 'CJK'], ['دیوانه', 'فارسی'], ['decisão', 'پرتغالی']]) {
  ok(issue(bad((l) => { l.reads[0] = `The Fool ${txt} says Berlin is the door.`; }), /نویسه/) >= 1,
    `نویسه‌ی بیگانه «${lbl}» گرفته نشد`);
}
// ۳ج) مارک‌داونِ تولیدشده
ok(note(bad((l) => { l.pattern = '**The Fool** with the Three of Cups reversed says Berlin is already decided.'; }), /مارک‌داون/),
  'تولیدِ مارک‌داون گزارش نشد');
// ۴) برچسبِ کارت
ok(issue(bad((l) => { l.reads.pop(); }), /برچسبِ/) >= 1, 'برچسبِ کارتِ گمشده گرفته نشد');
// ۵) نامِ جایگاه در متن
ok(note(bad((l) => { l.pattern = 'The road ahead with the Fool is already picked: Berlin.'; }), /نامِ جایگاه/),
  'نامِ جایگاه در متن گزارش نشد');
// ۶) طفره‌رفتن
ok(issue(bad((l) => { l.closing = 'In the end it depends on you, only you know what is right here.'; }), /طفره/) === 1,
  'طفره‌رفتن گرفته نشد');
// ۶ب) واژه‌ی لحنی — **هر دو شکلِ حروف**. شکلِ بزرگ همان باگی است که این فایل پیدا کرد.
for (const [u, lbl] of [['the universe', 'حروفِ کوچک'], ['The universe', 'حروفِ بزرگ']]) {
  ok(note(bad((l) => { l.closing = `${u} opens Berlin within two months, but only if you take the Fool seriously.`; }), /واژه/),
    `واژه‌ی لحنیِ «${u}» (${lbl}) گرفته نشد`);
}
// ۷) اشاره‌ی زمانی به گذشته
ok(issue(bad((l) => { l.pattern = 'Last year the Fool already told you Berlin was the door.'; }), /زمانی به گذشته/) === 1,
  'اشاره‌ی زمانی به گذشته گرفته نشد');
// ۷ب) ارجاعِ توهمی به جلسه‌ی قبل در اولین فال
ok(issue(bad((l) => { l.callback = 'Last session you asked about the same job.'; }), /اولین فال/) === 1,
  'ارجاعِ توهمی به جلسه‌ی قبل گرفته نشد');
// ۸) تکرارِ تیزر در خوانشِ همان کارت
ok(note(bad((l) => {
  l.cards[0].teaser = 'A young man steps off a cliff with a small bag toward Berlin.';
  l.reads[0] = 'A young man steps off a cliff with a small bag toward Berlin, and that is you.';
}), /تیزر/), 'تکرارِ تیزر گزارش نشد');
// ۹) لنگرِ نامِ کارت
ok(issue(bad((l) => {
  l.pattern = 'Something in you already decided about Berlin.';
  l.reads = ['This one is the part of you that already packed the bag for Berlin.',
    'This one shows the friends you would leave behind and what the job costs you.',
    'This one says the money side of the offer holds up on its own.'];
  l.closing = 'Berlin opens up within two months, but only if you say yes before it cools.';
}), /هیچ کارتی/) === 1, 'نبودِ نامِ کارت در متن گرفته نشد');
// ۱۱) نرخِ بی‌لنگر (Barnum) — متریکِ مرکزیِ مقایسه‌ی دورها
{
  const g = 'You have the ability to create beautiful things when the moment feels right for it';
  const r = bad((l) => {
    l.pattern = `${g}.`; l.closing = `${g.replace('beautiful', 'lasting')}.`;
    l.reads = [`${g}.`, `${g.replace('beautiful', 'quiet')}.`, `${g.replace('beautiful', 'solid')}.`];
  });
  ok(r.anchor.pct >= 50, `متنِ کاملاً عمومی فقط ${r.anchor.pct}٪ بی‌لنگر گرفت`);
  ok(base.anchor.pct <= 34, `کنترلِ معکوس: متنِ لنگردار ${base.anchor.pct}٪ بی‌لنگر گرفت`);
}
/* ۱۱ب) 🔑 ریشه‌یابی: مفرد و جمع باید به هم برسند.
 *
 * 🐛 باگی که این ادعا برایش نوشته شد: نسخه‌ی اولِ `stem` انگلیسی قاعده‌ی `['ies','es','s']`
 * را از اسپانیایی پورت کرده بود. آن `es` هر کلمه‌ی جمعی را که به `-es` ختم شود یک حرف
 * اضافه می‌بُرد، پس مفرد و جمعِ **یک کلمه** به هم نمی‌رسیدند: «chances» ⟵ `chanc` ولی
 * «chance» ⟵ `chance`. نتیجه‌اش جمله‌ای است که صریحاً کلمه‌ی خودِ سؤالِ کاربر را
 * برمی‌گرداند ولی «بی‌لنگر» شمرده می‌شود — یعنی عددِ مرکزیِ مقایسه‌ی دورها متورم
 * می‌شود، دقیقاً همان کلاسِ باگی که در روسی ۸۰٪ گزارشِ غلط ساخت.
 *
 * ⚠️ و چرا فیکسچر باید **جمع در یک متن و مفرد در متنِ دیگر** باشد: هر دو سرِ تطبیق از
 * یک تابعِ `stem` رد می‌شوند، پس اگر هر دو متن جمع بنویسند باگ خنثی می‌ماند. تنها جایی
 * که می‌سوزد مرزِ صرف است. */
{
  const qctx = { question: 'Should I take my chances on the Berlin offer?', memory: '', previous: [] };
  const l = healthy();
  // تنها لنگرِ ممکنِ این جمله واژه‌ی «chance» است: نه نامِ کارتی دارد، نه چیزی از حافظه.
  l.pattern = 'What sits in front of you is a real chance, not a gamble.';
  const r = run(l, qctx);
  ok(!r.anchor.samples.some((x) => /real chance/.test(x)),
    'ریشه‌یابی مفرد و جمع را به هم نرساند: «chance» در برابرِ «chances» بی‌لنگر شمرده شد');
  // کنترلِ معکوس: همان جمله بدونِ هیچ لنگری باید بی‌لنگر شمرده شود، وگرنه ادعا پوچ است.
  const l2 = healthy();
  l2.pattern = 'What sits in front of you is a real doorway, not a gamble.';
  ok(run(l2, qctx).anchor.samples.some((x) => /real doorway/.test(x)),
    'کنترلِ معکوس: جمله‌ی واقعاً بی‌لنگر بی‌لنگر شمرده نشد');
}

/* ۱۱ج) 🃏 نامِ کارت با حرفِ کوچک هم لنگر است.
 *
 * 🐛 باگی که این ادعا برایش نوشته شد: دو سرِ تطبیقِ نامِ کارت **نامتقارن** بودند —
 * سمتِ نامِ کارت فهرستِ ایست را اعمال نمی‌کرد و سمتِ جمله می‌کرد. برای فارسی و روسی
 * بی‌اثر بود (نامِ کارت حرفِ تعریف ندارد) ولی در انگلیسی «The Fool» ریشه‌های
 * `[the, fool]` می‌داد و چون `the` از سمتِ جمله حذف شده بود، مسیرِ ریشه برای بیشترِ
 * آرکانای بزرگ **ساختاراً** مرده بود. تنها چیزی که پنهانش می‌کرد مسیرِ تطبیقِ عینی
 * بود، که حساس به حروفِ بزرگ است — پس همین که مدل «the Fool» می‌نوشت، جمله‌ای که
 * صریحاً نامِ کارت را برده بود «بی‌لنگر» شمرده می‌شد.
 *
 * ⚠️ فیکسچر عمداً حرفِ **کوچک** دارد: با «The Fool» مسیرِ عینی جواب می‌دهد و باگ
 * پنهان می‌ماند (همان چیزی که یک دور پنهانش کرده بود). */
{
  const l = healthy();
  // تنها لنگرِ ممکنِ این جمله نامِ کارت است: نه واژه‌ای از سؤال دارد نه از حافظه.
  l.pattern = 'What the fool keeps pointing at is the edge, not the fall.';
  ok(!run(l).anchor.samples.some((x) => /keeps pointing/.test(x)),
    'نامِ کارت با حرفِ کوچک («the fool») لنگر شمرده نشد');
  // کنترلِ معکوس: جمله‌ای با همان شکل ولی بدونِ نامِ کارت باید بی‌لنگر بماند.
  const l2 = healthy();
  l2.pattern = 'What the shadow keeps pointing at is the edge, not the fall.';
  ok(run(l2).anchor.samples.some((x) => /keeps pointing/.test(x)),
    'کنترلِ معکوس: جمله‌ی بدونِ نامِ کارت لنگردار شمرده شد');
}

// ۱۰) دیوارِ متن در چیدمانِ بزرگ، با کنترلِ معکوس
{
  const big = locSpread(SPREAD_BY_ID.personal10);
  const bc = ['m00', 'c03', 'p09', 's05', 'w02', 'm13', 'c07', 'p03', 's10', 'w08'].map((k) => ({ key: k, reversed: false }));
  const bl = L.prompts.cardLabels(bc.length);
  const mk = (reads) => {
    const llm = {
      headline: 'Yes, Berlin is likely, but it costs you the safety you have now.',
      pattern: `${cardName('m00')} and ${cardName('c03')} both point at Berlin.`,
      callback: '', reads, closing: `Berlin opens within two months, but only if ${cardName('m00')} gets a yes soon.`,
      cards: bc.map(() => ({ teaser: 'A scene.' })), summary: 's', memory: 'm',
    };
    return checkReading({ llm, rendered: renderV4(llm, bc, bl, { name: 'Anna' }), spread: big, cards: bc, ctx, L });
  };
  const wall = bc.map((c) => `${cardName(c.key)} says the Berlin offer keeps asking you the same question over and over, and every time you look at it the answer stays the one you already knew before you opened this spread at all, which is why it keeps coming back.`);
  ok(issue(mk(wall), /هر کارت \d+ کاراکتر/) === 1, 'دیوارِ متنِ چیدمانِ بزرگ گرفته نشد');
  ok(issue(mk(bc.map((c) => `${cardName(c.key)} says Berlin.`)), /هر کارت \d+ کاراکتر/) === 0,
    'کنترلِ معکوس: خوانشِ کوتاهِ چیدمانِ بزرگ قرمزِ کاذب گرفت');
}

console.log(JSON.stringify({ pass, fails }));
process.exit(fails.length ? 1 : 0);
