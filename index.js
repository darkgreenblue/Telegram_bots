// index.js — Telegram voice → choose process type → choose model → transcribe (Long Polling)
import 'dotenv/config';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from '@google/genai';

/* ===== 0) ENV ===== */
const BOT_TOKEN          = process.env.BOT_TOKEN?.trim();
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY?.trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!BOT_TOKEN)      { console.error('❌ BOT_TOKEN خالی است');      process.exit(1); }
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY خالی است'); process.exit(1); }

/* ===== 1) Clients ===== */
const bot = new Telegraf(BOT_TOKEN);
const ai  = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/* ===== 2) Usage counters (daily by PT) ===== */
const PT_TZ      = 'America/Los_Angeles';
const USAGE_FILE = '/tmp/usage.json';
const FREE_QUOTAS = { flash: 250, flashlite: 1000 };

function todayPT() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PT_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p=>p.type==='year').value;
  const m = parts.find(p=>p.type==='month').value;
  const d = parts.find(p=>p.type==='day').value;
  return `${y}-${m}-${d}`;
}
function atomicSave(path, data) {
  const tmp = path + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path);
}
function loadUsage() {
  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf8');
    const u = JSON.parse(raw);
    return u?.byDate ? u : { byDate: {} };
  } catch { return { byDate: {} }; }
}
let USAGE = loadUsage();
function used(key, date=todayPT())      { return USAGE.byDate?.[date]?.[key] || 0; }
function remaining(key, date=todayPT()) { return Math.max(0, (FREE_QUOTAS[key] ?? 0) - used(key, date)); }
function inc(key, date=todayPT()) {
  if (!USAGE.byDate[date]) USAGE.byDate[date] = { flash: 0, flashlite: 0 };
  USAGE.byDate[date][key] = (USAGE.byDate[date][key] || 0) + 1;
  atomicSave(USAGE_FILE, JSON.stringify(USAGE));
}

/* ===== 3) Session store ===== */
const sessions = new Map();
function makeToken() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }

setInterval(() => {
  const now = Date.now();
  for (const [k,v] of sessions) {
    if (now - v.createdAt > 2*60*60*1000) sessions.delete(k);
  }
}, 30*60*1000);

/* ===== 4) Maps ===== */
const MODEL_MAP = {
  flash:     'gemini-2.5-flash',
  flashlite: 'gemini-2.5-flash-lite',
};

const OPENROUTER_MODEL_MAP = {
  flash:     'google/gemini-2.5-flash',
  flashlite: 'google/gemini-2.5-flash-lite-preview',
};

const PROMPT_MAP = {
  full: `Transcribe the entire speech exactly as spoken, in the same language, with proper punctuation.

Speaker detection rules (apply strictly):
- If there is only ONE speaker: return the transcript as plain continuous text. Do NOT include any speaker labels, names, or identifiers whatsoever.
- If there are MULTIPLE speakers:
  - First check whether any speaker's name or identity is clearly inferable from the conversation itself (e.g., participants address each other by name). If so, use those real names as labels.
  - If names cannot be determined from context, label speakers as "شخص ۱", "شخص ۲", etc.
  - Start a new line for each speaker change, with the label followed by a colon, then their speech.

Do not add any commentary, notes, or text outside of the transcript itself.`,

  clean: `Transcribe the speech into a clean, fluent text in the same language. Preserve all meaningful content and the original tone, but remove filler words, repetitions, hesitations, and unnecessary digressions.

Speaker detection rules (apply strictly):
- If there is only ONE speaker: return the cleaned text as plain continuous prose. Do NOT include any speaker labels, names, or identifiers whatsoever.
- If there are MULTIPLE speakers:
  - First check whether any speaker's name or identity is clearly inferable from the conversation (e.g., they address each other by name). If so, use those real names as labels.
  - If names cannot be determined from context, label speakers as "شخص ۱", "شخص ۲", etc.
  - Start a new paragraph for each speaker change, with the label followed by a colon, then their cleaned speech.`,

  summary: `Analyze the speech and produce a very short bullet-point summary in the same language.

Speaker detection rules (apply strictly):
- If there is only ONE speaker: write the summary with no speaker references at all.
- If there are MULTIPLE speakers:
  - First check whether any speaker's name or identity is clearly inferable from the conversation. If so, use those real names.
  - Otherwise label speakers as "شخص ۱", "شخص ۲", etc.
  - Mention the relevant speaker in parentheses after each topic point if applicable.

Format:
- Start with exactly: "📌 محتوای این وویس:"
- List 3–5 main topics, each on its own line starting with a relevant emoji (🔹, 🔸, 🟢, etc.) followed by the topic title.
- Optionally add a very short sub-point on the next line starting with "   ↳" (one short sentence max).
- Keep it concise — main topics should be clear at first glance.`,
};

const TELEGRAM_MESSAGE_LIMIT = 4000;

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

/* ===== 5) AI: retry + OpenRouter fallback ===== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGemini(modelKey, uri, mimeType, prompt) {
  const result = await ai.models.generateContent({
    model: MODEL_MAP[modelKey],
    contents: createUserContent([
      createPartFromUri(uri, mimeType),
      prompt,
    ]),
  });
  return result.text?.trim() || '';
}

async function callOpenRouter(modelKey, audioBuffer, mimeType, prompt) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
  const model   = OPENROUTER_MODEL_MAP[modelKey] || OPENROUTER_MODEL_MAP.flash;
  const dataUrl = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callWithRetryAndFallback(modelKey, session, prompt) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 15_000;

  let lastErr;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) await sleep(RETRY_DELAY);
    try {
      return await callGemini(modelKey, session.uri, session.mimeType, prompt);
    } catch (err) {
      console.error(`❌ Gemini attempt ${i+1}/${MAX_RETRIES}:`, err.message);
      lastErr = err;
    }
  }

  console.log('↪️ Switching to OpenRouter fallback...');
  return await callOpenRouter(modelKey, session.audioBuffer, session.mimeType, prompt);
}

/* ===== 6) Keyboards ===== */
function createProcessTypeKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 متن کامل',       `ptype:full:${token}`)],
    [Markup.button.callback('✂️ متن مفید',        `ptype:clean:${token}`)],
    [Markup.button.callback('📌 خلاصه تیتر‌وار', `ptype:summary:${token}`)],
    [Markup.button.callback('🚫 منصرف شدم',       `cancel:${token}`)],
  ]);
}

function createModelKeyboard(token) {
  const btnFlash = remaining('flash') > 0
    ? Markup.button.callback('Gemini Flash',      `model:flash:${token}`)
    : Markup.button.callback('Gemini Flash — تکمیل', `noop:${token}`);
  const btnLite  = remaining('flashlite') > 0
    ? Markup.button.callback('Gemini Flash Lite', `model:flashlite:${token}`)
    : Markup.button.callback('Gemini Flash Lite — تکمیل', `noop:${token}`);

  return Markup.inlineKeyboard([
    [btnFlash],
    [btnLite],
    [Markup.button.callback('🚫 منصرف شدم', `cancel:${token}`)],
  ]);
}

function createOutputFormatKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📨 چند پیام جداگانه',    `output:messages:${token}`)],
    [Markup.button.callback('📎 دانلود به صورت فایل', `output:file:${token}`)],
    [Markup.button.callback('🚫 انصراف',              `cancel:${token}`)],
  ]);
}

function createContinueKeyboard(token) {
  return {
    reply_markup: {
      inline_keyboard: [
        ...createProcessTypeKeyboard(token).reply_markup.inline_keyboard.slice(0, -1),
        ...createModelKeyboard(token).reply_markup.inline_keyboard.slice(0, -1),
        [Markup.button.callback('🚫 پایان کار', `cancel:${token}`)],
      ],
    },
  };
}

async function sendContinueGuide(ctx, token) {
  try {
    await ctx.reply(
      '✨ برای دریافت خروجی‌های مختلف از همین ویس، روی دکمه‌های بالا کلیک کن!\n🎤 برای ویس جدید، فایل صوتی بفرست.',
      createContinueKeyboard(token)
    );
  } catch (err) {
    console.error('❌ sendContinueGuide (non-critical):', err);
  }
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

/* ===== 7) Bot handlers ===== */
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
    const fileUrl    = await ctx.telegram.getFileLink(media.file_id);
    const res        = await fetch(fileUrl.href);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());

    let mimeType    = 'audio/ogg';
    if (msg.audio?.mime_type) mimeType = msg.audio.mime_type;
    const blob        = new Blob([audioBuffer], { type: mimeType });
    const displayName = msg.voice ? 'voice.ogg' : (msg.audio?.file_name || 'audio');
    const uploadedAny = await ai.files.upload({ file: blob, config: { mimeType, displayName } });
    const uploaded    = uploadedAny.file ?? uploadedAny;
    if (!uploaded?.uri) throw new Error('No uploaded.uri');

    const token = makeToken();
    sessions.set(token, {
      step:            'await_process_type',
      uri:             uploaded.uri,
      mimeType:        uploaded.mimeType || mimeType,
      audioBuffer,
      chatId:          thinking.chat.id,
      promptMsgId:     thinking.message_id,
      userId,
      createdAt:       Date.now(),
      lastProcessType: null,
    });

    await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, 'چطور میخوای متن پردازش بشه؟');
    await ctx.reply('یکی از حالت‌های زیر رو انتخاب کن:', createProcessTypeKeyboard(token));
  } catch (err) {
    console.error('❌ ERROR on voice:', err);
    try { await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, '😕 خطا در پردازش. دوباره امتحان کن.'); } catch {}
  }
});

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';

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

    if (/^noop:/.test(data)) {
      return ctx.answerCbQuery('سهمیهٔ رایگان امروز این مدل تمام شده است.', { show_alert: true });
    }

    const p = data.match(/^ptype:(full|clean|summary):([a-z0-9]+)$/i);
    if (p) {
      const [, type, token] = p;
      const session = sessions.get(token);
      if (!session) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');

      session.processType     = type;
      session.lastProcessType = type;
      session.step            = 'await_model';

      await ctx.answerCbQuery(`حالت "${type}" انتخاب شد`);
      await ctx.reply('با کدوم مدل پردازش کنم؟', createModelKeyboard(token));
      return;
    }

    const m = data.match(/^model:(flash|flashlite):([a-z0-9]+)$/i);
    if (m) {
      const [, key, token] = m;
      const modelKey = key.toLowerCase();
      const session  = sessions.get(token);
      if (!session) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      if (remaining(modelKey) <= 0) return ctx.answerCbQuery('سهمیهٔ امروز این مدل تمام شده است.', { show_alert: true });

      const processType = session.processType || session.lastProcessType || 'full';
      if (!processType) {
        session.step = 'await_process_type';
        await ctx.answerCbQuery('لطفاً ابتدا حالت پردازش را انتخاب کنید.');
        await ctx.reply('یکی از حالت‌های زیر رو انتخاب کن:', createProcessTypeKeyboard(token));
        return;
      }

      const prompt  = PROMPT_MAP[processType] || PROMPT_MAP.full;
      await ctx.answerCbQuery('در حال پردازش...');
      const waiting = await ctx.reply('⏳ در حال پردازش...');

      let text;
      try {
        text = await callWithRetryAndFallback(modelKey, session, prompt) || 'متنی برنگشت.';
      } catch (err) {
        console.error('❌ All AI attempts failed:', err);
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, '😕 خطا در پردازش هوش مصنوعی. دوباره امتحان کن.'); } catch {}
        return;
      }

      const parts = splitForTelegram(text);

      if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, parts[0] || 'متنی برنگشت.'); } catch {}
        inc(modelKey);
        session.step        = 'ready';
        session.processType = null;
        await sendContinueGuide(ctx, token);
      } else {
        session.resultText  = text;
        session.step        = 'await_output_format';
        try {
          await ctx.telegram.editMessageText(
            waiting.chat.id, waiting.message_id, undefined,
            `📏 خروجی طولانی است (${text.length.toLocaleString('fa-IR')} کاراکتر).\n\nچطور میخوای دریافتش کنی؟`
          );
        } catch {}
        await ctx.reply('یکی از گزینه‌های زیر رو انتخاب کن:', createOutputFormatKeyboard(token));
        inc(modelKey);
      }
      return;
    }

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

      session.step        = 'ready';
      session.processType = null;
      await sendContinueGuide(ctx, token);
      return;
    }

  } catch (err) {
    console.error('❌ ERROR in callback:', err);
    try { await ctx.reply('😕 خطا رخ داد. دوباره تلاش کن.'); } catch {}
  }
});

/* ===== 8) Launch (Long Polling) ===== */
bot.launch()
  .then(() => console.log('✅ Bot started (long polling)'))
  .catch(err => { console.error('❌ Bot launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
