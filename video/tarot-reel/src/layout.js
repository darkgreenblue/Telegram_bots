// layout.js — همه‌ی اعدادِ هندسیِ قابِ ۱۰۸۰×۱۹۲۰، در یک جا و نام‌دار.
//
// چرا ناحیه‌بندی این شکلی است:
// این ویدیو زیرِ استیکرِ «سوال» اینستاگرام پخش می‌شود. آن استیکر یک مستطیلِ ثابت وسطِ قاب را
// می‌پوشاند (`SAFE_BOX`) و هر چیزی که پشتش برود، برای بیننده اصلاً وجود ندارد. پس قاب عمداً
// به چهار ناحیه‌ی جدا تقسیم شده و هیچ عنصری هرگز واردِ باکس نمی‌شود:
//   ۱) نوارِ بالا (`TOP_ROW`)      → کارت‌های کوچکِ ثابت؛ همیشه بالای باکس می‌مانند.
//   ۲) دو دالانِ کناری             → **تنها** مسیرِ مجازِ عبورِ کارت از بالا به پایین و برعکس.
//   ۳) ناحیه‌ی پایین               → کارتِ بزرگ‌شده (`FOCUS_CARD`) و کپشنِ تفسیر (`CAPTION_BOX`).
//   ۴) `VERDICT_BOX`               → متنِ جوابِ نهایی، وقتی کارت‌ها بالا نشسته‌اند و کلِ پایین آزاد است.
//
// چرا دالان به‌جای «رد شدن از وسط با شفافیت»: محوکردنِ کارت هنگام عبور از باکس هم زشت است و هم
// اثباتش سخت؛ ولی «کارت هرگز واردِ این مستطیل نمی‌شود» یک شرطِ هندسیِ ساده است که چکِ CI
// می‌تواند روی هر فریم بسنجد. کلِ منطقِ موشن روی همین قابلِ‌اثبات‌بودن بنا شده.
//
// کجا تیون می‌شود:
//   • جای استیکر عوض شد → فقط `SAFE_BOX` و بعد `CORRIDOR_L/R` (که باید دقیقاً چپ و راستِ آن بچسبند).
//   • کارت‌ها کوچک/بزرگ به نظر رسیدند → `TOP_ROW.cardH` و `FOCUS_CARD.h`.
//   • متن سرریز کرد → `CAPTION_BOX`/`VERDICT_BOX` را بزرگ کن، نه اینکه فونتِ کمینه را پایین بیاوری
//     (زیرِ ~۳۰px روی موبایل خوانا نیست).
//   • تمِ رنگی → `THEMES`. تیره‌بودن عمدی است: کارت‌ها روشن‌اند و کنتراست باید بالا بماند.

export const W = 1080;
export const H = 1920;
export const FPS = 30;

// ── ناحیه‌ی امنِ رابطِ کاربریِ اینستاگرام ─────────────────────────────────────
// اینستاگرام بالا و پایینِ قاب را با رابطِ خودش می‌پوشاند: در استوری نوارِ پروفایل و
// «ارسال پیام»، در ریلز کپشن و نامِ صدا و دکمه‌های سمتِ راست. هرچه در این دو نوار بیفتد
// برای بیننده وجود ندارد. رندرِ اولِ همین پروژه دقیقاً همین را نشان داد: خطِ آخرِ تفسیرِ
// هر کارت زیرِ نوارِ پایین می‌رفت.
// عددها از گایدلاینِ متا: ~۲۵۰ پیکسل بالا، و پایین در استوری ~۲۵۰ ولی در ریلز تا ~۴۲۰.
// چون همین ویدیو هم استوری (با استیکرِ سوال) و هم ریلز منتشر می‌شود، سخت‌گیرانه‌تر گرفته
// شده تا در هر دو سالم بماند. اگر فقط استوری منتشر شد، کم‌کردنِ همین یک عدد فضای بیشتری می‌دهد.
export const UI_SAFE_TOP = 250;
export const UI_SAFE_BOTTOM = 400;
export const CONTENT_TOP = UI_SAFE_TOP;              // 250
export const CONTENT_BOTTOM = 1920 - UI_SAFE_BOTTOM; // 1520

// جای خالیِ استیکرِ «سوال» اینستاگرام. مقدس: هیچ چیزی هرگز واردش نمی‌شود.
// ⚠️ سوالِ فال **روی ویدیو نوشته نمی‌شود**؛ مالک آن را در خودِ استیکرِ اینستاگرام تایپ
// می‌کند و این مستطیل فقط جایش را باز نگه می‌دارد.
// عرضش عمداً از استیکرِ پیش‌فرضِ اینستاگرام باریک‌تر است: اگر تمامِ پهنا را بگیرد، دو
// دالانِ کناری از بین می‌روند و کارت هیچ راهی برای رفتن از بالا به پایین ندارد جز عبور
// از روی باکس. موقعِ انتشار، استیکر را به اندازه‌ی همین مستطیل کوچک کن.
export const SAFE_BOX = { x: 200, y: 480, w: 680, h: 280 };

// دالان‌ها دقیقاً به لبه‌های چپ و راستِ باکس می‌چسبند تا هیچ شکافِ بی‌استفاده‌ای نماند.
export const CORRIDOR_L = { x: 0, w: SAFE_BOX.x };
export const CORRIDOR_R = { x: SAFE_BOX.x + SAFE_BOX.w, w: 1080 - (SAFE_BOX.x + SAFE_BOX.w) };
// حاشیه‌ی داخلیِ دالان: کارت دقیقاً به لبه‌ی باکس نچسبد (هم زشت است، هم خطای ممیزِ شناور را می‌بلعد).
export const CORRIDOR_PAD = 12;

// همه‌ی ناحیه‌های زیر داخلِ بازه‌ی [CONTENT_TOP, CONTENT_BOTTOM] می‌نشینند و چکِ CI
// همین را می‌سنجد، وگرنه دوباره بی‌صدا زیرِ رابطِ اینستاگرام می‌روند.
export const TOP_ROW = { y: 265, cardH: 175, gap: 26 };
// ⚠️ `cy` طوری انتخاب شده که لبه‌ی بالای کارت در محلِ استراحتش از حاشیه‌ی ایمنیِ باکس
// (`SAFE_BOX.y + h + SAFE_MARGIN` = ۷۸۴) **بیرون** بماند. اگر داخلش بیفتد، گیتِ دالان تا
// آخرین فریم ارتفاع را کلمپ نگه می‌دارد و رشدِ کارت در یک فریم اتفاق می‌افتد (باگِ پرش).
export const FOCUS_CARD = { cy: 1000, h: 420 };
export const CAPTION_BOX = { x: 70, y: 1230, w: 940, h: 290 };
export const VERDICT_BOX = { x: 70, y: 800, w: 940, h: 720 };
// برچسبِ نوعِ فال در اینترو. عمداً کوچک و بالای باکس: خودِ سوال روی ویدیو نمی‌آید،
// پس اینجا فقط یک نشانه‌ی کوتاه است که بیننده بداند چه نوع فالی را می‌بیند.
export const TITLE_BOX = { x: 70, y: 265, w: 940, h: 175 };

// هر دو باکسِ بالا یک سطرِ سرآمد دارند که متنِ اصلی نیست: نوعِ فال بالای سؤال، و نامِ کارت
// بالای تفسیر. اگر `fitFontSize` روی کلِ باکس حساب شود، متن دقیقاً به اندازه‌ی همان سطر
// سرریز می‌کند و در اینترو حتی می‌تواند به باندِ `SAFE_BOX` برسد. پس سهمِ سرآمد اینجا کسر
// می‌شود، در ماژولِ خالص، تا هم زمان‌بندی و هم رندر از یک عدد بخوانند.
export const TITLE_LABEL_H = 60;
export const CAPTION_HEAD_H = 60;
// جمع‌بندی چندتکه است و پایینِ `VERDICT_BOX` یک ردیفِ نقطه‌ی صفحه می‌گیرد (بیننده باید بداند
// متن ادامه دارد). این ارتفاع باید از **همان باکسی** کم شود که صفحه‌بندی با آن حساب می‌شود،
// وگرنه آخرین خطِ هر صفحه دقیقاً به اندازه‌ی همین ردیف زیرِ رابطِ اینستاگرام می‌رود.
export const VERDICT_DOTS_H = 46;
export function verdictTextBox() {
  return { x: VERDICT_BOX.x, y: VERDICT_BOX.y, w: VERDICT_BOX.w, h: VERDICT_BOX.h - VERDICT_DOTS_H };
}
export function titleTextBox() {
  return { x: TITLE_BOX.x, y: TITLE_BOX.y + TITLE_LABEL_H, w: TITLE_BOX.w, h: TITLE_BOX.h - TITLE_LABEL_H };
}
export function captionTextBox() {
  return { x: CAPTION_BOX.x, y: CAPTION_BOX.y + CAPTION_HEAD_H, w: CAPTION_BOX.w, h: CAPTION_BOX.h - CAPTION_HEAD_H };
}

// نسبتِ عرض به ارتفاعِ فایل‌های کارت. عکس‌ها ۴۵۰px عرض‌اند و ارتفاعشان کمی فرق می‌کند،
// پس نسبت اینجا قفل می‌شود و رندر با objectFit:'cover' اختلاف را می‌بلعد.
export const CARD_AR = 450 / 775;
// منبع ۴۵۰px است؛ بزرگ‌تر از ~۱.۲۵ برابر، پیکسل‌ها دیده می‌شوند.
export const MAX_CARD_W = 560;
export const MAX_CARD_H = MAX_CARD_W / CARD_AR;

// فن (دکِ هلالیِ اینترو). پیوتِ چرخش عمداً پایینِ قاب است تا کارت‌ها مثل دستِ ورق باز شوند
// و مرکزِ فن (y ≈ pivotY - radius) با خیالِ راحت زیرِ باکس بماند.
export const FAN = { cx: 540, pivotY: 1565, radius: 400, spreadDeg: 9, count: 7 };
// ردیفِ «رو شدن» وسطِ اینترو: پایین‌تر از باکس، بالاتر از کپشن.
export const REVEAL_ROW = { cy: 1160, gap: 26, maxW: 1000, maxH: 500 };

// تمِ تیره اجباری است: ویدیو در موبایل و اغلب زیرِ نورِ محیط دیده می‌شود و متنِ روشن روی زمینه‌ی
// تیره تنها ترکیبی است که در فشرده‌سازیِ اینستاگرام هم خوانا می‌ماند.
export const COLORS = {
  ink: '#f7f2ea',
  inkSoft: '#cfc4d8',
  gold: '#e9c47b',
  goldDim: '#a98b46',
  panel: 'rgba(10,7,18,0.62)',
  panelEdge: 'rgba(233,196,123,0.30)',
  shadow: 'rgba(0,0,0,0.55)',
};

export const THEMES = {
  mystic: { bg0: '#0b0714', bg1: '#1b1030', bg2: '#2a1147', glow: '#6f3cc4', particle: '#e9c47b' },
  nature: { bg0: '#07120d', bg1: '#0f2a1e', bg2: '#17402c', glow: '#2f8f5b', particle: '#cfe8a8' },
  minimal: { bg0: '#0d0d10', bg1: '#16161b', bg2: '#202027', glow: '#4a4a55', particle: '#e6e6ea' },
};
export function themeOf(name) {
  return THEMES[name] || THEMES.mystic;
}

// بازه‌های فونت به‌صورت داده نگه داشته می‌شوند چون `fitFontSize` آن‌ها را می‌گیرد؛ عددِ ثابتِ
// هاردکد در JSX یعنی متنِ بلند سرریز می‌کند و متنِ کوتاه گم می‌شود.
export const FONT = {
  family: "'Vazirmatn', system-ui, sans-serif",
  title: { min: 34, max: 58 },
  // کپشن کفِ پایین‌تری دارد چون `CAPTION_BOX` کوتاه است (فقط ۲۷۰px زیرِ کارتِ بزرگ) و تفسیرِ
  // یک کارت گاهی ۴۰۰ نویسه می‌شود. حذفِ متن ممنوع است، پس فونت اجازه‌ی نفس‌کشیدن می‌گیرد.
  caption: { min: 26, max: 52 },
  headline: { min: 36, max: 66 },
  verdict: { min: 30, max: 56 },
  label: 40,
  meta: 30,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ارتفاع همیشه ورودی است و عرض از آن ساخته می‌شود؛ سقفِ بزرگ‌نمایی روی **ارتفاع** اعمال می‌شود،
// چون کلمپ‌کردنِ خودِ عرض یعنی شکستنِ نسبت، یعنی دقیقاً همان کشیده‌شدنی که ممنوع است.
export function clampCardH(h) {
  return clamp(Number(h) || 0, 0, MAX_CARD_H);
}
export function cardW(h) {
  return clampCardH(h) * CARD_AR;
}
export function cardSize(h) {
  const hh = clampCardH(h);
  return { w: hh * CARD_AR, h: hh };
}

export function corridorOf(side) {
  return side === 'L' ? CORRIDOR_L : CORRIDOR_R;
}
// فضای واقعیِ قابلِ استفاده‌ی دالان (بعد از حاشیه) به‌همراه مرکزش.
export function corridorInner(side) {
  const c = corridorOf(side);
  const x = c.x + CORRIDOR_PAD;
  const w = c.w - CORRIDOR_PAD * 2;
  return { x, w, cx: x + w / 2 };
}
// بلندترین کارتی که هنوز در دالان جا می‌شود. سقفِ عبورِ کارتِ بزرگ‌شده همین است.
export function corridorMaxCardH(side) {
  return corridorInner(side).w / CARD_AR;
}

export function safeEdges() {
  return {
    left: SAFE_BOX.x,
    right: SAFE_BOX.x + SAFE_BOX.w,
    top: SAFE_BOX.y,
    bottom: SAFE_BOX.y + SAFE_BOX.h,
  };
}

// ردیفِ بالا: n کارتِ هم‌اندازه، وسط‌چین، به ترتیبِ **راست‌به‌چپ**.
// کارتِ اولِ فال باید سمتِ راست باشد چون چشمِ فارسی‌زبان از راست شروع می‌کند؛ پس اسلاتِ ۰
// بیشترین x را می‌گیرد.
export function rowSlots(n) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (!count) return [];
  const h = TOP_ROW.cardH;
  const w = cardW(h);
  const pitch = w + TOP_ROW.gap;
  const total = count * w + (count - 1) * TOP_ROW.gap;
  const startX = (W - total) / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: startX + (count - 1 - i) * pitch, y: TOP_ROW.y, w, h });
  }
  return out;
}

// ردیفِ «رو شدن» وسطِ اینترو. ارتفاع از تعدادِ کارت‌ها می‌آید تا ۵ کارت هم بدون همپوشانی جا شود.
export function revealCardH(n) {
  const count = Math.max(1, Math.floor(n) || 1);
  const wFit = (REVEAL_ROW.maxW - (count - 1) * REVEAL_ROW.gap) / count;
  return Math.min(REVEAL_ROW.maxH, wFit / CARD_AR);
}
export function revealSlots(n) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (!count) return [];
  const h = revealCardH(count);
  const w = cardW(h);
  const pitch = w + REVEAL_ROW.gap;
  const total = count * w + (count - 1) * REVEAL_ROW.gap;
  const startX = (W - total) / 2;
  const y = REVEAL_ROW.cy - h / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: startX + (count - 1 - i) * pitch, y, w, h });
  }
  return out;
}

// کارتِ بزرگ‌شده: وسطِ افقی، زیرِ باکس. عمداً از خودِ SAFE_BOX مستقل است تا اگر باکس جابه‌جا شد،
// این عدد هم دستی بازبینی شود (نه اینکه بی‌صدا زیرِ باکس برود).
export function focusRect() {
  const { w, h } = cardSize(FOCUS_CARD.h);
  return { x: (W - w) / 2, y: FOCUS_CARD.cy - h / 2, w, h };
}
