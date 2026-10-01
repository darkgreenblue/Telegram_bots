// 📈 ترندها — «همه‌ی عددهای صفحه‌ی اصلی، در بعدِ زمان» (خواسته‌ی مالک ۱۴۰۵/۰۷/۱۰).
//
// هر سنجه‌ی سرخطِ نمای کلی یک کاشی دارد: عددِ آخرین روزِ کامل، تغییرش نسبت به هفته‌ی قبل،
// و نمودارِ روزانه. تعریف‌ها و محاسبه در `lib/trends.js` است (همان تعریف‌های `gather`)؛ این
// فایل فقط می‌خواند و می‌کشد.
//
// دو منبع، و این دوگانگی عمدی است:
//   • سنجه‌های کاربرمحور ⟵ `trend_daily`ِ platform.db (ثبتِ شبانه، یخ‌زده)
//   • پول ⟵ زنده از `profitFor` (تنها درِ ورودِ سود؛ ورودی‌هایش بعداً دستی وارد می‌شوند)
// صفحه در cache worker ساخته می‌شود (`profitFor` دیتابیسِ ربات را می‌خواند و نباید در
// حلقه‌ی HTTP بنشیند).
import { botByKey, baseKey } from '../lib/bots.js';
import { scopeBot, MASTER_DASH_BOTS } from '../lib/nav.js';
import { profitFor } from '../lib/profit.js';
import { fmt, esc, nowSec } from '../lib/util.js';
import { rangePicker, cardHead } from '../lib/html.js';
import { trendChart } from '../lib/charts.js';
import { tehranDayNo } from '../lib/engage.js';
import {
  TREND_METRICS, storedSeries, firstNightDay, dayKeyOf, dayNoOfKey,
} from '../lib/trends.js';

export const TREND_RANGES = {
  d30: { label: '۳۰ روز', days: 30 },
  d90: { label: '۹۰ روز', days: 90 },
  all: { label: 'کل', days: 0 },
};
const RANGE_PARAM = 'rTr';

/* سنجه‌های پولی: زنده، از سریِ `profitFor`. `need: 'rate'` = بدونِ نرخِ دلار ساخته نمی‌شود. */
const MONEY = [
  { k: 'net_cum', g: 'hero', label: 'سودِ خالص (تجمعی)', unit: 'toman', kind: 'stock', good: 'up', need: 'rate',
    hint: 'درآمدِ دریافتی − هزینه‌ی مدل − هزینه‌ی تبلیغ، از ابتدای عمرِ ربات' },
  { k: 'rev_day', g: 'money', label: 'درآمدِ دریافتیِ روزانه', unit: 'toman', kind: 'flow', good: 'up' },
  { k: 'cost_day', g: 'money', label: 'هزینه‌ی روزانه (مدل + تبلیغ)', unit: 'toman', kind: 'flow', good: 'down', need: 'rate' },
  { k: 'net_day', g: 'money', label: 'سودِ خالصِ روزانه', unit: 'toman', kind: 'flow', good: 'up', need: 'rate' },
  { k: 'rev_cum', g: 'money', label: 'درآمدِ دریافتی (تجمعی)', unit: 'toman', kind: 'stock', good: 'up' },
  { k: 'margin', g: 'money', label: 'حاشیه‌ی سود (تجمعی)', unit: 'pct', kind: 'stock', good: 'up', need: 'rate' },
  { k: 'arpu', g: 'money', label: 'درآمد به ازای هر کاربر', unit: 'toman', kind: 'stock', good: 'up',
    hint: 'درآمدِ ثبت‌شده در خودِ ربات ÷ کل کاربران (همان کارتِ «درآمد»ِ نمای کلی)' },
];

const GROUPS = [
  ['hero', '🏆 سرخط'],
  ['engage', '🔥 درگیری و ماندگاری'],
  ['sat', '⭐ رضایت'],
  ['readings', '🔮 فال‌ها'],
  ['users', '👥 کاربران و فعالیت'],
  ['ret', '📈 ماندگاری از اولین فال'],
  ['money', '💳 درآمد و سود'],
  ['ref', '🤝 دعوت از دوستان'],
];

/* ── قالب‌بندیِ هر واحد (ارقامِ فارسی همه‌جا) ── */
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
function fmtUnit(unit, v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
  const x = Number(v);
  switch (unit) {
    case 'pct': return `${fmt(r1(x))}٪`;
    case 'dec': return fmt(r2(x));
    case 'toman': return `${fmt(Math.round(x))} ت`;
    case 'dur': return x < 3600 ? `${fmt(Math.round(x / 60))} دقیقه` : `${fmt(r1(x / 3600))} ساعت`;
    default: return fmt(Math.round(x));
  }
}
/* برچسبِ محور: کوتاه (هزار/میلیون) تا ستونِ محور باریک بماند */
function fmtTick(unit, v) {
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (unit === 'pct') return `${fmt(r1(v))}٪`;
  if (unit === 'dur') return `${fmt(r1(v))} دقیقه`;   // محورِ زمان به دقیقه کشیده می‌شود (پله‌های تمیز)
  if (a >= 1e6) return `${sign}${fmt(r1(a / 1e6))} میلیون`;
  if (a >= 1e4) return `${sign}${fmt(Math.round(a / 1e3))} هزار`;
  return unit === 'dec' ? fmt(r2(v)) : fmt(Math.round(v));
}

const jalali = (dayKey) => {
  try {
    return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'numeric', day: 'numeric' })
      .format(new Date(`${dayKey}T12:00:00+03:30`));
  } catch { return dayKey.slice(5); }
};
const jalaliLong = (dayKey) => {
  try {
    return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })
      .format(new Date(`${dayKey}T12:00:00+03:30`));
  } catch { return dayKey; }
};

/** میانگینِ متحرکِ ۷ روزه (فقط روی روزهای دارای داده؛ کمتر از ۴ نقطه ⟵ خالی). */
function rolling7(ys) {
  return ys.map((_, i) => {
    const w = ys.slice(Math.max(0, i - 6), i + 1).filter((v) => v !== null);
    return w.length >= 4 ? w.reduce((a, v) => a + v, 0) / w.length : null;
  });
}

/** تغییر نسبت به هفته‌ی قبل. stock: آخر − ۷ روز قبل؛ flow: میانگینِ ۷ روزِ آخر در برابرِ ۷ روزِ قبلش. */
function delta(m, ys) {
  const n = ys.length;
  if (n < 8) return null;
  let cur, prev;
  if (m.kind === 'flow') {
    if (n < 14) return null;
    const avg = (a) => { const w = a.filter((v) => v !== null); return w.length ? w.reduce((s, v) => s + v, 0) / w.length : null; };
    cur = avg(ys.slice(n - 7)); prev = avg(ys.slice(n - 14, n - 7));
  } else {
    cur = ys[n - 1]; prev = ys[n - 8];
  }
  if (cur === null || prev === null || cur === undefined || prev === undefined) return null;
  return { cur, prev, diff: cur - prev };
}

function deltaHtml(m, d) {
  if (!d) return '<div class="td">تغییرِ هفتگی: داده‌ی کافی نیست</div>';
  const { diff, prev } = d;
  // تغییری که بعد از گرد کردن صفر است (مثلاً ۲۰ ثانیه در سنجه‌ی دقیقه‌ای) «بدونِ تغییر» است، نه «▼ ۰»
  if (Math.abs(diff) < 1e-9 || fmtUnit(m.unit, Math.abs(diff)) === fmtUnit(m.unit, 0)) {
    return `<div class="td">→ بدونِ تغییر نسبت به هفته‌ی قبل</div>`;
  }
  const up = diff > 0;
  const cls = (up === (m.good === 'up')) ? 'good' : 'bad';
  const arrow = up ? '▲' : '▼';
  // درصد: تغییر به «واحدِ درصد» گفته می‌شود (۴۰٪ ⟵ ۴۵٪ = +۵ واحد، نه +۱۲٪)
  const amount = m.unit === 'pct'
    ? `${fmt(r1(Math.abs(diff)))} واحدِ درصد`
    : `${fmtUnit(m.unit, Math.abs(diff))}${prev && m.unit !== 'dur' ? ` (${fmt(r1(Math.abs(diff / prev) * 100))}٪)` : ''}`;
  const basis = m.kind === 'flow' ? 'میانگینِ ۷ روز نسبت به ۷ روزِ قبلش' : 'نسبت به ۷ روز قبل';
  return `<div class="td ${cls}">${arrow} ${amount} <span class="muted">${basis}</span></div>`;
}

function tile(m, days, ys) {
  const lastIdx = (() => { for (let i = ys.length - 1; i >= 0; i--) if (ys[i] !== null) return i; return -1; })();
  const avg = m.kind === 'flow' ? rolling7(ys) : null;
  const points = days.map((d, i) => ({ x: jalali(d), title: jalaliLong(d), y: ys[i] }));
  const headVal = lastIdx >= 0 ? fmtUnit(m.unit, ys[lastIdx]) : '-';
  const headSub = lastIdx >= 0 && lastIdx !== ys.length - 1 ? ` <span class="muted" style="font-size:12px">(${esc(jalaliLong(days[lastIdx]))})</span>` : '';
  return `<div class="tile" id="t-${esc(m.k)}">
    <div class="tl">${esc(m.label)}</div>
    <div class="tv">${headVal}${headSub}</div>
    ${deltaHtml(m, delta(m, ys))}
    ${trendChart(m.unit === 'dur' ? points.map((p) => ({ ...p, y: p.y === null ? null : p.y / 60 })) : points, {
      // زمان در دیتابیس ثانیه است ولی به دقیقه کشیده می‌شود تا پله‌های محور گرد باشند (نه «۳۳ دقیقه»)
      fmtV: (v) => fmtUnit(m.unit, m.unit === 'dur' ? v * 60 : v), fmtTick: (v) => fmtTick(m.unit, v),
      yMin: m.yMin ?? null, avg: avg && m.unit === 'dur' ? avg.map((v) => (v === null ? null : v / 60)) : avg, label: m.label,
    })}
    ${m.hint ? `<div class="th">${esc(m.hint)}</div>` : ''}
  </div>`;
}

function groupTable(metrics, days, series) {
  const head = ['روز', ...metrics.map((m) => m.label)];
  const body = days.map((d, i) => `<tr><td>${esc(jalaliLong(d))}</td>${metrics.map((m) =>
    `<td>${fmtUnit(m.unit, series.get(m.k)[i])}</td>`).join('')}</tr>`).reverse().join('');
  return `<details style="margin-top:12px"><summary class="muted">📋 جدولِ روزانه‌ی همین بخش</summary>
    <div style="overflow-x:auto"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div></details>`;
}

/* ═══ رندر ═══ */
export function trendsBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  if (!MASTER_DASH_BOTS.has(baseKey(bot))) {
    return `<div class="card"><h2>📈 ترندها — ${esc(title)}</h2>
      <p class="muted">ترندها همان سنجه‌های «نمای کلی»اند و آن سنجه‌ها فعلاً فقط برای <b>🔮 تاروت</b> ساخته شده‌اند.</p></div>`;
  }
  const rk = TREND_RANGES[url.searchParams.get(RANGE_PARAM)] ? url.searchParams.get(RANGE_PARAM) : 'd90';
  const yesterdayNo = tehranDayNo(nowSec()) - 1;
  const span = TREND_RANGES[rk].days;

  // سنجه‌های یخ‌زده
  const fromKey = span ? dayKeyOf(yesterdayNo - span + 1) : '0000-00-00';
  const stored = storedSeries(bot, fromKey);
  // روزِ شروع: اولین روزِ ثبت‌شده در بازه، یا شروعِ بازه
  let firstDay = null;
  for (const m of stored.values()) for (const d of m.keys()) if (!firstDay || d < firstDay) firstDay = d;

  // پول: زنده، تا پایانِ دیروز (همان روزِ کاملی که بقیه‌ی سنجه‌ها دارند)
  const pf = profitFor(bot, 'all');
  const hasRate = !!pf.hasRate;
  const moneyByDay = new Map(pf.series.map((s) => [s.d, s]));
  if (!firstDay) firstDay = pf.series.find((s) => s.rev || s.costToman)?.d || null;
  if (span) {
    const rangeStart = dayKeyOf(yesterdayNo - span + 1);
    if (!firstDay || firstDay < rangeStart) firstDay = rangeStart;
  }
  const lastDay = dayKeyOf(yesterdayNo);

  const intro = `<div class="card">
    ${cardHead(`📈 ترندها — ${esc(title)}`, rangePicker(url, RANGE_PARAM, rk, { keys: Object.keys(TREND_RANGES), ranges: TREND_RANGES }))}
    <p class="muted" style="margin:0">هر نقطه = عددِ همان سنجه‌ی «نمای کلی» در <b>پایانِ</b> آن روز (مرزِ روزِ تهران).
      هر شب بعد از نیمه‌شب، روزِ تمام‌شده ثبت و یخ می‌شود؛ پس امروز هنوز در نمودار نیست.
      زیرِ هر عدد، تغییرش نسبت به هفته‌ی قبل آمده (سبز = رو به بهتر، قرمز = رو به بدتر).
      روی نمودار بیا (یا با کیبورد فوکوس کن و ← → بزن) تا عددِ هر روز را ببینی.</p></div>`;

  if (!firstDay || firstDay > lastDay) {
    return `${intro}<div class="card" role="status"><h2>⏳ اولین ثبت در راه است</h2>
      <p class="muted">هنوز هیچ روزی ثبت نشده. ثبتِ شبانه چند دقیقه بعد از بالا آمدنِ داشبورد روزهای گذشته را
        از روی دیتای خام می‌سازد و بعد از آن هر شب یک روز اضافه می‌کند.</p></div>`;
  }

  const days = [];
  for (let d = dayNoOfKey(firstDay); d <= yesterdayNo; d++) days.push(dayKeyOf(d));

  const series = new Map();
  for (const m of TREND_METRICS) {
    const byDay = stored.get(m.k) || new Map();
    series.set(m.k, days.map((d) => {
      const x = byDay.get(d);
      return x && x.value !== null && x.value !== undefined ? Number(x.value) : null;
    }));
  }
  /* پول: تجمعی از **ابتدای عمرِ ربات** (نه از ابتدای بازه)، پس «سودِ خالصِ تجمعی» در هر بازه‌ای
     همان عددی است که سرخطِ نمای کلی می‌گوید (منهای امروز). */
  let cumRev = 0, cumBot = 0;
  const cum = new Map();
  for (const s of pf.series) {
    if (s.d > lastDay) break;
    cumRev += s.rev; cumBot += s.rev - (s.orphan || 0);
    cum.set(s.d, { net: s.cum, rev: cumRev, bot: cumBot });
  }
  const users = series.get('users');
  for (const m of MONEY) {
    series.set(m.k, days.map((d, i) => {
      const s = moneyByDay.get(d), c = cum.get(d);
      if (!s || !c) return null;
      switch (m.k) {
        case 'net_cum': return c.net;
        case 'rev_day': return s.rev;
        case 'cost_day': return s.costToman;
        case 'net_day': return s.net;
        case 'rev_cum': return c.rev;
        case 'margin': return c.rev ? Math.round((c.net / c.rev) * 1000) / 10 : null;
        case 'arpu': return users[i] ? Math.round(c.bot / users[i]) : null;
        default: return null;
      }
    }));
  }

  const all = [...MONEY.filter((m) => hasRate || m.need !== 'rate'), ...TREND_METRICS];
  const cards = GROUPS.map(([g, gTitle]) => {
    const ms = all.filter((m) => m.g === g);
    // ترتیبِ سرخط: سود اول، بعد همان ترتیبِ کاشی‌های نمای کلی
    if (!ms.length) return '';
    const note = g === 'money' && !hasRate
      ? '<div class="note">برای هزینه و سود، <b>نرخِ دلار</b> لازم است؛ آن را در «💰 اقتصاد و هزینه» وارد کن.</div>' : '';
    const live = ms.some((m) => MONEY.includes(m))
      ? '<p class="muted" style="margin:10px 0 0">عددهای پولی یخ نمی‌شوند و هر بار از همان منبعِ صفحه‌ی اقتصاد ساخته می‌شوند، چون هزینه‌ی تبلیغ و نرخِ دلار را بعداً دستی وارد می‌کنی.</p>' : '';
    return `<div class="card"><h2>${gTitle}</h2>${note}
      <div class="tgrid">${ms.map((m) => tile(m, days, series.get(m.k))).join('')}</div>
      ${live}${groupTable(ms, days, series)}</div>`;
  }).join('');

  const nightFrom = firstNightDay(bot);
  const rebuilt = days.some((d) => [...stored.values()].some((m) => m.get(d)?.src === 'rebuilt'));
  const honesty = rebuilt ? `<div class="card muted" role="note">
    روزهای ${nightFrom ? `پیش از <b>${esc(jalaliLong(nightFrom))}</b>` : 'این بازه'} یک‌جا از روی دیتای خام <b>بازسازی</b> شده‌اند
    (همان تعریف‌ها، با «الان» = پایانِ همان روز). دو تفاوتِ کوچک با ثبتِ شبانه دارند: نمره‌ای که بعداً به فالِ آن روز داده شده
    در همان روز حساب شده، و کاربری که از آن روز تا امروز پاک شده دیگر دیده نمی‌شود.</div>` : '';

  const pending = stored.size ? '' : `<div class="card" role="status"><h2>⏳ اولین ثبتِ شبانه هنوز انجام نشده</h2>
    <p class="muted">نمودارهای پولی (زنده) آماده‌اند؛ بقیه‌ی سنجه‌ها چند دقیقه بعد از بالا آمدنِ داشبورد یک‌جا از روی
      دیتای خام ساخته می‌شوند و بعد از آن هر شب یک روز اضافه می‌شود.</p></div>`;
  return `${intro}${pending}${honesty}${cards}`;
}
