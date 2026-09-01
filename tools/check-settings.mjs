// چکِ CI برای منوی تنظیماتِ کاربر (tarot v3.38.0).
//
// چرا این فایل وجود دارد — سه چیز این‌جا می‌تواند **بی‌صدا** خراب شود:
//   ۱) «ریست حافظه» چیزی را واقعاً پاک کند. قاعده‌ی صریحِ مالک این است که هیچ‌چیز پاک
//      نشود، فقط از دسترسِ سیستم بیرون برود و برای خودمان قابلِ بازیابی بماند. حذفِ
//      readings علاوه بر آن، پاداشِ دعوت را **دوباره** واریز می‌کند (شرطِ countDelivered).
//   ۲) خطِ آبِ حافظه فقط روی کانتکستِ مدل بنشیند، نه روی منطقِ پاداش و آمار.
//   ۳) ردیفِ یادآوری‌ها وقتی آزمایشِ night_reminder فعال است دیده شود — که هم آزمایش را
//      آلوده می‌کند و هم می‌تواند دو پیام در ساعت ۲۲ بفرستد (درسِ v3.9.0).
//
// SQL و منطق از **خودِ index.js** بریده و اجرا می‌شوند، نه کپی‌برداری.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  return m[2];
}
function bodyOf(marker, end = '\n});') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n⚙️ منوی تنظیماتِ کاربر\n');

/* ══ ۱) ریستِ حافظه: بایگانی می‌کند، پاک نمی‌کند ═════════════════════════════ */
console.log('  — 🧠 ریست حافظه:');
const archiveSql = sqlOf('archiveMemory');
const sinceSql = sqlOf('lastDeliveredSince');
const plainSql = sqlOf('lastDelivered');
if (archiveSql && sinceSql && plainSql) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      telegram_id INTEGER PRIMARY KEY, memory_json TEXT NOT NULL DEFAULT '',
      memory_archive TEXT NOT NULL DEFAULT '', memory_reset_at INTEGER NOT NULL DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0, display_name TEXT NOT NULL DEFAULT '',
      birth_month INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT,
      feedback TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE referrals (id INTEGER PRIMARY KEY, referrer_id INTEGER, rewarded INTEGER);
  `);
  db.prepare(`INSERT INTO users (telegram_id, memory_json, balance, display_name, birth_month)
    VALUES (7, 'می‌داند که کاربر نگرانِ کارش است', 12, 'پانیذ', 9)`).run();
  // سه فالِ قدیمی (قبل از ریست) و یکی که بعداً می‌آید
  db.prepare("INSERT INTO readings VALUES (1,7,'delivered','rate:5',1000)").run();
  db.prepare("INSERT INTO readings VALUES (2,7,'delivered','rate:4',2000)").run();
  db.prepare("INSERT INTO readings VALUES (3,7,'delivered','',3000)").run();
  db.prepare('INSERT INTO referrals VALUES (1,7,1)').run();

  db.prepare(archiveSql).run(7);
  const u = db.prepare('SELECT * FROM users WHERE telegram_id=7').get();

  ok(u.memory_json === '', 'حافظه از دیدِ سیستم خالی شد');
  ok(u.memory_archive.includes('نگرانِ کارش'), 'حافظه‌ی قبلی بایگانی شد و قابلِ بازیابی است');
  ok(/^\[\d+\] /.test(u.memory_archive), 'بایگانی مهرِ زمان دارد', u.memory_archive);
  ok(u.memory_reset_at > 0, 'خطِ آب مهر خورد');

  console.log('  — 💾 چیزی که نباید لمس شود:');
  ok(u.balance === 12, 'موجودی دست‌نخورده');
  ok(u.display_name === 'پانیذ' && u.birth_month === 9, 'اسم و ماه تولد دست‌نخورده');
  ok(db.prepare('SELECT COUNT(*) c FROM readings').get().c === 3, 'هیچ فالی پاک نشد');
  // ⚠️ حذفِ readings یعنی پاداشِ دعوت با اولین فالِ بعدی **دوباره** واریز می‌شود
  ok(db.prepare("SELECT COUNT(*) c FROM readings WHERE status='delivered'").get().c === 3,
    'شمارشِ فالِ تحویل‌شده (شرطِ پاداشِ دعوت) عوض نشد');
  ok(db.prepare("SELECT COUNT(*) c FROM readings WHERE feedback<>''").get().c === 2, 'رأی‌های قبلی سرِ جایشان');
  ok(db.prepare('SELECT COUNT(*) c FROM referrals').get().c === 1, 'دعوت‌ها دست‌نخورده');
  ok(!/\bDELETE\b/i.test(archiveSql), 'دستور اصلاً DELETE ندارد');
  ok((archiveSql.match(/UPDATE\s+users/gi) || []).length === 1, 'یک UPDATE اتمیک است');

  console.log('  — 🕰 خطِ آب فقط کانتکستِ مدل را می‌بُرد:');
  const wm = u.memory_reset_at;
  const seen = db.prepare(sinceSql).all(7, wm, 4);
  ok(seen.length === 0, 'بعد از ریست، مدل هیچ فالِ قبلی‌ای نمی‌بیند (انگار اولین فال است)');
  // فالِ تازه بعد از ریست دوباره دیده می‌شود، وگرنه حافظه برای همیشه کور می‌ماند
  db.prepare('INSERT INTO readings VALUES (4,7,?,?,?)').run('delivered', '', wm + 10);
  ok(db.prepare(sinceSql).all(7, wm, 4).length === 1, 'فالِ بعد از ریست دوباره وارد کانتکست می‌شود');
  // و statementِ عمومی دست‌نخورده است: پیامِ خوش‌آمد و منطقِ پاداش از آن می‌خوانند
  ok(db.prepare(plainSql).all(7, 10).length === 4, 'lastDelivered عمومی همه را می‌بیند (منطقِ پاداش نشکست)');

  // ⚠️ این ادعا بعد از یک جهشِ **نگرفته** اضافه شد: تست، دو statement را جدا می‌سنجید ولی
  // هیچ‌جا نمی‌گفت کانتکستِ خوانش واقعاً از کدامشان می‌خواند. برگرداندنِ call site به
  // `lastDelivered` سبز رد می‌شد، یعنی مدل هنوز فال‌های قبلی را می‌دید و پیامی که به کاربر
  // دادیم («انگار اولین فالته») دروغ می‌شد. حالا خودِ سیمِ اتصال سنجیده می‌شود.
  const ctxFn = bodyOf('function readingCtxFor(user, spread, question, cards, focusKey) {', '\n}');
  ok(!!ctxFn, 'سازنده‌ی کانتکستِ خوانش پیدا شد');
  ok(ctxFn ? /prev:\s*stmts\.lastDeliveredSince\.all\(/.test(ctxFn) : false,
    'کانتکستِ خوانش از statementِ خطِ آب‌دار می‌خواند');
  ok(ctxFn ? /memory_reset_at/.test(ctxFn) : false, 'خطِ آبِ همان کاربر به کوئری پاس می‌شود');
  ok(ctxFn ? !/stmts\.lastDelivered\.all\(/.test(ctxFn) : false,
    'کانتکست هرگز از statementِ بدونِ خطِ آب نمی‌خواند');

  console.log('  — 🔁 ریستِ دوباره:');
  db.prepare("UPDATE users SET memory_json='شناختِ تازه' WHERE telegram_id=7").run();
  db.prepare(archiveSql).run(7);
  const u2 = db.prepare('SELECT * FROM users WHERE telegram_id=7').get();
  ok(u2.memory_archive.includes('نگرانِ کارش') && u2.memory_archive.includes('شناختِ تازه'),
    'بایگانی انباشته می‌شود (ریستِ دوم اولی را دور نمی‌ریزد)');
  const before = u2.memory_archive;
  db.prepare(archiveSql).run(7);                       // حافظه الان خالی است
  ok(db.prepare('SELECT memory_archive m FROM users WHERE telegram_id=7').get().m === before,
    'ریست روی حافظه‌ی خالی بایگانی را با خطِ خالی کثیف نمی‌کند');
  db.close();
}

/* ══ ۲) گیتِ یادآوری‌ها روی وضعیتِ آزمایش ═══════════════════════════════════ */
console.log('\n  — 🔔 گیتِ یادآوری‌ها:');
const expSql = SRC.match(/expStartedAt\s*=\s*db\.prepare\(\s*(['"`])([\s\S]*?)\1\s*\)/)?.[2];
ok(!!expSql, 'کوئریِ وضعیتِ آزمایش پیدا شد');
if (expSql) {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE experiments (key TEXT PRIMARY KEY, status TEXT, started_at INTEGER)");
  const q = db.prepare(expSql);
  const active = (st) => {
    db.prepare('DELETE FROM experiments').run();
    db.prepare('INSERT INTO experiments VALUES (?,?,?)').run('night_reminder', st, 111);
    return !!q.get('night_reminder');
  };
  ok(active('running'), 'آزمایشِ running یعنی فعال → ردیفِ یادآوری پنهان');
  ok(active('draining'), 'آزمایشِ draining هم فعال است (شاخه‌ها هنوز فلوشان را تمام می‌کنند)');
  ok(!active('stopped'), 'آزمایشِ stopped یعنی آزاد → ردیفِ یادآوری ظاهر می‌شود');
  ok(!active('draft'), 'آزمایشِ draft هم آزاد است');
  db.close();
}
// شکِ خواندن باید به **پنهان‌ماندن** ختم شود، نه به باز شدنِ زودهنگام
const gate = bodyOf('const nightExpActive = () =>', '\n};');
ok(gate ? /catch\s*\{\s*return true/.test(gate) : false,
  'خطای خواندنِ وضعیت = آزمایش «فعال» فرض می‌شود (fail-safe به سمتِ پنهان‌ماندن)');
ok(/const remindersUnlocked = \(\) => SETTINGS_ENABLED && !nightExpActive\(\)/.test(SRC),
  'باز شدنِ یادآوری‌ها هم به پرچم بسته است هم به پایانِ آزمایش');

/* ══ ۳) قراردادِ منو ════════════════════════════════════════════════════════ */
console.log('\n  — 🧭 قراردادِ منو:');
const rowsFn = bodyOf('function settingsRows(uid) {', '\n}');
ok(!!rowsFn, 'سازنده‌ی ردیف‌های تنظیمات پیدا شد');
ok(rowsFn ? /remindersUnlocked\(\)/.test(rowsFn) : false, 'ردیفِ یادآوری پشتِ همان گیت است');
for (const [key, label] of [['setName', 'تغییر اسم'], ['setMonth', 'تغییر ماه تولد'],
  ['setMemory', 'ریست حافظه'], ['setBackMain', 'بازگشت به منوی اصلی']]) {
  ok(rowsFn ? rowsFn.includes(`L.buttons.${key}`) : false, `گزینه‌ی «${label}» در منو هست`);
}
// «بازگشت» باید **آخرین** ردیف باشد، وگرنه لای گزینه‌ها گم می‌شود
ok(rowsFn ? rowsFn.lastIndexOf('setBackMain') > rowsFn.lastIndexOf('setMemory') : false,
  'بازگشت به منوی اصلی آخرین گزینه است');

// هیچ صفحه‌ای بن‌بست نیست: هر زیرشاخه راهِ برگشت دارد (بند ۹ب)
for (const [marker, name] of [["bot.action('set:name'", 'تغییر اسم'],
  ["bot.action('set:month'", 'تغییر ماه تولد'], ["bot.action('set:mem'", 'ریست حافظه']]) {
  const b = bodyOf(marker);
  ok(b ? /set:home/.test(b) : false, `صفحه‌ی «${name}» دکمه‌ی خروج دارد`);
}
// صفحه‌ی یادآوری‌ها کیبوردش را از سازنده‌ی جدا می‌گیرد، پس ادعا همان‌جا سنجیده می‌شود
const remScreen = bodyOf('function remindersScreen(uid) {', '\n}');
ok(remScreen ? /set:home/.test(remScreen) : false, 'صفحه‌ی «یادآوری‌ها» دکمه‌ی خروج دارد');
// و هر دو کلید باید در همان صفحه باشند، وگرنه کاربر فقط یکی را می‌بیند
ok(remScreen ? /set:rt:daily/.test(remScreen) && /set:rt:lucky/.test(remScreen) : false,
  'هر دو کلیدِ یادآوری در همان صفحه‌اند');
// متن با هر تپ بازساخته می‌شود، وگرنه «در حال حاضر» با دکمه‌ها ناهم‌خوان می‌ماند
const toggle = bodyOf('bot.action(/^set:rt:(daily|lucky)$/');
ok(toggle ? /remindersScreen\(uid\)/.test(toggle) : false,
  'بعد از هر تپ، متن و دکمه‌ها با هم از یک منبع دوباره ساخته می‌شوند');

/* ══ ۴) هیچ‌چیز پاک نمی‌شود و اسمِ قدیمی تا آخر معتبر است ═══════════════════ */
console.log('\n  — 🛡 هیچ‌چیز پاک نمی‌شود:');
const settingsBlock = SRC.slice(SRC.indexOf('/* ═══════════ ⚙️ منوی تنظیماتِ کاربر'),
  SRC.indexOf("bot.command('reset', doReset);"));
ok(settingsBlock.length > 500, 'بلوکِ تنظیمات پیدا شد');
ok(!/\bDELETE\b/i.test(settingsBlock), 'هیچ DELETE ای در کلِ منوی تنظیمات نیست');
ok(!/wipeUser/.test(settingsBlock), 'منوی تنظیمات هرگز wipeUser را صدا نمی‌زند');

// اسم فقط وقتی نوشته می‌شود که مقدارِ معتبر رسیده باشد؛ نامِ نامعتبر استیت را نمی‌شکند
const nameState = bodyOf("if (state === 'settings_name') {", '\n    }');
ok(!!nameState, 'استیتِ ورودیِ اسم پیدا شد');
ok(nameState ? nameState.indexOf('if (!nm) return') < nameState.indexOf('setDisplayName') : false,
  'اسمِ نامعتبر قبل از هر نوشتنی رد می‌شود (اسم قبلی دست‌نخورده می‌ماند)');
ok(nameState ? /setState\(uid, 'idle'\)/.test(nameState) : false,
  'بعد از ثبتِ اسم، کاربر از استیتِ ورودی بیرون می‌آید (گیر نمی‌کند)');
// استیتِ جدا از آنبوردینگ: وگرنه کاربری که فقط اسمش را عوض می‌کند دوباره آنبورد می‌شود
ok(!SRC.includes("ONBOARDING_STATES = ['onboard_name', 'onboard_focus', 'onboard_month', 'settings_name'"),
  'settings_name جزوِ استیت‌های آنبوردینگ نیست');
ok(/bot\.action\(\/\^smonth:/.test(SRC), 'ماهِ تولدِ تنظیمات callback جدا از آنبوردینگ دارد (smonth نه bmonth)');

/* ══ ۵) جاروی شبانه: مسیرِ آزمایش دست‌نخورده ═══════════════════════════════ */
console.log('\n  — 🌙 جاروی شبانه:');
const sweep = bodyOf('    const today = botToday();', '}, 15 * 60 * 1000);');
ok(!!sweep, 'جاروی شبانه پیدا شد');
ok(sweep ? /const expOn = nightExpActive\(\)/.test(sweep) : false, 'جارو رژیمش را از وضعیتِ آزمایش می‌گیرد');
ok(sweep ? /expOn \? stmts\.dueNightReminder\.all\(\) : stmts\.dueNightReminderFree\.all\(\)/.test(sweep) : false,
  'وقتی آزمایش فعال است دقیقاً همان کوئریِ قبلی اجرا می‌شود');
ok(sweep ? /if \(!expOn\) \{/.test(sweep) : false, 'مسیرِ دو-یادآوریِ مستقل پشتِ شرطِ پایانِ آزمایش است');
ok(sweep ? /peekVariant\(db, uid, NIGHT_EXP\)/.test(sweep) : false, 'مسیرِ آزمایش هنوز از شاخه‌ی A/B می‌خواند');
// exposure فقط در مسیرِ آزمایش، و فقط بعد از ارسالِ موفق (قاعده‌ی آهنینِ بند ۲الف)
const freePath = sweep ? sweep.slice(sweep.indexOf('if (!expOn) {'), sweep.indexOf('continue;\n      }')) : '';
ok(freePath && !/expose\(/.test(freePath), 'مسیرِ بعد از آزمایش هیچ exposure ای ثبت نمی‌کند');
const freeSql = sqlOf('dueNightReminderFree');
ok(freeSql ? /daily_reminder_off=0 OR lucky_reminder_on=1/.test(freeSql) : false,
  'کوئریِ آزاد کاربری که فقط کارتِ شانس را روشن دارد هم می‌گیرد');

console.log(`\n${fail ? '❌' : '✅'} تنظیمات: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
