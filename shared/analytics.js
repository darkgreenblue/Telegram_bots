// shared/analytics.js — پایه‌ی رویدادها و اتریبیوشن (قرارداد CLAUDE.md ریشه، بند «داشبورد»)
// قوانین shared: بدون import از npm؛ دیتابیس (better-sqlite3) با dependency injection پاس داده می‌شود.
// خطای آنالیتیکس هرگز نباید فلوی محصول را بشکند: همه‌ی توابع نوشتنی fail-safe هستند (فقط logErr).
import { logErr } from './logger.js';

// نسخه‌ی قرارداد schema/رویدادها — کپی محلی voice2text و پورت پایتونی tabir-khab باید همین عدد را داشته باشند
export const ANALYTICS_SCHEMA_VERSION = 3;

// واژه‌نامه‌ی رویدادهای استاندارد (هسته‌ی مشترک بین همه‌ی ربات‌ها).
// همیشه از این ثابت‌ها استفاده کن، نه string خام — داشبورد رویدادهای خارج از واژه‌نامه را جدا نشان می‌دهد.
// رویدادهای اختصاصی هر ربات آزادند (snake_case) ولی نباید هم‌معنیِ یکی از این‌ها باشند.
export const EVENTS = {
  START: 'start',                       // هر /start (کاربر جدید و برگشتی) — props: {payload, kind, code}
  ONBOARD_DONE: 'onboard_done',         // پایان آنبوردینگ
  FIRST_VALUE: 'first_value',           // اولین ارزش واقعی که کاربر گرفت (فقط یک‌بار per کاربر — با trackOnce)
  PAYWALL_SHOWN: 'paywall_shown',       // نمایش پی‌وال — props: {price, can_afford, ...}
  RECHARGE_STARTED: 'recharge_started', // شروع فلوی شارژ
  RECEIPT_SUBMITTED: 'receipt_submitted',
  PAYMENT_APPROVED: 'payment_approved', // props: {amount, ...}
  PAYMENT_REJECTED: 'payment_rejected',
  PRODUCT_DELIVERED: 'product_delivered', // تحویل کامل محصول (فال/متن/رزومه) — props: {type, price, ...}
  REFUND: 'refund',
  FEEDBACK: 'feedback',                 // props: {kind}
  RESET: 'reset',
  AB_EXPOSURE: 'ab_exposure',           // فاز ۲ — shared/ab.js
};

// قرارداد payload لینک استارت (t.me/<bot>?start=PAYLOAD — سقف ۶۴ کاراکتر base64url):
//   c_<code>          → لینک کمپین (کد کوتاه base62؛ متادیتای کمپین سمت داشبورد است، ربات resolve نمی‌کند)
//   c_<code>_<post>   → همان کمپین + شناسه‌ی پستِ منبع (اتریبیوشن در سطح پست، شبیه utm_content)
//   r_<uid> یا ref_<uid> → رفرال (الگوی موجود tarot حفظ شده)
//   خالی               → organic
// هر لینک فقط یک payload دارد — کمپین و رفرال هرگز ترکیب نمی‌شوند.
//
// چرا شکلِ «کمپین + پست» و نه یک کد کمپینِ مستقل per پست: کد کمپین واحدِ کانال است و همه‌ی
// کوئری‌های موجودِ داشبورد روی `code` و `first_source='campaign:<code>'` می‌نشینند. اگر هر پست
// کد جدا می‌گرفت، هم آن کوئری‌ها کانال را تکه‌تکه می‌دیدند و هم جدول campaigns با ~۳۶۵۰ ردیف
// در سال منفجر می‌شد. این شکل، `code` را دست‌نخورده نگه می‌دارد و پست را در فیلدِ **جدید** `post`
// می‌گذارد: افزایشی، سازگار با گذشته، و بدون هیچ تغییری در معنیِ ستون‌های قبلی.
// شناسه‌ی پست: <YYMMDD>s<slot> (مثل 260801s4) — کوتاه، مرتب‌شدنی و قابلِ join با فایلِ پست در ریپو.
export function parseStartPayload(raw) {
  const payload = String(raw || '').trim().slice(0, 64);
  if (!payload) return { payload: '', kind: 'organic', code: '', post: '' };
  let m = payload.match(/^c_([A-Za-z0-9]{1,32})_([A-Za-z0-9]{1,24})$/);
  if (m) return { payload, kind: 'campaign', code: m[1], post: m[2] };
  m = payload.match(/^c_([A-Za-z0-9]{1,32})$/);
  if (m) return { payload, kind: 'campaign', code: m[1], post: '' };
  m = payload.match(/^r(?:ef)?_(\d+)$/);
  if (m) return { payload, kind: 'referral', code: m[1], post: '' };
  return { payload, kind: 'other', code: '', post: '' };
}

// کش prepared statement ها per اتصال db (بدون state سراسری — چند db در یک پروسه هم امن است)
const prepCache = new WeakMap();
function prep(db) {
  let c = prepCache.get(db);
  if (!c) {
    c = {
      insertEvent: db.prepare('INSERT INTO events (user_id, event, props) VALUES (?, ?, ?)'),
      hasEvent: db.prepare('SELECT 1 FROM events WHERE user_id=? AND event=? LIMIT 1'),
      setFirstSource: db.prepare(
        "UPDATE users SET first_source=?, first_payload=? WHERE telegram_id=? AND first_source=''"
      ),
      setFirstVersion: db.prepare(
        "UPDATE users SET first_version=? WHERE telegram_id=? AND first_version=''"
      ),
    };
    prepCache.set(db, c);
  }
  return c;
}

// ساخت idempotent جدول/ستون‌ها — بعد از CREATE TABLE users خود ربات صدا زده شود (boot)
export function ensureAnalytics(db) {
  db.pragma('busy_timeout = 5000'); // نویسنده‌ی دوم (داشبورد) هرگز نباید SQLITE_BUSY فوری بدهد
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      event      TEXT    NOT NULL,
      props      TEXT    NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_events_user  ON events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_event ON events(event, created_at);
  `);
  // اتریبیوشن write-once روی users (قرارداد: PK = telegram_id در همه‌ی ربات‌های Node)
  try { db.prepare("ALTER TABLE users ADD COLUMN first_source TEXT NOT NULL DEFAULT ''").run(); } catch {}
  try { db.prepare("ALTER TABLE users ADD COLUMN first_payload TEXT NOT NULL DEFAULT ''").run(); } catch {}
  // کوهورت نسخه: کاربر با کدام نسخه‌ی محصول شروع کرد (write-once؛ '' = قبل از ردیابی نسخه)
  try { db.prepare("ALTER TABLE users ADD COLUMN first_version TEXT NOT NULL DEFAULT ''").run(); } catch {}
}

// ثبت رویداد — سینکرون و fail-safe؛ props باید object سبک باشد (در DB به JSON تبدیل می‌شود)
export function track(db, userId, event, props) {
  try {
    prep(db).insertEvent.run(userId ?? null, event, props ? JSON.stringify(props) : '{}');
  } catch (e) { logErr('analytics track:', event, e.message); }
}

// ثبت فقط-یک‌بار per کاربر (برای first_value و امثال آن)
export function trackOnce(db, userId, event, props) {
  try {
    if (prep(db).hasEvent.get(userId, event)) return false;
    prep(db).insertEvent.run(userId, event, props ? JSON.stringify(props) : '{}');
    return true;
  } catch (e) { logErr('analytics trackOnce:', event, e.message); return false; }
}

// در /start صدا زده شود: (۱) رویداد start برای همه، همیشه — کمپین‌های برگشتی/re-engagement هم دیده شوند
// (۲) فقط برای کاربر جدید: first_source/first_payload و first_version (write-once؛ گارد در خود SQL است).
// version = ثابت PRODUCT_VERSION ربات (کوهورت «کاربر با کدام نسخه شروع کرد» — مقایسه‌ی رفتار قبل/بعد از هر تغییر).
// خروجی: نتیجه‌ی parseStartPayload تا ربات منطق خودش (مثل رفرال) را ادامه دهد.
export function captureStart(db, userId, rawPayload, isNew, version = '') {
  const parsed = parseStartPayload(rawPayload);
  try {
    if (isNew) {
      const src = parsed.kind === 'campaign' ? `campaign:${parsed.code}`
        : parsed.kind === 'referral' ? `referral:${parsed.code}`
        : parsed.kind === 'other' ? `other:${parsed.payload}`
        : 'organic';
      prep(db).setFirstSource.run(src, parsed.payload, userId);
      if (version) prep(db).setFirstVersion.run(String(version), userId);
    }
    track(db, userId, EVENTS.START, {
      payload: parsed.payload, kind: parsed.kind, code: parsed.code, new: !!isNew,
      ...(parsed.post ? { post: parsed.post } : {}),
      ...(version ? { v: String(version) } : {}),
    });
  } catch (e) { logErr('analytics captureStart:', e.message); }
  return parsed;
}
