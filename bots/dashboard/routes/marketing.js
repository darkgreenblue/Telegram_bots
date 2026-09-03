// مارکتینگ: ساخت لینک کمپین (t.me/<bot>?start=c_<code>) + قیفِ تا-درآمد هر کمپین + مقایسه‌ی چنل‌ها
//           + اتریبیوشن در سطحِ پستِ کانال (payload لینکِ پست: c_<code>_<postref>)
import { BOTS, botByKey, instancesOf, withDb, hasTable, scalar, rows, userPk, moneyOf, toToman,
  baseKey, langOfKey, scopedKey, langsOf } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { listCampaigns, createCampaign, getCampaign, setCampaignActive, getSetting, setSetting, audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, postRefLabel } from '../lib/util.js';
import { table, cohortCount } from '../lib/html.js';

const usernameKey = (botKey) => `username:${botKey}`;

/* 🌍 «اسکوپِ کمپین» = واحدی که یک لینکِ کمپین به آن تعلق دارد.
 *
 * ⚠️ چرا این با `BOTS` یکی نیست: هر زبانِ تاروت یک **رباتِ جدا با @username جدا** است،
 * ولی در `BOTS` همه‌شان زیرِ یک ردیفِ تجمیعی (`tarot-intl`) نشسته‌اند، چون آن ردیف برای
 * **تحلیل** ساخته شده نه برای **لینک**. تا امروز نتیجه‌اش دو خرابیِ بی‌صدا بود:
 *   ۱) ساختِ کمپین برای یک زبانِ مشخص با «ربات نامعتبر» رد می‌شد (اعتبارسنجی کلیدِ خام
 *      را با `BOTS` می‌سنجید و `tarot-intl@ru` در آن نیست).
 *   ۲) فرمِ یوزرنیم یک فیلد برای هر سه زبان می‌داد، پس لینکِ کمپینِ اسپانیایی به
 *      رباتِ روسی اشاره می‌کرد. عددِ اتریبیوشن درست جمع می‌شد ولی **کاربر به رباتِ
 *      اشتباه می‌رفت** — از همان خانواده‌ی «عددِ درست، واحدِ دروغ» (بند ۶ج ریشه).
 *
 * پس اسکوپ‌ها = کلیدِ پایه برای ربات‌های تک‌زبانه، و یک کلیدِ زبان‌دار per زبان برای
 * ربات‌های چندزبانه. کلیدِ تجمیعی هم می‌ماند، چون دیدنِ مجموع همچنان مفید است. */
export function campaignScopes() {
  const out = [];
  for (const b of BOTS) {
    const langs = langsOf(b.key);
    out.push({ key: b.key, title: b.title, aggregate: langs.length > 1 });
    for (const l of langs.length > 1 ? langs : []) {
      out.push({ key: scopedKey(b.key, l), title: `${b.title} — ${l}`, aggregate: false });
    }
  }
  return out;
}
/** اسکوپی که می‌شود رویش کمپین ساخت: کلیدِ پایه، یا کلیدِ پایه + زبانِ واقعاً موجود. */
export const validScope = (raw) => {
  const k = String(raw || '');
  if (!/^[a-z0-9-]+(@[a-z0-9-]+)?$/.test(k)) return '';
  if (!botByKey(k)) return '';
  const lang = langOfKey(k);
  if (lang && !langsOf(k).includes(lang)) return '';
  return k;
};

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

/* ═══ اتریبیوشن در سطحِ پستِ کانال ═══
   قرارداد payload (shared/analytics.js): `c_<code>_<postref>` — همان کمپینِ کانال، به‌علاوه‌ی
   شناسه‌ی پستی که کاربر از آن آمده (شبیهِ utm_content). postref = `<YYMMDD>s<slot>`.
   رویدادِ start این را به‌صورت prop `post` دارد و `users.first_payload` کلِ payload خام را نگه می‌دارد.

   قاعده‌ی اجراییِ این بخش: تعدادِ پست‌ها هر روز زیاد می‌شود (کانالِ daily5 روزی ۵ تا)، پس
   الگوی N+1ِ جدولِ کمپین‌ها (یک کوئری per ردیف) این‌جا مجاز نیست — همه‌ی اعداد با چند
   کوئریِ **گروهی** per instance ساخته می‌شوند که تعدادشان ثابت است، نه به تعدادِ پست‌ها. */
const POST_ROWS = 50;      // سقفِ نمایش در جدول
const POST_SCAN_LIMIT = 500; // سقفِ گروه‌های خوانده‌شده per instance (گاردِ حافظه، نه فیلترِ تحلیلی)
// فقط payloadهای شکلِ c_<code>_<post>؛ در GLOB نویسه‌ی `_` معنای ویژه ندارد پس عیناً match می‌شود
const POST_PAYLOAD_GLOB = 'c_*_*';
const POST_PAYLOAD_RE = /^c_([A-Za-z0-9]{1,32})_([A-Za-z0-9]{1,24})$/; // عیناً همان الگوی parseStartPayload

// آمار per پست: جمع روی همه‌ی instance های همان ربات (tarot چند locale دارد)
export function postStats(botKey) {
  const merged = new Map(); // payload کامل -> ردیف
  const pk = userPk(botKey);
  const m = moneyOf(botKey);
  const testClause = m.testFilter ? ` AND p.${m.testFilter}` : '';
  let hasPayments = false;

  const row = (payload, code, post) => {
    let e = merged.get(payload);
    if (!e) {
      e = { payload, code, post, starts: 0, returning: 0, newUsers: 0, firstValue: 0, paywall: 0, payers: 0, revenue: 0 };
      merged.set(payload, e);
    }
    return e;
  };
  // ردیفِ متناظرِ یک first_payload خام (کاربرانی که با لینکِ پست وارد شده‌اند)
  const rowOfPayload = (pl) => {
    const mm = POST_PAYLOAD_RE.exec(String(pl || ''));
    return mm ? row(pl, mm[1], mm[2]) : null;
  };

  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (hasTable(db, 'events')) {
        // (۱) استارت‌ها: یک کوئریِ گروهی روی رویدادهای start که prop `post` غیرخالی دارند.
        // گروه‌بندی با code هم انجام می‌شود چون دو کانالِ مختلف می‌توانند در یک روز اسلاتِ
        // هم‌شماره داشته باشند و postref به‌تنهایی یکتا نیست.
        // نکته: alias نباید `returning` باشد (کلیدواژه‌ی RETURNING در SQLite = خطای سینتکس)
        for (const r of rows(db, `SELECT json_extract(props,'$.code') code, json_extract(props,'$.post') post,
              COUNT(*) starts, SUM(CASE WHEN json_extract(props,'$.new') = 0 THEN 1 ELSE 0 END) ret
            FROM events
            WHERE event='start' AND COALESCE(json_extract(props,'$.post'),'') <> ''
            GROUP BY code, post ORDER BY starts DESC LIMIT ${POST_SCAN_LIMIT}`)) {
          const e = row(`c_${r.code}_${r.post}`, String(r.code ?? ''), String(r.post ?? ''));
          e.starts += r.starts;
          e.returning += r.ret;
        }
        // (۳) قیفِ ادامه: کاربرِ first-touchِ همان پست که به اولین ارزش رسیده یا پی‌وال دیده
        for (const r of rows(db, `SELECT u.first_payload pl, e.event ev, COUNT(DISTINCT e.user_id) c
            FROM events e JOIN users u ON u.${pk} = e.user_id
            WHERE u.first_payload GLOB ? AND e.event IN ('first_value','paywall_shown')
            GROUP BY pl, ev LIMIT ${POST_SCAN_LIMIT}`, [POST_PAYLOAD_GLOB])) {
          const e = rowOfPayload(r.pl);
          if (!e) continue;
          if (r.ev === 'first_value') e.firstValue += r.c; else e.paywall += r.c;
        }
      }
      // (۲) کاربرِ جدید: first-touch با همان لینکِ پست (write-once روی users)
      for (const r of rows(db, `SELECT first_payload pl, COUNT(*) c FROM users
          WHERE first_payload GLOB ? GROUP BY pl LIMIT ${POST_SCAN_LIMIT}`, [POST_PAYLOAD_GLOB])) {
        const e = rowOfPayload(r.pl);
        if (e) e.newUsers += r.c;
      }
      // (۴) خریدار و درآمد — همان شکلِ کوئریِ campaignStats، فقط گروهی
      if (hasTable(db, m.table)) {
        hasPayments = true;
        for (const r of rows(db, `SELECT u.first_payload pl, COUNT(DISTINCT p.user_id) payers,
              COALESCE(SUM(p.${m.amountCol}),0) rev
            FROM ${m.table} p JOIN users u ON u.${pk} = p.user_id
            WHERE u.first_payload GLOB ? AND p.status='${m.successStatus}'${testClause}
            GROUP BY pl LIMIT ${POST_SCAN_LIMIT}`, [POST_PAYLOAD_GLOB])) {
          const e = rowOfPayload(r.pl);
          if (!e) continue;
          e.payers += r.payers;
          e.revenue += toToman(botKey, r.rev);
        }
      }
    });
  }
  const list = [...merged.values()].sort((a, b) => b.starts - a.starts || b.newUsers - a.newUsers);
  return { list, hasPayments };
}

// کارتِ «پست‌های کانال» — تا وقتی هیچ لینکِ سطحِ پستی استفاده نشده، هیچ‌چیزی رندر نمی‌شود
function postsCards(campaigns, only) {
  let out = '';
  for (const b of BOTS.filter(x => x.key === only)) {
    const { list, hasPayments } = postStats(b.key);
    if (!list.length) continue;
    const shown = list.slice(0, POST_ROWS);
    const rowsHtml = shown.map(p => {
      const camp = campaigns.find(c => c.code === p.code);
      return [
        `<b>${esc(postRefLabel(p.post))}</b><div class="muted mono">${esc(p.post)}</div>`,
        camp ? esc(camp.name || camp.code) : `<span class="mono">c_${esc(p.code)}</span>`,
        // «استارت کل» و «کلیک برگشتی» شمارشِ رویدادند (نه کاربر یکتا) → عدد ساده می‌مانند
        fmt(p.starts),
        cohortCount(p.newUsers, { k: 'post', bot: b.key, pl: p.payload, m: 'new' }),
        fmt(p.returning),
        cohortCount(p.firstValue, { k: 'post', bot: b.key, pl: p.payload, m: 'fv' }),
        cohortCount(p.paywall, { k: 'post', bot: b.key, pl: p.payload, m: 'pw' }),
        hasPayments
          ? `${cohortCount(p.payers, { k: 'post', bot: b.key, pl: p.payload, m: 'payers' })} / ${fmt(p.revenue)} ت`
          : '-',
      ];
    });
    out += `<div class="card"><h2>🗞 پست‌های کانال — ${esc(b.title)}</h2>
    ${table(['پست', 'کمپین', 'استارت کل', 'کاربر جدید', 'کلیک برگشتی', 'به اولین ارزش رسید', 'پی‌وال دید', 'خریدار / درآمد'], rowsHtml)}
    <p class="muted">لینکِ سطحِ پست: <span class="mono">t.me/&lt;bot&gt;?start=c_&lt;code&gt;_&lt;postref&gt;</span> — کمپین همان کمپینِ کانال می‌ماند و فقط پستِ منبع جدا شمرده می‌شود.
    ${list.length > POST_ROWS ? `فقط ${fmt(POST_ROWS)} پستِ پرترافیک نشان داده شده (از ${fmt(list.length)} پست).` : ''}</p></div>`;
  }
  return out;
}

export function marketingBody(url) {
  // مارکتینگ per ربات: کمپین‌ها، پست‌ها و چنل‌های ورودیِ همان رباتِ انتخاب‌شده
  const bot = scopeBot(url);
  const botTitle = botByKey(bot)?.title || bot;
  /* اسکوپِ زبان‌دار فقط خودش را می‌بیند؛ اسکوپِ پایه خودش **و** زبان‌هایش را، وگرنه
   * کمپینی که برای یک زبان ساخته شده از نمای تجمیعی ناپدید می‌شود. */
  const inScope = (cb) => (langOfKey(bot) ? cb === bot : baseKey(cb) === bot);
  const campaigns = listCampaigns().filter(c => inScope(c.bot));

  /* گزینه‌های سلکت = خودِ اسکوپِ فعلی و (اگر تجمیعی است) هر زبانش، تا بدونِ عوض‌کردنِ
   * اسکوپِ داشبورد بشود کمپینِ یک زبانِ مشخص ساخت. */
  const scopeOpts = campaignScopes().filter(sc => baseKey(sc.key) === baseKey(bot)
    && (!langOfKey(bot) || sc.key === bot));
  const botOptions = (scopeOpts.length ? scopeOpts : [{ key: bot, title: botTitle }])
    .map(sc => `<option value="${esc(sc.key)}"${sc.key === bot ? ' selected' : ''}>${esc(sc.title)}</option>`).join('');
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
    ${campaignScopes().filter(sc => !sc.aggregate).map(sc => `<label>${esc(sc.title)}<input name="u_${esc(sc.key)}" dir="ltr" placeholder="بدون @" value="${esc(getSetting(usernameKey(sc.key)))}"></label>`).join('')}
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
      // «استارت کل» و «کلیک برگشتی» شمارشِ رویدادند (نه کاربر یکتا) → عدد ساده می‌مانند؛
      // بقیه کاربرمحورند و با کلیک لیستشان باز می‌شود.
      fmt(s.starts),
      cohortCount(s.newUsers, { k: 'camp', bot: c.bot, code: c.code, m: 'new' }),
      fmt(s.returning),
      cohortCount(s.firstValue, { k: 'camp', bot: c.bot, code: c.code, m: 'fv' }),
      cohortCount(s.paywall, { k: 'camp', bot: c.bot, code: c.code, m: 'pw' }),
      s.hasPayments
        ? `${cohortCount(s.payers, { k: 'camp', bot: c.bot, code: c.code, m: 'payers' })} / ${fmt(s.revenue)} ت`
        : '-',
      tehranDateTime(c.created_at),
      `<form method="post" action="/marketing/toggle" style="display:inline"><input type="hidden" name="id" value="${c.id}">
        <button class="ghost" type="submit">${c.is_active ? 'غیرفعال کن' : 'فعال کن'}</button></form>${c.is_active ? '' : ' <span class="badge bad">غیرفعال</span>'}`,
    ];
  });

  const campaignsCard = `<div class="card"><h2>📣 کمپین‌ها</h2>
  ${table(['کمپین', 'ربات', 'لینک', 'استارت کل', 'کاربر جدید', 'کلیک برگشتی', 'به اولین ارزش رسید', 'پی‌وال دید', 'خریدار / درآمد', 'ساخت', ''], rowsHtml, 'هنوز کمپینی نساخته‌ای.')}
  <p class="muted">«کاربر جدید» = first-touch با همین کمپین. «کلیک برگشتی» = /start کاربرِ ازقبل‌موجود با این لینک (کمپین‌های re-engagement این‌جا دیده می‌شوند).</p></div>`;

  let channels = '';
  for (const b of BOTS.filter(x => x.key === bot)) {
    const list = channelSummary(b.key);
    if (!list.length) continue;
    channels += `<div class="card"><h2>🛣 چنل‌های ورودی — ${esc(b.title)}</h2>
    ${table(['چنل', 'کاربر', 'خریدار', 'درآمد'], list.map(([ch, m]) => {
      const camp = ch.startsWith('campaign:') && listCampaigns().find(c => `campaign:${c.code}` === ch);
      // نگاشتِ برچسبِ چنل به کلیدِ whitelistِ کوهورت (هیچ شرطی از متن ساخته نمی‌شود)
      const cohort = ch.startsWith('campaign:')
        ? { k: 'chan', bot: b.key, c: 'campaign', val: ch }
        : ch === 'رفرال' ? { k: 'chan', bot: b.key, c: 'referral' }
        : ch === 'ارگانیک' ? { k: 'chan', bot: b.key, c: 'organic' }
        : ch === 'سایر payload' ? { k: 'chan', bot: b.key, c: 'other' }
        : { k: 'chan', bot: b.key, c: 'unknown' };
      return [
        camp ? `کمپین: ${esc(camp.name || camp.code)}` : esc(ch),
        cohortCount(m.users, cohort),
        camp ? cohortCount(m.payers, { k: 'camp', bot: b.key, code: camp.code, m: 'payers' }) : fmt(m.payers),
        fmt(m.revenue) + ' ت',
      ];
    }))}</div>`;
  }

  return createForm + campaignsCard + postsCards(campaigns, bot) + channels + unameForm;
}

export function marketingCreate(body) {
  const bot = validScope(body.get('bot'));
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
  for (const sc of campaignScopes()) {
    if (sc.aggregate) continue;   // ردیفِ تجمیعی ربات نیست، پس @username ندارد
    const raw = body.get(`u_${sc.key}`);
    if (raw == null) continue;    // فیلدی که در فرم نبود نباید مقدارِ ذخیره‌شده را پاک کند
    const v = raw.trim().replace(/^@/, '').slice(0, 64);
    if (/^[A-Za-z0-9_]*$/.test(v)) setSetting(usernameKey(sc.key), v);
  }
  audit('settings.usernames', '', '');
  return 'یوزرنیم‌ها ذخیره شد';
}
