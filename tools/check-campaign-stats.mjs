// چکِ CI: آمارِ کمپین‌های صفحه‌ی مارکتینگ/جذب باید «گروهی» باشد و عدد عوض نشود.
//
// 🐛 باگِ واقعیِ ۱۴۰۵/۰۷/۰۷: `campaignStats` per کمپین هفت کوئری می‌زد و دوتایشان کلِ
// ردیف‌های `start` را با json_extract اسکن می‌کردند. `/marketing` روی سرور ۱۰۷ ثانیه طول
// کشید و چون better-sqlite3 همگام است، کلِ داشبورد (از جمله `/healthz`) در آن مدت قفل بود
// و ناظرِ سلامت «داشبورد پاسخ نداد (HTTP 0)» به مالک فرستاد.
//
// این چک سه چیز را می‌سنجد:
//   ۱) هم‌ارزی: نسخه‌ی گروهی برای هر کمپین دقیقاً همان اعدادِ نسخه‌ی قبلی را می‌دهد
//      (نسخه‌ی قبلی عیناً همین‌جا به‌عنوانِ مرجع مانده)، از جمله لبه‌ها: startِ غیرکمپینی
//      با code، new=0، کاربرِ تستی، پرداختِ تأییدنشده، کمپینِ بی‌دیتا، و اسکوپِ زبان‌دار.
//   ۲) تعدادِ کوئری مستقل از تعدادِ کمپین‌هاست (کنترلِ مثبت: نسخه‌ی قبلی خطی رشد می‌کند).
//   ۳) ساختاری: `campaignStats` دیگر per کمپین `scalar` صدا نمی‌زند.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const root = mkdtempSync(path.join(tmpdir(), 'campstats-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const TEST_UID = 409581917; // از فهرستِ testUsers ردیفِ tarot

const CODES = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff'];
function seed(file, salt) {
  const db = new Database(file);
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '',
      first_source TEXT DEFAULT '', first_payload TEXT DEFAULT '', created_at INTEGER DEFAULT 0);
    CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT, props TEXT, created_at INTEGER);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, original_amount INTEGER,
      status TEXT, created_at INTEGER);`);
  let uid = 1000 * salt, t = 1;
  const U = db.prepare('INSERT INTO users (telegram_id, first_source) VALUES (?,?)');
  const E = db.prepare('INSERT INTO events (user_id, event, props, created_at) VALUES (?,?,?,?)');
  const P = db.prepare('INSERT INTO payments (user_id, amount, status, created_at) VALUES (?,?,?,?)');
  CODES.slice(0, 5).forEach((code, i) => {
    for (let k = 0; k < i + salt; k++) {
      const u = ++uid;
      U.run(u, `campaign:${code}`);
      E.run(u, 'start', JSON.stringify({ kind: 'campaign', code, new: 1 }), t++);
      if (k % 2 === 0) E.run(u, 'start', JSON.stringify({ kind: 'campaign', code, new: 0 }), t++);
      if (k % 3 === 0) { E.run(u, 'first_value', '{}', t++); E.run(u, 'first_value', '{}', t++); }
      if (k % 2 === 1) E.run(u, 'paywall_shown', '{}', t++);
      if (k % 2 === 0) P.run(u, 30000 + 1000 * k, 'approved', t++);
      if (k === 1) P.run(u, 99000, 'pending', t++);
    }
    // startِ غیرکمپینی که code دارد: در returning می‌آید ولی در starts نه
    E.run(++uid, 'start', JSON.stringify({ kind: 'post', code, new: 0 }), t++);
  });
  // کاربرِ تستی با پرداختِ تأییدشده: نباید در خریدار/درآمد بیاید
  U.run(TEST_UID + salt * 0, `campaign:aaaaa`);
  P.run(TEST_UID, 150000, 'approved', t++);
  // ارگانیک و رفرال، بیرونِ هر کمپین
  U.run(++uid, 'organic'); E.run(uid, 'start', '{"kind":"organic"}', t++); E.run(uid, 'first_value', '{}', t++);
  db.close();
}
seed(path.join(dataDir, 'bot-fa.db'), 1);
seed(path.join(dataDir, 'bot-ru.db'), 2);
seed(path.join(dataDir, 'bot-es.db'), 3);
process.env.TAROT_DB_DIR = dataDir;
process.env.DASH_CACHE_DIR = path.join(root, 'cache');
process.env.DASH_CACHE_WORKER = path.join(root, 'noop-worker.mjs');
writeFileSync(process.env.DASH_CACHE_WORKER, 'process.exit(0);\n');

const REPO = path.resolve('.');
mkdirSync(path.join(root, 'data'), { recursive: true });
process.chdir(root);

const M = await import(path.join(REPO, 'bots/dashboard/routes/marketing.js'));
const L = await import(path.join(REPO, 'bots/dashboard/lib/bots.js'));
const SRC = readFileSync(path.join(REPO, 'bots/dashboard/routes/marketing.js'), 'utf8');

/* مرجع: نسخه‌ی per کمپینِ قبلی، عیناً. `counter` تعدادِ کوئری‌ها را می‌شمارد. */
function oldStats(c, counter = { n: 0 }) {
  const { instancesOf, withDb, hasTable, userPk, moneyOf, toToman, testUserClause } = L;
  const scalar = (db, sql, a) => { counter.n++; return L.scalar(db, sql, a); };
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
        agg.payers += scalar(db, `SELECT COUNT(DISTINCT p.user_id) c FROM ${m.table} p JOIN users u ON u.${pk}=p.user_id WHERE u.first_source=? AND p.status='${m.successStatus}'${testClause}${testUserClause(c.bot, 'p.user_id')}`, [src]);
        agg.revenue += toToman(c.bot, scalar(db, `SELECT COALESCE(SUM(p.${m.amountCol}),0) s FROM ${m.table} p JOIN users u ON u.${pk}=p.user_id WHERE u.first_source=? AND p.status='${m.successStatus}'${testClause}${testUserClause(c.bot, 'p.user_id')}`, [src]));
      }
    });
  }
  return agg;
}

console.log('\n📣 آمارِ گروهیِ کمپین‌ها\n');

/* ══ ۱) هم‌ارزی ══ */
const BOTKEYS = ['tarot', 'tarot-intl', 'tarot-intl@ru', 'tarot-intl@es'];
let nonTrivial = 0;
for (const bot of BOTKEYS) {
  M._resetCampaignStatsMemo();
  for (const code of CODES) {
    const want = oldStats({ bot, code });
    const got = M.campaignStats({ bot, code });
    if (want.starts + want.revenue + want.payers > 0) nonTrivial++;
    ok(JSON.stringify(got) === JSON.stringify(want), `${bot} / ${code} همان اعدادِ قبلی`,
      `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  }
}
ok(nonTrivial >= 12, `فیکسچر واقعاً دیتا دارد (${nonTrivial} ترکیبِ غیرصفر)`);

// لبه‌ها روی یک مقدارِ مشخص، تا هم‌ارزی «هر دو صفر» نباشد
M._resetCampaignStatsMemo();
const a = M.campaignStats({ bot: 'tarot', code: 'aaaaa' });
// aaaaa در fa: یک startِ کمپینیِ جدید + یک startِ کمپینیِ برگشتی + یک startِ غیرکمپینیِ برگشتی
ok(a.starts === 2 && a.returning === 2 && a.firstValue === 1, 'startِ برگشتی و غیرکمپینی واقعاً در فیکسچر هست',
  JSON.stringify(a));
ok(!oldStats({ bot: 'tarot', code: 'aaaaa' }).revenue.toString().includes('150'), 'درآمدِ کاربرِ تستی بیرون است (مرجع)');
ok(a.newUsers === oldStats({ bot: 'tarot', code: 'aaaaa' }).newUsers && a.newUsers >= 2, 'کاربرِ تستی در «کاربر جدید» شمرده می‌شود، مثل قبل');

/* ══ ۲) تعدادِ کوئری مستقل از تعدادِ کمپین‌ها ══ */
const origPrepare = Database.prototype.prepare;
let prepared = 0;
Database.prototype.prepare = function (...args) { prepared++; return origPrepare.apply(this, args); };
M._resetCampaignStatsMemo();
for (const code of CODES) M.campaignStats({ bot: 'tarot', code });
const newCount = prepared;
Database.prototype.prepare = origPrepare;
const oldCounter = { n: 0 };
for (const code of CODES) oldStats({ bot: 'tarot', code }, oldCounter);
ok(newCount <= 12, `شش کمپین با حداکثر ۱۲ prepare (واقعی: ${newCount})`);
ok(oldCounter.n >= 6 * 7, `کنترلِ مثبت: نسخه‌ی قبلی per کمپین ۷ کوئری می‌زد (${oldCounter.n})`);

/* ══ ۲ب) صفحه‌ی مارکتینگ هیچ کوئریِ سنگینی روی حلقه‌ی HTTP نمی‌زند ══
 * حتی نسخه‌ی گروهی روی سرور ده‌ها ثانیه طول می‌کشید (props همه‌ی رویدادهای start)، پس آمار
 * به worker رفت و `marketingBody` فقط فرم‌ها + فهرست + اعدادِ کش‌شده را رندر می‌کند. */
const { writeDashCache } = await import(path.join(REPO, 'bots/dashboard/lib/dash-cache.js'));
const { renderCachedAnalyticsPage } = await import(path.join(REPO, 'bots/dashboard/lib/analytics-pages.js'));
const { listCampaigns } = await import(path.join(REPO, 'bots/dashboard/lib/platform.js'));
{
  const pdb = new Database(path.join(root, 'data', 'platform.db'));
  const ins = pdb.prepare('INSERT OR IGNORE INTO campaigns (code, bot, source, medium, name) VALUES (?,?,?,?,?)');
  for (const code of CODES) ins.run(code, 'tarot', 's', 'm', 'n_' + code);
  pdb.close();
}
ok(listCampaigns().length >= CODES.length, 'کمپین‌های فیکسچر در platform.db ثبت شدند');
const MKURL = new URL('http://x/marketing?bot=tarot');
const heavyRe = /FROM events|FROM payments|json_extract/;
let seen = [];
Database.prototype.prepare = function (sql) { seen.push(sql); return origPrepare.call(this, sql); };
const cold = M.marketingBody(MKURL);
Database.prototype.prepare = origPrepare;
ok(seen.filter(q => heavyRe.test(q)).length === 0, 'بدونِ کش، `marketingBody` هیچ کوئریِ events/payments نمی‌زند',
  seen.filter(q => heavyRe.test(q)).map(q => q.replace(/\s+/g, ' ').slice(0, 80)).join(' || '));
ok(/در حال آماده‌سازی/.test(cold) && /…/.test(cold) && /n_aaaaa/.test(cold),
  'بدونِ کش: فهرستِ کمپین‌ها زنده دیده می‌شود و اعداد «…» با نوارِ «در حال آماده‌سازی»');

// worker همان مسیری را می‌سازد که صفحه می‌خواند
M._resetCampaignStatsMemo();
const built = renderCachedAnalyticsPage(new URL('http://127.0.0.1/marketing?bot=tarot'));
let parsed = null; try { parsed = JSON.parse(built); } catch {}
ok(parsed && Array.isArray(parsed.stats) && parsed.stats.length >= CODES.length, 'worker برای /marketing دیتای JSON می‌سازد');
const want = oldStats({ bot: 'tarot', code: 'eeeee' });
const got = new Map(parsed?.stats || []).get('tarot|eeeee');
ok(JSON.stringify(got) === JSON.stringify(want), 'آمارِ ساخته‌شده در worker همان آمارِ قبلی است',
  `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

writeDashCache(new URL('http://127.0.0.1/marketing?bot=tarot'), built);
seen = [];
Database.prototype.prepare = function (sql) { seen.push(sql); return origPrepare.call(this, sql); };
const warm = M.marketingBody(MKURL);
Database.prototype.prepare = origPrepare;
ok(seen.filter(q => heavyRe.test(q)).length === 0, 'با کش هم `marketingBody` هیچ کوئریِ سنگینی نمی‌زند');
ok(warm.includes(`>${new Intl.NumberFormat('fa-IR').format(want.starts)}<`) || warm.includes(String(want.starts)),
  'با کش: اعدادِ کمپین روی صفحه می‌نشینند');
ok(/آخرین‌بار/.test(warm), 'با کش: زمانِ به‌روزرسانیِ آمار نشان داده می‌شود');

/* ══ ۳) ساختاری ══ */
const body = SRC.slice(SRC.indexOf('export function campaignStats('), SRC.indexOf('export const _resetCampaignStatsMemo'));
ok(body.length > 0 && !/scalar\(/.test(body), 'campaignStats دیگر per کمپین scalar صدا نمی‌زند');
ok(/campaignStatsAll\(c\.bot\)/.test(body), 'campaignStats از نسخه‌ی گروهی می‌خواند');

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
