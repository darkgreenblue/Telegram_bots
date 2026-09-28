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
//   ▶ ۵ دیسک (دورِ دوم، بعد از دیپلوی): ایندکسِ ادمین کافی نبود و `/dash` روی سرور هنوز به
//     سقف می‌خورد، چون سرور **دیسک‌محدود** است (~۱۵MB/s) و `status`/`created_at` در
//     `readings` بعد از `llm_json`ِ حجیم‌اند؛ هر خواندنشان یعنی خواندنِ صفحه‌های overflowِ
//     همان فال. درمان دو ایندکسِ پوششی در بوتِ تاروت است به‌علاوه‌ی بازنویسیِ
//     `costPerDiamond`. این بخش **تعریفِ ایندکس‌ها و DDLِ جدول‌ها را از خودِ
//     `bots/tarot/index.js` می‌خواند** (ترتیبِ ستون همان چیزی است که باگ را ساخت، پس کپیِ
//     دستی‌اش خودِ باگ را پنهان می‌کرد)، هم‌ارزیِ خروجی را می‌سنجد، و برای هر ادعای طرحِ
//     کوئری یک کنترلِ مثبت دارد: همان SQL بدونِ ایندکس، و SQLِ قبلی با ایندکس، هر دو هنوز
//     ردیفِ کامل را می‌خوانند.
//
// اجرا: node tools/check-dash-speed.mjs   (بدون شبکه؛ فیکسچر در پوشه‌ی موقت)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

/* --part=bot فقط ادعاهای ساختاریِ بخشِ ۵ را روی سورسِ ربات می‌سنجد، بدونِ better-sqlite3ِ
 * داشبورد. لازم است چون ci-changed-bots یک تغییرِ صرفاً `bots/tarot/` را فقط به جابِ tarot
 * می‌برد؛ بدونِ این، جابه‌جا شدنِ ایندکس‌ها به بعد از launch (یا حذفشان) از CI سبز رد می‌شد. */
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '--part=all').slice(7);
if (!['all', 'bot'].includes(PART)) { console.error(`❌ --part نامعتبر: ${PART}`); process.exit(1); }

/* از خودِ سورسِ ربات: DDLِ دو جدول (با ترتیبِ واقعیِ ستون‌ها) و تعریفِ ایندکس‌های داشبورد */
const tarotSrc = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
const ddlOf = (t) => (tarotSrc.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\n  \\);`)) || [])[0];
const READINGS_DDL = ddlOf('readings');
const LLM_USAGE_DDL = ddlOf('llm_usage');
const DASH_IDX = new Map([...tarotSrc.matchAll(/'(CREATE INDEX IF NOT EXISTS (idx_readings_stats|idx_events_ev_user) ON [^']+)'/g)]
  .map(m => [m[2], m[1]]));

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };
const done = () => {
  console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
  process.exit(errs.length ? 1 : 0);
};

/* ─ بخشِ ۵ الف) ساختاری: هر دو ایندکس در بوتِ ربات، بعد از جدول‌ها و قبل از launch، هر کدام در try ─ */
function structural() {
  ok(!!READINGS_DDL && !!LLM_USAGE_DDL, 'DDLِ readings و llm_usage از خودِ bots/tarot/index.js خوانده شد');
  ok(READINGS_DDL && READINGS_DDL.indexOf('llm_json') < READINGS_DDL.indexOf('status'),
    'فیکسچر همان ترتیبِ واقعی را دارد: status بعد از llm_json (همان چیزی که overflow را می‌سازد)');

  ok(DASH_IDX.size === 2, `هر دو ایندکس در سورسِ ربات تعریف شده‌اند (${[...DASH_IDX.keys()].join('، ')})`);
  ok(/ON readings\(status, user_id, created_at, price, type, feedback\)/.test(DASH_IDX.get('idx_readings_stats') || '')
    && /ON events\(event, created_at, user_id\)/.test(DASH_IDX.get('idx_events_ev_user') || ''),
    'ستون‌های ایندکس‌ها همان‌اند که کوئری‌های داشبورد و ربات را پوشش می‌دهند');
  const at = (s) => tarotSrc.indexOf(s);
  const idxAt = at('CREATE INDEX IF NOT EXISTS idx_readings_stats');
  // «قبل از launch» یعنی کدِ سطحِ ماژول، نه داخلِ یک تابع: گذاشتنش در onLaunched (که متنش
  // هم بالای bot.launch است) یعنی ساخت بعد از شروعِ polling و قفل‌شدنِ حلقه‌ی رویداد.
  const loopAt = tarotSrc.search(/\nfor \(const \[name, sql\] of \[\n  \['idx_readings_stats'/);
  ok(loopAt > 0 && loopAt < idxAt && at('CREATE TABLE IF NOT EXISTS readings') < loopAt
    && at('\nensureAnalytics(db);') < loopAt && loopAt < at('new Telegraf('),
    'ساخت در سطحِ ماژول، بعد از جدولِ readings و ensureAnalytics(events) و قبل از ساختِ ربات است (هرگز بعد از launch)');
  const loop = tarotSrc.slice(idxAt, tarotSrc.indexOf('\n}\n', idxAt));
  ok(/try \{[\s\S]*db\.exec\(sql\)[\s\S]*catch \(e\) \{ logErr\(`❌ DASH_INDEX/.test(loop),
    'هر ایندکس جدا داخلِ try است و شکستش فقط مارکرِ «❌ DASH_INDEX» می‌گذارد (بوتِ ربات نمی‌شکند)');
}

if (PART === 'bot') {
  console.log('▶ ۵ الف) ایندکس‌های پوششیِ داشبورد در بوتِ ربات (فقط ساختاری)');
  structural();
  done();
}

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
const base = path.resolve('bots/dashboard');


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
    // فال‌ها و هزینه‌ها (بخشِ ۵): llm_jsonِ حجیم تا ستون‌های بعدش واقعاً در overflow بیفتند،
    // هر وضعیت و هر اندازه، چند ردیفِ هزینه per فال، و هزینه‌هایی که به فالِ رایگان/ناتمام/
    // ناموجود یا هیچ فالی (ref_id=0) اشاره می‌کنند.
    if (READINGS_DDL && LLM_USAGE_DDL) {
      db.exec(READINGS_DDL); db.exec(LLM_USAGE_DDL);
      const ir = db.prepare('INSERT INTO readings (user_id, type, price, llm_json, feedback, status, created_at) VALUES (?,?,?,?,?,?,?)');
      const il = db.prepare('INSERT INTO llm_usage (user_id, kind, ref_id, cost_usd, created_at) VALUES (?,?,?,?,?)');
      for (let i = 0; i < 400; i++) {
        const u = rnd() < 0.03 ? ADMIN : uids[Math.floor(rnd() * uids.length)];
        const price = [0, 3, 5, 10][Math.floor(rnd() * 4)];
        const st = ['delivered', 'delivered', 'delivered', 'started', 'paid', 'canceled', 'refunded'][Math.floor(rnd() * 7)];
        const ts = now - Math.floor(rnd() * 60 * 86400);
        const rid = ir.run(u, 'open' + (price || 3), price, 'x'.repeat(3000 + Math.floor(rnd() * 3000)),
          ['', 'rate:' + (1 + Math.floor(rnd() * 5)), 'yes'][Math.floor(rnd() * 3)], st, ts).lastInsertRowid;
        const n = Math.floor(rnd() * 4); // ۰ تا ۳ ردیفِ هزینه (خوانش + تعمیر + رونویسی)
        for (let j = 0; j < n; j++) il.run(u, ['reading', 'repair', 'transcribe'][j], rid, Math.round(rnd() * 1e6) / 1e8, ts + j);
      }
      for (let i = 0; i < 60; i++) il.run(uids[i % uids.length], 'daily_card', 0, 0.0001 * (i + 1), now - i * 3600);
      il.run(uids[0], 'reading', 999999, 0.5, now); // فالی که وجود ندارد
    }
  })();
  db.close();
}
// نسخه‌ی بدونِ دو ایندکسِ تازه (برای کنترل‌های مثبت) و بعد ساختِ ایندکس‌ها با همان SQLِ ربات
const noIdxFile = path.join(root, 'noidx.db');
copyFileSync(file, noIdxFile);
{
  const db = new Database(file);
  for (const sql of DASH_IDX.values()) db.exec(sql);
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

console.log('\n▶ ۵) دیسک: ایندکس‌های پوششیِ ربات و بازنویسیِ costPerDiamond');
{
  structural();   // ─ الف) ساختاری، مشترک با --part=bot (بالا) ─

  const idx = new Database(file, { readonly: true });
  const raw = new Database(noIdxFile, { readonly: true });
  const planOf = (db, sql, params = []) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map(r => r.detail);

  // ─ ب) هم‌ارزیِ costPerDiamond: تابعِ واقعیِ داشبورد در برابرِ SQLِ قبلی، روی همان فیکسچر ─
  const OLD_CPD = `SELECT size, SUM(usd) AS usd, COUNT(*) AS readings, SUM(size) AS diamonds FROM (
      SELECT r.price AS size, r.id AS rid, SUM(l.cost_usd) AS usd
        FROM readings r JOIN llm_usage l ON l.ref_id = r.id
       WHERE r.status='delivered' AND r.price > 0 AND l.ref_id > 0
       GROUP BY r.id
    ) GROUP BY size ORDER BY size`;
  const C = await import(`file://${base}/lib/cpa.js`);
  captured.length = 0;
  const cpd = C.costPerDiamond('tarot');
  const newSql = captured.find(c => /FROM readings r JOIN u/.test(c.sql))?.sql;
  const fmt = (s) => `${s.size}|${s.readings}|${s.diamonds}|${Number(s.usd).toFixed(9)}`;
  const oldRows = idx.prepare(OLD_CPD).all().map(fmt);
  const newRows = cpd.sizes.map(fmt);
  ok(oldRows.length >= 3 && JSON.stringify(oldRows) === JSON.stringify(newRows),
    `costPerDiamond: ${newRows.length} اندازه، per اندازه تعدادِ فال و الماس و دلار عیناً برابرِ SQLِ قبلی`);
  // کنترلِ مثبت: فیکسچر واقعاً فالِ چندردیفه دارد، وگرنه «اول per فال جمع کن» سنجیده نمی‌شد
  const flat = idx.prepare(`SELECT COUNT(*) c FROM readings r JOIN llm_usage l ON l.ref_id = r.id
    WHERE r.status='delivered' AND r.price > 0`).get().c;
  ok(flat > cpd.readings, `کنترلِ مثبت: شمارشِ تخت (${flat}) از شمارشِ per فال (${cpd.readings}) بزرگ‌تر است`);

  // ─ ج) طرحِ کوئری: هر دو تغییر لازم‌اند، هیچ‌کدام به‌تنهایی کافی نیست ─
  const ROW = /SEARCH r USING INTEGER PRIMARY KEY/;
  const pNew = newSql ? planOf(idx, newSql).join(' | ') : '';
  ok(!!newSql && pNew.includes('COVERING INDEX idx_readings_stats') && !ROW.test(pNew),
    'SQLِ تازه با ایندکس: readings فقط از ایندکسِ پوششی خوانده می‌شود، نه ردیفِ کامل');
  ok(ROW.test(planOf(idx, OLD_CPD).join(' | ')),
    'کنترلِ مثبت: SQLِ قبلی **با همان ایندکس** هنوز per فال ردیفِ کامل را می‌خواند (بازنویسی لازم بود)');
  ok(!!newSql && ROW.test(planOf(raw, newSql).join(' | ')),
    'کنترلِ مثبت: SQLِ تازه **بدونِ ایندکس** هنوز ردیفِ کامل را می‌خواند (ایندکس لازم بود)');

  // ─ د) SQLهای واقعیِ سنجه‌های اصلی (lib/engage.js) هرگز ردیفِ کاملِ فال را نمی‌خوانند ─
  const E = await import(`file://${base}/lib/engage.js`);
  const qs = [
    ['کاربرِ فعال', E.activeUsersSql(now, 7, true)],
    ['خواننده', E.readerUsersSql(true, 0)],
    ['بازگشت', E.repeatUsersSql(true)],
    ['راضی', E.satisfiedUsersSql(true)],
    ['نمره‌دهنده', E.ratersUsersSql(true)],
    ['سطلِ عمق', E.bucketUsersSql(0, true)],
    ['ماندگاری D+7', E.retainedUsersSql(7, now, true)],
    ['کدنسِ خرج', E.spendCadenceSql(3, now, true)],
    ['کدنسِ مفید', E.usefulCadenceSql(3, now, true)],
  ];
  const rLines = (plan) => plan.filter(l => /^(SCAN|SEARCH) r\b/.test(l));
  const bad = qs.filter(([, q]) => {
    const lines = rLines(planOf(idx, q.sql, q.params));
    return !lines.length || lines.some(l => !l.includes('COVERING INDEX idx_readings_stats'));
  }).map(([n]) => n);
  ok(!bad.length, `هر ${qs.length} سنجه‌ی engage فقط از ایندکسِ پوششی می‌خوانند${bad.length ? ` (ناقص: ${bad.join('، ')})` : ''}`);
  const rawScans = qs.filter(([, q]) => rLines(planOf(raw, q.sql, q.params)).some(l => l === 'SCAN r')).length;
  ok(rawScans >= qs.length - 1, `کنترلِ مثبت: بدونِ ایندکس ${rawScans} از ${qs.length} سنجه کلِ جدولِ فال را اسکن می‌کردند`);

  // ─ ه) رویدادها: بخشِ events ِ کدنسِ مفید از ایندکسِ پوششیِ تازه، بدونِ خواندنِ ردیف ─
  const U = E.usefulCadenceSql(3, now, true);
  const eLine = (db) => planOf(db, U.sql, U.params).find(l => /^(SCAN|SEARCH) e\b/.test(l)) || '';
  ok(eLine(idx).includes('COVERING INDEX idx_events_ev_user'), `رویدادهای «اکشنِ مفید» فقط از ایندکسِ پوششی: ${eLine(idx)}`);
  ok(!eLine(raw).includes('COVERING'), `کنترلِ مثبت: بدونِ ایندکسِ تازه ردیفِ رویداد خوانده می‌شد: ${eLine(raw)}`);
  idx.close(); raw.close();
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

done();
