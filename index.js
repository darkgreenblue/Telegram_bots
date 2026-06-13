// index.js — Telegram voice → choose process type → transcribe (VPS / Long Polling)
import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { Telegraf, Markup } from 'telegraf';

const execFileAsync = promisify(execFile);

/* ===== 0) ENV ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)          { console.error('❌ BOT_TOKEN خالی است');          process.exit(1); }
if (!OPENROUTER_API_KEY) { console.error('❌ OPENROUTER_API_KEY خالی است'); process.exit(1); }

const ALLOWED_USER_ID = 100257975;

// اگر سرور محلی Bot API بالا باشد، آدرسش را اینجا می‌دهیم تا سقف دانلود از ۲۰مگ به ۲گیگ برسد.
const TELEGRAM_API_ROOT = process.env.TELEGRAM_API_ROOT?.trim();

/* ===== 1) Client ===== */
const bot = new Telegraf(
  BOT_TOKEN,
  TELEGRAM_API_ROOT ? { telegram: { apiRoot: TELEGRAM_API_ROOT } } : undefined
);
if (TELEGRAM_API_ROOT) console.log(`🔗 Local Bot API server: ${TELEGRAM_API_ROOT}`);

bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (uid && uid !== ALLOWED_USER_ID) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🔒 این ربات شخصی است.', { show_alert: true });
      } else {
        await ctx.reply(
          '🔒 این یک ربات شخصی است و امکان استفاده عمومی فعلاً وجود ندارد.\n\n' +
          'برای دریافت شرایط استفاده به آیدی @alireza_oliya پیام دهید.'
        );
      }
    } catch {}
    return;
  }
  return next();
});

/* ===== 2) Session store ===== */
const sessions = new Map();
function makeToken() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }

setInterval(() => {
  const now = Date.now();
  for (const [k,v] of sessions) {
    if (now - v.createdAt > 2*60*60*1000) sessions.delete(k);
  }
}, 30*60*1000);

/* ===== 3) Models ===== */
const GEMINI_MODEL  = 'google/gemini-2.5-flash';
const GPT_MODEL     = 'openai/gpt-audio-mini';
const RETRIES       = 3;
const RETRY_DELAY   = 10_000; // ۱۰ ثانیه

/* ===== 4) Prompts ===== */
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

// پرامپت‌های مخصوص GPT — با تأکید صریح برای جلوگیری از روایت‌گری
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

/* ===== 5) Helpers ===== */
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

/* ===== 6) AI ===== */
class CreditError extends Error {
  constructor(msg) { super(msg); this.name = 'CreditError'; }
}

// تنظیمات تیکه‌تیکه کردن صوت طولانی
const CHUNK_THRESHOLD_SEC = 20 * 60;        // بالاتر از ۲۰ دقیقه → تقسیم می‌شود
const CHUNK_SEC           = 15 * 60;        // هر تیکه ۱۵ دقیقه (~۷مگ mp3)
const SIZE_THRESHOLD      = 18 * 1024 * 1024; // اگر مدت نامشخص بود، مرز حجمی
const TEXTPASS_MODEL      = GEMINI_MODEL;

const toFa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

// تبدیل خطای HTTP به خطای معنی‌دار (اعتبار / محدودیت نرخ / عمومی)
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

// مدت صوت بر حسب ثانیه (با ffprobe). اگر نشد، null.
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

// تقسیم صوت به تیکه‌های mp3 برابر segmentSec ثانیه
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

// فراخوانی مدل صوتی OpenRouter (Gemini با data URL، مدل‌های audio با input_audio)
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

// فراخوانی متنی OpenRouter (برای پاس نهایی روی متن پیاده‌شده)
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

// متن‌کردن یک تیکه صوت: ۳ بار Gemini، بعد ۳ بار GPT (با تبدیل به mp3 اگر لازم بود)
async function transcribeSingle(audioBuffer, mimeType, prompt, promptGpt) {
  let lastErr = null;

  for (let i = 0; i < RETRIES; i++) {
    if (i > 0) await sleep(RETRY_DELAY);
    try {
      const out = await callOpenRouter(GEMINI_MODEL, audioBuffer, mimeType, prompt);
      if (out) return out;
    } catch (err) {
      if (err instanceof CreditError) throw err;
      lastErr = err;
      console.error(`❌ Gemini attempt ${i+1}/${RETRIES}:`, (err.message||'').slice(0,150));
    }
  }

  console.log('↪️ Gemini exhausted, switching to GPT fallback...');
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

// پاس متنی نهایی روی متن کامل (برای clean/summary/meeting در صوت‌های طولانی)
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

// نقطه ورود اصلی: تصمیم بین مسیر کوتاه و مسیر تیکه‌تیکه
async function callAI(session, type, onProgress) {
  const { audioBuffer, mimeType } = session;
  const prompt    = PROMPT_MAP[type]     || PROMPT_MAP.full;
  const promptGpt = PROMPT_MAP_GPT[type] || PROMPT_MAP_GPT.full;

  const durationSec = await getAudioDurationSec(audioBuffer);
  const isLong = (durationSec && durationSec > CHUNK_THRESHOLD_SEC)
              || (!durationSec && audioBuffer.length > SIZE_THRESHOLD);

  // مسیر کوتاه: یک‌جا
  if (!isLong) {
    return await transcribeSingle(audioBuffer, mimeType, prompt, promptGpt);
  }

  // مسیر طولانی: تقسیم → متن هر تیکه → چسباندن
  if (onProgress) await onProgress('🔪 فایل طولانی است؛ در حال تقسیم به بخش‌های کوچک‌تر...');
  let chunks = [];
  try { chunks = await splitAudioToMp3Chunks(audioBuffer, CHUNK_SEC); }
  catch (e) { console.error('❌ split failed:', e.message); }

  if (chunks.length <= 1) {
    // تقسیم نشد یا فقط یک تیکه شد → همان مسیر معمولی
    return await transcribeSingle(audioBuffer, mimeType, prompt, promptGpt);
  }

  const transcripts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) await onProgress(`🎧 در حال پردازش بخش ${toFa(i+1)} از ${toFa(chunks.length)}...`);
    const part = await transcribeSingle(chunks[i], 'audio/mpeg', PROMPT_MAP.full, PROMPT_MAP_GPT.full);
    transcripts.push(part || '');
  }
  const fullText = transcripts.join('\n').trim();

  // متن کامل همینه؛ برای بقیه حالت‌ها یک پاس متنی نهایی می‌زنیم
  if (type === 'full') return fullText;

  if (onProgress) await onProgress('🧠 در حال جمع‌بندی نهایی...');
  try {
    const out = await textPass(type, fullText);
    if (out) return out;
  } catch (e) {
    console.error('❌ textPass failed:', e.message);
  }
  // اگر جمع‌بندی نشد، حداقل متن کامل را تحویل بده
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
      await ctx.reply(`⚠️ شارژ OpenRouter زیر ۱ دلار است (حدود $${bal.toFixed(2)}). احتمال تمام شدن شارژ وجود دارد — لطفاً شارژ کنید.`);
    } catch {}
  }
}

/* ===== 7) Keyboards ===== */
function createProcessTypeKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 متن کامل',       `ptype:full:${token}`)],
    [Markup.button.callback('✂️ متن مفید',        `ptype:clean:${token}`)],
    [Markup.button.callback('📌 خلاصه تیتروار',  `ptype:summary:${token}`)],
    [Markup.button.callback('📋 صورت جلسه',       `ptype:meeting:${token}`)],
    [Markup.button.callback('🚫 منصرف شدم',       `cancel:${token}`)],
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

/* ===== 8) Bot handlers ===== */
bot.start((ctx) => ctx.reply('سلام! یک ویس بفرست. 🎤'));

bot.on(['voice', 'audio'], async (ctx) => {
  const thinking = await ctx.reply('⏳ دریافت فایل...');
  try {
    const userId = ctx.from.id;
    for (const [tk, s] of sessions) {
      if (s.userId === userId) sessions.delete(tk);
    }

    const msg   = ctx.message;
    const media = msg.voice || msg.audio;
    const fileUrl     = await ctx.telegram.getFileLink(media.file_id);
    const res         = await fetch(fileUrl.href);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());

    let mimeType = 'audio/ogg';
    if (msg.audio?.mime_type) mimeType = msg.audio.mime_type;

    const token = makeToken();
    sessions.set(token, {
      step:        'await_process_type',
      mimeType,
      audioBuffer,
      chatId:      thinking.chat.id,
      promptMsgId: thinking.message_id,
      userId,
      createdAt:   Date.now(),
    });

    await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, 'چطور میخوای متن پردازش بشه؟');
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

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';

    // Cancel
    const c = data.match(/^cancel:([a-z0-9]+)$/i);
    if (c) {
      const [, token] = c;
      const session   = sessions.get(token);
      await ctx.answerCbQuery('لغو شد');
      try { await ctx.editMessageText('لغو شد ✅'); } catch {}
      if (session) {
        try { await ctx.telegram.editMessageText(session.chatId, session.promptMsgId, undefined, 'لغو شد ✅'); } catch {}
        sessions.delete(token);
      }
      return;
    }

    // Process type → مستقیم شروع پردازش
    const p = data.match(/^ptype:(full|clean|summary|meeting):([a-z0-9]+)$/i);
    if (p) {
      const [, type, token] = p;
      const session = sessions.get(token);
      if (!session) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');

      await ctx.answerCbQuery('در حال پردازش...');
      const waiting = await ctx.reply('⏳ در حال پردازش...');

      // به‌روزرسانی پیام وضعیت در حین پردازش (مخصوص فایل‌های طولانی)
      let lastProgress = '';
      const onProgress = async (msg) => {
        if (msg === lastProgress) return;
        lastProgress = msg;
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, msg); } catch {}
      };

      let text;
      try {
        text = await callAI(session, type, onProgress) || 'متنی برنگشت.';
      } catch (err) {
        console.error('❌ All AI attempts failed:', err);
        const m = err.message || '';
        let errMsg = '😕 پردازش ناموفق بود. دوباره تلاش کن.';
        if (err instanceof CreditError) {
          errMsg = '💳 اعتبار OpenRouter تمام شده است. لطفاً حساب را شارژ کنید.';
        } else if (/RATE_LIMIT/.test(m)) {
          errMsg = '⏳ سرویس موقتاً به محدودیت نرخ (rate limit) خورده است.\nچند دقیقه دیگر دوباره امتحان کن.';
        } else if (m.includes('تبدیل فایل')) {
          errMsg = '😕 خطا در تبدیل فایل صوتی. لطفاً مجدداً ویس بفرست.';
        } else if (m.includes('ALL_FAILED')) {
          errMsg = '😕 هر دو مدل (Gemini و GPT) پاسخ ندادند. احتمالاً مشکل موقت است — چند دقیقه دیگر دوباره امتحان کن.';
        }
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, errMsg); } catch {}
        return;
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

    // Output format for long text
    const o = data.match(/^output:(messages|file):([a-z0-9]+)$/i);
    if (o) {
      const [, format, token] = o;
      const session = sessions.get(token);
      if (!session?.resultText) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');

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

/* ===== 9) Launch (Long Polling) ===== */
bot.launch()
  .then(() => console.log('✅ Bot started (long polling)'))
  .catch(err => { console.error('❌ Bot launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
