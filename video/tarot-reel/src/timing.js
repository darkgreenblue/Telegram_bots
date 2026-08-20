// timing.js — تبدیلِ propsِ یک فال به یک برنامه‌ی صحنه‌بندیِ فریم‌به‌فریم.
//
// چرا اینجا و نه در JSX: طولِ هر صحنه از **طولِ متن** می‌آید و طولِ کلِ ویدیو یک سقفِ سخت دارد
// (ریلز باید زیرِ ۶۰ ثانیه بماند، وگرنه اینستاگرام خودش می‌بُرد). این یعنی یک محاسبه‌ی سراسری که
// باید قبل از رندر انجام شود و باید قابلِ تست باشد. `Sequence`های Remotion فقط عددهای همین
// برنامه را مصرف می‌کنند.
//
// قاعده‌ی فشرده‌سازی: وقتی از سقف رد می‌شویم، **فقط زمانِ نگه‌داشتِ متن** کوتاه می‌شود.
// پرواز و فلیپِ کارت‌ها ثابت می‌مانند چون کوتاه‌کردنشان حرکت را جویده و ارزان می‌کند، در حالی که
// چند دهمِ ثانیه کمتر برای خواندن، تقریباً حس نمی‌شود.
// آخرین شبکه‌ی ایمنی: اگر با همه‌ی این‌ها باز هم از سقف رد شدیم، فریم‌ها یکی‌یکی از بلندترین
// صحنه کم می‌شوند. `totalFrames > CAP_FRAMES` هیچ‌وقت از این تابع بیرون نمی‌آید.

import { FPS, VERDICT_BOX, FONT, titleTextBox, captionTextBox, verdictTextBox } from './layout.js';
import { fitFontSize, paginateToFit, stripDash, normalizeWs } from './text.js';

export const CHARS_PER_SEC = 22; // کمی سریع‌تر از خواندنِ عادی؛ خواسته‌ی مالک
export const INTRO_SEC = 5.5;
// مسیرِ پرواز سه ضرب دارد (به دالان، عمودی، به مقصد و رشد). با ۰.۷ ثانیه هر ضرب حدود
// یک‌پنجمِ ثانیه می‌شد و چشم آن را حرکت نمی‌دید، فقط پرش.
export const FLY_SEC = 1.5;
export const FADE_SEC = 0.4;
export const MIN_TEXT_SEC = 2.2;
export const CAP_SEC = 58;
export const CAP_FRAMES = Math.floor(CAP_SEC * FPS);
// جمع‌بندی عمداً چندتکه است تا مثل یک دیوارِ متن نباشد؛ خواسته‌ی صریحِ مالک.
export const CLOSING_MIN_PAGES = 2;
export const CLOSING_MAX_PAGES = 3;

const clean = (v) => normalizeWs(stripDash(v));

// زمانِ ماندنِ یک متن روی صفحه. کفِ MIN_TEXT_SEC برای متنِ کوتاه است: یک جمله‌ی سه کلمه‌ای هم
// باید فرصتِ دیده شدن داشته باشد، وگرنه اسلاید مثل خطای رندر به نظر می‌رسد.
export function holdSeconds(text) {
  const n = clean(text).length;
  return Math.max(MIN_TEXT_SEC, n / CHARS_PER_SEC);
}

// ضریبی که مجموعِ نگه‌داشت‌ها را با رعایتِ کف به `target` می‌رساند.
// تابعِ مجموع نسبت به ضریب پیوسته و صعودی است، پس دوبخشی جواب می‌دهد و به فرمولِ بسته نیاز نیست.
function solveHolds(holds, target, floorSec) {
  const total = (s) => holds.reduce((a, h) => a + Math.max(floorSec, h * s), 0);
  if (total(1) <= target) return holds.slice();
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > target) hi = mid;
    else lo = mid;
  }
  return holds.map((h) => Math.max(floorSec, h * lo));
}

function compressHolds(items, capSec) {
  const fixed = items.reduce((a, it) => a + it.fixedSec, 0);
  const holdIdx = items.map((it, i) => (it.holdSec > 0 ? i : -1)).filter((i) => i >= 0);
  const holds = holdIdx.map((i) => items[i].holdSec);
  const sum = holds.reduce((a, h) => a + h, 0);
  const target = capSec - fixed;
  if (!holds.length || sum <= target) return items;

  let next;
  if (target >= holds.length * MIN_TEXT_SEC) {
    next = solveHolds(holds, target, MIN_TEXT_SEC);
  } else if (target > 0) {
    // حتی با کفِ همه هم از سقف رد می‌شویم، پس خودِ کف هم به نسبت پایین می‌آید.
    // ویدیو هرگز نباید از سقف رد شود؛ این تنها بندی است که اجازه می‌دهد از MIN_TEXT_SEC بگذریم.
    const s = target / sum;
    next = holds.map((h) => h * s);
  } else {
    next = holds.map(() => 1 / FPS);
  }
  const out = items.slice();
  holdIdx.forEach((idx, k) => {
    out[idx] = { ...out[idx], holdSec: next[k] };
  });
  return out;
}

/**
 * برنامه‌ی صحنه‌ها از propsِ یک فال.
 * خروجی: { fps, totalFrames, capFrames, scenes: [{ id, kind, from, durationInFrames, ...payload }] }
 * هر صحنه یک فیلدِ `motion` دارد که مستقیماً به `cardRectAt` داده می‌شود، تا JSX هیچ تصمیمِ
 * هندسی‌ای نگیرد.
 */
export function buildPlan(props = {}) {
  const fps = FPS;
  const cards = Array.isArray(props.cards) ? props.cards : [];
  const n = cards.length;

  const question = clean(props.question);
  const spreadFa = clean(props.spreadFa);
  const headline = clean(props.headline);
  const pattern = clean(props.pattern);
  const closingRaw = clean(props.closing);
  // «الگو» یک فیلدِ نرم است و اگر صحنه‌ی جدا بگیرد چند ثانیه از بودجه‌ی ۵۸ ثانیه‌ای را می‌خورد
  // بدون اینکه پیامِ تازه‌ای بدهد؛ پس ابتدای جمع‌بندی می‌نشیند و با آن صفحه‌بندی می‌شود.
  const closingSrc = [pattern, closingRaw].filter(Boolean).join('\n');

  const items = [];

  items.push({
    id: 'intro',
    kind: 'intro',
    fixedSec: INTRO_SEC,
    holdSec: 0,
    motion: 'intro',
    payload: {
      n,
      spreadFa,
      question,
      questionFontSize: fitFontSize(question || spreadFa, titleTextBox(), FONT.title),
    },
  });

  cards.forEach((c, i) => {
    const read = clean(c?.read);
    items.push({
      id: `focus:${i}`,
      kind: 'focus',
      fixedSec: FLY_SEC * 2,
      holdSec: holdSeconds(read),
      motion: { kind: 'focus', card: i },
      payload: {
        n,
        card: i,
        cardKey: c?.key || '',
        cardFile: c?.file || '',
        cardFa: clean(c?.fa),
        reversed: Boolean(c?.reversed),
        label: clean(c?.label),
        text: read,
        fontSize: fitFontSize(read, captionTextBox(), FONT.caption),
      },
    });
  });

  if (headline) {
    items.push({
      id: 'headline',
      kind: 'headline',
      fixedSec: 0,
      holdSec: holdSeconds(headline),
      motion: 'verdict',
      payload: {
        n,
        text: headline,
        fontSize: fitFontSize(headline, VERDICT_BOX, FONT.headline),
      },
    });
  }

  // با `verdictTextBox` نه `VERDICT_BOX`: ردیفِ نقطه‌های صفحه از قبل کسر شده است.
  const closing = paginateToFit(closingSrc, verdictTextBox(), {
    ...FONT.verdict,
    minPages: CLOSING_MIN_PAGES,
    maxPages: CLOSING_MAX_PAGES,
  });
  closing.pages.forEach((page, j) => {
    items.push({
      id: `closing:${j}`,
      kind: 'closing',
      fixedSec: 0,
      holdSec: holdSeconds(page),
      motion: 'verdict',
      payload: {
        n,
        text: page,
        page: j,
        pages: closing.pages.length,
        fontSize: closing.fontSize,
      },
    });
  });

  const sized = compressHolds(items, CAP_SEC);

  // هر صحنه حداقل یک فریم دارد؛ صحنه‌ی صفرفریمی در Remotion یعنی محتوای گم‌شده.
  const frames = sized.map((it) => Math.max(1, Math.round((it.fixedSec + it.holdSec) * fps)));
  let total = frames.reduce((a, f) => a + f, 0);
  // گردکردن می‌تواند چند فریم اضافه بیاورد و مسیرِ فشرده‌سازیِ نسبی هم دقیقاً روی سقف می‌نشیند.
  // این حلقه سقف را قطعی می‌کند، بدون اینکه صحنه‌ای صفر شود.
  // ⚠️ اینترو هرگز اهداکننده نیست. با متنِ افراطی همه‌ی صحنه‌های متنی به کفشان می‌رسند و
  // آن‌وقت اینترو بلندترین صحنه می‌شود، پس این حلقه شروع می‌کرد به خوردنِ خودِ انیمیشن.
  // اینترو اصلاً «نگه‌داشتِ متن» ندارد که کوتاه شود؛ کوتاه‌کردنش یعنی جویده‌کردنِ همان چیزی
  // که کل این فیچر برایش ساخته شده.
  const donors = sized.map((it, i) => i).filter((i) => sized[i].kind !== 'intro');
  while (total > CAP_FRAMES && donors.length) {
    let big = donors[0];
    for (const i of donors) if (frames[i] > frames[big]) big = i;
    if (frames[big] <= 1) break;
    frames[big] -= 1;
    total -= 1;
  }

  const fadeFrames = Math.max(1, Math.round(FADE_SEC * fps));
  const scenes = [];
  let from = 0;
  sized.forEach((it, i) => {
    const durationInFrames = frames[i];
    const fade = Math.min(fadeFrames, Math.floor(durationInFrames / 3));
    let motion = it.motion;
    if (it.kind === 'focus') {
      // پرواز رفت‌وبرگشت به ثانیه ثابت است، پس کسرِ آن از طولِ نهاییِ صحنه محاسبه می‌شود
      // (بعد از فشرده‌سازی، نه قبلش).
      const flyF = Math.max(1, Math.min(Math.round(FLY_SEC * fps), Math.floor(durationInFrames * 0.42)));
      const f = flyF / durationInFrames;
      motion = { ...it.motion, flyIn: f, flyOut: f };
    }
    scenes.push({
      id: it.id,
      kind: it.kind,
      from,
      durationInFrames,
      fadeFrames: Math.max(1, fade),
      motion,
      ...it.payload,
    });
    from += durationInFrames;
  });

  return { fps, totalFrames: from, capFrames: CAP_FRAMES, scenes };
}

// کمکِ خوانایی برای اسکریپت‌ها و چکِ CI.
export function planSeconds(plan) {
  return plan.totalFrames / plan.fps;
}

/**
 * کدام صحنه در فریمِ مطلقِ `frame` جریان دارد و t نرمال‌شده‌اش چند است.
 *
 * چرا اینجا و نه در JSX: لایه‌ی کارت‌ها عمداً **بیرونِ** `Sequence`ها رندر می‌شود تا حرکتِ
 * کارت بینِ دو صحنه نبُرد، پس آن لایه فریمِ مطلق دارد و باید خودش صحنه را پیدا کند. اگر این
 * تبدیل در JSX نوشته شود، یک عددِ زمانی از دیدِ چکِ CI پنهان می‌ماند.
 *
 * t در آخرین فریمِ صحنه دقیقاً ۱ می‌شود تا پروازِ برگشتِ کارت کامل تمام شود و فریمِ اولِ
 * صحنه‌ی بعد (t=0) دقیقاً از همان جا شروع کند؛ همین پیوستگیِ بصری را تضمین می‌کند.
 */
export function sceneAt(plan, frame) {
  const scenes = (plan && plan.scenes) || [];
  if (!scenes.length) return null;
  const last = scenes[scenes.length - 1];
  const end = last.from + last.durationInFrames;
  const f = Math.max(0, Math.min(end - 1, Math.floor(frame) || 0));
  let index = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (f >= scenes[i].from) index = i;
    else break;
  }
  const scene = scenes[index];
  const span = scene.durationInFrames - 1;
  const t = span > 0 ? (f - scene.from) / span : 0;
  return { index, scene, t: t < 0 ? 0 : t > 1 ? 1 : t };
}
