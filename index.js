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
  'google/gemini-2.5-flash-lite-preview': { label: '⚡ Flash‑Lite', price: 500,  fallback: true,  usdPerMin: 0.0003 },
  'google/gemini-2.5-flash':              { label: '🔥 Flash',      price: 1000, fallback: true,  usdPerMin: 0.0007 },
  'google/gemini-2.5-pro':               { label: '💎 Pro',         price: 2000, fallback: false, usdPerMin: 0.0040 },
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const CHUNK_THRESHOLD_SEC = 20 * 60;
const CHUNK_SEC           = 15 * 60;
const SIZE_THRESHOLD      = 18 * 1024 * 1024;
const TEXTPASS_MODEL      = DEFAULT_MODEL;

const toFa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

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

async function getAudioDurationSec(buffer) {
  const id = Date.now();
  const p  = `/tmp/v_dur_${id}`;
  writeFileSync(p, buffer);
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', p,
    ]);
    const d = parseFloat((stdout || '').trim());
    return Number.isFinite(d) ? d : null;
  } catch { return null; }
  finally { try { unlinkSync(p); } catch {} }
}

async function splitAudioToMp3Chunks(buffer, segmentSec) {
  const id      = Date.now();
  const inPath  = `/tmp/v_in_${id}`;
  const pattern = `/tmp/v_seg_${id}_%03d.mp3`;
  writeFileSync(inPath, buffer);
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', inPath, '-ar', '16000', '-ac', '1', '-b:a', '64k',
      '-f', 'segment', '-segment_time', String(segmentSec), pattern,
    ]);
    const chunks = [];
    for (let i = 0; ; i++) {
      const p = `/tmp/v_seg_${id}_${String(i).padStart(3, '0')}.mp3`;
      let buf;
      try { buf = readFileSync(p); } catch { break; }
      chunks.push(buf);
      try { unlinkSync(p); } catch {}
    }
    return chunks;
  } finally {
    try { unlinkSync(inPath); } catch {}
  }
}

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
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throwForStatus(res.status, await res.text());
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callOpenRouterText(model, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throwForStatus(res.status, await res.text());
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
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

async function textPass(type, transcript) {
  const base = PROMPT_MAP[type] || PROMPT_MAP.summary;
  const prompt =
    `You are given the RAW TEXT TRANSCRIPT of an audio recording (possibly long and multi-speaker). ` +
    `Treat this transcript as the "speech"/"audio" referred to in the task below. ` +
    `Apply the task using ONLY the transcript content; do not invent anything.\n\n` +
    `TASK:\n${base}\n\n--- TRANSCRIPT START ---\n${transcript}\n--- TRANSCRIPT END ---`;
  let lastErr = null;
  for (let i = 0; i < RETRIES; i++) {
    if (i > 0) await sleep(RETRY_DELAY);
    try {
      const out = await callOpenRouterText(TEXTPASS_MODEL, prompt);
      if (out) return out;
    } catch (err) {
      if (err instanceof CreditError) throw err;
      lastErr = err;
      console.error(`❌ textPass attempt ${i+1}/${RETRIES}:`, (err.message||'').slice(0,150));
    }
  }
  throw new Error(`TEXTPASS_FAILED:${lastErr?.message || 'unknown'}`);
}

async function callAI(session, type, onProgress) {
  const { audioBuffer, mimeType, userModel } = session;
  const modelCfg  = MODEL_CONFIG[userModel] || MODEL_CONFIG[DEFAULT_MODEL];
  const prompt    = PROMPT_MAP[type]     || PROMPT_MAP.full;
  const promptGpt = PROMPT_MAP_GPT[type] || PROMPT_MAP_GPT.full;

  const durationSec = await getAudioDurationSec(audioBuffer);
  const isLong = (durationSec && durationSec > CHUNK_THRESHOLD_SEC)
              || (!durationSec && audioBuffer.length > SIZE_THRESHOLD);

  if (!isLong) {
    return await transcribeSingle(audioBuffer, mimeType, prompt, promptGpt, userModel, modelCfg.fallback);
  }

  if (onProgress) await onProgress('🔪 فایل طولانی است؛ در حال تقسیم به بخش‌های کوچک‌تر...');
  let chunks = [];
  try { chunks = await splitAudioToMp3Chunks(audioBuffer, CHUNK_SEC); }
  catch (e) { console.error('❌ split failed:', e.message); }

  if (chunks.length <= 1) {
    return await transcribeSingle(audioBuffer, mimeType, prompt, promptGpt, userModel, modelCfg.fallback);
  }

  const transcripts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) await onProgress(`🎧 در حال پردازش بخش ${toFa(i+1)} از ${toFa(chunks.length)}...`);
    const part = await transcribeSingle(chunks[i], 'audio/mpeg', PROMPT_MAP.full, PROMPT_MAP_GPT.full, userModel, modelCfg.fallback);
    transcripts.push(part || '');
  }
  const fullText = transcripts.join('\n').trim();

  if (type === 'full') return fullText;

  if (onProgress) await onProgress('🧠 در حال جمع‌بندی نهایی...');
  try {
    const out = await textPass(type, fullText);
    if (out) return out;
  } catch (e) {
    console.error('❌ textPass failed:', e.message);
  }
  return `⚠️ جمع‌بندی نهایی انجام نشد؛ متن کامل پیاده‌سازی‌شده در ادامه آمده است:\n\n${fullText}`;
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
  const bal = await getOpenRouterBalance();
  if (bal !== null && bal < 1) {
    try {
      await ctx.reply(`⚠️ شارژ OpenRouter زیر ۱ دلار است (حدود $${bal.toFixed(2)}). لطفاً حساب را شارژ کنید.`);
    } catch {}
  }
}

/* ===== 6) Bot & session ===== */
const bot = new Telegraf(BOT_TOKEN);

const sessions    = new Map(); // token → voice session
const userStates  = new Map(); // userId → { step, paymentId }

function makeToken() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }

setInterval(() => {
  const now = Date.now();
  for (const [k,v] of sessions) {
    if (now - v.createdAt > 2*60*60*1000) sessions.delete(k);
  }
}, 30*60*1000);

/* ===== 7) Keyboards ===== */
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
    [Markup.button.callback('🚫 منصرف شدم',      `cancel:${token}`)],
  ]);
}

function createOutputFormatKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📨 چند پیام جداگانه',    `output:messages:${token}`)],
    [Markup.button.callback('📎 دانلود به صورت فایل', `output:file:${token}`)],
    [Markup.button.callback('🚫 انصراف',              `cancel:${token}`)],
  ]);
}

async function sendLongTextAsMessages(ctx, text) {
  const parts = splitForTelegram(text);
  if (!parts.length) { await ctx.reply('متنی برنگشت.'); return; }
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.length > 1 ? `📄 بخش ${i+1} از ${parts.length}:\n\n` : '';
    await ctx.reply(prefix + parts[i]);
    if (i < parts.length - 1) await sleep(500);
  }
}

async function sendTextAsFile(ctx, text) {
  await ctx.replyWithDocument({
    source:   Buffer.from(text, 'utf-8'),
    filename: `transcript_${Date.now()}.txt`,
  });
}

/* ===== 8) Handlers ===== */

bot.start(async (ctx) => {
  const { isNew } = upsertUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const keyboard  = mainKeyboard(ctx.from.id);
  if (isNew && ctx.from.id !== ADMIN_ID) {
    await ctx.reply(
      `🎉 خوش اومدی!\n\n` +
      `این ربات وویس‌های تلگرامت رو با هوش مصنوعی به متن تبدیل می‌کنه.\n\n` +
      `🎁 به عنوان هدیه خوش‌آمد، ${WELCOME_GIFT.toLocaleString('fa-IR')} تومان به کیف پولت شارژ شد!\n\n` +
      `📋 راهنما:\n` +
      `• یک ویس بفرست تا شروع کنیم 🎤\n` +
      `• با دکمه «🔄 تعویض پردازنده» مدل هوش مصنوعی و نرخ پردازش رو انتخاب کن\n` +
      `• با دکمه «👛 کیف پول» موجودیت رو ببین و شارژ کن`,
      keyboard
    );
  } else {
    await ctx.reply('سلام! یک ویس بفرست. 🎤', keyboard);
  }
});

bot.hears('🔄 تعویض پردازنده', async (ctx) => {
  upsertUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const currentModel = getUserModel(ctx.from.id);
  const buttons = Object.entries(MODEL_CONFIG).map(([id, cfg]) => {
    const tick = id === currentModel ? '✅ ' : '';
    return [Markup.button.callback(
      `${tick}${cfg.label} — ${cfg.price.toLocaleString('fa-IR')} ت/دقیقه`,
      `setmodel:${id}`
    )];
  });
  await ctx.reply(
    '🔄 مدل هوش مصنوعی رو انتخاب کن:\n\n' +
    '⚡ Flash‑Lite — سریع‌ترین، ارزان‌ترین\n' +
    '🔥 Flash — متعادل (پیش‌فرض)\n' +
    '💎 Pro — دقیق‌ترین، بدون GPT fallback',
    Markup.inlineKeyboard(buttons)
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
  const modelCfg   = MODEL_CONFIG[userModel] || MODEL_CONFIG[DEFAULT_MODEL];
  const tgDuration = ctx.message.voice?.duration || ctx.message.audio?.duration || 0;
  const estimatedCost = tgDuration > 0 ? calcCost(tgDuration, userModel) : null;

  // Check balance before downloading (only non-admin)
  if (userId !== ADMIN_ID && estimatedCost !== null && estimatedCost > 0) {
    const balance = getBalance(userId);
    if (balance < estimatedCost) {
      await ctx.reply(
        `👛 موجودی کافی نیست.\n\n` +
        `💰 هزینه پردازش: ${estimatedCost.toLocaleString('fa-IR')} تومان\n` +
        `💳 موجودی: ${balance.toLocaleString('fa-IR')} تومان`,
        Markup.inlineKeyboard([[Markup.button.callback('➕ افزایش موجودی', 'recharge')]])
      );
      return;
    }
  }

  const thinking = await ctx.reply('⏳ دریافت فایل...');
  try {
    // Clear existing sessions for this user
    for (const [tk, s] of sessions) {
      if (s.userId === userId) sessions.delete(tk);
    }

    const msg   = ctx.message;
    const media = msg.voice || msg.audio;

    const fileUrl = await ctx.telegram.getFileLink(media.file_id);
    const res     = await fetch(fileUrl.href);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());

    let mimeType = 'audio/ogg';
    if (msg.audio?.mime_type) mimeType = msg.audio.mime_type;

    const token = makeToken();
    sessions.set(token, {
      step:        'await_process_type',
      mimeType,
      audioBuffer,
      durationSec: tgDuration || null,
      userModel,
      chatId:      thinking.chat.id,
      promptMsgId: thinking.message_id,
      userId,
      createdAt:   Date.now(),
    });

    let costLine = '';
    if (userId === ADMIN_ID) {
      const usd = calcAdminCostUsd(tgDuration, userModel);
      if (usd) costLine = `\n💰 هزینه تخمینی: ${usd}`;
    } else if (estimatedCost) {
      costLine = `\n💰 هزینه پردازش: ${estimatedCost.toLocaleString('fa-IR')} تومان`;
    }

    await ctx.telegram.editMessageText(
      thinking.chat.id, thinking.message_id, undefined,
      `چطور میخوای متن پردازش بشه؟${costLine}`
    );
    await ctx.reply('یکی از حالت‌های زیر رو انتخاب کن:', createProcessTypeKeyboard(token));
  } catch (err) {
    console.error('❌ ERROR on voice:', err);
    let m = '😕 خطا در دریافت فایل. دوباره امتحان کن.';
    if (/too big|file is too big|413|request entity too large/i.test(err.message || '')) {
      m = '😕 حجم فایل بیش از محدودیت ۲۰ مگابایت تلگرام است.\n\n' +
          'پیشنهادات:\n' +
          '• فایل را به چند بخش کوتاه‌تر تقسیم کن\n' +
          '• فرمت را به mp3 تبدیل کن (مثلاً با اپ Audio Converter)\n' +
          '• بیت‌ریت را کاهش بده (۶۴kbps کافی است)\n' +
          '• سرعت پخش را ۲x کن تا حجم نصف شود';
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

  const user = getUser(userId);

  const adminMsg = await ctx.telegram.sendPhoto(ADMIN_ID, fileId, {
    caption:
      `💳 درخواست شارژ جدید\n\n` +
      `👤 ${user?.name || 'نامشخص'} (@${user?.username || '—'})\n` +
      `🆔 آیدی: ${userId}\n` +
      `💰 مبلغ: ${payment.amount.toLocaleString('fa-IR')} تومان\n` +
      `🔢 پرداخت #${state.paymentId}`,
    reply_markup: Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ تایید', `approve:${state.paymentId}`),
        Markup.button.callback('❌ رد',    `reject:${state.paymentId}`),
      ],
    ]).reply_markup,
  });

  stmts.setPaymentReceipt.run(fileId, adminMsg.message_id, 'waiting_review', state.paymentId);
  userStates.delete(userId);

  await ctx.reply(
    '✅ فیش دریافت شد و در انتظار تایید ادمین است.\n' +
    'معمولاً در کمتر از ۲۴ ساعت بررسی می‌شود.'
  );
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state  = userStates.get(userId);
  if (!state) return;

  if (state.step === 'waiting_amount') {
    const raw    = ctx.message.text.trim().replace(/[,،\s]/g, '');
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
      `📸 بعد از واریز، تصویر فیش را در همین چت بفرست.\n` +
      `⏰ مهلت ارسال: ۲۴ ساعت`,
      { parse_mode: 'Markdown' }
    );
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
      try { await ctx.editMessageText('لغو شد ✅'); } catch {}
      if (session) {
        try { await ctx.telegram.editMessageText(session.chatId, session.promptMsgId, undefined, 'لغو شد ✅'); } catch {}
        sessions.delete(c[1]);
      }
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
      try {
        await ctx.editMessageCaption(
          `✅ تایید شد — ${payment.amount.toLocaleString('fa-IR')} تومان`,
          { reply_markup: { inline_keyboard: [] } }
        );
      } catch {}

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
      try {
        await ctx.editMessageCaption(
          `❌ رد شد — ${payment.amount.toLocaleString('fa-IR')} تومان`,
          { reply_markup: { inline_keyboard: [] } }
        );
      } catch {}

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

      // Lock immediately to prevent double-click
      session.step = 'processing';
      // Remove inline keyboard so no second click is possible
      try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}

      const userId    = session.userId;
      const userModel = session.userModel || getUserModel(userId);
      const modelCfg  = MODEL_CONFIG[userModel] || MODEL_CONFIG[DEFAULT_MODEL];

      // Final balance check before processing (non-admin)
      if (userId !== ADMIN_ID && session.durationSec) {
        const cost    = calcCost(session.durationSec, userModel);
        const balance = getBalance(userId);
        if (balance < cost) {
          await ctx.answerCbQuery('موجودی کافی نیست', { show_alert: true });
          await ctx.reply(
            `👛 موجودی کافی نیست.\n\n` +
            `💰 هزینه پردازش: ${cost.toLocaleString('fa-IR')} تومان\n` +
            `💳 موجودی: ${balance.toLocaleString('fa-IR')} تومان`,
            Markup.inlineKeyboard([[Markup.button.callback('➕ افزایش موجودی', 'recharge')]])
          );
          return;
        }
      }

      await ctx.answerCbQuery('در حال پردازش...');
      const waiting = await ctx.reply('⏳ در حال پردازش...');

      let lastProgress = '';
      const onProgress = async (msg) => {
        if (msg === lastProgress) return;
        lastProgress = msg;
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, msg); } catch {}
      };

      let text;
      let success = false;
      try {
        text    = await callAI(session, type, onProgress) || 'متنی برنگشت.';
        success = true;
      } catch (err) {
        console.error('❌ All AI attempts failed:', err);
        // Log failure (no cost)
        stmts.insertUsage.run(userId, userModel, session.durationSec || null, 0, type, 0);

        const m = err.message || '';
        let errMsg = '😕 پردازش ناموفق بود. دوباره تلاش کن.';
        if (err instanceof CreditError) {
          errMsg = '💳 اعتبار OpenRouter تمام شده است. لطفاً حساب را شارژ کنید.';
        } else if (/RATE_LIMIT/.test(m)) {
          errMsg = '⏳ سرویس موقتاً به محدودیت نرخ خورده است.\nچند دقیقه دیگر دوباره امتحان کن.';
        } else if (m.includes('تبدیل فایل')) {
          errMsg = '😕 خطا در تبدیل فایل صوتی. لطفاً مجدداً ویس بفرست.';
        } else if (m.includes('ALL_FAILED')) {
          errMsg = '😕 هیچ مدلی پاسخ نداد. مشکل موقت است — چند دقیقه دیگر امتحان کن.\n(هزینه‌ای کسر نشد)';
        }
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, errMsg); } catch {}
        return;
      }

      // Deduct balance on success (non-admin)
      if (success && userId !== ADMIN_ID && session.durationSec) {
        const cost = calcCost(session.durationSec, userModel);
        if (cost > 0) {
          stmts.deduct.run(cost, userId);
          stmts.insertUsage.run(userId, userModel, session.durationSec, cost, type, 1);
        }
      } else if (success) {
        stmts.insertUsage.run(userId, userModel, session.durationSec || null, 0, type, 1);
      }

      const parts = splitForTelegram(text);
      if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, parts[0] || 'متنی برنگشت.'); } catch {}
        session.step = 'ready';
        await maybeWarnLowBalance(ctx);
      } else {
        session.resultText = text;
        session.step       = 'await_output_format';
        try {
          await ctx.telegram.editMessageText(
            waiting.chat.id, waiting.message_id, undefined,
            `📏 خروجی طولانی است (${text.length.toLocaleString('fa-IR')} کاراکتر).\n\nچطور میخوای دریافتش کنی؟`
          );
        } catch {}
        await ctx.reply('یکی از گزینه‌های زیر رو انتخاب کن:', createOutputFormatKeyboard(token));
      }
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
      try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}

      if (format === 'messages') {
        await ctx.answerCbQuery('در حال ارسال پیام‌ها...');
        await sendLongTextAsMessages(ctx, session.resultText);
        await ctx.reply('✅ تمام بخش‌ها ارسال شد.');
      } else {
        await ctx.answerCbQuery('در حال آماده‌سازی فایل...');
        try {
          await sendTextAsFile(ctx, session.resultText);
        } catch (err) {
          console.error('❌ sendTextAsFile error:', err);
          await sendLongTextAsMessages(ctx, session.resultText);
        }
      }
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
bot.launch()
  .then(() => console.log('✅ Bot started (long polling)'))
  .catch(err => { console.error('❌ Bot launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
