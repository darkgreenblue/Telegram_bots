// چکِ CI: صفحه‌های «پروفایلِ کاربر» و «نتایجِ آزمایش» داشبورد نباید کلِ دیسک را بخوانند.
//
// 🐛 باگِ واقعیِ ۱۴۰۵/۰۷/۰۷: `health-watch` هشدارِ «داشبورد پاسخ نداد (HTTP 0)» فرستاد.
// پروسه زنده بود؛ حلقه‌ی رویدادش پشتِ کوئری‌های همگامِ better-sqlite3 قفل بود:
//   • `/support/user` هر بار ۲۰ تا ۳۰ ثانیه: `SELECT * FROM readings WHERE user_id=?`
//     ایندکس نداشت و کلِ جدول را با `llm_json`ِ حجیم اسکن می‌کرد (~۸۰MB)، و تایم‌لاینِ
//     رویدادها با `ORDER BY id` همه‌ی رویدادهای کاربر را می‌خواند و مرتب می‌کرد.
//   • `/experiments/view` تا ۱۸۷ ثانیه: زیرکوئریِ پرداخت‌ها در `expRevenue` inline می‌شد و
//     per هر exposure همه‌ی پرداخت‌های موفق را دوباره می‌خواند (~۱۵GB روی دیتای هم‌اندازه).
//   • متریک‌های رضایت/تأخیر `props` همه‌ی رویدادهای آن نوع را می‌خواندند، نه فقط exposeشده‌ها.
//
// این چک صفحه‌ها را واقعاً رندر می‌کند، SQLِ اجراشده را می‌گیرد، `EXPLAIN QUERY PLAN` هر
// کدام را روی فیکسچرِ هم‌اسکیما می‌سنجد، و نتیجه‌ی تایم‌لاین را با کوئریِ قبلی مقایسه می‌کند.
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log(`  ✅ ${m}`); }
  else { fail++; console.error(`  ❌ ${m}`); if (extra) console.error(`     ${extra}`); }
};

const root = mkdtempSync(path.join(tmpdir(), 'dashio-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.join(root, 'data'), { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const now = Math.floor(Date.now() / 1000);
const KEY = 'reading_model_ds';

const { ensureAnalytics } = await import(`file://${path.resolve('shared/analytics.js')}`);
{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', created_at INTEGER,
      first_source TEXT DEFAULT '', balance INTEGER DEFAULT 0);
    CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
      price INTEGER NOT NULL, focus_area TEXT NOT NULL DEFAULT '', question TEXT NOT NULL DEFAULT '',
      seed TEXT NOT NULL DEFAULT '', cards_json TEXT NOT NULL DEFAULT '', llm_json TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '', feedback TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_payment',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE INDEX idx_readings_stats ON readings(status, user_id, created_at, price, type, feedback);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', step TEXT, original_amount INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX idx_payments_status_approved ON payments(status, created_at);
    CREATE TABLE admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER, action TEXT, user_id INTEGER,
      amount INTEGER, ref_id INTEGER, note TEXT, done_at INTEGER);
    CREATE TABLE experiments (key TEXT PRIMARY KEY, name TEXT DEFAULT '', hypothesis TEXT DEFAULT '',
      mode TEXT DEFAULT 'split', metric_kind TEXT DEFAULT 'rate', variants_json TEXT NOT NULL, status TEXT DEFAULT 'running',
      decision TEXT DEFAULT '', primary_metric TEXT DEFAULT '', guardrails_json TEXT DEFAULT '[]',
      started_at INTEGER, stopped_at INTEGER, created_at INTEGER);
    CREATE TABLE ab_exposures (experiment_key TEXT NOT NULL, user_id INTEGER NOT NULL, variant TEXT NOT NULL,
      stratum TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (experiment_key, user_id));
  `);
  ensureAnalytics(db);
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_ev_user ON events(event, created_at, user_id)');
  db.prepare(`INSERT INTO experiments (key, name, variants_json, primary_metric, started_at) VALUES (?,?,?,?,?)`)
    .run(KEY, 'm', JSON.stringify([{ key: 'control', weight: 50 }, { key: 'ds', weight: 50 }]), 'payment_approved', now - 90000);
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const iu = db.prepare('INSERT INTO users (telegram_id, name, created_at) VALUES (?,?,?)');
  const ie = db.prepare('INSERT INTO events (user_id, event, props, created_at) VALUES (?,?,?,?)');
  const ir = db.prepare('INSERT INTO readings (user_id, type, price, llm_json, feedback, status, created_at) VALUES (?,?,?,?,?,?,?)');
  const ip = db.prepare('INSERT INTO payments (user_id, amount, status, created_at) VALUES (?,?,?,?)');
  const ix = db.prepare('INSERT OR IGNORE INTO ab_exposures (experiment_key, user_id, variant, created_at) VALUES (?,?,?,?)');
  db.transaction(() => {
    for (let u = 1; u <= 300; u++) iu.run(u, 'u' + u, now - 200000);
    let t = now - 100000;
    for (let i = 0; i < 6000; i++) {
      t += Math.floor(rnd() * 10);
      const u = 1 + Math.floor(rnd() * 300);
      const k = rnd();
      if (k < 0.8) ie.run(u, rnd() < 0.5 ? 'view' : 'act', '{"k":"s1"}', t);
      else ie.run(u, ['feedback', 'reading_wait', 'product_delivered', 'payment_approved'][Math.floor(rnd() * 4)],
        JSON.stringify({ score: 1 + Math.floor(rnd() * 5), ms: Math.floor(rnd() * 20000) }), t);
    }
    for (let i = 0; i < 900; i++) {
      const u = 1 + Math.floor(rnd() * 300);
      ir.run(u, 'open3', 5, 'x'.repeat(3000), rnd() < 0.3 ? 'rate:4' : '',
        ['delivered', 'pending_payment', 'canceled', 'refunded'][Math.floor(rnd() * 4)], now - Math.floor(rnd() * 90000));
    }
    for (let i = 0; i < 400; i++) ip.run(1 + Math.floor(rnd() * 300), 60000, rnd() < 0.6 ? 'approved' : 'pending', now - Math.floor(rnd() * 90000));
    for (let u = 1; u <= 200; u++) ix.run(KEY, u, u % 2 ? 'control' : 'ds', now - 80000 + u * 10);
  })();
  // ⚠️ عمداً بدونِ ANALYZE: ربات‌ها هرگز ANALYZE نمی‌زنند، پس plannerِ سرور بدونِ sqlite_stat1 است.
  db.close();
}
process.env.TAROT_DB_DIR = dataDir;
const REPO = path.resolve('.');
process.chdir(root);

/* SQLِ اجراشده توسطِ صفحه‌ها را می‌گیریم. */
const captured = [];
const origPrepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql) { captured.push(sql); return origPrepare.call(this, sql); };

const S = await import(path.join(REPO, 'bots/dashboard/routes/support.js'));
const E = await import(path.join(REPO, 'bots/dashboard/routes/experiments.js'));
const { instancesOf } = await import(path.join(REPO, 'bots/dashboard/lib/bots.js'));
const inst = instancesOf('tarot')[0];
ok(inst && inst.file.endsWith('bot-fa.db'), 'فیکسچر به‌عنوانِ دیتابیسِ tarot پیدا شد');

const plan = (sql) => {
  const db = new Database(file, { readonly: true });
  try {
    const n = (sql.match(/\?/g) || []).length;
    return origPrepare.call(db, 'EXPLAIN QUERY PLAN ' + sql).all(...Array(n).fill(1)).map(r => r.detail).join(' | ');
  } finally { db.close(); }
};

console.log('\n💽 داشبورد: صفحه‌های پروفایل و آزمایش\n');

/* ══ ۱) تایم‌لاینِ پروفایل ══ */
captured.length = 0;
const UID = 7;
const html = S.supportUserBody(new URL(`http://x/support/user?inst=${encodeURIComponent(inst.id)}&id=${UID}`));
ok(html.length > 500 && !/کاربر در این ربات نیست/.test(html), 'پروفایل رندر شد');
const rdSql = captured.find(s => /FROM readings/.test(s) && /ORDER BY id DESC LIMIT 100/.test(s));
ok(!!rdSql, 'کوئریِ فال‌های تایم‌لاین پیدا شد');
if (rdSql) {
  const p = plan(rdSql);
  ok(/COVERING INDEX idx_readings_stats/.test(p) && !/SCAN readings(?! USING COVERING)/.test(p),
    'فال‌های تایم‌لاین فقط از ایندکسِ پوششی خوانده می‌شوند (نه اسکنِ جدول با llm_json)', p);
  ok(!/\bllm_json\b|SELECT \*/.test(rdSql), 'کوئریِ فال‌ها llm_json/`*` نمی‌خواند');
  // هم‌ارزی با کوئریِ قبلی، روی چند کاربر (از جمله بی‌فال)
  const db = new Database(file, { readonly: true });
  const oldQ = origPrepare.call(db, 'SELECT id, type, price, status, feedback, created_at FROM readings WHERE user_id=? ORDER BY id DESC LIMIT 100');
  const newQ = origPrepare.call(db, rdSql);
  let same = 0, nonEmpty = 0;
  for (const u of [1, 2, 7, 50, 150, 299, 9999]) {
    const a = JSON.stringify(oldQ.all(u)), b = JSON.stringify(newQ.all(u));
    if (a === b) same++;
    if (a.length > 2) nonEmpty++;
  }
  db.close();
  ok(same === 7 && nonEmpty >= 5, `فال‌های تایم‌لاین عیناً همان ردیف‌های قبلی (${same}/7، ${nonEmpty} غیرخالی)`);
}
const evSql = captured.find(s => /FROM events WHERE user_id=\?/.test(s) && /LIMIT 400/.test(s));
ok(!!evSql, 'کوئریِ رویدادهای تایم‌لاین پیدا شد');
if (evSql) {
  const p = plan(evSql);
  ok(/idx_events_user/.test(p) && !/TEMP B-TREE FOR ORDER BY/.test(p),
    'رویدادهای تایم‌لاین از ایندکس به ترتیب خوانده می‌شوند (بدونِ مرتب‌سازیِ همه‌ی رویدادهای کاربر)', p);
}

/* ══ ۲) نتایجِ آزمایش ══ */
captured.length = 0;
const eh = E.experimentViewBody(new URL(`http://x/experiments/view?inst=${encodeURIComponent(inst.id)}&key=${KEY}`));
ok(/مجموع پرداخت|درآمد/.test(eh) && /رضایت/.test(eh), 'صفحه‌ی آزمایش با درآمد و متریک‌های تکمیلی رندر شد');
const revSql = captured.find(s => /SUM\(u\.s \* u\.s\)/.test(s));
ok(!!revSql && /MATERIALIZE p\b/.test(plan(revSql)),
  'درآمدِ per variant: پرداخت‌ها یک بار materialize می‌شوند (نه per exposure)', revSql ? plan(revSql) : 'نبود');
for (const [ev, label] of [["'feedback'", 'رضایت'], ["'reading_wait'", 'تأخیر']]) {
  const q = captured.find(s => s.includes(`ev.event=${ev}`));
  const p = q ? plan(q) : '';
  ok(/MATERIALIZE m/.test(p) && /COVERING INDEX idx_events_ev_user/.test(p),
    `${label}: رویدادها اول از ایندکسِ پوششی تطبیق می‌خورند و props فقط برای همان‌ها خوانده می‌شود`, p || 'نبود');
}

/* ══ ۳) کنترلِ مثبت: شکلِ قبلی واقعاً همان پلنِ بد را می‌داد ══ */
ok(/SCAN readings$|SCAN readings \|/.test(plan('SELECT * FROM readings WHERE user_id=? ORDER BY id DESC LIMIT 100')),
  'کنترلِ مثبت: کوئریِ قبلیِ فال‌ها کلِ جدول را اسکن می‌کرد');
ok(!/MATERIALIZE/.test(plan(`SELECT u.variant FROM (SELECT x.variant, x.user_id, COALESCE(SUM(p.amt),0) s FROM ab_exposures x
  LEFT JOIN (SELECT user_id uid, amount amt, created_at t FROM payments WHERE status=?) p ON p.uid = x.user_id AND p.t >= x.created_at
  WHERE x.experiment_key=? GROUP BY x.variant, x.user_id) u GROUP BY u.variant`)),
  'کنترلِ مثبت: شکلِ قبلیِ درآمد زیرکوئری را inline می‌کرد');

Database.prototype.prepare = origPrepare;
console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
