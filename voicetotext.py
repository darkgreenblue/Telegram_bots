// index.js — Telegram voice → choose process type → choose model → transcribe (Cloud Run / Webhook)
import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from '@google/genai';

/* ===== 0) ENV ===== */
const BOT_TOKEN = process.env.BOT_TOKEN?.trim();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const WH_SECRET = process.env.WH_SECRET?.trim(); // برای اعتبارسنجی وبهوک
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN خالی است'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY خالی است'); process.exit(1); }

/* ===== 1) Clients ===== */
const bot = new Telegraf(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/* ===== 2) Usage counters (daily by PT) =====
   نکته: در Cloud Run نوشتن فقط در /tmp مجاز و پایدار تا پایان کانتینر است.
*/
const PT_TZ = 'America/Los_Angeles';
const USAGE_FILE = '/tmp/usage.json';
const FREE_QUOTAS = { pro: 100, flash: 250, flashlite: 1000 };

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
function used(key, date=todayPT()) {
  return USAGE.byDate?.[date]?.[key] || 0;
}
function remaining(key, date=todayPT()) {
  const cap = FREE_QUOTAS[key] ?? 0;
  return Math.max(0, cap - used(key, date));
}
function inc(key, date=todayPT()) {
  if (!USAGE.byDate[date]) USAGE.byDate[date] = { pro:0, flash:0, flashlite:0 };
  USAGE.byDate[date][key] = (USAGE.byDate[date][key] || 0) + 1;
  atomicSave(USAGE_FILE, JSON.stringify(USAGE));
}

/* ===== 3) Temporary store =====
   step: 'await_process_type' | 'await_model' | 'ready'
   processType: 'full' | 'clean' | 'summary'
   lastProcessType: آخرین حالت انتخاب شده برای استفاده مجدد
*/
const sessions = new Map(); // به جای pending، sessions که طولانی‌مدت هستند
function makeToken() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }

// cleanup sessions هر 2 ساعت (به جای 20 دقیقه)
setInterval(() => {
  const now = Date.now();
  for (const [k,v] of sessions) {
    if (now - v.createdAt > 2*60*60*1000) { // 2 ساعت
      sessions.delete(k);
    }
  }
}, 30*60*1000); // هر 30 دقیقه چک کن

/* ===== 4) Maps ===== */
const MODEL_MAP = {
  pro: 'gemini-2.5-pro',
  flash: 'gemini-2.5-flash',
  flashlite: 'gemini-2.5-flash-lite',
};
const PROMPT_MAP = {
  full: `Transcribe the entire speech exactly as spoken, in the same language, with proper punctuation. 
If there is more than one distinct speaker, identify them and assign labels as "شخص ۱", "شخص ۲", etc., consistently throughout the transcript. 
Whenever the speaker changes, start a new line with the speaker label followed by a colon, then their speech. 
If there is only one speaker, do not include any speaker label at all — just return the transcript exactly as spoken. 
Do not add any extra commentary or text outside of the transcript.`,

  clean: `Transcribe the speech into a clean, fluent text in the same language, preserving all content and original tone, but removing filler words, repetitions, hesitations, and unnecessary digressions. Keep all meaningful details intact. 
If there is more than one distinct speaker, identify them and assign labels as "شخص ۱", "شخص ۲", etc., consistently. Whenever the speaker changes, start a new paragraph with the speaker label followed by a colon, then their cleaned-up speech. 
If there is only one speaker, do not include any speaker label — just return the cleaned text as a single continuous narrative.`,

  summary: `Analyze the speech and produce a very short bullet-point summary in the same language. 
First, detect the number of distinct speakers. If more than one, label them as "شخص ۱", "شخص ۲", etc., and mention the speaker label in parentheses after each relevant topic. 
If only one speaker, omit speaker labels entirely. 
At the top of the summary, start with the title line exactly like this:
"📌 محتوای این وویس:"
Below that, list only the main topics (3–5 items) as separate lines starting with a relevant emoji (e.g., 🔹, 🔸, 🟢, etc.) followed by the topic title. 
If needed, optionally add a very short sub-point for each topic on the next line starting with "   ↳" and keep it under 1 short sentence. 
Focus on showing only the main topics clearly at first glance, without long explanations.`
};  

// Split long texts into Telegram-safe chunks (<= 4096 chars)
function splitForTelegram(text, maxLen = 4096) {
  if (!text) return [];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n\n', maxLen);
    if (cut < 0) cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < 0) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

// Function to create process type keyboard
function createProcessTypeKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 متن کامل', `ptype:full:${token}`)],
    [Markup.button.callback('✂️ متن مفید', `ptype:clean:${token}`)],
    [Markup.button.callback('📌 خلاصه تیتر‌وار', `ptype:summary:${token}`)],
    [Markup.button.callback('🚫 منصرف شدم', `cancel:${token}`)],
  ]);
}

// Function to create model keyboard
function createModelKeyboard(token) {
  const labelPro   = `Gemini Pro (${remaining('pro')})`;
  const labelFlash = `Gemini Flash (${remaining('flash')})`;
  const labelLite  = `Gemini Flash Lite (${remaining('flashlite')})`;

  const btnPro   = remaining('pro')      > 0 ? Markup.button.callback(labelPro,   `model:pro:${token}`)      : Markup.button.callback('Gemini Pro — تکمیل',   `noop:${token}`);
  const btnFlash = remaining('flash')    > 0 ? Markup.button.callback(labelFlash, `model:flash:${token}`)    : Markup.button.callback('Gemini Flash — تکمیل', `noop:${token}`);
  const btnLite  = remaining('flashlite')> 0 ? Markup.button.callback(labelLite,  `model:flashlite:${token}`) : Markup.button.callback('Gemini Flash Lite — تکمیل', `noop:${token}`);

  return Markup.inlineKeyboard([
    [btnPro],
    [btnFlash],
    [btnLite],
    [Markup.button.callback('🚫 منصرف شدم', `cancel:${token}`)],
  ]);
}

/* ===== 5) Bot logic ===== */
bot.start((ctx) => ctx.reply('سلام! یک ویس بفرست. 🎤'));

bot.on(['voice','audio'], async (ctx) => {
  const thinking = await ctx.reply('⏳ دریافت فایل...');
  try {
    // قبل از هر چیز، sessions قبلی این کاربر را پاک می‌کنیم
    const userId = ctx.from.id;
    for (const [token, session] of sessions) {
      if (session.userId === userId) {
        sessions.delete(token);
      }
    }

    // 1) Download
    const msg = ctx.message;
    const media = msg.voice || msg.audio;
    const fileUrl = await ctx.telegram.getFileLink(media.file_id);
    const res = await fetch(fileUrl.href);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // 2) Upload
    let mimeType = 'audio/ogg';
    if (msg.audio?.mime_type) mimeType = msg.audio.mime_type;
    const blob = new Blob([buffer], { type: mimeType });
    const displayName = msg.voice ? 'voice.ogg' : (msg.audio?.file_name || 'audio');
    const uploadedAny = await ai.files.upload({ file: blob, config: { mimeType, displayName } });
    const uploaded = uploadedAny.file ?? uploadedAny;
    if (!uploaded?.uri) throw new Error('No uploaded.uri');

    // 3) Save session
    const token = makeToken();
    sessions.set(token, {
      step: 'await_process_type',
      uri: uploaded.uri,
      mimeType: uploaded.mimeType || mimeType,
      chatId: thinking.chat.id,
      promptMsgId: thinking.message_id,
      userId: userId,
      createdAt: Date.now(),
      lastProcessType: null, // آخرین حالت انتخاب شده
    });

    await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, 'چطور میخوای متن پردازش بشه؟');
    await ctx.reply(
      'یکی از حالت‌های زیر رو انتخاب کن:',
      createProcessTypeKeyboard(token)
    );
  } catch (err) {
    console.error('❌ ERROR on voice:', err);
    try {
      await ctx.telegram.editMessageText(thinking.chat.id, thinking.message_id, undefined, '😕 خطا در پردازش. دوباره امتحان کن.');
    } catch {}
  }
});

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data || '';

    // Cancel
    const c = data.match(/^cancel:([a-z0-9]+)$/i);
    if (c) {
      const token = c[1];
      const session = sessions.get(token);
      await ctx.answerCbQuery('لغو شد');
      try { await ctx.editMessageText('لغو شد ✅'); } catch {}
      if (session) {
        try { await ctx.telegram.editMessageText(session.chatId, session.promptMsgId, undefined, 'لغو شد ✅'); } catch {}
        sessions.delete(token);
      }
      return;
    }

    // Noop when quota finished
    if (/^noop:/.test(data)) {
      return ctx.answerCbQuery('سهمیهٔ رایگان امروز این مدل تمام شده است.', { show_alert: true });
    }

    // Step 1: choose process type
    const p = data.match(/^ptype:(full|clean|summary):([a-z0-9]+)$/i);
    if (p) {
      const type = p[1];
      const token = p[2];
      const session = sessions.get(token);
      if (!session) {
        return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      }
      
      // ذخیره حالت انتخابی
      session.processType = type;
      session.lastProcessType = type;
      session.step = 'await_model';

      await ctx.answerCbQuery(`حالت "${type}" انتخاب شد`);
      await ctx.reply(
        'با کدوم مدل پردازش کنم؟',
        createModelKeyboard(token)
      );
      return;
    }

    // Step 2: choose model
    const m = data.match(/^model:(pro|flash|flashlite):([a-z0-9]+)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const token = m[2];
      const session = sessions.get(token);
      if (!session) {
        return ctx.answerCbQuery('منقضی شده یا نامعتبر است.');
      }
      if (remaining(key) <= 0) {
        return ctx.answerCbQuery('سهمیهٔ امروز این مدل تمام شده است.', { show_alert: true });
      }

      // اگر processType تنظیم نشده، از آخرین استفاده کن
      let processType = session.processType || session.lastProcessType || 'full';
      
      // اگر هنوز هیچ processType ای نداریم، به مرحله انتخاب برگرد
      if (!processType) {
        session.step = 'await_process_type';
        await ctx.answerCbQuery('لطفاً ابتدا حالت پردازش را انتخاب کنید.');
        await ctx.reply(
          'یکی از حالت‌های زیر رو انتخاب کن:',
          createProcessTypeKeyboard(token)
        );
        return;
      }

      const model = MODEL_MAP[key];
      const prompt = PROMPT_MAP[processType] || PROMPT_MAP.full;

      await ctx.answerCbQuery(`مدل انتخابی: ${model}`);
      const waiting = await ctx.reply('⏳ در حال پردازش...');

      // فقط تولید محتوا رو در try-catch قرار میدیم
      let result;
      try {
        result = await ai.models.generateContent({
          model,
          contents: createUserContent([
            createPartFromUri(session.uri, session.mimeType),
            prompt,
          ]),
        });
      } catch (err) {
        console.error('❌ ERROR in AI processing:', err);
        try {
          await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, '😕 خطا در پردازش هوش مصنوعی. دوباره امتحان کن.');
        } catch {}
        return;
      }

      // پردازش نتیجه و ارسال (خارج از try-catch)
      const text = result.text?.trim() || 'متنی برنگشت.';
      const parts = splitForTelegram(text, 4000);
      
      if (parts.length === 0) {
        try {
          await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, 'متنی برنگشت.');
        } catch {}
      } else {
        try {
          await ctx.telegram.editMessageText(waiting.chat.id, waiting.message_id, undefined, parts[0]);
        } catch {}
        
        for (let i = 1; i < parts.length; i++) {
          try {
            await ctx.reply(parts[i]);
          } catch {}
        }
      }

      inc(key);
      
      // session را پاک نکنیم - فقط وضعیت را به ready تغییر دهیم
      session.step = 'ready';
      session.processType = null; // برای کلیک بعدی reset کن
      
      // پیام راهنمایی برای ادامه استفاده (جدا و محافظت شده)
      try {
        await ctx.reply(
          '✨ برای دریافت خروجی‌های مختلف از همین ویس، روی دکمه‌های بالا کلیک کن!\n🎤 برای ویس جدید، فایل صوتی بفرست.',
          {
            reply_markup: {
              inline_keyboard: [
                ...createProcessTypeKeyboard(token).reply_markup.inline_keyboard.slice(0, -1), // بدون دکمه منصرف شدم
                ...createModelKeyboard(token).reply_markup.inline_keyboard.slice(0, -1), // بدون دکمه منصرف شدم
                [[Markup.button.callback('🚫 پایان کار', `cancel:${token}`)]]
              ]
            }
          }
        );
      } catch (err) {
        console.error('❌ ERROR in sending guide message (non-critical):', err);
        // این خطا مهم نیست - خروجی اصلی ارسال شده
      }

      return;
    }

  } catch (err) {
    console.error('❌ ERROR in callback:', err);
    try { await ctx.reply('😕 خطا رخ داد. دوباره تلاش کن.'); } catch {}
  }
});

/* ===== 6) Express Webhook server (Cloud Run) ===== */
const app = express();

// health
app.get('/', (_req, res) => res.status(200).send('OK'));

// raw body as JSON
app.use(express.json({ limit: '10mb' }));

// verify Telegram secret (optional but recommended)
app.post('/webhook', (req, res, next) => {
  const token = req.get('X-Telegram-Bot-Api-Secret-Token');
  if (WH_SECRET && token !== WH_SECRET) {
    console.warn('❌ Invalid secret token');
    return res.sendStatus(401);
  }
  return next();
}, bot.webhookCallback('/webhook'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Webhook server listening on ${PORT}`);
});