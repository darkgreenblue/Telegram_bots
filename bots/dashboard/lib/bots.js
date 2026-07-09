// رجیستری ربات‌ها و اتصال به دیتابیس‌هایشان.
// خواندن تحلیلی: اتصال readonly و per-request (کوتاه — WAL checkpoint بلاک نمی‌شود).
// نوشتن config (کد تخفیف): اتصال writable جدا + تراکنش کوتاه + گارد schema (schema-guard).
import { readdirSync, statSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { logErr } from '../../../shared/logger.js';

export const BOTS = [
  { key: 'voice2text',    title: '🎙 ویس به متن', dataDir: '../voice2text/data',    pattern: /^bot\.db$/ },
  { key: 'tarot',         title: '🔮 تاروت',      dataDir: '../tarot/data',         pattern: /^bot-[a-z-]+\.db$/ },
  { key: 'resume-tailor', title: '📄 رزومه‌ساز',   dataDir: '../resume-tailor/data', pattern: /^bot\.db$/ },
];
export const botByKey = (key) => BOTS.find(b => b.key === key);

// هر فایل db یک «instance» است (tarot per زبان چند فایل دارد). id امن است چون هرگز
// مستقیم به مسیر تبدیل نمی‌شود — همیشه از همین لیست lookup می‌شود (ضد path traversal).
export function instances() {
  const out = [];
  for (const b of BOTS) {
    const dir = path.resolve(b.dataDir);
    let files = [];
    try { files = readdirSync(dir).filter(f => b.pattern.test(f)).sort(); } catch {}
    for (const f of files) {
      const locale = b.key === 'tarot' ? f.replace(/^bot-|\.db$/g, '') : '';
      out.push({
        id: `${b.key}:${f}`,
        bot: b.key,
        title: b.title + (locale ? ` (${locale})` : ''),
        file: path.join(dir, f),
      });
    }
  }
  return out;
}
export const getInstance = (id) => instances().find(i => i.id === id) || null;
export const instancesOf = (botKey) => instances().filter(i => i.bot === botKey);

// اجرای یک تابع روی اتصال readonly کوتاه‌عمر؛ خطا (نبود فایل و...) → fallback
export function withDb(file, fn, fallback = null) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 3000');
    return fn(db);
  } catch (e) {
    logErr('dashboard withDb:', file, e.message);
    return fallback;
  } finally {
    try { db?.close(); } catch {}
  }
}

export const hasTable = (db, name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

// یک عدد اسکالر امن (جدول نبود/خطا → fallback)
export function scalar(db, sql, params = [], fallback = 0) {
  try { return Object.values(db.prepare(sql).get(...params) ?? {})[0] ?? fallback; }
  catch { return fallback; }
}
export function rows(db, sql, params = [], fallback = []) {
  try { return db.prepare(sql).all(...params); }
  catch (e) { logErr('dashboard rows:', e.message); return fallback; }
}

export function dbSizes(file) {
  const size = (f) => { try { return statSync(f).size; } catch { return 0; } };
  return { db: size(file), wal: size(file + '-wal') };
}

/* ---- نوشتن config در DB ربات (فعلاً: کد تخفیف) — با گارد schema ----
   قبل از هر INSERT، ستون‌های واقعی جدول با ستون‌های مورد انتظار مقایسه می‌شوند؛
   ناهماهنگی = امتناع + خطای واضح (drift schema ربات نباید بی‌صدا داده‌ی خراب بسازد). */
export function withWritableDb(file, fn) {
  let db;
  try {
    db = new Database(file, { fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    return fn(db);
  } finally {
    try { db?.close(); } catch {}
  }
}
export function assertColumns(db, table, expectedCols) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const missing = expectedCols.filter(c => !cols.includes(c));
  if (missing.length) {
    throw new Error(`schema-guard: جدول ${table} ستون‌های مورد انتظار را ندارد: ${missing.join(', ')} — schema ربات تغییر کرده؛ داشبورد باید به‌روز شود`);
  }
}
