// سنجه‌های مکانیکیِ خروجیِ خوانش — ماژولِ خالص و بدونِ شبکه.
//
// چرا جداست: تا وقتی داخلِ `reading-lab.mjs` بود، تنها راهِ اجرا شدنش یک اجرای کاملِ
// پولی بود؛ یعنی خودِ لایه‌ی سنجش هیچ تستی نداشت. نتیجه‌اش یک کرشِ واقعی شد که کلِ
// اجرای دوم را کشت (`labels[i]` تعریف‌نشده وقتی متنِ کارت خطِ جدید داشت) و در CI هم
// دیده نشد چون حالتِ `--dry` اصلاً این‌جا را صدا نمی‌زند.
// حالا `tools/check-reading-lab.mjs` با ورودیِ ساختگی و بدونِ هیچ فراخوانی تستش می‌کند.
//
// قاعده: همه‌ی این‌ها **قطعی** اند — یا رد می‌شوند یا نمی‌شوند. قضاوتِ سلیقه‌ای جای
// دیگری است (هرچه بتوان مکانیکی سنجید نباید به چشمِ آدم سپرده شود).
import { CARD_BY_KEY } from '../../bots/tarot/cards.js';
import { headlineOk } from '../../bots/tarot/verdict.js';
import { readText } from '../../bots/tarot/reading-core.js';

// خطابِ رسمی. نمونه‌های واقعیِ انسانی ۱۰۰٪ «تو» اند و پرامپت هم قفلش کرده.
const FORMAL = /(^|[\s،.؛:!؟(])(شما|شمارو|بفرمایید|بفرمائید|می‌کنید|میکنید|می‌بینید|می‌دانید|می‌دونید که شما|دارید|هستید|باشید|کنید|نمایید|بدانید|خواهید)([\s،.؛:!؟)]|$)/;
// عبارت‌هایی که پرامپت صریحاً ممنوعشان کرده (جمله‌ی بی‌جهت)
const BANNED = ['بستگی به خودت داره', 'بستگی داره', 'به شهودت اعتماد کن', 'کائنات',
  'شاید آره شاید نه', 'هم این باشه هم اون', 'فقط خودت می‌دونی'];
// اشاره‌ی زمانی به **گذشته** ممنوعِ مطلق است. تاریخچه‌ی این تصمیم مهم است: اول داده‌ی
// دقیقِ زمان به مدل دادیم، بعد قاعده‌ی پرامپت، بعد قاعده‌ی سراسری — و هر بار مدل یک
// راهِ تازه برای ساختنِ زمان پیدا کرد. حالا خودِ داده حذف شده و قاعده یک‌خطی است، پس
// این سنجه هم دیگر لازم نیست چیزی را با «زمانِ واقعی» مقایسه کند: هر واژه‌ی زمانِ
// گذشته در متن = ایراد. (بازه‌ی آینده مثل «تا آخر این فصل» عمداً در لیست نیست.)
const PAST_TIME = /(پارسال|سالِ? ?(پیش|گذشته)|سال‌ها پیش|ماهِ? ?(پیش|گذشته)|ماه‌ها پیش|ماه‌های قبل|هفتهٔ? ?(پیش|گذشته)|هفته‌ی (پیش|گذشته)|هفته‌ها پیش|هفته‌های قبل|روزهای قبل|چند وقت پیش|دفعه‌ی قبل که|بارِ? قبل که)/;

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

export const words = (s) => String(s || '').replace(/[‌]/g, ' ').split(/\s+/).filter(Boolean);
export const ngrams = (s, n) => { const w = words(s), out = []; for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' ')); return out; };

// متنِ خامِ مدل (بدونِ نشانه‌های بخش که خودِ ما اضافه می‌کنیم)
export function modelText(llm) {
  return [llm.headline, llm.pattern, llm.callback, llm.absent, llm.closing,
    ...(llm.reads || []).map(readText), ...(llm.cards || []).map(c => c?.teaser)]
    .filter(Boolean).join('\n');
}

// ═══ سنجه‌ی «جمله‌ی بی‌لنگر» — ابزارِ اندازه‌گیریِ Barnum ═══
//
// چرا لازم شد: بقیه‌ی سنجه‌ها **وجود یا نبودِ** چیزی را می‌بینند و به سقفشان خورده‌اند.
// هیچ‌کدام نمی‌تواند بگوید «این جمله عمومی است». جمله‌ای مثل «تواناییِ خلقِ چیزهای زیبا
// رو داری» از همه‌ی چک‌ها رد می‌شود، ولی دقیقاً همان چیزی است که تحقیق ۱ دلیلِ شماره‌یکِ
// رهاکردن می‌داند و تستِ کپیِ ما را رد می‌کند.
//
// ایده: هر جمله‌ی خوب باید به چیزی **مخصوصِ همین فال** گره خورده باشد. سه لنگرِ ممکن:
//   ۱) نامِ یکی از کارت‌های کشیده‌شده
//   ۲) کلمه‌ای محتوایی از سؤالِ خودِ کاربر
//   ۳) چیزی از شناختِ قبلی (حافظه/خلاصه‌ی فال‌های قبل)
// جمله‌ای که به هیچ‌کدام نخورد، جمله‌ای است که می‌شود عیناً برای هر کسِ دیگری فرستاد.
// نرخش را می‌شماریم؛ عدد است، نه سلیقه.
const STOP = new Set(['که','این','اون','برای','از','با','رو','به','تو','یه','یک','هم','هست',
  'می','نمی','های','ها','در','و','یا','تا','چه','چی','ولی','اما','اگه','اگر','خیلی','بیشتر',
  'الان','حالا','باید','شاید','همه','چون','وقتی','کنم','کنی','کنه','بشه','شده','بود','دارم',
  'داری','داره','می‌کنم','می‌کنی','می‌شه','می‌تونی','خودت','خودم','بهش','براش','منم','نه','بله']);

const contentWords = (s) => words(s).map(w => w.replace(/[،.؛:!؟«»()"']/g, ''))
  .filter(w => w.length >= 4 && !STOP.has(w));

// جمله‌های فارسی: نقطه، علامت سؤال، و خطِ جدید. «؛» و «،» جمله را نمی‌شکنند.
const sentences = (t) => String(t || '').split(/[.!؟?\n]+/).map(x => x.trim()).filter(x => words(x).length >= 4);

export function anchorScore({ llm, cards, ctx }) {
  const cardNames = cards.map(c => CARD_BY_KEY[c.key].fa);
  const qWords = new Set(contentWords(ctx.question));
  const memWords = new Set([...contentWords(ctx.memory),
    ...(ctx.previous || []).flatMap(p => contentWords(p['خلاصه']))]);

  // فقط متنِ **تفسیری** سنجیده می‌شود. تیزرها عمداً بیرون‌اند: کارشان معرفیِ خودِ کارت
  // است و طبیعتاً عمومی‌اند؛ انداختنشان در این شمارش عدد را بی‌معنی می‌کرد.
  const body = [llm.headline, llm.pattern, llm.callback, llm.absent, llm.closing,
    ...(llm.reads || []).map(readText)].filter(Boolean).join('\n');

  const all = sentences(body);
  const loose = all.filter((sent) => {
    if (cardNames.some(n => sent.includes(n))) return false;
    const w = contentWords(sent);
    if (w.some(x => qWords.has(x))) return false;
    if (w.some(x => memWords.has(x))) return false;
    return true;
  });
  return { total: all.length, loose: loose.length, pct: all.length ? Math.round(loose.length * 100 / all.length) : 0, samples: loose.slice(0, 3) };
}

export function checkReading({ llm, rendered, spread, cards, ctx, L }) {
  const issues = [], notes = [];
  const raw = modelText(llm);
  const full = [rendered.headline, rendered.body, rendered.closing].join('\n');

  // ۱) سرخط: همان گاردی که خودِ ربات اعمال می‌کند
  if (!headlineOk(llm.headline)) issues.push(`سرخط فرمول را ندارد: «${llm.headline}»`);

  // ۲) لحن
  const fm = raw.match(FORMAL);
  if (fm) issues.push(`لحنِ رسمی: «${fm[2]}»`);

  // ۳) خط تیره: باید در متنِ نهایی صفر باشد (noDash تضمینش می‌کند)
  if (/—|--/.test(full)) issues.push('خط تیره در متنِ نهایی مانده (noDash کار نکرده)');
  if (/—|--/.test(raw)) notes.push('مدل خط تیره تولید کرد ولی کد پاکش کرد');

  // ۴) برچسبِ کارت‌ها: هر برچسب دقیقاً یک بار و به ترتیب، بدونِ تکرارِ چسبیده.
  // ⚠️ «یک خط per کارت» فرضِ غلطی بود: متنِ خودِ مدل می‌تواند خطِ جدید داشته باشد و
  // آن‌وقت شمارشِ موقعیتی می‌شکند (کرشِ واقعیِ اجرای دوم). پس به‌جای موقعیت، **جای
  // هر برچسب** پیدا می‌شود و خطوطِ اضافه به‌عنوان ادامه‌ی متن پذیرفته می‌شوند.
  const labels = L.prompts.cardLabels(cards.length);
  const block = (rendered.body.split('\n\n').find(b => b.startsWith('🃏')) || '').replace(/^🃏\s*/, '');
  const lines = block.split('\n').filter(Boolean);
  if (!lines.length) issues.push(`بلوکِ کارت‌ها اصلاً نیامد (باید ${cards.length} کارت باشد)`);
  let cursor = -1;
  labels.forEach((lab, i) => {
    const at = lines.findIndex((ln, k) => k > cursor && ln.startsWith(lab));
    if (at < 0) { issues.push(`برچسبِ «${lab}» پیدا نشد`); return; }
    cursor = at;
    const rest = lines[at].slice(lab.length);
    if (/^\s*(?:و |اما |ولی )?کارت[ً-ْ]*[\s‌]*(اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|بعدی|آخر)/.test(rest))
      issues.push(`برچسبِ تکراری در «${lab}»: «${lines[at].slice(0, 40)}…»`);
    if (lines.slice(at + 1).some(ln => ln.startsWith(lab))) issues.push(`برچسبِ «${lab}» بیش از یک بار آمده`);
  });

  // ۵) نامِ جایگاه نباید در متن بیاید (پرامپت صریحاً گفته)
  for (const p of spread.positions) {
    if (p.fa.length >= 4 && full.includes(p.fa)) notes.push(`نامِ جایگاه «${p.fa}» در متن آمده`);
  }

  // ۶) عبارت‌های ممنوع و ایموجیِ مدل
  for (const b of BANNED) if (raw.includes(b)) issues.push(`عبارتِ ممنوع: «${b}»`);
  const em = raw.match(EMOJI);
  if (em) notes.push(`مدل ایموجی گذاشت: ${em[0]}`);

  // ۷) هیچ اشاره‌ی زمانیِ گذشته‌ای مجاز نیست (داده‌اش را اصلاً به مدل نمی‌دهیم)
  const pt = raw.match(PAST_TIME);
  if (pt) issues.push(`اشاره‌ی زمانی به گذشته: «${pt[0]}»`);
  // و اگر شناختِ قبلی هست، ارجاع باید وجود داشته باشد
  if ((ctx.previous || []).length && !String(llm.callback || '').trim())
    notes.push('شناختِ قبلی وجود داشت ولی هیچ ارجاعی به جلسه‌ی قبل نداد');
  if (!(ctx.previous || []).length && String(llm.callback || '').trim())
    issues.push('اولین فال است ولی به «جلسه‌ی قبل» ارجاع داد (توهم)');

  // ۸) تکرارِ تیزر در خوانشِ همان کارت (پرامپت: حرفی که در معرفی زدی را تکرار نکن)
  (llm.reads || []).forEach((r, i) => {
    const a = new Set(ngrams(llm.cards?.[i]?.teaser, 4));
    const dup = ngrams(readText(r), 4).filter(g => a.has(g));
    if (dup.length) notes.push(`خوانشِ کارت ${i + 1} تیزر را تکرار کرد: «${dup[0]}»`);
  });

  // ۹) لنگر: الگو باید نامِ خودِ کارت‌ها را ببرد (قلبِ «دلیلِ لنگرخورده»).
  // ⚠️ نامِ فارسیِ کارت روی `CARD_BY_KEY` است نه روی خروجیِ `drawCards` (که فقط
  // key و reversed دارد). نسخه‌ی اول `c.fa` را می‌خواند و همیشه undefined می‌گرفت،
  // پس این ادعا روی **هر ۹ فال** به‌غلط قرمز شد در حالی که لنگر درست کار می‌کرد.
  const named = cards.filter(c => full.includes(CARD_BY_KEY[c.key].fa)).length;
  if (named === 0) issues.push('هیچ کارتی در متن با نامِ خودش صدا زده نشد');
  else if (named < Math.min(2, cards.length)) notes.push(`فقط ${named} کارت با نامِ خودش صدا زده شد`);

  // ۱۰) اندازه: چیدمانِ بزرگ نباید دیوارِ متن بسازد
  const perCard = lines.length ? Math.round(block.length / lines.length) : 0;
  if (spread.size >= 6 && perCard > 220) issues.push(`هر کارت ${perCard} کاراکتر است (چیدمانِ بزرگ باید یک جمله باشد)`);

  // ۱۱) نرخِ جمله‌ی بی‌لنگر (Barnum). عمداً «ایراد» نیست، **عدد** است: آستانه‌اش را هنوز
  // نمی‌دانیم و تا وقتی چند دور اندازه نگرفته‌ایم، قرمزکردنش حدس است نه سنجش.
  const anchor = anchorScore({ llm, cards, ctx });
  if (anchor.pct >= 50) notes.push(`نیمی از جمله‌ها بی‌لنگرند (${anchor.loose}/${anchor.total})`);

  return { issues, notes, anchor, stats: { chars: full.length, perCard, named, cards: cards.length } };
}

