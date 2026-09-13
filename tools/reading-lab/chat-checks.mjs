// سنجه‌های مکانیکیِ «گفتگوی پس از فال» — ماژولِ خالص، بدونِ شبکه و بدونِ مدل.
//
// چرا جداست (همان دلیلِ `checks.mjs`): تا وقتی سنجه داخلِ اسکریپتِ آزمایشگاه باشد،
// تنها راهِ اجرا شدنش یک دورِ **پولی** است؛ یعنی خودِ لایه‌ی سنجش هیچ تستی ندارد و
// اولین `ReferenceError` وسطِ یک دورِ واقعی بیرون می‌زند (درسِ ثبت‌شده‌ی `headlineOk`
// که ۴۵ ریکوئست را سوزاند). این‌جا خالص است، پس `--fake` و چکِ CI می‌توانند بدوانندش.
//
// ⚠️ قاعده‌ی صفرِ این فایل: **هیچ منطقی از `chat-core.js` این‌جا بازنویسی نمی‌شود.**
// قلاب، لیستِ chatbait و نرمال‌سازی همه از همان `hookOk`ِ محصول می‌آیند. اگر سنجه
// کپیِ خودش را داشته باشد، دیر یا زود چیزی را سبز گزارش می‌کند که ربات ردش می‌کند
// (درسِ گافِ تیزر و `v4Text`).
//
// قاعده‌ی دوم: همه‌ی این‌ها **قطعی** اند. قضاوتِ سلیقه‌ای کارِ `chat-rubric.mjs` و
// خودِ سشن است، نه این فایل.
import { ngrams } from './checks.mjs';
import { hookOk } from '../../bots/tarot/chat-core.js';

/* 🌍 دادهٔ زبانیِ سنجه‌ها از همان `lang/<locale>.mjs`ِ آزمایشگاهِ خوانش می‌آید، نه یک
 * کپیِ تازه: الگوی «لحنِ رسمی» و استثنای «جمعِ واقعی» یک بار در همان‌جا تصحیح شده‌اند
 * (دورِ هفتم و دورِ ۱۴۰۵/۰۶/۱۰) و دو نسخه‌ی جدا دوباره واگرا می‌شوند.
 * ⚠️ و عمداً به فارسی fallback نمی‌کند: یک دورِ روسی با الگوهای فارسی همه‌چیز را سبز
 * می‌داد و ما فکر می‌کردیم بی‌ایراد است. نبودِ فایل باید بلند شکست بخورد. */
const LANG_CODE = process.env.LOCALE?.trim() || 'fa';
const LANG = (await import(`./lang/${LANG_CODE}.mjs`)).default;

// هدفِ طولِ جواب، عیناً از پرامپت: «۲ تا ۶ خطِ کوتاه».
export const LINE_MIN = 2;
export const LINE_MAX = 6;

export const linesOf = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);

// جمله‌ای که سنجه رویش گیر کرده را جدا می‌کند تا استثنا **در همان جمله** بررسی شود،
// نه در کلِ متن (وگرنه یک «رابطه‌تون» در جای دیگر کلِ جواب را معاف می‌کرد).
function sentenceAround(text, idx) {
  const start = Math.max(0, text.lastIndexOf('\n', idx), text.lastIndexOf('.', idx));
  let end = text.length;
  for (const ch of ['.', '\n', '؟', '!']) {
    const j = text.indexOf(ch, idx);
    if (j !== -1 && j < end) end = j;
  }
  return text.slice(start, end + 1);
}

const FORMAL_G = LANG.formal
  ? new RegExp(LANG.formal.source, LANG.formal.flags.includes('g') ? LANG.formal.flags : `${LANG.formal.flags}g`)
  : null;

/* 🔎 «خطِ اول خودِ جواب است» — قاعده‌ی صریحِ پرامپت («خطِ اول باید خودِ جواب باشد،
 * نه مقدمه و نه بازگوییِ سؤال»). سه شکلِ شکست، همه بدونِ ابهام:
 *   ۱) خطِ اول خودش یک **سؤال** است (مدل به‌جای جواب دوباره می‌پرسد)،
 *   ۲) با یک **مقدمه‌ی** شناخته‌شده شروع می‌شود،
 *   ۳) سؤالِ کاربر را **بازگو** می‌کند (یک ۴کلمه‌ایِ مشترک با سؤال).
 * عمداً تنگ است: قاعده‌ی پهن روی خروجیِ سالم قرمزِ کاذب می‌دهد و بندِ ۲و/۶ب-۲ ریشه
 * می‌گوید گاردِ پرسروصدا همان‌قدر بی‌فایده است که گاردِ ساکت. */
const PREAMBLE = /^(خب|خُب|ببین|راستش|بذار|بگذار|اجازه بده|قبل از|اول از همه|در مورد|درباره‌ی|درباره ی|در پاسخ|در جواب|سؤالت|سوالت|این سؤال|این سوال|بریم سراغ)/;

function firstLineAnswers(reply, question) {
  const lines = linesOf(reply);
  const first = lines[0] || '';
  if (!first) return { ok: false, why: 'empty' };
  if (/[؟?]\s*$/.test(first)) return { ok: false, why: 'question' };
  if (PREAMBLE.test(first)) return { ok: false, why: 'preamble' };
  const qg = new Set(ngrams(question, 4));
  if (qg.size && ngrams(first, 4).some((g) => qg.has(g))) return { ok: false, why: 'restates' };
  return { ok: true, why: '' };
}

/**
 * سنجه‌های یک نوبتِ گفتگو.
 * @param reply متنِ **پاک‌شده** (همان چیزی که کاربر می‌بیند؛ خروجیِ `cleanChatReply`)
 * @param raw   متنِ خامِ مدل، فقط برای شمردنِ چیزی که کد پاکش کرده (خط تیره)
 */
export function chatMetrics({ reply, raw = '', cardNames = [], questionWords = [], question = '' }) {
  const issues = [], notes = [];
  const anchors = { cardNames, questionWords };
  const lines = linesOf(reply);
  const chars = String(reply || '').length;

  // ۱) قلابِ خطِ آخر — **همان تابعی** که ربات هم لاگش می‌کند.
  const hook = hookOk(reply, anchors);
  if (!hook.ok) issues.push(`قلابِ خطِ آخر: ${hook.why}${hook.hit ? ` («${hook.hit}»)` : ''}`);

  /* ۲) chatbait در **هر** خط، نه فقط خطِ آخر. `hookOk` روی یک خطِ تنها همان لیست و
   * همان نرمال‌سازیِ chat-core را اجرا می‌کند و chatbait را قبل از هر شرطِ دیگری
   * برمی‌گرداند، پس این شمارش صفر منطقِ تازه دارد. */
  const bait = lines.filter((ln) => hookOk(ln, anchors).why === 'chatbait');
  if (bait.length) issues.push(`قلابِ توخالی در ${bait.length} خط: «${bait[0].slice(0, 60)}»`);

  // ۳) خطابِ رسمی. قاعده‌ی پرامپت: «همیشه تو، هرگز شما».
  const formal = [];
  if (FORMAL_G) {
    FORMAL_G.lastIndex = 0;
    let m;
    while ((m = FORMAL_G.exec(reply))) {
      const sent = sentenceAround(reply, m.index);
      // استثنای «جمعِ واقعی» (رابطه‌تون، هر دوتون…) — همان استثنای ثبت‌شده‌ی checks.mjs.
      if (LANG.pluralCouple && LANG.pluralCouple.test(sent)) continue;
      formal.push((m[2] || m[1] || m[0]).trim());
      if (m.index === FORMAL_G.lastIndex) FORMAL_G.lastIndex++;   // گاردِ حلقه‌ی بی‌پایان
    }
  }
  if (formal.length) issues.push(`لحنِ رسمی: «${formal[0]}»`);

  /* ۳ب) لحنِ **کتابی** (گفتاری در برابر نوشتاری). این با بندِ ۳ یکی نیست و آن را
   * پوشش نمی‌دهد: «شما» خطابِ رسمی است، ولی «می‌کند» خطاب نیست، صرفِ نوشتاری است و
   * با «تو» هم می‌آید («تو باید تصمیم بگیری که او مسئولیت را نشان می‌دهد»).
   *
   * 🐛 چرا اضافه شد: دورِ ۱ (۱۴۰۵/۰۶/۲۲) با **همه‌ی** آستانه‌های فاز ۱ سبز تمام شد،
   * ولی خواندنِ چشمیِ همان ۱۵ نوبت نشان داد **۷ تا** وسطِ جواب به فارسیِ کتابی
   * می‌لغزند («شاه سکه آینده را باز می‌گذارد»، «کارت‌ها وقوعِ خبر بد را تأیید
   * نمی‌کنند»)، و بدتر اینکه لغزش **داخلِ یک جواب** است، پس متن مثل نوشته‌ی دو نفر
   * خوانده می‌شود. این مستقیماً خواسته‌ی مرکزیِ مالک را نقض می‌کند («لحن عیناً لحنِ
   * بهینه‌شده‌ی فال»).
   *
   * ⚠️ و ریشه‌اش ابزار بود نه مدل (بند ۹/۰ب): سنجه‌ی `bookish` از ۱۶ دورِ آزمایشگاهِ
   * خوانش در `lang/fa.mjs` **وجود داشت** و هرگز این‌جا صدا زده نمی‌شد. پس سبزیِ دور ۱
   * از «نبودِ قرمز» آمده بود نه از سلامت (بند ۶ب-۲ ریشه). آستانه و الگو عمداً همان
   * `lang/<locale>.mjs` است تا دو آزمایشگاه یک تعریف داشته باشند. */
  const bookish = [];
  if (LANG.bookish?.re) {
    const re = new RegExp(LANG.bookish.re.source, LANG.bookish.re.flags.includes('g')
      ? LANG.bookish.re.flags : `${LANG.bookish.re.flags}g`);
    let m;
    while ((m = re.exec(reply))) {
      bookish.push(m[0].trim());
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  const bookishMin = LANG.bookish?.min ?? 3;
  if (bookish.length >= bookishMin) {
    issues.push(`لحنِ کتابی (${bookish.length}×): «${bookish.slice(0, 3).join('»، «')}»`);
  }

  /* ۳ج) اکوی **برچسبِ خودِ پرامپت** در خطِ آخر.
   *
   * 🐛 دورِ ۱: ۱۱ تا از ۱۵ خطِ آخر با همان کلمه‌ای ساخته شده بودند که تیترِ بلوکِ
   * پرامپت است («خطِ آخر: یک درِ باز») — «زاویه‌ی بازِ فال اینه که…»، «درِ بازِ این
   * فال…»، «بخشِ هنوزبازِ ماجرا…». هیچ‌کدام chatbait نبودند و `hookOk` همه را سبز
   * داد، چون واقعاً لنگر داشتند؛ ولی قلاب به یک **قالب** تبدیل شده بود و پرامپت
   * صریح می‌گوید «نوعِ این جمله را هر نوبت عوض کن».
   *
   * این دقیقاً همان کلاسِ خطای ثبت‌شده‌ی `labelLeak` است (مدل به‌جای **انجامِ** کار،
   * خودِ برچسب را چاپ می‌کند) که پرامپت برای «نشونه‌ات اینه» بسته بود و برای قلاب
   * نبسته بود. سنجه روی خطِ آخر است، نه کلِ جواب: «در باز» وسطِ متن معنیِ عادی دارد. */
  const last = lines[lines.length - 1] || '';
  const labelEcho = LANG.hookLabel ? (last.match(LANG.hookLabel)?.[0] || '').trim() : '';
  if (labelEcho) issues.push(`اکوی برچسبِ قلاب: «${labelEcho}»`);

  // ۴) خط تیره‌ی بلند (بند ۱۰ ریشه). روی متنِ نهایی **ایراد** است، روی متنِ خام فقط
  //    یک نکته — چون `cleanChatReply` پاکش می‌کند ولی تولیدش یعنی پرامپت دارد می‌لغزد.
  const dashes = (String(reply).match(/—|--/g) || []).length;
  const dashesRaw = (String(raw || '').match(/—|--/g) || []).length;
  if (dashes) issues.push('خط تیره در متنِ نهایی مانده (noDash کار نکرده)');
  else if (dashesRaw) notes.push('مدل خط تیره تولید کرد ولی کد پاکش کرد');

  // ۵) حداکثر یک علامتِ سؤال در کلِ جواب (قاعده‌ی صریحِ پرامپت).
  const qmarks = (String(reply).match(/[؟?]/g) || []).length;
  if (qmarks > 1) issues.push(`${qmarks} علامتِ سؤال در یک جواب (سقف: ۱)`);

  // ۶) خطِ اول = خودِ جواب.
  const firstLine = firstLineAnswers(reply, question);
  if (!firstLine.ok) issues.push(`خطِ اول جواب نیست (${firstLine.why})`);

  /* ۷) طول: **عدد** است نه ایراد. توزیعش را گزارش می‌کنیم چون پرامپت عمداً طولِ ثابت
   * را ممنوع کرده («طول را با خودِ سؤال تنظیم کن»)، پس یک جوابِ ۷خطی به سؤالِ چندلایه
   * لزوماً غلط نیست؛ چیزی که غلط است **یکنواختیِ** طول در کلِ گفتگوست. */
  if (lines.length < LINE_MIN || lines.length > LINE_MAX) {
    notes.push(`${lines.length} خط (هدف ${LINE_MIN} تا ${LINE_MAX})`);
  }

  return { lines: lines.length, chars, hook, chatbait: bait.length, formal, bookish, labelEcho,
    dashes, dashesRaw, qmarks, firstLine, issues, notes };
}

/**
 * ۶کلمه‌ای‌هایی که در **بیش از یک** آیتم آمده‌اند.
 *
 * مهم‌ترین سنجه‌ی این آزمایشگاه، دقیقاً مثل آزمایشگاهِ خوانش: یک جوابِ تنها هرگز
 * نشتِ few-shot یا قالبی‌شدن را لو نمی‌دهد؛ فقط کنارِ هم گذاشتنِ چند نوبت (و چند
 * پرسونا) نشان می‌دهد کدام جمله دارد تکرار می‌شود. `ngrams` عمداً از `checks.mjs`
 * می‌آید تا شمارش در دو آزمایشگاه یک تعریف داشته باشد.
 *
 * @param items [{ key, text }]
 */
export function repeatedNgrams(items, n = 6) {
  const seen = new Map();
  for (const it of items) {
    for (const g of new Set(ngrams(it.text, n))) {
      if (!seen.has(g)) seen.set(g, new Set());
      seen.get(g).add(it.key);
    }
  }
  return [...seen.entries()]
    .filter(([, s]) => s.size > 1)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([g, s]) => [g, [...s]]);
}
