// index.js — <NAME>: اسکلت استاندارد ربات جدید این مونوریپو.
// از روی bots/_template کپی شده — TODO ها را پر کن و این کامنت‌ها را با توضیح محصول جایگزین کن.
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import { mkdirSync } from 'fs';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import { log, logErr } from '../../shared/logger.js';
import { createOpenRouter, parseJsonLoose } from '../../shared/llm.js';
import { registerAdminReset, adminResetRow } from '../../shared/reset.js';
import { registerGlobalErrorHandlers, makeBotCatch } from '../../shared/errors.js';
// دکمه‌ی پشتیبانی (مشترکِ همه‌ی ربات‌ها) — حسابِ پشتیبانی و کدِ پیگیری در shared/support.js
import { registerSupport, supportRow } from '../../shared/support.js';
// زیرساخت رشد (اتریبیوشن + A/B) — از قبل سیم‌کشی شده؛ فقط track ها را در نقاط فانل بگذار.
// جزئیات کامل: بند «افزودن ربات جدید» در CLAUDE.md ریشه.
import { EVENTS, ensureAnalytics, track, trackOnce, captureStart } from '../../shared/analytics.js';
import { ensureAb, variant } from '../../shared/ab.js';

/* ===== ENV و ثابت‌ها ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { logErr('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

// ادمین‌ها از env: کامای ADMIN_IDS که deploy از OWNER_TELEGRAM_ID می‌سازد (قرارداد یکپارچه‌ی همه‌ی ربات‌ها).
// این‌طوری هر ربات جدید هم همان آی‌دی‌های ادمینِ گیت‌هاب را می‌گیرد؛ هشدار/پشتیبانی هر ربات per-bot می‌ماند.
const ADMIN_IDS = (process.env.ADMIN_IDS || '100257975')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
const OWNER_ID  = ADMIN_IDS[0] || 100257975; // اولین آی‌دی = مالک (کارهای مخرب مثل ریست فقط برای او)
const isAdmin = (uid) => ADMIN_IDS.includes(uid);
const TEST_PHASE = true; // ⚠️ قبل از انتشار عمومی false شود (قرارداد بند ۶ب CLAUDE.md)
// نسخه‌ی محصول (کوهورت users.first_version): با هر تغییر «رفتاری» رو-به-کاربر bump کن — بند «قوانین ربات زنده»
const PRODUCT_VERSION = '1.0.0';

const FLASH = 'google/gemini-2.5-flash';
const or = createOpenRouter({
  apiKey: OPENROUTER_API_KEY,
  defaultModel: FLASH,
  fallbackModel: 'deepseek/deepseek-v3.2',
});

/* ===== Database ===== */
mkdirSync('./data', { recursive: true });
const db = new Database('./data/bot.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    name        TEXT,
    username    TEXT,
    state       TEXT DEFAULT 'new',
    created_at  INTEGER DEFAULT (unixepoch()),
    last_seen   INTEGER DEFAULT (unixepoch())
  );
`);
// زیرساخت رشد: جدول events + ستون‌های first_source/first_payload + جدول‌های A/B.
// قرارداد داشبورد: users با PK به نام telegram_id و created_at از نوع unix (پیش‌فرض داشبورد).
ensureAnalytics(db);
ensureAb(db);
function upsertUser(ctx) {
  db.prepare(`INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
              ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()`)
    .run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
}
// همه‌ی جدول‌های کاربرمحور این ربات را اینجا پاک کن (قرارداد دکمه‌ی ریست تست) — events/ab_exposures هم
function wipeUser(uid) {
  for (const [t, col] of [['users','telegram_id'],['events','user_id'],['ab_exposures','user_id']]) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(uid); } catch (e) { logErr('wipe', t, e.message); }
  }
}

/* ===== Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 10 * 60 * 1000 });
bot.catch(makeBotCatch());
registerGlobalErrorHandlers('<NAME>');

async function handleStart(ctx) {
  const before = db.prepare('SELECT 1 FROM users WHERE telegram_id=?').get(ctx.from.id);
  upsertUser(ctx);
  // اتریبیوشن: رویداد start برای هر /start + first_source/first_version فقط برای کاربر جدید (write-once)
  captureStart(db, ctx.from.id, ctx.startPayload, !before, PRODUCT_VERSION);
  // دکمه‌ی «ریست حساب (ادمین)» فقط برای ادمین‌ها (همیشه، حتی خارج از فاز تست) — ابزار مدیریتی
  const rows = [
    // TODO: ردیف‌های دکمه‌ی محصول را اینجا بگذار، مثل: ['📝 دکمه‌ی اول', '⚙️ دکمه‌ی دوم']
    ...supportRow(), // 💬 پشتیبانی — قرارداد مشترکِ همه‌ی ربات‌ها (بند ۶ج CLAUDE.md)
    ...adminResetRow(isAdmin, ctx.from.id),
  ];
  /* ⌨️ **تنها نقطه‌ی صدورِ کیبوردِ ماندگار — بند ۹ب-۳ ریشه.**
     قاعده: بعد از آنبوردینگ، تحت هیچ شرایطی و برای هیچ کاربری نباید منوی پایین از دسترس
     خارج باشد. کیبوردِ reply روی **گوشیِ کاربر** ذخیره است و هیچ متدی در Bot API از سمتِ
     سرور تازه‌اش نمی‌کند؛ نبودنش یعنی کاربر هیچ راهی برای دستور دادن ندارد و **هیچ خطایی
     هم نمی‌دهد** (خرابیِ کاملاً بی‌صدا). این‌جا امن است چون `/start` مسیری است که هر کاربر
     حتماً از آن رد می‌شود.

     🛑 اگر به این ربات **آنبوردینگِ چندمرحله‌ای** اضافه کردی، یا هر جا
     `Markup.removeKeyboard()` فرستادی، این تضمین می‌شکند و باید هر سه الزامِ بند ۹ب-۳ را
     پیاده کنی (الگوی کامل و اثبات‌شده: `bots/tarot/index.js` → `dropKeyboard` +
     `ensureKeyboard` + فراخوانی در پایانِ `finishOnboarding`، و چکِ `tools/check-kb-rev.mjs`):
       ۱) آنبوردینگ در **پایانِ خودش** کیبورد را صادر کند. اگر پیام‌های آن نقطه کیبوردِ
          inline دارند (تلگرام در هر پیام فقط یک `reply_markup` می‌پذیرد)، از حاملِ بی‌صدا
          استفاده کن: پیامِ `disable_notification` با `ctx.telegram.sendMessage` که
          بلافاصله حذف می‌شود (کیبوردِ reply حالتِ سطحِ **چت** است، پس حذفِ حامل برش نمی‌دارد).
       ۲) هر جا کیبورد را برمی‌داری، مهرِ «کیبورد دارد» را همان‌جا صفر کن و تک‌نقطه‌اش کن.
       ۳) تورِ ترمیمِ «هرگز کیبوردی نگرفته» هیچ استثنایی جز خودِ آنبوردینگ نداشته باشد —
          مخصوصاً در استیت‌های ورودی، که دقیقاً همان‌جا بود که tarot کاربرانش را گم کرد.
     🐛 چرا این هشدار این‌جاست: در tarot دقیقاً همین اتفاق افتاد و **۱۰۶ کاربر** بدونِ هیچ
     منویی ماندند (۴۹ نفرشان بعد از گرفتنِ فالِ پولی)، و تنها راهِ کشفش اسکرین‌شاتِ مالک بود. */
  const kb = rows.length ? Markup.keyboard(rows).resize() : undefined;
  await ctx.reply('👋 سلام! TODO: پیام خوش‌آمد محصول.', kb);
}
bot.start(handleStart);
// ریستِ فقط-ادمین (همیشه فعال): دیتای خودِ ادمین را پاک و او را مثل کاربر جدید معرفی می‌کند
registerAdminReset(bot, { isAdmin, wipe: wipeUser, after: handleStart });
// پشتیبانی: دکمه‌ی منو + /support → لینکِ چتِ پشتیبانی با پیامِ آماده‌ی حاویِ کدِ پیگیری
// TODO: botCode را در shared/support.js (BOT_CODES) برای این ربات ثبت کن و اینجا بگذار.
registerSupport(bot, { botCode: '<NAME>' });

// TODO: هندلرهای محصول اینجا. نمونه‌ی فراخوانی LLM:
// const res = await or.chatResilient('system prompt', 'user text', { maxTokens: 500 });
// const data = parseJsonLoose(res?.out);
//
// ── زیرساخت رشد (این‌ها را در نقاط فانل محصول بگذار تا داشبورد پرشود) ──
// رویداد فانل (از ثابت‌های EVENTS استفاده کن، نه string خام):
//   track(db, ctx.from.id, EVENTS.PAYWALL_SHOWN, { price });
//   trackOnce(db, ctx.from.id, EVENTS.FIRST_VALUE, { via: 'x' });  // فقط اولین‌بار per کاربر
// A/B تست (تا وقتی از داشبورد running نشود، همیشه 'control' برمی‌گرداند = رفتار پیش‌فرض):
//   if (variant(db, ctx.from.id, 'my_experiment_key') === 'b') { /* شاخه‌ی B */ }
// پول: اگر جدول payments (کیف‌پول) داری، داشبورد خودکار می‌بیند (بند «افزودن ربات جدید»).

/* ===== Launch ===== */
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => log('✅ <NAME> bot started (long polling)'))
    .catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
launch();
process.once('SIGINT',  () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
