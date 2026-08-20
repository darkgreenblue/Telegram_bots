// text.js — جاکردنِ متنِ فارسی در یک مستطیل، بدون اندازه‌گیریِ واقعیِ مرورگر.
//
// چرا تخمین و نه اندازه‌گیری: کامپوزیشن باید **قبل از رندر** بداند هر اسلاید چند ثانیه است
// (زمان‌بندی از تعدادِ کاراکتر می‌آید) و باید بداند متن به چند صفحه می‌شکند. اندازه‌گیریِ واقعی
// فقط داخلِ مرورگرِ رندر ممکن است، یعنی بعد از تصمیمِ زمان‌بندی. پس مدلِ سبکِ زیر استفاده می‌شود:
//   عرضِ میانگینِ نویسه ≈ 0.52 × اندازه‌ی فونت (اندازه‌گیریِ چشمیِ وزیرمتن روی متنِ فارسیِ روان)
//   ارتفاعِ خط = 1.6 × اندازه‌ی فونت
// تخمین عمداً کمی محافظه‌کار است: چند پیکسل فضای خالیِ اضافه از سرریزِ متن بهتر است.
//
// دو قاعده‌ی سخت در صفحه‌بندی:
//   ۱) برش فقط روی مرزِ جمله. جمله‌ی نصفه در یک اسلاید، متن را بی‌معنی می‌کند.
//      استثنا: جمله‌ای که خودش از یک صفحه بلندتر است، آن‌وقت روی مرزِ کلمه.
//   ۲) هیچ کاراکتری گم نمی‌شود و هیچ صفحه‌ی خالی ساخته نمی‌شود. چسباندنِ صفحه‌ها با فاصله
//      باید دقیقاً همان متنِ نرمال‌شده را بدهد.

export const AVG_CHAR_RATIO = 0.52;
export const LINE_HEIGHT = 1.6;

// «—» امضای متنِ ماشینی است و در این ریپو در هیچ متنِ رو-به-کاربری مجاز نیست.
// این تابع شبکه‌ی ایمنی است: اگر مدل با وجودِ پرامپت باز هم خط تیره تولید کرد، اینجا گرفته می‌شود.
export function stripDash(t) {
  return String(t ?? '')
    .replace(/\s*(—|–|--)\s*/g, '، ')
    .replace(/\s*،\s*،\s*/g, '، ')
    .replace(/\s+،/g, '،')
    .replace(/،(?=\S)/g, '، ');
}

// نرمال‌سازیِ فاصله‌ها: خطِ خالی و فاصله‌ی تکراری هم در تخمینِ خط اشتباه می‌سازد هم در
// مقایسه‌ی «چیزی گم نشده» نویز است.
export function normalizeWs(t) {
  return String(t ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ‌]*\n[ \t ]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t ]{2,}/g, ' ')
    .trim();
}

const DELIMS = new Set(['.', '؟', '!', '؛', '?', '\n', '…']);

// برش به واحدهای جمله. علامت‌های پشتِ سرِ هم («؟!») با هم بلعیده می‌شوند تا یک جمله به
// دو تکه‌ی بی‌معنی («جمله؟» و «!») تبدیل نشود.
export function splitSentences(text) {
  const src = normalizeWs(text);
  const out = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    buf += ch;
    if (DELIMS.has(ch)) {
      while (i + 1 < src.length && DELIMS.has(src[i + 1])) buf += src[++i];
      const s = buf.trim();
      if (s) out.push(s);
      buf = '';
    }
  }
  const rest = buf.trim();
  if (rest) out.push(rest);
  return out;
}

export function charsPerLine(boxW, fontSize) {
  return Math.max(1, Math.floor(boxW / (fontSize * AVG_CHAR_RATIO)));
}
export function maxLinesIn(boxH, fontSize) {
  return Math.max(0, Math.floor(boxH / (fontSize * LINE_HEIGHT)));
}

// شکستنِ حریصانه روی مرزِ کلمه. کلمه‌ی بلندتر از یک خط عمداً سرریز می‌شود و وسطش شکسته
// نمی‌شود: در فارسی شکستنِ وسطِ کلمه خواندن را خراب می‌کند و چنین کلمه‌ای هم تقریباً وجود ندارد.
export function wrapText(text, cpl) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cpl) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// خط‌های آماده‌ی رندر (اگر JSX خواست خودش خط‌ها را بچیند). خطِ جدیدِ متنِ اصلی حفظ می‌شود.
export function wrapLines(text, box, fontSize) {
  const cpl = charsPerLine(box.w, fontSize);
  const out = [];
  for (const para of normalizeWs(text).split('\n')) {
    const lines = wrapText(para, cpl);
    if (lines.length) out.push(...lines);
  }
  return out;
}

export function linesNeeded(text, box, fontSize) {
  return wrapLines(text, box, fontSize).length;
}
export function fitsIn(text, box, fontSize) {
  const max = maxLinesIn(box.h, fontSize);
  return max >= 1 && linesNeeded(text, box, fontSize) <= max;
}

// بزرگ‌ترین اندازه‌ای که کلِ متن در باکس جا شود. اگر هیچ اندازه‌ای جا نشد، `min` برمی‌گردد
// (رندر کمی سرریز می‌کند ولی متن دست‌نخورده می‌ماند؛ حذفِ متن هرگز گزینه نیست).
export function fitFontSize(text, box, opts = {}) {
  const min = opts.min ?? 30;
  const max = opts.max ?? 56;
  const step = opts.step ?? 2;
  for (let s = max; s > min; s -= step) {
    if (fitsIn(text, box, s)) return s;
  }
  return min;
}

// چیدنِ واحدهای جمله در صفحه‌ها با سقفِ خط. جمله‌ای که خودش از یک صفحه بلندتر است روی
// مرزِ کلمه به تکه‌های ≤ سقف بریده می‌شود.
function packUnits(units, cpl, maxLines) {
  const pages = [];
  let cur = [];
  let curLines = 0;
  const flush = () => {
    if (cur.length) {
      pages.push(cur.join(' '));
      cur = [];
      curLines = 0;
    }
  };
  for (const u of units) {
    const lines = wrapText(u, cpl);
    if (!lines.length) continue;
    if (lines.length > maxLines) {
      flush();
      for (let s = 0; s < lines.length; s += maxLines) {
        pages.push(lines.slice(s, s + maxLines).join(' '));
      }
      continue;
    }
    if (curLines + lines.length > maxLines) flush();
    cur.push(u);
    curLines += lines.length;
  }
  flush();
  return pages;
}

/**
 * صفحه‌بندیِ متن در یک باکس.
 * opts: { min, max, step, maxPages, minPages }
 * خروجی: { pages: [string], fontSize }
 * بزرگ‌ترین فونتی انتخاب می‌شود که تعدادِ صفحه از `maxPages` بیشتر نشود (فونتِ کوچک‌تر = صفحه‌ی کمتر).
 * `minPages` یک خواسته‌ی نرم است: اگر متن آن‌قدر کوتاه باشد که تقسیمش مسخره شود، رعایت نمی‌شود.
 */
export function paginateToFit(text, box, opts = {}) {
  const min = opts.min ?? 30;
  const max = opts.max ?? 56;
  const step = opts.step ?? 2;
  const maxPages = Math.max(1, opts.maxPages ?? 3);
  const minPages = Math.max(1, opts.minPages ?? 1);

  const clean = normalizeWs(stripDash(text));
  if (!clean) return { pages: [], fontSize: max };
  const units = splitSentences(clean);

  // فونتِ کوچک‌تر یعنی متنِ بیشتر در هر صفحه یعنی صفحه‌ی کمتر؛ پس از بزرگ به کوچک می‌رویم و
  // اولین اندازه‌ای که سقفِ صفحه را رعایت کند، بزرگ‌ترینِ قابلِ قبول است.
  let chosen = null;
  let smallest = null;
  for (let s = max; s >= min; s -= step) {
    const maxLines = maxLinesIn(box.h, s);
    if (maxLines < 1) continue;
    const pages = packUnits(units, charsPerLine(box.w, s), maxLines);
    smallest = { fontSize: s, pages, maxLines };
    if (pages.length <= maxPages) {
      chosen = smallest;
      break;
    }
  }
  // هیچ اندازه‌ای سقفِ صفحه را رعایت نکرد: کوچک‌ترین فونت کمترین صفحه را می‌دهد. سقف شکسته
  // می‌شود ولی هیچ کاراکتری حذف نمی‌شود (قاعده‌ی ۲ بر سقفِ صفحه اولویت دارد).
  if (!chosen) chosen = smallest;
  if (!chosen) {
    const maxLines = Math.max(1, maxLinesIn(box.h, min));
    chosen = { fontSize: min, pages: packUnits(units, charsPerLine(box.w, min), maxLines), maxLines };
  }

  // کفِ تعدادِ صفحه: سقفِ خطِ هر صفحه را دستی پایین می‌آوریم تا متن به چند اسلاید تقسیم شود.
  // خواسته‌ی مالک است (جمع‌بندیِ فال باید نفس‌گیر و چندتکه باشد، نه یک دیوارِ متن).
  if (chosen.pages.length < minPages && chosen.pages.length > 0) {
    const totalLines = units.reduce(
      (a, u) => a + wrapText(u, charsPerLine(box.w, chosen.fontSize)).length,
      0,
    );
    const cap = Math.max(1, Math.min(chosen.maxLines, Math.ceil(totalLines / minPages)));
    const forced = packUnits(units, charsPerLine(box.w, chosen.fontSize), cap);
    if (forced.length >= minPages && forced.length <= maxPages && forced.every((p) => p.trim())) {
      chosen = { ...chosen, pages: forced };
    }
  }

  return { pages: chosen.pages.filter((p) => p && p.trim()), fontSize: chosen.fontSize };
}
