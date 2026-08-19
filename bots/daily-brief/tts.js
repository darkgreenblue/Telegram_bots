// tts.js — تبدیلِ متنِ قسمت به یک فایلِ mp3.
//
// معماری: لایه‌ی آداپتور. هر موتور فقط باید «یک تکه متن → بافرِ صدا» را بلد باشد؛ چانک‌بندی،
// چسباندن و محاسبه‌ی هزینه مشترک است. دلیلش این است که کیفیتِ فارسیِ موتورها نامعلوم است و
// انتخابِ نهایی با گوشِ مالک از راهِ دستورِ بیک‌آف انجام می‌شود، نه با حدسِ ما.
//
// دو قاعده‌ی سخت:
//   ۱) چانک همیشه روی مرزِ جمله شکسته می‌شود، هرگز وسطِ جمله. شکستنِ وسطِ جمله در خروجیِ
//      صوتی به‌صورت مکثِ بی‌جا و لحنِ بریده شنیده می‌شود.
//   ۲) دیالوگِ دو نفره فقط با موتورهایی که چند گوینده را **بومی** در یک درخواست می‌سازند.
//      استیچ‌کردنِ خط‌به‌خط با موتورِ تک‌صدا ده‌ها فایلِ کوچک و ده‌ها ریکوئست می‌شود
//      (ریسکِ rate-limit و لحنِ ناپیوسته) و عمداً پیاده نشده.

import { execFile } from 'child_process';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { log, logErr } from '../../shared/logger.js';

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// سکوتِ کوتاه بینِ چانک‌ها: مرزِ دو فایلِ mp3 در غیر این صورت به‌صورت یک کلیکِ ریز شنیده می‌شود.
// نیم‌ثانیه برای مرزِ وسطِ یک پاراگرافِ در جریان زیاد است و مکثِ غیرطبیعی می‌سازد.
const GAP_MS = 220;

// **همه‌چیز از OpenRouter.** هیچ سرویسِ صوتیِ مستقیمی صدا زده نمی‌شود؛ اگر روزی موتورِ
// دیگری (مثلاً ElevenLabs) لازم شد، از روی همین endpoint و با همان کلید می‌آید.
//
// کاتالوگِ موتورها **زنده** از خودِ OpenRouter خوانده می‌شود، نه هاردکد: اسلاگِ مدل‌های TTS
// تاریخ‌دار است و مرتب عوض می‌شود؛ لیستِ هاردکد یعنی روزی که اسلاگ عوض شود ربات ساکت
// می‌شکند. لیستِ ثابتِ پایین فقط فالبکِ آفلاین است (اگر endpoint در دسترس نباشد).
const FALLBACK_MODELS = [
  { id: 'openai/gpt-4o-mini-tts', name: 'GPT-4o mini TTS', supported_voices: ['nova', 'alloy', 'shimmer'] },
  { id: 'google/gemini-3.1-flash-tts-preview', name: 'Gemini Flash TTS', supported_voices: ['Kore', 'Puck'] },
  { id: 'mistralai/voxtral-mini-tts-2603', name: 'Voxtral Mini TTS', supported_voices: [] },
];
// سقفِ چانک از **مدتِ صدا** حساب می‌شود، نه از عددِ دلبخواهِ کاراکتر.
//
// چرا (باگِ واقعیِ ۱۴۰۵/۰۵/۲۸): قسمتِ پنج‌دقیقه‌ایِ روزانه با «Provider returned an empty
// audio stream after returning HTTP 200» شکست خورد. علتش این بود که با سقفِ ۳۵۰۰
// کاراکتری، کلِ قسمت **در یک درخواست** می‌رفت. حسابش:
//   خروجیِ صوتیِ این مدل ۲۵ توکن به‌ازای هر ثانیه صداست، و پنج دقیقه یعنی ۳۰۰ ثانیه
//   → ۷۵۰۰ توکنِ خروجی، به‌علاوه‌ی خودِ متن به‌عنوان ورودی، روی مدلی با کانتکستِ ۸ هزار.
// یعنی درخواست دقیقاً لبِ سقف بود: قسمتِ ۲۸۷۷ کاراکتریِ دیروز رد شد و ۳۱۴۳ کاراکتریِ
// امروز نشد. سرویس به‌جای خطای صریح، ۲۰۰ با بدنه‌ی خالی برمی‌گرداند.
// ۹۰ ثانیه یعنی حدودِ ۲۲۵۰ توکنِ خروجی؛ با فاصله‌ی امن زیرِ سقف، و داخلِ همان پنجره‌ای
// که کیفیتِ این مدل هنوز افت نکرده (گزارشِ کاربران: افتِ کیفیت بعد از چند دقیقه‌ی پیوسته).
const TARGET_CHUNK_SECONDS = 90;
// فارسیِ گفتاری با ۱۵۰ کلمه بر دقیقه و میانگینِ ~۵.۵ کاراکتر per کلمه (با فاصله)
const CHARS_PER_SECOND = 13.5;
export const MAX_CHARS = Math.round(TARGET_CHUNK_SECONDS * CHARS_PER_SECOND);
// تخمینِ درشتِ فالبک وقتی نه قیمتِ مدل در دسترس است نه هزینه‌ی واقعیِ generation.
const FALLBACK_PRICE_PER_CHAR = 5 / 1_000_000;

let catalogCache = { at: 0, models: null };

const normalize = (m) => ({
  id: m.id,
  name: m.name || m.id,
  supported_voices: Array.isArray(m.supported_voices) ? m.supported_voices : [],
  pricing: m.pricing || null,
});

// آیا این مدل خروجیِ صوتی می‌دهد؟ شکلِ فیلد بینِ نسخه‌های کاتالوگ فرق می‌کند، پس هر دو
// جای متعارف نگاه می‌شود. اسمِ مدل به‌تنهایی ملاک نیست چون مدل‌های **صوت به متن** هم
// «audio» در نامشان دارند و اگر واردِ لیست شوند، بیک‌آف روی آن‌ها خطا می‌دهد.
const outputsAudio = (m) => {
  const mods = m?.output_modalities || m?.architecture?.output_modalities;
  return Array.isArray(mods) && mods.some((x) => /audio|speech/i.test(String(x)));
};

// کشفِ مدل‌های صوتی. شکستش هرگز چیزی را نمی‌شکند: فالبکِ ثابت برمی‌گردد.
// **دو منبع** خوانده می‌شود چون فیلترِ `output_modalities=speech` لزوماً همه‌ی مدل‌های
// خروجی‌صوتی را برنمی‌گرداند (کاتالوگِ واقعی فقط یک مدلِ گوگل در آن فیلتر داشت). کلِ
// کاتالوگ هم اسکن می‌شود و هرچه خروجیِ صوتی اعلام کرده اضافه می‌شود.
export async function listSpeechModels({ apiKey, fetchImpl = fetch, ttlMs = 6 * 3600 * 1000 } = {}) {
  if (catalogCache.models && Date.now() - catalogCache.at < ttlMs) return catalogCache.models;
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const get = async (url) => {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new Error(`models ${res.status}`);
    return (await res.json())?.data || [];
  };
  try {
    const primary = (await get('https://openrouter.ai/api/v1/models?output_modalities=speech'))
      .filter((m) => m?.id).map(normalize);
    const byId = new Map(primary.map((m) => [m.id, m]));
    // منبعِ دوم بهترین‌تلاش است: اگر نشد، همان لیستِ اول کار را راه می‌اندازد.
    try {
      for (const m of await get('https://openrouter.ai/api/v1/models')) {
        if (m?.id && !byId.has(m.id) && outputsAudio(m)) byId.set(m.id, normalize(m));
      }
    } catch (e) { logErr('کاتالوگِ کامل خوانده نشد:', e.message); }

    const models = [...byId.values()];
    if (models.length) {
      catalogCache = { at: Date.now(), models };
      log(`🔊 ${models.length} مدلِ صوتی از OpenRouter: ${models.map((m) => m.id).join(', ')}`);
      return models;
    }
    throw new Error('لیستِ مدل‌های صوتی خالی بود');
  } catch (e) {
    logErr('listSpeechModels:', e.message, '| فالبکِ ثابت استفاده می‌شود');
    return FALLBACK_MODELS;
  }
}

// یادداشتِ تاریخی: زمانی این‌جا سه لایه ترتیب و صافیِ موتورها بود (ردشده با گوش، اولویتِ
// فارسی، ته‌ی لیست) به‌علاوه‌ی انتخابگرِ بیک‌آف. بعد از مقایسه‌ی واقعیِ صداها (۱۴۰۵/۰۵/۲۷)
// مالک جمنای را انتخاب کرد و موتور ثابت شد، پس همه‌ی آن منطق حذف شد نه خاموش (بند ۹/۰
// ریشه: چیزی که به هدف نزدیک نمی‌کند نگهداری نمی‌شود). کشفِ کاتالوگ **می‌ماند** چون
// اسلاگِ مدل تاریخ‌دار است و اگر روزی عوض شود، synthesize روی مدلِ در دسترس می‌افتد
// به‌جای اینکه ربات بی‌صدا بشکند.

export const engineLabel = (id) => {
  const m = (catalogCache.models || FALLBACK_MODELS).find((x) => x.id === id);
  return `🗣 ${m?.name || String(id).split('/').pop()}`;
};

// صدای پیش‌فرضِ خانواده‌ها برای وقتی که کاتالوگ `supported_voices` نمی‌دهد.
// لازم است چون بعضی ارائه‌دهنده‌ها بدونِ voice اصلاً جواب نمی‌دهند: در اولین بیک‌آفِ واقعی،
// هر دو مدلِ MiniMax با «An explicit voice is required for this TTS provider» رد شدند —
// یعنی دقیقاً موتوری که فارسی را رسماً پشتیبانی می‌کند از مقایسه بیرون افتاد.
const FAMILY_VOICE = [
  [/^minimax\//i, 'Deep_Voice_Man'],   // از صداهای سیستمیِ خودِ MiniMax
  [/gemini.*tts/i, 'Kore'],
  [/^openai\//i, 'nova'],
  [/^fish-audio\//i, 'default'],
];
export const familyVoice = (id) => (FAMILY_VOICE.find(([re]) => re.test(String(id || '')))?.[1] || '');

// صدای پیش‌فرضِ هر مدل: اولین صدای پشتیبانی‌شده، وگرنه صدای شناخته‌شده‌ی همان خانواده.
export function defaultVoice(model) {
  if (model?.supported_voices?.length) return model.supported_voices[0];
  return familyVoice(model?.id);
}

// دو گوینده‌ی بومی فقط روی خانواده‌ی جمنای مستند شده است.
export const isMultiSpeaker = (id) => /gemini.*tts/i.test(String(id || ''));

// قیمتِ هر کاراکتر از روی قیمتِ مدل، اگر بدهد. OpenRouter قیمت را per توکن می‌دهد و
// برای TTS رابطه‌ی توکن و کاراکتر ثابت نیست، پس این فقط تخمین است؛ عددِ دقیق از
// خودِ generation می‌آید (پایین).
function pricePerChar(model) {
  const p = Number(model?.pricing?.output);
  if (Number.isFinite(p) && p > 0) return p / 4; // تقریبِ چهار کاراکتر به ازای هر توکن
  return FALLBACK_PRICE_PER_CHAR;
}

/* ===== چانک‌بندی ===== */
// شکستن روی مرزِ پاراگراف، و اگر پاراگراف بزرگ‌تر از سقف بود روی مرزِ جمله.
// جمله‌ای که به‌تنهایی از سقف بزرگ‌تر باشد (عملاً غیرممکن در متنِ گفتاری) ناچار روی
// مرزِ فاصله بریده می‌شود تا هرگز وسطِ کلمه نشکند.
// جمله‌ی سبک روی **هر** چانک تکرار می‌شود، نه فقط اولی. دلیلش گزارشِ پرتکرارِ کاربرانِ
// همین مدل است: هر درخواست پروفایلِ صوتی را از نو می‌سازد، پس چانکی که دستورِ سبک ندارد
// با لحن و ریتمِ متفاوت خوانده می‌شود و شنونده وسطِ قسمت حسِ عوض شدنِ گوینده می‌گیرد.
// الگوی «{دستور}: {متن}» مستندِ خودِ مدل است و بخشِ قبل از دو نقطه خوانده نمی‌شود.
// پاک‌کردنِ تگ‌های اجرا: آخرین پله‌ی نردبان، وقتی مشکوکیم خودِ تگ‌ها مشکل‌سازند.
export const stripPerformanceTags = (s) =>
  String(s || '').replace(/\[[^\]\n]{1,24}\]/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();

export const withStyle = (prefix, text) => {
  const p = String(prefix || '').trim();
  const t = String(text || '').trim();
  if (!p) return t;
  return `${p.replace(/:*$/, ':')} ${t}`;
};

export function chunkText(text, maxChars) {
  const out = [];
  const flush = (s) => { const t = s.trim(); if (t) out.push(t); };
  let cur = '';
  const push = (piece) => {
    if (!cur) { cur = piece; return; }
    if (cur.length + 2 + piece.length <= maxChars) cur += `\n\n${piece}`;
    else { flush(cur); cur = piece; }
  };

  for (const para of String(text || '').split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxChars) { push(p); continue; }
    // پاراگرافِ بلند → جمله‌به‌جمله (نقطه، علامت سؤال، تعجب، سه‌نقطه، و نقطه‌ی فارسی)
    let sent = '';
    for (const s of p.split(/(?<=[.!?؟…])\s+/)) {
      const piece = s.trim();
      if (!piece) continue;
      if (piece.length > maxChars) {
        if (sent) { push(sent); sent = ''; }
        let rest = piece;
        while (rest.length > maxChars) {
          let cut = rest.lastIndexOf(' ', maxChars);
          if (cut <= 0) cut = maxChars;
          // برشِ سخت نباید وسطِ یک تگِ اجرا بیفتد (تگ فاصله دارد، مثل «[short pause]»):
          // نصفه‌ی تگ یا بلند خوانده می‌شود یا کلِ چانک را خراب می‌کند.
          const open = rest.lastIndexOf('[', cut);
          if (open > -1 && rest.indexOf(']', open) >= cut) cut = open;
          push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        sent = rest;
        continue;
      }
      if (!sent) sent = piece;
      else if (sent.length + 1 + piece.length <= maxChars) sent += ` ${piece}`;
      else { push(sent); sent = piece; }
    }
    if (sent) push(sent);
  }
  flush(cur);
  return out;
}

// دیالوگ فقط روی مرزِ نوبتِ گفتار شکسته می‌شود (نصف‌کردنِ یک نوبت یعنی گویندگی بی‌معنی).
export function chunkTurns(turns, maxChars) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const t of turns || []) {
    const size = String(t.text || '').length + 12;
    if (cur.length && len + size > maxChars) { out.push(cur); cur = []; len = 0; }
    cur.push(t); len += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

// متنِ خوانا از نوبت‌های گفتار، برای موتورهایی که چند گوینده ندارند (degrade، نه fail).
export const turnsToNarration = (turns) =>
  (turns || []).map((t) => String(t.text || '').trim()).filter(Boolean).join('\n\n');

/* ===== آداپتورِ واحد (OpenRouter) ===== */
// هر ارائه‌دهنده قلقِ خودش را دارد و کاتالوگ آن قلق‌ها را اعلام نمی‌کند. به‌جای نگه‌داشتنِ
// یک جدولِ دستیِ استثناها (که برای مدلِ بعدی دوباره ناقص می‌شود)، از خودِ پیامِ خطا یاد
// می‌گیریم و **یک بار** با تنظیمِ اصلاح‌شده دوباره تلاش می‌کنیم. دو موردی که در اولین
// بیک‌آفِ واقعی دیده شد: MiniMax بدونِ voice رد می‌کند، و Gemini فقط pcm می‌دهد.
async function postSpeech({ apiKey, modelId, voice, text, speed, format, fetchImpl }) {
  const res = await fetchImpl('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      input: text,
      ...(voice ? { voice } : {}),
      response_format: format,
      ...(speed && speed !== 1 ? { speed } : {}),
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    const err = new Error(`TTS ${res.status}: ${msg.slice(0, 200)}`);
    err.status = res.status;
    err.body = msg;
    throw err;
  }
  const ctype = res.headers.get('content-type') || '';
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    genId: res.headers.get('x-generation-id') || '',
    // خامِ pcm باید قبل از چسباندن به mp3 تبدیل شود؛ نرخ و کانال از خودِ هدر می‌آید
    // (مثلاً audio/pcm;rate=24000;channels=1) نه از حدسِ ما.
    pcm: /pcm/i.test(ctype) || format === 'pcm'
      ? {
          rate: Number(/rate=(\d+)/.exec(ctype)?.[1]) || 24000,
          channels: Number(/channels=(\d+)/.exec(ctype)?.[1]) || 1,
        }
      : null,
  };
}

// خطای گذرا در برابر خطای واقعی: ۵xx و «استریمِ خالی» هر دو یعنی سرویس این لحظه نتوانست،
// نه اینکه ورودیِ ما غلط است. تا قبل از این، همین یک خطا کلِ قسمتِ روز را می‌کشت.
export const isTransientTts = (e) => {
  const body = String(e?.body || e?.message || '');
  return e?.status >= 500 || /empty audio stream|timeout|overloaded|unavailable/i.test(body);
};

export async function synthChunk({ apiKey, modelId, voice, text, speed, fetchImpl, sleepImpl = sleep }) {
  let useVoice = voice;
  let format = 'mp3';
  let transient = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const out = await postSpeech({ apiKey, modelId, voice: useVoice, text, speed, format, fetchImpl });
      // ۲۰۰ با بدنه‌ی خالی هم شکست است، حتی اگر HTTP بگوید موفق بود.
      if (!out.buf?.length) {
        const err = new Error(`TTS ${modelId}: پاسخِ ۲۰۰ ولی بدونِ صدا`);
        err.status = 200;
        err.body = 'empty audio stream';
        throw err;
      }
      return out;
    } catch (e) {
      const body = String(e.body || e.message || '');
      if (e.status === 400 && /voice/i.test(body) && !useVoice) {
        useVoice = familyVoice(modelId) || 'default';
        logErr(`TTS ${modelId}: صدا لازم بود، با «${useVoice}» دوباره تلاش می‌کنم`);
        continue;
      }
      if (e.status === 400 && /pcm/i.test(body) && format !== 'pcm') {
        format = 'pcm';
        logErr(`TTS ${modelId}: فقط pcm می‌دهد، با pcm دوباره تلاش می‌کنم`);
        continue;
      }
      if (isTransientTts(e) && transient < 2) {
        transient++;
        logErr(`TTS ${modelId}: خطای گذرا (${body.slice(0, 80)})، تلاشِ ${transient} از ۲`);
        await sleepImpl(2000 * transient);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`TTS ${modelId}: بعد از تلاشِ دوباره هم جواب نداد`);
}

/* ===== ffmpeg ===== */
// چسباندنِ چانک‌ها با یک سکوتِ کوتاه بینشان، و یکسان‌سازیِ نرخ/بیت‌ریت در همان پاس.
// خروجی همیشه mp3 مونو ۶۴k است: نیم‌ساعت پادکست حدود ۱۴ مگابایت، راحت زیرِ سقفِ ۵۰ مگابایتیِ ربات.
const LAME = ['-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1'];
// نرمال‌سازیِ کاملِ هر ورودی. فقط aresample کافی نیست: اگر یک موتور استریو بدهد و
// منبعِ سکوت مونو باشد، فیلترِ concat با «Input link parameters do not match» می‌میرد.
const AFMT = 'aformat=sample_rates=44100:channel_layouts=mono';

// گرافِ فیلترِ چسباندن، به‌صورت تابعِ خالص تا در CI سنجیده شود: این محیط ffmpeg ندارد و
// خطای گراف فقط روی سرور و وسطِ ساختِ یک قسمتِ واقعی خودش را نشان می‌دهد.
// قاعده‌ی حیاتی: هر برچسب دقیقاً یک بار تولید و دقیقاً یک بار مصرف می‌شود.
export function buildConcatFilter(partCount) {
  const gaps = partCount - 1;
  const filters = Array.from({ length: partCount }, (_, i) => `[${i}:a]${AFMT}[a${i}]`);
  const gapLabels = Array.from({ length: gaps }, (_, i) => `g${i}`);
  filters.push(gaps === 1
    ? `[${partCount}:a]${AFMT}[g0]`
    : `[${partCount}:a]${AFMT},asplit=${gaps}${gapLabels.map((l) => `[${l}]`).join('')}`);
  const seq = [];
  for (let i = 0; i < partCount; i++) {
    if (i) seq.push(`[g${i - 1}]`);
    seq.push(`[a${i}]`);
  }
  filters.push(`${seq.join('')}concat=n=${seq.length}:v=0:a=1[out]`);
  return { graph: filters.join(';'), streams: seq.length };
}

async function concatMp3(parts, outPath) {
  if (parts.length === 1) {
    await run('ffmpeg', ['-y', '-i', parts[0], ...LAME, outPath]);
    return;
  }
  const inputs = parts.flatMap((p) => ['-i', p]);
  // منبعِ سکوت آخرین ورودی است (اندیسش = تعدادِ تکه‌ها)
  inputs.push('-f', 'lavfi', '-t', String(GAP_MS / 1000), '-i', 'anullsrc=r=44100:cl=mono');
  const { graph } = buildConcatFilter(parts.length);
  try {
    await run('ffmpeg', [
      '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', ...LAME, outPath,
    ], { maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    // شبکه‌ی ایمنی: اگر گرافِ فیلتر روی نسخه‌ی ffmpegِ سرور ایراد بگیرد، قسمت نباید بمیرد.
    // چسباندنِ ساده بدونِ سکوت هنوز یک پادکستِ قابلِ گوش‌دادن می‌دهد.
    logErr('ffmpeg gapped concat failed, falling back to plain concat:', String(e.message).slice(0, 200));
    const plain = parts.map((p, i) => `[${i}:a]${AFMT}[a${i}]`).join(';');
    const seq2 = parts.map((_, i) => `[a${i}]`).join('');
    await run('ffmpeg', [
      '-y', ...parts.flatMap((p) => ['-i', p]),
      '-filter_complex', `${plain};${seq2}concat=n=${parts.length}:v=0:a=1[out]`,
      '-map', '[out]', ...LAME, outPath,
    ], { maxBuffer: 32 * 1024 * 1024 });
  }
}

async function probeSeconds(path) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', path,
    ]);
    return Math.round(parseFloat(stdout.trim()) || 0);
  } catch { return 0; }
}

/* ===== ورودیِ اصلی ===== */
// engineKey = شناسه‌ی مدلِ OpenRouter (مثل openai/gpt-4o-mini-tts).
// خروجی: {buffer, chars, costUsd, seconds, chunks, engine, voice, degraded}
// degraded یعنی دیالوگ خواسته شده بود ولی موتور چند گوینده ندارد و روایتِ تک‌صدا ساخته شد.
export async function synthesize({
  engineKey, script, turns = null, speed = 1, voice = '', stylePrefix = '',
  openrouterKey, fetchImpl = fetch, generationCost = null,
}) {
  if (!openrouterKey) throw new Error('OPENROUTER_API_KEY ست نشده است');
  const models = await listSpeechModels({ apiKey: openrouterKey, fetchImpl });
  const model = models.find((m) => m.id === engineKey)
    || models[0]
    || { id: engineKey, supported_voices: [] };
  const modelId = model.id;
  const useVoice = voice || defaultVoice(model);
  const multi = isMultiSpeaker(modelId);

  const wantsDialogue = Array.isArray(turns) && turns.length > 0;
  const degraded = wantsDialogue && !multi;
  const pieces = wantsDialogue && multi
    ? chunkTurns(turns, MAX_CHARS).map((g) =>
        g.map((t) => `${t.speaker === 'b' ? 'Speaker 2' : 'Speaker 1'}: ${t.text}`).join('\n'))
    : chunkText(wantsDialogue ? turnsToNarration(turns) : String(script || ''), MAX_CHARS);

  if (!pieces.length) throw new Error('متنی برای تبدیل به صدا نیست');

  const dir = await mkdtemp(join(tmpdir(), 'dbrief-'));
  try {
    const files = [];
    let chars = 0;
    const genIds = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      chars += piece.length;
      // نردبانِ تنزل: هر پله یک متغیرِ تازه را از درخواست برمی‌دارد. قسمتِ روزانه نباید
      // به‌خاطرِ یک تکه بمیرد، و لاگِ پله می‌گوید در عمل کدام چیز مقصر بوده (یادگیری از
      // پروداکشن، چون سندباکس به سرویس دسترسی ندارد).
      const rungs = [
        { name: 'styled', text: withStyle(stylePrefix, piece) },
        ...(stylePrefix ? [{ name: 'no-style', text: piece }] : []),
        ...(/\[[^\]\n]+\]/.test(piece) ? [{ name: 'plain', text: stripPerformanceTags(piece) }] : []),
      ];
      let got = null;
      let lastErr = null;
      for (const rung of rungs) {
        try {
          got = await synthChunk({
            apiKey: openrouterKey, modelId, voice: useVoice, text: rung.text, speed, fetchImpl,
          });
          if (rung.name !== 'styled') logErr(`🔊 chunk ${i + 1}: با پله‌ی «${rung.name}» ساخته شد`);
          break;
        } catch (e) {
          lastErr = e;
          logErr(`🔊 chunk ${i + 1}: پله‌ی «${rung.name}» نشد (${String(e.message).slice(0, 90)})`);
        }
      }
      if (!got) throw lastErr;
      const { buf, genId, pcm } = got;
      if (!buf?.length) throw new Error(`چانک ${i + 1} خروجیِ صوتی نداد`);
      const f = join(dir, `p${String(i).padStart(3, '0')}.mp3`);
      if (pcm) {
        // خامِ بدونِ هدر: ffmpeg باید نرخ و کانال را از ما بگیرد وگرنه صدا تندشده یا خش‌دار می‌شود
        const raw = join(dir, `p${String(i).padStart(3, '0')}.pcm`);
        await writeFile(raw, buf);
        await run('ffmpeg', ['-y', '-f', 's16le', '-ar', String(pcm.rate), '-ac', String(pcm.channels),
          '-i', raw, ...LAME, f]);
      } else {
        await writeFile(f, buf);
      }
      files.push(f);
      if (genId) genIds.push(genId);
      log(`🔊 chunk ${i + 1}/${pieces.length} (${piece.length} chars, ${buf.length} bytes)`);
    }

    const outPath = join(dir, 'episode.mp3');
    await concatMp3(files, outPath);
    const [buffer, seconds] = await Promise.all([readFile(outPath), probeSeconds(outPath)]);

    // هزینه: اول عددِ واقعیِ سرویس، وگرنه تخمین از قیمتِ مدل.
    let costUsd = chars * pricePerChar(model);
    if (generationCost && genIds.length) {
      const real = (await Promise.all(genIds.map((id) => generationCost(id).catch(() => null))))
        .filter((c) => typeof c === 'number');
      if (real.length === genIds.length) costUsd = real.reduce((a, b) => a + b, 0);
    }

    return { buffer, chars, costUsd, seconds, chunks: pieces.length, engine: modelId, voice: useVoice, degraded };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((e) => logErr('tts tmp cleanup:', e.message));
  }
}
