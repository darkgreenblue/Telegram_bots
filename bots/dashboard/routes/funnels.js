// فانل‌ها و نقاط دراپ — دو منبع مکمل:
// ۱) فانل رویدادی (events): کاربر یکتا per مرحله + breakdown چنل (ارگانیک/رفرال/کمپین).
//    فقط از زمان نصب آنالیتیکس دیتا دارد — برای voice2text یعنی رفتار کاربران قدیمی را نشان نمی‌دهد.
// ۲) توزیع وضعیت رکوردهای قطعی per-entity (readings/voice_flows/payments.step): بدون بایاس snapshot،
//    شامل کاربران قبل از آنالیتیکس. (هیچ عددی از users.state ساخته نمی‌شود — state فقط «الان» را می‌گوید.)
import { instancesOf, withDb, hasTable, scalar, rows, userPk, moneyOf, unixOf, botByKey } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, nowSec } from '../lib/util.js';
import { table, cohortCount } from '../lib/html.js';
// تعریفِ قیف‌ها/چنل‌ها یک‌جا در lib است تا عددِ جدول و لیستِ کاربرانِ پشتِ آن از یک منبع بیایند
import { FUNNELS, CHANNELS, verCond } from '../lib/funnels-def.js';
import { cohortQuery } from '../lib/cohorts.js';
// کارتِ «کجا ریختند؟» (نقاط خروج) — از همان رویدادهای ریزِ shared/journey.js تغذیه می‌شود
import { exitCard } from './journey.js';

export { FUNNELS }; // سازگاری: overview.js واژه‌نامه‌ی رویدادها را از همین‌جا می‌خواند

// همه‌ی نسخه‌هایی که کاربری با آن‌ها وارد شده (برای انتخابگر کوهورت)
function allVersions(botKey) {
  const set = new Set();
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'users')) return;
      for (const r of rows(db, "SELECT DISTINCT first_version v FROM users WHERE first_version != ''")) set.add(r.v);
    });
  }
  return [...set].sort();
}

function stepCounts(botKey, event, since, ver) {
  const out = CHANNELS.map(() => 0);
  const pk = userPk(botKey);
  const v = verCond(ver);
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events')) return;
      CHANNELS.forEach(([, cond], i) => {
        out[i] += scalar(db, `SELECT COUNT(DISTINCT e.user_id) c FROM events e
          JOIN users u ON u.${pk} = e.user_id
          WHERE e.event = ? AND e.created_at >= ? AND ${cond} AND ${v.cond}`, [event, since, ...v.params]);
      });
    });
  }
  return out;
}

// وضعیت رکوردهای قطعی. برخی جدول‌ها ستون status ندارند (dreams: full_delivered) —
// statusExpr سفارشی از FUNNELS.entity گرفته می‌شود؛ created_at هم بسته به فرمت نرمال می‌شود.
function entityStatuses(botKey, entity, since) {
  const merged = new Map();
  // alias t: statusExpr در lib/funnels-def.js با پیشوند t. نوشته شده تا در کوئریِ کوهورت (join با users)
  // هم بدون ابهام باشد؛ همان عبارت این‌جا هم استفاده می‌شود تا عدد و لیست دقیقاً یکی بمانند.
  const statusExpr = entity.statusExpr || 't.status';
  const catExpr = unixOf(botKey === 'tabir-khab' ? 'iso' : 'unix', 't.created_at');
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, entity.table)) return;
      for (const r of rows(db, `SELECT ${statusExpr} status, COUNT(*) c FROM ${entity.table} t WHERE ${catExpr} >= ? GROUP BY ${statusExpr}`, [since])) {
        merged.set(r.status, (merged.get(r.status) || 0) + r.c);
      }
    });
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}

function paymentSteps(botKey, since) {
  // نقطه‌ی رها کردن فلوی شارژ: step روی پرداخت‌های ناتمام (فقط ربات‌های کیف‌پولی step دارند)
  const merged = new Map();
  const m = moneyOf(botKey);
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, m.table)) return;
      const cols = db.prepare(`PRAGMA table_info(${m.table})`).all().map(c => c.name);
      if (!cols.includes('step')) return; // tabir transactions مرحله ندارد
      const catExpr = unixOf(m.createdKind, 'created_at');
      for (const r of rows(db, `SELECT COALESCE(step,'-') step, COUNT(*) c FROM ${m.table}
          WHERE ${catExpr} >= ? AND status IN ('pending','canceled','cancelled') GROUP BY step`, [since])) {
        merged.set(r.step, (merged.get(r.step) || 0) + r.c);
      }
    });
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}

/* جدولِ قیف — هر مرحله علاوه بر عددها، یک ردیفِ بازشو دارد که «قدم‌های ریزِ» همان مرحله را
   (پیام‌ها و دکمه‌هایی که کاربر بینِ این مرحله و مرحله‌ی بعد دید/زد) از سرور می‌گیرد.
   drill=false برای قیف‌هایی که مراحلشان موازی‌اند (سرگرمی‌های رایگان) و «بین دو مرحله» معنا ندارد. */
function funnelTable(botKey, steps, since, ver, { drill = true } = {}) {
  const data = steps.map(([ev, label]) => [label, stepCounts(botKey, ev, since, ver), ev]);
  const base = data[0]?.[1] || CHANNELS.map(() => 0);
  const cols = CHANNELS.length + 1;
  if (!data.length) return `<p class="muted">رویدادی ثبت نشده.</p>`;

  const rowsHtml = data.map(([label, counts, ev], idx) => {
    const prev = idx > 0 ? data[idx - 1][1] : null;
    const cells = [
      esc(label),
      // هر عدد = کاربرانِ همان مرحله در همان چنل → با کلیک، لیستشان همان‌جا باز می‌شود
      ...counts.map((c, i) => {
        const pctBase = base[i] ? Math.round(c / base[i] * 100) : 0;
        const drop = prev && prev[i] > 0 ? ` <span class="muted">(−${fmt(prev[i] - c)})</span>` : '';
        const meta = `<span class="muted">${idx ? pctBase + '٪' : ''}</span>${idx ? drop : ''}`;
        return cohortCount(c, { k: 'funnel', bot: botKey, ev, ch: String(i), since: String(since), ver }, { suffix: ` ${meta}` });
      }),
    ];
    let html = `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    if (drill) {
      const next = data[idx + 1]?.[2] || '';
      const q = cohortQuery({ bot: botKey, ev, next, since: String(since), ch: '0', ver });
      const to = next ? `«${data[idx + 1][0]}»` : 'پایانِ مسیر';
      html += `<tr><td colspan="${cols}" style="padding-top:0">
        <details class="drill" data-frag="/funnel.steps.fragment" data-q="${esc(q)}">
          <summary><span class="chev">◀</span> <span class="muted">قدم‌های ریزِ بینِ «${esc(label)}» و ${esc(to)}</span></summary>
          <div class="drill-body muted">…</div>
        </details></td></tr>`;
    }
    return html;
  }).join('');

  return `<table><thead><tr>${['مرحله', ...CHANNELS.map(([l]) => l)].map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rowsHtml}</tbody></table>`;
}

export function funnelsBody(url) {
  const bot = scopeBot(url);
  const days = Math.max(0, parseInt(url.searchParams.get('days') || '30', 10) || 0);
  const since = days ? nowSec() - days * 86400 : 0;
  const versions = allVersions(bot);
  const ver = ['', '_pre', ...versions].includes(url.searchParams.get('ver')) ? (url.searchParams.get('ver') || '') : '';

  const verOptions = [
    `<option value="">همه‌ی نسخه‌ها</option>`,
    ...versions.map(v => `<option value="${esc(v)}" ${v === ver ? 'selected' : ''}>نسخه ${esc(v)}</option>`),
    `<option value="_pre" ${ver === '_pre' ? 'selected' : ''}>قبل از ردیابی نسخه</option>`,
  ].join('');
  const filter = `<div class="card"><form method="get" action="/funnels" class="inline">
    <input type="hidden" name="bot" value="${esc(bot)}">
    <label>بازه<select name="days">
      ${[['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز'], ['0', 'همه']].map(([v, l]) => `<option value="${v}" ${Number(v) === days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>کوهورت نسخه<select name="ver">${verOptions}</select></label>
    <button type="submit">اعمال</button>
  </form>
  <p class="muted">اعداد = کاربر یکتا در هر مرحله؛ درصد نسبت به مرحله‌ی اول؛ (−n) = دراپ نسبت به مرحله‌ی قبل. فانل رویدادی از زمان نصب آنالیتیکس معتبر است. «کوهورت نسخه» = فقط کاربرانی که با آن PRODUCT_VERSION وارد شده‌اند (فیلتر روی قیف‌های رویدادی اعمال می‌شود، نه جدول‌های رکورد قطعی) — برای مقایسه‌ی قبل/بعدِ یک تغییر، همین صفحه را با دو نسخه ببین؛ برای آزمون علمی از صفحه‌ی تست‌ها (A/B) استفاده کن.</p></div>`;

  let out = filter;
  // فقط رباتِ انتخاب‌شده (داشبورد per ربات است)
  for (const [botKey, f] of Object.entries(FUNNELS).filter(([k]) => k === bot)) {
    if (!instancesOf(botKey).length) continue;
    out += `<div class="card"><h2>${esc(f.title)} — قیف اصلی</h2>${funnelTable(botKey, f.steps, since, ver)}
      <p class="muted" style="margin-top:8px">زیرِ هر مرحله، «قدم‌های ریز» را باز کن تا ببینی کاربر بینِ آن مرحله و
        مرحله‌ی بعد دقیقاً چه پیام‌هایی دید و چه دکمه‌هایی زد و کجا ریخت.</p></div>`;
    out += exitCard(botKey, { since, ch: 0, ver });
    if (f.free) {
      out += `<div class="card"><h2>${esc(f.title)} — قیف سرگرمی‌های رایگان</h2>${funnelTable(botKey, f.free, since, ver, { drill: false })}
      <p class="muted" style="margin-top:8px">آیتم‌های میانی موازی‌اند (کاربر یکی را انتخاب می‌کند، نه پشت‌سرهم)؛ این جدول نشان می‌دهد کدام قلاب رایگان بیشتر استفاده و چقدر به پرداخت ختم می‌شود.</p></div>`;
    }
    if (f.payment) {
      out += `<div class="card"><h2>${esc(f.title)} — قیف شارژ</h2>${funnelTable(botKey, f.payment, since, ver)}
      ${(() => {
        const st = paymentSteps(botKey, since);
        // هر عدد = کاربرانی که شارژشان دقیقاً در همان مرحله رها شده (لیستِ طلاییِ پیگیری)
        return st.length ? `<p class="muted" style="margin-top:8px">نقطه‌ی رها کردن شارژهای ناتمام: ${st.map(([s, c]) =>
          `${esc(s)}: ${cohortCount(c, { k: 'paystep', bot: botKey, step: s, since: String(since) })}`).join(' · ')}</p>` : '';
      })()}</div>`;
    }
    if (f.entity) {
      const st = entityStatuses(botKey, f.entity, since);
      out += `<div class="card"><h2>${esc(f.title)} — ${esc(f.entity.title)}</h2>
      ${table(['وضعیت', 'تعداد رکورد', 'کاربران'], st.map(([s, c]) => [
        esc(String(s)), fmt(c),
        cohortCount(c, { k: 'entity', bot: botKey, st: String(s), since: String(since) }),
      ]), 'رکوردی نیست.')}
      <p class="muted" style="margin-top:8px">«تعداد رکورد» ممکن است از «کاربران» بیشتر باشد (یک کاربر چند رکورد دارد). روی عددِ ستون کاربران بزن تا لیستشان باز شود.</p></div>`;
    }
  }
  if (out === filter) {
    out += `<div class="card"><p class="muted">برای «${esc(botByKey(bot)?.title || bot)}» قیفی تعریف نشده یا دیتابیسی پیدا نشد. `
      + `تعریفِ قیف‌ها در <span class="mono">lib/funnels-def.js</span> است.</p></div>`;
  }
  return out;
}
