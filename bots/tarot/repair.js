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
import { evasionIn } from './verdict.js';
import { parseJsonLoose, readText } from './reading-core.js';
import { log, logErr } from '../../shared/logger.js';

// همه‌ی فیلدهای رو-به-کاربر، **دقیقاً همان‌هایی که `v4Text` می‌بیند**.
//
// ⚠️ نسخه‌ی اول تیزرها را عمداً کنار گذاشته بود («معرفیِ کارت‌اند، جوابی ندارند که
// ازش طفره بروند»). استدلال قشنگ بود و غلط: سنجه‌ی آزمایشگاه تیزرها را می‌دید و
// گارد نمی‌دید، پس در دورِ سیزدهم یک فال با «بستگی داره» رد شد بی‌آنکه تعمیر اصلاً
// شلیک کند. همان قانونی که در کامنتِ `v4Text` نوشته بودیم را خودمان شکسته بودیم:
// **گارد و سنجه باید عیناً یک متن را ببینند**، وگرنه یکی چیزی را می‌گیرد که آن یکی
// نمی‌بیند. هر فیلدی که به کاربر می‌رسد اینجا هم باید باشد.
export function findEvasion(llm) {
  const hits = [];
  const push = (path, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    const phrase = evasionIn(t);
    if (phrase) hits.push({ path, text: t, phrase });
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

// پرامپتِ تعمیر: عمداً کوتاه. هرچه بلندتر شود، هم گران‌تر می‌شود و هم مدل بیشتر
// وسوسه می‌شود متن را بازنویسی کند، در حالی که ما فقط یک جراحیِ کوچک می‌خواهیم.
export const REPAIR_SYSTEM = `تو ویراستارِ یک متنِ تاروتِ فارسی هستی.

در جمله‌هایی که می‌گیری، عبارتی هست که تصمیم را به خودِ مخاطب پس می‌دهد («بستگی به خودت داره»، «به شهودت اعتماد کن»، «شاید آره شاید نه»، «هم این هم اون»، «فقط خودت می‌دونی»). این ممنوع است: مخاطب آمده جواب بگیرد.

کارِ تو فقط همین است: همان تکه را با یک جمله‌ی **جهت‌دار** عوض کن که بگوید کدام سمت سنگین‌تر است.

قواعد:
- بقیه‌ی جمله را دست نزن. طول و لحن و معنیِ کلی همان بماند.
- گفتاری و صمیمی، همیشه «تو»، هرگز «شما».
- بدونِ خط تیره‌ی بلند، بدونِ ایموجی، بدونِ اضافه‌کردنِ جمله‌ی تازه.
- هیچ‌وقت وعده‌ی قطعی و تضمین نده؛ «به احتمال زیاد» و «بیشتر به این می‌خوره» مجاز است.

خروجی فقط یک JSON معتبر، بدونِ code fence:
{"fixes": ["جمله‌ی تعمیرشده‌ی ۱", "جمله‌ی تعمیرشده‌ی ۲"]}
به همان ترتیبِ ورودی و با همان تعداد.`;

export const repairUser = (hits) =>
  hits.map((h, i) => `${i + 1}) ${h.text}`).join('\n\n');

/**
 * یک بار تلاش برای تعمیرِ طفره‌رفتن. `call` تزریق می‌شود تا ربات و آزمایشگاه **همین**
 * کد را اجرا کنند و هیچ drift ای ممکن نباشد.
 * @returns {{llm, fired: boolean, repaired: boolean, usage?: object}} همیشه یک خوانشِ قابلِ تحویل.
 * `fired` یعنی تشخیص چیزی پیدا کرد و فراخوانی رفت؛ `repaired` یعنی نتیجه‌اش هم پذیرفته شد.
 * تفکیکشان لازم است وگرنه «شلیک‌نکرد» و «شلیک کرد و نشد» در گزارش یکی می‌شوند.
 */
export async function repairEvasion(llm, call, { tag = '' } = {}) {
  const hits = findEvasion(llm);
  if (!hits.length) return { llm, fired: false, repaired: false };

  let res = null;
  try {
    res = await call(REPAIR_SYSTEM, repairUser(hits), {
      maxTokens: 600,
      temperature: 0.4,   // پایین‌تر از خودِ خوانش: اینجا خلاقیت نمی‌خواهیم، دقت می‌خواهیم
      validate: (out) => {
        const obj = parseJsonLoose(out);
        if (!obj || !Array.isArray(obj.fixes) || obj.fixes.length !== hits.length) return false;
        // اگر تعمیر خودش طفره‌رفتن داشته باشد، تعمیر نشده. ولی **دوباره نمی‌پرسیم** —
        // یک فراخوانی یعنی یک فراخوانی؛ خروجیِ اصلی تحویل می‌شود.
        return obj.fixes.every((f) => String(f || '').trim() && !evasionIn(String(f)));
      },
    // فقط یک تلاش: بودجه‌ی این مسیر عمداً سخت‌گیرانه است.
    }, [undefined]);
  } catch (e) {
    logErr(`${tag} تعمیرِ طفره‌رفتن خطا داد: ${e.message}`);
  }

  const obj = res && parseJsonLoose(res.out);
  if (!obj?.fixes) {
    logErr(`${tag} تعمیر نشد، متنِ اصلی تحویل می‌شود (طفره: «${hits[0].phrase}»)`);
    return { llm, fired: true, repaired: false };
  }
  log(`${tag} طفره‌رفتن تعمیر شد: ${hits.map((h) => `«${h.phrase}»`).join('، ')}`);
  return { llm: applyFixes(llm, hits, obj.fixes), fired: true, repaired: true, usage: res.usages?.[0] };
}
