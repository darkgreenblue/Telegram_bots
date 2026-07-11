// پاک‌سازی یک‌باره‌ی دیتای تستی tarot قبل از لانچ عمومی (تصمیم مالک ۱۴۰۵/۰۴/۲۰).
// همه‌ی ردیف‌های کاربرمحورِ غیرادمین حذف می‌شوند تا آمار/قیف/درآمد از روز لانچ تمیز شروع شود.
// اجرا فقط از deploy.yml (یک‌باره، با فایل marker روی سرور) — بعد از pm2 stop tarot و قبل از start.
//   node tools/launch-wipe-tarot.mjs <dataDir>      (ADMIN_IDS از env: کامای آی‌دی‌ها)
// امن: اول از هر DB با online-backup بکاپ می‌گیرد (<db>.pre-launch.bak کنار خودش)؛
// کش‌های غیرکاربری (card_files/daily_texts) و discount_codes (config) دست نمی‌خورند.
import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// از better-sqlite3 خود tarot استفاده می‌کنیم (نسخه‌ی هم‌ABI با دیتابیس همان ربات)
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

const dataDir = process.argv[2];
if (!dataDir || !existsSync(dataDir)) {
  console.error(`❌ مسیر data نامعتبر: ${dataDir}`);
  process.exit(1);
}
const adminIds = (process.env.ADMIN_IDS || '')
  .split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
if (!adminIds.length) {
  console.error('❌ ADMIN_IDS خالی است — بدون لیست ادمین پاک‌سازی نمی‌کنم (ایمنی)');
  process.exit(1);
}
const keep = adminIds.join(',');

const dbFiles = readdirSync(dataDir).filter((f) => /^bot-[a-z-]+\.db$/.test(f));
if (!dbFiles.length) {
  console.log('ℹ️ فایل دیتابیسی برای پاک‌سازی نیست — رد شد');
  process.exit(0);
}

// (جدول، شرط حذف) — ترتیب مهم است: اول جدول‌های وابسته به payments، بعد بقیه، آخر users
const hasTable = (db, t) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

for (const f of dbFiles) {
  const file = path.join(dataDir, f);
  const db = new Database(file);
  db.pragma('busy_timeout = 5000');
  // بکاپ سازگار قبل از هر حذف (همان online-backup API بکاپ شبانه)
  const bak = `${file}.pre-launch.bak`;
  // db.backup async است؛ ولی برای سادگی و چون پروسه‌ی دیگری ننوشته، از VACUUM INTO استفاده می‌کنیم (snapshot سازگار)
  db.prepare(`VACUUM INTO ?`).run(bak);
  console.log(`💾 ${f}: بکاپ گرفته شد → ${path.basename(bak)}`);

  const wipes = [
    ['admin_actions', `payment_id IN (SELECT id FROM payments WHERE user_id NOT IN (${keep}))`],
    ['payments', `user_id NOT IN (${keep})`],
    ['readings', `user_id NOT IN (${keep})`],
    ['discount_uses', `user_id NOT IN (${keep})`],
    ['referrals', `referrer_id NOT IN (${keep}) OR referee_id NOT IN (${keep})`],
    ['events', `user_id IS NULL OR user_id NOT IN (${keep})`],
    ['ab_exposures', `user_id NOT IN (${keep})`],
    ['users', `telegram_id NOT IN (${keep})`],
  ];
  for (const [table, where] of wipes) {
    if (!hasTable(db, table)) continue;
    const n = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run().changes;
    console.log(`🧹 ${f}/${table}: ${n} ردیف تستی حذف شد`);
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}
console.log(`✅ پاک‌سازی لانچ tarot تمام شد (ادمین‌های حفظ‌شده: ${keep})`);
