// رجیستری ربات‌ها و اتصال به دیتابیس‌هایشان.
// خواندن تحلیلی: اتصال readonly و per-request (کوتاه — WAL checkpoint بلاک نمی‌شود).
// نوشتن config (کد تخفیف): اتصال writable جدا + تراکنش کوتاه + گارد schema (schema-guard).
import { readdirSync, statSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { logErr } from '../../../shared/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// رجیستری ربات‌ها + «پروفایل schema» هر ربات.
//
// افزودن ربات جدید به داشبورد = فقط یک ردیف این‌جا (اگر ربات قرارداد آنالیتیکسِ
// shared را رعایت کرده باشد — بند «افزودن ربات جدید» در CLAUDE.md ریشه).
// پروفایل، تفاوت‌های schema را کپسوله می‌کند تا هیچ route ای مقدار hardcode نداشته باشد:
//   userPk         نام ستون کلید کاربر (پیش‌فرض telegram_id؛ ربات‌های پایتونی user_id)
//   userNameCol    ستون نام نمایشی کاربر برای پشتیبانی (پیش‌فرض name؛ tabir first_name)
//   userCreatedKind فرمت users.created_at: 'unix' (ثانیه) یا 'iso' (رشته‌ی ISO)
//   money          مدل مالی: جدول/ستون مبلغ/وضعیت موفق/وضعیت معلق/واحد/فرمت زمان/
//                  فیلترِ حذف پرداختِ تستی (testFilter؛ مثل charge_id شبیه‌سازی tabir)
//   dataDir        نسبی (کنار bots/) یا مطلق (سرور)؛ envDir = نام env برای override مسیر
//   idFromFile     استخراج برچسب instance (زبان/پلتفرم) از نام فایل db
//
// نکته‌ی مهم: جدول `events` در همه‌ی ربات‌ها یکسان است (قرارداد shared/analytics.js)
// و created_at آن همیشه unix است؛ پس کوئری‌های events هرگز به پروفایل نیاز ندارند.
const MONEY_WALLET = { table: 'payments', amountCol: 'amount', successStatus: 'approved', pendingStatus: 'waiting_review', unit: 'toman', createdKind: 'unix', testFilter: '' };

export const BOTS = [
  {
    key: 'voice2text', title: '🎙 ویس به متن', dataDir: '../voice2text/data', pattern: /^bot\.db$/,
    userPk: 'telegram_id', userNameCol: 'name', userCreatedKind: 'unix', money: MONEY_WALLET,
    receiptQueue: true, // جدول admin_actions دارد؛ داشبورد تأیید/رد را enqueue می‌کند
  },
  {
    // `envDir` فقط برای تست: چکِ CI مسیرِ دیتابیس را به یک فیکسچرِ موقت می‌برد تا
    // «عدد» و «لیستِ کاربرانِ پشتِ عدد» را روی دیتای واقعی مقایسه کند. روی سرور ست نیست.
    key: 'tarot', title: '🔮 تاروت', dataDir: '../tarot/data', envDir: 'TAROT_DB_DIR', pattern: /^bot-[a-z-]+\.db$/,
    userPk: 'telegram_id', userNameCol: 'name', userCreatedKind: 'unix', money: MONEY_WALLET,
    abSupport: true, // ربات shared/ab.js را سیم‌کشی کرده و variant() صدا می‌زند
    receiptQueue: true,
    /* 💎 واحدِ اعتبارِ این ربات **الماس** است، نقطه.
     *
     * ⚠️ عددی که در `users.balance` و `payments.original_amount` نشسته یک **فرمتِ
     * ذخیره‌سازیِ بازمانده از دوره‌ی تومانی** است (هر الماس ×۱۰٬۰۰۰)، نه یک قیمت.
     * اثباتش از خودِ بسته‌ها: ۳۰٬۰۰۰÷۱۰ = ۳٬۰۰۰ · ۶۰٬۰۰۰÷۳۰ = ۲٬۰۰۰ ·
     * ۱۵۰٬۰۰۰÷۱۰۰ = ۱٬۵۰۰ تومان برای هر الماس. یعنی **هیچ نرخِ واحدی وجود ندارد**
     * و هر تبدیلِ الماس→تومان نه‌فقط بدسلیقگی، بلکه از نظرِ حسابی **غلط** است.
     * پس این عدد فقط برای **دیکود کردنِ همان فرمتِ ذخیره‌سازی** به کار می‌رود و
     * هیچ‌جا به‌عنوان «قیمت» یا «نرخ» استفاده نمی‌شود. */
    // بعد از مهاجرتِ «الماسِ بومی» (۱۴۰۵/۰۵/۳۰) عددِ داخلِ دیتابیس **خودِ تعدادِ الماس**
    // است، پس ضریب ۱ است. این فیلد دیگر «دیکودِ فرمت» نیست، فقط اعلامِ واحد.
    coinValue: 1, coinName: 'الماس', coinEmoji: '💎',
    idFromFile: (f) => f.replace(/^bot-|\.db$/g, ''), // locale
  },
  {
    // پادکستِ آموزشیِ روزانه (فقط ادمین، بدونِ پول). جدولِ payments خالی است و فقط برای
    // هم‌قرارداد ماندن با پروفایلِ پیش‌فرض ساخته می‌شود، پس صفحه‌ی مالی صفر نشان می‌دهد.
    key: 'daily-brief', title: '🎧 پادکست روزانه', dataDir: '../daily-brief/data', pattern: /^bot\.db$/,
    userPk: 'telegram_id', userNameCol: 'name', userCreatedKind: 'unix', money: MONEY_WALLET,
  },
  {
    key: 'tabir-khab', title: '🌙 تعبیر خواب', pattern: /^tabir_.*\.db$/,
    // مسیر مطلق سرور (استثنای مونوریپو)؛ لوکال با env قابل override و اگر نبود، صرفاً خالی
    dataDir: '/home/ubuntu/tabir_khab', envDir: 'TABIR_DB_DIR',
    userPk: 'user_id', userNameCol: 'first_name', userCreatedKind: 'iso',
    money: { table: 'transactions', amountCol: 'amount_rial', successStatus: 'paid', pendingStatus: 'pending', unit: 'rial', createdKind: 'iso', testFilter: "charge_id NOT IN ('SKIP','SIMULATED')" },
    // پلتفرم:زبان از نام فایل (tabir_bale.db → bale، tabir_telegram_en.db → telegram-en، tabir_telegram.db → telegram-fa)
    idFromFile: (f) => {
      const m = f.replace(/^tabir_|\.db$/g, '');
      return m === 'telegram' ? 'telegram-fa' : m.replace('_', '-');
    },
  },
];
export const botByKey = (key) => BOTS.find(b => b.key === key);

const dirOf = (b) => (b.envDir && process.env[b.envDir]) || b.dataDir;

// هر فایل db یک «instance» است (tarot/tabir چند فایل per زبان). id امن است چون هرگز
// مستقیم به مسیر تبدیل نمی‌شود — همیشه از همین لیست lookup می‌شود (ضد path traversal).
export function instances() {
  const out = [];
  for (const b of BOTS) {
    const dir = path.resolve(dirOf(b));
    let files = [];
    try { files = readdirSync(dir).filter(f => b.pattern.test(f)).sort(); } catch {}
    for (const f of files) {
      const label = b.idFromFile ? b.idFromFile(f) : '';
      out.push({
        id: `${b.key}:${f}`,
        bot: b.key,
        title: b.title + (label ? ` (${label})` : ''),
        file: path.join(dir, f),
      });
    }
  }
  return out;
}

/* ---- helperهای پروفایل: هر route به‌جای مقدار hardcode این‌ها را صدا می‌زند ---- */
export const abSupported = (bot) => !!botByKey(bot)?.abSupport;
export const receiptQueueSupported = (bot) => !!botByKey(bot)?.receiptQueue;
/* 💎 واحدِ کیفِ یک ربات. `null` یعنی ربات تومانی/ریالی است و همه‌چیز دقیقاً مثل قبل
 * می‌ماند — پس voice2text و tabir-khab بیت‌به‌بیت بدونِ تغییر رفتار می‌کنند. */
export const coinOf = (bot) => {
  const b = botByKey(bot);
  return b?.coinValue ? { value: b.coinValue, name: b.coinName || 'الماس', emoji: b.coinEmoji || '💎' } : null;
};

/* ══════════════════════════════════════════════════════════════════════════
   دو دنیای جدا، دو helper جدا. **هرگز یکی را جای دیگری استفاده نکن.**

   `creditText`  = اعتبار / موجودی / کیف / هدیه / کسر  ⟶ واحدِ خودِ ربات (الماس)
   `moneyText`   = پول واقعی / پرداخت / درآمد          ⟶ تومان (یا ریالِ tabir)

   چرا دو تا و نه یکی: helperی که معنی‌اش به نیتِ صداکننده بستگی دارد، دقیقاً همان
   چیزی است که باعث شد `users.balance` جا بماند و مالک «۹۶۰٬۰۰۰ تومان» ببیند به‌جای
   «۹۶💎». حالا انتخابِ helper خودش اعلامِ نیت است و چکِ CI هر ستون را به helperِ
   درستش قفل کرده.
   ══════════════════════════════════════════════════════════════════════════ */

/** عددِ خامِ اعتبار به واحدِ خودِ ربات (برای CSV، مرتب‌سازی و جمع — بدونِ فرمت). */
export const creditNum = (bot, stored) => {
  const c = coinOf(bot);
  const n = Number(stored) || 0;
  return c ? Math.round(n / c.value) : toToman(bot, n);
};

/** اعتبار ⟶ متنِ خوانا به زبانِ همان ربات: «۹۶💎» یا «۵۰٬۰۰۰ تومان». */
export const creditText = (bot, stored) => {
  const c = coinOf(bot);
  // رباتِ بی‌الماس: عیناً همان چیزی که تا امروز می‌دید (ریالِ tabir با toToman نمایشی می‌شود).
  return c ? `${fmtNum(creditNum(bot, stored))}${c.emoji}` : `${fmtNum(toToman(bot, stored))} تومان`;
};

/** پولِ واقعی ⟶ متنِ خوانا. عمداً به `coinOf` کاری ندارد: درآمد هرگز الماسی نمی‌شود. */
export const moneyText = (bot, amount) => `${fmtNum(toToman(bot, amount))} تومان`;

const fmtNum = (n) => Number(n).toLocaleString('fa-IR');
export const userPk = (bot) => botByKey(bot)?.userPk || 'telegram_id';
export const userNameCol = (bot) => botByKey(bot)?.userNameCol || 'name';
export const moneyOf = (bot) => botByKey(bot)?.money || MONEY_WALLET;
// عبارت SQL که یک ستونِ created_at را (بسته به فرمت) به ثانیه‌ی یونیکس تبدیل می‌کند
export const unixOf = (kind, col) => (kind === 'iso' ? `CAST(strftime('%s', ${col}) AS INTEGER)` : col);
export const userCreatedExpr = (bot, col = 'created_at') => unixOf(botByKey(bot)?.userCreatedKind || 'unix', col);
// مبلغ را برای نمایش یکنواخت به تومان تبدیل می‌کند (ریال ÷ ۱۰) تا کارت‌ها قابل‌مقایسه بمانند
export const toToman = (bot, amount) => (moneyOf(bot).unit === 'rial' ? Math.round((Number(amount) || 0) / 10) : (Number(amount) || 0));
// شرط WHERE مالیِ «درآمد واقعی» per ربات (وضعیت موفق + حذف پرداخت تستی)
export function revenueWhere(bot, sinceParamIdx = '?') {
  const m = moneyOf(bot);
  const test = m.testFilter ? ` AND ${m.testFilter}` : '';
  return {
    table: m.table, amountCol: m.amountCol,
    where: `status='${m.successStatus}' AND ${unixOf(m.createdKind, 'created_at')} >= ${sinceParamIdx}${test}`,
    testClause: test,
  };
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
