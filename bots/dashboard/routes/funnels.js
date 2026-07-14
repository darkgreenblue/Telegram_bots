// فانل‌ها و نقاط دراپ — دو منبع مکمل:
// ۱) فانل رویدادی (events): کاربر یکتا per مرحله + breakdown چنل (ارگانیک/رفرال/کمپین).
//    فقط از زمان نصب آنالیتیکس دیتا دارد — برای voice2text یعنی رفتار کاربران قدیمی را نشان نمی‌دهد.
// ۲) توزیع وضعیت رکوردهای قطعی per-entity (readings/voice_flows/payments.step): بدون بایاس snapshot،
//    شامل کاربران قبل از آنالیتیکس. (هیچ عددی از users.state ساخته نمی‌شود — state فقط «الان» را می‌گوید.)
import { instances, instancesOf, withDb, hasTable, scalar, rows, userPk, moneyOf, unixOf } from '../lib/bots.js';
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
    // قیف سرگرمی‌های رایگان (فاز اینگیجمنت) → تبدیل. آیتم‌ها موازی‌اند (نه سریالی)؛
    // هدف: دیدن کدام قلاب رایگان بیشتر استفاده می‌شود و نرخِ رسیدن از منوی رایگان به پرداخت.
    free: [
      ['free_menu_opened', 'باز کردن منوی رایگان'],
      ['hafez_taken', 'فال حافظ'],
      ['estekhare_taken', 'استخاره'],
      ['quiz_done', 'کوییز کارت'],
      ['coffee_taken', 'فال قهوه'],
      ['card_meaning_viewed', 'کتابخانه کارت'],
      ['paywall_shown', 'دیدن پی‌وال'],
      ['payment_approved', 'پرداخت'],
    ],
    entity: { table: 'readings', title: 'وضعیت فال‌ها (رکورد قطعی — شامل قبل از آنالیتیکس)' },
  },
  secretary: {
    title: '🗂 منشی',
    steps: [
      ['start', 'استارت'],
      ['capture_received', 'دریافت ورودی'],
      ['items_extracted', 'استخراج نیت'],
      ['product_delivered', 'مسیریابی'],
    ],
    entity: { table: 'captures', title: 'وضعیت ورودی‌ها (رکورد قطعی)' },
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
  'tabir-khab': {
    title: '🌙 تعبیر خواب',
    steps: [
      ['start', 'استارت'],
      ['first_value', 'اولین تعبیر (تریال)'],
      ['product_delivered', 'تعبیر کامل'],
      ['payment_approved', 'پرداخت اشتراک'],
    ],
    // قیف نمادیاب خواب (مرور رایگان نمادها → CTA → تعبیر کامل)
    free: [
      ['symbol_opened', 'باز کردن نمادیاب'],
      ['symbol_viewed', 'دیدن نماد'],
      ['symbol_search', 'جستجوی نماد'],
      ['symbol_not_found', 'نماد پیدا نشد'],
      ['symbol_cta_dream', 'CTA به تعریف خواب'],
      ['product_delivered', 'تعبیر کامل'],
    ],
    // dreams ستون status ندارد → از full_delivered یک برچسب می‌سازیم
    entity: { table: 'dreams', title: 'وضعیت خواب‌ها', statusExpr: "CASE WHEN full_delivered=1 THEN 'delivered' WHEN is_free_trial=1 THEN 'trial_preview' ELSE 'pending' END" },
  },
};

// ستون‌های breakdown چنل — شرط SQL روی users.first_source (کاربرِ join شده به رویداد)
const CHANNELS = [
  ['همه', '1=1'],
  ['ارگانیک', "u.first_source = 'organic'"],
  ['رفرال', "u.first_source LIKE 'referral:%'"],
  ['کمپین‌ها', "u.first_source LIKE 'campaign:%'"],
];

// کوهورت نسخه: فیلتر اختیاری روی users.first_version ('' = همه؛ '_pre' = کاربران قبل از ردیابی نسخه)
function verCond(ver) {
  if (!ver) return { cond: '1=1', params: [] };
  if (ver === '_pre') return { cond: "u.first_version = ''", params: [] };
  return { cond: 'u.first_version = ?', params: [ver] };
}

// همه‌ی نسخه‌هایی که کاربری با آن‌ها وارد شده (برای انتخابگر کوهورت)
function allVersions() {
  const set = new Set();
  for (const inst of instances()) {
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
  const statusExpr = entity.statusExpr || 'status';
  const catExpr = unixOf(botKey === 'tabir-khab' ? 'iso' : 'unix', 'created_at');
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, entity.table)) return;
      for (const r of rows(db, `SELECT ${statusExpr} status, COUNT(*) c FROM ${entity.table} WHERE ${catExpr} >= ? GROUP BY ${statusExpr}`, [since])) {
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

function funnelTable(botKey, steps, since, ver) {
  const data = steps.map(([ev, label]) => [label, stepCounts(botKey, ev, since, ver)]);
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
  const versions = allVersions();
  const ver = ['', '_pre', ...versions].includes(url.searchParams.get('ver')) ? (url.searchParams.get('ver') || '') : '';

  const verOptions = [
    `<option value="">همه‌ی نسخه‌ها</option>`,
    ...versions.map(v => `<option value="${esc(v)}" ${v === ver ? 'selected' : ''}>نسخه ${esc(v)}</option>`),
    `<option value="_pre" ${ver === '_pre' ? 'selected' : ''}>قبل از ردیابی نسخه</option>`,
  ].join('');
  const filter = `<div class="card"><form method="get" action="/funnels" class="inline">
    <label>بازه<select name="days">
      ${[['7', '۷ روز'], ['30', '۳۰ روز'], ['90', '۹۰ روز'], ['0', 'همه']].map(([v, l]) => `<option value="${v}" ${Number(v) === days ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>کوهورت نسخه<select name="ver">${verOptions}</select></label>
    <button type="submit">اعمال</button>
  </form>
  <p class="muted">اعداد = کاربر یکتا در هر مرحله؛ درصد نسبت به مرحله‌ی اول؛ (−n) = دراپ نسبت به مرحله‌ی قبل. فانل رویدادی از زمان نصب آنالیتیکس معتبر است. «کوهورت نسخه» = فقط کاربرانی که با آن PRODUCT_VERSION وارد شده‌اند (فیلتر روی قیف‌های رویدادی اعمال می‌شود، نه جدول‌های رکورد قطعی) — برای مقایسه‌ی قبل/بعدِ یک تغییر، همین صفحه را با دو نسخه ببین؛ برای آزمون علمی از صفحه‌ی تست‌ها (A/B) استفاده کن.</p></div>`;

  let out = filter;
  for (const [botKey, f] of Object.entries(FUNNELS)) {
    if (!instancesOf(botKey).length) continue;
    out += `<div class="card"><h2>${esc(f.title)} — قیف اصلی</h2>${funnelTable(botKey, f.steps, since, ver)}</div>`;
    if (f.free) {
      out += `<div class="card"><h2>${esc(f.title)} — قیف سرگرمی‌های رایگان</h2>${funnelTable(botKey, f.free, since, ver)}
      <p class="muted" style="margin-top:8px">آیتم‌های میانی موازی‌اند (کاربر یکی را انتخاب می‌کند، نه پشت‌سرهم)؛ این جدول نشان می‌دهد کدام قلاب رایگان بیشتر استفاده و چقدر به پرداخت ختم می‌شود.</p></div>`;
    }
    if (f.payment) {
      out += `<div class="card"><h2>${esc(f.title)} — قیف شارژ</h2>${funnelTable(botKey, f.payment, since, ver)}
      ${(() => {
        const st = paymentSteps(botKey, since);
        return st.length ? `<p class="muted" style="margin-top:8px">نقطه‌ی رها کردن شارژهای ناتمام: ${st.map(([s, c]) => `${esc(s)}: ${fmt(c)}`).join(' · ')}</p>` : '';
      })()}</div>`;
    }
    if (f.entity) {
      const st = entityStatuses(botKey, f.entity, since);
      out += `<div class="card"><h2>${esc(f.title)} — ${esc(f.entity.title)}</h2>
      ${table(['وضعیت', 'تعداد'], st.map(([s, c]) => [esc(String(s)), fmt(c)]), 'رکوردی نیست.')}</div>`;
    }
  }
  return out;
}
