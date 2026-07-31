// index.js — ربات فال تاروت فارسی 🔮
//
// بازسازی سفر مشتریِ یک تاروت‌خوان حرفه‌ای در تلگرام (۵ مرحله):
//  ۱) پیش‌جلسه: پرسشنامه‌ی تمرکز + سؤال کاربر (متن/ویس)
//  ۲) فضاسازی: مدیریت انتظارات + تمرین تنفس
//  ۳) خوانش: بُر زدن با توقفِ کاربر → انتخاب ۳ کارت از گرید ۲۴تایی →
//     پی‌وال دقیقاً قبل از افشا (اوج کنجکاوی) → افشای مرحله‌ای با spoiler →
//     حلقه‌ی بازخورد وسط خوانش (پاسخ منفی = فراخوانی کوچک تصحیح)
//  ۴) پایان‌بندی: روایت پیوندی + سه قدم عملی + جمله‌ی توانمندساز
//  ۵) قلاب بازگشت: مدیاگروپ یادگاری + milestone ۱۴روزه + کد تخفیف اولین خرید + رفرال
//
// مغز فالگیر: google/gemini-2.5-flash (OpenRouter) — تک‌فراخوانی per فال، پیش‌فراخوانی بعد از انتخاب کارت سوم.
// چندزبانه: همه‌ی متن‌ها/پرامپت‌ها از locales/<LOCALE>.js؛ هر زبان بعداً یک اپ pm2 جدا با ENV_FILE خودش.
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import { mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import CARDS, { CARD_BY_KEY } from './cards.js';
import SPREADS, { DAILY, SPREAD_BY_ID } from './spreads.js';
import { log, logErr } from '../../shared/logger.js';
import { registerGlobalErrorHandlers } from '../../shared/errors.js';
import { EVENTS, ensureAnalytics, track, trackOnce, captureStart } from '../../shared/analytics.js';
import { ensureAb, variant } from '../../shared/ab.js';
// پشتیبانی مشترکِ همه‌ی ربات‌ها (حساب + کدِ پیگیری + لینکِ پیامِ آماده) — متن‌ها از locale می‌آیند
import { registerSupport, supportRow } from '../../shared/support.js';
// ثبتِ خودکارِ مسیرِ ریزِ کاربر (view/act) — قیفِ ریزِ داشبورد از همین تغذیه می‌شود
import { registerJourney } from '../../shared/journey.js';
import { analyzeReceipt, decideReceipt } from './cardpay.js';

/* ===== 1) ENV و ثابت‌ها ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { logErr('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const LOCALE = process.env.LOCALE?.trim() || 'fa';
const L = (await import(`./locales/${LOCALE}.js`)).default;
const fmt = L.fmt;
// فال حافظ: دیتای استاتیک (فقط fa؛ زبان‌های دیگر بدون فایل = فیچر خودکار غیرفعال)
const HAFEZ = await import(`./hafez.js`).then(m => m.default.ghazals).catch(() => []);
// کوییز «کدام کارتِ تاروتی؟»: متنِ شخصیتی per کارتِ آرکانای بزرگ (سؤال‌ها/امتیازدهی در locale)
const QUIZ = await import(`./quiz.js`).then(m => m.default.personalities).catch(() => ({}));

const FLASH          = 'google/gemini-2.5-flash';
const FALLBACK_MODEL = 'deepseek/deepseek-v3.2'; // هم‌سطح Flash و ارزان‌تر — وقتی Flash بعد از ۳ تلاش جواب نداد
const OR_TIMEOUT_MS  = 10 * 60 * 1000;
const MAX_VOICE_SEC  = 120;              // سقف طول ویسِ سؤال — جلوی هزینه‌ی رونویسیِ نامحدود قبل از پرداخت
const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_PREFETCH_PER_DAY = 15;         // سقف پیش‌فراخوانی LLM per کاربر — ضد حلقه‌ی «انتخاب کن، لغو کن»

// ⚠️ TEST_PHASE: تا وقتی true است دکمه‌ی «ریست ربات (تست)» برای همه فعال است.
// false = ربات زنده (لانچ ۱۴۰۵/۰۴/۲۰): دکمه کلاً مخفی؛ /reset فقط برای OWNER می‌ماند.
const TEST_PHASE = false;

// نسخه‌ی محصول (کوهورت users.first_version): با هر تغییر «رفتاری» رو-به-کاربر bump کن — بند «قوانین ربات زنده» CLAUDE.md ریشه
// 1.1.0: رسیدِ پرداخت از ایجنتِ کارت‌به‌کارت (auto-approve + برگشت/بی‌اعتمادی) رد می‌شود.
// 1.1.1: فلوی رسید انسانی‌تر شد (پیامِ «فرستاده شد» + تأخیرِ ۳ تا ۱۰ ثانیه، بدونِ لوکنندنِ ایجنت)
//        + گاردِ قطعیِ مبلغِ بیشتر (پرداختِ اضافه → تأیید، نه رد) + تضمینِ اطلاع‌رسانیِ رد به کاربر.
// 1.1.2: فقط دو پیامِ نهاییِ رسید (تأیید/رد یکپارچه با پشتیبانی @Efficient_Support، بدونِ «رسید نیست»/دلیل)
//        + دکمه‌ی «کپی شماره کارت» (copy_text) زیرِ فاکتورهای کارت‌به‌کارت.
// 1.3.0: ناوبری درختی + گاردِ فلوی بازِ پرداخت (قرارداد State Management یکپارچه) — پشتِ NAV_GUARD_ENABLED.
// 1.3.1: پالایشِ کپیِ آنبوردینگ/خوانش — دکمه‌ی سوم «همه فال‌ها»، کارت روز در کاتالوگ،
//        آشکارسازیِ کیبورد بعد از «یه قرار کوچیک»، انتقال جمله‌ی فضای امن به قبلِ نوشتنِ سؤال.
// 1.4.0: استیت‌های ورودی (askQuestion/askTopic) دیگر دکمه ندارند (تمرکز روی نوشتن) + گاردِ «فالِ باز»
//        (blockDuringOpenReading) با دو دکمه‌ی «ادامه/انصراف» — قرارداد State Management بند ۹ب.
// 1.5.0: دکمه‌ی «💬 پشتیبانی» در منوی اصلی (مشترکِ همه‌ی ربات‌ها) — لینکِ چتِ پشتیبانی با
//        پیامِ آماده‌ی حاویِ کدِ پیگیریِ #TRT-<user_id> (shared/support.js).
// 1.6.0: بازطراحیِ پی‌والِ کم‌موجودی (بزرگ‌ترین نقطه‌ی ریزش): پیامِ کوتاهِ شخصی‌شده با تعدادِ
//        کارت و قیمت، تخفیف از پیام حذف و پشتِ دکمه‌ی «تخفیف می‌خوام» رفت، تخفیفِ اولین شارژ
//        ۳۵٪→۵۰٪ و دیگر خودکار نیست (کدِ شخصیِ کپی‌شدنی)، و برای کاربرِ شارژکرده مسیر دعوت دوستان.
// 1.6.1: سه فیکسِ ریلِ پرداخت (از تحلیلِ جرنیِ یک کاربرِ واقعی): کدِ تخفیفِ اشتباه دیگر کاربر را
//        از مرحله‌ی کد بیرون نمی‌اندازد، متنی که خودش یک کدِ تخفیف است دیگر «رسید» حساب نمی‌شود،
//        و شروعِ فالِ جدید وقتی فالِ رزروشده منتظرِ پرداخت است دیگر آن را بی‌صدا یتیم نمی‌کند.
// 1.6.2: کدِ تخفیفِ اولین شارژ دیگر با یک فاکتورِ رهاشده برای همیشه قفل نمی‌شود (فاکتورِ
//        pending بدونِ رسید عملاً غیرقابل‌دسترس است و نباید کد را نگه دارد)، پیامِ «قبلاً
//        استفاده شده» از «نامعتبر» جدا شد، و پیشنهادِ کد با پذیرشِ کد هم‌شرط شد.
const PRODUCT_VERSION = '1.6.2';
const FOCUS_REASK_DAYS = 7; // حوزه‌ی تمرکز حداکثر هفته‌ای یک‌بار دوباره پرسیده می‌شود (نه هر فال)

// 🎁 منوی سرگرمی‌های رایگان (کارت روز + فال حافظ؛ قلاب بازگشت روزانه بدون LLM).
// فعلاً خاموش عرضه می‌شود (dark launch): merge روی ربات زنده هیچ تغییرِ رفتاری نمی‌دهد.
// روشن‌کردن = یک‌خط true + bump PRODUCT_VERSION به 1.1.0 در همان PR (تغییرِ رفتاری).
// Rollback فوری: دوباره false کن → دکمه‌ی کیبورد، منو و همه‌ی callbackها محو و رفتار دقیقاً مثل قبل.
const FREE_MENU_ENABLED = false;

// 🌀 فال با موضوع آزاد: به کاربر سیگنال می‌دهد می‌تواند درباره‌ی «هر موضوعی» فال بگیرد (نه فقط کاتالوگ ثابت).
// Rollback فوری: این را false کن → دکمه و کپی‌های موضوع آزاد کاملاً محو می‌شوند و رفتار دقیقاً مثل قبل می‌شود
// (فال‌های open3/open5 که قبلاً ثبت شده‌اند بی‌ضرر در DB می‌مانند؛ پایپ‌لاین افشا از SPREAD_BY_ID می‌خواند).
const OPEN_TOPIC_ENABLED = true;

// 🧭 ناوبری درختی + گاردِ فلوی باز (قرارداد State Management، CLAUDE.md ریشه): هر استیتِ میانیِ فلو دکمه‌ی
// «بازگشت به منو» می‌گیرد، و پرداختِ باز دکمه‌های منو را بلاک می‌کند (پیام «فاکتور باز داری» + انصراف)
// به‌جای یتیم‌کردنِ بی‌صدای فاکتور. Rollback فوری: false کن → دکمه‌های nav و گارد محو، رفتار دقیقاً مثل قبل
// (callbackِ nav:menu ثبت‌شده می‌ماند تا دکمه‌ی کش‌شده هم بی‌خطر باشد).
const NAV_GUARD_ENABLED = true;

// 🧭 ثبتِ خودکارِ مسیرِ ریزِ کاربر (shared/journey.js): هر پیامِ خروجی (`view`) و هر اکشنِ ورودی
// (`act`) ثبت می‌شود تا در داشبورد بشود دید کاربر دقیقاً پشتِ کدام پیام/دکمه ریخته است.
// کاملاً fail-safe و بدونِ هیچ اثرِ رو-به-کاربر. Rollback فوری: false کن → هیچ رویدادِ ریزی
// ثبت نمی‌شود و هیچ متدی رپ نمی‌شود (رفتار دقیقاً مثل قبل؛ دیتای ثبت‌شده بی‌ضرر می‌ماند).
const JOURNEY_ENABLED = true;

// ادمین‌ها از env (کامای ADMIN_IDS که deploy از OWNER_TELEGRAM_ID می‌سازد) — مشترک با بقیه‌ی ربات‌ها
const ADMIN_IDS = (process.env.ADMIN_IDS || '100257975')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
const OWNER_ID  = ADMIN_IDS[0] || 100257975;
const isAdmin = (uid) => ADMIN_IDS.includes(uid);

const CARD_NUMBER = '6219861904145405';
const CARD_OWNER  = 'علیرضا اولیا — بلوبانک';
const CARD_RECIPIENT_NAME = 'علیرضا اولیا';   // نامِ گیرنده (تطبیق در ایجنتِ رسید)
const CARD_DEST_LAST4     = '5405';            // چهار رقمِ آخرِ کارتِ مقصد (تطبیق در ایجنتِ رسید)

// ایجنتِ رسیدِ کارت‌به‌کارت (Gemini Flash از طریق OpenRouter): auto-approve با شبکه‌ی ایمنیِ
// برگشت + بی‌اعتمادی. کلیدِ خاموشیِ سراسری (env RECEIPT_AI_AUTO_APPROVE=false → همه‌ی رسیدها
// دستی به ادمین می‌روند، بدون تصمیمِ خودکار). پیش‌فرض: روشن.
const RECEIPT_AI_AUTO_APPROVE = (process.env.RECEIPT_AI_AUTO_APPROVE ?? 'true').toLowerCase() !== 'false';
const RECEIPT_MODEL = FLASH;
// دکمه‌ی کپیِ شماره کارت (Telegram copy_text — کلیک = کپی به کلیپ‌بورد). قاعده‌ی سراسری:
// هر پیامِ پرداختِ کارت‌به‌کارت که شماره کارت را نشان می‌دهد باید این دکمه را زیرش داشته باشد.
const cardCopyRow = () => [{ text: '📋 کپی شماره کارت', copy_text: { text: CARD_NUMBER } }];

// هدیه‌ی خوش‌آمد حذف شد: مسیر رایگان فقط «کارت روز» است؛ حداقل مبلغ شارژ هم نداریم
const QUICK_AMOUNTS    = [50_000, 100_000, 200_000];
// هدیه‌ی شارژ (ARPU بالاتر): مبلغ‌های بزرگ‌تر، هدیه‌ی بیشتر — از بزرگ به کوچک چک می‌شود
const RECHARGE_BONUS   = [{ min: 200_000, bonus: 30_000 }, { min: 100_000, bonus: 10_000 }];
const bonusFor = (amount) => RECHARGE_BONUS.find(t => amount >= t.min)?.bonus || 0;
const STREAK_EVERY     = 7;       // هر ۷ روز پیاپیِ کارت روز → جایزه
const STREAK_REWARD    = 5_000;
const REFERRAL_BONUS   = 10_000;
// هدیه‌ی اولین اقدام به شارژ: **هرگز خودکار اعمال نمی‌شود**. فقط وقتی کاربر روی دکمه‌ی
// «تخفیف می‌خوام» بزند یک کدِ شخصی می‌گیرد و خودش هنگام پرداخت واردش می‌کند (تخفیف پشتِ
// دکمه = کاربرِ آماده‌ی پرداخت حواسش پرت نمی‌شود). بعد از اولین شارژِ تأییدشده کد بی‌اثر است.
const FIRST_RECHARGE_DISCOUNT = { percent: 50, cap: 100_000 };
const MILESTONE_DAYS   = 14;
const PUSH_COOLDOWN_S  = 7 * 24 * 3600; // حداکثر یک پوش پیشگیرانه در هفته
const REVERSAL_PROB    = 0.3;
const GRID_SIZE        = 24; // ۶ ردیف × ۴
const USER_PICKS       = 3;  // حداکثر تعداد انتخاب کاربر از گرید (فال کوچک‌تر = به تعداد خودش)

const PACE_S = 1200, PACE_M = 2500, PACE_REVEAL = 3500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ===== 2) Database ===== */
mkdirSync('./data', { recursive: true });
const db = new Database(`./data/bot-${LOCALE}.db`);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id       INTEGER PRIMARY KEY,
    name              TEXT    NOT NULL DEFAULT '',
    username          TEXT    NOT NULL DEFAULT '',
    state             TEXT    NOT NULL DEFAULT 'new',
    balance           INTEGER NOT NULL DEFAULT 0,
    focus_area        TEXT    NOT NULL DEFAULT '',
    last_daily_date   TEXT    NOT NULL DEFAULT '',
    session_json      TEXT    NOT NULL DEFAULT '',
    next_milestone_at INTEGER,
    last_push_at      INTEGER NOT NULL DEFAULT 0,
    referred_by       INTEGER,
    welcomed          INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen         INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT    NOT NULL,
    price       INTEGER NOT NULL,
    focus_area  TEXT    NOT NULL DEFAULT '',
    question    TEXT    NOT NULL DEFAULT '',
    seed        TEXT    NOT NULL DEFAULT '',
    cards_json  TEXT    NOT NULL DEFAULT '',
    llm_json    TEXT    NOT NULL DEFAULT '',
    summary     TEXT    NOT NULL DEFAULT '',
    feedback    TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending_payment',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    amount           INTEGER NOT NULL DEFAULT 0,
    status           TEXT    NOT NULL DEFAULT 'pending',
    step             TEXT,
    receipt_file_id  TEXT,
    admin_message_id INTEGER,
    discount_code_id INTEGER,
    original_amount  INTEGER,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS discount_codes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT    NOT NULL UNIQUE,
    discount_percent  INTEGER NOT NULL,
    expires_at        INTEGER,
    max_uses_per_user INTEGER NOT NULL DEFAULT 1,
    only_user_id      INTEGER,
    is_active         INTEGER NOT NULL DEFAULT 1,
    total_uses        INTEGER NOT NULL DEFAULT 0,
    created_by        INTEGER NOT NULL,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS discount_uses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id         INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    payment_id      INTEGER,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    used_at         INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS referrals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referee_id  INTEGER NOT NULL UNIQUE,
    rewarded    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS card_files (
    card_key   TEXT PRIMARY KEY,
    file_id    TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS daily_texts (
    card_key   TEXT    NOT NULL,
    reversed   INTEGER NOT NULL,
    focus      TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (card_key, reversed, focus)
  );
`);
// migration: حافظه‌ی انباشتی کاربر (پروفایل شناختی برای پیوستگی بین جلسات)
try { db.prepare("ALTER TABLE users ADD COLUMN memory_json TEXT NOT NULL DEFAULT ''").run(); } catch {}
// migration: شمارنده‌ی روزهای پیاپی کارت روز (موتور عادت روزانه)
try { db.prepare('ALTER TABLE users ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0').run(); } catch {}
// migration: نام فارسیِ خودِ کاربر (جدا از first_name تلگرام که ممکن است انگلیسی/نامفهوم باشد و مدل تکرارش کند)
try { db.prepare("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''").run(); } catch {}
// migration: آخرین روزِ گرفتنِ فال حافظ (قلاب رایگانِ روزانه، مستقل از کارت روز)
try { db.prepare("ALTER TABLE users ADD COLUMN last_hafez_date TEXT NOT NULL DEFAULT ''").run(); } catch {}
// migration: سقفِ نرمِ استخاره‌ی روزانه (تاریخ + شمارنده؛ صفر می‌شود در روزِ نو)
try { db.prepare("ALTER TABLE users ADD COLUMN estekhare_date TEXT NOT NULL DEFAULT ''").run(); } catch {}
try { db.prepare('ALTER TABLE users ADD COLUMN estekhare_count INTEGER NOT NULL DEFAULT 0').run(); } catch {}
// migration: آخرین روزِ کوییزِ «کدام کارتِ تاروتی؟» (تکرارِ ماهی‌یک‌بار)
try { db.prepare("ALTER TABLE users ADD COLUMN last_quiz_date TEXT NOT NULL DEFAULT ''").run(); } catch {}
// migration: آخرین روزِ فالِ قهوه (رایگانِ روزی‌یک‌بار)
try { db.prepare("ALTER TABLE users ADD COLUMN last_coffee_date TEXT NOT NULL DEFAULT ''").run(); } catch {}
// migration: سقف مبلغ تخفیف per کد (۲۰٪ تا سقف ۱۰۰k برای کد شخصی کارت روز)
try { db.prepare('ALTER TABLE discount_codes ADD COLUMN max_discount_amount INTEGER').run(); } catch {}
// یادآوری رسید معطل + صف اکشن ادمینِ داشبورد (مثل voice2text)
try { db.prepare('ALTER TABLE payments ADD COLUMN reminded_at INTEGER').run(); } catch {}
// کاربرِ «بی‌اعتماد»: بعد از یک برگشتِ پرداخت (رسیدِ فیک)، ایجنت دیگر برایش خودکار تصمیم نمی‌گیرد
// و همه‌ی پرداخت‌هایش دستی به ادمین می‌رود. (status پرداخت می‌تواند 'reversed' هم بشود — بدونِ تغییرِ schema.)
try { db.prepare('ALTER TABLE users ADD COLUMN pay_distrust INTEGER NOT NULL DEFAULT 0').run(); } catch {}
// آخرین باری که حوزه‌ی تمرکز پرسیده شد (برای بازپرسیِ حداکثر هفته‌ای‌یک‌بار؛ نه هر فال)
try { db.prepare('ALTER TABLE users ADD COLUMN focus_asked_at INTEGER NOT NULL DEFAULT 0').run(); } catch {}
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL, action TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'dashboard', created_at INTEGER NOT NULL DEFAULT (unixepoch()), done_at INTEGER
  );
`);
// آنالیتیکس مشترک: جدول events + ستون‌های اتریبیوشن first_source/first_payload روی users
ensureAnalytics(db);
// A/B تست: جدول‌های experiments/ab_exposures (config توسط داشبورد نوشته می‌شود؛ ربات فقط می‌خواند)
ensureAb(db);

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()
  `),
  getUser:    db.prepare('SELECT * FROM users WHERE telegram_id=?'),
  setState:   db.prepare('UPDATE users SET state=?, last_seen=unixepoch() WHERE telegram_id=?'),
  setFocus:   db.prepare('UPDATE users SET focus_area=?, focus_asked_at=unixepoch() WHERE telegram_id=?'),
  setDisplayName: db.prepare('UPDATE users SET display_name=? WHERE telegram_id=?'),
  setWelcomed: db.prepare('UPDATE users SET welcomed=1 WHERE telegram_id=?'),
  setSession: db.prepare('UPDATE users SET session_json=? WHERE telegram_id=?'),
  setDaily:   db.prepare('UPDATE users SET last_daily_date=?, daily_streak=? WHERE telegram_id=?'),
  setHafez:   db.prepare('UPDATE users SET last_hafez_date=? WHERE telegram_id=?'),
  setEstekhare: db.prepare('UPDATE users SET estekhare_date=?, estekhare_count=? WHERE telegram_id=?'),
  setQuiz:    db.prepare('UPDATE users SET last_quiz_date=? WHERE telegram_id=?'),
  setCoffee:  db.prepare('UPDATE users SET last_coffee_date=? WHERE telegram_id=?'),
  readingsByStatus: db.prepare('SELECT status, COUNT(*) AS c FROM readings GROUP BY status'),
  setMilestone: db.prepare('UPDATE users SET next_milestone_at=? WHERE telegram_id=?'),
  setPush:    db.prepare('UPDATE users SET last_push_at=unixepoch(), next_milestone_at=NULL WHERE telegram_id=?'),
  setReferredBy: db.prepare('UPDATE users SET referred_by=? WHERE telegram_id=?'),
  credit:     db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id=?'),
  deduct:     db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id=? AND balance >= ?'),
  dueMilestones: db.prepare(`
    SELECT telegram_id FROM users
    WHERE next_milestone_at IS NOT NULL AND next_milestone_at <= unixepoch()
      AND last_push_at < unixepoch() - ${PUSH_COOLDOWN_S}
    LIMIT 20
  `),

  insertReading: db.prepare(`INSERT INTO readings (user_id, type, price, focus_area, question, seed, cards_json) VALUES (?,?,?,?,?,?,?)`),
  getReading:    db.prepare('SELECT * FROM readings WHERE id=?'),
  setReadingLlm: db.prepare('UPDATE readings SET llm_json=?, summary=? WHERE id=?'),
  setReadingStatus: db.prepare('UPDATE readings SET status=? WHERE id=?'),
  setReadingFeedback: db.prepare('UPDATE readings SET feedback=? WHERE id=?'),
  lastDelivered: db.prepare("SELECT * FROM readings WHERE user_id=? AND status='delivered' ORDER BY id DESC LIMIT ?"),
  countReadingsToday: db.prepare('SELECT COUNT(*) AS c FROM readings WHERE user_id=? AND created_at >= unixepoch()-86400'),
  countDelivered: db.prepare("SELECT COUNT(*) AS c FROM readings WHERE user_id=? AND status='delivered'"),
  countPaidDelivered: db.prepare("SELECT COUNT(*) AS c FROM readings WHERE user_id=? AND status='delivered' AND price>0"),
  readingsByType: db.prepare("SELECT type, COUNT(*) AS c, COALESCE(SUM(price),0) AS s FROM readings WHERE status='delivered' GROUP BY type"),

  insertPayment: db.prepare("INSERT INTO payments (user_id, amount, step) VALUES (?, 0, 'amount')"),
  getPayment:    db.prepare('SELECT * FROM payments WHERE id=?'),
  setPaymentAmount:  db.prepare("UPDATE payments SET amount=?, step=?, updated_at=unixepoch() WHERE id=?"),
  // ادعای اتمیک مبلغ: فقط اگر هنوز در مرحله‌ی «amount» است (ضد دابل‌تپِ دو مبلغِ متفاوت — دکمه یا متن)
  claimAmount: db.prepare("UPDATE payments SET amount=?, step='receipt', updated_at=unixepoch() WHERE id=? AND step='amount' AND status='pending'"),
  setPaymentStatus:  db.prepare('UPDATE payments SET status=?, updated_at=unixepoch() WHERE id=?'),
  setPaymentReceipt: db.prepare('UPDATE payments SET receipt_file_id=?, admin_message_id=?, status=?, updated_at=unixepoch() WHERE id=?'),
  // ذخیره‌ی خودِ رسید بدونِ تغییرِ وضعیت (مسیرِ auto-approve/reject؛ waiting_review را sendReceiptToAdmin می‌زند)
  saveReceiptFile: db.prepare('UPDATE payments SET receipt_file_id=?, updated_at=unixepoch() WHERE id=?'),
  // برگشتِ پرداخت — فقط از approved (idempotent، ضدِ دوبار). changes==1 یعنی همین حالا برگشت خورد.
  markPaymentReversed: db.prepare("UPDATE payments SET status='reversed', updated_at=unixepoch() WHERE id=? AND status='approved'"),
  setDistrust: db.prepare('UPDATE users SET pay_distrust=1 WHERE telegram_id=?'),
  // کسرِ اعتبارِ برگشتی، اما هرگز زیرِ صفر (مصرف‌شده تا آن لحظه اشکالی ندارد)
  clawback: db.prepare('UPDATE users SET balance = MAX(0, balance - ?) WHERE telegram_id=?'),
  // پرداختِ منتظرِ رسیدِ همین کاربر (برای بازیابیِ رسید وقتی state گم شده — کاربر بعد از فاکتور /start زده)
  pendingReceiptPayment: db.prepare("SELECT * FROM payments WHERE user_id=? AND status='pending' AND step='receipt' AND created_at > unixepoch()-259200 ORDER BY id DESC LIMIT 1"),
  staleReceipts: db.prepare("SELECT * FROM payments WHERE status='waiting_review' AND updated_at < unixepoch()-7200 AND (reminded_at IS NULL OR reminded_at < unixepoch()-14400) ORDER BY id"),
  setReminded:   db.prepare('UPDATE payments SET reminded_at=unixepoch() WHERE id=?'),
  pendingActions: db.prepare('SELECT * FROM admin_actions WHERE done_at IS NULL ORDER BY id LIMIT 20'),
  markActionDone: db.prepare('UPDATE admin_actions SET done_at=unixepoch() WHERE id=?'),
  setPaymentDiscount: db.prepare('UPDATE payments SET discount_code_id=?, original_amount=COALESCE(original_amount, amount), amount=?, updated_at=unixepoch() WHERE id=?'),
  dailyRevenue:   db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='approved' AND created_at >= unixepoch()-86400"),
  monthlyRevenue: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='approved' AND created_at >= unixepoch()-2592000"),
  totalRevenue:   db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status='approved'"),
  countUsers:     db.prepare('SELECT COUNT(*) AS c FROM users'),

  getDiscountCode:     db.prepare('SELECT * FROM discount_codes WHERE code=? AND is_active=1'),
  getDiscountById:     db.prepare('SELECT * FROM discount_codes WHERE id=?'),
  insertDiscountCode:  db.prepare('INSERT INTO discount_codes (code, discount_percent, max_discount_amount, expires_at, max_uses_per_user, only_user_id, created_by) VALUES (?,?,?,?,?,?,?)'),
  incDiscountUses:     db.prepare('UPDATE discount_codes SET total_uses=total_uses+1 WHERE id=?'),
  countApprovedPayments: db.prepare("SELECT COUNT(*) AS c FROM payments WHERE user_id=? AND status='approved'"),
  insertDiscountUse:   db.prepare('INSERT INTO discount_uses (code_id, user_id, payment_id, discount_amount) VALUES (?,?,?,?)'),
  getUserDiscountUses: db.prepare('SELECT COUNT(*) AS c FROM discount_uses WHERE code_id=? AND user_id=?'),
  // «کد الان دستِ کدام فاکتور است؟» — فقط فاکتورِ رسیدداده‌ی منتظرِ تأیید کد را نگه می‌دارد.
  // فاکتورِ `pending` (بدونِ رسید) عمداً شمرده نمی‌شود: کاربر همیشه فقط با تازه‌ترین فاکتورش
  // کار می‌کند (session.paymentId و بازیابیِ عکس هر دو تازه‌ترین را می‌گیرند)، پس فاکتورِ
  // قدیمیِ رهاشده هیچ راهی ندارد که به waiting_review برسد و کد را خرج کند. شمردنش فقط
  // کدِ یک‌بارمصرفِ خودِ کاربر را برای همیشه قفل می‌کرد (باگِ واقعی: کدی که ربات پیشنهاد
  // می‌داد ولی هرگز پذیرفته نمی‌شد). خودِ فاکتورِ جاری هم کنار گذاشته می‌شود تا واردکردنِ
  // دوباره‌ی کد روی همان فاکتور خودش را بلاک نکند.
  countPendingDiscount: db.prepare("SELECT COUNT(*) AS c FROM payments WHERE discount_code_id=? AND user_id=? AND id<>? AND status='waiting_review'"),

  insertReferral: db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referee_id) VALUES (?,?)'),
  getReferralByReferee: db.prepare('SELECT * FROM referrals WHERE referee_id=?'),
  setReferralRewarded:  db.prepare('UPDATE referrals SET rewarded=1 WHERE id=?'),

  setMemory: db.prepare('UPDATE users SET memory_json=? WHERE telegram_id=?'),
  getDailyText: db.prepare('SELECT text FROM daily_texts WHERE card_key=? AND reversed=? AND focus=?'),
  setDailyText: db.prepare('INSERT OR REPLACE INTO daily_texts (card_key, reversed, focus, text) VALUES (?,?,?,?)'),
  getCardFile: db.prepare('SELECT file_id FROM card_files WHERE card_key=?'),
  setCardFile: db.prepare('INSERT INTO card_files (card_key, file_id, updated_at) VALUES (?,?,unixepoch()) ON CONFLICT(card_key) DO UPDATE SET file_id=excluded.file_id, updated_at=unixepoch()'),
};

/* ===== 3) هلپرهای کاربر/سشن ===== */
function upsertUser(ctx) {
  const before = stmts.getUser.get(ctx.from.id);
  stmts.upsertUser.run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
  return { isNew: !before };
}
const getUser  = (uid) => stmts.getUser.get(uid);
const getState = (uid) => getUser(uid)?.state || 'new';
const setState = (uid, s) => stmts.setState.run(s, uid);
const getBalance = (uid) => getUser(uid)?.balance || 0;
const hasRecharged = (uid) => stmts.countApprovedPayments.get(uid).c > 0;
// کدِ شخصیِ تخفیفِ اولین شارژ: قطعی و یکتا per کاربر (base36 آی‌دی → بدون احتمالِ برخورد)،
// پس چندبار زدنِ دکمه همان کد را می‌دهد نه کدِ تازه. فقط با only_user_id خودش و یک‌بار مصرف.
const firstCodeFor = (uid) => 'T50' + Number(uid).toString(36).toUpperCase();
function ensureFirstDiscountCode(uid) {
  const code = firstCodeFor(uid);
  if (stmts.getDiscountCode.get(code)) return code;
  try {
    stmts.insertDiscountCode.run(code, FIRST_RECHARGE_DISCOUNT.percent, FIRST_RECHARGE_DISCOUNT.cap,
      null, 1, uid, 0);
  } catch (e) { logErr('first discount code', e.message); }
  return code;
}

// تعداد کارت‌های یک خوانش (برای متنِ «هزینه‌ی این سه تا کارت»): از خودِ چیدمان،
// و اگر چیدمان پیدا نشد از قیمت (قانونِ ثابتِ هر کارت ۱۰٬۰۰۰ تومان).
const cardsOf = (r) => SPREAD_BY_ID[r.type]?.size || Math.max(1, Math.round(r.price / 10_000));
// پیامِ یکسانِ «موجودی کافی نیست» در همه‌ی نقاطِ پی‌وال (شخصی‌شده با نام کاربر).
const needBalanceText = (uid, price, cards) =>
  L.reading.needBalance(dispName(getUser(uid)), L.reading.cardCountFa(cards), price);
// ردیفِ ثابتِ زیرِ پیامِ کم‌موجودی: مسیر اصلی (شارژ) اول، تخفیف پشتِ دکمه‌ی دوم.
const needBalanceRows = () => [
  [Markup.button.callback(L.buttons.recharge, 'recharge')],
  [Markup.button.callback(L.buttons.wantDiscount, 'want_discount')],
];
// کاربرِ بی‌اعتماد (بعد از برگشتِ رسیدِ فیک): ایجنت دیگر برایش خودکار تصمیم نمی‌گیرد
const isDistrusted = (uid) => !!getUser(uid)?.pay_distrust;
// نامِ نمایشیِ کاربر: نام فارسیِ خودش (اگر در آنبوردینگ داده) — نه first_name تلگرام که ممکن است انگلیسی/نامفهوم باشد.
// در متن‌های رو-به-کاربر با fallback خالی؛ به LLM هرگز نام تلگرام نمی‌رود (تا مدل نام نامفهوم را تکرار نکند).
const dispName = (u) => (u?.display_name || '').trim();

function getSession(uid) {
  const raw = getUser(uid)?.session_json;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function setSession(uid, s) { stmts.setSession.run(s ? JSON.stringify(s) : '', uid); }
function patchSession(uid, patch) { const s = getSession(uid); Object.assign(s, patch); setSession(uid, s); return s; }

// پاک‌سازی کامل یک کاربر — /reset مالک (شامل کیف‌پول)
function wipeUser(uid) {
  // صف اکشن رسیدها به payment_id وصل است نه user_id → قبل از حذف payments با subquery پاک شود
  try { db.prepare('DELETE FROM admin_actions WHERE payment_id IN (SELECT id FROM payments WHERE user_id=?)').run(uid); } catch (e) { logErr('wipe admin_actions', e.message); }
  try { db.prepare('DELETE FROM referrals WHERE referee_id=? OR referrer_id=?').run(uid, uid); } catch (e) { logErr('wipe referrals', e.message); }
  for (const [t, col] of [['users','telegram_id'],['readings','user_id'],['payments','user_id'],['discount_uses','user_id'],['events','user_id'],['ab_exposures','user_id']]) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(uid); } catch (e) { logErr('wipe', t, e.message); }
  }
  try { db.prepare('DELETE FROM discount_codes WHERE only_user_id=?').run(uid); } catch (e) { logErr('wipe personal code', e.message); }
  prefetches.delete(uid);
}

function normalizeDigits(s) {
  return String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}
const tehranToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ===== 4) OpenRouter ===== */
async function orRequest(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OR_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      logErr(`❌ OpenRouter ${res.status} (${body.model}) after ${Date.now() - t0}ms:`, errBody.slice(0, 300));
      throw new Error(`OpenRouter error ${res.status}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    const u = data.usage || {};
    log(`✅ ${body.model} in ${Date.now() - t0}ms | tok(in/out)=${u.prompt_tokens ?? '?'}/${u.completion_tokens ?? '?'}`);
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function orChat(system, user, opts = {}) {
  return orRequest({
    model: opts.model || FLASH,
    temperature: opts.temperature ?? 0.9,
    max_tokens: opts.maxTokens,
    // تفکر (reasoning) خاموش: وگرنه Gemini بخشی از max_tokens را صرف thinking می‌کند و
    // خروجی JSON وسط رشته بریده می‌شود (Unterminated string) — دیده‌شده در لاگ پروداکشن
    reasoning: { enabled: false },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
}
// فراخوانی مقاوم: چند تلاش با مدل اصلی، بعد مدل فالبک؛ validate اختیاری برای ردکردن خروجی خراب
async function orChatResilient(system, user, opts = {}, plan = [FLASH, FLASH, FLASH, FALLBACK_MODEL, FALLBACK_MODEL]) {
  for (let i = 0; i < plan.length; i++) {
    try {
      const out = await orChat(system, user, { ...opts, model: plan[i] });
      if (!opts.validate || opts.validate(out)) return { out, model: plan[i] };
      logErr(`LLM invalid output (attempt ${i + 1}, ${plan[i]})`);
    } catch (e) {
      logErr(`LLM error (attempt ${i + 1}, ${plan[i]}):`, e.message);
    }
    if (i < plan.length - 1) await sleep(1500);
  }
  return null;
}
function orTranscribe(audioBuffer, format) {
  return orRequest({
    model: FLASH,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.' },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ] }],
  });
}
function parseJsonLoose(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch (e) { logErr('JSON parse failed:', e.message, '| head:', t.slice(0, 120)); return null; }
}

/* ===== 5) موتور دک (شافل قطعی از seed) ===== */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedToInt(seedStr) {
  return createHash('sha256').update(seedStr).digest().readUInt32LE(0);
}
// دک شافل‌شده + جهت هر کارت — کاملاً قطعی از روی seed (بعد از ری‌استارت هم همان است)
function shuffledDeck(seedStr) {
  const rng = mulberry32(seedToInt(seedStr));
  const deck = CARDS.map(c => c.key);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.map(key => ({ key, reversed: rng() < REVERSAL_PROB }));
}
// کارت‌های نهایی خوانش: انتخاب‌های کاربر از گرید + بقیه از «جای بریدن دک»
// مهم: برای فال‌های کوچک‌تر از تعداد انتخاب (مثل آری/نه ۲کارتی) فقط size کارت اول
function drawCards(seedStr, picks, size) {
  const deck = shuffledDeck(seedStr);
  const chosen = picks.slice(0, size).map(i => deck[i]);
  let cursor = GRID_SIZE;
  while (chosen.length < size) chosen.push(deck[cursor++]);
  return chosen;
}

/* ===== 6) هلپرهای تلگرام ===== */
const TG_LIMIT = 3800;
async function replyLong(ctx, text, extra) {
  for (let i = 0; i < text.length; i += TG_LIMIT) {
    const isLast = i + TG_LIMIT >= text.length;
    await ctx.reply(text.slice(i, i + TG_LIMIT), isLast ? extra : undefined);
  }
}
// ارسال عکس کارت با کش file_id (اولین بار از فایل، بعد از آن از file_id تلگرام)
async function sendCardPhoto(ctx, cardKey, caption, { spoiler = true } = {}) {
  const cached = stmts.getCardFile.get(cardKey)?.file_id;
  const media = cached || { source: `./assets/cards/${cardKey === 'back' ? 'back.jpg' : CARD_BY_KEY[cardKey].file}` };
  const msg = await ctx.replyWithPhoto(media, { caption, has_spoiler: spoiler });
  if (!cached) {
    const fid = msg.photo?.[msg.photo.length - 1]?.file_id;
    if (fid) stmts.setCardFile.run(cardKey, fid);
  }
  return msg;
}
async function typing(ctx, ms, action = 'typing') {
  try { await ctx.sendChatAction(action); } catch {}
  await sleep(ms);
}

// uid اختیاری: فقط ادمین‌ها (دو آی‌دیِ ADMIN_IDS) دکمه‌ی «ریست حساب (ادمین)» را می‌بینند — همیشه،
// حتی خارج از فاز تست. این تنها تمایزِ رو-به-کاربرِ ادمین است (ابزار مدیریتی؛ فلوی محصول یکسان می‌ماند).
function mainKeyboard(uid) {
  const rows = [
    [L.buttons.daily, L.buttons.reading],
    [L.buttons.wallet, L.buttons.inviteMain],
  ];
  if (FREE_MENU_ENABLED && HAFEZ.length) rows.splice(1, 0, [L.buttons.freeMenu]);
  rows.push(...supportRow(L.support)); // 💬 پشتیبانی — برای همه، همیشه (خالی می‌شود اگر SUPPORT.enabled=false)
  if (isAdmin(uid)) rows.push([L.buttons.resetTest]); // دکمه‌ی ریست فقط برای ادمین‌ها، همیشه
  return Markup.keyboard(rows).resize();
}

// تا پایان آنبوردینگ (نوشتن نام + پاسخ به حوزه‌ی تمرکز)، کاربر نباید بتواند با دکمه‌ها مرحله را رد کند.
const ONBOARDING_STATES = ['onboard_name', 'onboard_focus'];
// اگر کاربر وسط آنبوردینگ روی یک دکمه‌ی اصلی زد (کیبوردِ کش‌شده یا تایپِ دستی)، به‌جای اجرا،
// همان قدمِ فعلیِ آنبوردینگ دوباره یادآوری می‌شود. خروجی true = بلاک شد.
async function blockDuringOnboarding(ctx) {
  const st = getState(ctx.from.id);
  if (!ONBOARDING_STATES.includes(st)) return false;
  if (st === 'onboard_name') {
    await ctx.reply(L.onboarding.askNameRetry, Markup.removeKeyboard());
  } else {
    await ctx.reply(L.onboarding.askFocus, Markup.inlineKeyboard(
      L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
    ));
  }
  return true;
}

// 🧭 ردیفِ «بازگشت به منو» برای استیت‌های میانیِ فلو (خالی وقتی گارد خاموش است تا رفتار عیناً قبلی شود).
const navMenuRow = () => (NAV_GUARD_ENABLED ? [[Markup.button.callback(L.buttons.backToMenu, 'nav:menu')]] : []);
// کیبوردِ اینلاینِ فقط-nav برای پیامِ خطا/یادآوری (useButtons)؛ undefined = بدون تغییرِ رفتار.
// نکته‌ی UX (بند ۹ب ریشه): در استیت‌هایی که از کاربر «تایپ/ویس» می‌خواهیم (askQuestion/askTopic) هیچ
// دکمه‌ای نمی‌گذاریم تا حواسش پرت نشود؛ راهِ خروجِ آن‌جا گاردِ «فالِ باز» است، نه دکمه‌ی درون-پیام.
const navMenuKb = () => (NAV_GUARD_ENABLED ? Markup.inlineKeyboard(navMenuRow()) : undefined);

// گاردِ «پرداختِ باز» — دوقلوی blockDuringOnboarding برای ریلِ پرداخت (الگوی voice2text):
// اگر کاربر فاکتورِ باز دارد، دکمه‌های منو نباید آن را بی‌صدا یتیم کنند؛ به‌جای اجرا «فاکتور باز داری»
// + دکمه‌ی انصراف نشان بده و اکشن را متوقف کن. خروجی true = بلاک شد.
const PAY_STATES = ['pay_amount', 'pay_receipt', 'pay_discount'];
async function blockDuringOpenPay(ctx) {
  if (!NAV_GUARD_ENABLED) return false;
  const uid = ctx.from.id;
  if (!PAY_STATES.includes(getState(uid))) return false;
  const pid = getSession(uid)?.paymentId;
  if (!pid) return false; // بدون paymentId نمی‌توان انصراف را وصل کرد → بگذار رد شود (مسیر بازیابیِ رسید)
  await ctx.reply(L.errors.openInvoice, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.cancel, `pay_cancel:${pid}`)],
  ]));
  return true;
}

// گاردِ «فالِ باز» — وقتی کاربر وسط فلوی خوانش (بعد از انتخاب فال) است و به‌جای ادامه دکمه‌ی منو می‌زند:
// به‌جای رهاکردنِ بی‌صدای فال، می‌پرسیم «ادامه بدم یا انصراف». مخصوصاً برای استیتِ ورودی (await_question)
// که عمداً دکمه‌ی درون-پیام ندارد؛ این گارد راهِ خروجِ آن است (قرارداد State Management بند ۹ب ریشه).
const READING_INPROGRESS = ['confirm_focus', 'await_question', 'breathing', 'shuffling', 'picking'];
async function blockDuringOpenReading(ctx) {
  if (!NAV_GUARD_ENABLED) return false;
  if (!READING_INPROGRESS.includes(getState(ctx.from.id))) return false;
  await ctx.reply(L.reading.openReadingGuard, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.resumeReading, 'reading:resume')],
    [Markup.button.callback(L.buttons.cancel, 'reading:cancel')],
  ]));
  return true;
}

// گاردِ «فالِ رزروشده» — کاربر فالی دارد که کارت‌هایش انتخاب شده و منتظرِ پرداخت است
// (state=confirm_pay، بعد از انصراف از فاکتور یا بعد از فرستادنِ رسید) و به‌جای ادامه/انصراف،
// فالِ جدید شروع می‌کند. تا قبل از این، فالِ قبلی بی‌صدا یتیم می‌شد و کاربر بدونِ هیچ پیامی
// فالِ رزروشده‌اش را از دست می‌داد. حالا همان پی‌وال («باز کردن کارت‌ها» = ادامه) + «انصراف»
// دوباره نشان داده می‌شود (قرارداد State Management بند ۹ب). خروجی true = بلاک شد.
async function blockDuringPendingReading(ctx) {
  if (!NAV_GUARD_ENABLED) return false;
  if (getState(ctx.from.id) !== 'confirm_pay') return false;
  return await offerPendingReading(ctx, ctx.from.id);
}

// «اونو ادامه می‌دم» → همان پیامِ آخرِ فلو (مطابقِ استیتِ فعلی) دوباره نشان داده می‌شود.
async function resendCurrentStep(ctx, uid) {
  const state = getState(uid);
  const s = getSession(uid);
  if (state === 'await_question') {
    return ctx.reply(s?.focusKey === 'open' ? L.reading.askTopic : L.reading.askQuestion(), { parse_mode: 'Markdown' });
  }
  if (state === 'confirm_focus') {
    return ctx.reply(L.reading.askFocusAgain, Markup.inlineKeyboard(
      L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
    ));
  }
  if (state === 'breathing') {
    return ctx.reply(L.reading.breathing, Markup.inlineKeyboard([[Markup.button.callback(L.buttons.ready, 'ready_breath')]]));
  }
  if (state === 'picking') {
    return ctx.reply(L.reading.pickPrompt(s?.need || USER_PICKS), pickGridKb(s?.picks || []));
  }
  if (state === 'shuffling') {
    const m = await ctx.reply(L.reading.shuffleFrames[0], Markup.inlineKeyboard([[Markup.button.callback(L.buttons.stopShuffle, 'shuffle_stop')]]));
    patchSession(uid, { shuffleMsgId: m.message_id });
    return;
  }
  return ctx.reply(L.errors.useButtons, navMenuKb());
}

/* ===== 7) LLM خوانش — پیش‌فراخوانی و ساخت کانتکست ===== */
const prefetches = new Map(); // uid -> Promise<object|null> (فقط بهینه‌سازی؛ منبع حقیقت readings.llm_json)

function buildReadingCtx(user, spread, question, cards, focusKey) {
  // ریکال کامل ارزان: در مقیاس ما کل تاریخچه‌ی مفید در کانتکست جا می‌شود — RAG لازم نیست
  const prev = stmts.lastDelivered.all(user.telegram_id, 4)
    .map(r => ({ 'نوع فال': r.type, 'خلاصه': r.summary, 'بازخورد کاربر': r.feedback || '-' }));
  return {
    memory: user.memory_json || '',
    name: dispName(user), // فقط نام فارسیِ خودِ کاربر؛ نام تلگرام هرگز به مدل نمی‌رود
    focusFa: L.focusFa[focusKey] || focusKey || L.focusFa[user.focus_area] || '-',
    question,
    spreadFa: spread.fa,
    cards: cards.map((c, i) => ({
      positionFa: spread.positions[i]?.fa || `کارت ${i + 1}`,
      fa: CARD_BY_KEY[c.key].fa,
      en: CARD_BY_KEY[c.key].en,
      reversed: c.reversed,
      up: CARD_BY_KEY[c.key].up,
      down: CARD_BY_KEY[c.key].down,
    })),
    previous: prev,
    today: tehranToday(),
  };
}

async function callReadingLLM(readingId) {
  const r = stmts.getReading.get(readingId);
  if (!r) return null;
  const user = getUser(r.user_id);
  const spread = SPREAD_BY_ID[r.type];
  const cards = JSON.parse(r.cards_json);
  const ctx = buildReadingCtx(user, spread, r.question, cards, r.focus_area);
  const system = L.prompts.readerSystem(spread);
  const userMsg = L.prompts.readingContext(ctx);
  // ۳ تلاش Flash → ۲ تلاش DeepSeek؛ خروجی فقط با JSON معتبر و کامل پذیرفته می‌شود
  let parsed = null;
  const res = await orChatResilient(system, userMsg, {
    maxTokens: spread.maxTokens,
    validate: (out) => {
      const obj = parseJsonLoose(out);
      if (obj && Array.isArray(obj.cards) && obj.cards.length >= cards.length && obj.narrative) { parsed = obj; return true; }
      return false;
    },
  });
  if (!res || !parsed) { logErr(`reading#${readingId} همه‌ی تلاش‌ها شکست خورد (REFUND path)`); return null; }
  log(`reading#${readingId} آماده شد با ${res.model}`);
  stmts.setReadingLlm.run(JSON.stringify(parsed), String(parsed.summary || '').slice(0, 300), readingId);
  return parsed;
}

function startPrefetch(uid, readingId) {
  const p = callReadingLLM(readingId).catch(e => { logErr('prefetch:', e.message); return null; });
  prefetches.set(uid, { readingId, promise: p }); // readingId تا نتیجه‌ی فالِ دیگری به این فال تزریق نشود
  return p;
}
// نتیجه‌ی LLM؛ اگر پیش‌فراخوانی از دست رفته بود (مثلاً ری‌استارت) دوباره صدا می‌زند
async function awaitReadingLLM(uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (r?.llm_json) { try { return JSON.parse(r.llm_json); } catch {} }
  const entry = prefetches.get(uid);
  // فقط اگر پیش‌فراخوانی دقیقاً برای همین فال بود از آن استفاده کن؛ وگرنه از نو صدا بزن
  // (باگ: کاربر فال A را رها و فال B را باز می‌کرد → پرامیس A نتیجه‌ی اشتباه/سکوت می‌داد)
  const p = (entry && entry.readingId === readingId) ? entry.promise : callReadingLLM(readingId);
  const result = await p;
  if (entry && entry.readingId === readingId) prefetches.delete(uid);
  if (result) return result;
  const r2 = stmts.getReading.get(readingId);
  if (r2?.llm_json) { try { return JSON.parse(r2.llm_json); } catch {} }
  return null;
}

// بازیابیِ بوت: فال‌هایی که وسط فراخوانی LLM با ری‌استارت یتیم شدند (status=started ولی llm_json خالی)
// → برگشت کامل مبلغ + پیام + دکمه‌ی تلاش مجدد. در لحظه‌ی بوت هیچ فراخوانی LLM در جریان نیست پس امن است
// (پول کاربر هرگز در حالت نامعلوم نمی‌ماند — بند ۹ CLAUDE.md).
function recoverOrphanReadings() {
  let orphans = [];
  try { orphans = db.prepare("SELECT id, user_id, price FROM readings WHERE status='started' AND llm_json=''").all(); }
  catch (e) { logErr('recoverOrphan query:', e.message); return; }
  for (const r of orphans) {
    try {
      if (r.price > 0) stmts.credit.run(r.price, r.user_id);
      stmts.setReadingStatus.run('refunded', r.id);
      track(db, r.user_id, EVENTS.REFUND, { reading_id: r.id, amount: r.price, reason: 'restart' });
      const kb = Markup.inlineKeyboard([[Markup.button.callback(L.buttons.retry, `retryr:${r.id}`)]]);
      bot.telegram.sendMessage(r.user_id, L.reading.refunded, { reply_markup: kb.reply_markup }).catch(() => {});
    } catch (e) { logErr('recoverOrphan reading#' + r.id, e.message); }
  }
  if (orphans.length) log(`♻️ بازیابی بوت: ${orphans.length} فالِ یتیمِ پرداخت‌شده refund شد`);
}

/* ===== 8) Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: OR_TIMEOUT_MS });
let BOT_USERNAME = '';

// گارد خطای سراسری: هیچ خطایی نباید بی‌صدا فلو را بکشد — لاگ کامل + پیام عذرخواهی به کاربر
bot.catch(async (err, ctx) => {
  logErr(`global error [${ctx.updateType}] uid=${ctx.from?.id} state=${ctx.from ? getState(ctx.from.id) : '-'}:`, err.stack || err.message);
  try { await ctx.reply(L.errors.generic); } catch {}
});

// ثبتِ مسیرِ ریز — **باید قبل از همه‌ی هندلرها** ثبت شود (میدل‌ورِ تلگراف ترتیبی اجرا می‌شود).
// برچسبِ دکمه‌های کیبوردِ ماندگار را می‌دهیم تا «زدنِ دکمه» از «تایپِ آزاد» تفکیک شود، و
// نامِ نمایشیِ کاربر را می‌دهیم تا از متنِ پیام حذف شود و کلیدِ صفحه برای همه یکی بماند.
const KB_LABELS = new Set([
  L.buttons.daily, L.buttons.reading, L.buttons.wallet, L.buttons.inviteMain,
  L.buttons.freeMenu, L.buttons.resetTest, L.support?.button, '🔄 ریست ربات (تست)',
].filter(Boolean));
registerJourney(bot, {
  db,
  enabled: JOURNEY_ENABLED,
  isAdmin,
  isButtonLabel: (t) => KB_LABELS.has(t),
  redact: (ctx) => { try { return [dispName(getUser(ctx.from?.id))]; } catch { return []; } },
});

/* ---------- آنبوردینگ و /start ---------- */
async function handleStart(ctx) {
  const uid = ctx.from.id;
  const { isNew } = upsertUser(ctx);
  const user = getUser(uid);

  // اتریبیوشن: رویداد start برای هر /start (کمپین برگشتی هم دیده شود) + first_source/first_version فقط کاربر جدید
  const payload = (ctx.startPayload ?? ctx.message?.text?.split(/\s+/)[1] ?? '').trim();
  captureStart(db, uid, payload, isNew, PRODUCT_VERSION);

  // رفرال: /start ref_<id>
  const refMatch = payload.match(/^ref_(\d+)$/);
  let refBonus = false;
  if (refMatch && isNew) {
    const refId = parseInt(refMatch[1], 10);
    if (refId !== uid && getUser(refId)) {
      stmts.insertReferral.run(refId, uid);
      stmts.setReferredBy.run(refId, uid);
      refBonus = true;
    }
  }

  if (!user.welcomed) {
    // قدم صفر آنبوردینگ: قبل از هر توضیحی، نام فارسیِ کاربر را می‌پرسیم (بهانه‌ی طبیعیِ فال).
    // نام تلگرام ممکن است انگلیسی/نامفهوم باشد و مدل تکرارش کند؛ پس نامِ خودگفته را مبنا می‌گیریم.
    // کیبورد اصلی هنوز نشان داده نمی‌شود؛ تا پایان آنبوردینگ کاربر نباید بتواند مراحل را رد کند.
    setState(uid, 'onboard_name');
    setSession(uid, { refBonus }); // وعده‌ی رفرال بعد از گرفتن نام نشان داده می‌شود
    await ctx.reply(L.onboarding.askName, Markup.removeKeyboard());
    return;
  }

  // کاربر برگشتی
  setState(uid, 'idle');
  setSession(uid, null);
  let msg = L.returning.greeting(dispName(user), getBalance(uid));
  const last = stmts.lastDelivered.all(uid, 1)[0];
  if (user.next_milestone_at && user.next_milestone_at <= Date.now() / 1000 && last?.summary) {
    try { msg += L.returning.milestoneHook(JSON.parse(last.llm_json)?.next_milestone?.text || last.summary); } catch {}
  } else if (user.last_daily_date !== tehranToday()) {
    msg += L.returning.dailyReminder;
  }
  await ctx.reply(msg, mainKeyboard(ctx.from.id));
}
bot.start(handleStart);

// پاک‌سازیِ سبکِ نامِ ورودی: خط اول، بدون ایموجی/کاراکترهای کنترلی، حداکثر ۳۲ کاراکتر
function cleanName(raw) {
  return String(raw || '')
    .split('\n')[0]
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 32)
    .trim();
}

// تکمیل آنبوردینگ بعد از گرفتن نام: ذخیره‌ی نام، خوش‌آمدِ شخصی‌شده، سپس پرسش حوزه‌ی تمرکز.
async function finishNameOnboarding(ctx, rawName) {
  const uid = ctx.from.id;
  const name = cleanName(rawName);
  if (!name) return ctx.reply(L.onboarding.askNameRetry);
  stmts.setDisplayName.run(name, uid);
  const refBonus = getSession(uid).refBonus;
  stmts.setWelcomed.run(uid);
  setSession(uid, null);
  // هنوز آنبوردینگ تمام نشده؛ کیبورد اصلی نمایش داده نمی‌شود (removeKeyboard).
  await ctx.reply(L.onboarding.welcome(name), Markup.removeKeyboard());
  // پاداش دعوت لحظه‌ی ورود واریز نمی‌شود؛ فقط وعده — واریز هر دو طرف بعد از اولین فال کامل
  if (refBonus) await ctx.reply(L.share.referralWelcome(REFERRAL_BONUS));
  await typing(ctx, PACE_S);
  setState(uid, 'onboard_focus');
  await ctx.reply(L.onboarding.askFocus, Markup.inlineKeyboard(
    L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
  ));
}

bot.action(/^focus:(\w+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const key = ctx.match[1];
  stmts.setFocus.run(key, uid);
  const inOnboarding = getState(uid) === 'onboard_focus';
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.onboarding.focusSaved(L.focusFa[key] || key));
  if (inOnboarding) {
    await typing(ctx, PACE_M);
    setState(uid, 'idle');
    track(db, uid, EVENTS.ONBOARD_DONE, { focus: key });
    // دو مسیر ورود: مزه‌ی سریع (کارت روز) یا تجربه‌ی کامل — آزمایش onboard_cta_order ترتیب را تست می‌کند
    // (تا وقتی آزمایش از داشبورد running نشود، variant() همیشه control برمی‌گرداند = رفتار فعلی)
    const ctaRows = [
      [Markup.button.callback(L.buttons.dailyAfterOnboard, 'daily_go')],
      [Markup.button.callback(L.buttons.startThree(), 'spread:three')],
    ];
    if (variant(db, uid, 'onboard_cta_order') === 'reading_first') ctaRows.reverse();
    // دکمه‌ی سوم: مشاهده‌ی همه‌ی فال‌ها (زیرِ دو دکمه‌ی اصلی؛ همان پیام به کاتالوگ ادیت می‌شود)
    ctaRows.push([Markup.button.callback(L.buttons.allSpreads, 'onboard_allspreads')]);
    await ctx.reply(L.onboarding.expectations, Markup.inlineKeyboard(ctaRows));
    // کیبورد اصلی *بعد* از پیام «یه قرار کوچیک» آشکار می‌شود (نه قبلش) — تلگرام اجازه‌ی
    // یک reply_markup در هر پیام را می‌دهد، پس آشکارسازی کیبورد یک پیام کوتاه جدا لازم دارد.
    await typing(ctx, PACE_S);
    await ctx.reply(L.onboarding.keyboardReveal, mainKeyboard(uid));
  } else {
    // تغییر تمرکز وسط فلوی فال
    patchSession(uid, { focusKey: key });
    setState(uid, 'await_question');
    const s = getSession(uid);
    const spread = SPREAD_BY_ID[s.spreadId];
    if (spread) await ctx.reply(L.reading.askQuestion(), { parse_mode: 'Markdown' });
  }
});

/* ---------- کارت روز (رایگان، روزی یک‌بار) ---------- */
async function dailyCard(ctx) {
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (await blockDuringOnboarding(ctx)) return;
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  const user = getUser(uid);
  const today = tehranToday();
  if (user.last_daily_date === today) {
    return ctx.reply(L.daily.alreadyUsed, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.startThree(), 'spread:three')],
    ]));
  }
  // استریک: اگر دیروزِ تهران هم کارت گرفته → +۱، وگرنه از ۱ شروع
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(Date.now() - 86400_000));
  const streak = user.last_daily_date === yesterday ? (user.daily_streak || 0) + 1 : 1;
  stmts.setDaily.run(today, streak, uid);
  const [card] = shuffledDeck(`daily:${uid}:${today}`);
  const info = CARD_BY_KEY[card.key];

  // کش دائمی تفسیر روزانه بر اساس (کارت × جهت × حوزه‌ی تمرکز):
  // حداکثر ۷۸×۲×۵ ترکیب در کل عمر ربات → هزینه‌ی LLM کارت روز در هر مقیاسی تقریباً صفر می‌ماند.
  const focusKey = user.focus_area || '-';
  const cached = stmts.getDailyText.get(card.key, card.reversed ? 1 : 0, focusKey)?.text;
  const llmP = cached
    ? Promise.resolve(cached)
    : orChatResilient(L.prompts.dailySystem, L.prompts.dailyContext({
        focusFa: L.focusFa[user.focus_area] || '-', card: info, reversed: card.reversed,
      }), { maxTokens: DAILY.maxTokens }, [FLASH, FLASH, FALLBACK_MODEL])
        .then(r => {
          if (r?.out) stmts.setDailyText.run(card.key, card.reversed ? 1 : 0, focusKey, r.out);
          return r?.out || null;
        }).catch(e => { logErr('daily LLM:', e.message); return null; });

  await typing(ctx, PACE_M);
  await ctx.reply(L.daily.drawing);
  await typing(ctx, PACE_M, 'upload_photo');
  await sendCardPhoto(ctx, card.key, L.daily.caption(info, card.reversed));
  await typing(ctx, PACE_REVEAL);
  const text = await llmP;
  if (text) await ctx.reply(text);
  track(db, uid, 'daily_card', { streak, cached: !!cached });
  trackOnce(db, uid, EVENTS.FIRST_VALUE, { via: 'daily' });
  // موتور عادت: نمایش استریک از روز دوم + جایزه‌ی هر ۷ روز پیاپی (اعتبار داخل ربات)
  if (streak >= 2) {
    await sleep(PACE_S);
    await ctx.reply(L.daily.streak(streak));
    if (streak % STREAK_EVERY === 0) {
      stmts.credit.run(STREAK_REWARD, uid);
      await ctx.reply(L.daily.streakReward(STREAK_REWARD));
    }
  }
  await sleep(PACE_M);
  await ctx.reply(L.daily.upsell, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.startThree(), 'spread:three')],
  ]));
}
bot.hears(L.buttons.daily, dailyCard);
bot.action('daily_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return dailyCard(ctx); });

/* ---------- 🎁 منوی سرگرمی‌های رایگان + 📜 فال حافظ (رایگان، روزی یک‌بار، بدون LLM) ----------
   کل این بخش پشت FREE_MENU_ENABLED است؛ خاموش = دکمه/منو/callbackها بی‌اثر (رفتار عیناً قبلی). */
async function showFreeMenu(ctx) {
  if (!FREE_MENU_ENABLED) return;
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (await blockDuringOnboarding(ctx)) return;
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  const rows = [[Markup.button.callback(L.buttons.freeDaily, 'daily_go')]];
  if (HAFEZ.length) rows.push([Markup.button.callback(L.buttons.freeHafez, 'hafez_go')]);
  rows.push([Markup.button.callback(L.buttons.freeEstekhare, 'estekhare_go')]);
  if (Object.keys(QUIZ).length) rows.push([Markup.button.callback(L.buttons.freeQuiz, 'quiz_go')]);
  rows.push([Markup.button.callback(L.buttons.freeCoffee, 'coffee_go')]);
  rows.push([Markup.button.callback(L.buttons.freeLibrary, 'lib_go')]);
  await ctx.reply(L.freeMenu.title, Markup.inlineKeyboard(rows));
  track(db, uid, 'free_menu_opened', {});
}
bot.hears(L.buttons.freeMenu, showFreeMenu);
bot.action('freemenu', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return showFreeMenu(ctx); });
// ردیفِ «به‌جای ترک، رایگان بازی کن» برای پی‌وال (خالی وقتی فیچر خاموش است)
const freeMenuRow = () => (FREE_MENU_ENABLED && HAFEZ.length)
  ? [[Markup.button.callback(L.buttons.freeMenu, 'freemenu')]] : [];

async function hafezFaal(ctx, via) {
  if (!FREE_MENU_ENABLED || !HAFEZ.length) return;
  const uid = ctx.from.id;
  upsertUser(ctx);
  const user = getUser(uid);
  const today = tehranToday();
  const ctaKb = Markup.inlineKeyboard([[Markup.button.callback(L.buttons.hafezCta, 'opentopic')]]);
  if (user.last_hafez_date === today) return ctx.reply(L.hafez.alreadyUsed, ctaKb);
  stmts.setHafez.run(today, uid);
  // انتخابِ قطعیِ روزانه از هش (بعد از ری‌استارت هم همان غزلِ همان روز برای همان کاربر)
  const g = HAFEZ[seedToInt(`hafez:${uid}:${today}`) % HAFEZ.length];
  await typing(ctx, PACE_M);
  await ctx.reply(L.hafez.intent);
  await typing(ctx, PACE_REVEAL);
  await ctx.reply(L.hafez.ghazal(g));
  await typing(ctx, PACE_M);
  await ctx.reply(L.hafez.faal(g.faal));
  track(db, uid, 'hafez_taken', { n: g.n, via: via || 'menu' });
  trackOnce(db, uid, EVENTS.FIRST_VALUE, { via: 'hafez' });
  await sleep(PACE_S);
  await ctx.reply(L.hafez.cta, ctaKb);
}
bot.action('hafez_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return hafezFaal(ctx, 'menu'); });

/* ---------- 📿 استخاره با تسبیح (رایگان، سقفِ نرمِ ۳/روز، بدون LLM) ---------- */
const ESTEKHARE_CAP = 3;
async function estekhareFaal(ctx, via) {
  if (!FREE_MENU_ENABLED) return;
  const uid = ctx.from.id;
  upsertUser(ctx);
  const user = getUser(uid);
  const today = tehranToday();
  const ctaKb = Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.estekhareYesno, 'spread:yesno')],
    [Markup.button.callback(L.buttons.estekhareChoice, 'spread:choice')],
  ]);
  const count = user.estekhare_date === today ? (user.estekhare_count || 0) : 0;
  if (count >= ESTEKHARE_CAP) return ctx.reply(L.estekhare.cap, ctaKb);
  stmts.setEstekhare.run(today, count + 1, uid);
  // نتیجه‌ی قطعی از هش؛ count داخلِ seed است تا سه استخاره‌ی یک روز سه جوابِ متفاوت بدهند
  const buckets = ['good', 'mid', 'bad'];
  const h = seedToInt(`estekhare:${uid}:${today}:${count}`);
  const outcome = buckets[h % 3];
  const variants = L.estekhare.outcomes[outcome];
  const text = variants[(h >>> 2) % variants.length];
  // فضاسازی + انیمیشنِ شمردنِ دانه‌ها (ادیتِ پیاپیِ یک پیام)
  await ctx.reply(L.estekhare.intent);
  await typing(ctx, PACE_M);
  const frames = L.estekhare.beadFrames;
  const msg = await ctx.reply(frames[0]);
  for (let i = 1; i < frames.length; i++) {
    await sleep(PACE_M);
    try { await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, frames[i]); } catch {}
  }
  await sleep(PACE_REVEAL);
  await ctx.reply(L.estekhare.result(text));
  track(db, uid, 'estekhare_taken', { outcome, via: via || 'menu' });
  trackOnce(db, uid, EVENTS.FIRST_VALUE, { via: 'estekhare' });
  await sleep(PACE_S);
  await ctx.reply(L.estekhare.cta, ctaKb);
}
bot.action('estekhare_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return estekhareFaal(ctx, 'menu'); });

/* ---------- 🃏 کوییز «کدام کارتِ تاروتی؟» (رایگان، ماهی‌یک‌بار، بدون LLM؛ موتور رفرال) ----------
   حالتِ بدونِ state: کلِ مسیرِ پاسخ‌ها در callback_data کدگذاری می‌شود (`quiz:<answers>`)،
   پس ری‌استارتِ وسطِ کوییز هم بی‌خطر است. */
const QUIZ_COOLDOWN_DAYS = 30;
function quizQuestionView(answers) {
  const step = answers.length;
  const q = L.quiz.questions[step];
  const text = `${L.quiz.progress(step + 1, L.quiz.questions.length)}\n\n${q.q}`;
  const rows = q.options.map((o, i) => [Markup.button.callback(o.t, `quiz:${answers}${i}`)]);
  return { text, rows };
}
async function quizStart(ctx) {
  if (!FREE_MENU_ENABLED || !Object.keys(QUIZ).length) return;
  const uid = ctx.from.id;
  upsertUser(ctx);
  const user = getUser(uid);
  const today = tehranToday();
  if (user.last_quiz_date) {
    const days = Math.floor((new Date(today) - new Date(user.last_quiz_date)) / 86400000);
    if (days >= 0 && days < QUIZ_COOLDOWN_DAYS) {
      return ctx.reply(L.quiz.cap, Markup.inlineKeyboard([[Markup.button.callback(L.buttons.quizCta, 'opentopic')]]));
    }
  }
  track(db, uid, 'quiz_started', {});
  const { text, rows } = quizQuestionView('');
  await ctx.reply(L.quiz.intro);
  await ctx.reply(text, Markup.inlineKeyboard(rows));
}
bot.action('quiz_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return quizStart(ctx); });

bot.action(/^quiz:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!FREE_MENU_ENABLED || !Object.keys(QUIZ).length) return;
  const answers = ctx.match[1];
  const total = L.quiz.questions.length;
  if (answers.length < total) {              // سؤالِ بعدی روی همان پیام
    const { text, rows } = quizQuestionView(answers);
    try { await ctx.editMessageText(text, Markup.inlineKeyboard(rows)); } catch {}
    return;
  }
  // نگاشتِ قطعی: جمعِ رأی‌ها → argmax (tie-break: ترتیبِ m00..m21 در QUIZ)
  const uid = ctx.from.id;
  upsertUser(ctx);
  const votes = {};
  for (let s = 0; s < total; s++) {
    const opt = L.quiz.questions[s].options[Number(answers[s])];
    if (opt) for (const k of opt.c) votes[k] = (votes[k] || 0) + 1;
  }
  // بیشینه‌ی رأی؛ در صورتِ تساوی، انتخابِ قطعی با هش (تا کارت‌های هم‌رأی همه قابل‌دسترس بمانند)
  const keys = Object.keys(QUIZ);
  const maxV = Math.max(...keys.map(k => votes[k] || 0));
  const tied = keys.filter(k => (votes[k] || 0) === maxV);
  const best = tied[seedToInt(`quiz:${answers}`) % tied.length];
  const card = CARD_BY_KEY[best];
  stmts.setQuiz.run(tehranToday(), uid);
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await typing(ctx, PACE_M, 'upload_photo');
  await sendCardPhoto(ctx, best, L.quiz.resultHead(card), { spoiler: false });
  await typing(ctx, PACE_M);
  await ctx.reply(QUIZ[best]);
  track(db, uid, 'quiz_done', { card: best });
  trackOnce(db, uid, EVENTS.FIRST_VALUE, { via: 'quiz' });
  if (!BOT_USERNAME) { try { BOT_USERNAME = (await bot.telegram.getMe()).username; } catch {} }
  await sleep(PACE_S);
  const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${uid}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(L.quiz.shareText(card))}`;
  await ctx.reply(L.quiz.cta, Markup.inlineKeyboard([
    [Markup.button.url(L.buttons.quizShare, shareUrl)],
    [Markup.button.callback(L.buttons.quizCta, 'opentopic')],
  ]));
});

/* ---------- ☕ فال قهوه‌ی سؤال‌محور (رایگان، روزی‌یک‌بار، بدون LLM) ----------
   حالتِ بدونِ state: پاسخ‌ها در callback_data (`coffee:<answers>`). خوانش = چیدنِ سه نقشِ فنجان. */
function coffeeQuestionView(answers) {
  const step = answers.length;
  const q = L.coffee.questions[step];
  const text = `${L.coffee.progress(step + 1, L.coffee.questions.length)}\n\n${q.q}`;
  const rows = q.options.map((o, i) => [Markup.button.callback(o.t, `coffee:${answers}${i}`)]);
  return { text, rows };
}
async function coffeeStart(ctx) {
  if (!FREE_MENU_ENABLED) return;
  const uid = ctx.from.id;
  upsertUser(ctx);
  const ctaKb = Markup.inlineKeyboard([[Markup.button.callback(L.buttons.coffeeCta, 'opentopic')]]);
  if (getUser(uid).last_coffee_date === tehranToday()) return ctx.reply(L.coffee.alreadyUsed, ctaKb);
  const { text, rows } = coffeeQuestionView('');
  await ctx.reply(L.coffee.intro);
  await ctx.reply(text, Markup.inlineKeyboard(rows));
}
bot.action('coffee_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return coffeeStart(ctx); });

bot.action(/^coffee:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!FREE_MENU_ENABLED) return;
  const answers = ctx.match[1];
  const total = L.coffee.questions.length;
  if (answers.length < total) {
    const { text, rows } = coffeeQuestionView(answers);
    try { await ctx.editMessageText(text, Markup.inlineKeyboard(rows)); } catch {}
    return;
  }
  const uid = ctx.from.id;
  upsertUser(ctx);
  const today = tehranToday();
  // اگر همین امروز خوانده، دوباره نده (گاردِ روزی‌یک‌بار روی خودِ نتیجه هم)
  if (getUser(uid).last_coffee_date === today) {
    try { await ctx.editMessageReplyMarkup(undefined); } catch {}
    return ctx.reply(L.coffee.alreadyUsed, Markup.inlineKeyboard([[Markup.button.callback(L.buttons.coffeeCta, 'opentopic')]]));
  }
  stmts.setCoffee.run(today, uid);
  const parts = [];
  for (let s = 0; s < total; s++) {
    const opt = L.coffee.questions[s].options[Number(answers[s])];
    if (opt) parts.push(opt.s);
  }
  const closing = L.coffee.closings[seedToInt(`coffee:${uid}:${today}`) % L.coffee.closings.length];
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.coffee.turn);
  await typing(ctx, PACE_REVEAL);
  await ctx.reply(L.coffee.compose(parts, closing));
  track(db, uid, 'coffee_taken', { combo: answers });
  trackOnce(db, uid, EVENTS.FIRST_VALUE, { via: 'coffee' });
  await sleep(PACE_S);
  await ctx.reply(L.coffee.cta, Markup.inlineKeyboard([[Markup.button.callback(L.buttons.coffeeCta, 'opentopic')]]));
});

/* ---------- 📖 کتابخانه‌ی معنیِ ۷۸ کارت (رایگان، مرور؛ دیتا از cards.js، بدون LLM) ---------- */
const LIB_PAGE = 8;
const libCards = (g) => CARDS.filter(c => g === 'major' ? c.arcana === 'major' : c.key[0] === g);
async function libraryMenu(ctx, edit) {
  if (!FREE_MENU_ENABLED) return;
  upsertUser(ctx);
  const rows = L.library.groups.map((grp, gi) => [Markup.button.callback(grp.t, `lib:l:${gi}:0`)]);
  const kb = Markup.inlineKeyboard(rows);
  if (edit) { try { await ctx.editMessageText(L.library.menu, kb); } catch {} }
  else await ctx.reply(L.library.menu, kb);
}
bot.action('lib_go', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return libraryMenu(ctx, false); });
bot.action('lib:home', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return libraryMenu(ctx, true); });

bot.action(/^lib:l:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!FREE_MENU_ENABLED) return;
  const gi = Number(ctx.match[1]);
  const grp = L.library.groups[gi];
  if (!grp) return;
  const cards = libCards(grp.g);
  const pages = Math.max(1, Math.ceil(cards.length / LIB_PAGE));
  const p = Math.max(0, Math.min(Number(ctx.match[2]), pages - 1));
  const rows = cards.slice(p * LIB_PAGE, (p + 1) * LIB_PAGE).map(c => [Markup.button.callback(c.fa, `lib:c:${c.key}`)]);
  const nav = [];
  if (p > 0) nav.push(Markup.button.callback(L.library.btnPrev, `lib:l:${gi}:${p - 1}`));
  if (p < pages - 1) nav.push(Markup.button.callback(L.library.btnNext, `lib:l:${gi}:${p + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback(L.library.btnCats, 'lib:home')]);
  try { await ctx.editMessageText(L.library.listHeader(grp.t, p + 1, pages), Markup.inlineKeyboard(rows)); } catch {}
});

bot.action(/^lib:c:([a-z]\d{2})$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!FREE_MENU_ENABLED) return;
  const key = ctx.match[1];
  const c = CARD_BY_KEY[key];
  if (!c) return;
  const uid = ctx.from.id;
  upsertUser(ctx);
  await typing(ctx, PACE_M, 'upload_photo');
  await sendCardPhoto(ctx, key, L.library.card(c), { spoiler: false });
  track(db, uid, 'card_meaning_viewed', { card: key });
  const gi = L.library.groups.findIndex(grp => grp.g === (c.arcana === 'major' ? 'major' : key[0]));
  await ctx.reply(L.library.cta, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.libCta, 'opentopic')],
    [Markup.button.callback(L.library.btnCats, gi >= 0 ? `lib:l:${gi}:0` : 'lib:home')],
  ]));
});

/* ---------- فال پولی: کاتالوگ → تمرکز → سؤال ---------- */
// کیبورد کاتالوگ: [موضوع آزاد؟] + دکمه‌های فال + دکمه‌ی «راهنمای انتخاب» ته لیست.
function catalogKb() {
  // بَج‌های کوتاه روی دکمه‌ها: «گذشته، حال، آینده» = محبوب‌ترین، صلیب سلتی = کامل‌ترین.
  const rows = SPREADS.map(s => [Markup.button.callback(L.buttons.spread(s, L.reading.catalogBadges[s.id]), `spread:${s.id}`)]);
  const kb = [];
  if (OPEN_TOPIC_ENABLED) kb.push([Markup.button.callback(L.buttons.openTopic, 'opentopic')]);
  // کارت روزِ رایگان به‌عنوان اولین گزینه‌ی لیست (نقطه‌ی ورودِ بی‌هزینه).
  kb.push([Markup.button.callback(L.buttons.dailyInCatalog, 'daily_go')]);
  kb.push(...rows);
  kb.push([Markup.button.callback(L.buttons.spreadGuide, 'cat_guide')]);
  kb.push(...navMenuRow());
  return kb;
}
async function showCatalog(ctx) {
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (await blockDuringOnboarding(ctx)) return;
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  // setSession(uid, null) پایین‌تر readingId را دور می‌ریزد؛ پس قبلش فالِ رزروشده باید گارد شود
  if (await blockDuringPendingReading(ctx)) return;
  setState(uid, 'choose_spread');
  setSession(uid, null);
  // پیام کوتاه: فقط دعوت به انتخاب؛ توضیح تک‌تک فال‌ها به «راهنمای انتخاب» منتقل شد.
  await ctx.reply(L.reading.catalog, Markup.inlineKeyboard(catalogKb()));
}
bot.hears(L.buttons.reading, showCatalog);

// راهنمای انتخاب: همین پیام ادیت می‌شود به توضیحِ فال‌ها + دکمه‌ی بازگشت (بدون پیام جدید).
bot.action('cat_guide', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const lines = SPREADS.map(s => L.reading.spreadLine(s, L.reading.badges[s.id])).join('\n\n');
  const guide = OPEN_TOPIC_ENABLED ? `${L.reading.openTopicHint}\n\n${lines}` : lines;
  try {
    await ctx.editMessageText(`${L.reading.guideTitle}\n\n${guide}`, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.guideBack, 'cat_back')],
    ]));
  } catch {}
});
// بازگشت از راهنما به لیست انتخاب فال (همان پیام ادیت می‌شود).
bot.action('cat_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try { await ctx.editMessageText(L.reading.catalog, Markup.inlineKeyboard(catalogKb())); } catch {}
});

// موضوع آزاد: انتخاب عمق (۳ یا ۵ کارت) — قیمت طبق قرارداد فقط در پی‌وال نشان داده می‌شود
bot.action('opentopic', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (!OPEN_TOPIC_ENABLED) return;
  upsertUser(ctx);
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  if (await blockDuringPendingReading(ctx)) return;
  setState(uid, 'choose_spread');
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.openDepthPrompt, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.openDepth3, 'odepth:open3')],
    [Markup.button.callback(L.buttons.openDepth5, 'odepth:open5')],
    ...navMenuRow(),
  ]));
});

bot.action(/^odepth:(open3|open5)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (!OPEN_TOPIC_ENABLED) return;
  upsertUser(ctx);
  const spread = SPREAD_BY_ID[ctx.match[1]];
  if (!spread) return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  // موضوعِ تایپ‌شده خودش حوزه است → مرحله‌ی «حول چی؟» رد می‌شود؛ مستقیم سراغ نوشتن موضوع
  patchSession(uid, { spreadId: spread.id, picks: [], focusKey: 'open' });
  setState(uid, 'await_question');
  await ctx.reply(L.reading.askTopic, { parse_mode: 'Markdown' });
});

bot.action(/^spread:(\w+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  upsertUser(ctx);
  const spread = SPREAD_BY_ID[ctx.match[1]];
  if (!spread) return;
  // دکمه‌ی «شروع فال» در پیام‌های زیادی هست (منو، بعد از تحویل، پوشِ milestone و…) و تا قبل از
  // این هیچ گاردی نداشت: کاربری که وسطِ پرداخت یا وسطِ یک فالِ باز بود، با یک تپ فلوی قبلی‌اش
  // را بی‌صدا از دست می‌داد. حالا مثل بقیه‌ی نقاطِ ورودِ منو گارد می‌شود (بند ۹ب).
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  if (await blockDuringPendingReading(ctx)) return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  track(db, uid, 'spread_selected', { spread: spread.id });

  // فال موضوعی (عشق/کار/پول/…): حوزه همان موضوع فال است — مرحله‌ی «حول چی؟» حذف
  if (spread.focus) {
    patchSession(uid, { spreadId: spread.id, picks: [], focusKey: spread.focus });
    setState(uid, 'await_question');
    return ctx.reply(L.reading.askQuestion(), { parse_mode: 'Markdown' });
  }

  // فال عمومی (گذشته/حال/آینده، آری/نه، دوراهی، سلتی): حوزه‌ی تمرکز
  patchSession(uid, { spreadId: spread.id, picks: [], focusKey: null });
  const user = getUser(uid);
  // اگر حوزه‌اش را داریم و کمتر از یک هفته از آخرین پرسش گذشته → همان را بی‌سؤال به‌کار می‌بریم
  // (سؤال «این خوانش حول فلان باشه؟» حذف شد؛ فقط اولین ورود + بازپرسیِ حداکثر هفته‌ای‌یک‌بار).
  const fresh = user.focus_area && (Date.now() / 1000 - (user.focus_asked_at || 0)) < FOCUS_REASK_DAYS * 86400;
  if (fresh) {
    patchSession(uid, { focusKey: user.focus_area });
    setState(uid, 'await_question');
    return ctx.reply(L.reading.askQuestion(), { parse_mode: 'Markdown' });
  }
  // بازپرسیِ هفتگی (یا اولین بار): بدون مقدمه‌ی «بذار یه کم بشناسمت»
  setState(uid, 'confirm_focus');
  await ctx.reply(L.reading.askFocusAgain, Markup.inlineKeyboard(
    L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
  ));
});

// دکمه‌ی «مشاهده‌ی همه‌ی فال‌ها» زیر پیشنهادهای پایان فال
bot.action('catalog_go', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  return showCatalog(ctx);
});

// دکمه‌ی «همه فال‌ها» زیر پیام «یه قرار کوچیک» آنبوردینگ: معادلِ «فال بگیر» ولی به‌جای
// پیام جدید، همین پیام را به کاتالوگ ادیت می‌کند (بدونِ شلوغیِ چت). اگر ادیت نشد (پیام
// خیلی قدیمی/حذف‌شده)، به showCatalog برمی‌گردیم تا کاربر بن‌بست نخورد.
bot.action('onboard_allspreads', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (await blockDuringOpenPay(ctx)) return;
  setState(uid, 'choose_spread');
  setSession(uid, null);
  try {
    await ctx.editMessageText(L.reading.catalog, Markup.inlineKeyboard(catalogKb()));
  } catch { return showCatalog(ctx); }
});

/* ---------- دریافت سؤال → فضاسازی → تنفس ---------- */
async function handleQuestion(ctx, question) {
  const uid = ctx.from.id;
  const spread = SPREAD_BY_ID[getSession(uid).spreadId];
  if (!spread) { setState(uid, 'idle'); return ctx.reply(L.errors.stateLost, mainKeyboard(ctx.from.id)); }
  patchSession(uid, { question: question.slice(0, 1500) });
  setState(uid, 'breathing');
  track(db, uid, 'question_submitted', { spread: spread.id, voice: !!(ctx.message?.voice || ctx.message?.audio) });
  await typing(ctx, PACE_S);
  // مشتری ثابت (۲+ فال کامل) آیین کوتاه‌تر می‌گیرد — مثل تاروت‌خوان واقعی با مشتری آشنا
  if (stmts.countDelivered.get(uid).c >= 2) {
    await ctx.reply(L.reading.atmosphereShort);
  } else {
    await ctx.reply(L.reading.atmosphere1);
    await typing(ctx, PACE_M);
    await ctx.reply(L.reading.atmosphere2);
  }
  await typing(ctx, PACE_M);
  await ctx.reply(L.reading.breathing, Markup.inlineKeyboard([[Markup.button.callback(L.buttons.ready, 'ready_breath')]]));
}

/* ---------- بُر زدن با توقف کاربر ---------- */
bot.action('ready_breath', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'breathing') return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  setState(uid, 'shuffling');
  await typing(ctx, PACE_S, 'upload_photo');
  await sendCardPhoto(ctx, 'back', L.reading.shuffleCaption, { spoiler: false });
  const m = await ctx.reply(L.reading.shuffleFrames[0], Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.stopShuffle, 'shuffle_stop')],
  ]));
  patchSession(uid, { shuffleMsgId: m.message_id });
  // انیمیشن شافل: بُر زدن ادامه دارد تا خودِ کاربر «نگه‌دار» را بزند — هرگز خودکار جلو نمی‌رویم.
  // بعد از ~۲ دقیقه فقط ادیت‌کردن متوقف می‌شود (ریت‌لیمیت تلگرام) ولی دکمه سر جایش می‌ماند.
  (async () => {
    for (let i = 1; i < 90; i++) {
      await sleep(1300);
      if (getState(uid) !== 'shuffling' || getSession(uid).shuffleMsgId !== m.message_id) return;
      const frame = L.reading.shuffleFrames[i % L.reading.shuffleFrames.length];
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, m.message_id, undefined, frame, {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback(L.buttons.stopShuffle, 'shuffle_stop')]]).reply_markup,
        });
      } catch {}
    }
  })().catch(e => logErr('shuffle anim:', e.message));
});

bot.action('shuffle_stop', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery('✋').catch(() => {});
  if (getState(uid) !== 'shuffling') return;
  await startPicking(ctx, uid, getSession(uid).shuffleMsgId);
});

function pickGridKb(picks) {
  const rows = [];
  for (let r = 0; r < 6; r++) {
    rows.push(Array.from({ length: 4 }, (_, c) => {
      const i = r * 4 + c;
      return Markup.button.callback(picks.includes(i) ? '✨' : '🂠', `pick:${i}`);
    }));
  }
  return Markup.inlineKeyboard(rows);
}

async function startPicking(ctx, uid, shuffleMsgId) {
  // seed قطعی: بعد از این لحظه شافل و جهت کارت‌ها ثابت است (حتی بعد از ری‌استارت)
  const seed = `r:${uid}:${shuffleMsgId}:${Date.now()}`;
  const spread = SPREAD_BY_ID[getSession(uid).spreadId];
  // فال‌های کوچک‌تر (مثل آری/نه ۲کارتی) به تعداد خودشان انتخاب می‌خواهند
  const need = Math.min(USER_PICKS, spread?.size || USER_PICKS);
  setState(uid, 'picking'); // قبل از هر await — گارد برابر دوباره‌کاری
  patchSession(uid, { seed, picks: [], need });
  if (shuffleMsgId) {
    try { await ctx.telegram.editMessageText(ctx.chat.id, shuffleMsgId, undefined, '🂠 ✋'); } catch {}
  }
  await ctx.reply(L.reading.pickPrompt(need), pickGridKb([]));
}

bot.action(/^pick:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  const i = parseInt(ctx.match[1], 10);
  if (getState(uid) !== 'picking') return ctx.answerCbQuery().catch(() => {});
  // ثبت همگام قبل از هر await — ضد race در کلیک‌های پشت‌سرهم
  const s = getSession(uid);
  const need = s.need || USER_PICKS;
  if (!s.picks || s.picks.includes(i) || s.picks.length >= need) {
    return ctx.answerCbQuery().catch(() => {});
  }
  s.picks.push(i);
  const done = s.picks.length >= need;
  if (done) setState(uid, 'confirm_pay'); // قفل فوری قبل از await
  setSession(uid, s);

  await ctx.answerCbQuery('✨').catch(() => {});
  try { await ctx.editMessageReplyMarkup(pickGridKb(s.picks).reply_markup); } catch {}
  if (!done) return;
  await finishPicking(ctx, uid, s);
});

async function finishPicking(ctx, uid, s) {
  const spread = SPREAD_BY_ID[s.spreadId];
  const user = getUser(uid);
  const cards = drawCards(s.seed, s.picks, spread.size);
  const readingId = Number(stmts.insertReading.run(
    uid, spread.id, spread.price, s.focusKey || user.focus_area || '', s.question || '', s.seed, JSON.stringify(cards)
  ).lastInsertRowid);
  patchSession(uid, { readingId });
  track(db, uid, 'cards_picked', { spread: spread.id, reading_id: readingId });

  // پیش‌فراخوانی LLM فقط وقتی کاربر توان پرداخت دارد (هزینه‌ی قبل از پرداخت = صفر برای کاربرِ بدون موجودی)
  // + سقف روزانه ضد حلقه‌ی «انتخاب کن، لغو کن». در غیر این صورت فراخوانی موقع unlock انجام می‌شود.
  const readingsToday = stmts.countReadingsToday.get(uid).c;
  if (getBalance(uid) >= spread.price && readingsToday <= MAX_PREFETCH_PER_DAY) {
    startPrefetch(uid, readingId);
  }

  await typing(ctx, PACE_M);
  if (spread.size > s.picks.length) await ctx.reply(L.reading.extraCardsNote(spread.size - s.picks.length));

  const balance = getBalance(uid);
  track(db, uid, EVENTS.PAYWALL_SHOWN, { reading_id: readingId, price: spread.price, can_afford: balance >= spread.price });
  if (balance >= spread.price) {
    await ctx.reply(L.reading.paywall(spread.price), Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.openCards(spread.price), `unlock:${readingId}`)],
      [Markup.button.callback(L.buttons.cancel, `rcancel:${readingId}`)],
    ]));
  } else {
    // یک پیامِ کوتاه و مستقیم (پیامِ اتمسفریکِ paywall این‌جا حذف شد تا کاربر دو پیام پشت‌سرهم نگیرد)
    await ctx.reply(needBalanceText(uid, spread.price, spread.size), Markup.inlineKeyboard([
      ...needBalanceRows(),
      ...freeMenuRow(),
      [Markup.button.callback(L.buttons.cancel, `rcancel:${readingId}`)],
    ]));
  }
}

bot.action(/^rcancel:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const readingId = parseInt(ctx.match[1], 10);
  const r = stmts.getReading.get(readingId);
  if (r && r.user_id === uid && r.status === 'pending_payment') stmts.setReadingStatus.run('canceled', readingId);
  prefetches.delete(uid);
  setState(uid, 'idle');
  setSession(uid, null);
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.canceled, mainKeyboard(ctx.from.id));
});

// 🧭 بازگشت به منوی اصلی از هر استیتِ میانی (قرارداد State Management). فالِ هنوز-پرداخت‌نشده لغو می‌شود؛
// فالِ started/delivered (پول‌داده) هرگز دست نمی‌خورد. همیشه ثبت می‌شود (حتی با گاردِ خاموش) تا دکمه‌ی
// کش‌شده خطا ندهد. اگر کاربر وسط پرداخت است، فاکتور را یتیم نمی‌کند؛ به‌جایش انصراف را پیشنهاد می‌دهد.
bot.action('nav:menu', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const pid = getSession(uid)?.paymentId;
  if (PAY_STATES.includes(getState(uid)) && pid) {
    return ctx.reply(L.errors.openInvoice, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.cancel, `pay_cancel:${pid}`)],
    ]));
  }
  const s = getSession(uid);
  if (s?.readingId) {
    const r = stmts.getReading.get(s.readingId);
    if (r && r.user_id === uid && r.status === 'pending_payment') stmts.setReadingStatus.run('canceled', s.readingId);
  }
  prefetches.delete(uid);
  setState(uid, 'idle');
  setSession(uid, null);
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.backToMenu, mainKeyboard(uid));
});

// گاردِ «فالِ باز» — «اونو ادامه می‌دم»: همان پیامِ آخرِ فلو دوباره نشان داده می‌شود (کاربر سرِ کارش برمی‌گردد).
bot.action('reading:resume', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await resendCurrentStep(ctx, ctx.from.id);
});
// گاردِ «فالِ باز» — «انصراف»: فال لغو و بازگشت به منوی اصلی (همان‌جایی که قبل از شروع فال بود).
bot.action('reading:cancel', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(uid);
  if (s?.readingId) {
    const r = stmts.getReading.get(s.readingId);
    if (r && r.user_id === uid && r.status === 'pending_payment') stmts.setReadingStatus.run('canceled', s.readingId);
  }
  prefetches.delete(uid);
  setState(uid, 'idle');
  setSession(uid, null);
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.canceled, mainKeyboard(uid));
});

/* ---------- پی‌وال → کسر → افشای مرحله‌ای ---------- */
bot.action(/^unlock:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  const readingId = parseInt(ctx.match[1], 10);
  const r = stmts.getReading.get(readingId);
  if (!r || r.user_id !== uid) return ctx.answerCbQuery().catch(() => {});
  if (r.status !== 'pending_payment') return ctx.answerCbQuery('✅').catch(() => {});
  // کسر اتمیک (WHERE balance >= price) — قبل از هر await وضعیت را قفل می‌کنیم
  if (r.price > 0) {
    const res = stmts.deduct.run(r.price, uid, r.price);
    if (res.changes === 0) {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.reply(needBalanceText(uid, r.price, cardsOf(r)), Markup.inlineKeyboard(needBalanceRows()));
    }
  }
  stmts.setReadingStatus.run('started', readingId);
  track(db, uid, 'reading_started', { reading_id: readingId, price: r.price });
  setState(uid, 'revealing');
  patchSession(uid, { readingId, revealIdx: 0, fbDone: false });
  await ctx.answerCbQuery('🔮').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await startReveal(ctx, uid, readingId);
});

// پیام لودینگ پویا تا آماده‌شدن LLM (اگر پیش‌فراخوانی هنوز نرسیده باشد)
async function waitLLMWithLoading(ctx, uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (r?.llm_json) { try { return JSON.parse(r.llm_json); } catch {} }
  const msg = await ctx.reply(L.reading.loading[0]);
  let i = 1, done = false;
  (async () => { // پیام لودینگ پویا؛ بدون await تا افشا معطل نماند
    while (!done) {
      await sleep(5000);
      if (done) break;
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, L.reading.loading[i % L.reading.loading.length]);
      } catch {}
      i++;
    }
  })().catch(() => {});
  const result = await awaitReadingLLM(uid, readingId);
  done = true;
  try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch {}
  return result;
}

async function startReveal(ctx, uid, readingId) {
  const llm = await waitLLMWithLoading(ctx, uid, readingId);
  const r = stmts.getReading.get(readingId);
  if (!llm) {
    // شکست نهایی (بعد از ۳×Flash + ۲×فالبک) → برگشت کامل مبلغ + دکمه‌ی تلاش مجدد از همان نقطه
    if (r && r.status === 'started') {
      if (r.price > 0) stmts.credit.run(r.price, uid);
      stmts.setReadingStatus.run('refunded', readingId);
      track(db, uid, EVENTS.REFUND, { reading_id: readingId, amount: r.price });
    }
    setState(uid, 'idle');
    setSession(uid, null);
    return ctx.reply(L.reading.refunded, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.retry, `retryr:${readingId}`)],
    ]));
  }
  await revealNext(ctx, uid, readingId);
}

// تلاش مجدد بعد از refund: همان کارت‌ها و همان سؤال — فقط فراخوانی LLM از نو
bot.action(/^retryr:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  const readingId = parseInt(ctx.match[1], 10);
  const r = stmts.getReading.get(readingId);
  if (!r || r.user_id !== uid) return ctx.answerCbQuery().catch(() => {});
  if (r.status !== 'refunded') return ctx.answerCbQuery('✅').catch(() => {});
  if (r.price > 0) {
    const res = stmts.deduct.run(r.price, uid, r.price);
    if (res.changes === 0) {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.reply(needBalanceText(uid, r.price, cardsOf(r)), Markup.inlineKeyboard(needBalanceRows()));
    }
  }
  stmts.setReadingStatus.run('started', readingId);
  track(db, uid, 'reading_started', { reading_id: readingId, price: r.price, retry: true });
  setState(uid, 'revealing');
  setSession(uid, { spreadId: r.type, readingId, revealIdx: 0, fbDone: false });
  await ctx.answerCbQuery('🔮').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await startReveal(ctx, uid, readingId);
});

async function revealNext(ctx, uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (!r || !r.llm_json) return;
  const llm = JSON.parse(r.llm_json);
  const cards = JSON.parse(r.cards_json);
  const spread = SPREAD_BY_ID[r.type];
  const s = getSession(uid);
  const idx = s.revealIdx || 0;
  if (idx >= cards.length) return finishReading(ctx, uid, readingId);

  const card = cards[idx];
  const info = CARD_BY_KEY[card.key];
  patchSession(uid, { revealIdx: idx + 1 }); // قبل از await — دکمه‌ی تکراری دوباره همین کارت را نفرستد

  await typing(ctx, PACE_S, 'upload_photo');
  await sendCardPhoto(ctx, card.key, L.reading.revealCaption(spread.positions[idx]?.fa || `کارت ${idx + 1}`, info, card.reversed));
  await sleep(PACE_REVEAL);
  await typing(ctx, PACE_S);

  const interp = llm.cards[idx]?.text || '';
  const isLast = idx === cards.length - 1;
  const midIdx = Math.floor((cards.length - 1) / 2);
  const askFeedback = idx === midIdx && !s.fbDone && llm.confirmation_question;

  if (askFeedback) {
    await ctx.reply(esc(interp), { parse_mode: 'HTML' });
    await sleep(PACE_M);
    setState(uid, 'feedback');
    await ctx.reply(llm.confirmation_question, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.fbYes, `fb:yes:${readingId}`)],
      [Markup.button.callback(L.buttons.fbSomewhat, `fb:some:${readingId}`)],
      [Markup.button.callback(L.buttons.fbNo, `fb:no:${readingId}`)],
    ]));
    return;
  }

  await ctx.reply(esc(interp), {
    parse_mode: 'HTML',
    // دکمه شماره‌ی کارتِ بعدی را حمل می‌کند تا دابل‌تاچ/دکمه‌ی کهنه هرگز کارت تکراری یا پرشی نفرستد
    ...(isLast ? {} : Markup.inlineKeyboard([[Markup.button.callback(L.buttons.nextCard, `next:${readingId}:${idx + 1}`)]])),
  });
  if (isLast) await finishReading(ctx, uid, readingId);
}

bot.action(/^next:(\d+):(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery('🎴').catch(() => {});
  const readingId = parseInt(ctx.match[1], 10);
  const expectIdx = parseInt(ctx.match[2], 10);
  const s = getSession(uid);
  if (getState(uid) !== 'revealing' || s.readingId !== readingId || (s.revealIdx || 0) !== expectIdx) return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await revealNext(ctx, uid, readingId);
});

/* ---------- حلقه‌ی بازخورد وسط خوانش ---------- */
async function handleFeedback(ctx, uid, readingId, kind, freeText) {
  const r = stmts.getReading.get(readingId);
  if (!r) return;
  const llm = r.llm_json ? JSON.parse(r.llm_json) : null;
  stmts.setReadingFeedback.run(freeText ? `text: ${freeText.slice(0, 300)}` : kind, readingId);
  track(db, uid, EVENTS.FEEDBACK, { reading_id: readingId, kind: freeText ? 'text' : kind });
  patchSession(uid, { fbDone: true });
  setState(uid, 'revealing');

  if (kind === 'no' || freeText) {
    // مثل فالگیر واقعی: زاویه‌ی تفسیر با یک فراخوانی کوچک تصحیح می‌شود (فالبک: جمله‌ی همدلانه‌ی آماده)
    await typing(ctx, PACE_M);
    const s = getSession(uid);
    const midIdx = (s.revealIdx || 1) - 1;
    const cards = JSON.parse(r.cards_json);
    const recal = await orChatResilient(L.prompts.feedbackSystem, L.prompts.feedbackContext({
      confirmationQuestion: llm?.confirmation_question || '',
      userAnswer: freeText || 'نه دقیقاً',
      card: CARD_BY_KEY[cards[midIdx]?.key]?.fa || '',
      cardText: llm?.cards?.[midIdx]?.text || '',
      question: r.question,
    }), { maxTokens: 300 }, [FLASH, FALLBACK_MODEL])
      .then(res => res?.out || null).catch(e => { logErr('feedback LLM:', e.message); return null; });
    await ctx.reply(recal || L.reading.recalFallback);
  } else {
    const bridges = L.reading.positiveBridges;
    await ctx.reply(bridges[Math.floor((readingId + (kind === 'yes' ? 0 : 1)) % bridges.length)]);
  }
  await sleep(PACE_M);
  await revealNext(ctx, uid, readingId);
}

bot.action(/^fb:(yes|some|no):(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'feedback') return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await handleFeedback(ctx, uid, parseInt(ctx.match[2], 10), ctx.match[1], null);
});

/* ---------- پایان‌بندی + قلاب بازگشت ---------- */
// پیشنهاد شخصی‌سازی‌شده‌ی فال بعدی: بر اساس حوزه‌ی تمرکز کاربر + آنچه هنوز تجربه نکرده
const FOCUS_SUGGEST = {
  love:      ['love', 'family', 'choice', 'inner', 'celtic'],
  career:    ['career', 'money', 'migration', 'choice', 'celtic'],
  money:     ['money', 'career', 'choice', 'celtic'],
  inner:     ['inner', 'three', 'love', 'celtic'],
  family:    ['family', 'love', 'inner', 'celtic'],
  migration: ['migration', 'choice', 'career', 'celtic'],
  question:  ['choice', 'yesno', 'three', 'celtic'],
};
function suggestSpreads(uid, currentType) {
  const focus = getUser(uid)?.focus_area || 'question';
  const tried = new Set(stmts.lastDelivered.all(uid, 10).map(x => x.type));
  const pool = [...(FOCUS_SUGGEST[focus] || []), ...SPREADS.map(s => s.id)];
  const fresh = pool.filter(id => id !== currentType && SPREAD_BY_ID[id] && !tried.has(id));
  const any   = pool.filter(id => id !== currentType && SPREAD_BY_ID[id]);
  const ids = [...new Set([...fresh, ...any])].slice(0, 2);
  return ids.map(id => SPREAD_BY_ID[id]);
}
async function finishReading(ctx, uid, readingId) {
  const r = stmts.getReading.get(readingId);
  if (!r || r.status !== 'started') return;
  const llm = JSON.parse(r.llm_json);
  const cards = JSON.parse(r.cards_json);

  // روایت پیوندی
  await typing(ctx, PACE_M);
  await replyLong(ctx, `🧵 ${llm.narrative}`);

  // سه قدم عملی + توانمندسازی
  await sleep(PACE_M);
  const items = (llm.action_items || []).slice(0, 3).map((a, i) => `${fmt(i + 1)}. ${a}`).join('\n');
  await ctx.reply(`${L.reading.actionHeader}\n\n${items}`);
  await sleep(PACE_M);
  await ctx.reply(L.reading.empowerClose);

  stmts.setReadingStatus.run('delivered', readingId);
  track(db, uid, EVENTS.PRODUCT_DELIVERED, { type: r.type, price: r.price, reading_id: readingId });
  trackOnce(db, uid, EVENTS.FIRST_VALUE, { via: 'reading' });
  // حافظه‌ی انباشتی: مدل در همان فراخوانی اصلی نسخه‌ی به‌روز حافظه را برگردانده (هزینه‌ی اضافه: صفر)
  if (typeof llm.memory === 'string' && llm.memory.trim()) {
    stmts.setMemory.run(llm.memory.trim().slice(0, 1200), uid);
  }
  setState(uid, 'idle');
  setSession(uid, null);

  // پاداش رفرال: فقط بعد از اولین فال کاملِ دعوت‌شده (نه لحظه‌ی ورود) —
  // هر دو طرف واریز و به هر دو اطلاع داده می‌شود
  try {
    const ref = stmts.getReferralByReferee.get(uid);
    if (ref && !ref.rewarded && stmts.countDelivered.get(uid).c === 1) {
      stmts.setReferralRewarded.run(ref.id);
      stmts.credit.run(REFERRAL_BONUS, ref.referrer_id);
      stmts.credit.run(REFERRAL_BONUS, uid);
      await ctx.reply(L.share.refereeReward(REFERRAL_BONUS));
      const referee = getUser(uid);
      await bot.telegram.sendMessage(ref.referrer_id, L.share.referralReward(dispName(referee), REFERRAL_BONUS)).catch(() => {});
    }
  } catch (e) { logErr('referral reward:', e.message); }

  // یادگاری: مدیاگروپ کارت‌ها (file_id کش‌شده) با خلاصه
  await typing(ctx, PACE_M, 'upload_photo');
  try {
    const media = cards.map((c, i) => ({
      type: 'photo',
      media: stmts.getCardFile.get(c.key)?.file_id || { source: `./assets/cards/${CARD_BY_KEY[c.key].file}` },
      ...(i === 0 ? { caption: L.reading.deliverableCaption(llm.summary || '') } : {}),
    }));
    await ctx.replyWithMediaGroup(media);
  } catch (e) { logErr('media group:', e.message); }

  // milestone ۱۴روزه بی‌صدا ذخیره می‌شود (فقط برای قلاب /start و پوش چک‌این) —
  // پیام «بعداً برگرد» ضد ریتنشن فوری است؛ به‌جایش پیشنهاد شخصی‌سازی‌شده‌ی فال بعدی:
  await sleep(PACE_M);
  const days = Math.min(Math.max(parseInt(llm.next_milestone?.days, 10) || MILESTONE_DAYS, 7), 90);
  stmts.setMilestone.run(Math.floor(Date.now() / 1000) + days * 86400, uid);
  const offers = suggestSpreads(uid, r.type);
  if (!BOT_USERNAME) { try { BOT_USERNAME = (await bot.telegram.getMe()).username; } catch {} }
  await ctx.reply(OPEN_TOPIC_ENABLED ? L.reading.nextOffersOpen : L.reading.nextOffers, Markup.inlineKeyboard([
    ...offers.map(sp => [Markup.button.callback(L.buttons.spread(sp), `spread:${sp.id}`)]),
    ...(OPEN_TOPIC_ENABLED ? [[Markup.button.callback(L.buttons.openTopic, 'opentopic')]] : []),
    [Markup.button.callback(L.buttons.allSpreads, 'catalog_go')],
    [Markup.button.url(L.buttons.share, shareUrlFor(uid))],
  ]));


}

/* ---------- کیف پول و شارژ (کارت‌به‌کارت + تأیید ادمین) ---------- */
async function showWallet(ctx) {
  upsertUser(ctx);
  if (await blockDuringOnboarding(ctx)) return;
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  await ctx.reply(L.wallet.info(getBalance(ctx.from.id)), {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback(L.buttons.recharge, 'recharge')]]).reply_markup,
  });
}
bot.hears(L.buttons.wallet, showWallet);

// لینک اشتراک‌گذاری استاندارد تلگرام: با یک تاچ، پیام آماده + لینک دعوت در چت انتخابی گذاشته می‌شود.
// (switch_inline_query حذف شد: اگر کاربر روی نتیجه‌ی اینلاین تپ نمی‌کرد فقط @botname ارسال می‌شد)
function shareUrlFor(uid) {
  const link = `https://t.me/${BOT_USERNAME}?start=ref_${uid}`;
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(L.share.shareText())}`;
}

// دعوت دوستان از کیبورد اصلی: لینک اختصاصی قابل کپی + دکمه‌ی ارسال مستقیم به دوستان
bot.hears(L.buttons.inviteMain, async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  if (await blockDuringOnboarding(ctx)) return;
  if (await blockDuringOpenPay(ctx)) return;
  if (await blockDuringOpenReading(ctx)) return;
  if (!BOT_USERNAME) { try { BOT_USERNAME = (await bot.telegram.getMe()).username; } catch {} }
  await ctx.reply(L.share.invitePrompt(BOT_USERNAME, uid, REFERRAL_BONUS), {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([[Markup.button.url(L.buttons.share, shareUrlFor(uid))]]).reply_markup,
  });
});

// «تخفیف می‌خوام» — شاخه‌ی اختیاریِ کنارِ مسیر اصلی؛ استیت را دست نمی‌زند تا فالِ رزروشده
// و پرداختِ در جریان سالم بمانند. اولین شارژ → کدِ شخصیِ ۵۰٪ (دستی وارد می‌شود، هرگز خودکار)؛
// بعد از آن → مسیر دعوت دوستان. هر دو پیام دکمه‌ی «افزایش موجودی» دارند تا برگشت به مسیر اصلی یک تاچ باشد.
bot.action('want_discount', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  upsertUser(ctx);
  const first = !hasRecharged(uid);
  track(db, uid, 'discount_requested', { first });
  const rechargeRow = [Markup.button.callback(L.buttons.recharge, 'recharge')];
  if (first) {
    const code = ensureFirstDiscountCode(uid);
    // شرطِ «پیشنهاد دادن» باید با شرطِ «پذیرفتن» یکی باشد: اگر کد همین حالا روی یک فاکتورِ
    // در انتظارِ تأیید نشسته، دوباره پیشنهادش نده — وگرنه کاربر کدی می‌گیرد که خودِ ربات
    // چند ثانیه بعد ردش می‌کند (دقیقاً همان تناقضی که این باگ را ساخت).
    const dc = stmts.getDiscountCode.get(code);
    const held = dc
      ? stmts.getUserDiscountUses.get(dc.id, uid).c + stmts.countPendingDiscount.get(dc.id, uid, 0).c
      : 0;
    if (dc && held >= dc.max_uses_per_user) {
      return ctx.reply(L.wallet.discountHeld, Markup.inlineKeyboard([rechargeRow]));
    }
    return ctx.reply(L.wallet.firstDiscountOffer(FIRST_RECHARGE_DISCOUNT.percent, FIRST_RECHARGE_DISCOUNT.cap, code), {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [{ text: L.buttons.copyCode, copy_text: { text: code } }],
        rechargeRow,
      ]).reply_markup,
    });
  }
  if (!BOT_USERNAME) { try { BOT_USERNAME = (await bot.telegram.getMe()).username; } catch {} }
  return ctx.reply(L.wallet.inviteInsteadOfDiscount(REFERRAL_BONUS), Markup.inlineKeyboard([
    [Markup.button.url(L.buttons.share, shareUrlFor(uid))],
    rechargeRow,
  ]));
});

bot.action('recharge', async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  upsertUser(ctx);
  const paymentId = Number(stmts.insertPayment.run(uid).lastInsertRowid);
  track(db, uid, EVENTS.RECHARGE_STARTED, { payment_id: paymentId });
  setState(uid, 'pay_amount');
  patchSession(uid, { paymentId });
  const s = getSession(uid);
  // مبلغ پیشنهادی: اگر وسط فال گیر کرده، دقیقاً کسری + رند به بالا
  let amounts = QUICK_AMOUNTS;
  if (s.readingId) {
    const r = stmts.getReading.get(s.readingId);
    if (r && r.status === 'pending_payment') {
      const shortfall = Math.max(r.price - getBalance(uid), 0);
      const suggested = Math.max(Math.ceil(shortfall / 1000) * 1000, 1000);
      amounts = [...new Set([suggested, ...QUICK_AMOUNTS])].sort((a, b) => a - b).slice(0, 4);
    }
  }
  await ctx.reply(L.wallet.askAmount(), Markup.inlineKeyboard([
    ...amounts.map(a => [Markup.button.callback(L.buttons.rechargeAmount(a, bonusFor(a)), `ramt:${a}`)]),
    [Markup.button.callback(L.buttons.customAmount, 'rcustom')],
    [Markup.button.callback(L.buttons.cancel, `pay_cancel:${paymentId}`)],
  ]));
});

async function setRechargeAmount(ctx, uid, amount) {
  const s = getSession(uid);
  if (!s.paymentId) return ctx.reply(L.errors.stateLost, mainKeyboard(ctx.from.id));
  // ادعای اتمیک قبل از هر await؛ اگر تپِ دیگری قبلاً مبلغ را ست کرده (changes=0) بی‌صدا برگرد
  if (stmts.claimAmount.run(amount, s.paymentId).changes === 0) return;

  // هیچ تخفیفی خودکار اعمال نمی‌شود: کاربر یا کدش را از دکمه‌ی «تخفیف می‌خوام» گرفته و
  // این‌جا با «🎟️ کد تخفیف دارم» واردش می‌کند، یا مبلغ کامل را می‌پردازد.
  const payAmount = amount;

  setState(uid, 'pay_receipt');
  await ctx.reply(L.wallet.invoice(payAmount, CARD_NUMBER, CARD_OWNER), {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      cardCopyRow(),
      [Markup.button.callback(L.buttons.discountHave, `disc:${s.paymentId}`)],
      [Markup.button.callback(L.buttons.cancel, `pay_cancel:${s.paymentId}`)],
    ]).reply_markup,
  });
}

bot.action(/^ramt:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (getState(ctx.from.id) !== 'pay_amount') return;
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await setRechargeAmount(ctx, ctx.from.id, parseInt(ctx.match[1], 10));
});
bot.action('rcustom', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (getState(ctx.from.id) !== 'pay_amount') return;
  await ctx.reply(L.wallet.askAmount());
});
bot.action(/^disc:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'pay_receipt') return;
  setState(uid, 'pay_discount');
  // بازگشت به فاکتور (نه منو) چون کاربر هنوز وسط پرداخت است — پول یتیم نمی‌شود
  await ctx.reply(L.wallet.askDiscount, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.backToInvoice, `disc_back:${ctx.match[1]}`)],
  ]));
});
// انصراف از واردکردن کد تخفیف → برگشت به مرحله‌ی رسید (فاکتور همان‌طور باز می‌ماند)
bot.action(/^disc_back:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  if (getState(uid) !== 'pay_discount') return;
  setState(uid, 'pay_receipt');
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.wallet.discountSkipped, Markup.inlineKeyboard([
    [Markup.button.callback(L.buttons.cancel, `pay_cancel:${ctx.match[1]}`)],
  ]));
});
bot.action(/^pay_cancel:(\d+)$/, async (ctx) => {
  const uid = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});
  const p = stmts.getPayment.get(parseInt(ctx.match[1], 10));
  if (p && p.user_id === uid && ['pending'].includes(p.status)) stmts.setPaymentStatus.run('canceled', p.id);
  const s = getSession(uid);
  delete s.paymentId;
  setSession(uid, s);
  setState(uid, s.readingId ? 'confirm_pay' : 'idle');
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.reading.canceled, mainKeyboard(ctx.from.id));
  // اگر فال رزروشده‌ای منتظر است، دکمه‌هایش را دوباره جلوی کاربر بگذار تا سرگردان نماند
  await offerPendingReading(ctx, uid);
});

// reason: 'unknown' (نبود/منقضی/مالِ کسِ دیگر) یا 'used' (قبلاً خرج شده یا روی فاکتورِ
// در انتظارِ تأیید است) — پیامِ کاربر بر همین اساس فرق می‌کند تا سردرگم نشود.
function validateDiscount(code, userId, amount, currentPaymentId = 0) {
  const dc = stmts.getDiscountCode.get(normalizeDigits(code).trim().toUpperCase());
  if (!dc) return { ok: false, reason: 'unknown' };
  if (dc.expires_at && dc.expires_at < Date.now() / 1000) return { ok: false, reason: 'unknown' };
  if (dc.only_user_id && dc.only_user_id !== userId) return { ok: false, reason: 'unknown' };
  // کدِ «اولین شارژ» فقط تا قبل از اولین شارژِ تأییدشده معتبر است (وگرنه کاربری که بارِ اول
  // بدون کد پرداخت کرده بود، می‌توانست همان کد را روی شارژِ دومش خرج کند).
  if (dc.code === firstCodeFor(userId) && hasRecharged(userId)) return { ok: false, reason: 'used' };
  const uses = stmts.getUserDiscountUses.get(dc.id, userId).c
    + stmts.countPendingDiscount.get(dc.id, userId, currentPaymentId).c;
  if (uses >= dc.max_uses_per_user) return { ok: false, reason: 'used' };
  let disc = Math.round(amount * dc.discount_percent / 100);
  if (dc.max_discount_amount != null && disc > dc.max_discount_amount) disc = dc.max_discount_amount;
  return { ok: true, dc, finalAmount: Math.max(0, amount - disc) };
}

// آیا این متن دقیقاً یک کدِ تخفیفِ فعالِ موجود در DB است؟ (تک‌کلمه و کوتاه — رسیدِ واقعی
// هیچ‌وقت این شکل نیست). گاردِ «کد را جای اشتباه فرستادم».
function looksLikeDiscountCode(text) {
  const t = normalizeDigits(String(text ?? '')).trim().toUpperCase();
  if (!t || t.length > 32 || /\s/.test(t)) return false;
  try { return !!stmts.getDiscountCode.get(t); } catch { return false; }
}

async function applyDiscount(ctx, uid, codeText) {
  const s = getSession(uid);
  const p = s.paymentId && stmts.getPayment.get(s.paymentId);
  if (!p) { setState(uid, 'idle'); return ctx.reply(L.errors.stateLost, mainKeyboard(ctx.from.id)); }
  const v = validateDiscount(codeText, uid, p.original_amount || p.amount, p.id);
  if (!v.ok) {
    // کدِ اشتباه کاربر را از مرحله‌ی کد بیرون نمی‌اندازد. قبلاً state به pay_receipt برمی‌گشت و
    // تلاشِ دومِ کاربر به‌عنوان «رسیدِ متنی» بلعیده می‌شد → پرداختی که هرگز انجام نشده بود به
    // ادمین می‌رفت و ساعت‌ها بعد «تأیید نشد» می‌گرفت (اتفاقِ واقعیِ ۱۴۰۵/۰۵/۰۹).
    return ctx.reply(v.reason === 'used' ? L.wallet.usedDiscount : L.wallet.badDiscount, Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.backToInvoice, `disc_back:${p.id}`)],
    ]));
  }
  stmts.setPaymentDiscount.run(v.dc.id, v.finalAmount, p.id);
  setState(uid, 'pay_receipt');
  await ctx.reply(L.wallet.invoiceDiscounted(p.original_amount || p.amount, v.finalAmount, v.dc.code), { parse_mode: 'Markdown' });
  if (v.finalAmount === 0) {
    // کد ۱۰۰٪ → تأیید خودکار بدون رسید
    await approvePayment(p.id, null);
    await ctx.reply(L.wallet.freeApproved);
    await afterApproval(uid);
  } else {
    await ctx.reply(L.wallet.invoice(v.finalAmount, CARD_NUMBER, CARD_OWNER), {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([cardCopyRow()]).reply_markup,
    });
  }
}

async function sendReceiptToAdmin(ctx, uid, paymentId, photoFileId, textBody) {
  const user = getUser(uid);
  const p = stmts.getPayment.get(paymentId);
  const caption = L.wallet.adminNotify(p, user) + (textBody ? `\n\n📋 ${textBody.slice(0, 500)}` : '');
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback(L.buttons.approve(paymentId), `approve:${paymentId}`),
    Markup.button.callback(L.buttons.reject(paymentId), `reject:${paymentId}`),
  ]]).reply_markup;
  let adminMsg;
  for (const adminId of ADMIN_IDS) {
    try {
      const sent = photoFileId
        ? await ctx.telegram.sendPhoto(adminId, photoFileId, { caption, reply_markup: kb })
        : await ctx.telegram.sendMessage(adminId, caption, { reply_markup: kb });
      if (!adminMsg) adminMsg = sent;
    } catch {}
  }
  stmts.setPaymentReceipt.run(photoFileId || null, adminMsg?.message_id || null, 'waiting_review', paymentId);
}

// ورودیِ همه‌ی رسیدها (عکس/متن): داوریِ ایجنتِ کارت‌به‌کارت، سپس مسیر:
//   approve  → اعتبار + پیام به کاربر + اطلاع به ادمین با دکمه‌ی «پیامکش نیومده» (شبکه‌ی ایمنی)
//   reject   → رد + پیام با دلیل (مگر «اصلاً رسید نیست» که فقط راهنمایی و پرداخت باز می‌ماند)
//   review   → کلِ رسید با دکمه‌های تأیید/رد به ادمین (تصمیمِ انسانی)
// auto-approve خاموش (کلید سراسری) یا کاربرِ بی‌اعتماد → همیشه review (بدونِ خرجِ ایجنت).
async function processReceipt(ctx, uid, paymentId, photoFileId, textBody, recovered) {
  const p = stmts.getPayment.get(paymentId);
  if (!p) { setState(uid, 'idle'); return ctx.reply(L.errors.stateLost, mainKeyboard(ctx.from.id)); }
  const s = getSession(uid);
  const nextState = s?.readingId ? 'confirm_pay' : 'idle';
  track(db, uid, EVENTS.RECEIPT_SUBMITTED, { payment_id: paymentId, amount: p.amount });
  // رسیدِ خام را همان اول ذخیره کن (برای بازبینی/برگشت) بدونِ تغییرِ وضعیت
  if (photoFileId) stmts.saveReceiptFile.run(photoFileId, paymentId);

  // پیامِ انسانی: رسید برای بررسی/تأیید فرستاده شد (هیچ اشاره‌ای به بررسیِ خودکار نیست)
  await ctx.reply(L.wallet.receiptSent).catch(() => {});

  // کلیدِ خاموشی یا کاربرِ بی‌اعتماد → مستقیم به ادمینِ واقعی (بدونِ تصمیمِ خودکار و بدونِ تأخیرِ ساختگی)
  if (!RECEIPT_AI_AUTO_APPROVE || isDistrusted(uid)) {
    await sendReceiptToAdmin(ctx, uid, paymentId, photoFileId, textBody);
    return setState(uid, nextState);
  }

  // دانلودِ عکس برای ایجنت (fail-safe: هر خطا → بدونِ عکس؛ ایجنت آن را به review می‌برد)
  let imageBuffer = null;
  if (photoFileId) {
    try {
      const link = await ctx.telegram.getFileLink(photoFileId);
      const res = await fetch(link.href);
      imageBuffer = Buffer.from(await res.arrayBuffer());
    } catch (e) { logErr('receipt download:', e.message); }
  }
  // مبلغِ موردِانتظار = اصلِ قبل از تخفیف (همان که کاربر واریز می‌کند و اعتبار می‌گیرد)
  const amountToman = p.original_amount || p.amount;
  let decision;
  try {
    const verdict = await analyzeReceipt({
      apiKey: OPENROUTER_API_KEY, model: RECEIPT_MODEL,
      expected: { amount_toman: amountToman, recipient: CARD_RECIPIENT_NAME, dest_last4: CARD_DEST_LAST4 },
      imageBuffer, imageMime: 'image/jpeg', text: textBody,
    });
    decision = decideReceipt(verdict, amountToman); // گاردِ قطعیِ مبلغ (پرداختِ بیشتر → تأیید)
  } catch (e) {
    logErr('receipt agent:', e.message);
    decision = { action: 'review', reason_fa: '', overpaid: 0 };
  }

  // تأخیرِ انسانیِ ۳ تا ۱۰ ثانیه (حسِ «ادمین دارد اپِ بانکی را چک می‌کند») — فقط مسیرِ خودکار
  await sleep(3000 + Math.floor(Math.random() * 7000));

  const reasonFa = decision.reason_fa || 'نامشخص';
  try {
    // سیاست: فقط دو نتیجه‌ی خودکار — approve (پرداختِ کافی و واقعی) و reject (فقط مبلغِ اکیداً کمتر).
    // بقیه (not_a_receipt/بی‌کیفیت/مشکوک) → تصمیمِ انسانیِ ادمین. کاربر همیشه فقط یکی از دو
    // پیامِ نهایی را می‌گیرد: «تأیید شد» یا «تأیید نشد + پشتیبانی» (هیچ «این رسید نیست» یا دلیلی).
    if (decision.action === 'approve') {
      const done = approvePayment(paymentId);
      if (!done) return setState(uid, nextState); // ضدِ دوبار (قبلاً نهایی شده)
      await ctx.reply(L.wallet.approved(done.creditAmount, getBalance(uid), done.bonus)).catch(() => {});
      await notifyAdminAutoApproved(stmts.getPayment.get(paymentId), getUser(uid), reasonFa, decision.overpaid, amountToman);
      return await afterApproval(uid); // فالِ رزروشده خودکار ادامه پیدا می‌کند (state را خودش می‌زند)
    }
    if (decision.action === 'reject') {
      rejectPaymentAI(paymentId);
      setState(uid, nextState);
      await notifyAdminAuto(p, getUser(uid), `❌ auto-reject: ${reasonFa}`, photoFileId);
      return ctx.reply(L.wallet.rejected).catch(() => {}); // پیامِ یکپارچه، بدونِ دلیل
    }
    // not_a_receipt یا review → تصمیمِ انسانیِ ادمین (پیامِ receiptSent قبلاً رفته)
    await sendReceiptToAdmin(ctx, uid, paymentId, photoFileId, textBody);
    setState(uid, nextState);
  } catch (e) {
    // شبکه‌ی ایمنیِ نهایی: کاربر هرگز بی‌جواب نماند و پول در هوا نماند → به ادمینِ انسانی بسپار
    logErr('processReceipt terminal:', e.message);
    try { await sendReceiptToAdmin(ctx, uid, paymentId, photoFileId, textBody); } catch {}
    setState(uid, nextState);
  }
}

// اطلاع به ادمین‌ها بعد از تأییدِ خودکار + دکمه‌ی «پیامکش نیومده» (تنها راهِ برگشتِ رسیدِ فیک)
// overpaid>0 یعنی کاربر بیشتر واریز کرده → یادداشتِ اضافه برای اعتبارِ دستیِ اختلاف.
async function notifyAdminAutoApproved(p, user, reasonFa, overpaid = 0, expectedToman = 0) {
  let caption = L.wallet.adminAutoApproved(p, user, reasonFa);
  if (overpaid > 0) caption += `\n\n⚠️ ${L.wallet.overpaidNote(expectedToman || (p.original_amount || p.amount), overpaid)}`;
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback(L.buttons.smsNotArrived, `cardsms:${p.id}`),
  ]]).reply_markup;
  for (const adminId of ADMIN_IDS) {
    try {
      if (p.receipt_file_id) await bot.telegram.sendPhoto(adminId, p.receipt_file_id, { caption, reply_markup: kb });
      else await bot.telegram.sendMessage(adminId, caption, { reply_markup: kb });
    } catch {}
  }
}
// یادداشتِ ساده به ادمین‌ها (بدونِ دکمه) — مثلِ اطلاعِ auto-reject. user ممکن است null باشد (گاردِ ??).
async function notifyAdminAuto(p, user, note, photoFileId) {
  const caption = `${note}\n\n${L.wallet.adminNotify(p, user || { name: '-', username: '' })}`;
  for (const adminId of ADMIN_IDS) {
    try {
      if (photoFileId) await bot.telegram.sendPhoto(adminId, photoFileId, { caption });
      else await bot.telegram.sendMessage(adminId, caption);
    } catch {}
  }
}
// ردِ خودکارِ ایجنت — از pending هم مجاز (قبل از waiting_review)؛ ضدِ دوبار با گاردِ status
function rejectPaymentAI(paymentId) {
  const p = stmts.getPayment.get(paymentId);
  if (!p || !['pending', 'waiting_review'].includes(p.status)) return null;
  stmts.setPaymentStatus.run('rejected', p.id);
  track(db, p.user_id, EVENTS.PAYMENT_REJECTED, { payment_id: p.id, amount: p.amount, via: 'ai' });
  return p;
}
// برگشتِ پرداختِ فیک: کسرِ اعتبارِ ناشی از این پرداخت (کفِ صفر) + بی‌اعتمادکردنِ کاربر.
// ضدِ دوبار با گذارِ اتمیکِ approved→reversed. null یعنی قبلاً برگشت خورده/approved نبوده.
async function reversePayment(paymentId) {
  if (stmts.markPaymentReversed.run(paymentId).changes === 0) return null;
  const p = stmts.getPayment.get(paymentId);
  const creditAmount = p.original_amount || p.amount;
  const back = creditAmount + bonusFor(creditAmount); // همان که approve اعتبار داد (اصل + هدیه)
  stmts.clawback.run(back, p.user_id);
  stmts.setDistrust.run(p.user_id);
  track(db, p.user_id, 'payment_reversed', { payment_id: paymentId, amount: p.amount, clawed: back });
  return { p, back };
}

function approvePayment(paymentId) {
  const p = stmts.getPayment.get(paymentId);
  if (!p || !['pending', 'waiting_review'].includes(p.status)) return null;
  const creditAmount = p.original_amount || p.amount;
  const bonus = bonusFor(creditAmount); // هدیه‌ی شارژ روی مبلغ اصلی (قبل از تخفیف)
  stmts.setPaymentStatus.run('approved', paymentId);
  stmts.credit.run(creditAmount + bonus, p.user_id);
  track(db, p.user_id, EVENTS.PAYMENT_APPROVED, { payment_id: paymentId, amount: p.amount, credited: creditAmount + bonus });
  if (p.discount_code_id) {
    stmts.incDiscountUses.run(p.discount_code_id);
    stmts.insertDiscountUse.run(p.discount_code_id, p.user_id, paymentId, (p.original_amount || p.amount) - p.amount);
  }
  return { p, creditAmount, bonus };
}

// پیشنهاد دوباره‌ی فال رزروشده (بعد از انصراف پرداخت، پیام متنی وسط پی‌وال و…)
async function offerPendingReading(ctx, uid) {
  const s = getSession(uid);
  const r = s.readingId && stmts.getReading.get(s.readingId);
  if (!r || r.status !== 'pending_payment') return false;
  const balance = getBalance(uid);
  if (balance >= r.price) {
    await ctx.reply(L.reading.paywall(r.price), Markup.inlineKeyboard([
      [Markup.button.callback(L.buttons.openCards(r.price), `unlock:${r.id}`)],
      [Markup.button.callback(L.buttons.cancel, `rcancel:${r.id}`)],
    ]));
  } else {
    await ctx.reply(needBalanceText(uid, r.price, cardsOf(r)), Markup.inlineKeyboard([
      ...needBalanceRows(),
      [Markup.button.callback(L.buttons.cancel, `rcancel:${r.id}`)],
    ]));
  }
  return true;
}

// مهم‌ترین اهرم کانورژن: بعد از تأیید شارژ، فالِ رزروشده خودکار ادامه پیدا می‌کند
async function afterApproval(uid) {
  const s = getSession(uid);
  delete s.paymentId;
  setSession(uid, s);
  if (s.readingId) {
    const r = stmts.getReading.get(s.readingId);
    if (r && r.status === 'pending_payment') {
      setState(uid, 'confirm_pay');
      await bot.telegram.sendMessage(uid, L.reading.resumeAfterRecharge, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(L.buttons.openCards(r.price), `unlock:${r.id}`)],
        ]).reply_markup,
      }).catch(() => {});
      return;
    }
  }
  setState(uid, 'idle');
}

bot.action(/^approve:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  const done = approvePayment(parseInt(ctx.match[1], 10));
  if (!done) return ctx.answerCbQuery('قبلاً پردازش شده').catch(() => {});
  await ctx.answerCbQuery('✅').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  const { p, creditAmount, bonus } = done;
  await bot.telegram.sendMessage(p.user_id, L.wallet.approved(creditAmount, getBalance(p.user_id), bonus)).catch(() => {});
  await afterApproval(p.user_id);
});
bot.action(/^reject:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  const p = rejectPaymentDb(parseInt(ctx.match[1], 10));
  if (!p) return ctx.answerCbQuery('قبلاً پردازش شده').catch(() => {});
  await ctx.answerCbQuery('❌').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await bot.telegram.sendMessage(p.user_id, L.wallet.rejected).catch(() => {});
});

/* ── شبکه‌ی ایمنیِ auto-approve: «پیامکش نیومده» → تأیید دوم → برگشت + بی‌اعتمادی ── */
bot.action(/^cardsms:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  await ctx.answerCbQuery().catch(() => {});
  const pid = parseInt(ctx.match[1], 10);
  await ctx.reply(L.wallet.confirmReverse(pid), Markup.inlineKeyboard([[
    Markup.button.callback(L.buttons.reverseYes, `cardrev:${pid}`),
    Markup.button.callback(L.buttons.reverseNo, `cardrevno:${pid}`),
  ]])).catch(() => {});
});
bot.action(/^cardrev:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  await ctx.answerCbQuery('در حال برگشت…').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  const done = await reversePayment(parseInt(ctx.match[1], 10));
  if (!done) return ctx.reply(L.wallet.reverseAlready).catch(() => {});
  await bot.telegram.sendMessage(done.p.user_id, L.wallet.reversedUser).catch(() => {});
  await ctx.reply(L.wallet.adminReversed(done.p.id, done.p.user_id, done.back)).catch(() => {});
});
bot.action(/^cardrevno:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🔒').catch(() => {});
  await ctx.answerCbQuery('بی‌خیال شد').catch(() => {});
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}
  await ctx.reply(L.wallet.reverseCancelled(parseInt(ctx.match[1], 10))).catch(() => {});
});

/* ── رد پرداخت (DB جدا از ctx) + یادآوری/صف داشبورد (مثل voice2text) ── */
function rejectPaymentDb(paymentId) {
  const p = stmts.getPayment.get(paymentId);
  if (!p || p.status !== 'waiting_review') return null;
  stmts.setPaymentStatus.run('rejected', p.id);
  track(db, p.user_id, EVENTS.PAYMENT_REJECTED, { payment_id: p.id, amount: p.amount });
  return p;
}
// ارسال دوباره‌ی رسیدِ معطل به ادمین‌ها با همان دکمه‌های تأیید/رد
async function resendReceiptToAdmins(p) {
  const u = getUser(p.user_id);
  const caption = `⏳ یادآوری: رسید منتظر تأیید (بیش از ۲ ساعت)\n\n👤 ${dispName(u) || u?.name || '-'}\n🆔 ${p.user_id}\n💰 ${(p.original_amount || p.amount).toLocaleString('fa-IR')} تومان\n🔢 پرداخت #${p.id}\n\nهمین‌جا تأیید/رد کن (یا از داشبورد):`;
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback('✅ تایید', `approve:${p.id}`),
    Markup.button.callback('❌ رد', `reject:${p.id}`),
  ]]).reply_markup;
  for (const adminId of ADMIN_IDS) {
    try {
      if (p.receipt_file_id) await bot.telegram.sendPhoto(adminId, p.receipt_file_id, { caption, reply_markup: kb });
      else await bot.telegram.sendMessage(adminId, caption, { reply_markup: kb });
    } catch {}
  }
  stmts.setReminded.run(p.id);
}
// sweep پرداخت (۶۰ ثانیه): درین صف اکشن داشبورد + یادآوری رسیدهای معطل — همه fail-safe
setInterval(async () => {
  try {
    for (const act of stmts.pendingActions.all()) {
      try {
        if (act.action === 'approve') {
          const done = approvePayment(act.payment_id);
          if (done) { await bot.telegram.sendMessage(done.p.user_id, L.wallet.approved(done.creditAmount, getBalance(done.p.user_id), done.bonus)).catch(() => {}); await afterApproval(done.p.user_id); }
        } else if (act.action === 'reject') {
          const p = rejectPaymentDb(act.payment_id);
          if (p) await bot.telegram.sendMessage(p.user_id, L.wallet.rejected).catch(() => {});
        }
      } catch (e) { logErr('admin_action exec:', act.id, e.message); }
      stmts.markActionDone.run(act.id);
    }
    for (const p of stmts.staleReceipts.all()) await resendReceiptToAdmins(p);
  } catch (e) { logErr('payment sweep:', e.message); }
}, 60_000);

/* ---------- ادمین: /stats و /newcode ---------- */
bot.command('stats', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const types = stmts.readingsByType.all().map(t => `  ${t.type}: ${fmt(t.c)} فال / ${fmt(t.s)} تومان`).join('\n') || '  —';
  // قیف کانورژن: pending_payment باقی‌مانده = رهاشده در پی‌وال؛ delivered/کل = نرخ تکمیل
  const funnel = stmts.readingsByStatus.all().map(x => `  ${x.status}: ${fmt(x.c)}`).join('\n') || '  —';
  return ctx.reply(
    `📊 آمار\n\n👥 کاربران: ${fmt(stmts.countUsers.get().c)}\n` +
    `💰 درآمد ۲۴س: ${fmt(stmts.dailyRevenue.get().s)}\n💰 درآمد ۳۰روز: ${fmt(stmts.monthlyRevenue.get().s)}\n💰 کل: ${fmt(stmts.totalRevenue.get().s)}\n\n🔮 فال‌های کامل:\n${types}\n\n📈 قیف (وضعیت همه‌ی فال‌ها):\n${funnel}`
  );
});
// /newcode CODE PERCENT DAYS [USER_ID]
bot.command('newcode', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  const [code, percent, days, onlyUser] = parts;
  const pct = parseInt(normalizeDigits(percent || ''), 10);
  const d = parseInt(normalizeDigits(days || ''), 10);
  if (!code || !pct || !d) return ctx.reply('فرمت: /newcode CODE PERCENT DAYS [USER_ID]');
  try {
    stmts.insertDiscountCode.run(code.toUpperCase(), pct, null, Math.floor(Date.now() / 1000) + d * 86400,
      1, onlyUser ? parseInt(normalizeDigits(onlyUser), 10) : null, ctx.from.id);
    return ctx.reply(`✅ کد ${code.toUpperCase()} (${pct}٪، ${d} روز) ساخته شد.`);
  } catch (e) { return ctx.reply(`❌ ${e.message}`); }
});

/* ---------- اشتراک‌گذاری (inline mode) ---------- */
bot.on('inline_query', async (ctx) => {
  const uid = ctx.from.id;
  try {
    await ctx.answerInlineQuery([{
      type: 'article',
      id: 'invite',
      title: L.share.inlineTitle,
      description: L.share.inlineDesc,
      input_message_content: { message_text: L.share.message(BOT_USERNAME, uid) },
    }], { cache_time: 0, is_personal: true });
  } catch (e) { logErr('inline query:', e.message); }
});

/* ---------- ریست تست (قرارداد ریپو §۶ب — فاز تست: همه‌ی کاربران) ---------- */
// ابزارِ مدیریتیِ فقط-ادمین (دو آی‌دیِ ADMIN_IDS)، همیشه فعال — حتی خارج از فاز تست.
// فقط دیتای خودِ همان ادمین را پاک می‌کند و او را مثل یک کاربرِ کاملاً جدید از نو معرفی می‌کند
// (برای تستِ فلوها بدون انتظار). هیچ کاربر دیگری این را نمی‌بیند و در هیچ فلویی دخالت نمی‌کند.
async function doReset(ctx) {
  if (!isAdmin(ctx.from.id)) return; // گاردِ اصلی — دکمه فقط برای ادمین‌ها نمایش داده می‌شود، این هم لایه‌ی دوم
  wipeUser(ctx.from.id);
  track(db, ctx.from.id, EVENTS.RESET, {});
  await ctx.reply(L.reset.done, mainKeyboard(ctx.from.id));
  return handleStart(ctx); // مثل کاربر تازه: آنبوردینگ از نو (upsertUser → isNew=true)
}
// هم برچسبِ جدید، هم برچسبِ قدیمیِ فاز تست (برای دکمه‌ی کش‌شده‌ی احتمالی) — doReset خودش isAdmin را چک می‌کند
bot.hears([L.buttons.resetTest, '🔄 ریست ربات (تست)'], doReset);
bot.command('reset', doReset);

// 💬 پشتیبانی: عمداً هیچ گاردی جلویش نیست (راهِ فرارِ کاربرِ گیرکرده باید همیشه باز باشد و
// چون فقط یک پیامِ اطلاعاتی است، هیچ فلو/فاکتوری را یتیم نمی‌کند). ولی چون قبل از bot.on('text')
// ثبت می‌شود، متنِ دکمه دیگر به‌عنوان «نام» یا «مبلغ» بلعیده نمی‌شود؛ بعدش هم قدمِ فعلیِ کاربر
// دوباره یادآوری می‌شود تا سرگردان نماند (قرارداد ۹ب).
registerSupport(bot, {
  botCode: 'TRT',
  texts: L.support,
  after: async (ctx) => {
    if (await blockDuringOnboarding(ctx)) return;
    if (await blockDuringOpenReading(ctx)) return;
    await blockDuringOpenPay(ctx);
  },
});

/* ---------- هندلر متن (state machine) ---------- */
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  const state = getState(uid);
  try {
    if (state === 'onboard_name') return await finishNameOnboarding(ctx, text);
    // در مرحله‌ی حوزه‌ی تمرکز، ورودی متنی را نمی‌گیریم؛ کاربر باید از دکمه‌ها انتخاب کند (نه رد کردن مرحله).
    if (state === 'onboard_focus') {
      return ctx.reply(L.onboarding.askFocus, Markup.inlineKeyboard(
        L.buttons.focusOptions.map(([key, label]) => [Markup.button.callback(label, `focus:${key}`)])
      ));
    }
    if (state === 'await_question') return await handleQuestion(ctx, text.trim());
    if (state === 'pay_amount') {
      const amount = parseInt(normalizeDigits(text).replace(/[^\d]/g, ''), 10);
      if (!amount || amount <= 0) return ctx.reply(L.wallet.invalidAmount());
      return await setRechargeAmount(ctx, uid, amount);
    }
    if (state === 'pay_discount') return await applyDiscount(ctx, uid, text);
    if (state === 'pay_receipt') {
      // رسید متنی
      const s = getSession(uid);
      if (!s.paymentId) return ctx.reply(L.errors.stateLost, mainKeyboard(ctx.from.id));
      // اگر متن خودش یک کدِ تخفیفِ موجود است، رسید نیست: کاربر کدش را یک قدم دیرتر فرستاده.
      // ثبتش به‌عنوان رسید یعنی پرداختِ ناموجود در صفِ ادمین و در نهایت پیامِ «تأیید نشد» به
      // کاربری که اصلاً پولی نفرستاده بود. به‌جایش مثل کد تخفیف رفتارش می‌کنیم.
      if (looksLikeDiscountCode(text)) {
        setState(uid, 'pay_discount');
        return await applyDiscount(ctx, uid, text);
      }
      return await processReceipt(ctx, uid, s.paymentId, null, text, false);
    }
    if (state === 'feedback') {
      const s = getSession(uid);
      if (s.readingId) return await handleFeedback(ctx, uid, s.readingId, 'text', text.trim());
    }
    // وسط فلوی فال: به‌جای پیام خوش‌آمدِ گیج‌کننده، نرم به دکمه‌ها برگردان
    if (state === 'confirm_pay') {
      if (await offerPendingReading(ctx, uid)) return;
    }
    if (['choose_spread', 'confirm_focus', 'breathing', 'shuffling', 'picking', 'revealing'].includes(state)) {
      // خوانش هنوز باز است: بلاک می‌کنیم ولی راهِ فرار (بازگشت به منو) را در همان پیام می‌دهیم تا کاربر گیر نیفتد
      return ctx.reply(L.errors.useButtons, navMenuKb());
    }
    // پیش‌فرض: کاربر جدید → آنبوردینگ؛ بقیه → منوی اصلی
    if (!getUser(uid).welcomed) return handleStart(ctx);
    return ctx.reply(L.returning.greeting(dispName(getUser(uid)), getBalance(uid)), mainKeyboard(ctx.from.id));
  } catch (e) {
    logErr('text handler:', e.message);
    return ctx.reply(L.errors.generic).catch(() => {});
  }
});

/* ---------- ویس (سؤال فال با ویس) ---------- */
bot.on(['voice', 'audio'], async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  // در مرحله‌ی نام، ویس نمی‌گیریم (نام را تایپی می‌خواهیم) — راهنمای نرم به‌جای سکوت
  if (getState(uid) === 'onboard_name') return ctx.reply(L.onboarding.askNameRetry);
  if (getState(uid) !== 'await_question') return;
  try {
    const media = ctx.message.voice || ctx.message.audio;
    // سقف طول/حجم — رونویسی قبل از پرداخت انجام می‌شود و نباید هزینه‌ی بی‌سقف بسازد
    if ((media.duration && media.duration > MAX_VOICE_SEC) || (media.file_size && media.file_size > MAX_VOICE_BYTES)) {
      return ctx.reply(L.errors.voiceTooLong(MAX_VOICE_SEC));
    }
    await typing(ctx, PACE_S);
    const link = await ctx.telegram.getFileLink(media.file_id);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = media.mime_type || 'audio/ogg';
    let txt = null;
    for (let attempt = 0; attempt < 2 && !txt; attempt++) {
      txt = await orTranscribe(buf, /wav/i.test(mime) ? 'wav' : 'mp3').catch(e => { logErr('transcribe:', e.message); return null; });
    }
    if (!txt?.trim()) return ctx.reply(L.errors.generic);
    return await handleQuestion(ctx, txt.trim());
  } catch (e) {
    logErr('voice handler:', e.message);
    return ctx.reply(L.errors.generic).catch(() => {});
  }
});

/* ---------- عکس (رسید پرداخت) ---------- */
bot.on('photo', async (ctx) => {
  const uid = ctx.from.id;
  upsertUser(ctx);
  const s = getSession(uid);
  // مسیر عادی: وسط فلوی رسید. مسیر بازیابی: state گم شده (کاربر بعد از فاکتور /start زده) ولی
  // پرداختِ منتظرِ رسید در DB هست → عکس را به همان وصل کن تا پول واقعی در سیاه‌چاله نیفتد.
  let paymentId = (getState(uid) === 'pay_receipt' && s?.paymentId) ? s.paymentId : null;
  let recovered = false;
  if (!paymentId) {
    const pend = stmts.pendingReceiptPayment.get(uid);
    if (!pend) return; // عکسِ بی‌ربط به پرداخت — نادیده
    paymentId = pend.id; recovered = true;
  }
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  await processReceipt(ctx, uid, paymentId, fileId, null, recovered);
});

/* ---------- sweep ساعتی milestone (پوش پیشگیرانه، سقف ۱/هفته) ---------- */
setInterval(async () => {
  try {
    for (const { telegram_id } of stmts.dueMilestones.all()) {
      const last = stmts.lastDelivered.all(telegram_id, 1)[0];
      stmts.setPush.run(telegram_id);
      if (!last?.summary) continue;
      await bot.telegram.sendMessage(telegram_id, L.milestone.checkin(last.summary), {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(L.buttons.daily, 'daily_go')],
          [Markup.button.callback(L.buttons.startThree(), 'spread:three')],
        ]).reply_markup,
      }).catch(() => {});
      await sleep(300);
    }
  } catch (e) { logErr('milestone sweep:', e.message); }
}, 3600 * 1000);

/* ===== Launch ===== */
if (!existsSync('./assets/cards/back.jpg')) logErr('⚠️ assets/cards ناقص است — تصاویر کارت‌ها را کامیت/دانلود کن');
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => { log(`✅ tarot bot started (long polling, locale=${LOCALE})`); recoverOrphanReadings(); })
    .catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
bot.telegram.getMe().then(me => { BOT_USERNAME = me.username; }).catch(() => {});
launch();
registerGlobalErrorHandlers('tarot');
process.once('SIGINT',  () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
