#!/usr/bin/env node
// 📈 چکِ صفحه‌ی «ترندها» (`bots/dashboard/lib/trends.js` + `routes/trends.js`).
//
// قراردادهایی که اگر بشکنند، صفحه هنوز نمودار می‌کشد ولی **دروغ می‌گوید** — و چون عددِ
// شبانه یخ می‌شود، دروغش **ماندگار** است:
//  ۱) **آخرین نقطه = نمای کلی.** موتورِ ترند در «الان» باید تک‌تکِ عددهای `gather` را بدهد.
//     تعریفِ دوم یعنی مالک دو عددِ متفاوت برای یک سنجه می‌بیند.
//  ۲) **مرزِ روزِ تهران.** چیزی که ثانیه‌ی آخرِ روز آمده مالِ همان روز است، ثانیه‌ی اولِ
//     فردا نه. این‌جا با فیکسچرِ روی خودِ مرز سنجیده می‌شود، نه دور از آن.
//  ۳) **یخ‌بودن.** ردیفِ نوشته‌شده با دیتای بعدی عوض نمی‌شود؛ فقط نسخه‌ی تعریف بازسازی می‌کند.
//  ۴) **خطا صفر نمی‌شود.** خواندنِ شکست‌خورده باید کلِ اجرا را لغو کند، نه روزی با عددِ صفر
//     را برای همیشه ثبت کند.
//  ۵) **فقط ایندکسِ پوششی.** سرور دیسک‌محدود است؛ استخراج نباید به متنِ سنگینِ فال برسد.
//
// اجرا: node tools/check-trends.mjs   (بدون شبکه؛ فیکسچرِ SQLite در پوشه‌ی موقت)
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
const REPO = path.resolve(import.meta.dirname, '..');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const D = 86400;
const OFF = 12600;
const now = Math.floor(Date.now() / 1000);
const todayNo = Math.floor((now + OFF) / D);
const T0 = todayNo * D - OFF;              // شروعِ امروزِ تهران = پایانِ دیروز
// اگر چک دقیقاً روی نیمه‌شب اجرا شود، «الان» و «T0» یکی می‌شوند و فیکسچرِ «امروز» خالی؛ رد نمی‌کنیم، فقط هشدار
if (now - T0 < 120) console.log('  ⚠️ چک در دو دقیقه‌ی اولِ روزِ تهران اجرا شد؛ چند ادعای «امروز» لبه‌ای‌اند');

/* ── فیکسچر: production-shaped (همان ایندکس‌های پوششیِ تاروت) ── */
const root = mkdtempSync(path.join(tmpdir(), 'trendcheck-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const SCHEMA = `
  CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
    balance INTEGER DEFAULT 0, daily_streak INTEGER DEFAULT 0, session_json TEXT DEFAULT '', memory_json TEXT DEFAULT '',
    first_source TEXT DEFAULT '', first_payload TEXT DEFAULT '', first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
  CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, price INTEGER,
    focus_area TEXT DEFAULT '', question TEXT DEFAULT '', cards_json TEXT DEFAULT '', llm_json TEXT DEFAULT '',
    summary TEXT DEFAULT '', feedback TEXT DEFAULT '', status TEXT DEFAULT 'pending_payment', created_at INTEGER);
  CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', step TEXT, original_amount INTEGER, created_at INTEGER, updated_at INTEGER, approved_at INTEGER);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
  CREATE TABLE referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER, referee_id INTEGER UNIQUE, rewarded INTEGER DEFAULT 0, created_at INTEGER);
  CREATE TABLE llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER DEFAULT 0, kind TEXT DEFAULT '',
    ref_id INTEGER DEFAULT 0, model TEXT DEFAULT '', cost_usd REAL DEFAULT 0, created_at INTEGER);
  -- همان ایندکس‌هایی که تاروت/shared در بوت می‌سازند (بدونِ ANALYZE، مثلِ پروداکشن)
  CREATE INDEX idx_events_user ON events(user_id, created_at);
  CREATE INDEX idx_events_event ON events(event, created_at);
  CREATE INDEX idx_events_ev_user ON events(event, created_at, user_id);
  CREATE INDEX idx_events_adm ON events(user_id) WHERE json_extract(props,'$.adm') = 1;
  CREATE INDEX idx_readings_stats ON readings(status, user_id, created_at, price, type, feedback);
  CREATE INDEX idx_users_created ON users(created_at, first_source);
  CREATE INDEX idx_payments_status_approved ON payments(status, approved_at);
`;
function makeDb(file, fill) {
  const db = new Database(file);
  db.exec(SCHEMA);
  const api = {
    u: (id, t) => db.prepare('INSERT INTO users (telegram_id,name,created_at,last_seen,session_json) VALUES (?,?,?,?,?)').run(id, `u${id}`, t, t, 'x'.repeat(500)),
    r: (uid, t, price = 3, fb = '', status = 'delivered') =>
      db.prepare('INSERT INTO readings (user_id,type,price,feedback,status,created_at,llm_json) VALUES (?,?,?,?,?,?,?)')
        .run(uid, 'love3', price, fb, status, t, 'L'.repeat(2000)),
    e: (uid, t, props = '{}', ev = 'act') => db.prepare('INSERT INTO events (user_id,event,props,created_at) VALUES (?,?,?,?)').run(uid, ev, props, t),
    ref: (a, b, rewarded, t) => db.prepare('INSERT INTO referrals (referrer_id,referee_id,rewarded,created_at) VALUES (?,?,?,?)').run(a, b, rewarded, t),
    pay: (uid, amount, t) => db.prepare("INSERT INTO payments (user_id,amount,status,step,created_at,approved_at) VALUES (?,?,'approved','receipt',?,?)").run(uid, amount, t, t),
    llm: (usd, t) => db.prepare('INSERT INTO llm_usage (kind,model,cost_usd,created_at) VALUES (?,?,?,?)').run('reading', 'x', usd, t),
  };
  fill(api);
  db.close();
}

/* فارسی: الگوهای درگیریِ متنوع، چند چیز **روی مرزِ دیروز/امروز** */
makeDb(path.join(dataDir, 'bot-fa.db'), ({ u, r, e, ref, pay, llm }) => {
  // ۱ فعالِ کامل: اولین فال ۲۰ روز پیش، چند روزِ متفاوت، آخرین فال **ثانیه‌ی آخرِ دیروز**
  u(1, T0 - 40 * D);
  for (const d of [20, 12, 5]) r(1, T0 - d * D + 3600, 3, 'rate:5');
  r(1, T0 - 1, 5, 'rate:4');
  e(1, T0 - 1); e(1, T0 - 3 * D);
  // ۲ تازه: ثبت‌نامِ دیروز، فالِ **ثانیه‌ی اولِ امروز** (نباید در دیروز بیاید) و یکی ۶۰ ثانیه قبلش
  u(2, T0 - 10 * 3600);
  r(2, T0, 3, 'rate:2');
  r(2, T0 - 60, 3, '');
  e(2, T0); e(2, T0 - 60);
  // ۳ ثانیه‌ی اولِ دیروز (مرزِ پایین): فال و رویداد هر دو مالِ دیروزند
  u(3, T0 - 30 * D);
  r(3, T0 - D, 10, 'rate:3');
  r(3, T0 - 9 * D, 3, 'rate:5');
  e(3, T0 - D);
  // ۴ ثانیه‌ی آخرِ پریروز: مالِ دیروز نیست
  u(4, T0 - 25 * D);
  r(4, T0 - D - 1, 3, 'rate:5');
  r(4, T0 - 15 * D, 3, 'rate:5');
  e(4, T0 - D - 1);
  // ۵ ریزش: فال در هفته‌ی قبل از قبل، این هفته هیچ
  u(5, T0 - 30 * D);
  r(5, T0 - 10 * D, 3, 'rate:1'); r(5, T0 - 11 * D, 3, '');
  // ۶ ادمین: باید از همه‌ی سنجه‌های فال/رضایت بیرون بماند
  u(6, T0 - 50 * D);
  e(6, T0 - 2 * D, '{"adm":1}', 'view');
  for (const d of [30, 20, 10, 2]) r(6, T0 - d * D, 10, 'rate:5');
  // ۷ فقط کارتِ روز (رایگان) و یک فالِ لغوشده: هیچ فالِ کاملی ندارد
  u(7, T0 - 20 * D);
  r(7, T0 - 3 * D, 0, ''); r(7, T0 - 4 * D, 3, '', 'canceled');
  // ۸ کاربرِ امروز (هنوز در هیچ روزِ کاملی نیست)
  u(8, T0 + 60); e(8, T0 + 60);
  // ۹ تنها فالش **ثانیه‌ی اولِ امروز** است: در پایانِ دیروز هنوز «فال‌گرفته» نیست
  u(9, T0 - 5 * D);
  r(9, T0, 3, 'rate:1');
  // ۱۰ آخرین فال **دقیقاً** T0−۷روز: لبه‌ی پنجره‌ی ۷ روزه (`>=`)، پس هنوز فعال است
  u(10, T0 - 30 * D);
  r(10, T0 - 20 * D, 3, ''); r(10, T0 - 7 * D, 3, '');
  // ۱۱/۱۲ لبه‌ی MAU: رویدادِ ۳۰ روزِ تقویمی پیش داخل، ۳۱ روز پیش بیرون
  u(11, T0 - 40 * D); e(11, T0 - 30 * D + 100);
  u(12, T0 - 40 * D); e(12, T0 - 31 * D + 100);
  // ۱۳/۱۴ لبه‌ی «کاربرِ جدیدِ دیروز»: ثانیه‌ی آخرِ پریروز بیرون، ثانیه‌ی اولِ دیروز داخل
  u(13, T0 - D - 1);
  u(14, T0 - D);
  // دعوت: ۲ را ۱ **سه روز پیش** دعوت کرد ولی پاداش روزِ اولین فالِ ۲ است (دیروز)؛ ۵ را ۳ دعوت کرد (پاداش ۱۱ روز پیش)
  ref(1, 2, 1, T0 - 3 * D); ref(3, 5, 1, T0 - 12 * D); ref(4, 7, 0, T0 - 3 * D);
  // پول
  pay(1, 300_000, T0 - 20 * D); pay(3, 150_000, T0 - D + 100);
  llm(0.5, T0 - 2 * D); llm(0.25, T0 - D + 50);
  // رویدادهای پراکنده‌ی کاربر ۱ برای WAU/MAU
  for (const d of [8, 15, 25]) e(1, T0 - d * D + 500);
});
/* دو زبانِ دیگر: «زبان‌های دیگر» جمعِ این دو، `@ru` فقط اولی */
makeDb(path.join(dataDir, 'bot-ru.db'), ({ u, r, e }) => {
  u(101, T0 - 15 * D); r(101, T0 - 14 * D, 3, 'rate:5'); r(101, T0 - 2 * D, 3, 'rate:5'); e(101, T0 - 2 * D);
  u(102, T0 - 3 * D); r(102, T0 - 2 * D + 10, 3, 'rate:4'); e(102, T0 - 2 * D + 10);
});
makeDb(path.join(dataDir, 'bot-es.db'), ({ u, r, e }) => {
  u(201, T0 - 9 * D); r(201, T0 - 8 * D, 3, 'rate:5'); r(201, T0 - D + 5, 3, ''); e(201, T0 - D + 5);
});

process.env.TAROT_DB_DIR = dataDir;
process.env.DASH_CACHE_DIR = path.join(root, 'cache');
process.env.DASH_CACHE_WORKER = path.join(root, 'noop-worker.js');
process.chdir(root);                       // platform.db داشبورد در پوشه‌ی موقت
const base = path.join(REPO, 'bots/dashboard');
const RATE = 100_000;
const { setSetting, getSetting, pdb } = await import(`file://${base}/lib/platform.js`);
setSetting('usd_toman', String(RATE));
const T = await import(`file://${base}/lib/trends.js`);
const { gather, dashBody } = await import(`file://${base}/routes/dash.js`);
const { trendsBody } = await import(`file://${base}/routes/trends.js`);
const { instancesOf } = await import(`file://${base}/lib/bots.js`);
const { profitFor } = await import(`file://${base}/lib/profit.js`);
const { RET_DAYS } = await import(`file://${base}/lib/engage.js`);

ok(instancesOf('tarot').length === 1 && instancesOf('tarot-intl').length === 2, 'فیکسچر: یک فارسی و دو زبانِ دیگر دیده شد');
ok(JSON.stringify(T.trendScopes()) === JSON.stringify(['tarot', 'tarot-intl', 'tarot-intl@es', 'tarot-intl@ru']),
  `اسکوپ‌ها = هر رباتِ BI به‌علاوه‌ی هر زبانش (دیده شد: ${T.trendScopes().join(', ')})`);

const extracts = (eventsSince = 0) => {
  const m = new Map();
  for (const s of ['tarot', 'tarot-intl']) for (const i of instancesOf(s)) m.set(i.id, T.extractInstance(i, eventsSince));
  return m;
};

console.log('\n▶ ۱) آخرین نقطه = نمای کلی: موتور در «الان» دقیقاً عددهای `gather` را می‌دهد');
{
  const ex = extracts();
  for (const scope of ['tarot', 'tarot-intl', 'tarot-intl@ru']) {
    const n = Math.floor(Date.now() / 1000);
    const g7 = gather(scope, { since: 0, activeWindow: 7 });
    const g1 = gather(scope, { since: 0, activeWindow: 1 });
    const m = T.metricsAt(scope, n + 1, ex);
    const pairs = [
      ['users', g7.users], ['readings', g7.readings], ['readers', g7.readers], ['repeat', g7.repeat],
      ['active7', g7.active], ['active1', g1.active], ['satisfied', g7.satisfied], ['raters', g7.raters],
      ['churn', g7.churn], ['dau', g7.dau], ['wau', g7.wau], ['mau', g7.mau], ['coins', g7.coinsSpent],
      ['referrers', g7.referrers], ['referrals_ok', g7.referralsOk],
    ];
    const bad = pairs.filter(([k, v]) => m[k] !== v).map(([k, v]) => `${k}: ترند=${m[k]} نمای‌کلی=${v}`);
    ok(!bad.length, `${scope}: ${pairs.length} شمارش یکی‌اند${bad.length ? ` — ${bad.join(' · ')}` : ''}`);
    // ماندگاری: صورت/مخرج ⟵ درصد
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
    const retBad = RET_DAYS.filter((d, i) => m[`ret${d}`] !== pct(g7.retention[i].num, g7.retention[i].den));
    ok(!retBad.length, `${scope}: ماندگاریِ D+${RET_DAYS.join('/')} یکی است${retBad.length ? ` — اختلاف در ${retBad.join(',')}` : ''}`);
    const avg = g7.ratedReadings ? Math.round((g7.rateSum / g7.ratedReadings) * 100) / 100 : null;
    ok(m.avg_rate === avg, `${scope}: میانگینِ نمره ${m.avg_rate} = ${avg}`);
    const ttfv = g7.ttfv.length ? [...g7.ttfv].sort((a, b) => a - b)[Math.floor(g7.ttfv.length / 2)] : null;
    ok(m.ttfv === ttfv, `${scope}: میانه‌ی زمان تا اولین فال ${m.ttfv} = ${ttfv}`);
  }
  /* و همان چیزی که مالک **روی صفحه** می‌بیند (نه فقط شیءِ داخلی) */
  const html = dashBody(new URL('http://x/dash?bot=tarot&range=all&aw=7'));
  const m = T.metricsAt('tarot', Math.floor(Date.now() / 1000) + 1, ex);
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  ok(html.includes(`<div class="k">نسبت کاربران راضی</div><div class="v">${fa(m.sat_ratio)}٪</div>`),
    `سرخطِ «نسبت کاربران راضی» روی صفحه = ترند (${m.sat_ratio}٪)`);
  ok(html.includes(`<div class="k">کل فال‌های کامل</div><div class="v">${fa(m.readings)}</div>`), `«کل فال‌های کامل» روی صفحه = ترند (${m.readings})`);
  ok(html.includes(`چسبندگی (DAU÷WAU)</div><div class="v">${fa(m.stickiness)}٪`), `«چسبندگی» روی صفحه = ترند (${m.stickiness}٪)`);
  ok(html.includes(`میانگین فال به ازای هر کاربرِ واردشده</div><div class="v">${fa(m.per_user)}`), `«فال per کاربر» روی صفحه = ترند (${m.per_user})`);
  ok(html.includes(`میانگین فال در روز (کل عمر)</div><div class="v">${fa(m.readings_per_day)}`), `«فال در روز» روی صفحه = ترند (${m.readings_per_day})`);
}

console.log('\n▶ ۲) مرزِ روزِ تهران: «دیروز» یعنی [T0−۱روز, T0)، هر دو لبه دقیق');
{
  const ex = extracts();
  const y = T.metricsAt('tarot', T0, ex);
  // فال‌های کاملِ دیروز (بدونِ ادمین): کاربر۱ در T0−1، کاربر۲ در T0−60، کاربر۳ در T0−D = ۳ ؛ کاربر۴ (T0−D−1) و کاربر۲ (T0) نه
  ok(y.readings_day === 3, `فالِ کاملِ دیروز = ۳ (ثانیه‌ی آخر و اولِ دیروز داخل، ثانیه‌ی اولِ امروز و آخرِ پریروز بیرون) — دیده شد ${y.readings_day}`);
  // DAU دیروز: کاربر۱ (T0−1)، کاربر۲ (T0−60)، کاربر۳ (T0−D) = ۳ ؛ رویدادِ T0 و T0−D−1 بیرون
  ok(y.dau === 3, `DAU دیروز = ۳ — دیده شد ${y.dau}`);
  // کاربرانِ واردشده تا پایانِ دیروز: همه جز ۸ = ۱۳ ؛ جدیدِ دیروز = ۲ و ۱۴ (۱۳ یک ثانیه زودتر آمده)
  ok(y.users === 13 && y.new_users === 2, `کل کاربران تا دیروز = ۱۳ و کاربرِ جدیدِ دیروز = ۲ (لبه‌ها دقیق) — دیده شد ${y.users}/${y.new_users}`);
  // فال‌گرفته‌ها: ۱، ۲، ۳، ۴، ۵، ۱۰ ؛ کاربر ۹ (تنها فالش T0) هنوز نه، ادمین و ۷ هرگز
  ok(y.readers === 6, `فال‌گرفته‌ها تا پایانِ دیروز = ۶ (فالِ ثانیه‌ی اولِ امروز حساب نمی‌شود) — دیده شد ${y.readers}`);
  // WAU = روزهای [امروز−۷، امروز−۱]: ۱، ۲، ۳، ۴ و ادمین (DAU/WAU مثلِ نمای کلی ادمین را حذف نمی‌کنند) = ۵
  ok(y.wau === 5, `WAU دیروز = ۵ (رویدادِ ۸ روز پیش بیرون) — دیده شد ${y.wau}`);
  // MAU = سی روزِ تقویمی تا دیروز: همان پنج نفر + کاربر ۱۱ (۳۰ روز پیش) ؛ ۱۲ (۳۱ روز پیش) بیرون
  ok(y.mau === 6, `MAU دیروز = ۶ (لبه‌ی ۳۰ روز داخل، ۳۱ روز بیرون) — دیده شد ${y.mau}`);
  // نمره‌ی ۲ (فالِ T0) هنوز نیامده؛ پس میانگینِ کاربر۲ نباید از رضایت کم کند
  const yy = T.metricsAt('tarot', T0 - 1, ex);
  ok(yy.readings_day === y.readings_day - 1, 'یک ثانیه زودتر، فالِ ثانیه‌ی آخرِ دیروز (T0−1) هنوز شمرده نمی‌شود');
  // پنجره‌ی «کاربر فعال»: کاربر ۱ در پایانِ دیروز فعال است (≥۷ روز، چند روزِ متفاوت، آخرین فال در ۷ روزِ اخیر)
  // ۱، ۳، ۴ و ۱۰ (۱۰ دقیقاً روی لبه‌ی ۷ روز) فعال‌اند؛ ۵ (آخرین فال ۱۰ روز پیش) و ادمین نه
  ok(y.active7 === 4, `فعالِ ۷ روزه در پایانِ دیروز = ۴ (کاربر ۱، ۳، ۴ و ۱۰ روی لبه) — دیده شد ${y.active7}`);
  // پنجره‌ی ۱ روزه: آخرین فال باید در [T0−۱روز, T0) باشد ⟵ ۱ و ۳ ؛ کاربر ۴ (T0−D−1) یک ثانیه بیرون است
  ok(y.active1 === 2, `فعالِ ۱ روزه = ۲ (کاربر ۱ و ۳؛ کاربرِ ۴ یک ثانیه بیرونِ پنجره) — دیده شد ${y.active1}`);
  // دعوت: پاداشِ «۱←۲» روزِ اولین فالِ ۲ است (T0−60، دیروز) و پاداشِ «۳←۵» یازده روز پیش
  const twoDaysAgo = T.metricsAt('tarot', T0 - D, ex);
  ok(y.referrals_ok === 2 && twoDaysAgo.referrals_ok === 1, `دعوتِ موفق: دیروز ۲، پریروز ۱ (روزِ پاداش = اولین فالِ دعوت‌شده) — دیده شد ${y.referrals_ok}/${twoDaysAgo.referrals_ok}`);
}

console.log('\n▶ ۳) ثبتِ شبانه: کلِ تاریخچه یک‌بار، بعد فقط روزِ تازه؛ ردیف یخ است');
{
  ok(T.trendsDue(now) === true, 'قبل از اولین اجرا «لازم است» گزارش می‌شود');
  const r1 = T.runTrendSnapshot(now);
  const firstDayNo = Math.floor((T0 - 50 * D + OFF) / D);   // اولین کاربرِ فارسی (ادمین، ۵۰ روز پیش)
  const expectDays = todayNo - firstDayNo;                  // تا دیروز
  const nFa = pdb.prepare("SELECT COUNT(DISTINCT day) c FROM trend_daily WHERE scope='tarot'").get().c;
  ok(nFa === expectDays, `تاروتِ فارسی: ${expectDays} روز از روزِ اولین کاربر تا دیروز ثبت شد (دیده شد ${nFa})`);
  const perDay = pdb.prepare("SELECT MIN(c) mn, MAX(c) mx FROM (SELECT COUNT(*) c FROM trend_daily WHERE scope='tarot' GROUP BY day)").get();
  ok(perDay.mn === T.TREND_METRICS.length && perDay.mx === T.TREND_METRICS.length, `هر روز دقیقاً ${T.TREND_METRICS.length} سنجه دارد`);
  const y = T.dayKeyOf(todayNo - 1);
  const srcY = pdb.prepare("SELECT DISTINCT src FROM trend_daily WHERE scope='tarot' AND day=?").all(y).map(r => r.src);
  const srcOld = pdb.prepare("SELECT DISTINCT src FROM trend_daily WHERE scope='tarot' AND day=?").all(T.dayKeyOf(todayNo - 10)).map(r => r.src);
  ok(srcY.join() === 'night' && srcOld.join() === 'rebuilt', `دیروز «شبانه» و ده روز پیش «بازسازی‌شده» علامت خورد (${srcY}/${srcOld})`);
  const val = (scope, day, k) => pdb.prepare('SELECT value v FROM trend_daily WHERE scope=? AND day=? AND metric=?').get(scope, day, k)?.v;
  const ex = extracts();
  const live = T.metricsAt('tarot', T0, ex);
  ok(val('tarot', y, 'readings_day') === live.readings_day && val('tarot', y, 'users') === live.users,
    'عددِ ثبت‌شده‌ی دیروز = موتور در پایانِ دیروز');
  ok(val('tarot-intl', y, 'users') === 3 && val('tarot-intl@ru', y, 'users') === 2 && val('tarot-intl@es', y, 'users') === 1,
    'زبان‌های دیگر: کل = جمعِ دو زبان، و هر زبان فقط خودش');
  ok(T.trendsDue(now) === false, 'بعد از اجرا دیگر «لازم» نیست');
  ok(T.trendsDue(now + D) === true, 'فردا دوباره «لازم است» (روزِ تازه)');

  const r2 = T.runTrendSnapshot(now);
  ok(r1.inserted > 0 && r2.inserted === 0, `اجرای دوم هیچ ردیفی اضافه نکرد (idempotent؛ اول ${r1.inserted})`);

  // یخ‌بودن: فالی **عقب‌تاریخ‌خورده** برای ۳ روز پیش اضافه می‌شود؛ تاریخچه نباید عوض شود.
  // ⚠️ یک سنجه‌ی دیگرِ همان روز عمداً پاک می‌شود تا آن روز «ناقص» شود و اجرا واقعاً رویش
  // بنویسد؛ وگرنه این ادعا با `INSERT OR REPLACE` هم سبز می‌ماند (جهش این را نشان داد).
  const d3 = T.dayKeyOf(todayNo - 3);
  const before = val('tarot', d3, 'readings');
  const usersD3 = val('tarot', d3, 'users');
  { const db = new Database(path.join(dataDir, 'bot-fa.db')); db.prepare("INSERT INTO readings (user_id,type,price,feedback,status,created_at) VALUES (5,'love3',3,'','delivered',?)").run(T0 - 3 * D + 10); db.close(); }
  pdb.prepare("DELETE FROM trend_daily WHERE scope='tarot' AND day=? AND metric='users'").run(d3);
  T.runTrendSnapshot(now);
  ok(val('tarot', d3, 'readings') === before, `ردیفِ ثبت‌شده یخ است: فالِ عقب‌تاریخ‌خورده عددِ ۳ روز پیش را عوض نکرد (${before})`);
  ok(val('tarot', d3, 'users') === usersD3, 'سنجه‌ی جاافتاده‌ی همان روز دوباره پر شد');

  // نسخه‌ی تعریف: فقط همان سنجه از نو ساخته می‌شود
  pdb.prepare("UPDATE trend_daily SET v=0 WHERE metric='readings'").run();
  setSetting('trend_defs_hash', 'stale');
  ok(T.trendsDue(now) === true, 'تعریفِ عوض‌شده ⟵ «لازم است»');
  const readersBefore = val('tarot', d3, 'readers');
  T.runTrendSnapshot(now);
  ok(val('tarot', d3, 'readings') === before + 1, `سنجه‌ی با نسخه‌ی کهنه از نو ساخته شد و فالِ تازه را دید (${before} ⟵ ${val('tarot', d3, 'readings')})`);
  ok(val('tarot', d3, 'readers') === readersBefore, 'سنجه‌های دیگر دست نخوردند (یخ ماندند)');
  ok(getSetting('trend_defs_hash', '') === T.TREND_DEFS_HASH, 'اثرانگشتِ تعریف‌ها بعد از اجرا به‌روز شد');
}

console.log('\n▶ ۴) خطای خواندن هرگز روزِ صفر ثبت نمی‌کند');
{
  const y = T.dayKeyOf(todayNo - 1);
  pdb.prepare('DELETE FROM trend_daily WHERE day=?').run(y);
  setSetting('trend_checked_day', '');          // انگار امشب هنوز اجرا نشده
  const db = new Database(path.join(dataDir, 'bot-fa.db'));
  db.exec('ALTER TABLE readings RENAME COLUMN feedback TO fb');
  db.close();
  let threw = false;
  try { T.runTrendSnapshot(now); } catch { threw = true; }
  const n = pdb.prepare('SELECT COUNT(*) c FROM trend_daily WHERE day=?').get(y).c;
  ok(threw && n === 0, `کوئریِ شکست‌خورده کلِ اجرا را لغو کرد و هیچ اسکوپی (حتی سالم‌ها) ردیفِ دیروز نگرفت (throw=${threw}، ردیف=${n})`);
  ok(T.trendsDue(now) === true, 'اجرای ناموفق مهرِ «انجام شد» نمی‌زند (پس دوباره تلاش می‌شود)');
  const db2 = new Database(path.join(dataDir, 'bot-fa.db'));
  db2.exec('ALTER TABLE readings RENAME COLUMN fb TO feedback');
  db2.close();
  T.runTrendSnapshot(now);
  ok(pdb.prepare('SELECT COUNT(*) c FROM trend_daily WHERE day=?').get(y).c === 4 * T.TREND_METRICS.length,
    'بعد از رفعِ خطا، اجرای بعدی همان روز را برای هر چهار اسکوپ پر کرد');
  ok(T.trendsDue(now) === false, 'و بعد از اجرای موفق، «لازم» نیست');
}

console.log('\n▶ ۵) استخراج فقط از ایندکسِ پوششی (بدونِ لمسِ متنِ فال و session کاربر)');
{
  const db = new Database(path.join(dataDir, 'bot-fa.db'), { readonly: true });
  const plan = (sql, p = []) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map((r) => r.detail).join(' | ');
  const pr = plan(T.EXTRACT_SQL.readings(' AND r.user_id NOT IN (6)'));
  ok(/COVERING INDEX idx_readings_stats/.test(pr), `فال‌ها: ${pr}`);
  const pu = plan(T.EXTRACT_SQL.users('telegram_id'));
  ok(/COVERING INDEX idx_users_created/.test(pu), `کاربران: ${pu}`);
  const pe = plan(T.EXTRACT_SQL.events, [0]);
  ok(/COVERING INDEX/.test(pe) && !/SCAN events(?! USING)/.test(pe), `رویدادها: ${pe}`);
  db.close();
}

console.log('\n▶ ۶) صفحه: یک کاشی per سنجه، عددِ سرِ کاشی = ردیفِ ثبت‌شده، پول = profitFor');
{
  const html = trendsBody(new URL('http://x/trends?bot=tarot&rTr=all'));
  const tiles = [...html.matchAll(/<div class="tile" id="t-([a-z0-9_]+)">/g)].map((m) => m[1]);
  ok(T.TREND_METRICS.every((m) => tiles.includes(m.k)), `همه‌ی ${T.TREND_METRICS.length} سنجه‌ی ثبت‌شده کاشی دارند`);
  for (const k of ['net_cum', 'rev_day', 'cost_day', 'net_day', 'rev_cum', 'margin', 'arpu']) ok(tiles.includes(k), `کاشیِ پولیِ ${k} هست`);
  ok(!/NaN|undefined|Infinity/.test(html), 'هیچ NaN/undefined/Infinity در صفحه نیست');
  const y = T.dayKeyOf(todayNo - 1);
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const stored = pdb.prepare("SELECT value v FROM trend_daily WHERE scope='tarot' AND day=? AND metric='users'").get(y).v;
  ok(html.includes(`<div class="tile" id="t-users">\n    <div class="tl">کل کاربران واردشده</div>\n    <div class="tv">${fa(stored)}</div>`),
    `سرِ کاشیِ «کل کاربران» = ردیفِ دیروز (${stored})`);
  const pf = profitFor('tarot', 'all');
  const cumY = pf.series.find((s) => s.d === y)?.cum;
  ok(html.includes(`<div class="tile" id="t-net_cum">\n    <div class="tl">سودِ خالص (تجمعی)</div>\n    <div class="tv">${fa(Math.round(cumY))} ت</div>`),
    `سرِ کاشیِ «سودِ خالص» = سریِ profitFor در پایانِ دیروز (${cumY})`);
  // دیتای نمودار: یک نقطه per روز، و قابلِ پارس
  const m = /data-tc="([^"]+)"/.exec(html);
  const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));
  const days = todayNo - Math.floor((T0 - 50 * D + OFF) / D);
  ok(data.length === days, `دیتای hoverِ هر نمودار ${days} روز دارد (دیده شد ${data.length})`);
  // بازه: ۳۰ روز ⟵ ۳۰ نقطه؛ ورودیِ خراب ⟵ پیش‌فرض بدونِ خطا
  const h30 = trendsBody(new URL('http://x/trends?bot=tarot&rTr=d30'));
  const d30 = JSON.parse(/data-tc="([^"]+)"/.exec(h30)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  ok(d30.length === 30, `بازه‌ی ۳۰ روزه ۳۰ نقطه دارد (دیده شد ${d30.length})`);
  const hBad = trendsBody(new URL("http://x/trends?bot=tarot&rTr=%27%3Bdrop"));
  ok(hBad.includes('class="pill on">۹۰ روز<'), 'بازه‌ی خراب ⟵ پیش‌فرضِ ۹۰ روز، بدونِ خطا');
  const hv = trendsBody(new URL('http://x/trends?bot=voice2text'));
  ok(hv.includes('فعلاً فقط برای') && !hv.includes('class="tile"'), 'رباتِ غیرِ BI یک پیامِ صادقانه می‌گیرد، نه نمودارِ خالی');
  const hRu = trendsBody(new URL('http://x/trends?bot=tarot-intl@ru&rTr=all'));
  ok(hRu.includes('id="t-users"'), 'اسکوپِ یک زبان هم رندر می‌شود');
  // تغییرِ هفتگی برای «جهتِ بد» رنگِ قرمز می‌گیرد (ریزش بالا رفت = بد)
  ok(/id="t-churn">[\s\S]*?class="td (good|bad)|id="t-churn">[\s\S]*?class="td"/.test(html), 'کاشیِ ریزش خطِ تغییر دارد');
}

console.log('\n▶ ۷) سیم‌کشی: منو، کش، worker، زمان‌بندی، و تک‌منبعِ تعریف‌ها');
{
  const src = (f) => readFileSync(path.join(base, f), 'utf8');
  ok(/\['\/trends', '📈 ترندها'\]/.test(src('lib/nav.js')), 'منوی «آمار تحلیلی» آیتمِ ترندها را دارد');
  ok(/'\/trends'/.test(src('lib/dash-cache.js')) && /\['\/trends', trendsBody\]/.test(src('lib/analytics-pages.js')),
    'صفحه از cache worker ساخته می‌شود (profitFor در حلقه‌ی HTTP نمی‌نشیند)');
  ok(/'\/trends': \(url\) => \['ترندها', cachedAnalyticsBody\(url\)\]/.test(src('index.js')), 'مسیرِ HTTP فقط کش را می‌خواند');
  ok(/^scheduleTrends\(\);/m.test(src('index.js')), 'index.js ثبتِ شبانه را زمان‌بندی می‌کند');
  ok(/runTrendSnapshot\(\)/.test(src('lib/trends-worker.js')), 'worker همان runTrendSnapshot را اجرا می‌کند');
  const t = src('lib/trends.js');
  ok(!/'delivered'|rate:%/.test(t), 'trends.js تعریفِ «فالِ کامل»/«نمره» را از نو نمی‌نویسد (از engage.js می‌آید)');
  ok(/import \{[^}]*\bDONE\b[^}]*\bRATED\b[^}]*\} from '\.\/engage\.js'/.test(t), 'DONE و RATED از engage.js import می‌شوند');
  ok(!/\browsOf?\(|\bscalar\(/.test(t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'trends.js از rows()/scalar()ِ خطاقورت‌دهنده استفاده نمی‌کند');
  ok(/stdio: \['ignore', 'inherit', 'inherit'\]/.test(t), 'خروجی و خطای worker به لاگِ pm2 می‌رسد (دور ریخته نمی‌شود)');
}

console.log(`\n${errs.length ? '❌' : '✅'} ${pass} ادعا سبز${errs.length ? `، ${errs.length} قرمز` : ''}`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
