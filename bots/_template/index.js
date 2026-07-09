// index.js — <NAME>: اسکلت استاندارد ربات جدید این مونوریپو.
// از روی bots/_template کپی شده — TODO ها را پر کن و این کامنت‌ها را با توضیح محصول جایگزین کن.
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import { mkdirSync } from 'fs';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import { log, logErr } from '../../shared/logger.js';
import { createOpenRouter, parseJsonLoose } from '../../shared/llm.js';
import { RESET_TEST_BTN, registerTestReset } from '../../shared/reset.js';
import { registerGlobalErrorHandlers, makeBotCatch } from '../../shared/errors.js';

/* ===== ENV و ثابت‌ها ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { logErr('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const OWNER_ID  = 100257975;
const ADMIN_IDS = [OWNER_ID];
const TEST_PHASE = true; // ⚠️ قبل از انتشار عمومی false شود (قرارداد بند ۶ب CLAUDE.md)

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
function upsertUser(ctx) {
  db.prepare(`INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
              ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()`)
    .run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
}
// همه‌ی جدول‌های کاربرمحور این ربات را اینجا پاک کن (قرارداد دکمه‌ی ریست تست)
function wipeUser(uid) {
  db.prepare('DELETE FROM users WHERE telegram_id=?').run(uid);
}

/* ===== Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 10 * 60 * 1000 });
bot.catch(makeBotCatch());
registerGlobalErrorHandlers('<NAME>');

async function handleStart(ctx) {
  upsertUser(ctx);
  const kb = TEST_PHASE ? Markup.keyboard([[RESET_TEST_BTN]]).resize() : undefined;
  await ctx.reply('👋 سلام! TODO: پیام خوش‌آمد محصول.', kb);
}
bot.start(handleStart);
registerTestReset(bot, { ownerId: OWNER_ID, testPhase: TEST_PHASE, wipe: wipeUser, after: handleStart });

// TODO: هندلرهای محصول اینجا. نمونه‌ی فراخوانی LLM:
// const res = await or.chatResilient('system prompt', 'user text', { maxTokens: 500 });
// const data = parseJsonLoose(res?.out);

/* ===== Launch ===== */
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => log('✅ <NAME> bot started (long polling)'))
    .catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
launch();
process.once('SIGINT',  () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
