#!/usr/bin/env node
// 🎙️ آزمایشگاهِ ویس‌به‌متن: کدام مدل، اسپانیاییِ محاوره‌ایِ لاتین را درست می‌شنود و چقدر خرج برمی‌دارد؟
//
// چرا هست: مسیرِ ویسِ فارسی و روسی فایلِ صوتی را در **همان یک فراخوانی** به Gemini
// می‌دهد. اسپانیایی نمی‌تواند، چون مدلِ خوانشش (`openai/gpt-5.6-luna`) صدا نمی‌فهمد؛ پس
// یک مرحله‌ی جدا لازم است و باید بین چند کاندیدا یکی را انتخاب کنیم. انتخاب بدونِ
// اندازه‌گیری یعنی حدس، و حدس روی مسیری که هزینه‌اش per دقیقه‌ی صداست گران تمام می‌شود.
//
// این ابزار دو عدد می‌دهد و هر دو لازم‌اند:
//   ۱) **WER** (نرخِ خطای کلمه) روی صدای واقعی، با متنِ مرجعِ انسانی.
//   ۲) **هزینه‌ی واقعیِ هر دقیقه صدا** از `usage.cost` خودِ OpenRouter، نه از جدولِ قیمت.
//
// ⚠️ گاردِ «خط‌کشِ کج» (بند ۹/۰ب ریشه): نمونه‌ای که مرجعش `verified` نباشد **نمره
// نمی‌گیرد**. زیرنویسِ خودکارِ یوتیوب یا خروجیِ یک ASR دیگر «مرجع» نیست؛ نمره‌دادن به
// آن یعنی سنجیدنِ «شباهت به آن ASR»، نه دقت. یک بار این اشتباه بشود، کلِ تصمیم روی
// خط‌کشِ کج نشسته و هیچ‌کس هم نمی‌فهمد.
//
// اجرا:
//   node tools/stt-eval.mjs --dry                      # بدونِ شبکه: سلامتِ خطِ لوله + سلفتستِ سنجه
//   node tools/stt-eval.mjs --dry --dir path/to/set    # همان، روی دیتاستِ واقعی (باز هم صفر هزینه)
//   node tools/stt-eval.mjs --dir path/to/set          # اجرای واقعی (پولی)
//   node tools/stt-eval.mjs --dir d --models google/gemini-2.5-flash-lite,openai/whisper-1:stt
//   node tools/stt-eval.mjs --dir d --out raw.json     # ذخیره‌ی خامِ همه‌چیز
//
// شکلِ دیتاست (هر دو پشتیبانی می‌شود):
//   الف) `manifest.json` در ریشه‌ی دیتاست:
//        { "items": [ { "id":"x", "audio":"clips/x.mp3", "reference":"…",
//                       "reference_status":"verified", "meta":{…} } ] }
//   ب) بدونِ manifest: هر فایلِ صوتی + یک فایلِ هم‌نامِ `.txt` کنارش (مرجع).
//      در این حالت مرجع‌ها `verified` فرض می‌شوند، چون خودت گذاشته‌ای‌شان.
//
// دو سبکِ فراخوانی، چون کاندیداها دو جورند:
//   `<slug>`      → chat completions با `input_audio` (مسیرِ Gemini/Voxtral، همان چیزی که ربات می‌کند)
//   `<slug>:stt`  → endpointِ اختصاصیِ `/api/v1/audio/transcriptions` (مسیرِ Whisper)
import fs from 'node:fs';
import path from 'node:path';

/* ═══════════════ پرچم‌ها ═══════════════ */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const DRY = flag('dry');
/* حالتِ fake: کلِ خطِ لوله **واقعاً** اجرا می‌شود (ساختِ بدنه، نمره‌دهی، جدول، هشدارها)
 * ولی پاسخ از یک استابِ محلی می‌آید نه از شبکه. چرا لازم است: `--dry` قبل از نمره‌دهی
 * برمی‌گردد، پس نیمه‌ی دومِ اسکریپت (WER، خلاصه، هشدارِ رتبه) اصلاً اجرا نمی‌شود. همان
 * تله‌ای که در آزمایشگاهِ خوانش یک بار کلِ یک دورِ پولی را سوزاند. */
const FAKE = flag('fake');
const DIR = val('dir', '');
const OUT = val('out', '');
const ONLY = (val('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = Number(val('limit', '0')) || 0;
const RETRIES = Number(val('retries', '1'));
const MAX_SEC = Number(val('max-seconds', '180'));      // گاردِ هزینه: فایلِ بلندتر رد می‌شود
const BUDGET = Number(val('budget', '0.50'));            // سقفِ تخمینیِ کلِ اجرا (دلار)
const SCORE_UNVERIFIED = flag('score-unverified');
const FMT_OVERRIDE = val('format', '');
const TIMEOUT_MS = Number(val('timeout', '180')) * 1000;

/* پرامپتِ رونویسی: **عیناً** همان چیزی که `orTranscribe` در
 * `bots/tarot/reading-core.js` به مدل می‌دهد. اگر آن‌جا عوض شد، این‌جا هم عوض شود،
 * وگرنه آزمایشگاه چیزی را می‌سنجد که محصول اجرا نمی‌کند. */
const PROMPT = val('prompt',
  'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.');

/* ═══════════════ کاندیداها ═══════════════
 * قیمت‌ها **فقط برای تخمینِ پیش‌پرواز** هستند (که قبل از خرج‌کردن بدانی چقدر می‌شود) و
 * هرگز به گزارشِ نهایی راه ندارند: عددِ نهایی همیشه `usage.cost` خودِ OpenRouter است.
 * منبع و تاریخِ این جدول در `bots/tarot/I18N-ES-STT-RESEARCH.md` ثبت است (۱ سپتامبر ۲۰۲۶).
 * اگر تخمین با عددِ واقعی بیش از ۲۵٪ فاصله داشت، گزارش هشدار می‌دهد یعنی جدول کهنه شده. */
const CATALOG = {
  'google/gemini-2.5-flash-lite': { mode: 'chat', audioPerMTok: 0.30, textIn: 0.10, out: 0.40, tokPerSec: 32 },
  'google/gemini-3.5-flash-lite': { mode: 'chat', audioPerMTok: 0.30, textIn: 0.30, out: 2.50, tokPerSec: 32 },
  'google/gemini-2.5-flash':      { mode: 'chat', audioPerMTok: 1.00, textIn: 0.30, out: 2.50, tokPerSec: 32 },
  'mistralai/voxtral-small-24b-2507': { mode: 'chat', audioPerSec: 0.0001, textIn: 0.10, out: 0.30 },
  'openai/whisper-1':             { mode: 'stt',  audioPerSec: 0.0001 },
};
const DEFAULT_MODELS = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.5-flash-lite',
  'google/gemini-2.5-flash',
  'mistralai/voxtral-small-24b-2507',
  'openai/whisper-1:stt',
];
const MODELS = (val('models', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const MODEL_LIST = MODELS.length ? MODELS : DEFAULT_MODELS;

/** `slug` یا `slug:stt` را به `{ id, mode }` باز می‌کند. */
function parseModel(spec) {
  const m = spec.match(/^(.*?)(?::(chat|stt))?$/);
  const id = m[1];
  const mode = m[2] || CATALOG[id]?.mode || 'chat';
  return { id, mode, spec };
}

/* ═══════════════ طولِ صدا بدونِ ffmpeg ═══════════════
 * چرا دستی: هزینه per **دقیقه‌ی صدا** است، پس بدونِ طولِ دقیق هیچ عددی معنا ندارد؛ و
 * این محیط (و رانرِ CI) لزوماً ffmpeg ندارد. سه فرمتی که واقعاً لازم داریم پوشش دارند:
 * wav (تستِ ساخته‌ی خودمان)، mp3 (کلیپ‌های بنچمارک) و ogg/opus (ویسِ واقعیِ تلگرام). */
const MP3_BR_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BR_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function wavDuration(buf) {
  if (buf.slice(0, 4).toString('latin1') !== 'RIFF' || buf.slice(8, 12).toString('latin1') !== 'WAVE') return null;
  let p = 12, rate = 0, byteRate = 0, dataLen = 0;
  while (p + 8 <= buf.length) {
    const id = buf.slice(p, p + 4).toString('latin1');
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { rate = buf.readUInt32LE(p + 12); byteRate = buf.readUInt32LE(p + 16); }
    else if (id === 'data') { dataLen = Math.min(size, buf.length - p - 8); break; }
    p += 8 + size + (size % 2);
  }
  if (!byteRate || !dataLen) return null;
  return { sec: dataLen / byteRate, how: `wav ${rate}Hz` };
}

export function mp3Duration(buf) {
  let p = 0;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') {
    p = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  let sec = 0, frames = 0;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) { p++; continue; }
    const ver = (buf[p + 1] >> 3) & 0x03, layer = (buf[p + 1] >> 1) & 0x03;
    const brIdx = (buf[p + 2] >> 4) & 0x0f, srIdx = (buf[p + 2] >> 2) & 0x03, pad = (buf[p + 2] >> 1) & 0x01;
    if (layer !== 1 || ver === 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { p++; continue; }
    const sr = MP3_SR[ver][srIdx];
    const br = (ver === 3 ? MP3_BR_V1L3 : MP3_BR_V2L3)[brIdx] * 1000;
    const len = Math.floor((ver === 3 ? 144 : 72) * br / sr) + pad;
    if (len < 24) { p++; continue; }
    sec += (ver === 3 ? 1152 : 576) / sr;
    frames++;
    p += len;
  }
  return frames ? { sec, how: `mp3 ${frames} frames` } : null;
}

export function oggDuration(buf) {
  if (buf.slice(0, 4).toString('latin1') !== 'OggS') return null;
  // نرخِ نمونه: Opus همیشه granule را روی ۴۸kHz می‌شمارد؛ Vorbis نرخش در هدرِ ID است.
  let rate = 48000;
  const head = buf.slice(0, Math.min(buf.length, 65536));
  const vi = head.indexOf(Buffer.from('vorbis', 'latin1'));
  if (vi > 0 && head[vi - 1] === 0x01) rate = head.readUInt32LE(vi + 6 + 4);
  const preSkipAt = head.indexOf(Buffer.from('OpusHead', 'latin1'));
  const preSkip = preSkipAt >= 0 ? head.readUInt16LE(preSkipAt + 10) : 0;
  let last = -1;
  for (let i = buf.length - 4; i >= 0; i--) {
    if (buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53) { last = i; break; }
  }
  if (last < 0 || last + 14 > buf.length) return null;
  const gp = Number(buf.readBigUInt64LE(last + 6));
  if (!Number.isFinite(gp) || gp <= 0) return null;
  return { sec: Math.max(0, gp - preSkip) / rate, how: `ogg ${rate}Hz` };
}

export function audioDuration(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const tries = ext === '.wav' ? [wavDuration, mp3Duration, oggDuration]
    : ext === '.ogg' || ext === '.oga' || ext === '.opus' ? [oggDuration, mp3Duration, wavDuration]
      : [mp3Duration, wavDuration, oggDuration];
  for (const f of tries) { const r = f(buf); if (r && r.sec > 0) return { ...r, bytes: buf.length }; }
  return null;
}

/* ═══════════════ نرمال‌سازی و WER ═══════════════ */
const PUNCT = /[.,;:!?¿¡"'“”«»…()\[\]{}\/*_~`|@#$%^&+=<>\\-]/g;

/** نرمال‌سازیِ پایه، دقیقاً همان چیزی که در سند اعلام شده: حروفِ کوچک، حذفِ نشانه‌گذاری،
 *  یکی‌کردنِ فاصله‌ها. **حروفِ باصدا (á é í ó ú ñ) دست‌نخورده می‌مانند**، چون در
 *  اسپانیایی معنا عوض می‌کنند (`esta` و `está` دو چیزند). */
export function normalize(s) {
  return String(s || '').normalize('NFC').toLowerCase()
    .replace(/[‐-―]/g, ' ')     // انواعِ خط تیره
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ').trim();
}

const FILLERS = new Set(['eh', 'ehh', 'ehm', 'em', 'mm', 'mmm', 'ah', 'ahh', 'uh', 'uhm', 'hmm', 'mhm']);
/** نسخه‌ی «شل»: علاوه بر بالا، اکسان‌ها را تا می‌کند و صداهای مکث را می‌اندازد.
 *  چرا: مرجع‌های انسانی معمولاً مکث‌ها را نمی‌نویسند ولی مدل می‌نویسدشان، و این مدلِ
 *  **صادق‌تر** را جریمه می‌کند. حذف از **هر دو طرف** انجام می‌شود تا سوگیری نسازد. */
export function normalizeLoose(s) {
  return normalize(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(' ').filter(w => w && !FILLERS.has(w)).join(' ');
}

/** فاصله‌ی ویرایشیِ کلمه‌ای با تفکیکِ جانشینی/حذف/درج. */
export function werCounts(refWords, hypWords) {
  const n = refWords.length, m = hypWords.length;
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  const op = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 0=ok 1=sub 2=del 3=ins
  for (let i = 1; i <= n; i++) { d[i][0] = i; op[i][0] = 2; }
  for (let j = 1; j <= m; j++) { d[0][j] = j; op[0][j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = refWords[i - 1] === hypWords[j - 1];
      const sub = d[i - 1][j - 1] + (same ? 0 : 1);
      const del = d[i - 1][j] + 1;
      const ins = d[i][j - 1] + 1;
      const best = Math.min(sub, del, ins);
      d[i][j] = best;
      op[i][j] = best === sub ? (same ? 0 : 1) : best === del ? 2 : 3;
    }
  }
  let i = n, j = m, S = 0, D = 0, I = 0;
  while (i > 0 || j > 0) {
    const o = i === 0 ? 3 : j === 0 ? 2 : op[i][j];
    if (o === 0) { i--; j--; }
    else if (o === 1) { S++; i--; j--; }
    else if (o === 2) { D++; i--; }
    else { I++; j--; }
  }
  return { S, D, I, N: n, errors: S + D + I, wer: n ? (S + D + I) / n : (m ? 1 : 0) };
}

export const wer = (ref, hyp, loose = false) => {
  const f = loose ? normalizeLoose : normalize;
  const r = f(ref).split(' ').filter(Boolean);
  const h = f(hyp).split(' ').filter(Boolean);
  return werCounts(r, h);
};

/* ═══════════════ دیتاست ═══════════════ */
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.flac', '.webm', '.aac']);
const fmtOf = (f) => FMT_OVERRIDE || ({ '.oga': 'ogg', '.opus': 'ogg' }[path.extname(f).toLowerCase()]
  || path.extname(f).toLowerCase().slice(1));

function loadDataset(dir) {
  const mfPath = path.join(dir, 'manifest.json');
  let items = [];
  if (fs.existsSync(mfPath)) {
    const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
    items = (mf.items || []).map(it => ({
      id: it.id || path.basename(it.audio),
      file: path.resolve(dir, it.audio),
      reference: it.reference || '',
      status: it.reference_status || (it.reference ? 'verified' : 'none'),
      // پیش‌نویسِ ماشینی (اگر هست) فقط برای اینکه انسانِ رونویس از صفر شروع نکند.
      // هرگز به‌عنوان مرجع استفاده نمی‌شود.
      draft: it.asr_draft_file && fs.existsSync(path.resolve(dir, it.asr_draft_file))
        ? fs.readFileSync(path.resolve(dir, it.asr_draft_file), 'utf8').trim() : '',
      meta: it.meta || {},
    }));
  } else {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!AUDIO_EXT.has(path.extname(f).toLowerCase())) continue;
      const base = f.replace(/\.[^.]+$/, '');
      const ref = ['.txt', '.ref.txt'].map(e => path.join(dir, base + e)).find(p => fs.existsSync(p));
      items.push({
        id: base, file: path.join(dir, f),
        reference: ref ? fs.readFileSync(ref, 'utf8').trim() : '',
        status: ref ? 'verified' : 'none', meta: {},
      });
    }
  }
  if (ONLY.length) items = items.filter(it => ONLY.includes(it.id));
  if (LIMIT) items = items.slice(0, LIMIT);
  for (const it of items) {
    if (!fs.existsSync(it.file)) { console.error(`❌ فایلِ صوتی نیست: ${it.file}`); process.exit(1); }
    const d = audioDuration(it.file);
    if (!d) { console.error(`❌ طولِ «${it.id}» خوانده نشد (فرمتِ ناشناخته). در manifest مقدارِ duration_sec بده.`); process.exit(1); }
    it.sec = d.sec; it.bytes = d.bytes; it.how = d.how;
  }
  return items;
}

/* ═══════════════ سلفتستِ سنجه (بدونِ شبکه، بدونِ هزینه) ═══════════════
 * چرا اجباری است: در این ریپو ۱۱ باگ از ۱۳ باگِ کارِ چندزبانه **در خودِ ابزار** بود، نه
 * در مدل (بند ۹/۰ب). یک WER که اشتباه حساب کند، آرام و مطمئن مدلِ بد را برنده اعلام
 * می‌کند. پس قبل از هر خرجی، خطکش با اعدادِ دستی‌محاسبه‌شده سنجیده می‌شود. */
function selfTest() {
  const cases = [];
  const eq = (name, got, want) => cases.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });

  eq('نرمال‌سازی: نشانه‌گذاری و فاصله', normalize('  ¿Qué  onda,  güey?! '), 'qué onda güey');
  eq('نرمال‌سازی: اکسان حفظ می‌شود', normalize('está'), 'está');
  eq('شل: اکسان تا می‌شود', normalizeLoose('Está'), 'esta');
  eq('شل: مکث حذف می‌شود', normalizeLoose('eh o sea eh bueno'), 'o sea bueno');

  // مرجع ۴ کلمه، فرضیه ۴ کلمه با یک جانشینی → WER = 1/4
  let r = wer('hola que tal amigo', 'hola que tal amiga');
  eq('یک جانشینی روی ۴ کلمه', [r.S, r.D, r.I, r.N, +r.wer.toFixed(4)], [1, 0, 0, 4, 0.25]);
  // یک درج → 1/4
  r = wer('hola que tal amigo', 'hola que tal amigo mio');
  eq('یک درج روی ۴ کلمه', [r.S, r.D, r.I, r.N, +r.wer.toFixed(4)], [0, 0, 1, 4, 0.25]);
  // یک حذف → 1/4
  r = wer('hola que tal amigo', 'hola que amigo');
  eq('یک حذف روی ۴ کلمه', [r.S, r.D, r.I, r.N, +r.wer.toFixed(4)], [0, 1, 0, 4, 0.25]);
  // یکسان → صفر
  r = wer('¡Hola! ¿Qué tal, che?', 'hola qué tal che');
  eq('یکسان بعد از نرمال‌سازی', [r.errors, +r.wer.toFixed(4)], [0, 0]);
  // خروجیِ خالی → WER کامل، نه NaN
  r = wer('hola que tal', '');
  eq('خروجیِ خالی = ۱۰۰٪', [r.D, +r.wer.toFixed(4)], [3, 1]);
  // اکسان در حالتِ سخت خطاست و در حالتِ شل نه (همان چیزی که ادعا می‌کنیم)
  eq('اکسان: سخت ۱ خطا', wer('esta cansado', 'está cansado').errors, 1);
  eq('اکسان: شل ۰ خطا', wer('esta cansado', 'está cansado', true).errors, 0);

  // خواننده‌های طول: با فایل‌های ساختگیِ کاملاً کنترل‌شده
  const wav = makeWav(1.5, 8000);
  eq('طولِ wav', +wavDuration(wav).sec.toFixed(3), 1.5);
  const mp3 = makeMp3(40);                       // ۴۰ فریمِ MPEG1 L3 روی ۴۴۱۰۰
  eq('طولِ mp3', +mp3Duration(mp3).sec.toFixed(4), +(40 * 1152 / 44100).toFixed(4));
  const ogg = makeOggOpus(2 * 48000);            // granule = ۲ ثانیه
  eq('طولِ ogg', +oggDuration(ogg).sec.toFixed(3), 2);

  const bad = cases.filter(c => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}${c.ok ? '' : `  (got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)})`}`);
  return bad.length === 0;
}

/* فایل‌های ساختگیِ سلفتست. عمداً در حافظه ساخته می‌شوند و در ریپو کامیت نمی‌شوند:
 * هدفشان سنجشِ **پارسر** است نه گوش‌دادن، پس بایتِ صوتیِ واقعی لازم ندارند. */
function makeWav(sec, rate) {
  const bytes = Math.round(sec * rate * 2);
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}
function makeMp3(frames) {
  const len = Math.floor(144 * 128000 / 44100);      // 417 بایت per فریم، بدونِ padding
  const out = Buffer.alloc(frames * len);
  for (let i = 0; i < frames; i++) {
    const o = i * len;
    out[o] = 0xff; out[o + 1] = 0xfb;                // MPEG1 Layer III، بدونِ CRC
    out[o + 2] = 0x90;                               // bitrate=128k، samplerate=44100، pad=0
    out[o + 3] = 0x64;
  }
  return out;
}
function makeOggOpus(granule) {
  const page = (gp, payload) => {
    const b = Buffer.alloc(27 + 1 + payload.length);
    b.write('OggS', 0); b[4] = 0; b[5] = 0;
    b.writeBigUInt64LE(BigInt(gp), 6);
    b.writeUInt32LE(1, 14); b.writeUInt32LE(0, 18); b.writeUInt32LE(0, 22);
    b[26] = 1; b[27] = payload.length;
    payload.copy(b, 28);
    return b;
  };
  const head = Buffer.alloc(19); head.write('OpusHead', 0); head[8] = 1; head[9] = 1;
  head.writeUInt16LE(0, 10);                          // pre-skip صفر تا حساب ساده بماند
  head.writeUInt32LE(48000, 12);
  return Buffer.concat([page(0, head), page(granule, Buffer.from([0xfc]))]);
}

/* ═══════════════ فراخوانیِ OpenRouter ═══════════════ */
const OR = 'https://openrouter.ai/api/v1';
const keyOf = () => process.env.OPENROUTER_API_KEY;

async function postJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${keyOf()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

/** استابِ حالتِ fake: متنی می‌سازد که **شبیهِ خروجیِ واقعی** باشد (نه یکسان با مرجع)
 *  تا مسیرِ جانشینی/حذف/درج هم اجرا شود و جدولِ خلاصه عددِ واقعی نشان بدهد. */
function fakeAnswer(model, item) {
  const base = item.reference || item.draft || 'hola que tal esto es una prueba de audio';
  const w = base.split(/\s+/).filter(Boolean);
  const seed = [...model.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = w.map((x, i) => (i % 17 === seed % 17 ? x + 's' : x));   // چند جانشینی
  if (out.length > 12) out.splice(seed % 7 + 3, 1);                    // یک حذف
  out.splice(2, 0, 'eh');                                              // یک درج (مکث)
  return { text: out.join(' '), usage: { cost: estimate(model, item.sec) ?? 0, prompt_tokens: Math.round(item.sec * 32) }, ms: 120 };
}

/** یک نمونه را به یک مدل می‌دهد و متن و هزینه را برمی‌گرداند. */
async function transcribe(model, item) {
  if (FAKE) return fakeAnswer(model, item);
  const data = fs.readFileSync(item.file).toString('base64');
  const format = fmtOf(item.file);
  const t0 = Date.now();
  let out;
  if (model.mode === 'stt') {
    // ⚠️ این endpoint سازگارِ OpenAI **نیست**: بدنه JSON است با base64 زیرِ `input_audio`،
    // نه multipart. منبع: skills/openrouter-stt در ریپوی رسمیِ OpenRouterTeam/skills.
    const d = await postJson(`${OR}/audio/transcriptions`, { model: model.id, input_audio: { data, format } });
    out = { text: String(d.text || '').trim(), usage: d.usage || {} };
  } else {
    const d = await postJson(`${OR}/chat/completions`, {
      model: model.id,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'input_audio', input_audio: { data, format } },
      ] }],
    });
    out = { text: String(d.choices?.[0]?.message?.content || '').trim(), usage: d.usage || {} };
  }
  return { ...out, ms: Date.now() - t0 };
}

/* ═══════════════ تخمینِ پیش‌پرواز ═══════════════ */
function estimate(model, sec) {
  const c = CATALOG[model.id];
  if (!c) return null;
  const outTok = Math.round(sec / 60 * 250);           // ~۲۵۰ توکنِ خروجی per دقیقه‌ی گفتار
  if (c.audioPerSec != null) return sec * c.audioPerSec + (c.out ? outTok * c.out / 1e6 : 0);
  return sec * (c.tokPerSec || 32) * c.audioPerMTok / 1e6
    + 60 * (c.textIn || 0) / 1e6
    + outTok * (c.out || 0) / 1e6;
}

/* ═══════════════ اجرا ═══════════════ */
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

async function main() {
  console.log('🎙️ stt-eval: سنجشِ ویس‌به‌متن روی OpenRouter\n');

  if (DRY) {
    console.log('▶ سلفتستِ سنجه و خواننده‌های طول (بدونِ شبکه)');
    if (!selfTest()) { console.error('\n❌ سلفتست شکست خورد. تا این درست نشود هیچ عددی قابلِ استناد نیست.'); process.exit(1); }
    console.log('  ✅ خط‌کش سالم است\n');
  }

  if (!DIR) {
    if (DRY) {
      console.log('ℹ️ دیتاستی داده نشد (`--dir`). فقط خطِ لوله سنجیده شد.');
      console.log('   برای سنجشِ واقعی یک پوشه با فایل‌های صوتی و مرجعِ انسانی بده.');
      process.exit(0);
    }
    console.error('❌ `--dir <path>` لازم است: پوشه‌ی دیتاست (صداها + مرجع‌ها).');
    process.exit(1);
  }
  if (!fs.existsSync(DIR)) { console.error(`❌ پوشه نیست: ${DIR}`); process.exit(1); }

  const items = loadDataset(DIR);
  if (!items.length) { console.error(`❌ هیچ نمونه‌ای در ${DIR} پیدا نشد.`); process.exit(1); }

  const verified = items.filter(it => it.status === 'verified' && it.reference);
  const unverified = items.filter(it => !(it.status === 'verified' && it.reference));
  const scored = SCORE_UNVERIFIED ? items.filter(it => it.reference) : verified;

  const totalSec = items.reduce((a, b) => a + b.sec, 0);
  console.log(`▶ دیتاست: ${items.length} نمونه، ${(totalSec / 60).toFixed(2)} دقیقه صدا`);
  console.log(`  مرجعِ تأییدشده: ${verified.length} | بدونِ مرجعِ معتبر: ${unverified.length}`);
  for (const it of items) {
    console.log(`   ${pad(it.id, 22)} ${padL(it.sec.toFixed(1) + 's', 8)} ${padL((it.bytes / 1024).toFixed(0) + 'KB', 8)}  ${pad(it.how, 16)} ${it.status}`);
  }
  const tooLong = items.filter(it => it.sec > MAX_SEC);
  if (tooLong.length) {
    console.error(`\n❌ ${tooLong.length} فایل بلندتر از ${MAX_SEC} ثانیه است (${tooLong.map(t => t.id).join(', ')}).`);
    console.error('   گاردِ هزینه است: یک فایلِ نیم‌ساعته در پنج مدل، پول را بی‌صدا می‌سوزاند. با `--max-seconds` بازش کن.');
    process.exit(1);
  }
  /* بدونِ مرجعِ تأییدشده هیچ عددی معنا ندارد. در اجرای واقعی این خطاست (پول خرج نکن)،
   * در `--dry` فقط هشدار است تا بتوانی دیتاستِ نیمه‌آماده را هم اعتبارسنجی کنی. */
  if (!scored.length) {
    const say = DRY ? console.log : console.error;
    say(DRY ? '\n⚠️ این دیتاست هنوز نمره‌پذیر نیست: هیچ نمونه‌ای مرجعِ تأییدشده ندارد.'
      : '\n❌ هیچ نمونه‌ای مرجعِ تأییدشده ندارد، پس WER معنایی ندارد.');
    say('   زیرنویسِ خودکار یا خروجیِ یک ASR دیگر «مرجع» نیست (بند ۹/۰ب ریشه).');
    say('   یک انسانِ اسپانیایی‌زبان باید متن را کلمه‌به‌کلمه تأیید کند، بعد `reference_status: "verified"` بشود.');
    say('   اگر واقعاً می‌خواهی روی مرجعِ تأییدنشده نمره بگیری (فقط برای دیباگِ خطِ لوله): `--score-unverified`.');
    if (!DRY) process.exit(1);
  }
  if (unverified.length) console.log(`\n⚠️ ${unverified.length} نمونه مرجعِ تأییدشده ندارد و در WER شمرده نمی‌شود (ولی می‌شود رونویسی‌شان را دید).`);

  const models = MODEL_LIST.map(parseModel);
  console.log(`\n▶ مدل‌ها: ${models.map(m => `${m.id}${m.mode === 'stt' ? ' (stt)' : ''}`).join(', ')}`);
  let estTotal = 0;
  for (const m of models) {
    const e = items.reduce((a, it) => a + (estimate(m, it.sec) ?? 0), 0);
    estTotal += e;
    console.log(`   ${pad(m.id, 36)} تخمین ${CATALOG[m.id] ? '$' + e.toFixed(5) : 'نامعلوم (در جدولِ قیمت نیست)'}`);
  }
  console.log(`   جمعِ تخمینی: $${estTotal.toFixed(5)}`);

  if (DRY) {
    console.log('\n✅ خشک تمام شد: دیتاست خوانده شد، طول‌ها درآمدند، سنجه سالم است، هیچ ریکوئستی نرفت.');
    process.exit(0);
  }
  if (!keyOf() && !FAKE) {
    console.error('\n❌ `OPENROUTER_API_KEY` ست نیست. این اسکریپت بدونِ کلید هیچ‌کاری نمی‌کند.');
    console.error('   روی رانرِ گیت‌هاب از Secrets بیاید، یا محلی: OPENROUTER_API_KEY=... node tools/stt-eval.mjs …');
    process.exit(1);
  }
  if (estTotal > BUDGET && !flag('yes') && !FAKE) {
    console.error(`\n❌ تخمینِ هزینه ($${estTotal.toFixed(4)}) از سقفِ $${BUDGET} بیشتر است. با \`--yes\` یا \`--budget\` ادامه بده.`);
    process.exit(1);
  }

  const raw = [];
  for (const m of models) {
    console.log(`\n═══ ${m.id}${m.mode === 'stt' ? ' (transcriptions)' : ' (chat)'} ═══`);
    for (const it of items) {
      let r = null, err = '';
      for (let a = 0; a <= RETRIES; a++) {
        try { r = await transcribe(m, it); break; }
        catch (e) { err = e.message; if (a < RETRIES) await new Promise(s => setTimeout(s, 1500)); }
      }
      if (!r) { console.log(`  ❌ ${pad(it.id, 22)} ${err.slice(0, 120)}`); raw.push({ model: m.spec, id: it.id, error: err }); continue; }
      const cost = Number(r.usage?.cost) || 0;
      const scoredHere = scored.includes(it);
      const strict = scoredHere ? wer(it.reference, r.text) : null;
      const loose = scoredHere ? wer(it.reference, r.text, true) : null;
      raw.push({
        model: m.spec, id: it.id, sec: it.sec, ms: r.ms, cost, usage: r.usage,
        hyp: r.text, ref: it.reference, scored: scoredHere,
        wer: strict?.wer ?? null, werLoose: loose?.wer ?? null,
        S: strict?.S ?? null, D: strict?.D ?? null, I: strict?.I ?? null, N: strict?.N ?? null,
      });
      const werTxt = strict ? `WER ${(strict.wer * 100).toFixed(1)}% (S${strict.S}/D${strict.D}/I${strict.I} از ${strict.N})` : 'بدونِ مرجع';
      console.log(`  ✅ ${pad(it.id, 22)} ${padL((r.ms / 1000).toFixed(1) + 's', 7)} $${cost.toFixed(6)}  ${werTxt}`);
    }
  }

  // ═══ گزارشِ نهایی ═══
  console.log('\n\n════════ خلاصه ════════');
  console.log(`${pad('model', 36)} ${padL('ok', 4)} ${padL('WER', 8)} ${padL('WER شل', 9)} ${padL('$ کل', 10)} ${padL('$/دقیقه', 10)} ${padL('میانگین ثانیه', 13)}`);
  console.log('─'.repeat(96));
  const summary = [];
  for (const m of models) {
    const rows = raw.filter(r => r.model === m.spec && !r.error);
    const sc = rows.filter(r => r.scored);
    const errs = sc.reduce((a, r) => a + (r.S + r.D + r.I), 0);
    const refN = sc.reduce((a, r) => a + r.N, 0);
    const looseErr = sc.reduce((a, r) => a + Math.round(r.werLoose * r.N), 0);
    const cost = rows.reduce((a, r) => a + r.cost, 0);
    const sec = rows.reduce((a, r) => a + r.sec, 0);
    const ms = rows.length ? rows.reduce((a, r) => a + r.ms, 0) / rows.length : 0;
    const W = refN ? errs / refN : null;
    const WL = refN ? looseErr / refN : null;
    const perMin = sec ? cost / (sec / 60) : 0;
    summary.push({ model: m.spec, ok: rows.length, wer: W, werLoose: WL, cost, perMin, ms });
    console.log(`${pad(m.id, 36)} ${padL(rows.length + '/' + items.length, 4)} ${padL(W == null ? '-' : (W * 100).toFixed(1) + '%', 8)} ${padL(WL == null ? '-' : (WL * 100).toFixed(1) + '%', 9)} ${padL('$' + cost.toFixed(5), 10)} ${padL('$' + perMin.toFixed(5), 10)} ${padL((ms / 1000).toFixed(1), 13)}`);
  }

  // 🔍 هشدارِ «خط‌کشِ کج»: اگر رتبه‌بندیِ سخت و شل یکی نباشد، نتیجه به انتخابِ
  // نرمال‌سازی وابسته است و نباید با آن تصمیمِ قطعی گرفت.
  const rank = (k) => summary.filter(s => s[k] != null).sort((a, b) => a[k] - b[k]).map(s => s.model).join('>');
  if (rank('wer') && rank('wer') !== rank('werLoose')) {
    console.log('\n⚠️ رتبه‌بندیِ WERِ سخت و شل یکی نیست:');
    console.log(`   سخت: ${rank('wer')}`);
    console.log(`   شل:  ${rank('werLoose')}`);
    console.log('   یعنی تفاوت در حدِ انتخابِ نرمال‌سازی است، نه در حدِ کیفیتِ مدل. نمونه بیشتر کن.');
  }
  // 🔍 هشدارِ جدولِ قیمتِ کهنه
  for (const s of summary) {
    const m = parseModel(s.model);
    const est = items.reduce((a, it) => a + (estimate(m, it.sec) ?? 0), 0);
    if (est > 0 && s.cost > 0 && Math.abs(s.cost - est) / est > 0.25) {
      console.log(`\n⚠️ ${m.id}: هزینه‌ی واقعی $${s.cost.toFixed(5)} با تخمینِ $${est.toFixed(5)} بیش از ۲۵٪ فرق دارد. جدولِ قیمتِ داخلِ اسکریپت کهنه شده؛ سند را به‌روز کن.`);
    }
  }
  const cheapest = summary.filter(s => s.wer != null).sort((a, b) => a.perMin - b.perMin)[0];
  const best = summary.filter(s => s.wer != null).sort((a, b) => a.wer - b.wer)[0];
  if (best && cheapest) {
    console.log(`\nبهترین WER: ${best.model} (${(best.wer * 100).toFixed(1)}٪)   |   ارزان‌ترین: ${cheapest.model} ($${cheapest.perMin.toFixed(5)}/دقیقه)`);
    if (best.model !== cheapest.model && cheapest.perMin > 0) {
      const gap = ((cheapest.wer - best.wer) * 100).toFixed(1);
      const times = (best.perMin / cheapest.perMin).toFixed(1);
      console.log(`تصمیم: ارزان‌ترین ${gap} واحد WER بدتر است و ${times} برابر ارزان‌تر. با حجمِ ویسِ ماهانه ضرب کن، بعد انتخاب کن.`);
    } else if (best.model !== cheapest.model) {
      console.log('⚠️ هزینه‌ی ارزان‌ترین مدل صفر گزارش شد (احتمالاً `usage.cost` نیامده). نسبتِ هزینه قابلِ محاسبه نیست.');
    }
  }

  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ dir: DIR, prompt: PROMPT, at: new Date().toISOString(), summary, raw }, null, 2)); console.log(`\n💾 خام: ${OUT}`); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
}
