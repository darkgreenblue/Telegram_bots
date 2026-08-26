#!/usr/bin/env node
// 💎 مهاجرتِ نهایی: الماس واحدِ **واقعیِ** ذخیره‌سازی می‌شود، نه یک عددِ ضرب‌شده.
//
// ── چرا ─────────────────────────────────────────────────────────────────────
// تا امروز هر الماس در دیتابیس به شکلِ `۱۰٬۰۰۰` ذخیره می‌شد — بازمانده‌ی دوره‌ای که
// موجودی واقعاً تومان بود. آن ضریب یک **نرخِ تبدیلِ ساختگی** است، چون قیمتِ واقعیِ هر
// الماس به بسته بستگی دارد: ۳۰٬۰۰۰÷۱۰ = ۳٬۰۰۰ · ۶۰٬۰۰۰÷۳۰ = ۲٬۰۰۰ · ۱۵۰٬۰۰۰÷۱۰۰ = ۱٬۵۰۰.
// یعنی هیچ نرخِ واحدی وجود ندارد و نگه‌داشتنِ ضریب فقط یک دروغِ ماندگار در دیتاست.
// بعد از این مهاجرت، عددِ داخلِ دیتابیس **خودِ تعدادِ الماس** است.
//
// ── چه چیزی تغییر می‌کند (همه ÷۱۰٬۰۰۰، اتمیک) ──────────────────────────────
//   users.balance                اعتبارِ کیف
//   readings.price               قیمتِ فال
//   payments.original_amount     اعتبارِ داده‌شده  ← `amount` **دست نمی‌خورد** (تومانِ واقعی)
//   admin_actions.amount         اعتبارِ در صف
//   events props.amount          فقط credit_granted / credit_adjusted
//
// ⚠️ رویدادها هم عمداً بازنویسی می‌شوند. بند ۲ج/۳ ریشه تغییرِ **معنیِ** رویداد را ممنوع
// کرده؛ این‌جا معنی ثابت است («چقدر اعتبار داده شد») و فقط واحد یکنواخت مقیاس می‌شود.
// جایگزینش این بود که تاریخِ رویدادها یک **درزِ دائمی** بگیرد (قبلِ مهاجرت یک واحد،
// بعدش واحدِ دیگر) که هر تحلیلِ آینده باید از آن خبر داشته باشد — بدهیِ بدتری از خودِ ضریب.
//
// ── اجرا ────────────────────────────────────────────────────────────────────
//   node tools/coins-native-tarot.mjs <dataDir>           ← گزارش (dry-run)
//   node tools/coins-native-tarot.mjs <dataDir> --apply   ← اجرای واقعی
import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

export const SCALE = 10_000;
export const MIGRATION_KEY = 'coins_native';

/** جدولِ مهرِ مهاجرت — همان جدولی که مهاجرتِ قبلی ساخت. */
export function ensureMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (key TEXT PRIMARY KEY, done_at INTEGER NOT NULL DEFAULT 0)');
}
export function migrationDone(db) {
  ensureMigrations(db);
  return !!db.prepare('SELECT 1 FROM migrations WHERE key=?').get(MIGRATION_KEY);
}

const hasTable = (db, t) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const hasCol = (db, t, c) =>
  hasTable(db, t) && db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c);

/** گزارشِ «چه چیزی قرار است عوض شود» + هشدارِ عددهایی که مضربِ SCALE نیستند. */
export function survey(db) {
  const out = { rows: {}, odd: {} };
  const count = (sql, params = []) => db.prepare(sql).get(...params)?.n || 0;

  if (hasCol(db, 'users', 'balance')) {
    out.rows.users = count('SELECT COUNT(*) n FROM users WHERE balance<>0');
    out.odd.users = count(`SELECT COUNT(*) n FROM users WHERE balance % ${SCALE} <> 0`);
  }
  if (hasCol(db, 'readings', 'price')) {
    out.rows.readings = count('SELECT COUNT(*) n FROM readings WHERE price<>0');
    out.odd.readings = count(`SELECT COUNT(*) n FROM readings WHERE price % ${SCALE} <> 0`);
  }
  if (hasCol(db, 'payments', 'original_amount')) {
    out.rows.payments = count('SELECT COUNT(*) n FROM payments WHERE original_amount IS NOT NULL AND original_amount<>0');
    out.odd.payments = count(`SELECT COUNT(*) n FROM payments WHERE original_amount IS NOT NULL AND original_amount % ${SCALE} <> 0`);
  }
  if (hasCol(db, 'admin_actions', 'amount')) {
    out.rows.admin_actions = count('SELECT COUNT(*) n FROM admin_actions WHERE amount IS NOT NULL AND amount<>0');
    out.odd.admin_actions = count(`SELECT COUNT(*) n FROM admin_actions WHERE amount IS NOT NULL AND amount % ${SCALE} <> 0`);
  }
  if (hasTable(db, 'events')) {
    out.rows.events = count(
      "SELECT COUNT(*) n FROM events WHERE event IN ('credit_granted','credit_adjusted') AND json_extract(props,'$.amount') IS NOT NULL");
  }
  return out;
}

/**
 * 🛑 «این دیتابیس از قبل بومی است» — گاردِ ضدِ صفرکردنِ اعتبارِ کاربران.
 *
 * مهر (`migrations.coins_native`) فقط دیتابیسی را می‌شناسد که **خودمان** مهاجرت داده‌ایم.
 * دیتابیسی که کدِ **امروز** ساخته باشد (سرورِ تازه، locale جدید) مهر ندارد ولی عددهایش
 * از قبل الماسِ بومی‌اند؛ اجرای مهاجرت رویش هر موجودی را ÷۱۰٬۰۰۰ و عملاً **صفر** می‌کند،
 * بعد مهر می‌زند، پس خرابی هم دائمی است و هم بی‌صدا.
 *
 * تشخیص: در دنیای تومانی هر موجودیِ غیرصفر مضربِ SCALE بود (کمینه‌اش ۱۰٬۰۰۰). پس اگر
 * بزرگ‌ترین عددِ دیتا از SCALE کوچک‌تر باشد، این دیتا تومانی نیست و نباید لمس شود.
 */
export function looksNative(db) {
  const maxOf = (t, c) => {
    if (!hasCol(db, t, c)) return 0;
    return Number(db.prepare(`SELECT MAX(ABS(${c})) m FROM ${t}`).get()?.m || 0);
  };
  const peak = Math.max(
    maxOf('users', 'balance'),
    maxOf('readings', 'price'),
    maxOf('payments', 'original_amount'),
  );
  return peak > 0 && peak < SCALE;
}

/** خودِ مهاجرت. همه‌چیز در **یک** تراکنش، و مهر داخلِ همان تراکنش. */
export function migrate(db) {
  ensureMigrations(db);
  const stamp = db.prepare('INSERT OR IGNORE INTO migrations (key, done_at) VALUES (?, unixepoch())');
  const changed = {};

  const tx = db.transaction(() => {
    // ⚠️ `ROUND(x/SCALE.0)` و نه تقسیمِ صحیح: اگر روزی عددی مضربِ SCALE نبود (مثلاً
    // هدیه‌ی استریکِ دوره‌ی تومانی) نباید بی‌صدا به صفر گرد شود و اعتبارِ کاربر بسوزد.
    const div = (t, c, where = '1=1') =>
      db.prepare(`UPDATE ${t} SET ${c} = CAST(ROUND(${c} / ${SCALE}.0) AS INTEGER) WHERE ${where}`).run().changes;

    if (hasCol(db, 'users', 'balance')) changed.users = div('users', 'balance', 'balance<>0');
    if (hasCol(db, 'readings', 'price')) changed.readings = div('readings', 'price', 'price<>0');
    if (hasCol(db, 'payments', 'original_amount')) {
      changed.payments = div('payments', 'original_amount', 'original_amount IS NOT NULL AND original_amount<>0');
    }
    if (hasCol(db, 'admin_actions', 'amount')) {
      changed.admin_actions = div('admin_actions', 'amount', 'amount IS NOT NULL AND amount<>0');
    }
    // رویدادها: فقط دو رویدادِ اعتباری، فقط کلیدِ amount، بقیه‌ی propها دست‌نخورده.
    if (hasTable(db, 'events')) {
      changed.events = db.prepare(`
        UPDATE events
           SET props = json_set(props, '$.amount',
                 CAST(ROUND(json_extract(props,'$.amount') / ${SCALE}.0) AS INTEGER))
         WHERE event IN ('credit_granted','credit_adjusted')
           AND json_extract(props,'$.amount') IS NOT NULL
           AND json_extract(props,'$.amount') <> 0`).run().changes;
    }
    stamp.run(MIGRATION_KEY);
  });
  tx();
  return changed;
}

/* ═══════ نقطه‌ی ورود ═══════ */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dataDir = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!dataDir || !existsSync(dataDir)) { console.error(`❌ مسیر data نامعتبر: ${dataDir}`); process.exit(1); }

  const files = readdirSync(dataDir).filter(f => /^bot-[a-z-]+\.db$/.test(f));
  if (!files.length) { console.log('ℹ️ دیتابیسی پیدا نشد'); process.exit(0); }
  const fa = (n) => Number(n).toLocaleString('fa-IR');

  for (const f of files) {
    const file = path.join(dataDir, f);
    const db = new Database(file);
    db.pragma('busy_timeout = 5000');

    if (migrationDone(db)) { console.log(`⏭ ${f} — قبلاً مهاجرت کرده`); db.close(); continue; }

    // بدونِ مهر ولی با عددهای بومی = دیتابیسی که کدِ امروز ساخته. اجرا روی آن یعنی
    // صفرکردنِ اعتبارِ همه‌ی کاربران. عمداً exit 1 است نه رد کردنِ بی‌صدا، چون این
    // یعنی کسی اسکریپت را جایی اجرا کرده که نباید.
    if (looksNative(db)) {
      console.error(`❌ ${f} — عددهایش از قبل الماسِ بومی‌اند (بزرگ‌ترین مقدار < ${fa(SCALE)}).`);
      console.error('   این دیتابیس را کدِ امروز ساخته و مهاجرت لازم ندارد؛ اجرا هر موجودی را صفر می‌کرد.');
      console.error('   اگر واقعاً یک بکاپِ تومانیِ قدیمی است، اول با Ops یک نمونه‌ی balance را ببین.');
      db.close();
      process.exit(1);
    }

    const s = survey(db);
    console.log(`\n📄 ${f}`);
    for (const [k, v] of Object.entries(s.rows)) console.log(`   ${k.padEnd(15)} ${fa(v)} ردیف`);
    const oddTotal = Object.values(s.odd).reduce((a, b) => a + b, 0);
    if (oddTotal) {
      console.log(`   ⚠️ ${fa(oddTotal)} ردیف مضربِ ${fa(SCALE)} نیست و گرد می‌شود:`);
      for (const [k, v] of Object.entries(s.odd)) if (v) console.log(`      ${k}: ${fa(v)}`);
    }

    if (!apply) { console.log('   ℹ️ dry-run — چیزی نوشته نشد (برای اجرا: --apply)'); db.close(); continue; }

    // بکاپ **قبل از** هر نوشتنی، و هرگز بازنویسی نمی‌شود (درسِ مهاجرتِ قبلی).
    const bak = `${file}.pre-coins-native.bak`;
    const target = existsSync(bak) ? `${file}.pre-coins-native.${Date.now()}.bak` : bak;
    db.prepare('VACUUM INTO ?').run(target);
    console.log(`   💾 بکاپ: ${path.basename(target)}`);

    const changed = migrate(db);
    for (const [k, v] of Object.entries(changed)) console.log(`   ✅ ${k.padEnd(15)} ${fa(v)} ردیف تبدیل شد`);
    console.log('   🏁 مهر خورد (اجرای دوباره بی‌اثر است)');
    db.close();
  }
}
