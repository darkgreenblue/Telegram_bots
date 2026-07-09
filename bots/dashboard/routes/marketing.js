// مارکتینگ: ساخت لینک کمپین (t.me/<bot>?start=c_<code>) + قیفِ تا-درآمد هر کمپین + مقایسه‌ی چنل‌ها
import { BOTS, instancesOf, withDb, hasTable, scalar, rows, userPk, moneyOf, toToman } from '../lib/bots.js';
import { listCampaigns, createCampaign, getCampaign, setCampaignActive, getSetting, setSetting, audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime } from '../lib/util.js';
import { table } from '../lib/html.js';

const usernameKey = (botKey) => `username:${botKey}`;

// آمار یک کمپین: جمع روی همه‌ی instance های همان ربات (tarot چند locale دارد)
export function campaignStats(c) {
  const src = `campaign:${c.code}`;
  const agg = { starts: 0, returning: 0, newUsers: 0, firstValue: 0, paywall: 0, payers: 0, revenue: 0, hasPayments: false };
  const pk = userPk(c.bot);
  const m = moneyOf(c.bot);
  const testClause = m.testFilter ? ` AND p.${m.testFilter}` : '';
  for (const inst of instancesOf(c.bot)) {
    withDb(inst.file, (db) => {
      if (hasTable(db, 'events')) {
        agg.starts += scalar(db, "SELECT COUNT(*) c FROM events WHERE event='start' AND json_extract(props,'$.kind')='campaign' AND json_extract(props,'$.code')=?", [c.code]);
        agg.returning += scalar(db, "SELECT COUNT(*) c FROM events WHERE event='start' AND json_extract(props,'$.code')=? AND json_extract(props,'$.new')=0", [c.code]);
        agg.firstValue += scalar(db, `SELECT COUNT(DISTINCT e.user_id) c FROM events e JOIN users u ON u.${pk}=e.user_id WHERE u.first_source=? AND e.event='first_value'`, [src]);
        agg.paywall += scalar(db, `SELECT COUNT(DISTINCT e.user_id) c FROM events e JOIN users u ON u.${pk}=e.user_id WHERE u.first_source=? AND e.event='paywall_shown'`, [src]);
      }
      agg.newUsers += scalar(db, 'SELECT COUNT(*) c FROM users WHERE first_source=?', [src]);
      if (hasTable(db, m.table)) {
        agg.hasPayments = true;
        agg.payers += scalar(db, `SELECT COUNT(DISTINCT p.user_id) c FROM ${m.table} p JOIN users u ON u.${pk}=p.user_id WHERE u.first_source=? AND p.status='${m.successStatus}'${testClause}`, [src]);
        agg.revenue += toToman(c.bot, scalar(db, `SELECT COALESCE(SUM(p.${m.amountCol}),0) s FROM ${m.table} p JOIN users u ON u.${pk}=p.user_id WHERE u.first_source=? AND p.status='${m.successStatus}'${testClause}`, [src]));
      }
    });
  }
  return agg;
}

// مقایسه‌ی چنل‌ها (کمپین/رفرال/ارگانیک) per ربات از روی first_source کاربران
const CH_EXPR = `CASE
  WHEN first_source LIKE 'campaign:%' THEN first_source
  WHEN first_source LIKE 'referral:%' THEN 'رفرال'
  WHEN first_source LIKE 'other:%' THEN 'سایر payload'
  WHEN first_source = 'organic' THEN 'ارگانیک'
  ELSE 'نامشخص (قبل از اتریبیوشن)' END`;

function channelSummary(botKey) {
  const merged = new Map(); // ch -> {users, payers, revenue}
  const pk = userPk(botKey);
  const mn = moneyOf(botKey);
  const testClause = mn.testFilter ? ` AND p.${mn.testFilter}` : '';
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      for (const r of rows(db, `SELECT ${CH_EXPR} ch, COUNT(*) c FROM users GROUP BY ch`)) {
        const m = merged.get(r.ch) || { users: 0, payers: 0, revenue: 0 };
        m.users += r.c; merged.set(r.ch, m);
      }
      if (hasTable(db, mn.table)) {
        for (const r of rows(db, `SELECT ${CH_EXPR} ch, COUNT(DISTINCT p.user_id) payers, COALESCE(SUM(p.${mn.amountCol}),0) rev
            FROM ${mn.table} p JOIN users u ON u.${pk}=p.user_id WHERE p.status='${mn.successStatus}'${testClause} GROUP BY ch`)) {
          const m = merged.get(r.ch) || { users: 0, payers: 0, revenue: 0 };
          m.payers += r.payers; m.revenue += toToman(botKey, r.rev); merged.set(r.ch, m);
        }
      }
    });
  }
  return [...merged.entries()].sort((a, b) => b[1].users - a[1].users);
}

export function marketingBody() {
  const campaigns = listCampaigns();

  const botOptions = BOTS.map(b => `<option value="${b.key}">${esc(b.title)}</option>`).join('');
  const createForm = `<div class="card"><h2>➕ لینک کمپین جدید</h2>
  <form method="post" action="/marketing/create" class="inline">
    <label>ربات<select name="bot">${botOptions}</select></label>
    <label>سورس (کجا؟)<input name="source" placeholder="مثلاً کانال فلان" required></label>
    <label>مدیوم (چه نوع؟)<select name="medium">
      <option value="paid">تبلیغ پولی</option><option value="social">شبکه اجتماعی</option>
      <option value="content">محتوا/بلاگ</option><option value="cross">تبادل/کراس</option>
      <option value="offline">آفلاین/QR</option><option value="other">سایر</option>
    </select></label>
    <label>نام کمپین<input name="name" placeholder="مثلاً لانچ مهر"></label>
    <label>یادداشت<input name="notes" placeholder="اختیاری"></label>
    <button type="submit">بساز</button>
  </form>
  <p class="muted">لینک ساخته‌شده را عیناً به همان چنل بده؛ هر ورودی با آن، برای همیشه به همین کمپین گره می‌خورد (first-touch). هر لینک فقط یک payload دارد.</p></div>`;

  const unameForm = `<div class="card"><h2>⚙️ یوزرنیم ربات‌ها (برای ساخت لینک)</h2>
  <form method="post" action="/marketing/usernames" class="inline">
    ${BOTS.map(b => `<label>${esc(b.title)}<input name="u_${b.key}" dir="ltr" placeholder="بدون @" value="${esc(getSetting(usernameKey(b.key)))}"></label>`).join('')}
    <button type="submit">ذخیره</button>
  </form></div>`;

  const rowsHtml = campaigns.map(c => {
    const uname = getSetting(usernameKey(c.bot));
    const link = uname ? `https://t.me/${uname}?start=c_${c.code}` : '';
    const s = campaignStats(c);
    return [
      `<b>${esc(c.name || c.code)}</b><div class="muted">${esc(c.source)} · ${esc(c.medium)}</div>`,
      `${esc(c.bot)}`,
      link
        ? `<span class="mono">${esc(link)}</span> <button type="button" class="ghost copy" data-copy="${esc(link)}">کپی</button>`
        : `<span class="badge warn">یوزرنیم ربات را بالا ست کن</span> <span class="mono">c_${esc(c.code)}</span>`,
      fmt(s.starts), fmt(s.newUsers), fmt(s.returning), fmt(s.firstValue), fmt(s.paywall),
      s.hasPayments ? `${fmt(s.payers)} / ${fmt(s.revenue)} ت` : '-',
      tehranDateTime(c.created_at),
      `<form method="post" action="/marketing/toggle" style="display:inline"><input type="hidden" name="id" value="${c.id}">
        <button class="ghost" type="submit">${c.is_active ? 'غیرفعال کن' : 'فعال کن'}</button></form>${c.is_active ? '' : ' <span class="badge bad">غیرفعال</span>'}`,
    ];
  });

  const campaignsCard = `<div class="card"><h2>📣 کمپین‌ها</h2>
  ${table(['کمپین', 'ربات', 'لینک', 'استارت کل', 'کاربر جدید', 'کلیک برگشتی', 'به اولین ارزش رسید', 'پی‌وال دید', 'خریدار / درآمد', 'ساخت', ''], rowsHtml, 'هنوز کمپینی نساخته‌ای.')}
  <p class="muted">«کاربر جدید» = first-touch با همین کمپین. «کلیک برگشتی» = /start کاربرِ ازقبل‌موجود با این لینک (کمپین‌های re-engagement این‌جا دیده می‌شوند).</p></div>`;

  let channels = '';
  for (const b of BOTS) {
    const list = channelSummary(b.key);
    if (!list.length) continue;
    channels += `<div class="card"><h2>🛣 چنل‌های ورودی — ${esc(b.title)}</h2>
    ${table(['چنل', 'کاربر', 'خریدار', 'درآمد'], list.map(([ch, m]) => {
      const camp = ch.startsWith('campaign:') && listCampaigns().find(c => `campaign:${c.code}` === ch);
      return [camp ? `کمپین: ${esc(camp.name || camp.code)}` : esc(ch), fmt(m.users), fmt(m.payers), fmt(m.revenue) + ' ت'];
    }))}</div>`;
  }

  return createForm + campaignsCard + channels + unameForm;
}

export function marketingCreate(body) {
  const bot = BOTS.find(b => b.key === body.get('bot'))?.key;
  if (!bot) throw new Error('ربات نامعتبر');
  const c = createCampaign({
    bot,
    source: body.get('source')?.slice(0, 100),
    medium: body.get('medium')?.slice(0, 30),
    name: body.get('name')?.slice(0, 100),
    notes: body.get('notes')?.slice(0, 500),
  });
  audit('campaign.create', `${bot}/c_${c.code}`, `${c.source} · ${c.medium} · ${c.name}`);
  return `کمپین ساخته شد: c_${c.code}`;
}

export function marketingToggle(body) {
  const c = getCampaign(parseInt(body.get('id'), 10));
  if (!c) throw new Error('کمپین پیدا نشد');
  setCampaignActive(c.id, !c.is_active);
  audit('campaign.toggle', `c_${c.code}`, c.is_active ? 'deactivate' : 'activate');
  return `کمپین ${c.code} ${c.is_active ? 'غیرفعال' : 'فعال'} شد`;
}

export function marketingUsernames(body) {
  for (const b of BOTS) {
    const v = (body.get(`u_${b.key}`) || '').trim().replace(/^@/, '').slice(0, 64);
    if (/^[A-Za-z0-9_]*$/.test(v)) setSetting(usernameKey(b.key), v);
  }
  audit('settings.usernames', '', '');
  return 'یوزرنیم‌ها ذخیره شد';
}
