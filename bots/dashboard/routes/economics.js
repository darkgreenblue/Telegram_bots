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
import { profitDaily, profitLifetime, USD_RATE_KEY, CAMPAIGN_CPA_KEY, PRE_TRACK_COST_KEY } from '../lib/profit.js';

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
    ${costInputsCard(bot)}${lifetimeCard(bot)}${profitCard(url, bot)}${costCard}${cpdCard}${revCard}${costsBody(url)}`;
}

/* ═══ 📈 سودِ خالص — «کی مثبت شدم و چقدر؟» ═══
   خواسته‌ی صریحِ مالک: این عدد باید **روزانه** رصد شود، نه یک عددِ تکیِ کلِ عمر. پس
   کارت هم سرخط را می‌دهد هم سریِ روزانه و نقطه‌ی سربه‌سر.
   محاسبه در `lib/profit.js` است تا عددِ این‌جا و عددِ نمای کلی هرگز واگرا نشوند. */
export function profitCard(url, bot) {
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const campUsd = parseFloat(getSetting(CAMPAIGN_CPA_KEY, '0')) || 0;
  const rk = rangeOf(url, 'rProfit', 'month');
  const days = RANGES[rk].days || 90;
  const p = profitDaily(bot, { days, usdToman: rate, campaignUsdPerUser: campUsd });

  if (!rate) {
    return `<div class="card">${cardHead('📈 سودِ خالص')}
      <p>هزینه‌ی مدل دلاری است و درآمد تومانی، پس بدونِ <b>نرخِ دلار</b> این دو قابلِ
        کم‌کردن از هم نیستند و هیچ عددی ساخته نمی‌شود.</p>
      <p class="muted">نرخ را در صفحه‌ی «جذب و کانال‌ها» وارد کن تا این کارت زنده شود.</p></div>`;
  }
  if (!p.costSince) {
    return `<div class="card">${cardHead('📈 سودِ خالص')}
      <p class="muted">هنوز هیچ هزینه‌ی مدلی ثبت نشده، پس سود قابلِ محاسبه نیست.</p></div>`;
  }

  /* ⚠️ صداقتِ بازه: ثبتِ هزینه از `costSince` شروع شده. اگر بازه‌ی انتخابی از آن
     عقب‌تر برود، روزهای قبلش **هزینه ندارند** و سودشان مصنوعاً برابرِ کلِ درآمد است.
     به‌جای پنهان‌کردنش، همان روزها علامت می‌خورند و از تجمعی بیرون می‌مانند. */
  const startStr = tehranDayStr(p.costSince);
  const covered = p.series.filter(r => r.d >= startStr);
  let cum = 0;
  const rowsCov = covered.map((r) => { cum += r.net; return { ...r, cum }; });
  const tot = rowsCov.reduce((a, r) => ({
    rev: a.rev + r.rev, cost: a.cost + r.costToman, net: a.net + r.net,
  }), { rev: 0, cost: 0, net: 0 });
  let breakEven = null;
  for (let i = 0; i < rowsCov.length; i++) {
    if (rowsCov[i].cum > 0 && rowsCov.slice(i).every(x => x.cum > 0)) { breakEven = rowsCov[i].d; break; }
  }
  const uncovered = p.series.length - covered.length;
  const t = (v) => `${fmt(v)} ت`;
  const marginPct = tot.rev ? Math.round((tot.net / tot.rev) * 1000) / 10 : 0;

  const daily = rowsCov.slice().reverse().map(r => [
    r.d,
    t(r.rev),
    `${t(r.costToman)} <span class="muted">(${usd(r.costUsd)})</span>`,
    `<span class="${r.net < 0 ? 'drop' : ''}"><b>${t(r.net)}</b></span>`,
    `<span class="${r.cum < 0 ? 'drop' : ''}">${t(r.cum)}</span>`,
  ]);

  return `<div class="card">
    ${cardHead('📈 سودِ خالص', rangePicker(url, 'rProfit', rk))}
    <div class="grid">
      ${stat('سودِ خالصِ این بازه', `<b class="${tot.net < 0 ? 'drop' : ''}">${t(tot.net)}</b>`)}
      ${stat('درآمدِ دریافتی', t(tot.rev))}
      ${stat('هزینه‌ی واقعی (مدل + تبلیغ)', t(tot.cost))}
      ${stat('حاشیه‌ی سود', `${fmt(marginPct)}٪`)}
      ${stat('نقطه‌ی سربه‌سر', breakEven
        ? `<b>${esc(breakEven)}</b>`
        : `<span class="muted">${tot.net < 0 ? 'هنوز نرسیده' : 'در کلِ بازه مثبت بوده'}</span>`)}
    </div>
    <p class="muted">سود = <b>درآمدِ دریافتی − هزینه‌ی مدل − هزینه‌ی تبلیغ</b>.
      تخفیف کم نمی‌شود (از قبل داخلِ درآمد است) و اعتبارِ هدیه هم کم نمی‌شود
      (پولِ نقد نیست؛ هزینه‌اش وقتی خرج شود در همان هزینه‌ی مدل می‌آید).</p>
    ${uncovered > 0 ? `<div class="note">⚠️ ثبتِ هزینه‌ی مدل از <b>${esc(startStr)}</b> شروع شده،
      ولی درآمد از روزِ اول ثبت است. پس ${fmt(uncovered)} روزِ ابتدایی این بازه از محاسبه
      <b>کنار گذاشته شد</b> — نه پنهان شد، بلکه واردِ سود نشد، چون درآمدِ بدونِ هزینه سودِ
      ساختگی می‌سازد.</div>` : ''}
    <h3 class="ch">روزانه (جدیدترین بالا)</h3>
    ${table(['روز', 'درآمد', 'هزینه', 'سودِ روز', 'تجمعی'], daily, 'هنوز روزی با دیتا نیست')}
    <p class="muted">«تجمعی» از اولین روزِ ثبتِ هزینه جمع می‌شود. «نقطه‌ی سربه‌سر» اولین
      روزی است که تجمعی مثبت شد <b>و دیگر منفی نشد</b> — یک روزِ پرفروشِ تنها که فردا
      برمی‌گردد، سربه‌سر نیست.</p></div>`;
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
      ندارد و بدونِ این عدد، سودِ کلِ عمر درآمدِ همه‌ی روزها را با هزینه‌ی چند روزِ آخر مقایسه می‌کند.
      <br>🔎 <b>اتوماسیون:</b> <span class="mono">ads.telegram.org</span> API عمومی برای خواندنِ هزینه‌ی
      کمپینِ خودت ندارد (فقط داشبوردِ وبی)، پس این ورودی دستی می‌ماند.</p></div>`;
}

/* 💰 سودِ کلِ عمر — تنها جایی که هزینه‌ی دستیِ قبل از ثبت وارد محاسبه می‌شود. */
export function lifetimeCard(bot) {
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const pre = Number(getSetting(PRE_TRACK_COST_KEY, '0')) || 0;
  const lt = profitLifetime(bot, { usdToman: rate, preTrackUsd: pre });
  if (!lt.hasRate) return '';
  const margin = lt.rev ? Math.round((lt.net / lt.rev) * 1000) / 10 : 0;
  return `<div class="card">
    ${cardHead('💰 سودِ کلِ عمر')}
    <div class="grid">
      ${stat('سودِ خالصِ کل', `<b class="${lt.net < 0 ? 'drop' : ''}">${fmt(lt.net)} ت</b>`)}
      ${stat('درآمدِ کل', `${fmt(lt.rev)} ت`)}
      ${stat('هزینه‌ی کل', `${usd(lt.costUsd)} ≈ ${fmt(lt.costToman)} ت`)}
      ${stat('حاشیه‌ی سود', `${fmt(margin)}٪`)}
    </div>
    <p class="muted">هزینه = ${usd(lt.trackedUsd)} ثبت‌شده${lt.preTrackUsd
      ? ` + ${usd(lt.preTrackUsd)} دستی (قبل از ${esc(tehranDayStr(lt.costSince || 0))})`
      : ''}.
      ${lt.preTrackUsd ? '' : '⚠️ هزینه‌ی قبل از شروعِ ثبت وارد نشده، پس این سود <b>بیش‌برآورد</b> است.'}
      درآمد بدونِ پرداخت‌های تستی حساب می‌شود.</p></div>`;
}
