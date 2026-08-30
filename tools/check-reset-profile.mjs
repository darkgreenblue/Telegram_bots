// چکِ CI برای /resetprofile — ریستِ مشخصاتِ یک کاربر به‌دستِ ادمین (tarot).
//
// چرا این فایل وجود دارد: این تنها مسیرِ ربات است که ادمین می‌تواند دیتای **یک کاربرِ
// دیگر** را پاک کند. دو چیز اگر بشکند بی‌صدا می‌شکند و گران است:
//   ۱) دامنه گشاد شود و موجودی یا پرداخت یا دعوت هم پاک شود (بند ۹ ریشه: پول مقدس است).
//   ۲) گاردِ ادمین جا بیفتد، یعنی هر کاربری بتواند دیتای هر کاربرِ دیگری را پاک کند.
// هیچ‌کدام در تستِ دستی دیده نمی‌شوند، پس این‌جا اجرا می‌شوند.
//
// SQL از **خودِ index.js** بریده و روی SQLite واقعیِ در-حافظه اجرا می‌شود، نه کپی‌برداری.
import { readFileSync } from 'fs';
// روی جابِ tarot اجرا می‌شود، پس better-sqlite3 از همان‌جا می‌آید (الگوی check-reading-resume).
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» در index.js پیدا نشد`); return null; }
  return m[2];
}

/** بدنه‌ی یک هندلر را از سورس می‌بُرد (از نشانه‌ی شروع تا اولین خطِ سطحِ صفرِ بعدی).
 *  عمداً با رشته‌ی ساده کار می‌کند نه رجکسِ پیچیده: نسخه‌ی اولش `(\d+)` را در الگو حساب
 *  نکرده بود و چهار ادعا به‌جای سنجشِ کد، **خودشان** قرمز شدند. */
function bodyOf(marker) {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const end = SRC.indexOf('\n});', from);
  return end < 0 ? null : SRC.slice(from, end);
}

console.log('\n🧹 ریستِ مشخصات (/resetprofile)\n');

/* ── ۱) خودِ SQL: چه چیزی پاک می‌شود و مهم‌تر، چه چیزی نباید پاک شود ────────── */
const sql = sqlOf('resetProfile');
if (sql) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      telegram_id INTEGER PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '',
      birth_month INTEGER NOT NULL DEFAULT 0, memory_json TEXT NOT NULL DEFAULT '',
      welcomed INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'new',
      session_json TEXT NOT NULL DEFAULT '', balance INTEGER NOT NULL DEFAULT 0,
      welcome_bonus_at INTEGER, joined_gate_at INTEGER, daily_streak INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, status TEXT);
    CREATE TABLE referrals (id INTEGER PRIMARY KEY, referrer_id INTEGER, referee_id INTEGER, rewarded INTEGER);
  `);
  // کاربرِ هدف: دقیقاً شبیه کاربرِ واقعیِ تیکت (اسم و ماهِ تولدِ اشتباه، موجودی و سابقه دارد)
  db.prepare(`INSERT INTO users (telegram_id, display_name, birth_month, memory_json, welcomed,
    state, session_json, balance, welcome_bonus_at, joined_gate_at, daily_streak)
    VALUES (8186025542,'پانیذ',9,'{"note":"چیزی که مدل یاد گرفته"}',1,'idle','{"x":1}',12,1787737213,1787737210,4)`).run();
  // کاربرِ کناری: هیچ‌وقت نباید لمس شود
  db.prepare(`INSERT INTO users (telegram_id, display_name, birth_month, balance, welcomed)
    VALUES (999,'همسایه',3,77,1)`).run();
  db.prepare('INSERT INTO readings VALUES (1,8186025542,?)').run('delivered');
  db.prepare('INSERT INTO payments VALUES (1,8186025542,150000,?)').run('approved');
  db.prepare('INSERT INTO referrals VALUES (1,8186025542,555,1)').run();

  db.prepare(sql).run(8186025542);
  const u = db.prepare('SELECT * FROM users WHERE telegram_id=8186025542').get();
  const other = db.prepare('SELECT * FROM users WHERE telegram_id=999').get();

  console.log('  — چیزی که باید پاک شود:');
  ok(u.display_name === '', 'نام پاک شد');
  ok(u.birth_month === 0, 'ماه تولد پاک شد');
  ok(u.memory_json === '', 'حافظه پاک شد');
  ok(u.session_json === '', 'سشن پاک شد');

  console.log('  — چیزی که باید کاربر را به آنبوردینگ برگرداند:');
  // بدونِ welcomed=0 کاربر با /start به شاخه‌ی «کاربر برگشتی» می‌رود، استیتش idle می‌شود و
  // با نامِ خالی گیر می‌کند: یک بن‌بستِ تازه به‌جای رفعِ بن‌بستِ قبلی (بند ۹ب).
  ok(u.welcomed === 0, 'welcomed صفر شد (پس /start دوباره آنبورد می‌کند)');
  ok(u.state === 'onboard_name', "استیت روی onboard_name رفت (هر متنی که بفرستد نامش ثبت می‌شود)");

  console.log('  — 💰 چیزی که هرگز نباید لمس شود:');
  ok(u.balance === 12, 'موجودی دست‌نخورده ماند (تصمیمِ صریحِ مالک)');
  ok(u.welcome_bonus_at === 1787737213, 'welcome_bonus_at ماند، پس هدیه‌ی دوم داده نمی‌شود');
  ok(db.prepare('SELECT COUNT(*) c FROM readings').get().c === 1, 'فال‌ها پاک نشدند');
  ok(db.prepare('SELECT COUNT(*) c FROM payments').get().c === 1, 'پرداخت‌ها پاک نشدند (درآمد جعل نمی‌شود)');
  // پاک‌کردنِ دعوت‌ها یا فال‌ها می‌تواند پاداشِ دعوت را **دوباره** واریز کند، چون شرطش
  // countDelivered === 1 است. یعنی یک ریستِ به‌ظاهر بی‌ضرر، پولِ واقعی خرج می‌کند.
  ok(db.prepare('SELECT COUNT(*) c FROM referrals').get().c === 1, 'دعوت‌ها پاک نشدند (ضدِ پرداختِ دوباره‌ی پاداش)');

  console.log('  — همسایه:');
  ok(other.display_name === 'همسایه' && other.balance === 77 && other.birth_month === 3,
    'کاربرِ دیگر اصلاً لمس نشد');

  console.log('  — شکلِ خودِ دستور:');
  ok((sql.match(/UPDATE\s+users/gi) || []).length === 1,
    'یک UPDATE اتمیک است (کاربر در حالتِ نیمه‌ریست گیر نمی‌کند)');
  ok(!/\bbalance\b/i.test(sql), 'کلمه‌ی balance اصلاً در دستور نیست');
  ok(/WHERE\s+telegram_id\s*=\s*\?/i.test(sql), 'دامنه با telegram_id محدود شده (نه UPDATE بی‌شرط)');
  db.close();
}

/* ── ۲) گاردِ ادمین در هر دو سرِ مسیر ──────────────────────────────────────── */
console.log('\n  — گاردِ ادمین:');
const cmd = bodyOf("bot.command('resetprofile'");
const act = bodyOf('bot.action(/^rprof:');
ok(!!cmd, 'دستورِ /resetprofile پیدا شد');
ok(!!act, 'هندلرِ تأییدِ rprof: پیدا شد');
ok(cmd ? /isAdmin\(ctx\.from\.id\)/.test(cmd) : false, 'خودِ دستور پشتِ isAdmin است');
// دکمه در چتِ ادمین می‌ماند و callback ها سال‌ها زنده‌اند؛ گاردِ دوم اجباری است (بند ۲ج/۶)
ok(act ? /isAdmin\(ctx\.from\.id\)/.test(act) : false, 'هندلرِ تأیید هم مستقلاً isAdmin دارد');

/* ── ۳) تأیید دو مرحله‌ای: خودِ دستور نباید چیزی پاک کند ────────────────────── */
console.log('\n  — تأیید دو مرحله‌ای:');
// یک آی‌دیِ اشتباه‌تایپ‌شده نباید مستقیم به حذف برسد؛ همان الگوی cardsms → cardrev.
ok(cmd ? !/resetProfile\.run/.test(cmd) : false, 'دستور خودش ریست نمی‌کند، فقط تأیید می‌خواهد');
ok(act ? /stmts\.resetProfile\.run/.test(act) : false, 'ریست فقط بعد از تپِ تأیید اجرا می‌شود');
ok(cmd ? /rprof:\$\{target\}/.test(cmd) : false, 'دکمه‌ی تأیید همان uid را حمل می‌کند (نه state)');
ok(act ? /telegram\.sendMessage\(target/.test(act) : false, 'به خودِ کاربر خبر داده می‌شود');

/* ── ۴) پیامِ هدیه نباید دروغ بگوید ────────────────────────────────────────── */
console.log('\n  — پیامِ هدیه بعد از ریست:');
// welcome_bonus_at ماندگار است، پس grantWelcomeBonus برای کاربرِ ریست‌شده false می‌دهد.
// اگر پیامِ هدیه بی‌قید برود، ربات می‌گوید «۵ الماس اضافه شد» بدونِ اینکه چیزی اضافه شود.
const onb = bodyOf('async function startOnboarding(ctx, uid) {');
ok(!!onb, 'startOnboarding پیدا شد');
ok(onb ? /const granted = grantWelcomeBonus\(uid\)/.test(onb) : false,
  'نتیجه‌ی grantWelcomeBonus خوانده می‌شود (دور ریخته نمی‌شود)');
ok(onb ? /if \(granted\) \{[\s\S]*?welcomeGift/.test(onb) : false,
  'پیامِ هدیه فقط وقتی می‌رود که هدیه واقعاً واریز شده باشد');

console.log(`\n${fail ? '❌' : '✅'} ریستِ مشخصات: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
