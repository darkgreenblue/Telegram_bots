// نمودارهای درون‌خطیِ داشبورد — SVG/HTML خالص، بدون هیچ کتابخانه و هیچ منبع خارجی
// (قاعده‌ی داشبورد: صفحه self-contained می‌ماند).
//
// انتخابِ رنگ «محاسبه‌شده» است نه سلیقه‌ای: پالت زیر با ولیدیتورِ استانداردِ دیتاویز روی
// همین سطحِ سفیدِ کارت‌ها سنجیده شده (باندِ روشنایی، کفِ اشباع، جداییِ کوررنگی، کنتراست).
//   • سه‌تاییِ کیفی (هویت — مثلاً اندازه‌ی فال): آبی/نارنجی/سبزآبی، تستِ all-pairs پاس.
//   • رمپِ ترتیبی (بزرگیِ مرتب — نمره‌ی ۱ تا ۵، ماندگاری): تک‌رنگِ آبی، پنج پله‌ی روشن به تیره.
//   • هر مقدارِ تک‌سری تک‌رنگ است (چند رنگ برای یک سری = رنگِ بی‌معنی).
// قواعدِ شکلِ نشانه: انتهای گردِ ۴ پیکسل، فاصله‌ی ۲ پیکسلی بینِ میله‌ها، محور/شبکه‌ی کم‌رنگ،
// و برچسبِ عددیِ مستقیم روی نشانه‌های مهم (نه روی تک‌تکِ نقاط).
import { esc, fmt } from './util.js';

/** سه‌تاییِ کیفی — فقط برای «هویت»، به همین ترتیبِ ثابت (هرگز چرخشی/تولیدی). */
export const CAT = ['#2a78d6', '#eb6834', '#1baf7a'];
/** رمپِ ترتیبیِ تک‌رنگ (روشن → تیره) — برای مقادیرِ مرتب. */
export const ORD = ['#86b6ef', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export const INK = '#1d2333';
export const DIM = '#6b7280';
export const GRID = '#e3e6ef';

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const pct = (v, t) => (t > 0 ? Math.round((v / t) * 1000) / 10 : 0);
// ارقامِ فارسی در **همه‌ی** برچسب‌ها (یک عددِ لاتین وسطِ صفحه‌ی فارسی بلافاصله دیده می‌شود)
const pctFa = (v, t) => `${fmt(pct(v, t))}٪`;

/* ── دونات: سهمِ چند دسته از یک کل. عمداً حداکثر سه برش (بیشتر از آن روی دایره
      قابلِ مقایسه نیست و به میله‌ی افقی تبدیل می‌شود). هویت هم با رنگ، هم با
      برچسبِ مستقیم و هم با لجند می‌آید — یعنی هرگز فقط با رنگ. ── */
export function donut(items, { size = 168, thickness = 26 } = {}) {
  const data = items.map((d, i) => ({ ...d, value: num(d.value), color: d.color || CAT[i % CAT.length] }));
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return '<p class="muted">داده‌ای برای این بازه نیست.</p>';
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const arcs = data.map((d) => {
    const frac = d.value / total;
    // فاصله‌ی ۲ پیکسلیِ سطح بینِ برش‌ها (نشانه‌ها به هم نمی‌چسبند)
    const len = Math.max(0, frac * circ - 2);
    const seg = `<circle r="${r}" cx="${c}" cy="${c}" fill="none" stroke="${d.color}" stroke-width="${thickness}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-acc * circ).toFixed(2)}" transform="rotate(-90 ${c} ${c})" stroke-linecap="butt"
      ><title>${esc(d.label)}: ${fmt(d.value)} (${pctFa(d.value, total)})</title></circle>`;
    acc += frac;
    return seg;
  }).join('');
  const legend = data.map(d => `<div style="display:flex;align-items:center;gap:7px;padding:2px 0">
      <span style="width:11px;height:11px;border-radius:3px;background:${d.color};flex:0 0 11px"></span>
      <span>${esc(d.label)}</span>
      <b style="margin-inline-start:auto">${fmt(d.value)}</b>
      <span class="muted" style="min-width:48px;text-align:left">${pctFa(d.value, total)}</span>
    </div>`).join('');
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" style="flex:0 0 auto">
      ${arcs}
      <text x="${c}" y="${c - 2}" text-anchor="middle" font-size="19" font-weight="700" fill="${INK}">${fmt(total)}</text>
      <text x="${c}" y="${c + 15}" text-anchor="middle" font-size="11" fill="${DIM}">کل</text>
    </svg>
    <div style="flex:1;min-width:190px">${legend}</div></div>`;
}

/* ── میله‌ی افقی: مقایسه‌ی بزرگیِ یک سنجه بینِ دسته‌ها (تک‌رنگ، مرتب‌شده).
      شکلِ درستِ «محبوب‌ترین موضوع» وقتی دسته‌ها زیادند؛ دایره در این تعداد ناخواناست. ── */
export function hbars(items, { color = CAT[0], showPct = true, empty = 'داده‌ای برای این بازه نیست.' } = {}) {
  const data = items.map(d => ({ ...d, value: num(d.value) }));
  const total = data.reduce((a, d) => a + d.value, 0);
  const max = Math.max(1, ...data.map(d => d.value));
  if (!data.length || !total) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="hbars">${data.map(d => `<div class="hb" title="${esc(d.label)}: ${fmt(d.value)}">
      <span class="hb-l">${esc(d.label)}</span>
      <span class="hb-t"><span class="hb-f" style="width:${(d.value / max * 100).toFixed(1)}%;background:${d.color || color}"></span></span>
      <b class="hb-v">${fmt(d.value)}</b>
      ${showPct ? `<span class="hb-p muted">${pctFa(d.value, total)}</span>` : ''}
    </div>`).join('')}</div>`;
}

/* ── ستونیِ ترتیبی: مقادیرِ مرتب (نمره‌ی ۱ تا ۵، ماندگاریِ D1..D30).
      رمپِ تک‌رنگ روشن→تیره، پس ترتیب با رنگ هم دیده می‌شود، نه فقط با جای ستون. ── */
export function ordinalBars(items, { height = 132, suffix = '', color = null } = {}) {
  const data = items.map(d => ({ ...d, value: num(d.value) }));
  const max = Math.max(1, ...data.map(d => d.value));
  if (!data.some(d => d.value)) return '<p class="muted">داده‌ای برای این بازه نیست.</p>';
  /* رمپ روی **تعدادِ واقعیِ** ستون‌ها پخش می‌شود، نه clamp روی پله‌ی آخر. با clamp، هر
     ستونِ بعد از پنجمی هم‌رنگِ پنجمی می‌شد و رنگ دیگر «جایگاه در ترتیب» را نمی‌گفت
     (دیده‌شده روی هفت سطلِ کدنس). با یک سریِ تکی، رنگِ ثابت هم پذیرفته می‌شود. */
  const step = (i) => (data.length <= 1 ? ORD[ORD.length - 1]
    : ORD[Math.round((i / (data.length - 1)) * (ORD.length - 1))]);
  return `<div class="cols" style="--h:${height}px">${data.map((d, i) => {
    const h = Math.max(2, Math.round(d.value / max * height));
    const col = d.color || color || step(i);
    return `<div class="col" title="${esc(d.label)}: ${fmt(d.value)}${esc(suffix)}">
      <b class="col-v">${fmt(d.value)}${esc(suffix)}</b>
      <span class="col-b" style="height:${h}px;background:${col}"></span>
      <span class="col-l">${esc(d.label)}</span></div>`;
  }).join('')}</div>`;
}

/* ── سریِ زمانی (تک‌سری): سطح + خط + شبکه‌ی کم‌رنگ. جهتِ زمان عمداً چپ→راست می‌ماند
      (قراردادِ جهانیِ نمودارِ زمانی، حتی در صفحه‌ی راست‌چین). ── */
export function timeChart(points, { height = 190, color = CAT[0], area = true, label = '' } = {}) {
  const pts = points.map(p => ({ x: p.x, y: num(p.y) }));
  if (pts.length < 2) return '<p class="muted">هنوز نقطه‌ی کافی برای نمودار نیست.</p>';
  const W = 720, H = height, padB = 26, padT = 14, padX = 34;
  const max = Math.max(1, ...pts.map(p => p.y));
  const step = (W - padX * 2) / (pts.length - 1);
  const yOf = (v) => padT + (1 - v / max) * (H - padT - padB);
  const xOf = (i) => padX + i * step;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
  const fill = `${line} L${xOf(pts.length - 1).toFixed(1)},${H - padB} L${padX},${H - padB} Z`;
  // چهار خطِ شبکه + برچسبِ محورِ عمودی (کم‌رنگ و پس‌زمینه‌ای)
  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(max * f), y = yOf(v);
    return `<line x1="${padX}" x2="${W - padX}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${padX - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${DIM}">${fmt(v)}</text>`;
  }).join('');
  // برچسبِ افقی: فقط چند نقطه (نه همه) تا شلوغ نشود
  const every = Math.max(1, Math.ceil(pts.length / 7));
  const xlabels = pts.map((p, i) => (i % every === 0 || i === pts.length - 1)
    ? `<text x="${xOf(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${DIM}">${esc(p.x)}</text>` : '').join('');
  // نقاطِ نامرئیِ hover (هدفِ بزرگ‌تر از خودِ نشانه) با تولتیپِ بومیِ مرورگر
  const hover = pts.map((p, i) => `<circle cx="${xOf(i)}" cy="${yOf(p.y)}" r="9" fill="transparent"
    ><title>${esc(p.x)}: ${fmt(p.y)}${label ? ` ${esc(label)}` : ''}</title></circle>`).join('');
  return `<div dir="ltr" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
      preserveAspectRatio="none" style="min-width:520px;display:block">
    ${grid}
    ${area ? `<path d="${fill}" fill="${color}" opacity="0.12"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${xlabels}${hover}
  </svg></div>`;
}

/* ── 📈 نمودارِ ترند (صفحه‌ی «ترندها»): یک سنجه در طولِ زمان، تک‌سری ──
   تفاوت با `timeChart`:
   • **مقیاسِ یکنواخت** (بدونِ `preserveAspectRatio="none"`)، پس برچسب‌ها کش نمی‌آیند و
     کاشیِ کوچک کنارِ هم می‌نشیند (small multiples) بدونِ اسکرولِ افقی روی موبایل.
   • **جای خالی برای روزِ بی‌داده** (`null` ⟵ قطعِ خط، نه صفرِ ساختگی).
   • محورِ عمودیِ «تمیز» با منفی (سودِ روزانه) و کفِ دلخواه (نمره‌ی ۱ تا ۵).
   • سنجه‌ی «جریانی» (`avg`) دو لایه دارد: روزانه کم‌رنگ و نازک، میانگینِ ۷ روزه پررنگ؛
     هر دو یک هویت‌اند (یک رنگ) و لجندِ متنی زیرِ نمودار می‌آید (هرگز فقط رنگ).
   • **hover با خطِ عمودی که روی روز می‌چسبد** + تولتیپ (اسکریپتِ سراسریِ `html.js`، داده در
     `data-tc`)؛ بدونِ JS هم چیزی پنهان نمی‌ماند چون عددِ آخر روی کاشی و جدولِ روزانه زیرِ
     هر بخش هست. */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}

export function trendChart(points, { fmtV = (v) => fmt(v), fmtTick = fmtV, yMin = null, avg = null, height = 170, label = '' } = {}) {
  const ys = points.map((p) => (Number.isFinite(p.y) ? p.y : null));
  const as = avg ? avg.map((v) => (Number.isFinite(v) ? v : null)) : null;
  const vals = [...ys, ...(as || [])].filter((v) => v !== null);
  if (points.length < 2 || !vals.length) return '<p class="muted">هنوز نقطه‌ی کافی برای نمودار نیست.</p>';
  const W = 480, H = height, padL = 68, padR = 14, padT = 12, padB = 26;
  let lo = Math.min(yMin ?? 0, ...vals);
  let hi = Math.max(...vals);
  if (hi <= lo) hi = lo + (Math.abs(lo) || 1);
  const step = niceStep((hi - lo) / 3);
  if (yMin === null || lo < yMin) lo = Math.floor(lo / step) * step;
  hi = lo + Math.ceil((hi - lo) / step) * step;
  const xOf = (i) => padL + (i * (W - padL - padR)) / (points.length - 1);
  const yOf = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (arr) => {
    let d = '', pen = false;
    arr.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  const grid = ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}"
      stroke="${v === 0 && lo < 0 ? DIM : GRID}" stroke-width="1"${v === 0 && lo < 0 ? ' opacity="0.55"' : ''}/>`
    + `<text x="${padL - 7}" y="${(yOf(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${DIM}">${esc(fmtTick(v))}</text>`).join('');
  const n = points.length;
  const xIdx = [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])];
  const xl = xIdx.map((i) => `<text x="${xOf(i).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}"
      font-size="11" fill="${DIM}">${esc(points[i].x)}</text>`).join('');
  const main = as || ys;
  const color = CAT[0];
  let lastI = -1;
  main.forEach((v, i) => { if (v !== null) lastI = i; });
  const baseY = yOf(Math.max(lo, 0));
  // سطحِ کم‌رنگ فقط برای سری‌ای که به صفر تکیه دارد و پیوسته است (سطحِ بریده گمراه می‌کند)
  const area = !as && lo >= 0 && ys.every((v) => v !== null)
    ? `<path d="${path(ys)} L${xOf(n - 1).toFixed(1)},${baseY.toFixed(1)} L${xOf(0).toFixed(1)},${baseY.toFixed(1)} Z" fill="${color}" opacity="0.1"/>` : '';
  const lines = as
    ? `<path d="${path(ys)}" fill="none" stroke="${ORD[0]}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
       <path d="${path(as)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    : `<path d="${path(ys)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const endDot = lastI >= 0
    ? `<circle cx="${xOf(lastI).toFixed(1)}" cy="${yOf(main[lastI]).toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/>` : '';
  // دیتای hover: مختصاتِ x/y در واحدِ viewBox + متنِ آماده (ارقامِ فارسی). اسکریپت فقط textContent می‌گذارد.
  const data = points.map((p, i) => [
    Number(xOf(i).toFixed(1)),
    main[i] === null ? null : Number(yOf(main[i]).toFixed(1)),
    p.title || p.x,
    ys[i] === null ? '' : fmtV(ys[i]),
    as ? (as[i] === null ? '' : fmtV(as[i])) : null,
  ]);
  return `<div class="tc" dir="ltr">
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" tabindex="0" aria-label="${esc(label)}"
      data-tc="${esc(JSON.stringify(data))}" data-w="${W}" data-top="${padT}" data-bot="${H - padB}">
      ${grid}${area}${lines}${endDot}${xl}
      <line class="tc-xh" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="${INK}" stroke-width="1" opacity="0"/>
      <circle class="tc-dot" r="4" fill="${color}" stroke="#fff" stroke-width="2" opacity="0"/>
    </svg>
    <div class="tc-tip" hidden></div>
    ${as ? `<div class="tc-key"><span><i style="background:${ORD[0]}"></i>روزانه</span><span><i style="background:${color};height:3px"></i>میانگینِ ۷ روزه</span></div>` : ''}
  </div>`;
}
