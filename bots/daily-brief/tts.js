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

// سکوتِ کوتاه بینِ چانک‌ها: مرزِ دو فایلِ mp3 در غیر این صورت به‌صورت یک کلیکِ ریز شنیده می‌شود.
// نیم‌ثانیه برای مرزِ وسطِ یک پاراگرافِ در جریان زیاد است و مکثِ غیرطبیعی می‌سازد.
const GAP_MS = 220;

// جدولِ موتورها. price = دلار بر کاراکتر (تخمینِ فالبک؛ هزینه‌ی واقعی اگر در دسترس باشد
// از خودِ سرویس خوانده می‌شود). maxChars از سقفِ ورودیِ همان سرویس می‌آید.
export const ENGINES = {
  'gpt4o-mini-tts': {
    label: '🗣 GPT-4o mini TTS',
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini-tts',
    voice: 'nova',
    maxChars: 3500,
    pricePerChar: 0.60 / 1_000_000,
    multiSpeaker: false,
  },
  'gemini-tts': {
    label: '🗣 Gemini TTS',
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-tts-preview',
    voice: 'Kore',
    maxChars: 3500,
    // قیمتِ توکنیِ این مدل با کاراکتر یکی نیست؛ این عدد فقط تخمینِ درشت است تا
    // ستونِ هزینه هرگز خالی نماند. عددِ دقیق از پاسخِ خودِ سرویس می‌آید.
    pricePerChar: 20 / 1_000_000,
    multiSpeaker: true,
  },
  elevenlabs: {
    label: '🗣 ElevenLabs',
    provider: 'elevenlabs',
    // مدلِ چندزبانه‌ی v3 فارسی را رسماً پشتیبانی می‌کند؛ تنها موتورِ لیستِ ما با این تضمین.
    model: 'eleven_v3',
    voice: '21m00Tcm4TlvDq8ikWAM', // Rachel — صدای پیش‌فرضِ عمومیِ سرویس
    maxChars: 2800,
    pricePerChar: 100 / 1_000_000,
    multiSpeaker: false,
  },
};

export const engineLabel = (key) => ENGINES[key]?.label || key;

// موتورهایی که کلیدشان ست است (ElevenLabs اختیاری است و بدونِ کلید اصلاً نمایش داده نمی‌شود).
export function availableEngines({ openrouterKey, elevenKey }) {
  return Object.entries(ENGINES)
    .filter(([, e]) => (e.provider === 'openrouter' ? !!openrouterKey : !!elevenKey))
    .map(([k]) => k);
}

/* ===== چانک‌بندی ===== */
// شکستن روی مرزِ پاراگراف، و اگر پاراگراف بزرگ‌تر از سقف بود روی مرزِ جمله.
// جمله‌ای که به‌تنهایی از سقف بزرگ‌تر باشد (عملاً غیرممکن در متنِ گفتاری) ناچار روی
// مرزِ فاصله بریده می‌شود تا هرگز وسطِ کلمه نشکند.
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

/* ===== آداپتورها ===== */
async function synthOpenRouter({ apiKey, engine, text, speed, fetchImpl }) {
  const res = await fetchImpl('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: engine.model,
      input: text,
      voice: engine.voice,
      response_format: 'mp3',
      ...(speed && speed !== 1 ? { speed } : {}),
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`TTS ${res.status}: ${msg.slice(0, 200)}`);
  }
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    genId: res.headers.get('x-generation-id') || '',
  };
}

async function synthElevenLabs({ apiKey, engine, text, speed, fetchImpl }) {
  const res = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${engine.voice}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: engine.model,
        ...(speed && speed !== 1 ? { voice_settings: { speed } } : {}),
      }),
    });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${msg.slice(0, 200)}`);
  }
  return { buf: Buffer.from(await res.arrayBuffer()), genId: '' };
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
// خروجی: {buffer, chars, costUsd, seconds, chunks, engine, degraded}
// degraded یعنی دیالوگ خواسته شده بود ولی موتور چند گوینده ندارد و روایتِ تک‌صدا ساخته شد.
export async function synthesize({
  engineKey, script, turns = null, speed = 1,
  openrouterKey, elevenKey, fetchImpl = fetch, generationCost = null,
}) {
  const engine = ENGINES[engineKey];
  if (!engine) throw new Error(`موتور ناشناخته: ${engineKey}`);
  const key = engine.provider === 'openrouter' ? openrouterKey : elevenKey;
  if (!key) throw new Error(`کلیدِ موتور ${engineKey} ست نشده است`);

  const wantsDialogue = Array.isArray(turns) && turns.length > 0;
  const degraded = wantsDialogue && !engine.multiSpeaker;
  const text = wantsDialogue
    ? (engine.multiSpeaker ? null : turnsToNarration(turns))
    : String(script || '');

  const pieces = engine.multiSpeaker && wantsDialogue
    ? chunkTurns(turns, engine.maxChars).map((g) =>
        g.map((t) => `${t.speaker === 'b' ? 'Speaker 2' : 'Speaker 1'}: ${t.text}`).join('\n'))
    : chunkText(text, engine.maxChars);

  if (!pieces.length) throw new Error('متنی برای تبدیل به صدا نیست');

  const dir = await mkdtemp(join(tmpdir(), 'dbrief-'));
  try {
    const files = [];
    let chars = 0;
    const genIds = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      chars += piece.length;
      const synth = engine.provider === 'openrouter' ? synthOpenRouter : synthElevenLabs;
      const { buf, genId } = await synth({ apiKey: key, engine, text: piece, speed, fetchImpl });
      if (!buf?.length) throw new Error(`چانک ${i + 1} خروجیِ صوتی نداد`);
      const f = join(dir, `p${String(i).padStart(3, '0')}.mp3`);
      await writeFile(f, buf);
      files.push(f);
      if (genId) genIds.push(genId);
      log(`🔊 chunk ${i + 1}/${pieces.length} (${piece.length} chars, ${buf.length} bytes)`);
    }

    const outPath = join(dir, 'episode.mp3');
    await concatMp3(files, outPath);
    const [buffer, seconds] = await Promise.all([readFile(outPath), probeSeconds(outPath)]);

    // هزینه: اول عددِ واقعیِ سرویس، وگرنه تخمینِ جدولِ قیمت.
    let costUsd = chars * engine.pricePerChar;
    if (generationCost && genIds.length) {
      const real = (await Promise.all(genIds.map((id) => generationCost(id).catch(() => null))))
        .filter((c) => typeof c === 'number');
      if (real.length === genIds.length) costUsd = real.reduce((a, b) => a + b, 0);
    }

    return { buffer, chars, costUsd, seconds, chunks: pieces.length, engine: engineKey, degraded };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((e) => logErr('tts tmp cleanup:', e.message));
  }
}
