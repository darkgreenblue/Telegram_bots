// index.js — SaaS Telegram voice→text bot (multi-user, wallet, model selection)
import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

/* ===== 0) ENV ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { console.error('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { console.error('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const ADMIN_ID     = 100257975;
const CARD_NUMBER  = '6219861904145405';
const CARD_OWNER   = 'علیرضا اولیا — بلوبانک';
const MIN_RECHARGE = 100_000;  // تومان
const WELCOME_GIFT = 5_000;   // تومان

/* ===== 1) Database ===== */
mkdirSync('./data', { recursive: true });
const db = new Database('./data/bot.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL DEFAULT '',
    username    TEXT    NOT NULL DEFAULT '',
    balance     INTEGER NOT NULL DEFAULT 0,
    model       TEXT    NOT NULL DEFAULT 'google/gemini-2.5-flash',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen   INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS usage_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    model       TEXT    NOT NULL,
    duration_sec REAL,
    cost        INTEGER NOT NULL DEFAULT 0,
    type        TEXT,
    success     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    amount          INTEGER NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending',
    receipt_file_id TEXT,
    admin_message_id INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migration: Flash Lite از حالت preview خارج شده؛ شناسه‌ی قدیمی غلط را اصلاح کن
db.prepare("UPDATE users SET model='google/gemini-2.5-flash-lite' WHERE model='google/gemini-2.5-flash-lite-preview'").run();

const stmts = {
  getUser:       db.prepare('SELECT * FROM users WHERE telegram_id = ?'),
  insertUser:    db.prepare('INSERT OR IGNORE INTO users (telegram_id, name, username, balance) VALUES (?, ?, ?, ?)'),
  touchUser:     db.prepare('UPDATE users SET name=?, username=?, last_seen=unixepoch() WHERE telegram_id=?'),
  setModel:      db.prepare('UPDATE users SET model=? WHERE telegram_id=?'),
  deduct:        db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id = ?'),
  credit:        db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?'),
  insertUsage:   db.prepare('INSERT INTO usage_log (user_id, model, duration_sec, cost, type, success) VALUES (?,?,?,?,?,?)'),
  insertPayment: db.prepare('INSERT INTO payments (user_id, amount) VALUES (?,?)'),
  getPayment:    db.prepare('SELECT * FROM payments WHERE id = ?'),
  setPaymentStatus:  db.prepare('UPDATE payments SET status=?, updated_at=unixepoch() WHERE id=?'),
  setPaymentReceipt: db.prepare('UPDATE payments SET receipt_file_id=?, admin_message_id=?, status=?, updated_at=unixepoch() WHERE id=?'),
  // dashboard
  dailyRevenue:   db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='approved' AND created_at >= unixepoch()-86400"),
  monthlyRevenue: db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='approved' AND created_at >= unixepoch()-2592000"),
  totalRevenue:   db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='approved'"),
  userCount:      db.prepare('SELECT COUNT(*) as c FROM users'),
  voiceCount:     db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE success=1"),
  errorCount:     db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE success=0"),
};

function upsertUser(telegramId, name, username) {
  const before = stmts.getUser.get(telegramId);
  stmts.insertUser.run(telegramId, name || '', username || '', WELCOME_GIFT);
  stmts.touchUser.run(name || '', username || '', telegramId);
  const user = stmts.getUser.get(telegramId);
  return { user, isNew: !before };
}

function getUser(telegramId)  { return stmts.getUser.get(telegramId); }
function getBalance(tid)      { return getUser(tid)?.balance ?? 0; }
function getUserModel(tid)    { return getUser(tid)?.model || 'google/gemini-2.5-flash'; }

/* ===== 2) Model config ===== */
const MODEL_CONFIG = {
  'google/gemini-2.5-flash-lite': { label: 'Flash Lite', price: 500,  fallback: true,  usdPerMin: 0.0003 },
  'google/gemini-2.5-flash':      { label: 'Flash',      price: 1000, fallback: true,  usdPerMin: 0.0007 },
  'google/gemini-2.5-pro':        { label: 'Pro',         price: 2000, fallback: false, usdPerMin: 0.0040 },
  // مدل آزمایشی — هر وقت گفتی فقط همین یک خط را حذف کن
  'xiaomi/mimo-v2.5':             { label: 'MiMo 2.5',    price: 500,  fallback: true,  usdPerMin: 0.0003 },
};
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const GPT_MODEL     = 'openai/gpt-audio-mini';
const RETRIES       = 3;
const RETRY_DELAY   = 10_000;

function calcCost(durationSec, model) {
  const cfg = MODEL_CONFIG[model];
  if (!cfg || !durationSec) return 0;
  return Math.round((durationSec / 60) * cfg.price);
}

function calcAdminCostUsd(durationSec, model) {
  const cfg = MODEL_CONFIG[model];
  if (!cfg || !durationSec) return null;
  return `~$${((durationSec / 60) * cfg.usdPerMin).toFixed(4)}`;
}

/* ===== 3) Prompts ===== */
const PROMPT_MAP = {
  full: `Transcribe the entire speech exactly as spoken, in the same language, with proper punctuation.

Speaker detection rules (apply strictly):
- If there is only ONE speaker: return the transcript as plain continuous text. Do NOT include any speaker labels, names, or identifiers whatsoever.
- If there are MULTIPLE speakers:
  - If any speaker's name is clearly inferable from the conversation (e.g., they address each other by name), use those real names as labels.
  - Otherwise label speakers as "شخص ۱", "شخص ۲", etc.
  - Start a new line for each speaker change, with the label followed by a colon, then their speech.

Do not add any commentary, notes, or text outside of the transcript itself.`,

  clean: `Transcribe the speech into a clean, fluent text in the same language. Preserve all meaningful content and the original tone, but remove filler words, repetitions, hesitations, and unnecessary digressions.

Speaker detection rules (apply strictly):
- If there is only ONE speaker: return the cleaned text as plain continuous prose. Do NOT include any speaker labels, names, or identifiers whatsoever.
- If there are MULTIPLE speakers:
  - If any speaker's name is clearly inferable from the conversation, use those real names as labels.
  - Otherwise label speakers as "شخص ۱", "شخص ۲", etc.
  - Start a new paragraph for each speaker change, with the label followed by a colon, then their cleaned speech.`,

  summary: `Analyze the speech and produce a very short bullet-point summary in the same language.

Speaker detection rules (apply strictly):
- If there is only ONE speaker: write the summary with no speaker references at all.
- If there are MULTIPLE speakers:
  - If any speaker's name is clearly inferable from the conversation, use those real names.
  - Otherwise label speakers as "شخص ۱", "شخص ۲", etc.
  - Mention the relevant speaker in parentheses after each topic point if applicable.

Format:
- Start with exactly: "📌 محتوای این وویس:"
- List 3–5 main topics, each on its own line starting with a relevant emoji (🔹, 🔸, 🟢, etc.) followed by the topic title.
- Optionally add a very short sub-point on the next line starting with "   ↳" (one short sentence max).
- Keep it concise — main topics should be clear at first glance.`,

  meeting: `You are a precise, neutral, and professional executive assistant / meeting secretary. From this audio, produce a structured smart meeting-minutes document in the SAME language as the speech (if the speech is Persian, write everything in Persian).

The raw speech may be a mix of speakers without clear separation. Using tone, pauses, and the names people use to address each other (e.g. "ببین علی..." or "خانم محمدی نظر شما چیه؟"), infer the speakers and attribute opinions to the correct people.

CRITICAL anti-hallucination rule: If a deadline, owner, or any detail is NOT clearly stated in the audio, do NOT guess — write "نامشخص".

Tone: formal, neutral (no personal judgement), clear and direct.

Output EXACTLY the following structure with these headers (omit a section only if it is genuinely empty/not applicable, e.g. a single-speaker memo has no decisions/voters):

📋 صورت‌جلسه

🏷️ شناسنامه جلسه
• موضوع اصلی جلسه: (یک خط)
• حاضرین شناسایی‌شده: (اسم‌هایی که در طول جلسه صدا زده شده‌اند؛ اگر هیچ اسمی مشخص نبود بنویس «نامشخص»)
• کلمات کلیدی: (۵ تا ۷ کلمه کلیدی)

📝 چکیده مدیریتی
(یک پاراگراف ۳ تا ۵ خطی و بی‌طرفانه که کل جلسه را از ابتدا تا خروجی روایت می‌کند)

✅ تصمیمات و مصوبات
🔹 تصمیم: ...
   ↳ دلیل: ...
   ↳ موافقان/مخالفان اصلی: (در صورت مشخص بودن)

📌 اقدامات و تقسیم وظایف
🔸 عنوان کار: ... | مسئول: ... | مهلت: ...
(برای هر مورد یک خط؛ مسئول یا مهلت نامشخص → بنویس «نامشخص»)

💬 مباحث کلیدی و دیدگاه‌ها
🟢 موضوع: خلاصهٔ بحث + نظرات موافق و مخالف (بی‌طرفانه)
   ↳ نقل‌قول طلایی: «...» (با ذکر نام گوینده، فقط اگر جملهٔ تعیین‌کننده‌ای گفته شده)

🔓 مباحث باز و دستور جلسه بعدی
• موضوعاتی که بلاتکلیف ماند یا به جلسه بعد موکول شد

⚠️ ریسک‌ها و نگرانی‌ها
• نگرانی‌ها یا ریسک‌های مطرح‌شده (در صورت وجود)

Do NOT add any commentary or framing before "📋 صورت‌جلسه" or after the last section. Start your output immediately with "📋 صورت‌جلسه".`,
};

const PROMPT_MAP_GPT = {
  full: `You are a pure transcription tool. Output ONLY the exact spoken words from this audio, nothing else.

STRICT RULES — violating any of these is wrong:
- Do NOT narrate, explain, or act as an assistant. Never say things like "The speaker says..." or "Here is the transcription:" or "باشه، من می‌خوام..."
- Do NOT add any introduction, conclusion, or commentary.
- Output starts immediately with the first spoken word.

Speaker detection:
- ONE speaker → plain text, no labels at all.
- MULTIPLE speakers → if names are inferable from the conversation, use them; otherwise use "شخص ۱", "شخص ۲", etc. New line per speaker change with "Name: speech".

Transcribe in the same language as spoken, with proper punctuation. Nothing beyond the transcript itself.`,

  clean: `You are a pure transcription tool. Output ONLY the cleaned spoken content from this audio, nothing else.

STRICT RULES — violating any of these is wrong:
- Do NOT narrate, explain, or act as an assistant. Never say things like "The speaker says..." or "Here is the cleaned version:" or any meta-commentary.
- Do NOT add any introduction, conclusion, or framing.
- Output starts immediately with the first word of the cleaned speech.

Task: Remove filler words, hesitations, and repetitions. Preserve all meaningful content and original tone.

Speaker detection:
- ONE speaker → plain prose, no labels at all.
- MULTIPLE speakers → if names are inferable, use them; otherwise use "شخص ۱", "شخص ۲", etc. New paragraph per speaker change with "Name: speech".`,

  summary: `You are a pure content analysis tool. Output ONLY the bullet-point summary of this audio, nothing else.

STRICT RULES:
- Do NOT narrate or act as an assistant. Do NOT say "The speaker discusses..." or "Here is a summary:".
- Start your output immediately with "📌 محتوای این وویس:" — nothing before it.

Format:
- First line: "📌 محتوای این وویس:"
- Then 3–5 topics, each starting with a relevant emoji (🔹, 🔸, 🟢, etc.) followed by the topic.
- Optional sub-point on the next line starting with "   ↳" (one short sentence max).

Speaker detection:
- ONE speaker → no speaker references at all.
- MULTIPLE speakers → if names are inferable, use them; otherwise "شخص ۱", "شخص ۲". Add speaker in parentheses after relevant topics.`,

  meeting: `You are a precise, neutral, professional executive assistant / meeting secretary. Output ONLY the structured meeting-minutes document for this audio — no narration, no "Here is the meeting minutes:", no meta-commentary. Start immediately with "📋 صورت‌جلسه".

Write everything in the SAME language as the speech (Persian audio → Persian output).

The audio may mix speakers without separation. Using tone, pauses, and how people address each other (e.g. "ببین علی..."), infer speakers and attribute opinions correctly.

CRITICAL: If a deadline, owner, or detail is NOT clearly stated, write "نامشخص" — never invent it.

Tone: formal, neutral, clear, direct.

Use EXACTLY this structure (skip a section only if genuinely empty):

📋 صورت‌جلسه

🏷️ شناسنامه جلسه
• موضوع اصلی جلسه: (یک خط)
• حاضرین شناسایی‌شده: (اسم‌های صدا زده‌شده؛ اگر نبود «نامشخص»)
• کلمات کلیدی: (۵ تا ۷ کلمه)

📝 چکیده مدیریتی
(یک پاراگراف ۳ تا ۵ خطی بی‌طرفانه)

✅ تصمیمات و مصوبات
🔹 تصمیم: ...
   ↳ دلیل: ...
   ↳ موافقان/مخالفان اصلی: (در صورت مشخص بودن)

📌 اقدامات و تقسیم وظایف
🔸 عنوان کار: ... | مسئول: ... | مهلت: ...

💬 مباحث کلیدی و دیدگاه‌ها
🟢 موضوع: خلاصهٔ بحث + نظرات موافق و مخالف
   ↳ نقل‌قول طلایی: «...» (با ذکر نام، فقط اگر تعیین‌کننده باشد)

🔓 مباحث باز و دستور جلسه بعدی
• موارد بلاتکلیف یا موکول‌شده

⚠️ ریسک‌ها و نگرانی‌ها
• ریسک‌ها و نگرانی‌های مطرح‌شده (در صورت وجود)`,
};

/* ===== 4) Helpers ===== */
const TELEGRAM_MESSAGE_LIMIT = 4000;
// سقف دانلود فایل از Telegram Bot API برای ربات‌ها = ۲۰ مگابایت
const TELEGRAM_MAX_DOWNLOAD  = 20 * 1024 * 1024;
const FILE_TOO_BIG_MSG =
  '😕 حجم فایل بیش از محدودیت ۲۰ مگابایت تلگرام است.\n\n' +
  'پیشنهادات:\n' +
  '• فایل را به چند بخش کوتاه‌تر تقسیم کن\n' +
  '• فرمت را به mp3 تبدیل کن (مثلاً با اپ Audio Converter)\n' +
  '• بیت‌ریت را کاهش بده (۶۴kbps کافی است)\n' +
  '• سرعت پخش را ۲x کن تا حجم نصف شود';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeDigits(s) {
  return s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
          .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

function splitForTelegram(text, maxLen = TELEGRAM_MESSAGE_LIMIT) {
  if (!text) return [];
  const chunks = [];
  let rem = String(text);
  while (rem.length > maxLen) {
    let cut = rem.lastIndexOf('\n\n', maxLen);
    if (cut < 0) cut = rem.lastIndexOf('\n', maxLen);
    if (cut < 0) cut = rem.lastIndexOf(' ', maxLen);
    if (cut < 0) cut = maxLen;
    chunks.push(rem.slice(0, cut).trim());
    rem = rem.slice(cut).trimStart();
  }
  if (rem.length) chunks.push(rem);
  return chunks;
}

/* ===== 5) AI ===== */
class CreditError extends Error {
  constructor(msg) { super(msg); this.name = 'CreditError'; }
}

function throwForStatus(status, body) {
  if (status === 402 || /insufficient|credit|quota|payment|balance/i.test(body))
    throw new CreditError(body.slice(0, 200));
  if (status === 429 || /rate.?limit|too many requests|temporarily/i.test(body))
    throw new Error(`RATE_LIMIT: HTTP ${status}: ${body.slice(0, 150)}`);
  throw new Error(`HTTP ${status}: ${body.slice(0, 200)}`);
}

async function convertToMp3(buffer) {
  const id      = Date.now();
  const inPath  = `/tmp/voice_in_${id}`;
  const outPath = `/tmp/voice_out_${id}.mp3`;
  writeFileSync(inPath, buffer);
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', inPath, '-ar', '16000', '-ac', '1', '-b:a', '64k', outPath]);
    return readFileSync(outPath);
  } finally {
    try { unlinkSync(inPath);  } catch {}
    try { unlinkSync(outPath); } catch {}
  }
}

const OR_TIMEOUT_MS = 10 * 60 * 1000; // ۱۰ دقیقه — برای فایل‌های طولانی

async function callOpenRouter(model, audioBuffer, mimeType, prompt) {
  let content;
  if (/audio/i.test(model)) {
    let format = 'mp3';
    if (/wav/i.test(mimeType))           format = 'wav';
    else if (/mp3|mpeg/i.test(mimeType)) format = 'mp3';
    content = [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ];
  } else {
    const dataUrl = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;
    content = [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: prompt },
    ];
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OR_TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
      signal: ctrl.signal,
    });
    if (!res.ok) throwForStatus(res.status, await res.text());
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`TIMEOUT: مدل ${model} در ۱۰ دقیقه پاسخ نداد`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeSingle(audioBuffer, mimeType, prompt, promptGpt, primaryModel, useFallback) {
  let lastErr = null;
  for (let i = 0; i < RETRIES; i++) {
    if (i > 0) await sleep(RETRY_DELAY);
    try {
      const out = await callOpenRouter(primaryModel, audioBuffer, mimeType, prompt);
      if (out) return out;
    } catch (err) {
      if (err instanceof CreditError) throw err;
      lastErr = err;
      console.error(`❌ ${primaryModel} attempt ${i+1}/${RETRIES}:`, (err.message||'').slice(0,150));
    }
  }

  if (!useFallback) throw new Error(`ALL_FAILED:${lastErr?.message || 'unknown'}`);

  console.log('↪️ Primary exhausted, switching to GPT fallback...');
  let mp3Buffer;
  try {
    mp3Buffer = /mp3|mpeg|wav/i.test(mimeType) ? audioBuffer : await convertToMp3(audioBuffer);
  } catch (e) {
    console.error('❌ ffmpeg conversion failed:', e.message);
    throw new Error(`تبدیل فایل صوتی ناموفق بود. ${lastErr?.message || ''}`);
  }

  for (let i = 0; i < RETRIES; i++) {
    if (i > 0) await sleep(RETRY_DELAY);
    try {
      const out = await callOpenRouter(GPT_MODEL, mp3Buffer, 'audio/mpeg', promptGpt);
      if (out) return out;
    } catch (err) {
      if (err instanceof CreditError) throw err;
      lastErr = err;
      console.error(`❌ GPT attempt ${i+1}/${RETRIES}:`, (err.message||'').slice(0,150));
    }
  }
  throw new Error(`ALL_FAILED:${lastErr?.message || 'unknown'}`);
}

// کل فایل یک‌جا به مدل فرستاده می‌شود (بدون تقسیم). تبدیل فرمت فقط در مسیر fallback لازم است.
async function callAI(session, type) {
  const { audioBuffer, mimeType, userModel } = session;
  const modelCfg  = MODEL_CONFIG[userModel] || MODEL_CONFIG[DEFAULT_MODEL];
  const prompt    = PROMPT_MAP[type]     || PROMPT_MAP.full;
  const promptGpt = PROMPT_MAP_GPT[type] || PROMPT_MAP_GPT.full;
  return await transcribeSingle(audioBuffer, mimeType, prompt, promptGpt, userModel, modelCfg.fallback);
}

async function getOpenRouterBalance() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const total = data?.data?.total_credits;
    const used  = data?.data?.total_usage;
    if (typeof total !== 'number' || typeof used !== 'number') return null;
    return total - used;
  } catch { return null; }
}

async function maybeWarnLowBalance(ctx) {
  if (ctx.from?.id !== ADMIN_ID) return;
  const bal = await getOpenRouterBalance();
  if (bal !== null && bal < 1) {
    try {
      await ctx.reply(`⚠️ شارژ OpenRouter زیر ۱ دلار است (حدود $${bal.toFixed(2)}). لطفاً حساب را شارژ کنید.`);
    } catch {}
  }
}

/* ===== 6) Bot & session ===== */
// handlerTimeout: Infinity → پردازش فایل‌های طولانی (چند دقیقه‌ای) قطع نشود
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

const sessions    = new Map(); // token → voice session
const userStates  = new Map(); // userId → { step, paymentId }

// پردازش هم‌زمان: حداکثر چند فایل صوتی به‌طور موازی برای هر کاربر
const MAX_CONCURRENT_JOBS = 2;
const activeJobs = new Map(); // userId → تعداد پردازش‌های در جریان
const jobCount   = (uid) => activeJobs.get(uid) || 0;
const incJob     = (uid) => activeJobs.set(uid, jobCount(uid) + 1);
const decJob     = (uid) => { const n = jobCount(uid) - 1; if (n > 0) activeJobs.set(uid, n); else activeJobs.delete(uid); };

// همه‌ی پیام‌های یک ورک‌فلو به پیام مبدأ ریپلای می‌شوند (قابل پیگیری)
const replyTo = (id) => (id ? { reply_to_message_id: id, allow_sending_without_reply: true } : {});

function makeToken() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }

setInterval(() => {
  const now = Date.now();
  for (const [k,v] of sessions) {
    if (now - v.createdAt > 2*60*60*1000) sessions.delete(k);
  }
}, 30*60*1000);

/* ===== 7) Keyboards ===== */
const MODE_SELECT_TEXT = 'یکی از حالت‌های زیر رو انتخاب کن:';

const HELP_TEXT =
  '💡 راهنمای حالت‌های پردازش\n\n' +
  '📝 متن کامل\n' +
  'گفتار عیناً و کلمه‌به‌کلمه پیاده می‌شه. اگه چند نفر صحبت کنن، گوینده‌ها از هم جدا و در صورت امکان با اسم مشخص می‌شن. مناسب وقتی می‌خوای هیچ جزئیاتی از دست نره.\n\n' +
  '✂️ متن مفید\n' +
  'متن تمیز و روان؛ کلمات اضافی، مکث‌ها، تکرارها و حاشیه‌ها حذف می‌شن ولی کل معنا و لحن حفظ می‌شه. مناسب برای خوندن سریع و راحت.\n\n' +
  '📌 خلاصه تیتروار\n' +
  'جمع‌بندی کوتاه و تیتروار از ۳ تا ۵ موضوع اصلی، هر کدوم با ایموجی. مناسب وقتی فقط می‌خوای سرفصل‌ها رو در یک نگاه ببینی.\n\n' +
  '📋 صورت جلسه\n' +
  'سند ساختاریافته‌ی جلسه: موضوع، حاضرین، چکیده مدیریتی، تصمیمات، تقسیم وظایف (با مسئول و مهلت)، مباحث کلیدی، موارد باز و ریسک‌ها. مناسب جلسات کاری.';

// باکس نقل‌قول هزینه: اسم مدل (خط اول) + هزینه (خط دوم) — برای ادمین دلار، برای کاربر تومان
function buildCostBlock(durationSec, model, isAdmin) {
  const cfg = MODEL_CONFIG[model] || MODEL_CONFIG[DEFAULT_MODEL];
  let costStr;
  if (isAdmin) {
    const usd = calcAdminCostUsd(durationSec, model);
    if (!usd) return '';
    costStr = `هزینه تخمینی: ${usd}`;
  } else {
    const c = calcCost(durationSec, model);
    if (!c) return '';
    costStr = `هزینه پردازش: ${c.toLocaleString('fa-IR')} تومان`;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<blockquote>${esc(cfg.label)}\n${esc(costStr)}</blockquote>`;
}

function mainKeyboard(userId) {
  if (userId === ADMIN_ID) {
    return Markup.keyboard([['🔄 تعویض پردازنده', '📊 داشبورد']]).resize();
  }
  return Markup.keyboard([['🔄 تعویض پردازنده', '👛 کیف پول']]).resize();
}

function createProcessTypeKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 متن کامل',      `ptype:full:${token}`)],
    [Markup.button.callback('✂️ متن مفید',       `ptype:clean:${token}`)],
    [Markup.button.callback('📌 خلاصه تیتروار', `ptype:summary:${token}`)],
    [Markup.button.callback('📋 صورت جلسه',      `ptype:meeting:${token}`)],
    [Markup.button.callback('💡 راهنما', `help:${token}`), Markup.button.callback('🔄 تعویض پردازنده', `switchflow:${token}`)],
    [Markup.button.callback('🚫 انصراف', `cancel:${token}`)],
  ]);
}

// کیبورد راهنما: فقط دکمه بازگشت به مرحله انتخاب حالت
function helpKeyboard(token) {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', `back:${token}`)]]);
}

// کیبورد تعویض مدل در میانه فرآیند: مدل‌ها + بازگشت
function inflowModelKeyboard(currentModel, token) {
  const rows = Object.entries(MODEL_CONFIG).map(([id, cfg]) => {
    const tick = id === currentModel ? '✅ ' : '';
    return [Markup.button.callback(
      `${tick}${cfg.label} — ${cfg.price.toLocaleString('fa-IR')} ت/دقیقه`,
      `setmodelflow:${id}:${token}`
    )];
  });
  rows.push([Markup.button.callback('🔙 بازگشت', `back:${token}`)]);
  return Markup.inlineKeyboard(rows);
}

function createOutputFormatKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📨 چند پیام جداگانه',    `output:messages:${token}`)],
    [Markup.button.callback('📎 دانلود به صورت فایل', `output:file:${token}`)],
    [Markup.button.callback('🚫 انصراف',              `cancel:${token}`)],
  ]);
}

async function sendLongTextAsMessages(ctx, text, extra = {}) {
  const parts = splitForTelegram(text);
  if (!parts.length) { await ctx.reply('متنی برنگشت.', extra); return; }
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.length > 1 ? `📄 بخش ${i+1} از ${parts.length}:\n\n` : '';
    await ctx.reply(prefix + parts[i], extra);
    if (i < parts.length - 1) await sleep(500);
  }
}

async function sendTextAsFile(ctx, text, extra = {}) {
  await ctx.replyWithDocument({
    source:   Buffer.from(text, 'utf-8'),
    filename: `transcript_${Date.now()}.txt`,
  }, extra);
}

/* ===== 8) Handlers ===== */

bot.start(async (ctx) => {
  const { isNew } = upsertUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const keyboard  = mainKeyboard(ctx.from.id);
  if (ctx.from.id === ADMIN_ID) {
    await ctx.reply('سلام! یک ویس بفرست. 🎤', keyboard);
    return;
  }
  const giftLine = isNew
    ? `🎁 به عنوان هدیه خوش‌آمد، ${WELCOME_GIFT.toLocaleString('fa-IR')} تومان به کیف پولت شارژ شد!\n\n`
    : '';
  await ctx.reply(
    `🎉 خوش اومدی!\n\n` +
    `این ربات فایل‌های صوتی رو با کمک هوش مصنوعی به متن تبدیل می‌کنه.\n` +
    `اونم با بیشترین دقت و کیفیت!\n\n` +
    giftLine +
    `📋 راهنما:\n` +
    `• یک ویس بفرست تا شروع کنیم 🎤\n` +
    `• با دکمه «🔄 تعویض پردازنده» مدل هوش مصنوعی و نرخ پردازش رو انتخاب کن\n` +
    `• با دکمه «👛 کیف پول» موجودیت رو ببین و شارژ کن`,
    keyboard
  );
});

function modelSelectionKeyboard(currentModel) {
  return Markup.inlineKeyboard(
    Object.entries(MODEL_CONFIG).map(([id, cfg]) => {
      const tick = id === currentModel ? '✅ ' : '';
      return [Markup.button.callback(
        `${tick}${cfg.label} — ${cfg.price.toLocaleString('fa-IR')} ت/دقیقه`,
        `setmodel:${id}`
      )];
    })
  );
}

bot.hears('🔄 تعویض پردازنده', async (ctx) => {
  upsertUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const currentModel = getUserModel(ctx.from.id);
  await ctx.reply(
    'مدل هوش مصنوعی رو انتخاب کن:\n\n' +
    'Flash Lite — سریع‌ترین، ارزان‌ترین\n' +
    'Flash — متعادل (پیش‌فرض)\n' +
    'Pro — دقیق‌ترین',
    modelSelectionKeyboard(currentModel)
  );
});

bot.hears('👛 کیف پول', async (ctx) => {
  if (ctx.from.id === ADMIN_ID) return;
  upsertUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const balance = getBalance(ctx.from.id);
  await ctx.reply(
    `👛 کیف پول شما\n\n` +
    `💰 موجودی: ${balance.toLocaleString('fa-IR')} تومان`,
    Markup.inlineKeyboard([[Markup.button.callback('➕ افزایش موجودی', 'recharge')]])
  );
});

bot.hears('📊 داشبورد', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const d = {
    users:   stmts.userCount.get().c,
    voices:  stmts.voiceCount.get().c,
    errors:  stmts.errorCount.get().c,
    day:     stmts.dailyRevenue.get().s,
    month:   stmts.monthlyRevenue.get().s,
    total:   stmts.totalRevenue.get().s,
  };
  const orBal = await getOpenRouterBalance();
  const orStr = orBal !== null ? `$${orBal.toFixed(2)}` : '—';
  await ctx.reply(
    `📊 داشبورد مدیریت\n\n` +
    `👥 کاربران: ${d.users.toLocaleString('fa-IR')}\n` +
    `🎤 وویس‌های موفق: ${d.voices.toLocaleString('fa-IR')}\n` +
    `❌ خطاها: ${d.errors.toLocaleString('fa-IR')}\n\n` +
    `💰 درآمد امروز: ${d.day.toLocaleString('fa-IR')} تومان\n` +
    `💰 درآمد این ماه: ${d.month.toLocaleString('fa-IR')} تومان\n` +
    `💰 کل درآمد: ${d.total.toLocaleString('fa-IR')} تومان\n\n` +
    `🔋 موجودی OpenRouter: ${orStr}`
  );
});

bot.on(['voice', 'audio'], async (ctx) => {
  const userId = ctx.from.id;
  upsertUser(userId, ctx.from.first_name, ctx.from.username);

  const userModel  = getUserModel(userId);
  const media      = ctx.message.voice || ctx.message.audio;
  const voiceMsgId = ctx.message.message_id;
  const tgDuration = ctx.message.voice?.duration || ctx.message.audio?.duration || 0;
  const estimatedCost = tgDuration > 0 ? calcCost(tgDuration, userModel) : null;

  // محدودیت تلگرام: فایل بزرگ‌تر از ۲۰MB اصلاً قابل دانلود توسط ربات نیست.
  // قبل از انتخاب حالت، همان لحظه اطلاع‌رسانی کن.
  if (media?.file_size && media.file_size > TELEGRAM_MAX_DOWNLOAD) {
    await ctx.reply(FILE_TOO_BIG_MSG, replyTo(voiceMsgId));
    return;
  }

  // Check balance before downloading (only non-admin)
  if (userId !== ADMIN_ID && estimatedCost !== null && estimatedCost > 0) {
    const balance = getBalance(userId);
    if (balance < estimatedCost) {
      await ctx.reply(
        `👛 موجودی کافی نیست.\n\n` +
        `💰 هزینه پردازش: ${estimatedCost.toLocaleString('fa-IR')} تومان\n` +
        `💳 موجودی: ${balance.toLocaleString('fa-IR')} تومان`,
        { ...replyTo(voiceMsgId), ...Markup.inlineKeyboard([[Markup.button.callback('➕ افزایش موجودی', 'recharge')]]) }
      );
      return;
    }
  }

  const thinking = await ctx.reply('⏳ دریافت فایل...', replyTo(voiceMsgId));
  try {
    const fileUrl = await ctx.telegram.getFileLink(media.file_id);
    const res     = await fetch(fileUrl.href);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());

    let mimeType = 'audio/ogg';
    if (ctx.message.audio?.mime_type) mimeType = ctx.message.audio.mime_type;

    const token = makeToken();
    sessions.set(token, {
      step:        'await_process_type',
      mimeType,
      audioBuffer,
      durationSec: tgDuration || null,
      userModel,
      chatId:      thinking.chat.id,
      promptMsgId: thinking.message_id,
      voiceMsgId,
      userId,
      createdAt:   Date.now(),
    });

    const costBlock = buildCostBlock(tgDuration, userModel, userId === ADMIN_ID);
    const questionText = `چطور میخوای متن پردازش بشه؟${costBlock ? `\n\n${costBlock}` : ''}`;

    await ctx.telegram.editMessageText(
      thinking.chat.id, thinking.message_id, undefined,
      questionText,
      { parse_mode: 'HTML' }
    );
    // پیام دوم به پیام اولش («چطور میخوای…») ریپلای می‌شود
    await ctx.reply(MODE_SELECT_TEXT, { ...replyTo(thinking.message_id), ...createProcessTypeKeyboard(token) });
  } catch (err) {
    console.error('❌ ERROR on voice:', err);
    let m = '😕 خطا در دریافت فایل. دوباره امتحان کن.';
    if (/too big|file is too big|413|request entity too large/i.test(err.message || '')) {
      m = FILE_TOO_BIG_MSG;
    }
    try { await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, m); } catch {}
  }
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const state  = userStates.get(userId);
  if (state?.step !== 'waiting_receipt') return;

  const fileId  = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const payment = stmts.getPayment.get(state.paymentId);
  if (!payment || payment.status !== 'pending') return;

  await sendReceiptToAdmin(ctx, userId, state.paymentId, fileId, null);
  userStates.delete(userId);
  await ctx.reply('✅ فیش دریافت شد و در انتظار تایید ادمین است.\nمعمولاً در کمتر از ۲۴ ساعت بررسی می‌شود.');
});

// ویرایش پیام درخواست شارژ نزد ادمین: عکس → caption، متن → text
async function editAdminPaymentMsg(ctx, text) {
  const isPhoto = !!ctx.callbackQuery?.message?.photo;
  try {
    if (isPhoto) {
      await ctx.editMessageCaption(text, { reply_markup: { inline_keyboard: [] } });
    } else {
      await ctx.editMessageText(text, { reply_markup: { inline_keyboard: [] } });
    }
  } catch {}
}

async function sendReceiptToAdmin(ctx, userId, paymentId, photoFileId, textBody) {
  const user    = getUser(userId);
  const payment = stmts.getPayment.get(paymentId);
  const caption =
    `💳 درخواست شارژ جدید\n\n` +
    `👤 ${user?.name || 'نامشخص'} (@${user?.username || '—'})\n` +
    `🆔 آیدی: ${userId}\n` +
    `💰 مبلغ: ${payment.amount.toLocaleString('fa-IR')} تومان\n` +
    `🔢 پرداخت #${paymentId}` +
    (textBody ? `\n\n📋 فیش متنی:\n${textBody}` : '');
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback('✅ تایید', `approve:${paymentId}`),
    Markup.button.callback('❌ رد',    `reject:${paymentId}`),
  ]]).reply_markup;

  let adminMsg;
  if (photoFileId) {
    adminMsg = await ctx.telegram.sendPhoto(ADMIN_ID, photoFileId, { caption, reply_markup: kb });
  } else {
    adminMsg = await ctx.telegram.sendMessage(ADMIN_ID, caption, { reply_markup: kb });
  }
  stmts.setPaymentReceipt.run(photoFileId || null, adminMsg.message_id, 'waiting_review', paymentId);
}

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state  = userStates.get(userId);
  if (!state) return;

  if (state.step === 'waiting_amount') {
    const raw    = normalizeDigits(ctx.message.text.trim()).replace(/[,،\s]/g, '');
    const amount = parseInt(raw, 10);
    if (isNaN(amount) || amount < MIN_RECHARGE) {
      await ctx.reply(`❌ حداقل مبلغ شارژ ${MIN_RECHARGE.toLocaleString('fa-IR')} تومان است.\nمبلغ معتبر وارد کن:`);
      return;
    }
    const paymentId = Number(stmts.insertPayment.run(userId, amount).lastInsertRowid);
    userStates.set(userId, { step: 'waiting_receipt', paymentId });
    await ctx.reply(
      `💳 برای شارژ ${amount.toLocaleString('fa-IR')} تومان، مبلغ را به کارت زیر واریز کن:\n\n` +
      `\`${CARD_NUMBER}\`\n${CARD_OWNER}\n\n` +
      `بعد از واریز، تصویر فیش یا متن تأیید رو در همین چت بفرست.\n` +
      `⏰ مهلت ارسال: ۲۴ ساعت`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state.step === 'waiting_receipt') {
    const payment = stmts.getPayment.get(state.paymentId);
    if (!payment || payment.status !== 'pending') { userStates.delete(userId); return; }
    await sendReceiptToAdmin(ctx, userId, state.paymentId, null, ctx.message.text);
    userStates.delete(userId);
    await ctx.reply('✅ فیش دریافت شد و در انتظار تایید ادمین است.\nمعمولاً در کمتر از ۲۴ ساعت بررسی می‌شود.');
  }
});

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';

    // ── Cancel ──
    const c = data.match(/^cancel:([a-z0-9]+)$/i);
    if (c) {
      const session = sessions.get(c[1]);
      if (session?.step === 'processing') return ctx.answerCbQuery('در حال پردازش است، لطفاً صبر کن.', { show_alert: true });
      await ctx.answerCbQuery('لغو شد');
      try { await ctx.editMessageText('🚫 لغو شد'); } catch {}
      if (session) {
        try { await ctx.telegram.deleteMessage(session.chatId, session.promptMsgId); } catch {}
        sessions.delete(c[1]);
      }
      return;
    }

    // ── Help (in-flow): edit the mode-select message to show the help guide ──
    const hp = data.match(/^help:([a-z0-9]+)$/i);
    if (hp) {
      const token   = hp[1];
      const session = sessions.get(token);
      if (!session || session.step !== 'await_process_type') return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      await ctx.answerCbQuery();
      try { await ctx.editMessageText(HELP_TEXT, helpKeyboard(token)); } catch {}
      return;
    }

    // ── Switch model (in-flow): edit message to model selection (with back) ──
    const swf = data.match(/^switchflow:([a-z0-9]+)$/i);
    if (swf) {
      const token   = swf[1];
      const session = sessions.get(token);
      if (!session || session.step !== 'await_process_type') return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      const currentModel = session.userModel || getUserModel(session.userId);
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageText(
          'مدل هوش مصنوعی رو انتخاب کن:\n\n' +
          'Flash Lite — سریع‌ترین، ارزان‌ترین\n' +
          'Flash — متعادل (پیش‌فرض)\n' +
          'Pro — دقیق‌ترین',
          inflowModelKeyboard(currentModel, token)
        );
      } catch {}
      return;
    }

    // ── Back (in-flow): return exactly to the mode-select state ──
    const bk = data.match(/^back:([a-z0-9]+)$/i);
    if (bk) {
      const token   = bk[1];
      const session = sessions.get(token);
      if (!session || session.step !== 'await_process_type') return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      await ctx.answerCbQuery();
      try { await ctx.editMessageText(MODE_SELECT_TEXT, createProcessTypeKeyboard(token)); } catch {}
      return;
    }

    // ── Set model (in-flow): persist, refresh cost, return to mode-select, toast ──
    const smf = data.match(/^setmodelflow:(.+):([a-z0-9]+)$/i);
    if (smf) {
      const modelId = smf[1];
      const token   = smf[2];
      const session = sessions.get(token);
      if (!session || session.step !== 'await_process_type') return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      if (!MODEL_CONFIG[modelId]) return ctx.answerCbQuery('مدل نامعتبر');

      const cfg = MODEL_CONFIG[modelId];
      stmts.setModel.run(modelId, session.userId);
      session.userModel = modelId;

      // Refresh the cost box in the first message (Message1)
      const isAdmin   = session.userId === ADMIN_ID;
      const costBlock = buildCostBlock(session.durationSec, modelId, isAdmin);
      try {
        await ctx.telegram.editMessageText(
          session.chatId, session.promptMsgId, undefined,
          `چطور میخوای متن پردازش بشه؟${costBlock ? `\n\n${costBlock}` : ''}`,
          { parse_mode: 'HTML' }
        );
      } catch {}

      // Return the second message back to mode-select
      try { await ctx.editMessageText(MODE_SELECT_TEXT, createProcessTypeKeyboard(token)); } catch {}

      // Fading toast notification (display duration is fixed by Telegram, not adjustable)
      await ctx.answerCbQuery(`مدل انتخابی: ${cfg.label} — نرخ ${cfg.price.toLocaleString('fa-IR')} ت/دقیقه`);
      return;
    }

    // ── Set model ──
    const sm = data.match(/^setmodel:(.+)$/);
    if (sm) {
      const modelId = sm[1];
      if (!MODEL_CONFIG[modelId]) return ctx.answerCbQuery('مدل نامعتبر');
      stmts.setModel.run(modelId, ctx.from.id);
      const cfg = MODEL_CONFIG[modelId];
      await ctx.answerCbQuery(`✅ مدل به ${cfg.label} تغییر یافت`);
      try {
        await ctx.editMessageText(
          `✅ مدل انتخابی: ${cfg.label}\n💰 نرخ: ${cfg.price.toLocaleString('fa-IR')} تومان/دقیقه`
        );
      } catch {}
      return;
    }

    // ── Recharge (start wallet top-up) ──
    if (data === 'recharge') {
      const userId = ctx.from.id;
      if (userId === ADMIN_ID) return ctx.answerCbQuery();
      userStates.set(userId, { step: 'waiting_amount' });
      await ctx.answerCbQuery();
      await ctx.reply(
        `💰 چه مبلغی می‌خوای شارژ کنی؟\n` +
        `(حداقل ${MIN_RECHARGE.toLocaleString('fa-IR')} تومان)\n\n` +
        `مبلغ را به تومان بنویس:`
      );
      return;
    }

    // ── Admin: approve payment ──
    const ap = data.match(/^approve:(\d+)$/);
    if (ap) {
      if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('🔒');
      const paymentId = parseInt(ap[1]);
      const payment   = stmts.getPayment.get(paymentId);
      if (!payment || payment.status !== 'waiting_review') return ctx.answerCbQuery('قبلاً پردازش شده');

      stmts.setPaymentStatus.run('approved', paymentId);
      stmts.credit.run(payment.amount, payment.user_id);

      await ctx.answerCbQuery('✅ تایید شد');
      await editAdminPaymentMsg(ctx, `✅ تایید شد — ${payment.amount.toLocaleString('fa-IR')} تومان`);

      const newBalance = getBalance(payment.user_id);
      try {
        await ctx.telegram.sendMessage(
          payment.user_id,
          `✅ شارژ تایید شد!\n\n` +
          `💰 ${payment.amount.toLocaleString('fa-IR')} تومان به کیف پولت اضافه شد.\n` +
          `💳 موجودی جدید: ${newBalance.toLocaleString('fa-IR')} تومان`
        );
      } catch {}
      return;
    }

    // ── Admin: reject payment ──
    const rj = data.match(/^reject:(\d+)$/);
    if (rj) {
      if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('🔒');
      const paymentId = parseInt(rj[1]);
      const payment   = stmts.getPayment.get(paymentId);
      if (!payment || payment.status !== 'waiting_review') return ctx.answerCbQuery('قبلاً پردازش شده');

      stmts.setPaymentStatus.run('rejected', paymentId);

      await ctx.answerCbQuery('❌ رد شد');
      await editAdminPaymentMsg(ctx, `❌ رد شد — ${payment.amount.toLocaleString('fa-IR')} تومان`);

      try {
        await ctx.telegram.sendMessage(
          payment.user_id,
          `❌ فیش پرداختت تایید نشد.\n\n` +
          `اگر مشکلی هست به آیدی @alireza_oliya پیام بده.`
        );
      } catch {}
      return;
    }

    // ── Process type ──
    const p = data.match(/^ptype:(full|clean|summary|meeting):([a-z0-9]+)$/i);
    if (p) {
      const [, type, token] = p;
      const session = sessions.get(token);
      if (!session) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      if (session.step !== 'await_process_type') return ctx.answerCbQuery('قبلاً پردازش شده یا در حال انجام است.', { show_alert: true });

      const userId    = session.userId;
      const userModel = session.userModel || getUserModel(userId);
      const isAdmin   = userId === ADMIN_ID;

      // Balance check BEFORE locking — keep the keyboard so user can switch model / recharge
      if (!isAdmin && session.durationSec) {
        const cost    = calcCost(session.durationSec, userModel);
        const balance = getBalance(userId);
        if (balance < cost) {
          await ctx.answerCbQuery('موجودی کافی نیست', { show_alert: true });
          await ctx.reply(
            `👛 موجودی کافی نیست.\n\n` +
            `💰 هزینه پردازش: ${cost.toLocaleString('fa-IR')} تومان\n` +
            `💳 موجودی: ${balance.toLocaleString('fa-IR')} تومان`,
            { ...replyTo(session.voiceMsgId), ...Markup.inlineKeyboard([[Markup.button.callback('➕ افزایش موجودی', 'recharge')]]) }
          );
          return;
        }
      }

      // Concurrency cap: keep the keyboard so the user can retry after one finishes.
      // رزرو اسلات به‌صورت سنکرون (قبل از هر await) تا دو کلیک هم‌زمان از سقف عبور نکنند.
      if (jobCount(userId) >= MAX_CONCURRENT_JOBS) {
        return ctx.answerCbQuery(
          `ظرفیت پردازش هم‌زمان شما پر شده (${MAX_CONCURRENT_JOBS.toLocaleString('fa-IR')} فایل). لطفاً تا اتمام یکی صبر کنید.`,
          { show_alert: true }
        );
      }
      session.step = 'processing'; // قفل ضدّ دابل‌کلیک
      incJob(userId);              // رزرو اسلات پردازش هم‌زمان

      let waiting;
      try {
        await ctx.answerCbQuery('در حال پردازش...');
        // Remove the mode-select message (with its buttons) entirely
        try { await ctx.deleteMessage(); } catch {}
        // Trim the first message down to just the cost box (a useful log), drop the question
        const costBlock = buildCostBlock(session.durationSec, userModel, isAdmin);
        try {
          if (costBlock) {
            await ctx.telegram.editMessageText(session.chatId, session.promptMsgId, undefined, costBlock, { parse_mode: 'HTML' });
          } else {
            await ctx.telegram.deleteMessage(session.chatId, session.promptMsgId);
          }
        } catch {}
        waiting = await ctx.reply('⏳ در حال پردازش...', replyTo(session.voiceMsgId));
      } catch (e) {
        console.error('❌ ptype prep error:', e);
        decJob(userId);
        return;
      }

      // Detach the heavy work so the long-polling loop stays free → چند فایل هم‌زمان پردازش می‌شوند
      (async () => {
        try {
          let text;
          try {
            text = await callAI(session, type) || 'متنی برنگشت.';
          } catch (err) {
            console.error('❌ All AI attempts failed:', err);
            stmts.insertUsage.run(userId, userModel, session.durationSec || null, 0, type, 0);
            const m = err.message || '';
            let errMsg = '😕 پردازش ناموفق بود. دوباره تلاش کن.';
            if (err instanceof CreditError) {
              errMsg = '💳 اعتبار OpenRouter تمام شده است. لطفاً حساب را شارژ کنید.';
            } else if (/RATE_LIMIT/.test(m)) {
              errMsg = '⏳ سرویس موقتاً به محدودیت نرخ خورده است.\nچند دقیقه دیگر دوباره امتحان کن.';
            } else if (m.includes('تبدیل فایل')) {
              errMsg = '😕 خطا در تبدیل فایل صوتی. لطفاً مجدداً ویس بفرست.';
            } else if (/TIMEOUT/.test(m)) {
              errMsg = '⏱️ مدل در ۱۰ دقیقه پاسخ نداد. فایل احتمالاً خیلی طولانی است — امتحان کن به بخش‌های کوچک‌تر تقسیم کنی.\n(هزینه‌ای کسر نشد)';
            } else if (m.includes('ALL_FAILED')) {
              errMsg = '😕 هیچ مدلی پاسخ نداد. مشکل موقت است — چند دقیقه دیگر امتحان کن.\n(هزینه‌ای کسر نشد)';
            }
            try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, errMsg); } catch {}
            return;
          }

          // Deduct balance on success (non-admin)
          if (userId !== ADMIN_ID && session.durationSec) {
            const cost = calcCost(session.durationSec, userModel);
            if (cost > 0) {
              stmts.deduct.run(cost, userId);
              stmts.insertUsage.run(userId, userModel, session.durationSec, cost, type, 1);
            }
          } else {
            stmts.insertUsage.run(userId, userModel, session.durationSec || null, 0, type, 1);
          }

          const parts = splitForTelegram(text);
          if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
            try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, parts[0] || 'متنی برنگشت.'); } catch {}
            session.step = 'ready';
            await maybeWarnLowBalance(ctx);
          } else {
            session.resultText      = text;
            session.resultMsgChatId = waiting.chat.id;
            session.resultMsgId     = waiting.message_id;
            session.step            = 'await_output_format';
            try {
              await ctx.telegram.editMessageText(
                waiting.chat.id, waiting.message_id, undefined,
                `📏 خروجی طولانی است (${text.length.toLocaleString('fa-IR')} کاراکتر).\n\nچطور میخوای دریافتش کنی؟`
              );
            } catch {}
            // پیام دوم به پیام «خروجی طولانی است…» ریپلای می‌شود
            await ctx.reply('یکی از گزینه‌های زیر رو انتخاب کن:', { ...replyTo(waiting.message_id), ...createOutputFormatKeyboard(token) });
          }
        } catch (e) {
          console.error('❌ job pipeline error:', e);
        } finally {
          decJob(userId);
        }
      })();
      return;
    }

    // ── Output format ──
    const o = data.match(/^output:(messages|file):([a-z0-9]+)$/i);
    if (o) {
      const [, format, token] = o;
      const session = sessions.get(token);
      if (!session?.resultText) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      if (session.step !== 'await_output_format') return ctx.answerCbQuery('قبلاً پردازش شده.', { show_alert: true });

      session.step = 'processing_output';

      const charCount  = session.resultText.length.toLocaleString('fa-IR');
      const methodName = format === 'messages' ? 'پیام‌های جداگانه' : 'فایل';

      // Remove the format-select message (with its buttons) entirely
      try { await ctx.deleteMessage(); } catch {}

      const rt = replyTo(session.voiceMsgId);
      if (format === 'messages') {
        await ctx.answerCbQuery('در حال ارسال پیام‌ها...');
        await sendLongTextAsMessages(ctx, session.resultText, rt);
      } else {
        await ctx.answerCbQuery('در حال آماده‌سازی فایل...');
        try {
          await sendTextAsFile(ctx, session.resultText, rt);
        } catch (err) {
          console.error('❌ sendTextAsFile error:', err);
          await sendLongTextAsMessages(ctx, session.resultText, rt);
        }
      }

      // Trim the "long output" message down to a concise delivered note
      try {
        await ctx.telegram.editMessageText(
          session.resultMsgChatId, session.resultMsgId, undefined,
          `${charCount} کاراکتر به روش ${methodName} تحویل داده شد.`
        );
      } catch {}

      session.step = 'ready';
      await maybeWarnLowBalance(ctx);
      return;
    }

  } catch (err) {
    console.error('❌ ERROR in callback:', err);
    try { await ctx.reply('😕 خطا رخ داد. دوباره تلاش کن.'); } catch {}
  }
});

/* ===== 9) Launch ===== */
function launch() {
  bot.launch({ dropPendingUpdates: true })
    .then(() => console.log('✅ Bot started (long polling)'))
    .catch(err => {
      console.error('❌ Bot launch error, retrying in 5s:', err.message);
      setTimeout(launch, 5000);
    });
}
launch();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
