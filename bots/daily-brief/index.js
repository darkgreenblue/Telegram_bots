// index.js — daily-brief: پادکستِ آموزشیِ روزانه‌ی شخصی.
//
// هدف (یک جمله): هر صبح یک قسمتِ پادکستِ آموزشیِ شخصی‌شده که مالک واقعاً گوش بدهد.
// مسیرِ داده: پیجِ «Learning» در Notion → جلسه‌ی بعدی و متنش → متن با LLM → صدا با TTS → تلگرام.
//
// MVP فقط-ادمین است: هیچ کاربرِ دیگری نمی‌تواند استفاده کند و هیچ پرداختی وجود ندارد.
// قرارداد کامل + ساختارِ پیجِ Notion: bots/daily-brief/CLAUDE.md
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import { mkdirSync } from 'fs';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import { log, logErr } from '../../shared/logger.js';
import { registerAdminReset, adminResetRow } from '../../shared/reset.js';
import { registerGlobalErrorHandlers, makeBotCatch } from '../../shared/errors.js';
import { registerSupport, supportRow } from '../../shared/support.js';
import { EVENTS, ensureAnalytics, track, trackOnce, captureStart } from '../../shared/analytics.js';
import { ensureAb } from '../../shared/ab.js';
import { createLLM, wordTarget } from './script.js';
import { createNotion, pickNextLesson, notionErrorFa } from './notion.js';
import { engineLabel, synthesize } from './tts.js';
import { VOICES, DEFAULT_VOICE, SAMPLE_VERSION, sampleText, voiceById } from './voices.js';
import {
  bake, deliver, claimDaily, createEpisode, recoverStuck, refreshRoadmap,
  tehranNow, hhmmToMinutes, PipelineError,
} from './pipeline.js';

/* ===== ENV و ثابت‌ها ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { logErr('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { logErr('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }
// اختیاری و نبودش بوت را نمی‌شکند: Notion بدونِ توکن یعنی پیامِ راهنما به‌جای رودمپ.
// همه‌ی موتورهای صدا از همان OPENROUTER_API_KEY می‌آیند؛ هیچ سرویسِ صوتیِ مستقیمی نداریم.
const NOTION_TOKEN       = process.env.NOTION_TOKEN?.trim() || '';

const ADMIN_IDS = (process.env.ADMIN_IDS || '100257975')
  .split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
const OWNER_ID  = ADMIN_IDS[0] || 100257975;
const isAdmin = (uid) => ADMIN_IDS.includes(uid);
const TEST_PHASE = true;
const PRODUCT_VERSION = '1.2.0';

const FLASH = 'google/gemini-2.5-flash';
// موتورِ صدا (ثابت، بعد از مقایسه‌ی واقعی انتخاب شد)
const TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';
// ساختِ قسمت چند دقیقه طول می‌کشد، پس زودتر از ساعتِ ارسال شروع می‌شود و رأسِ ساعت
// فقط فایلِ آماده فرستاده می‌شود (وگرنه کاربر همیشه چند دقیقه دیرتر پادکستش را می‌گرفت).
const BAKE_LEAD_MIN = 15;
const ROADMAP_CACHE_MS = 10 * 60 * 1000;
const DURATION_OPTIONS = [5, 10, 15, 20, 30];
const WEEKDAYS = [
  ['sat', 'شنبه'], ['sun', 'یکشنبه'], ['mon', 'دوشنبه'], ['tue', 'سه‌شنبه'],
  ['wed', 'چهارشنبه'], ['thu', 'پنجشنبه'], ['fri', 'جمعه'],
];
const WEEKDAY_FA = Object.fromEntries(WEEKDAYS);

const llm = createLLM({
  apiKey: OPENROUTER_API_KEY,
  defaultModel: FLASH,
  fallbackModel: 'deepseek/deepseek-v3.2',
});
const notion = createNotion({ token: NOTION_TOKEN });

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
  -- تنظیمات تک‌کاربره است، پس key/value کافی است و افزودنِ کلیدِ جدید migration نمی‌خواهد.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- آینه‌ی موضوع‌های Notion (متادیتا و یادداشت‌ها؛ ورودیِ پرامپت)
  CREATE TABLE IF NOT EXISTS topics (
    page_id     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    topic_order INTEGER NOT NULL DEFAULT 0,
    meta_json   TEXT NOT NULL DEFAULT '{}',
    notes       TEXT NOT NULL DEFAULT '',
    synced_at   INTEGER DEFAULT (unixepoch())
  );
  -- منبعِ حقیقتِ پیشرفت. کلید block_id است تا تغییرِ نامِ جلسه در Notion چیزی را نشکند.
  CREATE TABLE IF NOT EXISTS lessons (
    block_id      TEXT PRIMARY KEY,
    topic_page_id TEXT NOT NULL,
    topic_title   TEXT NOT NULL,
    topic_order   INTEGER NOT NULL DEFAULT 0,
    lesson_order  INTEGER NOT NULL DEFAULT 0,
    title         TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'page',
    status        TEXT NOT NULL DEFAULT 'pending',
    delivered_at  INTEGER,
    episode_id    INTEGER
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'daily',
    status          TEXT NOT NULL DEFAULT 'pending',
    lesson_block_id TEXT,
    lesson_title    TEXT,
    title           TEXT,
    duration_target INTEGER,
    format          TEXT DEFAULT 'single',
    engine          TEXT,
    voices_json     TEXT DEFAULT '{}',
    speed           REAL DEFAULT 1,
    script          TEXT,
    turns_json      TEXT,
    script_words    INTEGER DEFAULT 0,
    llm_model       TEXT,
    llm_tokens_in   INTEGER DEFAULT 0,
    llm_tokens_out  INTEGER DEFAULT 0,
    llm_gen_ids     TEXT DEFAULT '',
    llm_cost_usd    REAL DEFAULT 0,
    tts_chars       INTEGER DEFAULT 0,
    tts_cost_usd    REAL DEFAULT 0,
    audio_seconds   INTEGER DEFAULT 0,
    audio_bytes     INTEGER DEFAULT 0,
    audio_path      TEXT,
    tg_file_id      TEXT,
    feedback        TEXT,
    error           TEXT,
    created_at      INTEGER DEFAULT (unixepoch()),
    delivered_at    INTEGER
  );
  -- گاردِ «روزی یک قسمت»: ری‌استارت یا دو تیکِ هم‌زمانِ زمان‌بند دو قسمت نمی‌سازد.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_daily_once ON episodes(date) WHERE kind='daily';
  -- نمونه‌های صوتیِ گوینده‌ها: یک بار ساخته می‌شوند و بعد فقط file_id فرستاده می‌شود.
  -- بدونِ این جدول، هر بار باز کردنِ صفحه‌ی انتخابِ گوینده شش فراخوانیِ پولیِ تازه بود.
  CREATE TABLE IF NOT EXISTS voice_samples (
    voice_id   TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    file_id    TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (voice_id, version)
  );
  -- جدولِ خالیِ هم‌قرارداد داشبورد (این ربات پول ندارد؛ فقط تا ردیفِ رجیستری خطا ندهد)
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    status TEXT, created_at INTEGER DEFAULT (unixepoch())
  );
`);
ensureAnalytics(db);
ensureAb(db);

const AUDIO_DIR = './data/audio';

function upsertUser(ctx) {
  db.prepare(`INSERT INTO users (telegram_id, name, username) VALUES (?, ?, ?)
              ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, username=excluded.username, last_seen=unixepoch()`)
    .run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
}
// ریستِ ادمین فقط دیتای فلوی کاربر را پاک می‌کند. `episodes` و `lessons` عمداً می‌مانند:
// اولی دفترِ هزینه است و دومی تاریخچه‌ی یادگیری؛ پاک‌کردنشان یعنی رودمپ از اول شروع شود.
function wipeUser(uid) {
  for (const [t, col] of [['users', 'telegram_id'], ['events', 'user_id'], ['ab_exposures', 'user_id']]) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(uid); } catch (e) { logErr('wipe', t, e.message); }
  }
  try { db.prepare('DELETE FROM settings').run(); } catch (e) { logErr('wipe settings', e.message); }
}

/* ===== تنظیمات ===== */
const DEFAULTS = {
  send_time: '07:30',
  days: ['sat', 'sun', 'mon', 'tue', 'wed'],
  duration_min: 15,
  duration_by_day: {},
  format: 'single',
  // موتورِ صدا **ثابت** است: جمنای، بعد از مقایسه‌ی واقعیِ صداها انتخاب شد (۱۴۰۵/۰۵/۲۷).
  // در settings می‌ماند تا ردیفِ هر قسمت بداند با چه موتوری ساخته شده (تاریخچه‌ی هزینه)،
  // ولی دیگر از اینترفیس قابلِ تغییر نیست. عوض کردنش = همین یک خط.
  engine: TTS_MODEL,
  // نگاشتِ موتور به صدا. کلیدْ موتور است چون هر موتور صداهای خودش را دارد و اگر روزی
  // موتور عوض شود، صدای انتخابیِ قبلی نباید بی‌صدا به موتورِ جدید پاس داده شود.
  voices: { [TTS_MODEL]: DEFAULT_VOICE },
  speed: 1,
  tomorrow: null,
};
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!row) return DEFAULTS[key];
  try { return JSON.parse(row.value); } catch { return DEFAULTS[key]; }
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}
// صدای فعلی. شناسه‌ی ناشناخته (مثلاً بعد از حذفِ یک گوینده از کاتالوگ) به پیش‌فرض برمی‌گردد
// تا هیچ‌وقت شناسه‌ای که موتور نمی‌شناسد به API نرود.
function currentVoice() {
  const picked = (getSetting('voices') || {})[TTS_MODEL];
  return voiceById(picked) ? picked : DEFAULT_VOICE;
}
function setVoice(id) {
  setSetting('voices', { ...(getSetting('voices') || {}), [TTS_MODEL]: id });
}

// تنظیماتِ مؤثرِ یک روز: override فردا > مدتِ همان روزِ هفته > مدتِ پیش‌فرض.
function effectiveSettings(dayKey, date) {
  const tomorrow = getSetting('tomorrow');
  const override = tomorrow && tomorrow.date === date ? tomorrow : null;
  const byDay = getSetting('duration_by_day') || {};
  return {
    durationMin: override?.duration_min || byDay[dayKey] || getSetting('duration_min'),
    format: getSetting('format'),
    // موتور دیگر خواندنی از settings نیست: مقدارِ ذخیره‌شده از دورانِ انتخابِ موتور مانده و
    // اگر خوانده شود، ربات بی‌صدا با موتورِ قدیمیِ همان ردیف کار می‌کند.
    engine: TTS_MODEL,
    // همیشه از currentVoice می‌آید، نه خامِ settings: ردیفِ ذخیره‌شده ممکن است از قبل از
    // وجودِ انتخابِ گوینده مانده و خالی باشد، و آن‌وقت صدا بی‌صدا به حدسِ خانواده می‌افتاد.
    voices: { [TTS_MODEL]: currentVoice() },
    speed: getSetting('speed'),
    skip: !!override?.skip,
    hasOverride: !!override,
  };
}

/* ===== متن‌ها ===== */
const fa = (n) => Number(n).toLocaleString('fa-IR');
const usd = (n) => `$${(Number(n) || 0).toFixed(3)}`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} مگابایت`;
const mmss = (sec) => `${Math.floor(sec / 60)} دقیقه`;
const daysFa = (arr) => (arr?.length ? arr.map((d) => WEEKDAY_FA[d] || d).join('، ') : 'هیچ روزی');

const T = {
  performer: 'دستیار آموزشی',
  welcome: (s) => `🎧 سلام!\n\nهر روز صبح یک قسمت پادکستِ آموزشی از روی رودمپِ Notion تو ساخته می‌شود و همین‌جا می‌آید.\n\n${s}`,
  statusLine: (next, lesson) => `⏰ قسمت بعدی: ${next}\n📖 جلسه‌ی بعدی: ${lesson}`,
  privateBot: 'سلام! این ربات دستیارِ شخصیه و فعلاً خصوصی کار می‌کنه 🙏',
  noNotion: '🔌 اتصال Notion هنوز وصل نیست.\n\nSecret به نام DAILY_BRIEF_NOTION_TOKEN را در گیت‌هاب بساز و پیجِ «دستیار آموزشی» را با همان Integration به اشتراک بگذار.',
  building: '🎙 دارم می‌سازم، چند دقیقه طول می‌کشه.',
  busy: '⏳ یه قسمت همین الان در حال ساخته. تمام که شد خبر می‌دم.',
  samplesBuilding: (n) => `🎙 دارم ${fa(n)} نمونه‌ی صوتی می‌سازم، یه لحظه صبر کن.\nاین کار فقط یک بار انجام می‌شه؛ دفعه‌ی بعد نمونه‌ها فوری میان.`,
  samplesBusy: '⏳ نمونه‌ها همین الان در حال ساخته شدنه. چند لحظه‌ی دیگه دوباره بزن.',
  sampleFailed: (v) => `🎙 ${v.name} (${v.tone})\nنمونه‌ی این صدا الان ساخته نشد، ولی می‌تونی از دکمه‌های پایین انتخابش کنی.`,
  voicePick: '🗣 هر شش نمونه رو گوش بده و صدایی که دوست داری رو از دکمه‌های پایین انتخاب کن 👇',
  voicePicked: (v) => `✅ صدای ${v.name} انتخاب شد.\nاز قسمتِ بعدی با همین صدا می‌شنوی. هر وقت خواستی از همین‌جا عوضش کن.`,
  episodeCaption: (ep) => {
    const cost = (ep.llm_cost_usd || 0) + (ep.tts_cost_usd || 0);
    const lines = [`🎧 ${ep.title || ep.lesson_title || 'قسمت روزانه'}`];
    if (ep.lesson_title && ep.title !== ep.lesson_title) lines.push(`📖 ${ep.lesson_title}`);
    lines.push(`⏱ ${mmss(ep.audio_seconds || 0)} · 📦 ${mb(ep.audio_bytes || 0)} · 🎙 ${engineLabel(ep.engine)}`);
    lines.push(`💵 ${usd(cost)} (متن ${usd(ep.llm_cost_usd)} + صدا ${usd(ep.tts_cost_usd)})`);
    return lines.join('\n');
  },
  failed: (ep) => `❌ ساختِ قسمتِ ${ep.date} شکست خورد.\n\n${ep.error || ''}`,
  roadmapEmpty: 'هنوز هیچ جلسه‌ای در رودمپ نیست. در پیجِ «دستیار آموزشی» یک زیرصفحه برای موضوعت بساز و جلسه‌ها را به‌صورت چک‌باکس بنویس.',
  roadmapDone: '🎓 همه‌ی جلسه‌های رودمپ تمام شده! به پیجِ Notion جلسه‌ی تازه اضافه کن.',
};

/* ===== کیبورد ===== */
const BTN = {
  now: '🎧 همین حالا بساز',
  roadmap: '📚 وضعیت رودمپ',
  settings: '⚙️ تنظیمات',
  cost: '💸 هزینه‌ها',
};
const mainKeyboard = (uid) => Markup.keyboard([
  [BTN.now, BTN.roadmap],
  [BTN.settings, BTN.cost],
  ...supportRow(),
  ...adminResetRow(isAdmin, uid),
]).resize();

/* ===== Bot ===== */
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 30 * 60 * 1000 });
bot.catch(makeBotCatch());
registerGlobalErrorHandlers('daily-brief');

const deps = {
  db, llm, notion, telegram: bot.telegram, ownerId: OWNER_ID, texts: T,
  audioDir: AUDIO_DIR,
  keys: { openrouter: OPENROUTER_API_KEY },
  cache: {}, cacheTtlMs: ROADMAP_CACHE_MS,
};

// خط وضعیت: کِی قسمت بعدی می‌آید و روی چه جلسه‌ای.
function nextRunText() {
  const now = tehranNow();
  const days = getSetting('days') || [];
  const time = getSetting('send_time');
  const tomorrow = getSetting('tomorrow');
  if (tomorrow?.skip && tomorrow.date > now.date) return `فردا نمی‌فرستم (تنظیمِ «فقط فردا»)`;
  if (!days.length) return 'هیچ روزی فعال نیست';
  const dur = effectiveSettings(now.weekday, now.date).durationMin;
  const todayLeft = days.includes(now.weekday) && now.minutes < hhmmToMinutes(time);
  return `${todayLeft ? 'امروز' : 'روزهای ' + daysFa(days)} ساعت ${time} · ${fa(dur)} دقیقه`;
}
function nextLessonText() {
  const l = pickNextLesson(db);
  return l ? `${l.topic_title} · ${l.title}` : 'رودمپ خالی است';
}

async function handleStart(ctx) {
  const before = db.prepare('SELECT 1 FROM users WHERE telegram_id=?').get(ctx.from.id);
  upsertUser(ctx);
  captureStart(db, ctx.from.id, ctx.startPayload, !before, PRODUCT_VERSION);
  if (!isAdmin(ctx.from.id)) { await ctx.reply(T.privateBot); return; }
  await ctx.reply(T.welcome(T.statusLine(nextRunText(), nextLessonText())), mainKeyboard(ctx.from.id));
}
bot.start(handleStart);
registerAdminReset(bot, { isAdmin, wipe: wipeUser, after: handleStart });
registerSupport(bot, { botCode: 'daily-brief' });

// گیتِ فقط-ادمین. بعد از start/reset/support ثبت می‌شود تا آن سه مسیر همیشه باز بمانند
// (پشتیبانی هرگز گارد نمی‌شود — بند ۶ج). فقط اقدامِ واقعیِ کاربر گیت می‌خورد، نه آپدیت‌های
// سرویسیِ تلگرام مثل my_chat_member (درسِ tarot v2.7.2).
bot.use(async (ctx, next) => {
  if (!ctx.message && !ctx.callbackQuery) return next();
  const uid = ctx.from?.id;
  if (!uid || isAdmin(uid)) return next();
  if (ctx.callbackQuery) { await ctx.answerCbQuery().catch(() => {}); return; }
  await ctx.reply(T.privateBot).catch(() => {});
});

/* ===== وضعیت رودمپ ===== */
async function showRoadmap(ctx) {
  if (!notion) { await ctx.reply(T.noNotion); return; }
  const msg = await ctx.reply('⏳ دارم Notion را می‌خوانم…');
  try {
    await refreshRoadmap(deps, { force: true });
  } catch (e) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
      `❌ ${e instanceof PipelineError ? e.message : notionErrorFa(e)}`).catch(() => {});
    return;
  }
  const rows = db.prepare(`
    SELECT topic_title,
           SUM(status='delivered') AS done,
           SUM(status IN ('pending','delivered','done_in_notion')) AS total
    FROM lessons WHERE status != 'skipped'
    GROUP BY topic_page_id ORDER BY MIN(topic_order)
  `).all();
  if (!rows.length) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, T.roadmapEmpty).catch(() => {});
    return;
  }
  const next = pickNextLesson(db);
  const body = rows.map((r) => `📗 ${r.topic_title}\n   ${fa(r.done)} از ${fa(r.total)} جلسه ✅`).join('\n');
  const tail = next ? `\n\n▶️ جلسه‌ی بعدی: ${next.title}` : `\n\n${T.roadmapDone}`;
  await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, `📚 رودمپ آموزشی\n\n${body}${tail}`)
    .catch(() => {});
}
bot.hears(BTN.roadmap, showRoadmap);

/* ===== هزینه‌ها ===== */
async function showCost(ctx) {
  const month = tehranNow().date.slice(0, 7);
  const agg = (where, args = []) => db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(llm_cost_usd),0) llm, COALESCE(SUM(tts_cost_usd),0) tts,
           COALESCE(SUM(llm_tokens_in),0) ti, COALESCE(SUM(llm_tokens_out),0) to_,
           COALESCE(SUM(tts_chars),0) ch
    FROM episodes WHERE status='delivered' ${where}`).get(...args);
  const all = agg('');
  const cur = agg("AND date LIKE ?", [`${month}%`]);
  const byEngine = db.prepare(`
    SELECT engine, COUNT(*) n, COALESCE(SUM(tts_cost_usd),0) c, COALESCE(SUM(tts_chars),0) ch
    FROM episodes WHERE status='delivered' GROUP BY engine ORDER BY c DESC`).all();

  const block = (t, a) => `${t}\n` +
    `  قسمت‌ها: ${fa(a.n)}\n` +
    `  متن: ${usd(a.llm)} (${fa(a.ti)} توکن ورودی، ${fa(a.to_)} خروجی)\n` +
    `  صدا: ${usd(a.tts)} (${fa(a.ch)} کاراکتر)\n` +
    `  جمع: ${usd(a.llm + a.tts)}${a.n ? ` · میانگین هر قسمت ${usd((a.llm + a.tts) / a.n)}` : ''}`;
  const engines = byEngine.length
    ? `\n\n🎙 به تفکیک موتور صدا:\n` + byEngine.map((e) =>
        `  ${engineLabel(e.engine)}: ${fa(e.n)} قسمت · ${usd(e.c)} · ${fa(e.ch)} کاراکتر`).join('\n')
    : '';
  await ctx.reply(`💸 هزینه‌ها\n\n${block('این ماه:', cur)}\n\n${block('از ابتدا:', all)}${engines}`);
}
bot.hears(BTN.cost, showCost);

/* ===== ساختِ دستی ===== */
let running = false; // گاردِ تک‌اجرا؛ حقیقتِ ماندگار همان ردیفِ episode در DB است

async function askBuildNow(ctx) {
  const l = pickNextLesson(db);
  const s = effectiveSettings(tehranNow().weekday, tehranNow().date);
  await ctx.reply(
    l ? `🎧 جلسه‌ی بعدی: ${l.title}\n⏱ ${fa(s.durationMin)} دقیقه · 🎙 ${engineLabel(s.engine)}\n\nبسازم؟`
      : `${T.roadmapDone}\n\nبا این حال بسازم؟ (اگر Notion وصل باشد دوباره می‌خوانم)`,
    Markup.inlineKeyboard([[
      Markup.button.callback('✅ بساز', 'now:go'),
      Markup.button.callback('انصراف', 'nav:close'),
    ]]));
}
bot.hears(BTN.now, askBuildNow);

bot.action('now:go', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  if (running) { await ctx.reply(T.busy); return; }
  const now = tehranNow();
  const s = effectiveSettings(now.weekday, now.date);
  const ep = createEpisode(deps, { date: now.date, kind: 'manual', settings: s });
  await ctx.reply(T.building);
  // detached: هندلر نباید چند دقیقه بلوکه بماند (کاربر همین حالا جواب گرفته است)
  runEpisode(ep.id, { deliverNow: true }).catch(() => {});
});

// ساخت (و در صورت نیاز ارسالِ) یک قسمت. تنها نقطه‌ای که running را دست می‌زند.
async function runEpisode(episodeId, { deliverNow }) {
  if (running) return;
  running = true;
  try {
    const { ep, audio } = await bake(deps, episodeId);
    track(db, OWNER_ID, 'episode_generated', {
      minutes: ep.duration_target, engine: ep.engine, format: ep.format, words: ep.script_words,
    });
    if (deliverNow) await deliverEpisode(episodeId, audio?.buffer);
  } catch (e) {
    const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(episodeId);
    track(db, OWNER_ID, 'episode_failed', { stage: e?.stage || 'unknown' });
    await notifyAdmins(T.failed(ep || { date: '', error: e.message }), {
      inline_keyboard: [[{ text: '🔁 تلاش دوباره', callback_data: `retry:${episodeId}` }]],
    });
  } finally { running = false; }
}

async function deliverEpisode(episodeId, buffer) {
  const ep = await deliver(deps, episodeId, buffer);
  trackOnce(db, OWNER_ID, EVENTS.FIRST_VALUE, { via: 'episode' });
  track(db, OWNER_ID, EVENTS.PRODUCT_DELIVERED, { type: 'episode', seconds: ep.audio_seconds });
  track(db, OWNER_ID, 'episode_delivered', {
    seconds: ep.audio_seconds, engine: ep.engine,
    cost: Number(((ep.llm_cost_usd || 0) + (ep.tts_cost_usd || 0)).toFixed(4)),
  });
  return ep;
}

async function notifyAdmins(text, reply_markup) {
  for (const id of ADMIN_IDS) {
    await bot.telegram.sendMessage(id, text, reply_markup ? { reply_markup } : undefined).catch(() => {});
  }
}

bot.action(/^retry:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = Number(ctx.match[1]);
  // گذارِ اتمیک: دو تپِ پشت‌سرهم فقط یکی را می‌برد
  const info = db.prepare("UPDATE episodes SET status='pending', error=NULL WHERE id=? AND status='failed'").run(id);
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(id);
  if (!ep) { await ctx.reply('این قسمت پیدا نشد.'); return; }
  // اگر متن از قبل ساخته شده بود، status به scripted برمی‌گردد تا پولِ LLM دوباره خرج نشود
  if (info.changes && ep.script) db.prepare("UPDATE episodes SET status='scripted' WHERE id=?").run(id);
  // **موتور از تنظیماتِ فعلی تازه می‌شود.** snapshotِ لحظه‌ی ساخت برای این است که تغییرِ
  // وسطِ کارِ تنظیمات یک قسمتِ در جریان را خراب نکند؛ ولی «تلاشِ دوباره» خودش یک تصمیمِ
  // تازه است. بدونِ این، کسی که بعد از شنیدنِ نمونه‌ها موتور را عوض کرده باز هم قسمت را
  // با همان موتورِ قبلی (که شاید خودش دلیلِ شکست بوده) می‌گیرد.
  if (info.changes) {
    const s = effectiveSettings(tehranNow().weekday, tehranNow().date);
    db.prepare('UPDATE episodes SET engine=?, voices_json=?, speed=? WHERE id=?')
      .run(s.engine, JSON.stringify(s.voices || {}), s.speed || 1, id);
  }
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  if (running) { await ctx.reply(T.busy); return; }
  await ctx.reply(T.building);
  runEpisode(id, { deliverNow: true }).catch(() => {});
});

/* ===== بازخورد ===== */
bot.action(/^fb:(\d+):(up|down)$/, async (ctx) => {
  const [, id, kind] = ctx.match;
  db.prepare('UPDATE episodes SET feedback=? WHERE id=?').run(kind, Number(id));
  track(db, ctx.from.id, EVENTS.FEEDBACK, { kind, episode: Number(id) });
  await ctx.answerCbQuery(kind === 'up' ? 'ممنون! 🙌' : 'ثبت شد، بهترش می‌کنیم.').catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
});

/* ===== تنظیمات (همه inline — هیچ استیتِ تایپی وجود ندارد) ===== */
function settingsView() {
  const byDay = getSetting('duration_by_day') || {};
  const tomorrow = getSetting('tomorrow');
  const perDay = Object.keys(byDay).length
    ? `\n   (${Object.entries(byDay).map(([d, m]) => `${WEEKDAY_FA[d]}: ${fa(m)}`).join('، ')})` : '';
  const tm = tomorrow
    ? `\n🌙 فقط فردا: ${tomorrow.skip ? 'نفرست' : `${fa(tomorrow.duration_min)} دقیقه`} (${tomorrow.date})` : '';
  return {
    text: `⚙️ تنظیمات\n\n⏰ ساعت ارسال: ${getSetting('send_time')}\n` +
      `📅 روزها: ${daysFa(getSetting('days'))}\n` +
      `⏱ مدت: ${fa(getSetting('duration_min'))} دقیقه${perDay}\n` +
      `🎙 قالب: ${getSetting('format') === 'dialogue' ? 'گفت‌وگوی دونفره' : 'تک‌گوینده'}\n` +
      `🗣 گوینده: ${voiceById(currentVoice())?.name || '؟'} (${voiceById(currentVoice())?.tone || ''})${tm}`,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('⏰ ساعت ارسال', 'set:time'), Markup.button.callback('📅 روزها', 'set:days')],
      [Markup.button.callback('⏱ مدت', 'set:dur'), Markup.button.callback('🌙 فقط فردا', 'set:tmr')],
      [Markup.button.callback('🎙 قالب', 'set:fmt'), Markup.button.callback('🗣 انتخاب گوینده', 'set:voice')],
    ]),
  };
}
const showSettings = async (ctx, edit) => {
  const v = settingsView();
  if (edit) await ctx.editMessageText(v.text, v.keyboard).catch(() => {});
  else await ctx.reply(v.text, v.keyboard);
};
bot.hears(BTN.settings, (ctx) => showSettings(ctx, false));
bot.action('set:home', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await showSettings(ctx, true); });
bot.action('nav:close', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
});

const backRow = [Markup.button.callback('◀️ بازگشت', 'set:home')];
const chunk = (arr, n) => arr.reduce((a, x, i) => (i % n ? a[a.length - 1].push(x) : a.push([x]), a), []);

// ── ساعت ارسال ──
bot.action('set:time', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  await ctx.editMessageText('⏰ ساعت ارسال را انتخاب کن:', Markup.inlineKeyboard([
    ...chunk(hours.map((h) => Markup.button.callback(h, `set:time:h:${h}`)), 6),
    backRow,
  ])).catch(() => {});
});
bot.action(/^set:time:h:(\d{2})$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const h = ctx.match[1];
  await ctx.editMessageText(`⏰ ساعت ${h}، دقیقه؟`, Markup.inlineKeyboard([
    ['00', '15', '30', '45'].map((m) => Markup.button.callback(`${h}:${m}`, `set:time:s:${h}${m}`)),
    backRow,
  ])).catch(() => {});
});
bot.action(/^set:time:s:(\d{2})(\d{2})$/, async (ctx) => {
  setSetting('send_time', `${ctx.match[1]}:${ctx.match[2]}`);
  track(db, ctx.from.id, 'settings_changed', { key: 'send_time' });
  await ctx.answerCbQuery('ثبت شد ✅').catch(() => {});
  await showSettings(ctx, true);
});

// ── روزهای هفته ──
const daysView = () => {
  const on = new Set(getSetting('days') || []);
  return Markup.inlineKeyboard([
    ...chunk(WEEKDAYS.map(([k, faName]) =>
      Markup.button.callback(`${on.has(k) ? '✅' : '⬜️'} ${faName}`, `set:days:t:${k}`)), 2),
    backRow,
  ]);
};
bot.action('set:days', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageText('📅 روزهایی که پادکست بیاید:', daysView()).catch(() => {});
});
bot.action(/^set:days:t:(\w+)$/, async (ctx) => {
  const key = ctx.match[1];
  const cur = new Set(getSetting('days') || []);
  cur.has(key) ? cur.delete(key) : cur.add(key);
  setSetting('days', WEEKDAYS.map(([k]) => k).filter((k) => cur.has(k)));
  track(db, ctx.from.id, 'settings_changed', { key: 'days' });
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(daysView().reply_markup).catch(() => {});
});

// ── مدت ──
bot.action('set:dur', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageText(`⏱ مدتِ هر قسمت (الان ${fa(getSetting('duration_min'))} دقیقه):`,
    Markup.inlineKeyboard([
      DURATION_OPTIONS.map((m) => Markup.button.callback(`${fa(m)}′`, `set:dur:all:${m}`)),
      [Markup.button.callback('📅 مدت جدا برای هر روز', 'set:dur:day')],
      backRow,
    ])).catch(() => {});
});
bot.action(/^set:dur:all:(\d+)$/, async (ctx) => {
  setSetting('duration_min', Number(ctx.match[1]));
  track(db, ctx.from.id, 'settings_changed', { key: 'duration_min' });
  await ctx.answerCbQuery('ثبت شد ✅').catch(() => {});
  await showSettings(ctx, true);
});
bot.action('set:dur:day', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const byDay = getSetting('duration_by_day') || {};
  await ctx.editMessageText('📅 کدام روز مدتِ جدا داشته باشد؟', Markup.inlineKeyboard([
    ...chunk(WEEKDAYS.map(([k, faName]) => Markup.button.callback(
      `${faName}${byDay[k] ? `: ${fa(byDay[k])}′` : ''}`, `set:dur:d:${k}`)), 2),
    backRow,
  ])).catch(() => {});
});
bot.action(/^set:dur:d:(\w+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const k = ctx.match[1];
  await ctx.editMessageText(`⏱ مدتِ ${WEEKDAY_FA[k]}:`, Markup.inlineKeyboard([
    DURATION_OPTIONS.map((m) => Markup.button.callback(`${fa(m)}′`, `set:dur:dv:${k}:${m}`)),
    [Markup.button.callback('↩️ مثل بقیه‌ی روزها', `set:dur:dv:${k}:0`)],
    [Markup.button.callback('◀️ بازگشت', 'set:dur:day')],
  ])).catch(() => {});
});
bot.action(/^set:dur:dv:(\w+):(\d+)$/, async (ctx) => {
  const [, k, m] = ctx.match;
  const byDay = { ...(getSetting('duration_by_day') || {}) };
  if (Number(m)) byDay[k] = Number(m); else delete byDay[k];
  setSetting('duration_by_day', byDay);
  track(db, ctx.from.id, 'settings_changed', { key: 'duration_by_day' });
  await ctx.answerCbQuery('ثبت شد ✅').catch(() => {});
  await showSettings(ctx, true);
});

// ── فقط فردا ──
// تاریخِ فردا با تقویمِ تهران، نه ساعتِ سرور.
const tomorrowDate = () => tehranNow(new Date(Date.now() + 86400000)).date;
bot.action('set:tmr', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const t = getSetting('tomorrow');
  const cur = t && t.date === tomorrowDate()
    ? `الان: ${t.skip ? 'فردا نفرست' : `${fa(t.duration_min)} دقیقه`}` : 'الان تنظیمی برای فردا نداری.';
  await ctx.editMessageText(`🌙 فقط برای فردا (${tomorrowDate()})\n${cur}`, Markup.inlineKeyboard([
    DURATION_OPTIONS.map((m) => Markup.button.callback(`${fa(m)}′`, `set:tmr:v:${m}`)),
    [Markup.button.callback('🚫 فردا نفرست', 'set:tmr:skip'),
     Markup.button.callback('🗑 حذف تنظیم فردا', 'set:tmr:clear')],
    backRow,
  ])).catch(() => {});
});
bot.action(/^set:tmr:v:(\d+)$/, async (ctx) => {
  setSetting('tomorrow', { date: tomorrowDate(), skip: false, duration_min: Number(ctx.match[1]) });
  track(db, ctx.from.id, 'settings_changed', { key: 'tomorrow' });
  await ctx.answerCbQuery('برای فردا ثبت شد ✅').catch(() => {});
  await showSettings(ctx, true);
});
bot.action('set:tmr:skip', async (ctx) => {
  setSetting('tomorrow', { date: tomorrowDate(), skip: true });
  track(db, ctx.from.id, 'settings_changed', { key: 'tomorrow' });
  await ctx.answerCbQuery('فردا نمی‌فرستم ✅').catch(() => {});
  await showSettings(ctx, true);
});
bot.action('set:tmr:clear', async (ctx) => {
  setSetting('tomorrow', null);
  await ctx.answerCbQuery('حذف شد').catch(() => {});
  await showSettings(ctx, true);
});

// ── قالب ──
// دیالوگ فقط با موتوری که چند گوینده را بومی می‌سازد معنی دارد؛ تا تأییدِ کیفیتِ فارسی
// در بیک‌آف، این گزینه عمداً بسته است (PR بعدی بازش می‌کند).
bot.action('set:fmt', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const f = getSetting('format');
  await ctx.editMessageText('🎙 قالب پادکست:', Markup.inlineKeyboard([
    [Markup.button.callback(`${f === 'single' ? '✅ ' : ''}تک‌گوینده`, 'set:fmt:single')],
    [Markup.button.callback('گفت‌وگوی دونفره (به‌زودی)', 'set:fmt:soon')],
    backRow,
  ])).catch(() => {});
});
bot.action('set:fmt:single', async (ctx) => {
  setSetting('format', 'single');
  await ctx.answerCbQuery('ثبت شد ✅').catch(() => {});
  await showSettings(ctx, true);
});
bot.action('set:fmt:soon', async (ctx) => {
  await ctx.answerCbQuery('گفت‌وگوی دونفره هنوز آماده نیست؛ به‌زودی باز می‌شود.',
    { show_alert: true }).catch(() => {});
});

// ── انتخابِ گوینده ──
// شش صدا، سه مرد و سه زن، عمداً دور از هم (کاتالوگ و دلیلش: voices.js).
// نمونه‌ها **یک بار** ساخته و file_id شان کش می‌شود: باز کردنِ دوباره‌ی این صفحه هیچ
// هزینه‌ای ندارد و فوری است. ساختِ نمونه پشتِ تپِ صریحِ کاربر است (قاعده‌ی هزینه، بند ۹).
let samplesBuilding = false;

const cachedSample = (voiceId) => db
  .prepare('SELECT file_id FROM voice_samples WHERE voice_id=? AND version=?')
  .get(voiceId, SAMPLE_VERSION)?.file_id || '';
const saveSample = (voiceId, fileId) => db
  .prepare(`INSERT INTO voice_samples (voice_id, version, file_id) VALUES (?,?,?)
            ON CONFLICT(voice_id, version) DO UPDATE SET file_id=excluded.file_id`)
  .run(voiceId, SAMPLE_VERSION, fileId);

const voiceKeyboard = () => {
  const cur = currentVoice();
  return Markup.inlineKeyboard([
    ...chunk(VOICES.map((v) => Markup.button.callback(
      `${v.id === cur ? '✅ ' : ''}${v.name}`, `set:voice:${v.id}`)), 2),
    backRow,
  ]);
};

// هر نمونه یک پیامِ صوتیِ جدا با نام و لحن در کپشن، تا زیرِ هر فایل معلوم باشد کدام صداست.
// شکستِ یک نمونه بقیه را نمی‌کشد: کاربر باید بتواند از بینِ همان‌هایی که آمدند انتخاب کند.
async function sendVoiceSamples(ctx) {
  for (const v of VOICES) {
    const caption = `🎙 ${v.name}\n${v.tone}`;
    const extra = { caption, title: v.name, performer: v.tone };
    try {
      const cached = cachedSample(v.id);
      if (cached) { await ctx.replyWithAudio(cached, extra); continue; }
      const out = await synthesize({
        engineKey: TTS_MODEL, script: sampleText(v), voice: v.id,
        openrouterKey: OPENROUTER_API_KEY,
      });
      const msg = await ctx.replyWithAudio({ source: out.buffer, filename: `${v.id}.mp3` }, extra);
      if (msg?.audio?.file_id) saveSample(v.id, msg.audio.file_id);
    } catch (e) {
      logErr('❌ VOICE_SAMPLE', v.id, e.message);
      await ctx.reply(T.sampleFailed(v)).catch(() => {});
    }
  }
}

async function showVoicePicker(ctx) {
  if (samplesBuilding) { await ctx.reply(T.samplesBusy); return; }
  const missing = VOICES.filter((v) => !cachedSample(v.id)).length;
  samplesBuilding = true;
  try {
    if (missing) await ctx.reply(T.samplesBuilding(missing));
    await sendVoiceSamples(ctx);
    await ctx.reply(T.voicePick, voiceKeyboard());
  } finally {
    samplesBuilding = false;
  }
}

bot.action('set:voice', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await showVoicePicker(ctx);
});
bot.action(/^set:voice:([A-Za-z]+)$/, async (ctx) => {
  const v = voiceById(ctx.match[1]);
  // دکمه‌ی کهنه‌ی یک گوینده‌ی حذف‌شده نباید شناسه‌ی ناشناخته را به موتور بفرستد (بند ۲ج/۶).
  if (!v) {
    await ctx.answerCbQuery('این گوینده دیگر در لیست نیست؛ یکی از گزینه‌های فعلی را انتخاب کن.',
      { show_alert: true }).catch(() => {});
    return;
  }
  setVoice(v.id);
  track(db, ctx.from.id, 'settings_changed', { key: 'voice', voice: v.id });
  await ctx.answerCbQuery(`${v.name} انتخاب شد ✅`).catch(() => {});
  await ctx.editMessageText(T.voicePicked(v), voiceKeyboard()).catch(() => {});
});

// ── موتورِ صدا: دیگر انتخابی نیست ──
// بعد از مقایسه‌ی واقعیِ صداها (۱۴۰۵/۰۵/۲۷) مالک جمنای را انتخاب کرد و تصمیم گرفت کلِ
// «تست و انتخابِ موتور» از اینترفیس برداشته شود. کدِ بیک‌آف و لیستِ انتخاب حذف شدند، نه
// خاموش: بندِ ۹/۰ ریشه می‌گوید چیزی که به هدف نزدیک نمی‌کند باید حذف شود نه نگهداری.
// دکمه‌های کهنه‌ی داخلِ چت‌های قدیمی جوابِ مودبانه می‌گیرند (بند ۲ج/۶: callback نمی‌میرد).
bot.action(/^(bake:|set:eng)/, async (ctx) => {
  await ctx.answerCbQuery('انتخابِ صدا برداشته شد؛ صدای ربات روی جمنای ثابت است.',
    { show_alert: true }).catch(() => {});
});

/* ===== دستورها ===== */
// هر دستور همان تابعِ دکمه‌ی متناظر را صدا می‌زند (تک‌منبع؛ دو مسیرِ موازی واگرا نمی‌شوند).
bot.command('cost', showCost);
bot.command('now', askBuildNow);
bot.command('roadmap', showRoadmap);
bot.command('settings', (ctx) => showSettings(ctx, false));
bot.command('voice', showVoicePicker);
// راهِ نجات وقتی پیامِ خطا با دکمه‌ی تلاشِ دوباره گم شده باشد.
bot.command('retry', async (ctx) => {
  const ep = db.prepare("SELECT * FROM episodes WHERE status='failed' ORDER BY id DESC LIMIT 1").get();
  if (!ep) { await ctx.reply('قسمتِ شکست‌خورده‌ای نیست.'); return; }
  await ctx.reply(`آخرین قسمتِ شکست‌خورده: #${ep.id} (${ep.date})\n${ep.error || ''}`,
    Markup.inlineKeyboard([[
      Markup.button.callback('🔁 تلاش دوباره', `retry:${ep.id}`),
      Markup.button.callback('انصراف', 'nav:close'),
    ]]));
});
/* ===== زمان‌بند ===== */
// هر دقیقه بیدار می‌شود و دو کارِ کاملاً جدا انجام می‌دهد:
//   ۱) ساختِ زودهنگام (BAKE_LEAD_MIN دقیقه قبل از ساعتِ ارسال) تا فایل به‌موقع آماده باشد،
//   ۲) ارسالِ قسمتِ آماده رأسِ ساعتِ تنظیم‌شده.
// گاردِ روزانه در خودِ DB است (ایندکسِ یکتا)، پس ری‌استارت یا اجرای هم‌زمان دو قسمت نمی‌سازد.
setInterval(async () => {
  try {
    const now = tehranNow();
    // قسمتِ گیرکرده را همین‌جا هم آزاد می‌کنیم، نه فقط در بوت: ردیفِ pendingِ رهاشده
    // قفلِ یکتای روزانه را نگه می‌دارد و بدونِ این جارو، آن روز هیچ قسمتی ساخته نمی‌شود
    // و مالک هم هیچ خبری نمی‌گیرد.
    if (!running) {
      for (const r of recoverStuck(db)) {
        logErr(`⚠️ episode #${r.id} stuck in ${r.status}, marked failed`);
        await notifyAdmins(`⚠️ ساختِ قسمت #${r.id} نیمه‌کاره ماند و متوقف شد.`, {
          inline_keyboard: [[{ text: '🔁 تلاش دوباره', callback_data: `retry:${r.id}` }]],
        });
      }
    }
    const sendAt = hhmmToMinutes(getSetting('send_time'));
    if (sendAt === null) return;
    const s = effectiveSettings(now.weekday, now.date);
    const dayOn = (getSetting('days') || []).includes(now.weekday) || (s.hasOverride && !s.skip);

    // ۱) ارسالِ چیزی که آماده است
    const ready = db.prepare(`SELECT * FROM episodes WHERE date=? AND kind='daily' AND status='synthesized'`).get(now.date);
    if (ready && now.minutes >= sendAt) {
      try { await deliverEpisode(ready.id); } catch (e) {
        logErr('scheduled deliver:', e.message);
        db.prepare("UPDATE episodes SET status='failed', error=? WHERE id=?")
          .run(`[deliver] ${String(e.message).slice(0, 300)}`, ready.id);
        await notifyAdmins(T.failed(db.prepare('SELECT * FROM episodes WHERE id=?').get(ready.id)), {
          inline_keyboard: [[{ text: '🔁 تلاش دوباره', callback_data: `retry:${ready.id}` }]],
        });
      }
      return;
    }

    // ۲) ساختِ زودهنگام
    if (!dayOn || s.skip) return;
    if (now.minutes < sendAt - BAKE_LEAD_MIN) return;
    if (running) return;
    const ep = claimDaily(deps, now.date, s);
    if (!ep) return; // امروز از قبل ساخته/ارسال شده یا شکست خورده است
    // override فردا بلافاصله بعد از مصرف پاک می‌شود، قبل از هر فراخوانیِ پولی
    if (s.hasOverride) setSetting('tomorrow', null);
    log(`⏰ baking daily episode #${ep.id} for ${now.date} (${s.durationMin}min, ${s.engine})`);
    await runEpisode(ep.id, { deliverNow: now.minutes >= sendAt });
  } catch (e) { logErr('scheduler tick:', e.message); }
}, 60 * 1000);

/* ===== Launch ===== */
// قسمت‌های یتیمِ ری‌استارت را همان اول علامت می‌زنیم تا قفلِ روزانه نگه‌شان ندارد.
for (const r of recoverStuck(db)) {
  logErr(`⚠️ episode #${r.id} stuck in ${r.status}, marked failed`);
  bot.telegram.sendMessage(OWNER_ID,
    `⚠️ ساختِ یک قسمت با ری‌استارت نیمه‌کاره ماند (#${r.id}).`,
    { reply_markup: { inline_keyboard: [[{ text: '🔁 تلاش دوباره', callback_data: `retry:${r.id}` }]] } })
    .catch(() => {});
}

function launch() {
  // خطِ تأییدِ بوت از کال‌بکِ onLaunch می‌آید، نه از then: در Telegraf 4 پرامیسِ launch
  // تا **توقفِ** ربات resolve نمی‌شود (خودش حلقه‌ی polling را await می‌کند)، پس then
  // عملاً هرگز اجرا نمی‌شد و out.log خالی می‌ماند. برای رباتی که کارش صبحِ زود و بدونِ
  // ناظر است، نبودِ خطِ «بالا آمدم» یعنی هیچ راهی برای تشخیصِ سالم‌بودنش از روی لاگ نداریم.
  // onLaunch دقیقاً بعد از موفقیتِ getMe صدا زده می‌شود، یعنی توکن هم معتبر است.
  bot.launch({ dropPendingUpdates: true }, () => {
    log(`✅ daily-brief bot started (v${PRODUCT_VERSION}, test=${TEST_PHASE}, notion=${!!NOTION_TOKEN}, admins=${ADMIN_IDS.join(',')})`);
  }).catch((err) => { logErr('❌ launch error, retrying in 5s:', err.message); setTimeout(launch, 5000); });
}
launch();
process.once('SIGINT',  () => { try { bot.stop('SIGINT'); } catch {} });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} });
