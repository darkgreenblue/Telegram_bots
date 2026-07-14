// audio.js — دانلود ویس، برش با ffmpeg (قطعه‌های همپوشان)، رونویسیِ مقاوم، و merge درزها.
// الگوها از voice2text کپی شده (نه import — voice2text خودکفاست). ffmpeg/ffprobe باینری سیستم‌اند
// (deploy روی سرور نصبشان می‌کند). قطعه‌بندی برای ویس‌های بلند: تا ~۱ ساعت گفتار.
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { log, logErr } from '../../shared/logger.js';

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TELEGRAM_MAX_DOWNLOAD = 20 * 1024 * 1024; // سقف getFile تلگرام
export const MAX_VOICE_SEC = 3900;                      // ~۶۵ دقیقه
const CHUNK_THRESHOLD = 200;                            // بالاتر از این ثانیه → قطعه‌بندی
const CHUNK_CORE = 180;                                 // طول هسته‌ی هر قطعه
const CHUNK_OVERLAP = 10;                               // همپوشانی هر طرف (ضد قطع وسط کلمه)

// رونویسی فقط با مدل‌های صوتی (deepseek متن‌محور است و به‌درد نمی‌خورد).
const TRANSCRIBE_PLAN = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash', 'google/gemini-2.5-pro'];

function tmpPath(tag) {
  return `/tmp/sec_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// دانلود فایل تلگرام با ۳ تلاش و backoff (الگوی voice2text).
export async function downloadFile(telegram, fileId) {
  const fileUrl = await telegram.getFileLink(fileId);
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(1000 * i);
    try {
      const res = await fetch(fileUrl.href);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { lastErr = e; logErr('download attempt', i + 1, e.message); }
  }
  throw lastErr || new Error('download failed');
}

// مدت واقعی فایل (تلگرام برای داکیومنت duration نمی‌دهد و گاهی برای audio هم نادرست است).
export async function probeDurationSec(buffer) {
  const inPath = tmpPath('probe');
  writeFileSync(inPath, buffer);
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', inPath,
    ]);
    const sec = parseFloat(String(stdout).trim());
    return (isFinite(sec) && sec > 0) ? sec : null;
  } catch (e) {
    logErr('ffprobe error:', e.message);
    return null;
  } finally {
    try { unlinkSync(inPath); } catch {}
  }
}

// پلنِ قطعه‌بندی. مدت کوتاه → یک قطعه‌ی کامل (dur=null یعنی بدون -t). بلند → قطعه‌های همپوشان.
export function planChunks(durationSec) {
  const dur = Number(durationSec) || 0;
  if (dur <= CHUNK_THRESHOLD || dur === 0) return [{ idx: 0, start: 0, dur: null }];
  const chunks = [];
  let idx = 0;
  for (let s = 0; s < dur; s += CHUNK_CORE) {
    const start = Math.max(0, s - CHUNK_OVERLAP);
    const end = Math.min(dur, s + CHUNK_CORE + CHUNK_OVERLAP);
    chunks.push({ idx, start: +start.toFixed(2), dur: +(end - start).toFixed(2) });
    idx++;
  }
  return chunks;
}

// یک برش از بافر را به mp3 تک‌کاناله‌ی سبک تبدیل می‌کند. startSec=0 و durSec=null → کل فایل.
export async function sliceToMp3(buffer, startSec = 0, durSec = null) {
  const inPath = tmpPath('in');
  const outPath = tmpPath('out') + '.mp3';
  writeFileSync(inPath, buffer);
  const args = ['-y'];
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push('-i', inPath);
  if (durSec) args.push('-t', String(durSec));
  args.push('-ar', '16000', '-ac', '1', '-b:a', '64k', outPath);
  const t0 = Date.now();
  try {
    await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 });
    const out = readFileSync(outPath);
    log(`✅ ffmpeg slice [${startSec}+${durSec ?? 'all'}] → ${(out.length / 1024).toFixed(0)}KB in ${Date.now() - t0}ms`);
    return out;
  } finally {
    try { unlinkSync(inPath); } catch {}
    try { unlinkSync(outPath); } catch {}
  }
}

// رونویسی مقاوم: چند مدل صوتی به‌ترتیب؛ خروجی خالی = تلاش بعدی. null اگر همه شکست بخورند.
export async function transcribeResilient(or, mp3Buffer) {
  for (let i = 0; i < TRANSCRIBE_PLAN.length; i++) {
    const model = TRANSCRIBE_PLAN[i];
    try {
      const out = await or.transcribe(mp3Buffer, 'mp3', { model });
      if (out && out.trim()) return out.trim();
      logErr(`transcribe empty (attempt ${i + 1}, ${model})`);
    } catch (e) {
      logErr(`transcribe error (attempt ${i + 1}, ${model}):`, e.message);
    }
    if (i < TRANSCRIBE_PLAN.length - 1) await sleep(1500);
  }
  return null;
}

// merge قطعه‌ها با dedupِ درز: طولانی‌ترین رانِ توکنیِ مشترک بین انتهای i و ابتدای i+1 را حذف می‌کند.
export function mergeTranscripts(parts) {
  const clean = parts.map((p) => String(p || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || '';
  let merged = clean[0];
  for (let i = 1; i < clean.length; i++) {
    merged = spliceOverlap(merged, clean[i]);
  }
  return merged;
}

function spliceOverlap(a, b) {
  const WINDOW = 60, MIN_RUN = 4;
  const aTok = a.split(' ');
  const bTok = b.split(' ');
  const aTail = aTok.slice(-WINDOW);
  const bHead = bTok.slice(0, WINDOW);
  // بزرگ‌ترین k که suffixِ aTail برابر prefixِ bHead باشد (با حداقل MIN_RUN توکن)
  let best = 0;
  const maxK = Math.min(aTail.length, bHead.length);
  for (let k = maxK; k >= MIN_RUN; k--) {
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (norm(aTail[aTail.length - k + j]) !== norm(bHead[j])) { ok = false; break; }
    }
    if (ok) { best = k; break; }
  }
  if (best >= MIN_RUN) {
    return (aTok.concat(bTok.slice(best))).join(' ');
  }
  return a + '\n' + b;
}
const norm = (t) => String(t).toLowerCase().replace(/[.,،؛!؟?"«»()]/g, '');
