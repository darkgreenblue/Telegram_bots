// motion.js — کلِ هندسه‌ی متحرکِ ویدیو، به‌صورتِ توابعِ خالص.
//
// قاعده‌ی نشکستنی: `cardRectAt` برای **هیچ** t و هیچ کارتی نباید مستطیلی برگرداند که با
// `SAFE_BOX` تقاطع دارد. این را با «مواظب باشیم» تضمین نمی‌کنیم، با ساختار تضمین می‌کنیم:
//
//   هر جابه‌جاییِ عمودی که از باندِ باکس رد می‌شود از `corridorPath` می‌گذرد، و آن‌جا یک
//   «گیتِ دالان» (`corridorGate`) هست که **از روی خودِ y و ارتفاعِ لحظه‌ای** حساب می‌شود:
//     • هر جا مستطیل *بتواند* با باندِ عمودیِ باکس همپوشانی داشته باشد، گیت دقیقاً ۱ است و
//       کارت با اجبار وسطِ دالان و کوچک‌شده تا اندازه‌ی دالان قرار می‌گیرد.
//     • هر جا گیت کمتر از ۱ باشد، y ثابت‌شده بیرونِ باندِ باکس است، پس تقاطع ممکن نیست.
//   یعنی امنیت به مقدارِ easing یا به پنجره‌های زمانی وابسته نیست. تیونِ حسِ حرکت هرگز
//   نمی‌تواند این قاعده را بشکند.
//
// گیتِ دوم (`gateT`) فقط برای **حس** است: کارت را زودتر و نرم‌تر به سمتِ دالان می‌کشد تا حرکت
// به «توقف، چرخش، حرکت» ی رباتیک تبدیل نشود. چون گیتِ نهایی max این دو است، گیتِ زمانی
// هیچ‌وقت نمی‌تواند امنیت را کم کند، فقط می‌تواند زودتر محافظه‌کار شود.
//
// چرا صفر تصادف: Remotion ممکن است فریم‌ها را موازی و خارج از ترتیب رندر کند. `Math.random()`
// یا `Date.now()` یعنی دو فریمِ پشتِ سرِ هم دو دنیای متفاوت. هر «تصادفی» از `mulberry32` می‌آید.

import {
  W,
  SAFE_BOX,
  FAN,
  cardW,
  cardSize,
  corridorInner,
  corridorMaxCardH,
  rowSlots,
  revealSlots,
  focusRect,
} from './layout.js';

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : Number.isFinite(t) ? t : 0);
export const lerp = (a, b, t) => a + (b - a) * t;
// نرمال‌سازیِ t داخلِ یک زیربازه؛ بیرونِ بازه به ۰ یا ۱ می‌چسبد.
export const sub = (t, a, b) => (b <= a ? (t < a ? 0 : 1) : clamp01((t - a) / (b - a)));
export const easeInOut = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOut = (t) => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
};
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const deg = Math.PI / 180;

// مماس‌بودن تقاطع نیست: کارتی که لبه‌اش دقیقاً روی لبه‌ی باکس بنشیند مجاز است، وگرنه
// دالان که دقیقاً به باکس چسبیده هیچ‌وقت «امن» شمرده نمی‌شد.
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
export function safeBoxClear(rect) {
  return !overlaps(rect, SAFE_BOX);
}

// PRNGِ قطعی. همان الگوی `bots/tarot/reading-core.js` تا رفتارِ «تصادف» در کلِ ریپو یکی باشد.
export function mulberry32(a) {
  let s = a | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// بذرِ سبک برای ذرات: از ایندکس، نه از ساعت.
export function seeded(i) {
  return mulberry32(((Math.floor(i) | 0) * 2654435761) >>> 0);
}
// ذراتِ پس‌زمینه: قطعی، پس هر فریم همان ذره را در همان جا می‌بیند.
export function bgParticles(count = 40, seed = 7) {
  const rng = seeded(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: rng() * W,
      y: rng() * 1920,
      r: 1.5 + rng() * 3.5,
      speed: 0.25 + rng() * 0.9,
      phase: rng(),
      alpha: 0.18 + rng() * 0.5,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// مسیرِ دالان
// ---------------------------------------------------------------------------

// نزدیک‌ترین دالان به اسلاتِ کارت. مسیرِ کوتاه‌تر هم طبیعی‌تر است هم کمتر جلوی متن می‌ماند.
// اسلاتِ دقیقاً وسط (n فرد) با زوج/فردِ ایندکس تقسیم می‌شود تا همه‌ی کارت‌ها یک‌طرفه نروند.
export function sideFor(slotIndex, n) {
  const slots = rowSlots(n);
  const s = slots[slotIndex];
  if (!s) return slotIndex % 2 === 0 ? 'R' : 'L';
  const cx = s.x + s.w / 2;
  if (Math.abs(cx - W / 2) < 1) return slotIndex % 2 === 0 ? 'R' : 'L';
  return cx < W / 2 ? 'L' : 'R';
}

// آیا این جابه‌جایی اصلاً از باندِ عمودیِ باکس رد می‌شود؟ اگر نه، دالان لازم نیست و مسیر مستقیم
// و نرم‌تر است. با بزرگ‌ترین ارتفاعِ مسیر سنجیده می‌شود تا محافظه‌کار بماند.
export function crossesSafeBand(from, to) {
  const hMax = Math.max(from.h, to.h);
  const above = Math.max(from.y, to.y) + hMax <= SAFE_BOX.y;
  const below = Math.min(from.y, to.y) >= SAFE_BOX.y + SAFE_BOX.h;
  return !(above || below);
}

// گیتِ امنیت. ۱ یعنی «همین حالا باید کاملاً داخلِ دالان باشی».
// رمپ از خودِ نقاطِ ابتدا/انتهای مسیر گرفته می‌شود تا در دو سرِ مسیر دقیقاً صفر باشد؛ یعنی
// کارت در جای نشسته‌اش هیچ کشیدگیِ ناخواسته‌ای به سمتِ دالان ندارد.
export function corridorGate(y, h, y0, y1) {
  const topClear = SAFE_BOX.y - h; // بیشترین yای که هنوز از بالا امن است
  const botClear = SAFE_BOX.y + SAFE_BOX.h; // کمترین yای که از پایین امن است
  if (y > topClear && y < botClear) return 1;
  if (y <= topClear) {
    const a = Math.min(y0, y1, topClear);
    const span = topClear - a;
    return span <= 0 ? 1 : smoothstep((y - a) / span);
  }
  const b = Math.max(y0, y1, botClear);
  const span = b - botClear;
  return span <= 0 ? 1 : smoothstep((b - y) / span);
}

// پنجره‌های زمانیِ حس (نه امنیت): x زود به سمتِ دالان می‌رود و دیر از آن بیرون می‌آید،
// ارتفاع دیر بزرگ و زود کوچک می‌شود تا لحظه‌ی عبور همیشه لاغرترین حالت باشد.
const X_IN_END = 0.34;
const X_OUT_START = 0.66;
const H_GROW = [0.58, 1];
const H_SHRINK = [0, 0.42];

/**
 * مسیرِ تضمین‌شده‌ی یک کارت از مستطیلِ `from` به `to`.
 * `side` = 'L' | 'R' دالانِ عبور. `t` نرمال‌شده در [0,1].
 * خروجی همیشه یا کاملاً بیرونِ باندِ عمودیِ باکس است یا کاملاً داخلِ دالان.
 */
export function corridorPath(from, to, side, t) {
  const tt = clamp01(t);
  const grow = to.h >= from.h;
  const hWin = grow ? H_GROW : H_SHRINK;
  const hRaw = lerp(from.h, to.h, easeInOut(sub(tt, hWin[0], hWin[1])));
  const yRaw = lerp(from.y, to.y, easeInOut(tt));

  if (!crossesSafeBand(from, to)) {
    // مسیرِ مستقیم: هیچ نقطه‌ای از آن نمی‌تواند به باکس برسد، پس دالان فقط حرکت را زشت می‌کرد.
    const w = cardW(hRaw);
    const e = easeInOut(tt);
    return { x: lerp(from.x, to.x, e), y: yRaw, w, h: hRaw };
  }

  const inner = corridorInner(side);
  const wRaw = cardW(hRaw);
  const anchorX = inner.cx - wRaw / 2;
  const inF = easeInOut(sub(tt, 0, X_IN_END));
  const outF = easeInOut(sub(tt, X_OUT_START, 1));
  const xRaw = lerp(lerp(from.x, anchorX, inF), to.x, outF);

  const gateT = Math.min(
    smoothstep(sub(tt, 0, X_IN_END)),
    smoothstep(sub(1 - tt, 0, 1 - X_OUT_START)),
  );
  const gate = Math.max(gateT, corridorGate(yRaw, hRaw, from.y, to.y));

  // کارتِ بزرگ‌شده در دالان جا نمی‌شود، پس ارتفاع هم بخشی از قرارداد امنیت است نه فقط x.
  const hFit = Math.min(hRaw, corridorMaxCardH(side));
  const h = lerp(hRaw, hFit, gate);
  const w = cardW(h);
  const x = lerp(xRaw, inner.cx - w / 2, gate);
  return { x, y: yRaw, w, h };
}

// ---------------------------------------------------------------------------
// فنِ اینترو
// ---------------------------------------------------------------------------

// زاویه‌ی اسلاتِ k از فنِ count تایی. اسلاتِ ۰ راست‌ترین است تا با ترتیبِ RTLِ بقیه‌ی لایوت بخواند.
export function fanAngle(k, count = FAN.count) {
  return FAN.spreadDeg * ((count - 1) / 2 - k);
}
// اسلاتِ کارتِ واقعیِ i در فن: n کارت را در کلِ پهنای دک پخش می‌کند تا کارت‌های تزئینی بینشان بمانند.
export function fanSlotFor(i, n, count = FAN.count) {
  const c = Math.max(1, count);
  const nn = Math.max(1, n);
  return Math.max(0, Math.min(c - 1, Math.round(((i + 0.5) * c) / nn - 0.5)));
}
export function decorSlots(n, count = FAN.count) {
  const taken = new Set();
  for (let i = 0; i < n; i++) taken.add(fanSlotFor(i, n, count));
  const out = [];
  for (let k = 0; k < count; k++) if (!taken.has(k)) out.push(k);
  return out;
}
// مستطیلِ اسلاتِ فن. `rotate` چرخشِ z (درجه) است و فقط بصری است؛ مستطیلِ برگشتی محورمحور
// می‌ماند چون تمامِ چکِ امنیت روی همان انجام می‌شود.
export function fanRect(k, count, h) {
  const a = fanAngle(k, count) * deg;
  const { w, h: hh } = cardSize(h);
  const cx = FAN.cx + FAN.radius * Math.sin(a);
  const cy = FAN.pivotY - FAN.radius * Math.cos(a);
  return { x: cx - w / 2, y: cy - hh / 2, w, h: hh, rotate: fanAngle(k, count) };
}

// زیربازه‌های اینترو. تیونِ ریتمِ اینترو فقط از همین‌جا.
export const INTRO_PHASES = { fan: [0, 0.25], pull: [0.25, 0.5], flip: [0.5, 0.75], fly: [0.75, 1] };
// دکِ بسته از پایینِ قاب بالا می‌آید؛ این مقدار «چقدر پایین‌تر» است.
const FAN_ENTER_DY = 320;
// در صحنه‌ی focus بقیه‌ی کارت‌ها محو می‌شوند تا چشم روی کارتِ فعال بماند.
export const DIM_OPACITY = 0.42;

function introFly(i, n) {
  const [a, b] = INTRO_PHASES.fly;
  const span = b - a;
  const stagger = n > 1 ? (span * 0.4) / (n - 1) : 0;
  const start = a + i * stagger;
  return [start, start + (span - stagger * (n - 1))];
}

function introRect(t, i, n) {
  const fanH = revealSlots(n)[0]?.h || 0;
  const kSlot = fanSlotFor(i, n);
  const fan = fanRect(kSlot, FAN.count, fanH);
  const rev = revealSlots(n)[i];
  const row = rowSlots(n)[i];

  const pFan = sub(t, INTRO_PHASES.fan[0], INTRO_PHASES.fan[1]);
  const pPull = sub(t, INTRO_PHASES.pull[0], INTRO_PHASES.pull[1]);
  const pFlip = sub(t, INTRO_PHASES.flip[0], INTRO_PHASES.flip[1]);
  const [fa, fb] = introFly(i, n);
  const pFly = sub(t, fa, fb);

  // ۱) باز شدنِ فن: کارت‌ها از پایینِ قاب و از حالتِ روی‌هم به زاویه‌ی خودشان می‌رسند.
  const open = easeOut(pFan);
  const closed = fanRect(Math.floor((FAN.count - 1) / 2), FAN.count, fanH);
  const fanNow = {
    x: lerp(closed.x, fan.x, open),
    y: lerp(closed.y + FAN_ENTER_DY, fan.y, open),
    w: fan.w,
    h: fan.h,
    rotate: lerp(0, fan.rotate, open),
  };

  // ۲) بیرون کشیده شدن از دک به ردیفِ رو شدن.
  const pull = easeInOut(pPull);
  const pulled = {
    x: lerp(fanNow.x, rev.x, pull),
    y: lerp(fanNow.y, rev.y, pull),
    w: rev.w,
    h: rev.h,
    rotate: lerp(fanNow.rotate, 0, pull),
  };

  // ۳) فلیپ سرِ جا، ۴) پرواز به ردیفِ بالا از دالان.
  const flying = pFly > 0;
  const base = flying ? corridorPath(rev, row, sideFor(i, n), pFly) : pulled;

  return {
    x: base.x,
    y: base.y,
    w: base.w,
    h: base.h,
    rotate: flying ? 0 : pulled.rotate,
    rotateY: lerp(180, 0, easeInOut(pFlip)),
    opacity: easeOut(sub(t, 0, 0.08)),
    z: 10 + i,
  };
}

// کارت‌های تزئینیِ دک: با فن باز می‌شوند، هنگام کشیده‌شدنِ کارت‌های اصلی محو و به پایینِ قاب
// سُر می‌خورند. چون فقط به سمتِ پایین می‌روند، هیچ‌وقت به باندِ باکس نزدیک نمی‌شوند.
export function deckRectAt({ t, k, n }) {
  const fanH = revealSlots(n)[0]?.h || 0;
  const fan = fanRect(k, FAN.count, fanH);
  const closed = fanRect(Math.floor((FAN.count - 1) / 2), FAN.count, fanH);
  const open = easeOut(sub(t, INTRO_PHASES.fan[0], INTRO_PHASES.fan[1]));
  const away = easeInOut(sub(t, INTRO_PHASES.pull[0], INTRO_PHASES.pull[1] + 0.08));
  return {
    x: lerp(closed.x, fan.x, open),
    y: lerp(closed.y + FAN_ENTER_DY, fan.y, open) + away * 520,
    w: fan.w,
    h: fan.h,
    rotate: lerp(0, fan.rotate, open),
    rotateY: 180,
    opacity: easeOut(sub(t, 0, 0.08)) * (1 - away),
    z: k,
  };
}

// ---------------------------------------------------------------------------
// تابعِ محوری
// ---------------------------------------------------------------------------

function normScene(scene) {
  if (typeof scene === 'string') return { kind: scene };
  if (scene && typeof scene === 'object') return scene;
  return { kind: 'verdict' };
}

// حضورِ کارتِ فعال در صحنه‌ی focus: ۰ سرِ ورود و خروج، ۱ وسطِ نگه‌داشت. برای محوکردنِ بقیه.
function focusPresence(t, flyIn, flyOut) {
  return Math.min(smoothstep(sub(t, 0, flyIn)), smoothstep(sub(1 - t, 0, flyOut)));
}

/**
 * مستطیل و حالتِ کارتِ i (از n کارت) در لحظه‌ی t از صحنه‌ی `scene`.
 * `scene`: 'intro' | { kind:'focus', card, flyIn?, flyOut? } | 'verdict' (یا هر صحنه‌ی متنیِ دیگر).
 * خروجی: { x, y, w, h, rotateY, rotate, opacity, z }
 *   rotateY = فلیپِ پشت/رو (درجه)، rotate = کجیِ z در فن (درجه)، z = ترتیبِ روی‌هم افتادن.
 */
export function cardRectAt({ scene, t, i, n }) {
  const s = normScene(scene);
  const count = Math.max(0, Math.floor(n) || 0);
  const idx = Math.max(0, Math.floor(i) || 0);
  const tt = clamp01(t);
  const row = rowSlots(count)[idx];
  if (!row) return { x: 0, y: 0, w: 0, h: 0, rotateY: 0, rotate: 0, opacity: 0, z: 0 };

  if (s.kind === 'intro') return introRect(tt, idx, count);

  if (s.kind === 'focus') {
    const flyIn = clamp01(s.flyIn ?? 0.2);
    const flyOut = clamp01(s.flyOut ?? 0.2);
    // اگر پرواز رفت و برگشت با هم از کلِ صحنه بیشتر شد، هر دو به نسبت کوچک می‌شوند تا
    // همیشه یک لحظه‌ی «نگه‌داشت» باقی بماند (کارت هرگز وسطِ راه برنگردد).
    const k = flyIn + flyOut > 0.96 ? 0.96 / (flyIn + flyOut) : 1;
    const fi = Math.max(1e-4, flyIn * k);
    const fo = Math.max(1e-4, flyOut * k);
    const target = focusRect();
    const side = sideFor(idx, count);

    if (idx !== (Math.floor(s.card) || 0)) {
      const dim = lerp(1, DIM_OPACITY, focusPresence(tt, fi, fo));
      return { ...row, rotateY: 0, rotate: 0, opacity: dim, z: idx };
    }
    let r;
    if (tt < fi) r = corridorPath(row, target, side, tt / fi);
    else if (tt > 1 - fo) r = corridorPath(target, row, side, (tt - (1 - fo)) / fo);
    else r = target;
    return { ...r, rotateY: 0, rotate: 0, opacity: 1, z: 100 };
  }

  // verdict و هر صحنه‌ی متنیِ دیگر: کارت‌ها ساکن سرِ جای خودشان.
  return { ...row, rotateY: 0, rotate: 0, opacity: 1, z: idx };
}

// راحتیِ JSX: کلِ ردیف در یک فراخوانی.
export function cardRectsAt({ scene, t, n }) {
  const count = Math.max(0, Math.floor(n) || 0);
  const out = [];
  for (let i = 0; i < count; i++) out.push(cardRectAt({ scene, t, i, n: count }));
  return out;
}
