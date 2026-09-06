// 💰 اقتصاد و هزینه — «هر فال چقدر آب می‌خورد و آخرِ ماه چه می‌ماند؟»
//
// همه‌ی اعدادِ پولیِ **تحلیلی** این‌جاست؛ صفِ رسید و تأییدِ پرداخت در «اقدام‌ها ← مالی».
import { instancesOf, withDb, hasTable, scalar, rows, botByKey, moneyText, revenueWhere, toToman } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, nowSec, rangeOf, rangeSince, RANGES, tehranDayStart } from '../lib/util.js';
import { stat, table, cardHead, rangePicker } from '../lib/html.js';
import { hbars } from '../lib/charts.js';
import { getSetting } from '../lib/platform.js';
import { costPerDiamond } from '../lib/cpa.js';
import { costsBody } from './finance.js';
import { USD_RATE_KEY } from './acquisition.js';

const usd = (n) => `$${(Number(n) || 0).toFixed(Math.abs(Number(n)) < 1 ? 4 : 2)}`;

const KIND_FA = {
  reading: '🔮 خوانشِ فال', repair: '🔧 تعمیرِ نقطه‌ای', daily_card: '🎴 کارت روز',
  feedback: '💬 تصحیحِ بازخورد', transcribe: '🎙 رونویسیِ ویس',
};

function modelCost(botKey, since) {
  const out = { total: 0, inRange: 0, rows: 0, rowsInRange: 0, byKind: new Map(), days: 0, has: false, readings: 0 };
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'llm_usage')) return;
      out.has = true;
      out.total += scalar(db, 'SELECT COALESCE(SUM(cost_usd),0) s FROM llm_usage');
      out.inRange += scalar(db, 'SELECT COALESCE(SUM(cost_usd),0) s FROM llm_usage WHERE created_at >= ?', [since]);
      out.rows += scalar(db, 'SELECT COUNT(*) c FROM llm_usage');
      out.rowsInRange += scalar(db, 'SELECT COUNT(*) c FROM llm_usage WHERE created_at >= ?', [since]);
      out.days = Math.max(out.days, scalar(db, "SELECT COUNT(DISTINCT CAST((created_at + 12600)/86400 AS INTEGER)) c FROM llm_usage"));
      for (const r of rows(db, 'SELECT kind, SUM(cost_usd) s, COUNT(*) c FROM llm_usage WHERE created_at >= ? GROUP BY kind', [since])) {
        const cur = out.byKind.get(r.kind) || { usd: 0, calls: 0 };
        cur.usd += r.s || 0; cur.calls += r.c; out.byKind.set(r.kind, cur);
      }
      if (hasTable(db, 'readings')) {
        out.readings += scalar(db, "SELECT COUNT(*) c FROM readings WHERE status='delivered' AND price>0 AND created_at >= ?", [since]);
      }
    });
  }
  return out;
}

function revenue(botKey, since) {
  let inRange = 0, total = 0;
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      const rw = revenueWhere(botKey);
      if (!hasTable(db, rw.table)) return;
      const q = (s) => toToman(botKey, scalar(db, `SELECT COALESCE(SUM(${rw.amountCol}),0) s FROM ${rw.table} WHERE ${rw.where}`, [s]));
      inRange += q(since); total += q(0);
    });
  }
  return { inRange, total };
}

export function economicsBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  if (!instancesOf(bot).length) {
    return `<div class="card"><h2>💰 اقتصاد و هزینه</h2><p class="muted">دیتابیسِ این ربات پیدا نشد.</p></div>`;
  }
  const rk = rangeOf(url, 'rEcon', 'month');
  const since = rangeSince(rk);
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const toman = (u) => (rate ? `<span class="muted"> ≈ ${fmt(Math.round(u * rate))} ت</span>` : '');

  const mc = modelCost(bot, since);
  const rev = revenue(bot, since);
  const cpd = costPerDiamond(bot);
  const avgDaily = mc.days ? mc.total / mc.days : 0;
  const perReading = mc.readings ? mc.inRange / mc.readings : 0;

  const costCard = `<div class="card">
    ${cardHead('🧾 هزینه‌ی مدل (OpenRouter)', rangePicker(url, 'rEcon', rk))}
    ${mc.has ? `<div class="grid">
      ${stat(`هزینه در ${esc(RANGES[rk].label)}`, usd(mc.inRange) + toman(mc.inRange))}
      ${stat('هزینه‌ی کل (از شروعِ ثبت)', usd(mc.total) + toman(mc.total))}
      ${stat('میانگین هزینه‌ی روزانه', usd(avgDaily) + toman(avgDaily))}
      ${stat('هزینه به ازای هر فال', usd(perReading) + toman(perReading))}
      ${stat('فراخوانیِ ثبت‌شده در بازه', fmt(mc.rowsInRange))}
      ${stat('کلِ فراخوانیِ ثبت‌شده', fmt(mc.rows))}
    </div>` : ''}
    ${mc.rows ? '' : `<div class="note">ثبتِ هزینه تازه روشن شده و هنوز ردیفی ندارد. این عدد از لحظه‌ی
      انتشار به بعد پر می‌شود و <b>برای گذشته قابلِ بازسازی نیست</b>.</div>`}
    ${mc.byKind.size ? `<div style="margin-top:14px"><h3 class="ch">هزینه به تفکیکِ مسیر (${esc(RANGES[rk].label)})</h3>
      ${hbars([...mc.byKind.entries()].sort((a, b) => b[1].usd - a[1].usd)
        .map(([k, v]) => ({ label: `${KIND_FA[k] || k} (${fmt(v.calls)} فراخوانی)`, value: Math.round(v.usd * 10000) / 10000 })), { showPct: true })}</div>` : ''}
    <p class="muted" style="margin-top:8px">هزینه همان عددی است که خودِ OpenRouter در هر پاسخ برمی‌گرداند.
      ⚠️ داوریِ رسید (<span class="mono">cardpay.js</span>) هنوز شمرده نمی‌شود.</p></div>`;

  const cpdCard = cpd.hasData ? `<div class="card">
    ${cardHead('💎 هزینه‌ی هر الماس per اندازه‌ی فال')}
    ${table(['اندازه', 'فال', 'الماس', 'هزینه', 'هزینه‌ی هر الماس'], cpd.sizes.map(s => [
      `${fmt(s.size)} کارتی`, fmt(s.readings), `${fmt(s.diamonds)}💎`, usd(s.usd), `<b>${usd(s.cpd)}</b>${toman(s.cpd)}`]))}
    <p class="muted">همین نرخ‌ها ورودیِ محاسبه‌ی CPA در صفحه‌ی «جذب و کانال‌ها» هستند.</p></div>` : '';

  const marginUsd = rate ? (rev.inRange / rate) - mc.inRange : 0;
  const revCard = `<div class="card">
    ${cardHead('💳 درآمد و حاشیه')}
    <div class="grid">
      ${stat(`درآمد ${esc(RANGES[rk].label)}`, moneyText(bot, rev.inRange))}
      ${stat('درآمد کل', moneyText(bot, rev.total))}
      ${rate ? stat(`حاشیه‌ی ناخالص ${esc(RANGES[rk].label)}`,
        `<b class="${marginUsd >= 0 ? '' : 'drop'}">${moneyText(bot, Math.round(marginUsd * rate))}</b>`) : ''}
      ${rate && rev.inRange ? stat('سهمِ هزینه‌ی مدل از درآمد',
        `${fmt(Math.round((mc.inRange * rate / rev.inRange) * 1000) / 10)}٪`) : ''}
    </div>
    <p class="muted">${rate ? 'حاشیه = درآمد − هزینه‌ی مدل (هزینه‌ی تبلیغ در صفحه‌ی جذب می‌آید).'
      : 'برای مقایسه‌ی دلار با تومان، نرخِ دلار را در صفحه‌ی «جذب و کانال‌ها» وارد کن.'}</p></div>`;

  return `<div class="card"><h2 style="margin:0">💰 اقتصاد و هزینه — ${esc(title)}</h2>
      <p class="muted" style="margin:6px 0 0">هزینه‌ی واقعیِ مدل، اقتصادِ الماس، و آنچه از درآمد می‌ماند.</p></div>
    ${costCard}${cpdCard}${revCard}${costsBody(url)}`;
}
