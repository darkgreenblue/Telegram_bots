// 💰 اقتصاد و هزینه — «هر فال چقدر آب می‌خورد و آخرِ ماه چه می‌ماند؟»
//
// همه‌ی اعدادِ پولیِ **تحلیلی** این‌جاست؛ صفِ رسید و تأییدِ پرداخت در «اقدام‌ها ← مالی».
import { instancesOf, withDb, hasTable, scalar, rows, botByKey, moneyText, revenueWhere, toToman } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, nowSec, rangeOf, rangeSince, RANGES, tehranDayStart, tehranDayStr } from '../lib/util.js';
import { stat, table, cardHead, rangePicker } from '../lib/html.js';
import { hbars } from '../lib/charts.js';
import { getSetting } from '../lib/platform.js';
import { costPerDiamond } from '../lib/cpa.js';
import { costsBody } from './finance.js';
import { profitDaily, firstRevenueSec, USD_RATE_KEY, CAMPAIGN_CPA_KEY, PRE_TRACK_COST_KEY } from '../lib/profit.js';

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
    ${costInputsCard(bot)}${profitCard(url, bot)}${costCard}${cpdCard}${costsBody(url)}`;
}

/* ═══ 📈 سودِ خالص — تنها کارتِ سودِ این صفحه ═══
   ⚠️ قبلاً **دو** کارت بود (سودِ بازه + سودِ کلِ عمر) و ایرادِ درستِ مالک همین بود:
   یک سنجه با دو کارت یعنی خواننده باید حدس بزند کدام «واقعی» است. حالا یک کارت با
   انتخابگرِ بازه (روز / هفته / ماه / کل عمر، پیش‌فرض **کل عمر**) هر چهار جواب را
   می‌دهد. هزینه‌ی دوره‌ی قبل از ثبت هم در `profitDaily` روی روزهایش پخش می‌شود، پس
   دیگر نه استثنایی هست نه هشداری. */
export function profitCard(url, bot) {
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const campUsd = parseFloat(getSetting(CAMPAIGN_CPA_KEY, '0')) || 0;
  const preUsd = Number(getSetting(PRE_TRACK_COST_KEY, '0')) || 0;
  const rk = rangeOf(url, 'rProfit', 'all');

  if (!rate) {
    return `<div class="card">${cardHead('📈 سودِ خالص')}
      <p>هزینه‌ی مدل دلاری است و درآمد تومانی، پس بدونِ <b>نرخِ دلار</b> این دو قابلِ
        کم‌کردن از هم نیستند و هیچ عددی ساخته نمی‌شود.</p>
      <p class="muted">نرخ را در کارتِ بالا وارد کن تا این کارت زنده شود.</p></div>`;
  }

  /* «کل عمر» = از اولین روزِ درآمد تا امروز. بقیه‌ی بازه‌ها همان پنجره‌ی خودشان. */
  const firstRev = firstRevenueSec(bot);
  const lifeDays = firstRev ? Math.ceil((nowSec() - firstRev) / 86400) + 1 : 30;
  const days = RANGES[rk].days || lifeDays;
  const p = profitDaily(bot, { days, usdToman: rate, campaignUsdPerUser: campUsd, preTrackUsd: preUsd });

  const t = (v) => `${fmt(v)} ت`;
  const tot = p.totals;
  const margin = tot.rev ? Math.round((tot.net / tot.rev) * 1000) / 10 : 0;
  const daily = p.series.slice().reverse().filter(r => r.rev || r.costToman).map(r => [
    r.d, t(r.rev),
    `${t(r.costToman)} <span class="muted">(${usd(r.costUsd)})</span>`,
    `<span class="${r.net < 0 ? 'drop' : ''}"><b>${t(r.net)}</b></span>`,
    `<span class="${r.cum < 0 ? 'drop' : ''}">${t(r.cum)}</span>`,
  ]);

  return `<div class="card">
    ${cardHead('📈 سودِ خالص', rangePicker(url, 'rProfit', rk))}
    <div class="grid">
      ${stat(`سودِ خالص (${esc(RANGES[rk].label)})`, `<b class="${tot.net < 0 ? 'drop' : ''}">${t(tot.net)}</b>`)}
      ${stat('درآمدِ دریافتی', t(tot.rev) + (tot.orphan
        ? ` <span class="muted">(${fmt(tot.orphan)} ت سرگردان)</span>` : ''))}
      ${stat('هزینه‌ی واقعی', `${t(tot.costToman)} <span class="muted">(${usd(tot.llmUsd + tot.adUsd)})</span>`)}
      ${stat('حاشیه‌ی سود', `${fmt(margin)}٪`)}
      ${stat('نقطه‌ی سربه‌سر', p.breakEven
        ? `<b>${esc(p.breakEven)}</b>`
        : `<span class="muted">${tot.net < 0 ? 'هنوز نرسیده' : 'از ابتدا مثبت'}</span>`)}
    </div>
    <p class="muted">سود = <b>درآمدِ دریافتی − هزینه‌ی مدل − هزینه‌ی تبلیغ</b>.
      تخفیف کم نمی‌شود (از قبل داخلِ درآمد است)، اعتبارِ هدیه هم نه (پولِ نقد نیست؛
      هزینه‌اش وقتی خرج شود در همان هزینه‌ی مدل می‌آید)، و پرداخت‌های تستی اصلاً
      واردِ درآمد نمی‌شوند.${tot.orphan ? ` <b>${fmt(tot.orphan)} تومان</b> از این درآمد
      «پرداختِ سرگردان» است: پولی که به حساب رسیده ولی کاربرش رسید نفرستاده و دستی ثبت شده.` : ''}${preUsd ? ` هزینه‌ی ${usd(preUsd)}ِ دوره‌ی قبل از ثبتِ خودکار
      روی روزهای همان دوره پخش شده، پس «کل عمر» کامل است.` : ''}</p>
    <h3 class="ch">روزانه (جدیدترین بالا)</h3>
    ${table(['روز', 'درآمد', 'هزینه', 'سودِ روز', 'تجمعی'], daily, 'در این بازه دیتایی نیست')}
    <p class="muted">«نقطه‌ی سربه‌سر» اولین روزی است که تجمعی مثبت شد <b>و دیگر منفی
      نشد</b> — یک روزِ پرفروشِ تنها که فردا برمی‌گردد، سربه‌سر نیست.</p></div>`;
}

/* ⚙️ ورودی‌های دستیِ هزینه — **اولین کارتِ این صفحه** (خواسته‌ی مالک ۱۴۰۵/۰۶/۱۵).
   قبلاً وسطِ صفحه‌ی «جذب» بود، ولی هر سه ورودی‌اش ورودیِ محاسبه‌ی اقتصادند و بدونشان
   هیچ عددِ تومانی‌ای در این صفحه ساخته نمی‌شود. پس اول صفحه، جایی که اگر خالی باشد
   بلافاصله دیده شود. اکشن عمداً همان `/acquisition/settings` ماند تا audit نشکند. */
export function costInputsCard(bot) {
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const campUsd = Number(getSetting(CAMPAIGN_CPA_KEY, '0')) || 0;
  const pre = Number(getSetting(PRE_TRACK_COST_KEY, '0')) || 0;
  const missing = [!rate && 'نرخ دلار', !campUsd && 'هزینه‌ی تبلیغ'].filter(Boolean);
  return `<div class="card">
    ${cardHead('⚙️ ورودی‌های دستیِ هزینه')}
    ${missing.length ? `<div class="note">⚠️ تا ${esc(missing.join(' و '))} وارد نشود،
      بخشی از اعدادِ این صفحه ساخته نمی‌شود. داشبورد هیچ نرخی از خودش حدس نمی‌زند.</div>` : ''}
    <form method="post" action="/acquisition/settings" class="inline">
      <input type="hidden" name="bot" value="${esc(bot)}">
      <label>نرخ دلار به تومان
        <input name="rate" type="number" min="0" value="${rate || ''}" placeholder="مثلاً 225000"></label>
      <label>هزینه‌ی تبلیغ per کاربرِ کمپین (دلار)
        <input name="camp" type="number" step="0.00001" min="0" value="${campUsd || ''}" placeholder="مثلاً 0.00756"></label>
      <label>هزینه‌ی مدل قبل از شروعِ ثبت (دلار)
        <input name="pre" type="number" step="0.01" min="0" value="${pre || ''}" placeholder="مثلاً 4.19"></label>
      <button type="submit">ذخیره</button>
    </form>
    <p class="muted" style="margin-top:8px">
      ${campUsd && rate ? `الان: هر کاربرِ کمپین <b>${usd(campUsd)}</b> ≈ <b>${fmt(Math.round(campUsd * rate))} تومان</b>. ` : ''}
      هزینه‌ی تبلیغ عمداً <b>دلاری</b> است تا با هزینه‌ی مدل هم‌واحد بماند؛ تومانش خودکار می‌آید.
      <br>«هزینه‌ی قبل از شروعِ ثبت» را از داشبوردِ خودِ OpenRouter بخوان: ثبتِ خودکار تاریخچه
      ندارد و بدونِ این عدد، سود در بازه‌ی «کل عمر» درآمدِ همه‌ی روزها را با هزینه‌ی چند روزِ آخر مقایسه می‌کند.
      <br>🔎 <b>اتوماسیون:</b> <span class="mono">ads.telegram.org</span> API عمومی برای خواندنِ هزینه‌ی
      کمپینِ خودت ندارد (فقط داشبوردِ وبی)، پس این ورودی دستی می‌ماند.</p></div>`;
}
