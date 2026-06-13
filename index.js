// index.js — Telegram voice → choose process type → choose model → transcribe (VPS / Long Polling)
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

// فقط این کاربر اجازهٔ استفاده دارد
const ALLOWED_USER_ID = 100257975;

/* ===== 1) Client ===== */
const bot = new Telegraf(BOT_TOKEN);

// محدودسازی به یک کاربر مشخص
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
    return; // ادامه نده
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

/* ===== 4) Maps ===== */
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

/* ===== 5) AI via OpenRouter ===== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PRIMARY_RETRIES = 3;
const RETRY_DELAY     = 15_000;            // ۱۵ ثانیه بین تلاش‌ها
const FALLBACK_MODEL  = 'openai/gpt-audio-mini';
const FORCE_FALLBACK  = process.env.FORCE_FALLBACK === '1'; // برای تست: مستقیم برو سراغ فالبک

// خطای مربوط به تمام شدن اعتبار / محدودیت پرداخت
class CreditError extends Error {
  constructor(msg) { super(msg); this.name = 'CreditError'; }
}

// تبدیل ogg/opus به mp3 با ffmpeg برای مدل‌هایی که ogg نمی‌پذیرند
async function convertToMp3(buffer) {
  const id    = Date.now();
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

function buildContent(model, audioBuffer, mimeType, prompt) {
  // مدل‌های صوتی OpenAI از input_audio استفاده می‌کنند
  if (/audio/i.test(model)) {
    let format = 'mp3';
    if (/ogg|opus/i.test(mimeType))      format = 'ogg';
    else if (/wav/i.test(mimeType))      format = 'wav';
    else if (/mp3|mpeg/i.test(mimeType)) format = 'mp3';
    return [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
    ];
  }
  // مدل‌های Gemini از طریق data URL
  const dataUrl = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;
  return [
    { type: 'image_url', image_url: { url: dataUrl } },
    { type: 'text', text: prompt },
  ];
}

async function callOpenRouter(model, audioBuffer, mimeType, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildContent(model, audioBuffer, mimeType, prompt) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 402 = اعتبار ناکافی در OpenRouter
    if (res.status === 402 || /insufficient|credit|quota|payment/i.test(body)) {
      throw new CreditError(body.slice(0, 300));
    }
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callAI(modelKey, session, prompt) {
  const primaryModel = OPENROUTER_MODEL_MAP[modelKey] || OPENROUTER_MODEL_MAP.flash;

  // مدل اصلی: تا ۳ بار با فاصلهٔ ۱۵ ثانیه (در حالت تست رد می‌شود)
  if (!FORCE_FALLBACK) {
    for (let i = 0; i < PRIMARY_RETRIES; i++) {
      if (i > 0) await sleep(RETRY_DELAY);
      try {
        const out = await callOpenRouter(primaryModel, session.audioBuffer, session.mimeType, prompt);
        if (out) return out;
        throw new Error('Empty response');
      } catch (err) {
        if (err instanceof CreditError) throw err; // شارژ تمام شده → retry بی‌فایده است
        console.error(`❌ Primary (${primaryModel}) attempt ${i+1}/${PRIMARY_RETRIES}:`, (err.message||'').slice(0,150));
      }
    }
  }

  // فالبک: gpt-audio-mini فقط یک بار (با تبدیل ogg→mp3)
  console.log(`↪️ Fallback to ${FALLBACK_MODEL}...`);
  try {
    const mp3Buffer = await convertToMp3(session.audioBuffer);
    const out = await callOpenRouter(FALLBACK_MODEL, mp3Buffer, 'audio/mpeg', prompt);
    if (out) return out;
    throw new Error('Empty response');
  } catch (err) {
    if (err instanceof CreditError) throw err;
    console.error(`❌ Fallback (${FALLBACK_MODEL}) failed:`, (err.message||'').slice(0,150));
    throw new Error('ALL_FAILED');
  }
}

// موجودی OpenRouter را برمی‌گرداند (دلار) یا null
async function getOpenRouterBalance() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) return null;
    const data  = await res.json();
    const total = data?.data?.total_credits;
    const used  = data?.data?.total_usage;
    if (typeof total !== 'number' || typeof used !== 'number') return null;
    return total - used;
  } catch { return null; }
}

// اگر موجودی زیر ۱ دلار باشد هشدار می‌دهد
async function maybeWarnLowBalance(ctx) {
  const bal = await getOpenRouterBalance();
  if (bal !== null && bal < 1) {
    try {
      await ctx.reply(`⚠️ شارژ OpenRouter زیر ۱ دلار است (حدود $${bal.toFixed(2)}). احتمال تمام شدن شارژ وجود دارد — لطفاً شارژ کنید.`);
    } catch {}
  }
}

/* ===== 6) Keyboards ===== */
function createProcessTypeKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 متن کامل',        `ptype:full:${token}`)],
    [Markup.button.callback('✂️ متن مفید',         `ptype:clean:${token}`)],
    [Markup.button.callback('📌 خلاصه تیتر‌وار',  `ptype:summary:${token}`)],
    [Markup.button.callback('🚫 منصرف شدم',        `cancel:${token}`)],
  ]);
}

function createModelKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Gemini Flash',      `model:flash:${token}`)],
    [Markup.button.callback('Gemini Flash Lite', `model:flashlite:${token}`)],
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

/* ===== 7) Bot handlers ===== */
bot.start((ctx) => ctx.reply('سلام! یک ویس بفرست. 🎤'));

bot.on(['voice', 'audio'], async (ctx) => {
  const thinking = await ctx.reply('⏳ دریافت فایل...');
  try {
    // sessions قبلی همین کاربر را پاک کن
    const userId = ctx.from.id;
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
      step:            'await_process_type',
      mimeType,
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

    // Step 1: process type
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

    // Step 2: model
    const m = data.match(/^model:(flash|flashlite):([a-z0-9]+)$/i);
    if (m) {
      const [, key, token] = m;
      const modelKey = key.toLowerCase();
      const session  = sessions.get(token);
      if (!session) return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');

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
        text = await callAI(modelKey, session, prompt) || 'متنی برنگشت.';
      } catch (err) {
        console.error('❌ All AI attempts failed:', err);
        const errMsg = err instanceof CreditError
          ? '😕 اعتبار OpenRouter تمام شده یا به محدودیت پرداخت رسیده‌اید. لطفاً حساب OpenRouter را شارژ کنید.'
          : '😕 خطا در پردازش هوش مصنوعی. دوباره امتحان کن.';
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, errMsg); } catch {}
        return;
      }

      const parts = splitForTelegram(text);

      if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
        try { await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, parts[0] || 'متنی برنگشت.'); } catch {}

        session.step        = 'ready';
        session.processType = null;
        await maybeWarnLowBalance(ctx);
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

      }
      return;
    }

    // Step 3: output format for long text
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
      await maybeWarnLowBalance(ctx);
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
