// تعمیرِ نقطه‌ایِ خروجی — به‌جای بازتولیدِ کلِ خوانش.
//
// چرا این فایل هست (تصمیمِ صریحِ مالک، ۱۴۰۵/۰۵/۲۷):
// وقتی خروجی یک ضعفِ غیرقابلِ‌چشم‌پوشی دارد (فعلاً: طفره‌رفتن)، نسخه‌ی قبلی کلِ فال را
// از اول تولید می‌کرد. سه ایراد داشت:
//   ۱) گران بود: ~۳۰۰۰ توکن ورودی + ~۱۲۰۰ خروجی برای عوض‌کردنِ یک جمله.
//   ۲) کند بود: ~۱۰ ثانیه انتظارِ اضافه برای کاربری که پول داده.
//   ۳) تضمینی نبود: همان پرامپت، همان احتمالِ خطا. یعنی ممکن بود دوباره همان را بدهد.
// حالا خروجیِ معیوب **ورودیِ** یک پرامپتِ کوچکِ تخصصی می‌شود که تنها کارش برداشتنِ
// همان ضعف است. ورودی‌اش فقط همان فیلدهای معیوب است، نه کلِ فال.
//
// قاعده‌های آهنین این مسیر:
//   • تشخیص **هاردکد** است (`evasionIn`)، نه یک فراخوانیِ LLM. هیچ فالی برای «فهمیدنِ
//     اینکه مشکل دارد» هزینه نمی‌دهد؛ فقط فالِ معیوب هزینه‌ی تعمیر می‌دهد.
//   • **دقیقاً یک** فراخوانیِ تعمیر. حلقه نداریم.
//   • شکستِ تعمیر هرگز خوانش را نمی‌شکند: متنِ اصلی برمی‌گردد.
//   • تعمیر فقط فیلدهای معیوب را عوض می‌کند؛ بقیه‌ی خوانش بیت‌به‌بیت دست‌نخورده می‌ماند.
import { evasionIn, pastTimeIn } from './verdict.js';
import { parseJsonLoose, readText, LANG_DATA } from './reading-core.js';
import { log, logErr } from '../../shared/logger.js';

// همه‌ی فیلدهای رو-به-کاربر، **دقیقاً همان‌هایی که `v4Text` می‌بیند**.
//
// ⚠️ نسخه‌ی اول تیزرها را عمداً کنار گذاشته بود («معرفیِ کارت‌اند، جوابی ندارند که
// ازش طفره بروند»). استدلال قشنگ بود و غلط: سنجه‌ی آزمایشگاه تیزرها را می‌دید و
// گارد نمی‌دید، پس در دورِ سیزدهم یک فال با «بستگی داره» رد شد بی‌آنکه تعمیر اصلاً
// شلیک کند. همان قانونی که در کامنتِ `v4Text` نوشته بودیم را خودمان شکسته بودیم:
// **گارد و سنجه باید عیناً یک متن را ببینند**، وگرنه یکی چیزی را می‌گیرد که آن یکی
// نمی‌بیند. هر فیلدی که به کاربر می‌رسد اینجا هم باید باشد.
//
// دو نوع ضعف تا امروز ارزشِ تعمیر دارند. هر دو **هاردکد** تشخیص داده می‌شوند و هر دو
// در **یک** فراخوانی با هم تعمیر می‌شوند — نه یکی یکی، وگرنه فالِ بدشانس دو بار
// معطل می‌شود. افزودنِ نوعِ سوم = یک ردیف در این آرایه، نه یک مسیرِ جدید.
export const DEFECTS = [
  {
    id: 'evasion',
    find: evasionIn,
    // متنِ راهنما برای همان تکه؛ کوتاه چون در ورودی تکرار می‌شود.
    // 🌍 از locale می‌آید (`hintOf`)؛ پیش‌فرضِ فارسی این‌جاست تا نبودِ locale چیزی نشکند.
    get hint() { return RLEX.hints.evasion; },
  },
  {
    id: 'pastTime',
    find: pastTimeIn,
    get hint() { return RLEX.hints.pastTime; },
  },
];

/* 🌍 ضعف‌های **مخصوصِ یک زبان** از `langdata.<locale>.json` می‌آیند.
 *
 * ⚠️ چرا کد و نه پرامپت: پرامپتِ روسی از قبل صریحاً می‌گوید «Всегда ты, никогда вы»
 * و «Не навязывай человеку пол». با این حال دورِ دومِ آزمایشگاه ۲ فال با «вы»ی رسمی و
 * ۳ فال با صرفِ جنسیت‌دار داد، یعنی **۵ از ۹**. این دقیقاً همان درسی است که ریپو سه
 * بار ثبت کرده (زمان، کارتِ نیامده، عبارت‌های ممنوع): قاعده‌ی پرامپتیِ تکرارشده جواب
 * نمی‌دهد و هرچه کد می‌تواند تضمین کند نباید به مدل سپرده شود. پس به‌جای لایه‌ی دومِ
 * وصله روی پرامپت، همان مکانیزمِ موجود یک ردیف بیشتر می‌گیرد.
 *
 * ⚠️ چرا برای فارسی خطر ندارد: فارسی فایلِ زبان ندارد، پس این آرایه خالی می‌ماند و
 * `DEFECTS` بیت‌به‌بیت همان دوتای قبلی است.
 *
 * `except` استثنای همان الگوست (مثلاً «вы» وقتی واقعاً دو نفر را خطاب می‌کند) و در
 * **همان جمله** سنجیده می‌شود، نه در کلِ متن؛ وگرنه یک استثنا در جای دیگر کلِ فال را
 * معاف می‌کرد. */
function sentenceAround(text, idx) {
  const start = Math.max(0, text.lastIndexOf('\n', idx), text.lastIndexOf('.', idx));
  let end = text.length;
  for (const ch of ['.', '\n', '؟', '?', '!']) {
    const j = text.indexOf(ch, idx);
    if (j !== -1 && j < end) end = j;
  }
  return text.slice(start, end + 1);
}

for (const d of (LANG_DATA.defects || [])) {
  let re, exceptRe = null;
  try {
    re = new RegExp(d.pattern, d.flags || '');
    // استثنا همیشه بی‌توجه به بزرگی/کوچکیِ حرف کامپایل می‌شود: عبارتِ «вы оба» در
    // ابتدای جمله «Вы оба» است و با فلگِ خودِ الگو (که ممکن است case-sensitive باشد)
    // رد می‌شد. اولین تستِ واقعی همین را گرفت.
    if (d.except) exceptRe = new RegExp(d.except, `${(d.flags || '').replace('i', '')}i`);
  } catch { continue; } // الگوی خراب فقط همان ردیف را حذف می‌کند، نه کلِ تعمیر را
  DEFECTS.push({
    id: d.id,
    hint: d.hint || '',
    find: (t) => {
      const m = String(t || '').match(re);
      if (!m) return null;
      if (exceptRe && exceptRe.test(sentenceAround(String(t), m.index))) return null;
      return m[0].trim();
    },
  });
}

export function findDefects(llm) {
  const hits = [];
  /* ⚠️ **همه‌ی** ضعف‌های یک فیلد با هم جمع می‌شوند، نه فقط اولی.
   *
   * 🐛 باگی که دورِ ۶ آزمایشگاهِ روسی لو داد: نسخه‌ی قبلی روی اولین ضعف `return`
   * می‌کرد، پس مدل فقط hintِ **یکی** را می‌دید؛ ولی `validate` پایین متنِ تعمیرشده
   * را در برابرِ **همه‌ی** انواع می‌سنجد. یعنی فیلدی که دو ضعف داشت تقریباً همیشه
   * شکست می‌خورد: مدل «вы» را برمی‌داشت، «Two of Cups» سرِ جایش می‌ماند، و تعمیر
   * رد می‌شد. عدد: از ۵ تعمیرِ شلیک‌شده‌ی آن دور **۳ تا ناموفق** بودند. خرابی هم
   * بی‌صداست چون متنِ اصلی تحویل می‌شود و کاربر هر دو ضعف را می‌گیرد.
   *
   * هر فیلد همچنان **یک** hit می‌دهد (وگرنه دو fix برای یک فیلد به هم می‌خورند و
   * `applyFixes` بر اساسِ ایندکس کار می‌کند)؛ فقط hint و عبارت‌ها با هم می‌آیند.
   * جداکننده عمداً خنثی است: ویرگولِ فارسی این‌جا یعنی یک نویسه‌ی بیگانه داخلِ
   * پرامپتِ روسی. */
  const push = (path, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    const found = [];
    for (const d of DEFECTS) {
      const phrase = d.find(t);
      if (phrase) found.push({ phrase, kind: d.id, hint: d.hint });
    }
    if (!found.length) return;
    hits.push({
      path, text: t,
      phrase: found.map((f) => f.phrase).join(' / '),
      kind: found.map((f) => f.kind).join('+'),
      hint: found.map((f) => f.hint).join(' '),
    });
  };
  push('headline', llm?.headline);
  push('pattern', llm?.pattern);
  push('callback', llm?.callback);
  push('closing', llm?.closing);
  (llm?.reads || []).forEach((r, i) => push(`reads.${i}`, readText(r)));
  (llm?.cards || []).forEach((c, i) => push(`cards.${i}.teaser`, c?.teaser));
  return hits;
}

// جایگذاریِ متنِ تعمیرشده سرِ جای خودش. آبجکتِ تازه برمی‌گرداند (ورودی دست‌نخورده).
export function applyFixes(llm, hits, fixes) {
  const out = { ...llm, reads: [...(llm.reads || [])] };
  hits.forEach((h, i) => {
    const fixed = String(fixes[i] || '').trim();
    if (!fixed) return;
    if (h.path.startsWith('reads.')) {
      const idx = Number(h.path.split('.')[1]);
      const cur = out.reads[idx];
      out.reads[idx] = typeof cur === 'string' ? fixed : { ...cur, text: fixed };
    } else if (h.path.startsWith('cards.')) {
      const idx = Number(h.path.split('.')[1]);
      out.cards = [...(out.cards || [])];
      out.cards[idx] = { ...out.cards[idx], teaser: fixed };
    } else {
      out[h.path] = fixed;
    }
  });
  return out;
}

/* 🌍 دادهٔ زبانیِ مسیرِ تعمیر (بند ۲و).
 *
 * ⚠️ چرا لازم بود: `REPAIR_SYSTEM` با جمله‌ی «تو ویراستارِ یک متنِ تاروتِ **فارسی**
 * هستی» شروع می‌شد. روی رباتِ روسی این یعنی یک پرامپتِ فارسی که به مدل می‌گوید متنِ
 * فارسی را ویرایش کن، در حالی که متنِ ورودی روسی است. بدترین حالتش سکوت نیست:
 * تعمیر ممکن بود جمله را به فارسی برگرداند و آن را وسطِ فالِ روسیِ یک کاربرِ پولی
 * بنشاند. پیش‌فرض‌ها فارسی می‌مانند تا اگر کسی configure نکرد رفتار عوض نشود. */
const FA_REPAIR = {
  system: `تو ویراستارِ یک متنِ تاروتِ فارسی هستی.

هر جمله‌ای که می‌گیری یک ایرادِ مشخص دارد که کنارش نوشته شده. فقط همان ایراد را برطرف کن.

قواعد:
- بقیه‌ی جمله را دست نزن. طول و لحن و معنیِ کلی همان بماند.
- گفتاری و صمیمی، همیشه «تو»، هرگز «شما».
- بدونِ خط تیره‌ی بلند، بدونِ ایموجی، بدونِ اضافه‌کردنِ جمله‌ی تازه.
- هیچ‌وقت وعده‌ی قطعی و تضمین نده؛ «به احتمال زیاد» و «بیشتر به این می‌خوره» مجاز است.

خروجی فقط یک JSON معتبر، بدونِ code fence:
{"fixes": ["جمله‌ی تعمیرشده‌ی ۱", "جمله‌ی تعمیرشده‌ی ۲"]}
به همان ترتیبِ ورودی و با همان تعداد.`,
  hints: {
    evasion: 'تصمیم را به خودِ مخاطب پس داده. جهت بده: بگو کدام سمت سنگین‌تر است.',
    pastTime: 'به زمانِ گذشته اشاره کرده در حالی که تاریخِ جلسه‌های قبل را نداریم. خودِ اشاره‌ی زمانی را بردار و فقط موضوع را نگه دار.',
  },
  item: (i, hint, phrase, text) => `${i + 1}) [ایراد: ${hint}]\n[عبارتِ «${phrase}» نباید در جوابت باشد]\n${text}`,
};
let RLEX = FA_REPAIR;
/** دادهٔ زبانیِ مسیرِ تعمیر را از فایلِ زبان می‌گیرد؛ خودِ ماژول صدایش می‌زند. */
export function configureRepair(lex) {
  if (!lex || typeof lex !== 'object') return;
  // `item` قالبِ رشته‌ای است چون از JSON می‌آید (`%i %hint %phrase %text`).
  const tpl = typeof lex.item === 'string' ? lex.item : null;
  RLEX = {
    system: lex.system || FA_REPAIR.system,
    hints: { ...FA_REPAIR.hints, ...(lex.hints || {}) },
    item: tpl
      ? (i, hint, phrase, text) => tpl
          .replace('%i', String(i + 1)).replace('%hint', hint)
          .replace('%phrase', phrase).replace('%text', text)
      : FA_REPAIR.item,
  };
}
configureRepair(LANG_DATA.repair);
export const repairSystem = () => RLEX.system;

// هر تکه با **ایرادِ خودش** می‌رود، پس یک فراخوانی می‌تواند چند نوع ضعف را با هم
// بردارد و مدل دقیقاً می‌داند چه چیزی را باید عوض کند.
// عبارتِ دقیق **صریح** نام برده می‌شود. دورِ پانزدهم یک تعمیرِ ناموفق داشت: مدل
// جمله را بازنویسی کرد ولی همان عبارت را دوباره آورد. چون بودجه یک فراخوانی است و
// بس، تنها راهِ بالابردنِ شانسِ همان یک بار، روشن‌ترکردنِ خواسته است، نه یک تلاشِ دیگر.
export const repairUser = (hits) =>
  hits.map((h, i) => RLEX.item(i, h.hint, h.phrase, h.text)).join('\n\n');

/**
 * یک بار تلاش برای تعمیرِ طفره‌رفتن. `call` تزریق می‌شود تا ربات و آزمایشگاه **همین**
 * کد را اجرا کنند و هیچ drift ای ممکن نباشد.
 * @returns {{llm, fired: boolean, repaired: boolean, usage?: object}} همیشه یک خوانشِ قابلِ تحویل.
 * `fired` یعنی تشخیص چیزی پیدا کرد و فراخوانی رفت؛ `repaired` یعنی نتیجه‌اش هم پذیرفته شد.
 * تفکیکشان لازم است وگرنه «شلیک‌نکرد» و «شلیک کرد و نشد» در گزارش یکی می‌شوند.
 */
export async function repairDefects(llm, call, { tag = '', meta = null, plan = null } = {}) {
  const hits = findDefects(llm);
  if (!hits.length) return { llm, fired: false, repaired: false };

  let res = null;
  /* شمارشِ فراخوانی‌هایی که واقعاً به مدل رسیدند (چه قبول شوند چه رد). مصرفش
   * تشخیصِ «مسیرِ تعمیر روی این مدل مرده است» در آزمایشگاه است. */
  let calls = 0;
  try {
    res = await call(repairSystem(), repairUser(hits), {
      onUsage: () => { calls += 1; },
      // برچسبِ حسابداریِ مصرفِ مدل (اختیاری؛ نبودنش دقیقاً رفتارِ قبلی است)
      ...(meta || {}),
      maxTokens: 600,
      temperature: 0.4,   // پایین‌تر از خودِ خوانش: اینجا خلاقیت نمی‌خواهیم، دقت می‌خواهیم
      validate: (out) => {
        const obj = parseJsonLoose(out);
        if (!obj || !Array.isArray(obj.fixes) || obj.fixes.length !== hits.length) return false;
        // اگر تعمیر خودش طفره‌رفتن داشته باشد، تعمیر نشده. ولی **دوباره نمی‌پرسیم** —
        // یک فراخوانی یعنی یک فراخوانی؛ خروجیِ اصلی تحویل می‌شود.
        // تعمیر نباید خودش همان ایراد را دوباره داشته باشد — هیچ‌کدام از انواع.
        return obj.fixes.every((f, i) => {
          const t = String(f || '').trim();
          return t && !DEFECTS.some((d) => d.find(t));
        });
      },
    // فقط یک تلاش: بودجه‌ی این مسیر عمداً سخت‌گیرانه است.
    // ⚠️ `plan` فقط برای آزمایشگاه است و پیش‌فرضش `[undefined]` یعنی مدلِ پیش‌فرضِ
    // ربات — دقیقاً رفتارِ قبلی. لازم شد چون بازوی مدلِ آزمایشگاه (`--model`) تا امروز
    // فقط خوانش را عوض می‌کرد و تعمیر همچنان روی مدلِ محصول می‌رفت؛ یعنی مقایسه‌ی
    // مدل‌ها «کلِ خطِ لوله» را نمی‌سنجید. آرایه باید تک‌عضوی بماند (یک تلاش).
    }, plan && plan.length === 1 ? plan : [undefined]);
  } catch (e) {
    logErr(`${tag} تعمیرِ طفره‌رفتن خطا داد: ${e.message}`);
  }

  const obj = res && parseJsonLoose(res.out);
  if (!obj?.fixes) {
    logErr(`${tag} تعمیر نشد، متنِ اصلی تحویل می‌شود (${hits[0].kind}: «${hits[0].phrase}»)`);
    return { llm, fired: true, repaired: false, calls };
  }
  log(`${tag} تعمیر شد: ${hits.map((h) => `${h.kind}«${h.phrase}»`).join('، ')}`);
  return { llm: applyFixes(llm, hits, obj.fixes), fired: true, repaired: true, usage: res.usages?.[0], calls };
}
