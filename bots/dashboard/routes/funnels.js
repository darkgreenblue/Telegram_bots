// فانل‌ها و نقاط دراپ — دو منبع مکمل:
// ۱) فانل رویدادی (events): کاربر یکتا per مرحله + breakdown چنل (ارگانیک/رفرال/کمپین).
//    فقط از زمان نصب آنالیتیکس دیتا دارد — برای voice2text یعنی رفتار کاربران قدیمی را نشان نمی‌دهد.
// ۲) توزیع وضعیت رکوردهای قطعی per-entity (readings/voice_flows/payments.step): بدون بایاس snapshot،
//    شامل کاربران قبل از آنالیتیکس. (هیچ عددی از users.state ساخته نمی‌شود — state فقط «الان» را می‌گوید.)
import { instancesOf, withDb, hasTable, scalar, rows } from '../lib/bots.js';
import { fmt, esc, nowSec } from '../lib/util.js';
import { table } from '../lib/html.js';

export const FUNNELS = {
  tarot: {
    title: '🔮 تاروت',
    steps: [
      ['start', 'استارت'],
      ['onboard_done', 'آنبوردینگ کامل'],
      ['spread_selected', 'انتخاب نوع فال'],
      ['question_submitted', 'ارسال سؤال'],
      ['cards_picked', 'انتخاب کارت‌ها'],
      ['paywall_shown', 'دیدن پی‌وال'],
      ['reading_started', 'باز کردن کارت‌ها (پرداخت)'],
      ['product_delivered', 'تحویل کامل فال'],
    ],
    payment: [
      ['recharge_started', 'شروع شارژ'],
      ['receipt_submitted', 'ارسال رسید'],
      ['payment_approved', 'تأیید پرداخت'],
    ],
    entity: { table: 'readings', title: 'وضعیت فال‌ها (رکورد قطعی — شامل قبل از آنالیتیکس)' },
  },
  voice2text: {
    title: '🎙 ویس به متن',
    steps: [
      ['start', 'استارت'],
      ['product_delivered', 'پردازش موفق'],
      ['payment_approved', 'پرداخت موفق'],
    ],
    entity: { table: 'voice_flows', title: 'وضعیت فلوهای ویس (رکورد قطعی — شامل قبل از آنالیتیکس)' },
  },
  'resume-tailor': {
    title: '📄 رزومه‌ساز',
    steps: [
      ['start', 'استارت'],
      ['onboard_done', 'پروفایل ساخته شد'],
      ['product_delivered', 'رزومه تحویل شد'],
    ],
  },
};

// ستون‌های breakdown چنل — شرط SQL روی users.first_source (کاربرِ join شده به رویداد)
const CHANNELS = [
  ['همه', '1=1'],
  ['ارگانیک', "u.first_source = 'organic'"],
  ['رفرال', "u.first_source LIKE 'referral:%'"],
  ['کمپین‌ها', "u.first_source LIKE 'campaign:%'"],
];

function stepCounts(botKey, event, since) {
  const out = CHANNELS.map(() => 0);
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'events')) return;
      CHANNELS.forEach(([, cond], i) => {
        out[i] += scalar(db, `SELECT COUNT(DISTINCT e.user_id) c FROM events e
          JOIN users u ON u.telegram_id = e.user_id
          WHERE e.event = ? AND e.created_at >= ? AND ${cond}`, [event, since]);
      });
    });
  }
  return out;
}

function entityStatuses(botKey, tableName, since) {
  const merged = new Map();
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, tableName)) return;
      for (const r of rows(db, `SELECT status, COUNT(*) c FROM ${tableName} WHERE created_at >= ? GROUP BY status`, [since])) {
        merged.set(r.status, (merged.get(r.status) || 0) + r.c);
      }
    });
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}

function paymentSteps(botKey, since) {
  // نقطه‌ی رها کردن فلوی شارژ: payments.step روی پرداخت‌های ناتمام (pending/canceled)
  const merged = new Map();
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'payments')) return;
      for (const r of rows(db, `SELECT COALESCE(step,'-') step, COUNT(*) c FROM payments
          WHERE created_at >= ? AND status IN ('pending','canceled','cancelled') GROUP BY step`, [since])) {
        merged.set(r.step, (merged.get(r.step) || 0) + r.c);
      }
    });
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}

function funnelTable(botKey, steps, since) {
  const data = steps.map(([ev, label]) => [label, stepCounts(botKey, ev, since)]);
  const base = data[0]?.[1] || CHANNELS.map(() => 0);
  const body = data.map(([label, counts], idx) => {
    const prev = idx > 0 ? data[idx - 1][1] : null;
    return [
      esc(label),
      ...counts.map((c, i) => {
        const pctBase = base[i] ? Math.round(c / base[i] * 100) : 0;
        const drop = prev && prev[i] > 0 ? ` <span class="muted">(−${fmt(prev[i] - c)})</span>` : '';
        return `<b>${fmt(c)}</b> <span class="muted">${idx ? pctBase + '٪' : ''}</span>${idx ? drop : ''}`;
      }),
    ];
  });
  return table(['مرحله', ...CHANNELS.map(([l]) => l)], body, 'رویدادی ثبت نشده.');
}

export function funnelsBody(url) {
  const days = Math.max(0, parseInt(url.searchParams.get('days') || '30', 10) || 0);
  const since = days ? nowSec() - days * 86400 : 0;

  const filter = `<div class="card"><form method="get" action="/funnels" class="inline">
    <label>بازه<select name="days">
      ${[['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز'], ['0', 'همه']].map(([v, l]) => `<option value="${v}" ${Number(v) === days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <button type="submit">اعمال</button>
  </form>
  <p class="muted">اعداد = کاربر یکتا در هر مرحله؛ درصد نسبت به مرحله‌ی اول؛ (−n) = دراپ نسبت به مرحله‌ی قبل. فانل رویدادی از زمان نصب آنالیتیکس معتبر است.</p></div>`;

  let out = filter;
  for (const [botKey, f] of Object.entries(FUNNELS)) {
    if (!instancesOf(botKey).length) continue;
    out += `<div class="card"><h2>${esc(f.title)} — قیف اصلی</h2>${funnelTable(botKey, f.steps, since)}</div>`;
    if (f.payment) {
      out += `<div class="card"><h2>${esc(f.title)} — قیف شارژ</h2>${funnelTable(botKey, f.payment, since)}
      ${(() => {
        const st = paymentSteps(botKey, since);
        return st.length ? `<p class="muted" style="margin-top:8px">نقطه‌ی رها کردن شارژهای ناتمام: ${st.map(([s, c]) => `${esc(s)}: ${fmt(c)}`).join(' · ')}</p>` : '';
      })()}</div>`;
    }
    if (f.entity) {
      const st = entityStatuses(botKey, f.entity.table, since);
      out += `<div class="card"><h2>${esc(f.title)} — ${esc(f.entity.title)}</h2>
      ${table(['وضعیت', 'تعداد'], st.map(([s, c]) => [esc(String(s)), fmt(c)]), 'رکوردی نیست.')}</div>`;
    }
  }
  return out;
}
