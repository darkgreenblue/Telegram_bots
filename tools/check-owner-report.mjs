// چکِ CI برای «📊 گزارشِ شبانه‌ی مالک» (v3.140.0 تاروت، خواسته‌ی مالک ۱۴۰۵/۰۷/۰۹).
//
// سه چیز که این‌جا قفل می‌شود:
//   ۱) **عددها درست‌اند**: روی یک دیتابیسِ ساختگی با جوابِ از پیش معلوم (ادمین، روزِ دیگر، فالِ
//      رایگان/تحویل‌نشده، کاربرِ تستی) که هر کدام دقیقاً یک تله است.
//   ۲) **سود از همان تک‌منبعِ داشبورد می‌آید** (`profitFor`)؛ عددِ گزارش با خودِ آن مقایسه می‌شود.
//   ۳) **سریع است** (خواسته‌ی صریحِ مالک): پلنِ هر کوئری روی ایندکسِ پوششی و برشِ همان روز، و زمانِ
//      کلِ ساخت روی دیتابیسِ بزرگ زیرِ سقف. ایندکس‌ها از **خودِ سورسِ ربات** استخراج می‌شوند، پس اگر
//      کسی ایندکس را از بوتِ ربات بردارد، پلن این‌جا قرمز می‌شود نه روی سرورِ دیسک‌محدود.
// به‌علاوه‌ی تحویل: صفِ `admin_actions` یک بار per روز، و sendِ ربات فقط به OWNER_ID با سه تلاش.
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

/* --part=bot فقط ادعاهای سمتِ ربات را می‌سنجد (ایندکس‌های بوت + sweep/ارسال)، بدونِ better-sqlite3ِ
 * داشبورد. لازم است چون ci-changed-bots یک تغییرِ صرفاً `bots/tarot/` را فقط به جابِ tarot می‌برد؛
 * بدونِ این، حذفِ ایندکس یا شاخه‌ی sweep از بوتِ ربات از CI سبز رد می‌شد (الگوی check-dash-speed). */
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '--part=all').slice(7);
if (!['all', 'bot'].includes(PART)) { console.error(`❌ --part نامعتبر: ${PART}`); process.exit(1); }
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const BOT_SRC = readFileSync('bots/tarot/index.js', 'utf8');
const BOT_CODE = BOT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const JOURNEY_SRC = readFileSync('shared/journey.js', 'utf8');

// ایندکس‌های واقعیِ بوتِ ربات (همان حلقه‌ی DASH_INDEX) + ایندکسِ جزئیِ ادمینِ جرنی.
const botIdx = [...BOT_SRC.matchAll(/\['(idx_[a-z_]+)', '(CREATE INDEX IF NOT EXISTS [^']+)'\]/g)].map((m) => [m[1], m[2]]);
const admIdx = (JOURNEY_SRC.match(/"(CREATE INDEX IF NOT EXISTS idx_events_adm[^"]+)"/) || [])[1];
const need = ['idx_readings_stats', 'idx_events_ev_user', 'idx_users_created', 'idx_chat_role_day'];
ok(need.every((n) => botIdx.some(([k]) => k === n)) && !!admIdx, `ایندکس‌های لازم در بوتِ ربات ساخته می‌شوند (${need.join('، ')} + idx_events_adm)`);

const done = () => { console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`); process.exit(fail ? 1 : 0); };

console.log('\n▶ ۰) سمتِ ربات: فقط به مالک، سه تلاش، شکستِ بی‌صدا نه');
{
  ok(/else if \(act\.action === 'owner_report'\) \{\s*await sendOwnerReport\(act\);/.test(BOT_CODE), 'sweepِ ربات اکشنِ owner_report را به sendOwnerReport می‌دهد');
  const a = BOT_SRC.indexOf('async function sendOwnerReport(act) {');
  const fn = a >= 0 ? BOT_SRC.slice(a, BOT_SRC.indexOf('\n}\n', a) + 2) : '';
  ok(/sendMessage\(OWNER_ID, text/.test(fn) && !/ADMIN_IDS|forEach|for \(const id/.test(fn), 'فقط به OWNER_ID (نه ادمین‌های دیگر، نه هیچ کاربری)');
  const run = async (fails) => {
    const sent = [], logs = [], errs = [];
    let n = 0;
    const bot = { telegram: { sendMessage: async (to, t) => { n++; if (n <= fails) throw new Error('ETIMEDOUT'); sent.push({ to, t }); } } };
    const f = new Function('bot', 'OWNER_ID', 'sleep', 'log', 'logErr', `${fn}\nreturn sendOwnerReport;`)(
      bot, 100257975, async () => {}, (...x) => logs.push(x.join(' ')), (...x) => errs.push(x.join(' ')));
    await f({ id: 5, note: 'REPORT' });
    return { sent, logs, errs, n };
  };
  const okRun = await run(0);
  ok(okRun.sent.length === 1 && okRun.sent[0].to === 100257975 && okRun.sent[0].t === 'REPORT' && okRun.logs.some((l) => /OWNER_REPORT_SENT/.test(l)),
    'ارسالِ موفق به مالک + مارکرِ OWNER_REPORT_SENT');
  const retry = await run(2);
  ok(retry.sent.length === 1 && retry.n === 3, 'دو خطای گذرا ⟵ تلاشِ سوم می‌رسد');
  const dead = await run(5);
  ok(dead.sent.length === 0 && dead.n === 3 && dead.errs.some((l) => /OWNER_REPORT_SEND/.test(l)), 'سه شکست ⟵ مارکرِ ❌ OWNER_REPORT_SEND، بدونِ حلقه‌ی بی‌پایان');
  const empty = await (async () => {
    const errs = [];
    const f = new Function('bot', 'OWNER_ID', 'sleep', 'log', 'logErr', `${fn}\nreturn sendOwnerReport;`)(
      { telegram: { sendMessage: async () => { throw new Error('should not send'); } } }, 1, async () => {}, () => {}, (...x) => errs.push(x.join(' ')));
    await f({ id: 6, note: '' });
    return errs;
  })();
  ok(empty.some((l) => /OWNER_REPORT_EMPTY/.test(l)), 'متنِ خالی ⟵ ارسال نمی‌شود و مارکر می‌گذارد');
}

if (PART === 'bot') done();

const Database = createRequire(path.resolve('bots/dashboard/package.json'))('better-sqlite3');
const root = mkdtempSync(path.join(tmpdir(), 'owner-report-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.join(root, 'data'), { recursive: true });
const file = path.join(dataDir, 'bot-fa.db');
const SCHEMA = `
CREATE TABLE users(telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', session_json TEXT DEFAULT '',
  first_source TEXT DEFAULT '', first_payload TEXT DEFAULT '', first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
CREATE TABLE events(id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
CREATE TABLE readings(id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT DEFAULT 'three', price INTEGER DEFAULT 3,
  llm_json TEXT DEFAULT '', feedback TEXT DEFAULT '', status TEXT DEFAULT 'delivered', created_at INTEGER);
CREATE TABLE chat_messages(id INTEGER PRIMARY KEY, reading_id INTEGER, user_id INTEGER, role TEXT, text TEXT DEFAULT '',
  price INTEGER DEFAULT 0, refunded INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE payments(id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, original_amount INTEGER, pkg TEXT,
  status TEXT, step TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER, approved_at INTEGER);
CREATE TABLE llm_usage(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, cost_usd REAL, created_at INTEGER);
CREATE TABLE admin_actions(id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL, action TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'dashboard', created_at INTEGER NOT NULL DEFAULT (unixepoch()), done_at INTEGER,
  user_id INTEGER, amount INTEGER, ref_id INTEGER, note TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_payments_status_approved ON payments(status, approved_at);
CREATE INDEX idx_llm_usage_created ON llm_usage(created_at);
`;

// «دیروز» نسبت به الان (همان چیزی که گزارشِ ۰۰:۰۰ می‌سازد)، با مرزِ تهران.
const T_OFF = 12600, D = 86400;
const today0 = Math.floor((Math.floor(Date.now() / 1000) + T_OFF) / D) * D - T_OFF;
const Y0 = today0 - D;
const y = (h) => Y0 + h * 3600;            // ساعتِ h دیروز
const ADMIN = 777, TEST = 100257975;        // TEST در testUsersِ رجیستری است (درآمدش حذف)

const db = new Database(file);
db.exec(SCHEMA);
for (const [, sql] of botIdx) db.exec(sql);
db.exec(admIdx);
const U = db.prepare('INSERT INTO users(telegram_id, first_source, session_json, created_at) VALUES (?,?,?,?)');
const E = db.prepare('INSERT INTO events(user_id, event, props, created_at) VALUES (?,?,?,?)');
const R = db.prepare('INSERT INTO readings(user_id, price, status, llm_json, created_at) VALUES (?,?,?,?,?)');
const C = db.prepare("INSERT INTO chat_messages(reading_id, user_id, role, text, created_at) VALUES (1,?,?,?,?)");
const P = db.prepare("INSERT INTO payments(user_id, amount, status, created_at, approved_at) VALUES (?,?,'approved',?,?)");
const L = db.prepare('INSERT INTO llm_usage(user_id, kind, cost_usd, created_at) VALUES (?,?,?,?)');
/* جوابِ از پیش معلومِ «دیروز»:
 *   کاربرانِ قدیمی ۱، ۲، ۳ (دیروز کار کردند) + کاربرِ ۴ قدیمی که فقط امروز آمد (نباید بیاید)
 *   کاربرانِ تازه‌ی دیروز ۱۰، ۱۱ (۱۱ هیچ act ندارد ولی تازه است ⟵ فعال حساب می‌شود)
 *   ادمین ۷۷۷: تازه‌ی دیروز، act، فال، گفتگو ⟵ از همه حذف
 *   ⟵ فعال ۵ (۱،۲،۳،۱۰،۱۱)، نیو ۲، ریتنشن ۳
 *   فال: ۱ (دو فال، یکی شمرده)، ۲، ۱۰ ⟵ ۳ نفر؛ نیو ۱ (۱۰)، ریتنشن ۲.  فالِ رایگانِ ۳ و فالِ نیمه‌کاره‌ی ۱۱ نه.
 *   گفتگو: ۱ دو سؤال، ۱۰ سه سؤال (+ جوابِ assistant که شمرده نمی‌شود) ⟵ ۲ کاربر، ۵ سؤال، میانگین ۲٫۵ */
for (const id of [1, 2, 3, 4]) U.run(id, 'organic', 'x'.repeat(3000), Y0 - 30 * D);
U.run(10, 'organic', '', y(9)); U.run(11, 'campaign:AB', '', y(20)); U.run(ADMIN, 'organic', '', y(8));
for (const [u, h] of [[1, 1], [1, 5], [2, 23.9], [3, 12], [10, 9.1], [ADMIN, 8.5]]) E.run(u, 'act', '{}', y(h));
E.run(ADMIN, 'view', JSON.stringify({ adm: 1 }), y(8.6));
E.run(4, 'act', '{}', today0 + 60);           // امروز
E.run(3, 'act', '{}', Y0 - 60);               // پریروز
R.run(1, 3, 'delivered', 'L'.repeat(5000), y(2)); R.run(1, 5, 'delivered', 'L', y(6));
R.run(2, 3, 'delivered', 'L', y(10)); R.run(10, 3, 'delivered', 'L', y(11));
R.run(3, 0, 'delivered', 'L', y(12));         // رایگان ⟵ نه
R.run(11, 3, 'started', 'L', y(21));          // تحویل‌نشده ⟵ نه
R.run(ADMIN, 3, 'delivered', 'L', y(9));      // ادمین ⟵ نه
R.run(2, 3, 'delivered', 'L', today0 + 100);  // امروز ⟵ نه
for (const h of [3, 4]) C.run(1, 'user', 'q', y(h));
for (const h of [12, 13, 14]) C.run(10, 'user', 'q', y(h));
C.run(10, 'assistant', 'a', y(12.1)); C.run(ADMIN, 'user', 'q', y(9)); C.run(1, 'user', 'q', today0 + 10);
// پول: دیروز ۱۰۰٬۰۰۰ + ۶۰٬۰۰۰ درآمدِ واقعی، ۱۵۰٬۰۰۰ از حسابِ تستی (حذف)، و $0.50 هزینه‌ی مدل.
P.run(1, 100000, y(3), y(3.1)); P.run(2, 60000, y(15), y(15.2)); P.run(TEST, 150000, y(16), y(16.1));
P.run(3, 90000, today0 + 200, today0 + 300);  // امروز ⟵ نه
L.run(1, 'reading', 0.3, y(2)); L.run(10, 'reading', 0.2, y(11));
db.close();

process.chdir(root);
process.env.TAROT_DB_DIR = dataDir;
const base = path.resolve(import.meta.dirname, '../bots/dashboard');
const OR = await import(`file://${base}/lib/owner-report.js`);
const { profitFor } = await import(`file://${base}/lib/profit.js`);
const { setSetting, getSetting } = await import(`file://${base}/lib/platform.js`);

console.log('\n📊 گزارشِ شبانه‌ی مالک\n');
console.log('▶ ۱) عددها روی فیکسچرِ با جوابِ معلوم');
const RATE = 100_000;
setSetting('usd_toman', String(RATE));
{
  const rep = OR.buildOwnerReport(Y0);
  const c = rep.counts;
  ok(c.active === 5 && c.newUsers === 2 && c.retention === 3,
    `فعال ۵، نیو ۲، ریتنشن ۳ (ادمین، امروز و پریروز بیرون؛ تازه‌ی بی‌act هم فعال) — شد ${c.active}/${c.newUsers}/${c.retention}`);
  ok(c.readers === 3 && c.newReaders === 1 && c.retentionReaders === 2,
    `فال‌گرفته ۳ (نیو ۱، ریتنشن ۲)؛ رایگان/نیمه‌کاره/ادمین/امروز بیرون — شد ${c.readers}/${c.newReaders}/${c.retentionReaders}`);
  ok(c.chatUsers === 2 && c.questions === 5 && c.avgQuestions === 2.5,
    `گفتگو: ۲ کاربر، ۵ سؤال، میانگین ۲٫۵ (جوابِ تاروت‌خوان و ادمین نه) — شد ${c.chatUsers}/${c.questions}/${c.avgQuestions}`);
  ok(rep.money.rev === 160000 && rep.money.cost === 50000 && rep.money.net === 110000,
    `پول: درآمد ۱۶۰٬۰۰۰ (بدونِ حسابِ تستی)، هزینه ۵۰٬۰۰۰ ($0.50 × نرخ)، سود ۱۱۰٬۰۰۰ — شد ${rep.money.rev}/${rep.money.cost}/${rep.money.net}`);
  const pf = profitFor('tarot', 'week').series.find((s) => s.d === rep.day);
  ok(pf && pf.rev === rep.money.rev && pf.costToman === rep.money.cost && pf.net === rep.money.net,
    'پول دقیقاً همان سطرِ همان روز در profitForِ داشبورد است (تک‌منبع)');
  const LABELS = ['📊 گزارشِ روزِ', 'تاروت فارسی', '💰 سود خالص:', '📥 درآمد:', '📤 هزینه:', '👥 کاربر فعال (به ربات اومدن):',
    '🆕 نیو یوزر:', '🔁 ریتنشن یوزر:', '🔮 کل فال‌گرفته‌ها:', '🆕 نیو یوزرِ فال‌گرفته:', '🔁 ریتنشن یوزرِ فال‌گرفته:',
    '💬 کاربرانِ گفتگو با تاروت‌خوان:', '❓ کل سؤال‌ها از تاروت‌خوان:', '📈 میانگین سؤال به ازای هر کاربر:'];
  let at = -1, inOrder = true;
  for (const l of LABELS) { const i = rep.text.indexOf(l); if (i <= at) inOrder = false; at = i; }
  ok(inOrder, 'همه‌ی سطرهای خواسته‌شده به همان ترتیب در متن‌اند');
  ok(rep.text.includes('💰 سود خالص: ۱۱۰٬۰۰۰ تومان') && rep.text.includes('📈 میانگین سؤال به ازای هر کاربر: ۲٫۵')
    && rep.text.includes('👥 کاربر فعال (به ربات اومدن): ۵'), 'اعداد با رقمِ فارسی و جداکننده‌ی هزارگان');
  ok(rep.text.length < 4096 && !/—/.test(rep.text), 'زیرِ سقفِ پیامِ تلگرام و بدونِ «—»');
}
{
  setSetting('usd_toman', '0');
  const rep = OR.buildOwnerReport(Y0);
  ok(!rep.text.includes('سود خالص') && rep.text.includes('نرخِ دلار در داشبورد ثبت نشده') && rep.text.includes('📥 درآمد: ۱۶۰٬۰۰۰'),
    'بدونِ نرخِ دلار: درآمد می‌آید، و به‌جای سودِ دروغین یک خطِ صادقانه');
  setSetting('usd_toman', String(RATE));
}

console.log('\n▶ ۲) تحویل: یک بار per روز، از صفِ همان ربات');
{
  const q = () => { const d = new Database(file, { readonly: true }); try { return d.prepare("SELECT * FROM admin_actions WHERE action='owner_report'").all(); } finally { d.close(); } };
  setSetting('owner_report_last_day', '');
  const r1 = OR.runOwnerReport();
  const r2 = OR.runOwnerReport();
  const rowsQ = q();
  ok(r1 && rowsQ.length === 1 && rowsQ[0].note === r1.text && rowsQ[0].payment_id === 0 && rowsQ[0].done_at === null,
    'اولین اجرا دقیقاً یک ردیفِ owner_report با همان متن صف می‌کند (payment_id=0، قفلِ پول را نمی‌گیرد)');
  ok(r2 === null && rowsQ.length === 1, 'اجرای دوم همان روز هیچ چیز صف نمی‌کند (idempotent)');
  ok(getSetting('owner_report_last_day', '') === r1.day, 'مهرِ روز بعد از صف‌شدن زده شد');
  const src = readFileSync(`${base}/lib/owner-report.js`, 'utf8');
  const g = src.indexOf('adminActionSupported(inst.bot, OWNER_REPORT_ACTION)'), ins = src.indexOf('INSERT INTO admin_actions');
  ok(g > 0 && ins > g, 'گاردِ قرارداد (adminActionSupported) قبل از نوشتن در صف');
  const setAt = src.indexOf('setSetting(LAST_KEY, day)'), enqAt = src.indexOf('if (!enqueueOwnerReport(rep.text))');
  ok(enqAt > 0 && setAt > enqAt, 'مهرِ روز فقط بعد از صفِ موفق (شکست گزارشِ آن شب را بی‌صدا حذف نمی‌کند)');
  const reg = readFileSync(`${base}/lib/bots.js`, 'utf8');
  ok((reg.match(/'receipt_tag', 'owner_report'\]/g) || []).length === 2, 'اکشن در رجیستریِ هر دو نمونه‌ی تاروت اعلام شده');
  ok(/scheduleOwnerReport\(\);/.test(readFileSync(`${base}/index.js`, 'utf8')), 'زمان‌بند در بوتِ داشبورد روشن است');
}

console.log('\n▶ ۳) سرعت: پلنِ هر کوئری روی ایندکس و برشِ همان روز');
{
  const d = new Database(file, { readonly: true });
  const plan = (sql, p) => d.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map((r) => r.detail).join(' | ');
  const S = OR.DAY_SQL;
  const cases = [
    ['acted', S.acted, /COVERING INDEX idx_events_ev_user \(event=\? AND created_at>\? AND created_at<\?\)/],
    ['joined', S.joined, /COVERING INDEX idx_users_created \(created_at>\? AND created_at<\?\)/],
    ['readers', S.readers, /COVERING INDEX idx_readings_stats/],
    ['asked', S.asked, /COVERING INDEX idx_chat_role_day \(role=\? AND created_at>\? AND created_at<\?\)/],
    ['admins', S.admins, /idx_events_adm/],
  ];
  for (const [k, sql, re] of cases) {
    const pl = plan(sql, k === 'admins' ? [] : [Y0, today0]);
    ok(re.test(pl) && !/SCAN (users|events|readings|chat_messages)(?! USING)/.test(pl), `${k}: ${pl}`);
  }
  // کوئریِ کاربرِ کمپینِ سودِ داشبورد هم دیگر اسکنِ کاملِ users نیست.
  const camp = plan("SELECT telegram_id AS uid, created_at AS t FROM users WHERE created_at >= ? AND first_source LIKE 'campaign:%'", [0]);
  ok(/COVERING INDEX idx_users_created/.test(camp), `کاربرانِ کمپینِ سود: ${camp}`);
  d.close();
}

console.log('\n▶ ۴) سرعت: کلِ گزارش روی دیتابیسِ بزرگ');
{
  const d = new Database(file);
  const e = d.prepare('INSERT INTO events(user_id, event, props, created_at) VALUES (?,?,?,?)');
  const u = d.prepare('INSERT INTO users(telegram_id, first_source, session_json, created_at) VALUES (?,?,?,?)');
  const r = d.prepare('INSERT INTO readings(user_id, price, status, llm_json, created_at) VALUES (?,?,?,?,?)');
  const c = d.prepare("INSERT INTO chat_messages(reading_id, user_id, role, text, created_at) VALUES (1,?,?,?,?)");
  const big = 'x'.repeat(4000);
  d.transaction(() => {
    for (let i = 0; i < 30_000; i++) u.run(10_000 + i, i % 5 ? 'organic' : 'campaign:AB', big.slice(0, 1500), Y0 - (i % 200) * D);
    for (let i = 0; i < 300_000; i++) e.run(10_000 + (i % 30_000), i % 3 ? 'view' : 'act', '{}', Y0 - (i % 120) * D + (i % 86_000));
    for (let i = 0; i < 40_000; i++) r.run(10_000 + (i % 30_000), 3, 'delivered', big, Y0 - (i % 150) * D + (i % 86_000));
    for (let i = 0; i < 60_000; i++) c.run(10_000 + (i % 30_000), i % 2 ? 'user' : 'assistant', big.slice(0, 800), Y0 - (i % 90) * D + (i % 86_000));
  })();
  d.close();
  const t0 = process.hrtime.bigint();
  const rep = OR.buildOwnerReport(Y0);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ℹ️ ۳۰ هزار کاربر، ۳۰۰ هزار رویداد، ۴۰ هزار فال، ۶۰ هزار پیامِ گفتگو: ساختِ کلِ گزارش ${ms.toFixed(0)}ms`);
  ok(rep.counts.active > 5 && ms < 3000, `ساختِ کلِ گزارش (با سودِ داشبورد) زیرِ ۳ ثانیه: ${ms.toFixed(0)}ms`);
}

done();
