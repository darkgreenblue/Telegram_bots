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
  -- ژورنال محصول: تاریخچه‌ی نسخه‌ها و اینسایت‌ها (بایگانی خواسته‌شده در طرح)
  CREATE TABLE IF NOT EXISTS product_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bot         TEXT    NOT NULL,
    label       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    git_ref     TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS insights (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    bot            TEXT    NOT NULL DEFAULT '',
    text           TEXT    NOT NULL,
    experiment_key TEXT    NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );
  -- rollup ماهیانه/روزانه‌ی رویدادها (سیاست retention — جارو در lib/maintenance.js)
  /* 🧾 پرداخت‌های سرگردان — پولی که کارت‌به‌کارت رسیده ولی کاربر رسیدش را به ربات
     نفرستاده، پس در جدولِ payments ربات **هیچ ردیفی ندارد** و از درآمد غایب است.
     ⚠️ عمداً این‌جاست نه در دیتابیسِ ربات: ردیفی با user_id جعلی در جدولِ پولِ ربات
     هر گزارشِ کاربرمحوری را بی‌صدا خراب می‌کند (ARPU، خریداران، تایم‌لاین). این دیتای
     **مدیریتیِ داشبورد** است و ربات هرگز نمی‌خواندش.
     status سه حالت دارد و تفاوتشان حسابداری است نه توصیفی:
       orphan            صاحبش پیدا نشده — در درآمد **می‌آید**
       resolved_support  به پشتیبانی پیام داد و الماسش را گرفت — در درآمد **می‌ماند**
                           (پرداختش هیچ‌وقت در ربات ثبت نشد؛ حذفش یعنی پول ناپدید شود)
       resolved_late     رسید را دیر به ربات فرستاد — از درآمد **خارج می‌شود**
                           (ردیفِ واقعی‌اش حالا در payments ربات است؛ ماندنش دوباره‌شماری) */
  CREATE TABLE IF NOT EXISTS orphan_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bot         TEXT    NOT NULL,
    amount      INTEGER NOT NULL,
    paid_at     INTEGER NOT NULL,
    pkg         TEXT    NOT NULL DEFAULT '',
    coins       INTEGER NOT NULL DEFAULT 0,
    ref         TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT '',
    shot        TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'orphan',
    owner_id    INTEGER,
    resolved_at INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_orphan_bot ON orphan_payments(bot, status);

  /* 📣 هزینه‌ی تبلیغِ **per روز** — ورودیِ دستیِ مالک.
     چرا روزانه و نه یک عددِ ثابت (خواسته‌ی صریحِ مالک ۱۴۰۵/۰۶/۱۶): کمپین‌ها هر روز
     ران‌اند و مدام بهینه می‌شوند، پس هزینه‌ی جذبِ هر کاربر روزِ اولِ کمپین با روزِ دهم
     یکی نیست. یک عددِ ثابت یعنی هزینه‌ی روزهای گران را کم و روزهای ارزان را زیاد
     نشان بدهیم — و چون هر دو خطا در یک عددِ «میانگین» گم می‌شوند، هیچ‌وقت دیده نمی‌شود.
     کلیدِ ردیف (bot, day) است چون هر ربات کمپینِ خودش را دارد. ستونِ day رشته‌ی
     YYYY-MM-DD به **مرزِ روزِ تهران** است، دقیقاً همان کلیدی که سریِ سود با آن
     ساخته می‌شود؛ هر واحدِ دیگری یعنی ردیف‌ها سرِ نیمه‌شب به روزِ اشتباه بچسبند. */
  CREATE TABLE IF NOT EXISTS campaign_costs (
    bot        TEXT NOT NULL,
    day        TEXT NOT NULL,
    usd        REAL NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (bot, day)
  );

  CREATE TABLE IF NOT EXISTS events_rollup (
    bot   TEXT    NOT NULL,
    day   TEXT    NOT NULL,
    event TEXT    NOT NULL,
    users INTEGER NOT NULL DEFAULT 0,
    cnt   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bot, day, event)
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

/* ---- ژورنال محصول ---- */
export const addVersion = (bot, label, description, gitRef) =>
  pdb.prepare('INSERT INTO product_versions (bot, label, description, git_ref) VALUES (?,?,?,?)')
    .run(bot, label.slice(0, 100), (description || '').slice(0, 1000), (gitRef || '').slice(0, 60));
export const listVersions = (limit = 100) =>
  pdb.prepare('SELECT * FROM product_versions ORDER BY id DESC LIMIT ?').all(limit);
export const addInsight = (bot, text, experimentKey) =>
  pdb.prepare('INSERT INTO insights (bot, text, experiment_key) VALUES (?,?,?)')
    .run(bot || '', text.slice(0, 2000), (experimentKey || '').slice(0, 64));
export const listInsights = (limit = 100) =>
  pdb.prepare('SELECT * FROM insights ORDER BY id DESC LIMIT ?').all(limit);

/* ═══ 🧾 پرداخت‌های سرگردان ═══
   جزئیاتِ حسابداری و معنیِ سه وضعیت، بالای تعریفِ جدول. */

/** وضعیت‌هایی که در درآمد شمرده می‌شوند (سرگردان + حل‌شده از راهِ پشتیبانی). */
export const ORPHAN_REVENUE_STATES = ['orphan', 'resolved_support'];

export const addOrphan = ({ bot, amount, paidAt, pkg = '', coins = 0, ref = '', note = '', shot = '' }) =>
  pdb.prepare(`INSERT INTO orphan_payments (bot, amount, paid_at, pkg, coins, ref, note, shot)
               VALUES (?,?,?,?,?,?,?,?)`)
    .run(bot, amount, paidAt, pkg, coins, ref, note, shot).lastInsertRowid;

export const listOrphans = (bot, { status = '' } = {}) => (status
  ? pdb.prepare('SELECT * FROM orphan_payments WHERE bot=? AND status=? ORDER BY paid_at DESC, id DESC').all(bot, status)
  : pdb.prepare('SELECT * FROM orphan_payments WHERE bot=? ORDER BY paid_at DESC, id DESC').all(bot));

export const getOrphan = (id) => pdb.prepare('SELECT * FROM orphan_payments WHERE id=?').get(id);

/** گذارِ اتمیک به یک وضعیتِ حل‌شده — فقط از `orphan`، پس دوبار زدنِ دکمه بی‌اثر است. */
export const resolveOrphan = (id, status, ownerId = null) =>
  pdb.prepare(`UPDATE orphan_payments SET status=?, owner_id=?, resolved_at=unixepoch()
               WHERE id=? AND status='orphan'`).run(status, ownerId, id).changes;

export const deleteOrphan = (id) => pdb.prepare('DELETE FROM orphan_payments WHERE id=?').run(id).changes;

/* درآمدِ سرگردانِ یک ربات در یک بازه، گروه‌شده per روزِ تهران.
   ⚠️ خروجی عمداً `Map` از «روز → تومان» است، نه یک عددِ کل: مصرف‌کننده‌اش سریِ روزانه‌ی
   سود است و اگر عددِ کل می‌داد، باید به یک روزِ دلبخواه می‌چسبید. */
/* ── 📣 هزینه‌ی تبلیغِ روزانه: خواندن، نوشتن، پاک‌کردن ──
   ⚠️ «پاک‌کردن» عمداً با «صفر» یکی نیست و این تفاوت معنادار است: `usd = 0` یعنی
   «آن روز تبلیغ نداشتم، پس هزینه‌اش واقعاً صفر بود»، ولی **نبودِ ردیف** یعنی «نمی‌دانم»
   و آن روز میانگین را می‌گیرد. اگر این دو یکی می‌شدند، هر روزِ واردنشده بی‌صدا صفر
   حساب می‌شد و سود سیستماتیک خوش‌بینانه می‌شد. */
export const setCampaignCost = (bot, day, usd) =>
  pdb.prepare(`INSERT INTO campaign_costs (bot, day, usd, updated_at) VALUES (?,?,?,unixepoch())
    ON CONFLICT(bot, day) DO UPDATE SET usd=excluded.usd, updated_at=unixepoch()`).run(bot, day, usd).changes;

export const clearCampaignCost = (bot, day) =>
  pdb.prepare('DELETE FROM campaign_costs WHERE bot=? AND day=?').run(bot, day).changes;

export const getCampaignCost = (bot, day) =>
  pdb.prepare('SELECT usd FROM campaign_costs WHERE bot=? AND day=?').get(bot, day)?.usd ?? null;

/** همه‌ی روزهای واردشده‌ی یک ربات، به‌صورتِ Map از `YYYY-MM-DD` به دلار. */
export function campaignCostDays(bot) {
  const out = new Map();
  for (const r of pdb.prepare('SELECT day, usd FROM campaign_costs WHERE bot=? ORDER BY day').all(bot)) {
    out.set(r.day, Number(r.usd) || 0);
  }
  return out;
}

export function orphanRevenueByDay(bot, sinceSec = 0) {
  const q = ORPHAN_REVENUE_STATES.map(() => '?').join(',');
  const out = new Map();
  for (const r of pdb.prepare(
    `SELECT paid_at, amount FROM orphan_payments
      WHERE bot=? AND status IN (${q}) AND paid_at >= ?`).all(bot, ...ORPHAN_REVENUE_STATES, sinceSec)) {
    const d = new Date((r.paid_at + 12600) * 1000).toISOString().slice(0, 10);
    out.set(d, (out.get(d) || 0) + (Number(r.amount) || 0));
  }
  return out;
}
