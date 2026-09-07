#!/usr/bin/env node
// 💎 چکِ «ستونِ `original_amount` دو واحد دارد و هرگز با هم جمع نمی‌شوند».
//
// 🐛 باگِ واقعی (۱۴۰۵/۰۶/۱۶، گزارشِ مالک): کارتِ «الماسِ خریداری‌شده» عددِ
// **۶۳۵٬۹۵۹💎** نشان می‌داد. هیچ‌کس چنین چیزی نخریده بود — آن عدد جمعِ **دو واحد** بود:
//   ۱۳ ردیفِ دوره‌ی تومانی، جمعاً ۶۳۵٬۰۰۰ (تومان)
//   ۳۸ ردیفِ دوره‌ی الماس، جمعاً     ۹۵۹ (الماس)
// و ۶۳۵٬۰۰۰ + ۹۵۹ = ۶۳۵٬۹۵۹. یعنی عدد «تصادفی بزرگ» نبود، دقیقاً جمعِ دو دفتر بود.
//
// چرا خطایی رخ نمی‌داد: هر دو عدد صحیح‌اند و SQL خوشحال جمعشان می‌کند. این دقیقاً
// همان خانواده‌ی «عدد درست، واحد دروغ» است (بند ۹ و ۶ج ریشه: باگِ ریال/تومانِ رسید).
//
// ⚠️ **جداکننده نه `pkg` است نه تاریخ.** روی دیتای زنده سنجیده شد: هفت ردیفِ
// بدونِ `pkg` بینِ ۸ تیر و ۲۸ مرداد `original_amount` **الماسی** دارند (۳، ۵، ۱۰)،
// چون اقتصادِ الماس قبل از بسته‌ها برای تسترها باز بود؛ و بازه‌ی تاریخشان با
// ردیف‌های تومانی درهم است. تنها جداکننده‌ی واقعی **بزرگی** است.
//
// و این حدس نیست، شکافِ ساختاری است: بزرگ‌ترین بسته ۱۰۰ الماس، کف شارژِ تومانی
// ۱۰٬۰۰۰ تومان. این چک **خالی‌بودنِ همان بازه** را می‌سنجد، پس اگر روزی ردیفی
// وسطش بیفتد قرمز می‌شود به‌جای اینکه بی‌صدا اشتباه جمع بزند.
//
// اجرا: node tools/check-coin-units.mjs   (بدون شبکه؛ فیکسچرِ SQLite موقت)
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(path.resolve('bots/dashboard/package.json'));
const Database = require('better-sqlite3');
const base = path.resolve('bots/dashboard');

let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

const root = mkdtempSync(path.join(tmpdir(), 'coinunit-'));
const dataDir = path.join(root, 'tarotdata');
mkdirSync(dataDir, { recursive: true });
const now = Math.floor(Date.now() / 1000), D = 86400;
{
  const db = new Database(path.join(dataDir, 'bot-fa.db'));
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT DEFAULT '', username TEXT DEFAULT '',
     balance INTEGER DEFAULT 0, first_source TEXT DEFAULT '', first_payload TEXT DEFAULT '',
     first_version TEXT DEFAULT '', created_at INTEGER, last_seen INTEGER);
   CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER DEFAULT 0,
     status TEXT DEFAULT 'pending', step TEXT, pkg TEXT DEFAULT '', original_amount INTEGER,
     created_at INTEGER, updated_at INTEGER);
   CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, price INTEGER,
     focus_area TEXT DEFAULT '', feedback TEXT DEFAULT '', status TEXT DEFAULT 'delivered', created_at INTEGER);
   CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event TEXT, props TEXT DEFAULT '{}', created_at INTEGER);
   CREATE TABLE llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER DEFAULT 0, kind TEXT DEFAULT '',
     ref_id INTEGER DEFAULT 0, model TEXT DEFAULT '', prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
     total_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, ms INTEGER DEFAULT 0, created_at INTEGER);`);
  db.prepare('INSERT INTO users(telegram_id,name,created_at,last_seen,balance) VALUES(1,?,?,?,?)').run('a', now - 60 * D, now, 42);
  const p = db.prepare("INSERT INTO payments(user_id,amount,status,pkg,original_amount,created_at,updated_at) VALUES(1,?,'approved',?,?,?,?)");

  /* شکلِ دقیقِ دیتای زنده بازسازی می‌شود، چون هر ساده‌سازی‌ای ممکن است دقیقاً همان
     حالتی را حذف کند که باگ را ساخته بود. */
  // (الف) دوره‌ی تومانی: بدونِ pkg، اعتبارِ تومانی
  for (const t of [15000, 30000, 100000]) p.run(t, '', t, now - 45 * D, now - 45 * D);
  // (ب) دوره‌ی الماس با بسته
  for (const c of [10, 30, 100]) p.run(c * 3000, 'basic', c, now - 5 * D, now - 5 * D);
  // (ج) ⚠️ حالتِ سختِ واقعی: بدونِ pkg ولی الماسی، **در همان بازه‌ی تاریخیِ تومانی‌ها**
  for (const c of [3, 5, 10]) p.run(24000, '', c, now - 44 * D, now - 44 * D);
  db.close();
}
process.env.TAROT_DB_DIR = dataDir;
process.chdir(root); mkdirSync(path.join(root, 'data'), { recursive: true });

const { coinEconomy } = await import(`file://${base}/routes/finance.js`);
const { coinLegacyFloorOf, instancesOf } = await import(`file://${base}/lib/bots.js`);

console.log('\n💎 واحدِ ستونِ original_amount\n');

console.log('▶ ۱) الماسِ خریداری‌شده فقط ردیف‌های الماسی را جمع می‌زند');
{
  const [e] = coinEconomy('tarot');
  ok(!!e, 'اقتصادِ الماس محاسبه شد');
  // الماسی‌ها: 10+30+100 (بسته‌دار) + 3+5+10 (بی‌بسته) = ۱۵۸
  ok(e.bought === 158, `خریداری‌شده = ۱۵۸💎 (شد ${e.bought})`);
  // تومانی‌ها: 15000+30000+100000 = ۱۴۵٬۰۰۰ — جدا، نه داخلِ عدد بالا
  ok(e.legacyRows === 3, `۳ ردیفِ تومانی جدا شمرده شد (${e.legacyRows})`);
  ok(e.legacyToman === 145000, `و جمعشان ۱۴۵٬۰۰۰ تومان است (${e.legacyToman})`);
  /* ⚠️ ادعای **معکوس**: مدلِ باگ‌دار دقیقاً همان عددِ گزارش‌شده را می‌ساخت. بدونِ این،
     ثابت نمی‌شود که این چک همان باگ را می‌گیرد و نه یک چیزِ دیگر. */
  ok(e.bought + e.legacyToman === 145158,
    `🐛 مدلِ قدیمی این‌جا ۱۴۵٬۱۵۸ می‌داد (همان‌طور که روی دیتای واقعی ۶۳۵٬۹۵۹ می‌داد)`);
  ok(e.bought < e.legacyToman, 'و عددِ درست چند مرتبه کوچک‌تر از عددِ باگ‌دار است');
}

console.log('\n▶ ۲) ردیفِ بی‌بسته‌ی الماسی حذف نمی‌شود (نه `pkg` جداکننده است نه تاریخ)');
{
  /* اگر کسی روزی وسوسه شود جداکننده را `pkg` بگذارد، ۱۸ الماس از این فیکسچر
     ناپدید می‌شود؛ و اگر تاریخ بگذارد، همان ۱۸ تا (که هم‌تاریخِ تومانی‌ها هستند)
     می‌روند. پس هر دو میان‌بر این‌جا قرمز می‌دهند. */
  const [e] = coinEconomy('tarot');
  ok(e.bought === 158, 'سه ردیفِ بی‌بسته‌ی الماسی (۳+۵+۱۰) هنوز شمرده می‌شوند');
  ok(e.bought !== 140, 'جداکننده `pkg` نیست (وگرنه ۱۴۰ می‌شد)');
}

console.log('\n▶ ۳) بازه‌ی مبهم خالی است — پس آستانه یک حدس نیست');
{
  const floor = coinLegacyFloorOf('tarot');
  ok(floor > 0, `کفِ تومانی در رجیستری تعریف شده (${floor})`);
  const MAX_PACK = 100;            // بزرگ‌ترین بسته‌ی الماس در bots/tarot/index.js
  ok(floor > MAX_PACK, `و بالاتر از بزرگ‌ترین بسته (${MAX_PACK}💎) است، پس بازه‌ای خالی بینشان هست`);
  let inBand = 0, mx = 0, mn = Infinity;
  for (const inst of instancesOf('tarot')) {
    const db = new Database(inst.file, { readonly: true });
    inBand += db.prepare('SELECT COUNT(*) n FROM payments WHERE status=? AND COALESCE(original_amount,amount) BETWEEN ? AND ?')
      .get('approved', MAX_PACK + 1, floor - 1).n;
    const r = db.prepare('SELECT MAX(CASE WHEN COALESCE(original_amount,amount)<? THEN COALESCE(original_amount,amount) END) mx, MIN(CASE WHEN COALESCE(original_amount,amount)>=? THEN COALESCE(original_amount,amount) END) mn FROM payments WHERE status=?')
      .get(floor, floor, 'approved');
    mx = Math.max(mx, r.mx || 0); mn = Math.min(mn, r.mn ?? Infinity);
    db.close();
  }
  ok(inBand === 0, `هیچ ردیفی در بازه‌ی مبهم [${MAX_PACK + 1}, ${floor - 1}] نیست (${inBand})`);
  ok(mx <= MAX_PACK, `بزرگ‌ترین مقدارِ الماسی ${mx} است`);
  ok(mn >= floor, `و کوچک‌ترین مقدارِ تومانی ${mn === Infinity ? '—' : mn}`);
}

console.log('\n▶ ۴) رباتِ بدونِ دوره‌ی تومانی هیچ ردیفی از دست نمی‌دهد');
{
  ok(coinLegacyFloorOf('tarot-intl') === 0,
    'تاروتِ زبان‌های دیگر کفِ تومانی ندارد (ریلش از روزِ اول استارز/الماس بود)');
  ok(coinLegacyFloorOf('voice2text') === 0, 'و رباتِ غیرالماسی هم همین‌طور');
}

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
if (errs.length) { for (const e of errs) console.log(`   - ${e}`); process.exit(1); }
