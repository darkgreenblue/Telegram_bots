// 📥 جذب و کانال‌ها — «کاربرها از کجا می‌آیند و هر کدام چقدر آب می‌خورند؟»
//
// این صفحه فقط **گزارش** است؛ ساختنِ کمپین و لینک در «اقدام‌ها ← کمپین‌ساز» است.
// جدایی عمدی است: تا حالا یک صفحه هم فرمِ ساخت بود هم گزارشِ عملکرد، و هیچ‌کدام را خوب
// خدمت نمی‌کرد (ایرادِ صریحِ مالک به گنگ‌بودنِ دسته‌بندی‌ها).
import { instancesOf, withDb, hasTable, scalar, botByKey, moneyText } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, rangeOf, rangeSince, RANGES } from '../lib/util.js';
import { stat, cohortCount, table, cardHead, rangePicker } from '../lib/html.js';
import { getSetting, setSetting, audit, listCampaigns } from '../lib/platform.js';
import { channelCosts, CHANNELS } from '../lib/cpa.js';
import { successfulReferrersSql } from '../lib/engage.js';
import { campaignStats, channelSummary, postsCards } from './marketing.js';

/* ⚠️ تک‌منبع: تعریفِ این دو کلید در `lib/profit.js` است، چون سه صفحه (جذب، اقتصاد،
   نمای کلی) رویشان می‌نشینند و سه تعریفِ جدا یعنی دیر یا زود یکی عوض شود و بقیه ساکت
   بمانند. این‌جا فقط re-export می‌شود تا مصرف‌کننده‌های قبلی نشکنند. */
export { USD_RATE_KEY, CAMPAIGN_CPA_KEY, PRE_TRACK_COST_KEY } from '../lib/profit.js';
import { USD_RATE_KEY, CAMPAIGN_CPA_KEY, PRE_TRACK_COST_KEY, campaignCostModel } from '../lib/profit.js';

const usd = (n) => `$${(Number(n) || 0).toFixed(Math.abs(Number(n)) < 1 ? 4 : 2)}`;
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export function acquisitionBody(url) {
  const bot = scopeBot(url);
  const title = botByKey(bot)?.title || bot;
  if (!instancesOf(bot).length) {
    return `<div class="card"><h2>📥 جذب و کانال‌ها</h2><p class="muted">دیتابیسِ این ربات پیدا نشد.</p></div>`;
  }
  const rk = rangeOf(url, 'rCpa', 'all');
  const since = rangeSince(rk);
  const rate = parseInt(getSetting(USD_RATE_KEY, '0'), 10) || 0;
  /* نرخِ تبلیغ حالا per روز است؛ `avgUsd` فقط برای ردیف‌هایی که تفکیکِ روزانه ندارند
     (مثلِ سودِ هر کمپین که کوهورتِ چندروزه است) به‌عنوان **میانگین** به‌کار می‌رود. */
  const cam = campaignCostModel(bot);
  const campUsd = cam.avgUsd;
  const toman = (u) => (rate ? `<span class="muted"> ≈ ${fmt(Math.round(u * rate))} ت</span>` : '');

  const { cpd, channels } = channelCosts(bot, { sinceSec: since, campaign: cam });
  const totalUsers = CHANNELS.reduce((a, c) => a + channels[c.key].users, 0);

  /* ── جدولِ CPA ── */
  const cpaRows = CHANNELS.map((c) => {
    const d = channels[c.key];
    return [
      esc(c.label),
      cohortCount(d.users, { k: 'chan', bot, c: c.key === 'campaign' ? 'campaign_any' : c.key })
        + ` <span class="muted">${fmt(pctOf(d.users, totalUsers))}٪</span>`,
      `${usd(d.costUsd)}${toman(d.costUsd)}`,
      d.users ? `<b>${usd(d.cpaUsd)}</b>${toman(d.cpaUsd)}` : '<span class="muted">-</span>',
      `${fmt(Math.round(d.diamonds))}💎`,
    ];
  });
  const cpaCard = `<div class="card">
    ${cardHead('💸 هزینه‌ی جذبِ هر کاربر (CPA)', rangePicker(url, 'rCpa', rk, { label: 'کوهورتِ ورود' }))}
    ${table(['کانال', 'کاربرِ جدید', 'هزینه‌ی کل', 'CPA', 'الماسِ جذبِ مصرف‌شده'], cpaRows)}
    <p class="muted" style="margin-top:10px">
      <b>هزینه یعنی چه:</b> الماسِ هدیه تا وقتی خرج نشود هیچ هزینه‌ای ندارد (بدهیِ تبلیغاتی است، نه پولِ نقد).
      هزینه لحظه‌ای رخ می‌دهد که کاربر آن را خرج کند و ما یک فال تحویل بدهیم، و اندازه‌اش
      <b>دلارِ واقعیِ OpenRouter</b> است نه قیمتِ فروشِ الماس.
      فقط هدیه‌های <b>جذب</b> شمرده می‌شوند (خوش‌آمد + پاداشِ دعوت)؛ استریک و کارتِ شانس هزینه‌ی
      نگه‌داشت‌اند نه جذب.
      «کوهورتِ ورود» بازه را روی <b>تاریخِ ثبت‌نامِ کاربر</b> می‌برد، چون CPA ذاتاً سنجه‌ی کوهورتِ جذب است.</p>
    <p class="muted">
      <b>دعوت:</b> پاداشی که به دعوت‌کننده رسیده، هزینه‌ی جذبِ همان کاربرِ دعوت‌شده حساب می‌شود
      (حتی اگر دعوت‌کننده از کانالِ دیگری آمده باشد) و بینِ دعوت‌هایش تقسیم می‌شود.
      <b>کمپین:</b> علاوه بر الماسِ خوش‌آمد، هزینه‌ی دستیِ تبلیغ هم روی هر کاربر می‌نشیند.</p></div>`;

  /* ⚠️ کارتِ «ورودی‌های دستیِ هزینه» از این صفحه **رفت** به ابتدای «اقتصاد و هزینه»
     (خواسته‌ی مالک ۱۴۰۵/۰۶/۱۵). دلیلِ ساختاری‌اش همان قاعده‌ی «تحلیل جدا از اقدام» است:
     یک **فرم** بود وسطِ صفحه‌ی گزارشی، و هر سه ورودی‌اش (نرخِ دلار، هزینه‌ی تبلیغ،
     هزینه‌ی قبل از ثبت) ورودیِ محاسبه‌ی **اقتصاد** اند نه فقط جذب.
     `costInputsCard` در `economics.js` است و اکشنش همان `/acquisition/settings` ماند
     تا لینکِ فرم و تاریخچه‌ی audit نشکند. */
  /* ── نرخِ هزینه‌ی هر الماس (ورودیِ محاسبه‌ی بالا) ── */
  const cpdCard = `<div class="card">
    ${cardHead('💎 هزینه‌ی هر الماس (ورودیِ محاسبه‌ی CPA)')}
    ${cpd.hasData
      ? table(['اندازه‌ی فال', 'فالِ دارای دیتای هزینه', 'الماسِ خرج‌شده', 'هزینه‌ی کل', 'هزینه‌ی هر الماس'],
        cpd.sizes.map(s => [
          `${fmt(s.size)} کارتی`, fmt(s.readings), `${fmt(s.diamonds)}💎`,
          usd(s.usd), `<b>${usd(s.cpd)}</b>${toman(s.cpd)}`,
        ]))
      : `<div class="note">هنوز هیچ فالی با دیتای هزینه ثبت نشده. ثبتِ هزینه از لحظه‌ی انتشارش شروع
          می‌شود و برای فال‌های قدیمی‌تر <b>قابلِ بازسازی نیست</b>؛ تا پر شدنش CPA صفر می‌ماند.</div>`}
    <p class="muted">نرخ = مجموعِ دلارِ فال‌های همان اندازه ÷ مجموعِ الماسِ خرج‌شده در آن‌ها.
      یک الماس در فالِ ده‌کارتی و سه‌کارتی هزینه‌ی یکسانی ندارد، پس عمداً یک نرخِ واحد ساخته نشده.
      محاسبه زنده است (نه کش‌شده)، پس دکمه‌ی «محاسبه‌ی مجدد» لازم ندارد.</p></div>`;

  /* ── چنل‌های ورودی (تعداد/خریدار/درآمد) ── */
  const chList = channelSummary(bot);
  const campaigns = listCampaigns().filter(c => c.bot === bot);
  const chCard = chList.length ? `<div class="card">
    ${cardHead('🛣 چنل‌های ورودی')}
    ${table(['چنل', 'کاربر', 'خریدار', 'درآمد'], chList.map(([ch, m]) => {
      const camp = ch.startsWith('campaign:') && campaigns.find(c => `campaign:${c.code}` === ch);
      const cohort = ch.startsWith('campaign:') ? { k: 'chan', bot, c: 'campaign', val: ch }
        : ch === 'رفرال' ? { k: 'chan', bot, c: 'referral' }
        : ch === 'ارگانیک' ? { k: 'chan', bot, c: 'organic' }
        : ch === 'سایر payload' ? { k: 'chan', bot, c: 'other' } : { k: 'chan', bot, c: 'unknown' };
      return [
        camp ? `کمپین: ${esc(camp.name || camp.code)}` : esc(ch),
        cohortCount(m.users, cohort),
        camp ? cohortCount(m.payers, { k: 'camp', bot, code: camp.code, m: 'payers' }) : fmt(m.payers),
        moneyText(bot, m.revenue),
      ];
    }))}</div>` : '';

  /* ── عملکردِ کمپین‌ها + سود --- */
  const campRows = campaigns.map((c) => {
    const s = campaignStats(c);
    const adUsd = campUsd * s.newUsers;
    const profit = s.revenue - (rate ? Math.round(adUsd * rate) : 0);
    return [
      `<b>${esc(c.name || c.code)}</b><div class="muted mono">c_${esc(c.code)}</div>`,
      fmt(s.starts),
      cohortCount(s.newUsers, { k: 'camp', bot, code: c.code, m: 'new' }),
      cohortCount(s.paywall, { k: 'camp', bot, code: c.code, m: 'pw' }),
      cohortCount(s.payers, { k: 'camp', bot, code: c.code, m: 'payers' }),
      moneyText(bot, s.revenue),
      campUsd ? `${usd(adUsd)}${toman(adUsd)}` : '<span class="muted">-</span>',
      campUsd && rate ? `<b class="${profit >= 0 ? '' : 'drop'}">${moneyText(bot, profit)}</b>` : '<span class="muted">-</span>',
    ];
  });
  const campCard = campaigns.length ? `<div class="card">
    ${cardHead('📣 عملکردِ کمپین‌ها')}
    ${table(['کمپین', 'استارت', 'کاربر جدید', 'پی‌وال دید', 'خریدار', 'درآمد', 'هزینه‌ی تبلیغ', 'سود'], campRows)}
    <p class="muted">«سود» = درآمد − هزینه‌ی تبلیغِ همان کمپین (هزینه‌ی مدل جداست و در «اقتصاد» می‌آید).
      ساختِ کمپینِ جدید در «اقدام‌ها ← کمپین‌ساز» است.</p></div>` : '';

  /* ── دعوت از دوستان (کانالِ جذبِ ارگانیک) ── */
  const ref = { referrers: 0, ok: 0, max: 0 };
  for (const inst of instancesOf(bot)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'referrals')) return;
      const q = successfulReferrersSql();
      ref.referrers += scalar(db, `SELECT COUNT(*) c FROM (${q.sql})`, q.params);
      ref.ok += scalar(db, 'SELECT COUNT(*) c FROM referrals WHERE rewarded=1');
      ref.max = Math.max(ref.max, scalar(db,
        'SELECT COALESCE(MAX(c),0) m FROM (SELECT COUNT(*) c FROM referrals WHERE rewarded=1 GROUP BY referrer_id)'));
    });
  }
  const refCard = `<div class="card">
    ${cardHead('🤝 دعوت از دوستان')}
    <div class="grid">
      ${stat('کاربران دعوت‌کننده‌ی موفق', cohortCount(ref.referrers, { k: 'tarot', bot, t: 'referrer' }))}
      ${stat('کل دعوت‌های موفق', fmt(ref.ok))}
      ${stat('بیشترین دعوت توسط یک کاربر', fmt(ref.max))}
      ${stat('میانگین دعوت per دعوت‌کننده', fmt(ref.referrers ? Math.round((ref.ok / ref.referrers) * 100) / 100 : 0))}
    </div>
    <p class="muted">«دعوتِ موفق» = دعوت‌شده وارد شد، فالِ کامل گرفت و پاداشِ دعوت‌کننده پرداخت شد
      (همان بیتی که خودِ ربات می‌زند؛ هیچ تعریفِ دومی ساخته نشده). هزینه‌ی این پاداش در جدولِ CPA بالا آمده.</p></div>`;

  return `<div class="card"><h2 style="margin:0">📥 جذب و کانال‌ها — ${esc(title)}</h2>
      <p class="muted" style="margin:6px 0 0">از کجا می‌آیند، چقدر هزینه دارند، و کدام کانال به پول می‌رسد.</p></div>
    ${cpaCard}${cpdCard}${chCard}${refCard}${campCard}${postsCards(campaigns, bot)}`;
}

/** ورودی‌های دستیِ هزینه (نرخِ دلار + هزینه‌ی تبلیغ per کاربر). */
export function acquisitionSettings(body) {
  const rate = Math.max(0, parseInt(body.get('rate') || '0', 10) || 0);
  const pre  = Math.max(0, Number(body.get('pre')) || 0);
  if (rate > 100_000_000 || pre > 1_000_000) throw new Error('مقدار نامعتبر است');
  setSetting(USD_RATE_KEY, String(rate));
  setSetting(PRE_TRACK_COST_KEY, String(pre));
  /* ⚠️ `cpa_campaign_usd` عمداً این‌جا **نوشته نمی‌شود**.
     از ۱۴۰۵/۰۶/۱۶ هزینه‌ی تبلیغ per روز ثبت می‌شود (`/economics/cpa-day`) و این کلید
     فقط یک فالبکِ **منجمد** است برای وقتی هنوز هیچ روزی وارد نشده. اگر این‌جا
     می‌ماند، فرمِ ورودی‌ها دیگر فیلدِ `camp` ندارد، پس `Number(undefined) || 0`
     صفر می‌شد و اولین «ذخیره» فالبک را بی‌صدا صفر می‌کرد — یعنی هزینه‌ی تبلیغ برای
     همه‌ی روزها ناپدید و سود یک‌باره خوش‌بینانه. حذفِ نوشتن، خودِ گارد است. */
  audit('acquisition.costs', '', `rate=${rate} pre=${pre}`);
  return 'ورودی‌های هزینه ذخیره شد';
}
