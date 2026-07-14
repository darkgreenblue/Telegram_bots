// db.js — schema، مهاجرت‌ها، helper های settings و wipeUser.
// قرارداد داشبورد: users با PK به نام telegram_id و created_at از نوع unix.
// قانون ربات زنده‌ی آینده: مهاجرت فقط افزایشی (ALTER ADD COLUMN با DEFAULT) — هرگز DROP/RENAME.
import { mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { logErr } from '../../shared/logger.js';
import { ensureAnalytics } from '../../shared/analytics.js';
import { ensureAb } from '../../shared/ab.js';

// مراحل زندگیِ یک capture (ورودی خام) و یک item (نیت استخراج‌شده).
// captures: captured → transcribing → transcribed → extracting → extracted → routed | partial | failed
// items:    proposed → confirmed → delivering → delivered | undone | failed | dismissed | archived
export const CAPTURE_TERMINAL = new Set(['routed', 'partial', 'failed']);

export function setupDb(dbPath = './data/bot.db') {
  mkdirSync('./data', { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      name        TEXT,
      username    TEXT,
      state       TEXT DEFAULT 'new',
      memory_json TEXT NOT NULL DEFAULT '',
      created_at  INTEGER DEFAULT (unixepoch()),
      last_seen   INTEGER DEFAULT (unixepoch())
    );
  `);
  // زیرساخت رشد (events + first_source/first_version + جدول‌های A/B) — بعد از ساخت users
  ensureAnalytics(db);
  ensureAb(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS captures (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      chat_id       INTEGER,
      tg_message_id INTEGER,
      source        TEXT NOT NULL,                 -- voice | audio | text | forward
      file_id       TEXT,
      duration_sec  INTEGER DEFAULT 0,
      size_bytes    INTEGER DEFAULT 0,
      transcript    TEXT,
      status        TEXT NOT NULL DEFAULT 'captured',
      error         TEXT,
      status_msg_id INTEGER,
      created_at    INTEGER DEFAULT (unixepoch()),
      updated_at    INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status, updated_at);

    CREATE TABLE IF NOT EXISTS chunks (
      capture_id INTEGER NOT NULL,
      idx        INTEGER NOT NULL,
      start_sec  REAL,
      dur_sec    REAL,
      transcript TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
      PRIMARY KEY (capture_id, idx)
    );

    CREATE TABLE IF NOT EXISTS items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id    INTEGER,
      user_id       INTEGER NOT NULL,
      kind          TEXT NOT NULL,                 -- event | task | read_later | thought
      title         TEXT NOT NULL,
      body          TEXT DEFAULT '',
      url           TEXT DEFAULT '',
      due_at        INTEGER,
      end_at        INTEGER,
      all_day       INTEGER DEFAULT 0,
      confidence    REAL DEFAULT 1.0,
      risk          TEXT NOT NULL DEFAULT 'low',   -- low | high
      status        TEXT NOT NULL DEFAULT 'proposed',
      dest          TEXT NOT NULL,                 -- gcal | ticktick
      external_id   TEXT,
      deliver_error TEXT,
      receipt_msg_id INTEGER,
      quote         TEXT DEFAULT '',
      created_at    INTEGER DEFAULT (unixepoch()),
      updated_at    INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_items_capture ON items(capture_id);
    CREATE INDEX IF NOT EXISTS idx_items_status  ON items(status);
  `);

  return db;
}

/* ---- settings (توکن TickTick، id پروژه‌ی «منشی» و…) ---- */
export function getSetting(db, key) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : null;
}
export function setSetting(db, key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=unixepoch()`)
    .run(key, String(value));
}

/* ---- ریست تست: همه‌ی جدول‌های کاربرمحورِ همین ربات ---- */
export function wipeUser(db, uid) {
  const rows = [
    ['users', 'telegram_id'],
    ['events', 'user_id'],
    ['ab_exposures', 'user_id'],
    ['items', 'user_id'],
    ['captures', 'user_id'],
  ];
  for (const [t, col] of rows) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(uid); } catch (e) { logErr('wipe', t, e.message); }
  }
  // chunks کلید user ندارد؛ یتیم‌های همان کاربر را با join روی captureهای پاک‌شده حذف کن (اینجا دیگر capture نمانده)
  try { db.prepare('DELETE FROM chunks WHERE capture_id NOT IN (SELECT id FROM captures)').run(); } catch (e) { logErr('wipe chunks', e.message); }
}
