// دیتابیس خودِ داشبورد (platform.db): کمپین‌ها، تنظیمات، دفتر ممیزی (audit)
// ربات‌ها هرگز این DB را نمی‌خوانند — join کمپین↔دیتای ربات فقط سمت داشبورد انجام می‌شود.
import { mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';

mkdirSync('./data', { recursive: true });
export const pdb = new Database('./data/platform.db');
pdb.pragma('journal_mode = WAL');
pdb.pragma('busy_timeout = 5000');
pdb.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL UNIQUE,
    bot        TEXT    NOT NULL,
    source     TEXT    NOT NULL DEFAULT '',
    medium     TEXT    NOT NULL DEFAULT '',
    name       TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT    NOT NULL,
    target     TEXT    NOT NULL DEFAULT '',
    details    TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const st = {
  insertCampaign: pdb.prepare('INSERT INTO campaigns (code, bot, source, medium, name, notes) VALUES (?,?,?,?,?,?)'),
  listCampaigns: pdb.prepare('SELECT * FROM campaigns ORDER BY id DESC'),
  getCampaign: pdb.prepare('SELECT * FROM campaigns WHERE id=?'),
  setCampaignActive: pdb.prepare('UPDATE campaigns SET is_active=? WHERE id=?'),
  getSetting: pdb.prepare('SELECT value FROM settings WHERE key=?'),
  setSetting: pdb.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
  insertAudit: pdb.prepare('INSERT INTO audit_log (action, target, details) VALUES (?,?,?)'),
  listAudit: pdb.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'),
};

// کد کمپین: base62 پنج‌کاراکتری — کوتاه (سقف ۶۴ کاراکتریِ payload تلگرام) و غیرقابل‌حدس
const B62 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // بدون I/l/O/0/1 (خطای تایپی)
function genCode(len = 5) {
  const buf = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += B62[buf[i] % B62.length];
  return s;
}

export function createCampaign({ bot, source, medium, name, notes }) {
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    try {
      const id = Number(st.insertCampaign.run(code, bot, source || '', medium || '', name || '', notes || '').lastInsertRowid);
      return st.getCampaign.get(id);
    } catch (e) { if (!/UNIQUE/.test(e.message)) throw e; }
  }
  throw new Error('کد یکتا ساخته نشد');
}
export const listCampaigns = () => st.listCampaigns.all();
export const getCampaign = (id) => st.getCampaign.get(id);
export const setCampaignActive = (id, active) => st.setCampaignActive.run(active ? 1 : 0, id);

export const getSetting = (key, fallback = '') => st.getSetting.get(key)?.value ?? fallback;
export const setSetting = (key, value) => st.setSetting.run(key, String(value ?? ''));

// دفتر ممیزی: هر write و هر export باید ثبت شود (قابل مشاهده در صفحه‌ی مالی/پایین داشبورد)
export const audit = (action, target = '', details = '') =>
  st.insertAudit.run(action, String(target).slice(0, 200), String(details).slice(0, 1000));
export const listAudit = (limit = 50) => st.listAudit.all(limit);
