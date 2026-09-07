// 💰 اقتصاد و هزینه — «چقدر در آوردیم، چقدر خرج کردیم، آخرش چه ماند؟»
//
// ═══ چرا این صفحه یک انتخابگرِ بازه دارد، نه چند تا ═══
// قاعده‌ی بند ۲الفِ CLAUDE.md ریشه می‌گوید «انتخابگرِ بازه per بخش است، نه سراسری»، و
// آن قاعده درست است: کسی که ماندگاری را ماهانه و هزینه را روزانه می‌بیند دو **سؤالِ
// متفاوت** دارد. ولی این صفحه یک سؤال دارد با سه نما: سود، تفکیکِ هزینه، و سریِ روزانه
// همگی خروجیِ **یک محاسبه**اند. سه انتخابگر برای یک محاسبه نمی‌تواند چیزی جز تناقض
// بسازد، و دقیقاً همان چیزی بود که مالک دید (۱۴۰۵/۰۶/۱۵):
//   • کارتِ سود روی «کل عمر» بود
//   • کارتِ هزینه‌ی مدل روی «ماهانه»
//   • و بلوکِ سومِ embed شده (`costsBody`) روی «۳۰ روز» با کنترلِ کاملاً جدا
// یعنی سه عددِ درآمد روی یک صفحه که هیچ‌کدام با دیگری نمی‌خواند.
// پس: **یک انتخابگر برای خانواده‌ی سنجه‌های پول** (`rEcon`، پیش‌فرض «کل»). این فیلترِ
// سراسری نیست؛ یک محاسبه است که یک بازه دارد. کارتِ اقتصادِ الماس عمداً بیرونِ آن است
// چون **مانده** است نه جریان (کلِ عمر معنی می‌دهد، «هفتگی» نه) و خودش این را می‌گوید.
//
// ═══ و چرا «شروع ثبت هزینه» دیگر هیچ‌جای این صفحه نیست ═══
// خواسته‌ی صریحِ مالک: «قرار بود کلاً مفهوم شروع ثبت هزینه را بی‌خیال شویم». روشش هم
// خودش داده: عددِ تجمعیِ دوره‌ی قبل روی روزهای همان دوره پخش می‌شود (`profitDaily`)،
// پس هر بازه‌ای هزینه‌ی کامل دارد و هیچ استثنا و هیچ هشداری لازم نیست.
import { instancesOf, withDb, hasTable, scalar, rows, botByKey } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, rangeOf, rangeSince, RANGES, tehranDayStr, nowSec } from '../lib/util.js';
import { stat, table, cardHead, rangePicker } from '../lib/html.js';
import { hbars } from '../lib/charts.js';
import { getSetting, setCampaignCost, clearCampaignCost, audit } from '../lib/platform.js';
import { costPerDiamond } from '../lib/cpa.js';
import { coinEconomy, collectDaily, COST_KINDS } from './finance.js';
import { profitFor, lifetimeDays, campaignCostModel, USD_RATE_KEY, PRE_TRACK_COST_KEY } from '../lib/profit.js';

const usd = (n) => `$${(Number(n) || 0).toFixed(Math.abs(Number(n)) < 1 ? 4 : 2)}`;
const t = (n) => `${fmt(Math.round(Number(n) || 0))} ت`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

const KIND_FA = {
  reading: '🔮 خوانشِ فال', repair: '🔧 تعمیرِ نقطه‌ای', daily_card: '🎴 کارت روز',
  feedback: '💬 تصحیحِ بازخورد', transcribe: '🎙 رونویسیِ ویس',
};

/* تفکیکِ مسیرِ هزینه‌ی مدل و شمارشِ فراخوانی — فقط برای **نمایشِ جزئیات**.
 * ⚠️ جمعِ این اعداد عمداً هیچ‌جا به‌عنوانِ «هزینه‌ی کل» استفاده نمی‌شود: هزینه‌ی کل
 * فقط از `profitFor` می‌آید، وگرنه همان دو-عددیِ قبلی برمی‌گردد. */
function modelDetail(botKey, rangeKey) {
  // ⚠️ مرزِ بازه از همان helperِ مشترک می‌آید (مرزِ روزِ تهران)، نه یک حسابِ محلی —
  // وگرنه این کارت یک روز با کارتِ سودِ بالایش اختلاف پیدا می‌کند.
  const since = rangeSince(rangeKey);
  const out = { rowsInRange: 0, byKind: new Map(), readings: 0, has: false, usdInRange: 0 };
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'llm_usage')) return;
      out.has = true;
      out.rowsInRange += scalar(db, 'SELECT COUNT(*) c FROM llm_usage WHERE created_at >= ?', [since]);
      for (const r of rows(db, 'SELECT kind, SUM(cost_usd) s, COUNT(*) c FROM llm_usage WHERE created_at >= ? GROUP BY kind', [since])) {
        const cur = out.byKind.get(r.kind) || { usd: 0, calls: 0 };
        cur.usd += r.s || 0; cur.calls += r.c; out.byKind.set(r.kind, cur);
        out.usdInRange += r.s || 0;
      }
      if (hasTable(db, 'readings')) {
        out.readings += scalar(db, "SELECT COUNT(*) c FROM readings WHERE status='delivered' AND price>0 AND created_at >= ?", [since]);
      }
    });
  }
  return out;
}

/** تخفیف و هدیه در همان بازه — **گزارشی**، نه هزینه. */
function giving(botKey, days) {
  const series = collectDaily(days || lifetimeDays(botKey), botKey);
  const sum = { disc: 0, giftCoins: 0, kinds: {} };
  for (const r of series) {
    sum.disc += r.disc; sum.giftCoins += r.giftCoins;
    for (const [k, v] of Object.entries(r.kinds)) sum.kinds[k] = (sum.kinds[k] || 0) + v;
  }
  return sum;
}

export function economicsBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  if (!instancesOf(bot).length) {
    return `<div class="card"><h2>💰 اقتصاد و هزینه</h2><p class="muted">دیتابیسِ این ربات پیدا نشد.</p></div>`;
  }
  const rk = rangeOf(url, 'rEcon', 'all');
  const p = profitFor(bot, rk);        // ← تک‌منبعِ همه‌ی اعدادِ پولیِ این صفحه و نمای کلی

  const head = `<div class="card">
    ${cardHead(`💰 اقتصاد و هزینه — ${esc(title)}`, rangePicker(url, 'rEcon', rk))}
    <p class="muted" style="margin:6px 0 0">همه‌ی کارت‌های این صفحه از <b>همین یک بازه</b>
      پیروی می‌کنند، چون همه خروجیِ یک محاسبه‌اند. تنها استثنا «اقتصادِ الماس» است که
      <b>مانده</b> است نه جریان، پس همیشه کلِ عمر را می‌گوید.</p></div>`;

  /* ⚠️ نبودِ نرخِ دلار کلِ صفحه را خاموش **نمی‌کند** — فقط سودِ تومانی را. نسخه‌ی اولِ
     این بازسازی زودهنگام return می‌کرد و صفحه‌ای که تا دیروز هزینه‌ی دلاری‌اش را نشان
     می‌داد یک‌باره خالی می‌شد. هزینه ذاتاً دلاری است و بدونِ هیچ نرخی هم معنی دارد؛
     چیزی که بدونِ نرخ ساخته نمی‌شود فقط تبدیل به تومان و در نتیجه «سود» است. */
  const profit = p.rate ? profitCard(url, bot, p, rk) : `<div class="card">
    ${cardHead('📈 سودِ خالص')}
    <p>هزینه دلاری است و درآمد تومانی، پس بدونِ <b>نرخِ دلار</b> این دو قابلِ کم‌کردن از
      هم نیستند و سود ساخته نمی‌شود. بقیه‌ی اعدادِ این صفحه (که دلاری‌اند) سرِ جایشان‌اند.</p>
    <p class="muted">نرخ را در کارتِ بالا وارد کن تا سود هم زنده شود.</p></div>`;

  return `${head}${costInputsCard(bot, url)}${profit}
    ${costBreakdownCard(bot, p, rk)}${modelCard(bot, p, rk)}${diamondCard(bot, p, rk)}`;
}

/* ═══ 📈 سودِ خالص — سرخطِ صفحه، و **همان عددی که نمای کلی نشان می‌دهد** ═══ */
export function profitCard(url, bot, pIn, rkIn) {
  const rk = rkIn || rangeOf(url, 'rEcon', 'all');
  const p = pIn || profitFor(bot, rk);
  if (!p.rate) return '';
  const tot = p.totals;
  const margin = tot.rev ? Math.round((tot.net / tot.rev) * 1000) / 10 : 0;
  const daily = p.series.slice().reverse().filter(r => r.rev || r.costToman).map(r => [
    r.d, t(r.rev),
    `${t(r.costToman)} <span class="muted">(${usd(r.costUsd)})</span>`,
    `<span class="${r.net < 0 ? 'drop' : ''}"><b>${t(r.net)}</b></span>`,
    `<span class="${r.cum < 0 ? 'drop' : ''}">${t(r.cum)}</span>`,
  ]);

  return `<div class="card">
    ${cardHead(`📈 سودِ خالص — ${esc(RANGES[rk].label)}`)}
    <div class="grid">
      ${stat('سودِ خالص', `<b class="${tot.net < 0 ? 'drop' : ''}">${t(tot.net)}</b>`)}
      ${stat('درآمدِ دریافتی', t(tot.rev) + (tot.orphan
        ? ` <span class="muted">(${fmt(tot.orphan)} ت سرگردان)</span>` : ''))}
      ${stat('هزینه‌ی کل', `${t(tot.costToman)} <span class="muted">(${usd(tot.costUsd)})</span>`)}
      ${stat('حاشیه‌ی سود', `${fmt(margin)}٪`)}
      ${stat('نقطه‌ی سربه‌سر', p.breakEven
        ? `<b>${esc(p.breakEven)}</b>`
        : `<span class="muted">${tot.net < 0 ? 'هنوز نرسیده' : 'از ابتدا مثبت'}</span>`)}
    </div>
    <p class="muted">سود = <b>درآمدِ دریافتی − هزینه‌ی مدل − هزینه‌ی تبلیغ</b>.
      تخفیف کم نمی‌شود (از قبل داخلِ درآمد است) و اعتبارِ هدیه هم نه (پولِ نقد نیست؛
      هزینه‌ی واقعی‌اش وقتی خرج شود در هزینه‌ی مدل می‌آید). پرداخت‌های تستی اصلاً واردِ
      درآمد نمی‌شوند.${tot.orphan ? ` <b>${fmt(tot.orphan)} تومان</b> از این درآمد
      «پرداختِ سرگردان» است: پولی که به حساب رسیده ولی کاربرش رسید نفرستاده و دستی ثبت شده.` : ''}</p>
    <h3 class="ch">روزانه (جدیدترین بالا)</h3>
    ${table(['روز', 'درآمد', 'هزینه', 'سودِ روز', 'تجمعی'], daily, 'در این بازه دیتایی نیست')}
    <p class="muted">«نقطه‌ی سربه‌سر» اولین روزی است که تجمعی مثبت شد <b>و دیگر منفی
      نشد</b> — یک روزِ پرفروشِ تنها که فردا برمی‌گردد، سربه‌سر نیست.
      «تجمعی» از ابتدای همین بازه جمع می‌شود، پس در بازه‌ی «کل» یعنی از روزِ اولِ ربات.</p></div>`;
}

/* ═══ 🧾 تفکیکِ هزینه — کارتی که جوابِ «چرا حساب و کتابم با پنل نمی‌خواند» است ═══
 *
 * مالک هزینه‌ها را دستی جمع زد و به عددِ دیگری رسید. سه دلیل داشت و هر سه این‌جا
 * صریح نشان داده می‌شوند:
 *   ۱) صفحه‌ی «هزینه‌ی مدل» فقط بخشِ **ثبت‌شده** را می‌گفت («هزینه‌ی کل از شروعِ ثبت»)،
 *      یعنی نصفِ داستان؛ دوره‌ی قبلش جای دیگری بود.
 *   ۲) هزینه‌ی تبلیغ اصلاً در این صفحه نبود و باید از صفحه‌ی «جذب» برداشته می‌شد.
 *   ۳) و بدترینش: عددی که در صفحه‌ی «جذب» جلوی «کمپین تبلیغاتی» می‌نشیند **هزینه‌ی
 *      تبلیغ نیست**. آن ستون CPA است و در `lib/cpa.js` این‌طور ساخته می‌شود:
 *        هزینه‌ی الماسِ خوش‌آمدِ مصرف‌شده (× نرخِ دلاریِ خدمت‌رسانی) + سهمِ پاداشِ دعوت
 *        + هزینه‌ی تبلیغِ دستی
 *      یعنی جزءِ اولش **از قبل داخلِ هزینه‌ی مدل هست**. جمع‌کردنش با هزینه‌ی مدل،
 *      هزینه‌ی خدمت‌رسانیِ الماسِ هدیه را دو بار می‌شمارد.
 * پس این کارت جمعِ نهایی را خودش نشان می‌دهد تا هیچ‌کس دیگر لازم نباشد دستی جمع بزند.
 */
export function costBreakdownCard(bot, p, rk) {
  const tot = p.totals;
  const rate = p.rate;
  /* بدونِ نرخ، ستونِ تومان خالی می‌ماند — نه صفر. صفر یعنی «هزینه‌ای نبود»، که دروغ است.
   * ⚠️ عددِ تومانِ هر ردیف از **خودِ سری** می‌آید (`totals.llmToman` و…)، نه از
   * `round(دلارِ همان ردیف × نرخ)`. اگر دومی بود، سه ردیف به ردیفِ «جمع» نمی‌رسیدند و
   * دقیقاً همان «اعدادت با هم نمی‌خوانَد»ی می‌شد که این بازسازی برای رفعش است. */
  const tCol = (v) => (rate ? t(v) : '<span class="muted">-</span>');
  const line = (label, u, tv, note = '') => [
    label, usd(u), tCol(tv), `${fmt(pct(u, tot.costUsd))}٪`, note,
  ];
  const body = [
    line('🤖 هزینه‌ی مدل — ثبتِ خودکار', tot.llmUsd, tot.llmToman,
      '<span class="muted">از <span class="mono">llm_usage</span>، همان عددی که OpenRouter برمی‌گرداند</span>'),
    ...(tot.preUsd ? [line('🤖 هزینه‌ی مدل — دوره‌ی قبل از ثبت', tot.preUsd, tot.preToman,
      `<span class="muted">سهمِ این بازه از ${usd(p.preUsd)}ِ واردشده‌ی دستی، پخش‌شده روی روزهای همان دوره</span>`)] : []),
    /* ⚠️ توضیحِ این ردیف عمداً «N × یک نرخ» نیست: نرخ per **روز** است، پس نوشتنِ یک
       ضربِ ساده همان دروغی می‌شد که این تغییر برای حذفش بود. به‌جایش می‌گوییم چند
       کاربر با نرخِ **ثبت‌شده‌ی روزِ خودش** حساب شده و چند تا با میانگین. */
    line('📣 هزینه‌ی تبلیغِ کمپین', tot.adUsd, tot.adToman,
      tot.campaignUsers
        ? `<span class="muted">${fmt(tot.campaignUsers)} کاربرِ کمپین${tot.adExact === tot.campaignUsers
            ? '، همه با نرخِ ثبت‌شده‌ی روزِ خودشان'
            : tot.adExact
              ? `؛ ${fmt(tot.adExact)} با نرخِ روزِ خودشان و ${fmt(tot.campaignUsers - tot.adExact)} با میانگین (${usd(p.campUsd)})`
              : `، همه با میانگینِ ${usd(p.campUsd)} چون روزهایشان ثبت نشده`}</span>`
        : '<span class="muted">کاربرِ کمپینی در این بازه نبود</span>'),
  ];

  return `<div class="card">
    ${cardHead(`🧾 هزینه‌ها به تفکیک — ${esc(RANGES[rk].label)}`)}
    ${table(['نوعِ هزینه', 'دلار', 'تومان', 'سهم', 'از کجا می‌آید'], [
      ...body,
      [`<b>جمعِ هزینه</b>`, `<b>${usd(tot.costUsd)}</b>`, `<b>${tCol(tot.costToman)}</b>`, '<b>۱۰۰٪</b>', ''],
      [`<b>درآمدِ دریافتی</b>`, rate ? `<span class="muted">${usd(tot.rev / rate)}</span>` : '<span class="muted">-</span>', `<b>${t(tot.rev)}</b>`, '', ''],
      ...(rate ? [[`<b>سودِ خالص</b>`, '', `<b class="${tot.net < 0 ? 'drop' : ''}">${t(tot.net)}</b>`, '', '']] : []),
    ])}
    <div class="note">🧮 <b>اگر دستی جمع می‌زنی، این نکته را از دست نده:</b> عددی که در
      صفحه‌ی «📥 جذب و کانال‌ها» جلوی <b>کمپین تبلیغاتی</b> نوشته شده، <b>هزینه‌ی تبلیغ
      نیست</b>. آن ستون <b>CPA</b> است و علاوه بر هزینه‌ی تبلیغ، <b>هزینه‌ی خدمت‌رسانیِ
      الماسِ خوش‌آمد</b> را هم دارد — و آن بخش از قبل داخلِ «هزینه‌ی مدل» همین جدول هست.
      جمع‌کردنِ آن دو یعنی یک هزینه را دو بار شمردن. هزینه‌ی تبلیغِ خالص، همان ردیفِ
      📣 بالاست.</div>
    <p class="muted">این جدول <b>همه‌ی</b> هزینه‌های ربات است. اگر هزینه‌ی دیگری هم داری
      (سرور، دامنه، …) فعلاً هیچ‌جای داشبورد ثبت نمی‌شود و اگر لازم شد باید ورودیِ دستیِ
      جدا بگیرد؛ داشبورد چیزی را که نمی‌داند حدس نمی‌زند.</p></div>`;
}

/* ═══ 🤖 جزئیاتِ هزینه‌ی مدل — «این دلار کجا خرج شد؟» ═══ */
export function modelCard(bot, p, rk) {
  const md = modelDetail(bot, rk);
  if (!md.has) {
    return `<div class="card">${cardHead('🤖 جزئیاتِ هزینه‌ی مدل')}
      <div class="note">ثبتِ خودکارِ هزینه هنوز ردیفی ندارد.</div></div>`;
  }
  const tot = p.totals;
  const perReading = md.readings ? md.usdInRange / md.readings : 0;
  const perCall = md.rowsInRange ? md.usdInRange / md.rowsInRange : 0;
  const avgDaily = p.series.length ? tot.costUsd / p.series.length : 0;
  const toman = (u) => (p.rate ? `<span class="muted"> ≈ ${fmt(Math.round(u * p.rate))} ت</span>` : '');

  return `<div class="card">
    ${cardHead(`🤖 جزئیاتِ هزینه‌ی مدل — ${esc(RANGES[rk].label)}`)}
    <div class="grid">
      ${stat('میانگینِ هزینه‌ی روزانه (کلِ هزینه)', usd(avgDaily) + toman(avgDaily))}
      ${stat('هزینه به ازای هر فال', usd(perReading) + toman(perReading))}
      ${stat('هزینه به ازای هر فراخوانی', usd(perCall) + toman(perCall))}
      ${stat('فراخوانیِ ثبت‌شده در بازه', fmt(md.rowsInRange))}
      ${stat('فالِ تحویل‌شده در بازه', fmt(md.readings))}
    </div>
    ${md.byKind.size ? `<div style="margin-top:14px"><h3 class="ch">هزینه به تفکیکِ مسیر</h3>
      ${hbars([...md.byKind.entries()].sort((a, b) => b[1].usd - a[1].usd)
        .map(([k, v]) => ({ label: `${KIND_FA[k] || k} (${fmt(v.calls)} فراخوانی)`, value: Math.round(v.usd * 10000) / 10000 })), { showPct: true })}</div>` : ''}
    <p class="muted" style="margin-top:8px">این تفکیک فقط روی بخشِ <b>ثبتِ خودکار</b>
      ممکن است؛ دوره‌ی قبلش یک عددِ تجمعی است و تفکیکِ مسیر ندارد، پس در نمودارِ بالا
      نیست ولی در «هزینه‌ی کل» هست.
      ⚠️ داوریِ رسید (<span class="mono">cardpay.js</span>) هنوز شمرده نمی‌شود.</p></div>`;
}

/* ═══ 💎 اقتصادِ الماس — عمداً «کلِ عمر»، چون **مانده** است نه جریان ═══ */
export function diamondCard(bot, p, rk) {
  const cpd = costPerDiamond(bot);
  const econ = coinEconomy(bot);
  const give = giving(bot, RANGES[rk].days || p.days);
  const toman = (u) => (p.rate ? `<span class="muted"> ≈ ${fmt(Math.round(u * p.rate))} ت</span>` : '');

  const cpdTable = cpd.hasData ? `<h3 class="ch">هزینه‌ی هر الماس per اندازه‌ی فال</h3>
    ${table(['اندازه', 'فال', 'الماس', 'هزینه', 'هزینه‌ی هر الماس'], cpd.sizes.map(s => [
      `${fmt(s.size)} کارتی`, fmt(s.readings), `${fmt(s.diamonds)}💎`, usd(s.usd), `<b>${usd(s.cpd)}</b>${toman(s.cpd)}`]))}` : '';

  const stocks = econ.map(e => `<h3 class="ch">${esc(e.inst.title)} — کلِ عمر</h3>
    <div class="grid">
      ${stat('هدیه‌شده', `${fmt(e.gifted)}💎`)}
      ${stat('خریداری‌شده', `${fmt(e.bought)}💎`)}
      ${stat('مصرف‌شده (فالِ تحویل‌شده)', `${fmt(e.spent)}💎`)}
      ${stat('ماندهٔ کیفِ کاربران', `${fmt(e.held)}💎`)}
    </div>
    ${e.legacyRows ? `<p class="muted">🕰 به‌علاوه <b>${fmt(e.legacyRows)}</b> شارژِ
      <b>پیش از دوره‌ی الماس</b> به ارزشِ ${fmt(e.legacyToman)} تومان، که در عددِ بالا
      <b>نیامده</b>: آن روزها ستونِ اعتبار <b>تومان</b> بود نه الماس، و جمع‌کردنشان یعنی
      دو واحدِ متفاوت را با هم بریزیم. (همین باعث شده بود این کارت
      <span class="mono">${fmt(e.bought + e.legacyToman)}💎</span> نشان بدهد.)</p>` : ''}`).join('');

  return `<div class="card">
    ${cardHead('💎 اقتصادِ الماس و بذل‌وبخشش')}
    ${stocks}
    <p class="muted">این چهار عدد <b>مانده</b> هستند نه جریان، پس همیشه کلِ عمر را
      می‌گویند و انتخابگرِ بازه‌ی صفحه رویشان اثر ندارد. «هدیه‌شده» هزینه‌ی نقدی نیست؛
      بدهیِ تبلیغاتی است که فقط وقتی خرج شود هزینه می‌سازد، و آن هزینه از قبل در
      «هزینه‌ی مدل» آمده. اختلافِ «ماندهٔ کیف» با «مصرف‌شده» همان نرخِ سوختِ اعتبار است.</p>
    <h3 class="ch">در بازه‌ی ${esc(RANGES[rk].label)} — گزارشی، نه هزینه</h3>
    <div class="grid">
      ${stat('تخفیفِ داده‌شده', t(give.disc))}
      ${stat('الماسِ هدیه‌شده', `${fmt(give.giftCoins)}💎`)}
    </div>
    ${Object.keys(give.kinds).length ? table(['نوعِ هدیه', 'مقدار'],
      Object.entries(give.kinds).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [esc(COST_KINDS[k] || k || 'سایر'), fmt(v)])) : ''}
    <p class="muted">🐛 <b>تخفیف عمداً از سود کم نمی‌شود</b> و این یک اصلاح است نه سهو:
      ستونِ <span class="mono">amount</span> در خودِ ربات از قبل <b>بعد از</b> تخفیف نوشته
      می‌شود، پس کم‌کردنِ دوباره‌اش تخفیف را دو بار می‌شمرد. این‌جا فقط <b>گزارش</b>
      می‌شود تا بدانی چقدر دادی.</p>
    ${cpdTable}
    ${cpd.hasData ? '<p class="muted">همین نرخ‌ها ورودیِ محاسبه‌ی CPA در صفحه‌ی «جذب و کانال‌ها» هستند.</p>' : ''}</div>`;
}

/* ⚙️ ورودی‌های دستیِ هزینه — **اولین کارتِ این صفحه** (خواسته‌ی مالک ۱۴۰۵/۰۶/۱۵).
   قبلاً وسطِ صفحه‌ی «جذب» بود، ولی هر سه ورودی‌اش ورودیِ محاسبه‌ی اقتصادند و بدونشان
   هیچ عددِ تومانی‌ای در این صفحه ساخته نمی‌شود. پس اول صفحه، جایی که اگر خالی باشد
   بلافاصله دیده شود. اکشن عمداً همان `/acquisition/settings` ماند تا audit نشکند. */
export function costInputsCard(bot, url = null) {
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  const pre = Number(getSetting(PRE_TRACK_COST_KEY, '0')) || 0;
  const cam = campaignCostModel(bot);

  /* 📅 روزِ انتخاب‌شده. پیش‌فرض **امروزِ تهران**، و اگر آن روز ردیفی ندارد فیلد خالی
     می‌ماند (نه صفر): خالی یعنی «هنوز وارد نکرده‌ام»، صفر یعنی «آن روز تبلیغ نداشتم».
     این دو معنیِ متفاوت‌اند و یکی‌کردنشان هر روزِ واردنشده را بی‌صدا صفر می‌کند. */
  const today = tehranDayStr(nowSec());
  const raw = url?.searchParams.get('cpaDay') || '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const dayUsd = cam.rates.has(day) ? cam.rates.get(day) : null;
  const dayUsers = cam.users.get(day) || 0;

  const missing = [!rate && 'نرخ دلار', !cam.avgUsd && 'هزینه‌ی تبلیغ'].filter(Boolean);
  const q = new URLSearchParams(url?.searchParams || '');
  q.delete('cpaDay');
  const keep = [...q.entries()].map(([k, v]) =>
    `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');

  /* تاریخچه‌ی روزهای واردشده — جدیدترین بالا، با تعدادِ کاربر و خرجِ همان روز، چون
     «نرخ» بدونِ «چند نفر» هیچ نمی‌گوید. */
  const histRows = [...cam.rates.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, u]) => {
    const n = cam.users.get(d) || 0;
    return [
      `<a href="?${new URLSearchParams({ ...Object.fromEntries(q), cpaDay: d })}#cpa">${esc(d)}</a>`,
      usd(u), fmt(n), usd(u * n),
      d === day ? '<span class="badge">در حالِ ویرایش</span>' : '',
    ];
  });

  return `<div class="card" id="cpa">
    ${cardHead('⚙️ ورودی‌های دستیِ هزینه')}
    ${missing.length ? `<div class="note">⚠️ تا ${esc(missing.join(' و '))} وارد نشود،
      بخشی از اعدادِ این صفحه ساخته نمی‌شود. داشبورد هیچ نرخی از خودش حدس نمی‌زند.</div>` : ''}

    <form method="post" action="/acquisition/settings" class="inline">
      <input type="hidden" name="bot" value="${esc(bot)}">
      <label>نرخ دلار به تومان
        <input name="rate" type="number" min="0" value="${rate || ''}" placeholder="مثلاً 225000"></label>
      <label>هزینه‌ی مدل قبل از شروعِ ثبت (دلار)
        <input name="pre" type="number" step="0.01" min="0" value="${pre || ''}" placeholder="مثلاً 4.19"></label>
      <button type="submit">ذخیره</button>
    </form>

    <h3 class="ch">📣 هزینه‌ی تبلیغ per کاربرِ کمپین — به تفکیکِ روز</h3>
    <p class="muted" style="margin:0 0 8px">کمپین‌ها هر روز ران‌اند و نرخشان ثابت نیست،
      پس هر روز عددِ خودش را می‌گیرد. تاریخ را انتخاب کن، دلارِ همان روز را بنویس و
      <b>ثبت</b> بزن. تا ثبت نزنی چیزی ذخیره نمی‌شود.</p>

    <form method="get" class="inline" style="margin-bottom:6px">${keep}
      <label>تاریخ
        <input name="cpaDay" type="date" value="${esc(day)}" max="${esc(today)}"
          onchange="this.form.submit()"></label>
      <noscript><button type="submit">نمایش</button></noscript>
    </form>

    <form method="post" action="/economics/cpa-day" class="inline">
      <input type="hidden" name="bot" value="${esc(bot)}">
      <input type="hidden" name="day" value="${esc(day)}">
      <label>هزینه per کاربر در <b>${esc(day)}</b> (دلار)
        <input name="usd" type="number" step="0.00001" min="0" value="${dayUsd ?? ''}"
          placeholder="${dayUsd === null ? 'هنوز وارد نشده' : ''}"></label>
      <button type="submit">ثبت</button>
    </form>
    <p class="muted" style="margin-top:6px">
      ${dayUsers
        ? `در این روز <b>${fmt(dayUsers)}</b> کاربرِ کمپین وارد شده‌اند${dayUsd !== null
            ? `، پس خرجِ این روز <b>${usd(dayUsd * dayUsers)}</b> است.` : '.'}`
        : 'در این روز هیچ کاربرِ کمپینی وارد نشده، پس عددش روی هیچ محاسبه‌ای اثر نمی‌گذارد.'}
      <br>فیلد را <b>خالی</b> بگذار و ثبت بزن تا ردیفِ آن روز پاک شود و دوباره میانگین
      بگیرد. <b>صفر</b> با خالی فرق دارد: صفر یعنی «آن روز واقعاً تبلیغی نداشتم».</p>

    ${histRows.length ? `<h3 class="ch">روزهای ثبت‌شده</h3>
    ${table(['روز', 'نرخ per کاربر', 'کاربرِ کمپین', 'خرجِ آن روز', ''], histRows, '')}` : ''}

    <div class="grid" style="margin-top:10px">
      ${stat('میانگینِ هزینه per کاربرِ کمپین', `<b>${usd(cam.avgUsd)}</b>${rate
        ? ` <span class="muted">≈ ${fmt(Math.round(cam.avgUsd * rate))} ت</span>` : ''}`)}
      ${stat('روزهای ثبت‌شده', fmt(cam.enteredDays))}
      ${stat('کاربرِ پوشش‌داده‌شده', fmt(cam.coveredUsers))}
      ${stat('خرجِ تبلیغِ ثبت‌شده', usd(cam.spentUsd))}
    </div>
    <p class="muted">این میانگین <b>قابلِ ویرایش نیست</b> و خودش ساخته می‌شود:
      <b>کلِ خرجِ روزهای ثبت‌شده ÷ کلِ کاربرِ همان روزها</b> (وزنی، نه میانگینِ ساده —
      روزی که ۲۰۰ کاربر آورده نباید هم‌وزنِ روزی باشد که ۲ کاربر آورده). هر روزی که
      ثبت نکرده باشی، در محاسبات <b>همین میانگین</b> را می‌گیرد.
      ${cam.usingLegacy ? `<br>⚠️ هنوز هیچ روزی ثبت نشده، پس فعلاً عددِ ثابتِ قدیمی
        (<b>${usd(cam.legacy)}</b>) برای همه‌ی روزها به‌کار می‌رود. با ثبتِ اولین روز،
        آن کنار می‌رود و دیگر هیچ‌جا استفاده نمی‌شود.` : ''}</p>

    <p class="muted" style="margin-top:8px">
      هزینه‌ی تبلیغ عمداً <b>دلاری</b> است تا با هزینه‌ی مدل هم‌واحد بماند؛ تومانش خودکار می‌آید.
      <br>«هزینه‌ی قبل از شروعِ ثبت» را از داشبوردِ خودِ OpenRouter بخوان. این عدد روی
      <b>همه‌ی روزهای پیش از شروعِ ثبت</b> پخش می‌شود، پس هر بازه‌ای (از جمله «کل»)
      هزینه‌ی کامل دارد و مفهومِ «شروعِ ثبت» هیچ‌جای اعداد دیده نمی‌شود.
      <br>🔎 <b>اتوماسیون:</b> <span class="mono">ads.telegram.org</span> API عمومی برای خواندنِ هزینه‌ی
      کمپینِ خودت ندارد (فقط داشبوردِ وبی)، پس این ورودی دستی می‌ماند.</p></div>`;
}

/* ═══ 📣 ثبتِ هزینه‌ی تبلیغِ یک روز ═══
 *
 * ⚠️ «خالی» و «صفر» عمداً دو کارِ متفاوت می‌کنند و این هسته‌ی درستیِ محاسبه است:
 *   خالی → ردیف **پاک** می‌شود، پس آن روز دوباره میانگین می‌گیرد («نمی‌دانم»).
 *   صفر  → ردیف با مقدارِ ۰ می‌ماند («آن روز واقعاً تبلیغی نداشتم»).
 * اگر این دو یکی می‌شدند، هر روزِ واردنشده بی‌صدا صفر حساب می‌شد و سود سیستماتیک
 * خوش‌بینانه می‌شد — همان کلاسِ خطایی که کلِ این بازسازی برای حذفش بود.
 *
 * امنیت: `day` با رجکسِ سخت‌گیر اعتبارسنجی می‌شود و بعد به‌عنوان **پارامترِ bound**
 * به SQL می‌رود (هیچ interpolation ای)، و ربات از فهرستِ رجیستری می‌آید نه از URL. */
export function cpaDaySet(body) {
  const bot = String(body.get('bot') || '');
  if (!botByKey(bot)) throw new Error('ربات نامعتبر');
  const day = String(body.get('day') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('تاریخ نامعتبر است');
  if (day > tehranDayStr(nowSec())) throw new Error('تاریخِ آینده نمی‌شود؛ هزینه‌ی روزی که نیامده وجود ندارد');

  const raw = String(body.get('usd') ?? '').trim();
  if (raw === '') {
    clearCampaignCost(bot, day);
    audit('economics.cpa_day', `${bot}/${day}`, 'cleared');
    return `ردیفِ ${day} پاک شد؛ آن روز دوباره میانگین می‌گیرد`;
  }
  const usdVal = Number(raw);
  if (!Number.isFinite(usdVal) || usdVal < 0) throw new Error('عدد نامعتبر است');
  if (usdVal > 1000) throw new Error('عدد غیرمنطقی بزرگ است (سقف: ۱۰۰۰ دلار per کاربر)');
  setCampaignCost(bot, day, usdVal);
  audit('economics.cpa_day', `${bot}/${day}`, `usd=${usdVal}`);
  return `هزینه‌ی ${day} روی ${usdVal} دلار per کاربر ثبت شد`;
}
