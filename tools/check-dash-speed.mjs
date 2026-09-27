#!/usr/bin/env node
// ⏱ چکِ سرعتِ ساختِ کشِ داشبورد و صفِ «به‌روزرسانی همین بخش».
//
// 🐛 باگِ واقعی (۱۴۰۵/۰۷/۰۵، گزارشِ مالک: «دکمه‌ی به‌روزرسانی را می‌زنم، چند دقیقه بعد
// برمی‌گردم و ساعت عوض نشده»). لاگِ سرور در ۵ روز: ۶۳ ساختِ کشته‌شده در سقفِ ۳ دقیقه در
// برابرِ ۵۵ ساختِ موفق، و موفق‌ها تقریباً فقط `/dash` و `/economics`. سه علت، هر سه بی‌صدا:
//   ۱) هر کوئریِ تحلیلی ادمین را با `json_extract(props,'$.adm') = 1` کنار می‌گذاشت و این
//      یعنی پارسِ JSONِ همه‌ی ۲٫۲ میلیون رویداد، **per کوئری**. روی دیتای هم‌اندازه ۸۵٪ِ
//      زمانِ `/dash` همین بود. درمان: ایندکسِ جزئیِ `idx_events_adm` در `shared/journey.js`.
//   ۲) `/screens` per هر نمایش یک زیرکوئری می‌زد (۳۶ ثانیه روی دیتای هم‌اندازه، یعنی بالای
//      ۳ دقیقه روی سرور)، و «قدمِ قبلیِ» `/funnels` کلِ تاریخچه‌ی هر کاربر را رتبه‌بندی می‌کرد.
//   ۳) صف سریال بود و کلیکِ دستی پشتِ ساخت‌های محکوم به شکست می‌ماند؛ و worker با
//      `stdio:'ignore'` اجرا می‌شد، پس خطایش هیچ‌جا ثبت نمی‌شد.
//
// چهار ادعا، هر کدام برای یک علت:
//   ▶ ۱ هم‌ارزی: کوئری‌های تازه روی یک فیکسچرِ تصادفی **دقیقاً** همان خروجیِ کوئری‌های قبلی را
//     می‌دهند (نسخه‌ی قدیم عیناً این‌جا نگه داشته شده و نقشِ مرجع را دارد).
//   ▶ ۲ ایندکس: هر متنِ فیلترِ ادمین در سورسِ داشبورد عیناً همان شرطِ ایندکس است و planner
//     واقعاً از `idx_events_adm` استفاده می‌کند. یک فاصله‌ی اضافه در یک کوئریِ تازه ایندکس
//     را بی‌صدا دور می‌زند و کندی را برمی‌گرداند؛ این ادعا همان را می‌گیرد.
//   ▶ ۳ طرحِ کوئری: `/screens` هیچ زیرکوئریِ همبسته‌ای ندارد.
//   ▶ ۴ صف: کلیکِ دستی جلوی صف می‌رود، ساختِ در جریان تکراری نمی‌شود، وضعیتِ «در حال
//     آماده‌سازی» برای ساختِ در جریان هم نشان داده می‌شود، و stderrِ worker به لاگ می‌رسد.
//
// اجرا: node tools/check-dash-speed.mjs   (بدون شبکه؛ فیکسچر در پوشه‌ی موقت)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
const base = path.resolve('bots/dashboard');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const root = mkdtempSync(path.join(tmpdir(), 'dashspeed-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.join(root, 'data'), { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const now = Math.floor(Date.now() / 1000);
const ADMIN = 999;

/* ── فیکسچر: زمانِ صعودی با شناسه (همان‌طور که ربات می‌نویسد)، با هم‌ثانیه‌ها، اکشن‌هایی
   درست روی لبه‌ی پنجره‌ی ۳۰ دقیقه، و یک ادمینِ تگ‌خورده. ── */
const { ensureAnalytics } = await import(`file://${path.resolve('shared/analytics.js')}`);
const { ensureJourney } = await import(`file://${path.resolve('shared/journey.js')}`);
{
  const db = new Database(file);
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', created_at INTEGER,
    first_source TEXT DEFAULT '', first_payload TEXT DEFAULT '', first_version TEXT DEFAULT '')`);
  ensureAnalytics(db);
  ensureJourney(db);
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const iu = db.prepare('INSERT INTO users (telegram_id, name, created_at, first_source) VALUES (?,?,?,?)');
  const ie = db.prepare('INSERT INTO events (user_id, event, props, created_at) VALUES (?,?,?,?)');
  const uids = [...Array(40)].map((_, i) => 100 + i);
  db.transaction(() => {
    for (const u of [...uids, ADMIN]) iu.run(u, 'u' + u, now - 40 * 86400, rnd() < 0.5 ? 'organic' : 'campaign:abc');
    let t = now - 80 * 86400; // ~۶۰ روز دیتا که ~۲۰ روز پیش تمام می‌شود ⟵ همه «خارج‌شده»‌اند
    for (let i = 0; i < 6000; i++) {
      // گامِ زمانی: گاهی صفر (هم‌ثانیه)، گاهی دقیقاً لبه‌ی ۱۸۰۰، گاهی جهشِ بلند
      const r = rnd();
      t += r < 0.2 ? 0 : r < 0.25 ? 1800 : r < 0.28 ? 1801 : r < 0.3 ? 20000 : Math.floor(rnd() * 900);
      const u = rnd() < 0.03 ? ADMIN : uids[Math.floor(Math.pow(rnd(), 2) * uids.length)];
      const adm = u === ADMIN ? { adm: 1 } : {};
      const k = rnd();
      if (k < 0.5) ie.run(u, 'view', JSON.stringify({ k: 's' + Math.floor(rnd() * 12), t: 'msg', ...adm }), t);
      else if (k < 0.85) ie.run(u, 'act', JSON.stringify({ a: 'cb' + Math.floor(rnd() * 6), ...adm }), t);
      else ie.run(u, ['start', 'paywall_shown', 'product_delivered'][Math.floor(rnd() * 3)], '{}', t);
    }
  })();
  db.close();
}

process.env.TAROT_DB_DIR = dataDir;
process.chdir(root);

/* ── مرجع: کوئری‌های **قبلی**، عیناً از نسخه‌ی پیش از این تغییر ── */
const NA = "e.user_id NOT IN (SELECT user_id FROM events WHERE json_extract(props,'$.adm') = 1)";
const KEY = (t) => `COALESCE(json_extract(${t}.props,'$.k'), json_extract(${t}.props,'$.a'), '')`;
const OLD_SCREENS = `
  SELECT k, COUNT(*) imps, COUNT(DISTINCT uid) users,
         SUM(CASE WHEN na IS NOT NULL THEN 1 ELSE 0 END) acted,
         SUM(CASE WHEN na IS NOT NULL THEN na - ts ELSE 0 END) secSum
  FROM (
    SELECT json_extract(e.props,'$.k') k, e.user_id uid, e.created_at ts,
           (SELECT MIN(a.created_at) FROM events a
             WHERE a.user_id = e.user_id AND a.event='act'
               AND a.id > e.id AND a.created_at <= e.created_at + 1800) na
    FROM events e
    WHERE e.event='view' AND e.created_at >= ? AND ${NA}
  ) GROUP BY k`;
const OLD_EXITS = `
  WITH last AS (SELECT user_id, MAX(id) mid FROM events WHERE created_at>=? GROUP BY user_id),
       ex AS (SELECT e.user_id uid, e.id eid, e.event ev, ${KEY('e')} kk FROM events e
              JOIN last ON last.mid = e.id JOIN users u ON u.telegram_id = e.user_id
              WHERE e.created_at < ? AND 1=1 AND ${NA}),
       pv AS (SELECT ex.ev ev, ex.kk kk, p.event pev, ${KEY('p')} pkk,
                     ROW_NUMBER() OVER (PARTITION BY ex.uid ORDER BY p.id DESC) rn
              FROM ex LEFT JOIN events p ON p.user_id = ex.uid AND p.id < ex.eid)
  SELECT ev, kk, COALESCE(pev,'') pev, COALESCE(pkk,'') pkk, COUNT(*) n
  FROM pv WHERE rn = 1 GROUP BY ev, kk, pev, pkk`;

// ضبطِ همه‌ی SQLهایی که داشبورد اجرا می‌کند (برای ادعای طرحِ کوئری)
const captured = [];
const origPrepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql) {
  const st = origPrepare.call(this, sql);
  const all = st.all;
  if (all) st.all = function (...a) { captured.push({ sql, params: a }); return all.apply(this, a); };
  return st;
};

const J = await import(`file://${base}/lib/journey.js`);
const ref = new Database(file, { readonly: true });

console.log('▶ ۱) کوئری‌های تازه دقیقاً همان خروجیِ قبلی را می‌دهند');
{
  for (const days of [0, 45, 70]) {
    const since = days ? now - days * 86400 : 0;
    const oldRows = ref.prepare(OLD_SCREENS).all(since).filter(r => r.k)
      .map(r => `${r.k}|${r.imps}|${r.users}|${r.acted}|${r.secSum}`).sort();
    const newRows = J.screensReport('tarot', { since })
      .map(r => `${r.k}|${r.imps}|${r.users}|${r.acted}|${r.secSum}`).sort();
    ok(oldRows.length > 5 && JSON.stringify(oldRows) === JSON.stringify(newRows),
      `«صفحه‌ها» با بازه‌ی ${days || 'کل'} روز: ${newRows.length} ردیف، عیناً برابرِ نسخه‌ی قبل`);
  }
  // کنترلِ مثبت: فیکسچر واقعاً اکشنِ بیرونِ پنجره دارد، وگرنه شرطِ پنجره سنجیده نمی‌شد
  const acted = J.screensReport('tarot', { since: 0 }).reduce((s, r) => s + r.acted, 0);
  const imps = J.screensReport('tarot', { since: 0 }).reduce((s, r) => s + r.imps, 0);
  ok(acted > 0 && acted < imps, `هم نمایشِ «عبورکرده» دارد هم «نکرده» (${acted} از ${imps})`);

  // «کجا ریختند؟» فقط پرتکرارترین قدمِ قبلی را برمی‌گرداند، پس خودِ SQLِ تازه (همان که
  // exitPoints اجرا کرد) ضبط و ردیف‌به‌ردیف با نسخه‌ی قبل مقایسه می‌شود.
  for (const idleH of [24, 24 * 7]) {
    const idle = now - idleH * 3600;
    captured.length = 0;
    J.exitPoints('tarot', { since: 0, now: idle + 86400 });
    const q = captured.find(c => /WITH last AS/.test(c.sql) && /pv AS/.test(c.sql));
    const norm = (rs) => rs.map(r => `${r.ev}|${r.kk}|${r.pev}|${r.pkk}|${r.n}`).sort();
    const oldRows = norm(ref.prepare(OLD_EXITS).all(0, idle));
    const newRows = q ? norm(ref.prepare(q.sql).all(...q.params)) : [];
    ok(oldRows.length > 3 && JSON.stringify(oldRows) === JSON.stringify(newRows),
      `«کجا ریختند؟» با ${idleH / 24} روز بی‌فعالیتی: ${oldRows.length} ردیف (با قدمِ قبلی)، عیناً برابرِ نسخه‌ی قبل`);
  }
}

console.log('\n▶ ۲) هر فیلترِ ادمین در داشبورد از ایندکسِ جزئی استفاده می‌کند');
{
  const idx = ref.prepare("SELECT sql FROM sqlite_master WHERE name='idx_events_adm'").get();
  ok(!!idx, 'ensureJourney ایندکسِ idx_events_adm را می‌سازد');
  const PRED = "json_extract(props,'$.adm') = 1";
  ok(idx && idx.sql.includes(`WHERE ${PRED}`), `شرطِ ایندکس عیناً «${PRED}» است`);
  const src = [];
  for (const dir of ['lib', 'routes']) {
    for (const f of require('fs').readdirSync(path.join(base, dir))) {
      if (f.endsWith('.js')) src.push([`${dir}/${f}`, readFileSync(path.join(base, dir, f), 'utf8')]);
    }
  }
  let uses = 0, exact = 0;
  const bad = [];
  for (const [f, s] of src) {
    const all = s.match(/\$\.adm'/g) || [];
    const good = s.match(/json_extract\(props,\s*'\$\.adm'\)\s*=\s*1(?![\d'])/g) || [];
    uses += all.length; exact += good.length;
    if (all.length !== good.length) bad.push(f);
  }
  ok(uses >= 8 && uses === exact,
    `همه‌ی ${uses} فیلترِ ادمین در سورسِ داشبورد عیناً شکلِ ایندکس‌پذیر را دارند${bad.length ? ` (ناهمخوان: ${bad.join(', ')})` : ''}`);
  for (const q of [
    "SELECT DISTINCT user_id FROM events WHERE json_extract(props,'$.adm') = 1",
    `SELECT COUNT(*) FROM events e WHERE ${NA}`,
  ]) {
    const plan = ref.prepare('EXPLAIN QUERY PLAN ' + q).all().map(r => r.detail).join(' | ');
    ok(plan.includes('idx_events_adm'), `planner از ایندکس استفاده می‌کند: ${q.slice(0, 60)}…`);
  }
  // کنترلِ مثبت: شکلِ معادل ولی متفاوت (مقایسه با رشته‌ی '1') ایندکس را **دور می‌زند** —
  // پس ادعای بالا پوچ نیست و یک کوئریِ تازه با همین لغزش واقعاً کندی را برمی‌گرداند.
  // (فاصله‌گذاری مهم نیست؛ planner توکن‌ها را مقایسه می‌کند نه متن را.)
  const off = ref.prepare("EXPLAIN QUERY PLAN SELECT DISTINCT user_id FROM events WHERE json_extract(props,'$.adm') = '1'").all()
    .map(r => r.detail).join(' | ');
  ok(!off.includes('idx_events_adm'), "کنترلِ مثبت: «= '1'» ایندکس را دور می‌زند (برای همین شکلِ شرط در سورس قفل است)");
}

console.log('\n▶ ۳) «صفحه‌ها» هیچ زیرکوئریِ همبسته‌ای ندارد');
{
  captured.length = 0;
  J.screensReport('tarot', { since: 0 });
  const main = captured.find(c => /FROM events e/.test(c.sql) && /view/.test(c.sql));
  ok(!!main, 'کوئریِ اصلیِ «صفحه‌ها» ضبط شد');
  const plan = main ? ref.prepare('EXPLAIN QUERY PLAN ' + main.sql).all(...main.params).map(r => r.detail).join(' | ') : '';
  ok(main && !/CORRELATED/.test(plan), 'طرحِ کوئری بدونِ CORRELATED SCALAR SUBQUERY است (per نمایش یک جستجو نمی‌زند)');
}
ref.close();

console.log('\n▶ ۴) صفِ «به‌روزرسانی همین بخش»');
{
  const log = path.join(root, 'worker.log');
  const worker = path.join(root, 'fake-worker.mjs');
  writeFileSync(worker, `import { appendFileSync } from 'fs';
const url = process.argv[2];
appendFileSync(${JSON.stringify(log)}, url + '\\n');
await new Promise(r => setTimeout(r, 150));
if (url.includes('bot=fail')) { console.error('boom ' + url); process.exit(1); }
`);
  process.env.DASH_CACHE_DIR = path.join(root, 'cache');
  process.env.DASH_CACHE_WORKER = worker;
  const errLines = [];
  const origErr = console.error;
  console.error = (...a) => { errLines.push(a.join(' ')); };
  const C = await import(`file://${base}/lib/dash-cache.js`);
  try {
    C.writeDashCache('/economics?bot=tarot', '<p>old</p>');
    C.refreshAnalyticsSection('/economics?bot=tarot');           // شروع می‌شود
    const note = C.cachedAnalyticsBody('/economics?bot=tarot');
    ok(note.includes('در حال آماده‌سازی'), 'ساختِ در جریان در یادداشتِ تازگی دیده می‌شود (نه فقط صف‌شده‌ها)');
    C.cachedAnalyticsBody('/acquisition?bot=tarot');             // خودکار، صف
    C.cachedAnalyticsBody('/funnels?bot=tarot');                 // خودکار، صف
    C.refreshAnalyticsSection('/retention?bot=tarot');           // دستی ⟵ جلوی صف
    C.refreshAnalyticsSection('/economics?bot=tarot');           // همین الان در حالِ ساخت ⟵ نادیده
    C.cachedAnalyticsBody('/screens?bot=fail');                  // خطا می‌دهد
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const n = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0;
      if (n >= 5) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => setTimeout(r, 400));
    const order = (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []).map(u => u.split('?')[0]);
    ok(JSON.stringify(order) === JSON.stringify(['/economics', '/retention', '/acquisition', '/funnels', '/screens']),
      `کلیکِ دستی جلوی ساخت‌های خودکار اجرا شد و ساختِ در جریان تکرار نشد (ترتیب: ${order.join(' ⟵ ')})`);
    ok(errLines.some(l => l.includes('boom') && l.includes('/screens?bot=fail')),
      'stderrِ worker با نامِ صفحه به لاگِ داشبورد رسید (قبلاً با stdio:ignore دور ریخته می‌شد)');
  } finally {
    console.error = origErr;
  }
  const cacheSrc = readFileSync(path.join(base, 'lib/dash-cache.js'), 'utf8');
  ok(/build exceeded 3 minutes[^`]*\$\{url\}/.test(cacheSrc), 'پیامِ کشته‌شدن در سقفِ زمان نامِ صفحه را دارد');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
