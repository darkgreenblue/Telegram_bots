// رندرِ «مسیرِ ریزِ کاربر»: قطعه‌ی بازشویِ قدم‌های ریزِ یک مرحله‌ی قیف + صفحه‌ی «صفحه‌ها».
// منطق و کوئری‌ها در lib/journey.js است؛ این‌جا فقط رندر و اعتبارسنجیِ ورودی.
import { microSteps, exitPoints, screensReport, screenMap, stepLabel } from '../lib/journey.js';
import { FUNNELS } from '../lib/funnels-def.js';
import { instancesOf, familyOf } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { esc, fmt, nowSec } from '../lib/util.js';
import { table, cohortCount } from '../lib/html.js';

// ورودی‌ها همه bound parameter می‌شوند؛ ولی botKey باید حتماً از رجیستری باشد (نه رشته‌ی خام)
const validBot = (b) => (Object.prototype.hasOwnProperty.call(FUNNELS, b) ? b : '');
const intOf = (url, k, d = 0) => { const v = parseInt(url.searchParams.get(k) ?? '', 10); return Number.isFinite(v) ? v : d; };

/* محتوای سلولِ «قدم»: متنِ واقعیِ پیام یا برچسبِ اکشن + متادیتای کمکی (بدونِ تگِ td).
   `note` توضیحِ کوتاهِ ردیف‌هایی است که از اسمشان فهمیده نمی‌شوند (رویدادِ داخلی، آپدیتِ
   سرویسیِ تلگرام) — همان چیزی که قبلاً باید از سورس درمی‌آمد. */
function stepCell(ev, key, screens) {
  const l = stepLabel(ev, key, screens);
  const meta = l.kind === 'act' ? 'اکشنِ کاربر'
    : l.kind === 'event' ? 'رویدادِ قیف (پیامِ صفحه نیست)'
    : l.kind === 'content' ? 'متنِ تولیدشده (طولش متغیر است)'
    : (l.buttons ? `دکمه‌ها: ${l.buttons}` : 'بدون دکمه');
  return `${l.icon} <span class="step-txt">${esc(l.text)}</span>`
    + `<span class="step-meta">${esc(meta)}</span>`
    + (l.note ? `<span class="step-meta">${esc(l.note)}</span>` : '');
}

/* سلولِ «قدمِ قبلی»: فشرده و بدونِ note (ستونِ کمکی است، نه ردیفِ اصلی). */
function prevCell(prev, screens) {
  if (!prev) return '<span class="muted">-</span>';
  const l = stepLabel(prev.ev, prev.k, screens);
  return `${l.icon} <span class="step-txt">${esc(l.text)}</span>`
    + `<span class="step-meta">${fmt(prev.n)} نفر از این راه رسیدند</span>`;
}

/* ═══ قطعه‌ی بازشو: قدم‌های ریزِ بینِ دو مرحله‌ی قیف ═══ */
export function funnelStepsFragment(url) {
  const bot = validBot(url.searchParams.get('bot') || '');
  if (!bot) return '<span class="muted">ربات نامعتبر است.</span>';
  const stageEv = url.searchParams.get('ev') || '';
  const nextEv = url.searchParams.get('next') || '';
  const since = Math.max(0, intOf(url, 'since', 0));
  const ch = intOf(url, 'ch', 0);
  const ver = url.searchParams.get('ver') || '';
  if (!stageEv) return '<span class="muted">مرحله نامعتبر است.</span>';

  const { steps, stageUsers } = microSteps(bot, { stageEv, nextEv, since, ch, ver });
  if (!steps.length) {
    return `<p class="muted">هنوز رویدادِ ریزی برای این مرحله ثبت نشده. (ثبتِ مسیرِ ریز از زمانِ فعال‌شدنش
      روی این ربات دیتا دارد؛ برای کاربرانِ قبل از آن خالی است.)</p>`;
  }
  const screens = screenMap(bot);
  const max = Math.max(...steps.map(s => s.users), 1);

  const body = steps.map((s) => {
    const pct = stageUsers ? Math.round(s.users / stageUsers * 100) : 0;
    const w = Math.round(s.users / max * 60) + 4;
    return [
      stepCell(s.ev, s.k, screens),
      s.ev === 'act' ? '<span class="badge">اکشن</span>' : '<span class="badge ok">پیام</span>',
      cohortCount(s.users, { k: 'micro', bot, ev: s.ev, key: s.k, stage: stageEv, next: nextEv, since: String(since), ch: String(ch), ver }),
      `<span class="bar" style="width:${w}px"></span> <span class="muted">${pct}٪</span>`,
      s.drop ? `<span class="drop">−${fmt(s.drop)}</span>` : '<span class="muted">-</span>',
      `<span class="muted">${fmt(s.hits)}</span>`,
    ];
  });

  return `<p class="muted">${fmt(stageUsers)} کاربر به این مرحله رسیدند. قدم‌ها به ترتیبِ واقعیِ مسیرِ کاربران
    چیده شده‌اند (میانگینِ جایگاهشان)، نه با لیستِ دستی. «افت» = اختلافِ کاربرِ این قدم با قدمِ قبلی؛
    بزرگ‌ترین عددِ قرمز، دقیقاً همان‌جایی است که باید درستش کنی. روی عددِ کاربر بزن تا خودِ آدم‌ها را ببینی.</p>
    ${table(['قدم (پیام یا اکشن)', 'نوع', 'کاربر یکتا', '٪ از این مرحله', 'افت', 'دفعات'], body)}`;
}

/* ═══ کارتِ «کجا ریختند؟» — آخرین کارِ کسانی که دیگر برنگشتند ═══ */
// `now` فقط برای تست است (چکِ CI باید بتواند «۲۴ ساعت بعد» را شبیه‌سازی کند)؛ صفر = همین حالا.
export function exitCard(botKey, { since, ch, ver, now = 0 }) {
  const { list, total, idleBefore, blocks } = exitPoints(botKey, { since, ch, ver, now });
  if (!list.length) return '';
  const screens = screenMap(botKey);
  const body = list.map((r) => [
    stepCell(r.ev, r.k, screens),
    prevCell(r.prev, screens),
    cohortCount(r.n, { k: 'exit', bot: botKey, ev: r.ev, key: r.k, since: String(since), idle: String(idleBefore) }),
    `<span class="muted">${total ? Math.round(r.n / total * 100) : 0}٪</span>`,
  ]);
  // تفکیکِ بلاک از آنبلاک — فقط وقتی چنین ردیفی در جدول هست
  const kicked = blocks?.get('kicked') || 0;
  const rejoined = [...(blocks || new Map())].filter(([k]) => k && k !== 'kicked').reduce((t, [, n]) => t + n, 0);
  const blockNote = (kicked || rejoined)
    ? `<p class="muted">از ردیفِ «بلاک/آنبلاک»: <b>${fmt(kicked)}</b> نفر ربات را بلاک کردند`
      + (rejoined ? ` و <b>${fmt(rejoined)}</b> نفر آنبلاک/استارت کردند ولی بعدش هیچ کاری نکردند` : '')
      + `.</p>` : '';
  return `<div class="card"><h2>${esc(FUNNELS[familyOf(botKey)]?.title || botKey)} — کجا ریختند؟</h2>
    <p class="muted">${fmt(total)} کاربر که بیش از ۲۴ ساعت است برنگشته‌اند؛ این آخرین چیزی است که دیدند یا زدند.
      این جدول مستقیم می‌گوید کدام پیام «آخرِ خط» بوده. وقتی خودِ آخرین ردپا علت نیست (بلاک‌کردنِ ربات، یا یک
      رویدادِ داخلی)، ستونِ «قدمِ قبلی» علتِ واقعی را نشان می‌دهد. روی عدد بزن تا لیستشان باز شود (برای پرسیدن از پشتیبانی).</p>
    ${blockNote}
    ${table(['آخرین قدم', 'قدمِ قبلی (پرتکرارترین)', 'کاربر', 'سهم'], body)}</div>`;
}

/* ═══ صفحه‌ی «صفحه‌ها»: کاتالوگِ همه‌ی پیام‌های ربات + نرخِ عبور ═══ */
export function screensBody(url) {
  const bot = scopeBot(url);
  const days = Math.max(0, intOf(url, 'days', 30));
  const since = days ? nowSec() - days * 86400 : 0;
  const sort = ['pass', 'imps', 'users'].includes(url.searchParams.get('sort') || '') ? url.searchParams.get('sort') : 'pass';
  const minImps = Math.max(1, intOf(url, 'min', 20));

  let out = `<div class="card"><form method="get" action="/screens" class="inline">
    <input type="hidden" name="bot" value="${esc(bot)}">
    <label>بازه<select name="days">
      ${[['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز'], ['0', 'همه']].map(([v, l]) =>
        `<option value="${v}" ${Number(v) === days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>مرتب‌سازی<select name="sort">
      ${[['pass', 'بدترین نرخ عبور'], ['imps', 'بیشترین نمایش'], ['users', 'بیشترین کاربر']].map(([v, l]) =>
        `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>حداقل نمایش<input type="number" name="min" value="${minImps}" min="1" style="width:90px"></label>
    <button type="submit">اعمال</button>
  </form>
  <p class="muted">هر ردیف = یک پیامِ ربات. «نرخ عبور» = چند درصدِ دفعاتی که این پیام نشان داده شد، کاربر
    ظرف نیم‌ساعت اقدامی کرد. نرخِ عبورِ پایین روی پیامی که زیاد دیده می‌شود = گران‌ترین نقطه‌ی بهبود.
    پیام‌های محتوایی (خروجی مدل) زیرِ یک ردیفِ مشترک جمع شده‌اند.</p></div>`;

  let any = false;
  for (const botKey of Object.keys(FUNNELS).filter(k => k === bot)) {
    if (!instancesOf(botKey).length) continue;
    const screens = screenMap(botKey);
    let rowsData = screensReport(botKey, { since }).filter(r => r.imps >= minImps);
    if (!rowsData.length) continue;
    rowsData.sort((a, b) => (sort === 'imps' ? b.imps - a.imps : sort === 'users' ? b.users - a.users : a.pass - b.pass));

    const body = rowsData.slice(0, 120).map((r) => {
      const pct = Math.round(r.pass * 100);
      const cls = pct < 40 ? 'bad' : pct < 70 ? 'warn' : 'ok';
      return [
        stepCell('view', r.k, screens),
        fmt(r.imps),
        fmt(r.users),
        `<span class="badge ${cls}">${pct}٪</span>`,
        r.avgSec === null ? '<span class="muted">-</span>' : `<span class="muted">${fmt(r.avgSec)} ثانیه</span>`,
      ];
    });
    any = true;
    out += `<div class="card"><h2>${esc(FUNNELS[familyOf(botKey)].title)} — صفحه‌ها</h2>
      ${table(['پیام', 'نمایش', 'کاربر یکتا', 'نرخ عبور', 'میانگین زمان تا اقدام'], body)}</div>`;
  }
  if (!any) out += `<div class="card"><p class="muted">برای این ربات هنوز رویدادِ ریزِ صفحه‌ای ثبت نشده `
    + `(مسیرِ ریزِ کاربر فعلاً فقط روی تاروت روشن است — <span class="mono">JOURNEY_ENABLED</span>).</p></div>`;
  return out;
}
