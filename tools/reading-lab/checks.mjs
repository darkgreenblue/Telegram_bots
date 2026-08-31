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
import { headlineOk, evasionIn, pastTimeIn } from '../../bots/tarot/verdict.js';
import { readText, v4Text, cardName, positionName } from '../../bots/tarot/reading-core.js';

/* 🌍 دادهٔ زبانیِ سنجه‌ها از `lang/<locale>.mjs` می‌آید (بند ۲و).
 *
 * ⚠️ چرا این‌جا و نه در locale محصول: این‌ها به کاربر نمی‌رسند. سخت‌گیریِ تست باید
 * مستقل از متنِ محصول قابلِ تنظیم باشد، وگرنه هر بار که پرامپت را عوض می‌کنیم
 * ناخواسته معیارِ سنجش را هم عوض کرده‌ایم و مقایسه‌ی بین دورها بی‌معنی می‌شود.
 *
 * ⚠️ و چرا **fallback به فارسی نداریم**: یک اجرای روسی با سنجه‌های فارسی همه‌چیز را
 * سبز می‌داد (هیچ «شما»یی در متنِ روسی نیست) و ما فکر می‌کردیم روسی بی‌ایراد است.
 * نبودِ فایلِ زبان باید بلند شکست بخورد، نه بی‌صدا سبز شود. */
const LANG_CODE = process.env.LOCALE?.trim() || 'fa';
const LANG = (await import(`./lang/${LANG_CODE}.mjs`)).default;

const FORMAL = LANG.formal;
const PLURAL_COUPLE = LANG.pluralCouple;
// جمله‌ای که سنجه رویش گیر کرده را جدا می‌کند تا استثنا **در همان جمله** بررسی شود،
// نه در کلِ متن (وگرنه یک «رابطه‌تون» در جای دیگر کلِ فال را معاف می‌کرد).
function sentenceAround(text, idx) {
  const start = Math.max(0, text.lastIndexOf('\n', idx), text.lastIndexOf('.', idx));
  let end = text.length;
  for (const ch of ['.', '\n', '؟', '!']) {
    const j = text.indexOf(ch, idx);
    if (j !== -1 && j < end) end = j;
  }
  return text.slice(start, end + 1);
}
// عبارت‌هایی که پرامپت صریحاً ممنوعشان کرده (جمله‌ی بی‌جهت)
// ⚠️ این لیست قبلاً **یک** چیز بود و دو چیزِ متفاوت را قاطی می‌کرد. تفکیکشان از
// سؤالِ مالک درآمد: «واقعاً ممنوع‌اند یا فقط ایده‌آل نیستند؟»
//   طفره‌رفتن  → قولِ اصلیِ محصول را می‌شکند («جوابی که می‌خواستم رو نگرفتم»). ایراد.
//   لحنی       → فقط واژه‌ی عمومیِ نامطلوب است. نکته، نه ایراد؛ ارزشِ بازتولید ندارد.
// منبعِ حقیقتِ دسته‌ی اول خودِ `verdict.js` است تا سنجه و گاردِ ربات یکی بمانند.
const REGISTER = LANG.register;
// اشاره‌ی زمانی به **گذشته** ممنوعِ مطلق است. تاریخچه‌ی این تصمیم مهم است: اول داده‌ی
// دقیقِ زمان به مدل دادیم، بعد قاعده‌ی پرامپت، بعد قاعده‌ی سراسری — و هر بار مدل یک
// راهِ تازه برای ساختنِ زمان پیدا کرد. حالا خودِ داده حذف شده و قاعده یک‌خطی است، پس
// این سنجه هم دیگر لازم نیست چیزی را با «زمانِ واقعی» مقایسه کند: هر واژه‌ی زمانِ
// گذشته در متن = ایراد. (بازه‌ی آینده مثل «تا آخر این فصل» عمداً در لیست نیست.)

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

export const words = (s) => String(s || '').replace(/[‌]/g, ' ').split(/\s+/).filter(Boolean);
export const ngrams = (s, n) => { const w = words(s), out = []; for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' ')); return out; };

// متنِ خامِ مدل (بدونِ نشانه‌های بخش که خودِ ما اضافه می‌کنیم).
// از هسته می‌آید تا سنجه و گاردِ ربات **عیناً** یک متن را ببینند.
export const modelText = v4Text;

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
const STOP = new Set(LANG.stop);
const contentWords = (s) => words(s).map(w => w.replace(/[،.؛:!؟«»(),;:"'?!]/g, ''))
  .filter(w => w.length >= LANG.minWordLen && !STOP.has(w));

// جمله‌های فارسی: نقطه، علامت سؤال، و خطِ جدید. «؛» و «،» جمله را نمی‌شکنند.
const sentences = (t) => String(t || '').split(/[.!؟?\n]+/).map(x => x.trim()).filter(x => words(x).length >= 4);

export function anchorScore({ llm, cards, ctx }) {
  // 🌍 نامِ کارت از هسته می‌آید نه از `CARD_BY_KEY[..].fa`، وگرنه روی هر زبانِ
  // غیرفارسی این سنجه همیشه صفر می‌داد (مدلِ روسی «Шут» می‌نویسد نه «دیوانه»).
  const cardNames = cards.map(c => cardName(c.key));
  const qWords = new Set(contentWords(ctx.question));
  const memWords = new Set([...contentWords(ctx.memory),
    ...(ctx.previous || []).flatMap(p => contentWords(p[LANG.summaryKey]))]);

  // فقط متنِ **تفسیری** سنجیده می‌شود. تیزرها عمداً بیرون‌اند: کارشان معرفیِ خودِ کارت
  // است و طبیعتاً عمومی‌اند؛ انداختنشان در این شمارش عدد را بی‌معنی می‌کرد.
  const body = [llm.headline, llm.pattern, llm.callback, llm.closing,
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
  if (fm) {
    const sent = sentenceAround(raw, fm.index);
    // خودِ جمله هم چاپ می‌شود: سه دور پیاپی همین سنجه روی فالِ عشق قرمز کرد و
    // بدونِ دیدنِ جمله نمی‌شد فهمید «شما»ی جمعِ درست است یا خطابِ رسمیِ واقعی.
    // ⚠️ شماره‌ی گروه بین زبان‌ها یکی نیست (الگوی روسی از گروهِ غیرگیرنده استفاده
    // می‌کند)، پس اولین گروهِ موجود برداشته می‌شود نه یک ایندکسِ ثابت.
    const word = (fm[2] || fm[1] || fm[0]).trim();
    if (!PLURAL_COUPLE.test(sent)) issues.push(`لحنِ رسمی: «${word}» در «${sent.trim().slice(0, 120)}»`);
  }

  // ۳) خط تیره: باید در متنِ نهایی صفر باشد (noDash تضمینش می‌کند)
  if (/—|--/.test(full)) issues.push('خط تیره در متنِ نهایی مانده (noDash کار نکرده)');

  // ۳ب) نویسه‌ی بیگانه در متنِ همان زبان (فعلاً فقط روسی: CJK، لاتین، فارسی).
  // این ارزان‌ترین گاردِ ممکن است برای پرگزارش‌ترین خرابیِ مدل‌های چینی روی روسی.
  for (const a of (LANG.alien || [])) {
    const hit = full.match(a.re);
    if (hit) issues.push(`${a.label}: «${hit[0]}»`);
  }

  // ۳ج) نشانه‌گذاریِ مارک‌داون. کد از v3.40 پاکش می‌کند، ولی **تولیدش** را می‌شماریم:
  // اگر نرخش بالا باشد یعنی پرامپت دارد شکست می‌خورد و باید درست شود، نه فقط جاروب.
  // روی متنِ **خام** سنجیده می‌شود چون متنِ نهایی از قبل تمیز شده.
  if (/\*\*.+?\*\*|__.+?__|`|^\s{0,3}#{1,6}\s/m.test(raw)) {
    notes.push('مدل مارک‌داون تولید کرد ولی کد پاکش کرد');
  }

  // ۳د) صرفِ جنسیت‌دار خطاب به کاربر (فعلاً فقط روسی).
  // ⚠️ این ایراد در فارسی **وجود ندارد** چون فارسی فعل را صرفِ جنسیت نمی‌کند؛ پس
  // هیچ‌کدام از ۱۶ دورِ فارسی نمی‌توانست پیدایش کند. مدل جنسیتِ کاربر را ندارد، پس هر
  // فعلِ گذشته‌ی جنسیت‌دار خطاب به او یک **حدس** است که در نیمی از مواقع غلط است.
  if (LANG.genderedPast) {
    const g = raw.match(LANG.genderedPast);
    if (g) issues.push(`صرفِ جنسیت‌دار خطاب به کاربر: «${g[0].trim()}»`);
  }
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
  for (const [i, p] of spread.positions.entries()) {
    const nm = positionName(p.fa, i);
    if (nm.length >= 4 && full.includes(nm)) notes.push(`نامِ جایگاه «${nm}» در متن آمده`);
  }

  // ۶) عبارت‌های ممنوع و ایموجیِ مدل
  const ev = evasionIn(raw);
  if (ev) issues.push(`طفره‌رفتن: «${ev}»`);
  for (const r of REGISTER) if (raw.includes(r)) notes.push(`واژه‌ی لحنیِ نامطلوب: «${r}»`);
  const em = raw.match(EMOJI);
  if (em) notes.push(`مدل ایموجی گذاشت: ${em[0]}`);

  // ۷) هیچ اشاره‌ی زمانیِ گذشته‌ای مجاز نیست (داده‌اش را اصلاً به مدل نمی‌دهیم)
  const pt = pastTimeIn(raw);
  if (pt) issues.push(`اشاره‌ی زمانی به گذشته: «${pt}»`);
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
  const named = cards.filter(c => full.includes(cardName(c.key))).length;
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

