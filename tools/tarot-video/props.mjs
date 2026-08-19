// ساختِ propsِ کامپوزیشن از خروجیِ خامِ مدل، و قفلِ قراردادش.
//
// چرا این فایل جداست و خالص است: props تنها چیزی است که بینِ `generate.mjs` و پروژه‌ی
// Remotion می‌ایستد. خرابیِ props تا لحظه‌ی رندر ساکت می‌ماند و آن‌جا هم به‌شکلِ یک
// «صفحه‌ی سفید در ویدیو» ظاهر می‌شود، نه یک پیامِ خطا. پس ساخت و اعتبارسنجی هر دو
// این‌جا هستند تا چکِ CI بتواند بدونِ شبکه و بدونِ نصبِ پکیجِ ویدیو اجرایشان کند.
//
// دو قاعده‌ی محتوایی که این ماژول ضامنشان است:
//   ۱) هیچ تکه‌ای از دیتای کاربرِ واقعی وارد props نمی‌شود. `llm.memory` و `llm.summary`
//      عمداً خوانده نمی‌شوند: خروجی قرار است در اینستاگرام عمومی منتشر شود.
//   ۲) هیچ خط تیره‌ی بلندی در هیچ متنی نمی‌ماند (بند ۱۰ ریشه). پرامپت ممنوعش کرده،
//      ولی چیزی که کد می‌تواند تضمین کند به مدل سپرده نمی‌شود.

import { CARD_BY_KEY } from '../../bots/tarot/cards.js';
import { readText, stripCardLabel, noDash } from '../../bots/tarot/reading-core.js';

const L = (await import('../../bots/tarot/locales/fa.js')).default;

export const PROPS_VERSION = 1;
export const BACKGROUNDS = ['mystic', 'nature', 'minimal'];
// نسخه‌ی اول فقط سه‌کارتی می‌سازد، ولی قرارداد پنج‌کارتی را هم می‌پذیرد چون هندسه و
// زمان‌بندیِ کامپوزیشن از قبل برای هر دو نوشته شده‌اند.
export const ALLOWED_CARD_COUNTS = [3, 5];

// هر سه شکلِ خط تیره‌ی طولانی. رجکس است نه رشته، پس در سنجه‌ی «متنِ فارسی» چکِ CI
// اشتباهاً به‌عنوان متنِ رو-به-کاربر شمرده نمی‌شود.
const DASH_RE = /[—–]|--/;

// `noDash` هسته دو شکلِ رایج را می‌گیرد؛ خط تیره‌ی کوتاه‌ترِ یونیکد (en dash) هم اضافه
// می‌شود چون متنِ سوال از نوشن می‌آید و دستِ ما نیست چه تایپ شده باشد.
const stripLongDash = (t) => noDash(String(t ?? '')).replace(/\s*–\s*/g, '، ');
// فاصله‌های افقی جمع می‌شوند ولی خطِ جدید می‌ماند: صفحه‌بندیِ کامپوزیشن مرزِ جمله را
// از خطِ جدید هم می‌گیرد، و پاک‌کردنش کیفیتِ برشِ متنِ بلندِ جمع‌بندی را پایین می‌آورد.
const clean = (t) => stripLongDash(t)
  .replace(/[^\S\n]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
  .trim();

/**
 * متنِ خوانشِ یک کارت، دقیقاً همان‌طور که کاربرِ ربات می‌بیندش:
 * نرمال‌سازیِ شکلِ خروجی، برداشتنِ برچسبِ ترتیبی که مدل خودش جلوی جمله گذاشته
 * (شماره‌گذاری کارِ کد است)، و پاک‌سازیِ خط تیره.
 */
export function cardRead(x) {
  return clean(stripCardLabel(readText(x)));
}

/**
 * props کامل از یک فالِ تولیدشده.
 * @param {object}   a.spread     رکوردِ چیدمان از `spreads.js`
 * @param {Array}    a.cards      خروجیِ `drawCards` (کلید و جهت)
 * @param {object}   a.llm        خروجیِ پارس‌شده‌ی مدل (v4)
 * @param {string}   a.question   متنِ سوال. در props می‌ماند (کپشنِ تلگرام و دیباگ) ولی
 *                                روی ویدیو رندر نمی‌شود.
 * @param {string}   a.background یکی از `BACKGROUNDS`
 * @param {object}   a.meta       `{ pageId, seed, model, generatedAt }`
 */
export function buildProps({ spread, cards, llm, question, background, meta = {} }) {
  const list = Array.isArray(cards) ? cards : [];
  const labels = L.prompts.cardLabels(list.length);
  const reads = Array.isArray(llm?.reads) ? llm.reads : [];

  return {
    v: PROPS_VERSION,
    background: String(background || ''),
    spreadId: String(spread?.id || ''),
    spreadFa: clean(spread?.fa || ''),
    question: clean(question || ''),
    cards: list.map((c, i) => {
      const key = String(c?.key || '');
      const card = CARD_BY_KEY[key];
      return {
        key,
        file: `${key}.jpg`,
        fa: clean(card?.fa || ''),
        reversed: !!c?.reversed,
        label: clean(labels[i] || ''),
        read: cardRead(reads[i]),
      };
    }),
    headline: clean(llm?.headline || ''),
    // `pattern` در قرارداد v4 نرم است: نبودنش خوانش را نمی‌شکند، پس خالی‌ماندنش مجاز است.
    pattern: clean(llm?.pattern || ''),
    closing: clean(llm?.closing || ''),
    // ⚠️ عمداً هیچ‌چیز از `llm.memory` و `llm.summary` این‌جا نمی‌آید: آن دو شناختِ
    // انباشته از یک کاربرند و این خروجی عمومی منتشر می‌شود.
    meta: {
      pageId: String(meta.pageId || ''),
      seed: String(meta.seed || ''),
      model: String(meta.model || ''),
      generatedAt: String(meta.generatedAt || ''),
    },
  };
}

/**
 * اعتبارسنجیِ قرارداد props.
 * @returns {string[]} آرایه‌ی خطاهای فارسی؛ آرایه‌ی خالی یعنی سالم.
 */
export function validateProps(props) {
  const errs = [];
  if (!props || typeof props !== 'object' || Array.isArray(props)) return ['props یک آبجکت نیست'];

  if (props.v !== PROPS_VERSION) errs.push(`نسخه‌ی props باید ${PROPS_VERSION} باشد (مقدار: ${JSON.stringify(props.v)})`);
  if (!BACKGROUNDS.includes(props.background)) {
    errs.push(`پس‌زمینه‌ی نامعتبر: ${JSON.stringify(props.background)} (مجاز: ${BACKGROUNDS.join('، ')})`);
  }

  // متن‌های سطحِ بالا. `pattern` عمداً این‌جا نیست چون خالی‌بودنش مجاز است.
  const top = { spreadId: 'شناسه‌ی چیدمان', spreadFa: 'نامِ چیدمان', headline: 'جوابِ نهایی', closing: 'جمع‌بندی' };
  for (const [key, fa] of Object.entries(top)) {
    if (!String(props[key] ?? '').trim()) errs.push(`${fa} (${key}) خالی است`);
  }

  const cards = Array.isArray(props.cards) ? props.cards : null;
  if (!cards) errs.push('فیلد cards آرایه نیست');
  else if (!ALLOWED_CARD_COUNTS.includes(cards.length)) {
    errs.push(`تعدادِ کارت ${cards.length} است؛ فقط ${ALLOWED_CARD_COUNTS.join(' یا ')} پذیرفته می‌شود`);
  }

  for (const [i, c] of (cards || []).entries()) {
    const tag = `کارت ${i + 1}`;
    if (!c || typeof c !== 'object') { errs.push(`${tag}: آبجکت نیست`); continue; }
    const key = String(c.key || '');
    if (!CARD_BY_KEY[key]) errs.push(`${tag}: کلیدِ «${key}» در کاتالوگِ ۷۸ کارتی نیست`);
    // ناهم‌خوانیِ نام فایل با کلید یعنی تصویرِ کارتِ دیگری روی این متن می‌نشیند؛
    // در ویدیو هیچ خطایی نمی‌دهد و فقط بیننده گیج می‌شود.
    else if (c.file !== `${key}.jpg`) errs.push(`${tag}: فایلِ «${c.file}» با کلیدِ «${key}» نمی‌خواند`);
    for (const [f, fa] of [['read', 'تفسیر'], ['label', 'برچسب'], ['fa', 'نامِ فارسی']]) {
      if (!String(c[f] ?? '').trim()) errs.push(`${tag}: ${fa} (${f}) خالی است`);
    }
  }

  // بند ۱۰ ریشه: خط تیره‌ی بلند امضای متنِ ماشینی است و این ویدیو بیشترین متنی است که
  // مخاطبِ اینستاگرام از ما می‌بیند.
  const texts = [
    ['spreadFa', props.spreadFa], ['question', props.question], ['headline', props.headline],
    ['pattern', props.pattern], ['closing', props.closing],
    ...(cards || []).flatMap((c, i) => [
      [`cards[${i}].fa`, c?.fa], [`cards[${i}].label`, c?.label], [`cards[${i}].read`, c?.read],
    ]),
  ];
  for (const [where, t] of texts) {
    if (DASH_RE.test(String(t ?? ''))) errs.push(`خط تیره‌ی بلند در «${where}»`);
  }

  return errs;
}
