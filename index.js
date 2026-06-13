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

/* ===== 1) Client ===== */
const bot = new Telegraf(BOT_TOKEN);

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

async function convertToMp3(buffer) {
  const id      = Date.now();
  const inPath  = `/tmp/voice_in_${id}.ogg`;
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

async function callOpenRouter(model, audioBuffer, mimeType, prompt) {
  let content;
  if (/audio/i.test(model)) {
    // OpenAI audio models: input_audio format
    let format = 'mp3';
    if (/wav/i.test(mimeType))           format = 'wav';
    else if (/mp3|mpeg/i.test(mimeType)) format = 'mp3';
    content = [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ];
  } else {
    // Gemini: data URL
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

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 402 || /insufficient|credit|quota|payment/i.test(body))
      throw new CreditError(body.slice(0, 200));
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callAI(session, prompt, promptGpt) {
  const { audioBuffer, mimeType } = session;
  let lastErr = null;

  // مرحله ۱: Gemini Flash — تا ۳ بار
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

  // مرحله ۲: GPT Audio Mini — تا ۳ بار (با تبدیل به mp3)
  console.log('↪️ Gemini exhausted, switching to GPT fallback...');
  let mp3Buffer;
  try { mp3Buffer = await convertToMp3(audioBuffer); }
  catch (e) {
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

  // همه تلاش‌ها شکست خوردند
  throw new Error(`ALL_FAILED:${lastErr?.message || 'unknown'}`);
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
    try { await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, '😕 خطا در دریافت فایل. دوباره امتحان کن.'); } catch {}
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

      const prompt    = PROMPT_MAP[type]     || PROMPT_MAP.full;
      const promptGpt = PROMPT_MAP_GPT[type] || PROMPT_MAP_GPT.full;

      await ctx.answerCbQuery('در حال پردازش...');
      const waiting = await ctx.reply('⏳ در حال پردازش...');

      let text;
      try {
        text = await callAI(session, prompt, promptGpt) || 'متنی برنگشت.';
      } catch (err) {
        console.error('❌ All AI attempts failed:', err);
        let errMsg = '😕 پردازش ناموفق بود. دوباره تلاش کن.';
        if (err instanceof CreditError) {
          errMsg = '💳 اعتبار OpenRouter تمام شده است. لطفاً حساب را شارژ کنید.';
        } else if ((err.message||'').includes('ALL_FAILED')) {
          errMsg = '😕 هر دو مدل (Gemini و GPT) پاسخ ندادند. احتمالاً مشکل موقت است — چند دقیقه دیگر دوباره امتحان کن.';
        } else if ((err.message||'').includes('تبدیل فایل')) {
          errMsg = '😕 خطا در تبدیل فایل صوتی. لطفاً مجدداً ویس بفرست.';
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
