// کشِ جدا از پردازش HTTP برای نمای اصلی داشبورد.
//
// گزارش /dash چند دیتابیسِ SQLite را با better-sqlite3 (همگام) می‌خواند. اجرای آن
// داخل handler یعنی یک کوئری کند، ورود و همه‌ی درخواست‌های بعدی را هم پشت خود نگه
// می‌داشت. این ماژول فقط HTML آماده را از دیسک می‌خواند؛ ساخت نسخه‌ی تازه در worker
// کم‌اولویت انجام می‌شود.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, logErr } from '../../../shared/logger.js';

const CACHE_DIR = process.env.DASH_CACHE_DIR
  || fileURLToPath(new URL('../data/dash-cache/', import.meta.url));
const WORKER = fileURLToPath(new URL('./dash-cache-worker.js', import.meta.url));
const FRESH_FOR_MS = 5 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
const BUILD_BUDGET_MS = 3 * 60 * 1000;
const ANALYTICS_PATHS = new Set(['/dash', '/engagement', '/acquisition', '/economics', '/funnels', '/screens', '/retention']);

let running = false;
const queued = new Map();
const retryAfter = new Map();

/** فقط صفحه‌های تحلیلی cache می‌شوند و پارامترهای نمایشیِ معادل، یک cache مشترک دارند. */
export function canonicalAnalyticsUrl(rawUrl) {
  const source = rawUrl instanceof URL ? rawUrl : new URL(rawUrl, 'http://127.0.0.1');
  const path = ANALYTICS_PATHS.has(source.pathname) ? source.pathname : '/dash';
  const q = source.searchParams;
  const bot = /^[a-z0-9-]+(?:@[a-z0-9-]+)?$/.test(q.get('bot') || '') ? q.get('bot') : 'tarot';
  const out = new URLSearchParams({ bot });
  if (path === '/dash') {
    const range = ['day', 'week', 'month', 'all'].includes(q.get('range')) ? q.get('range') : 'week';
    const rawAw = Number.parseInt(q.get('aw') || '7', 10);
    const aw = Number.isInteger(rawAw) ? Math.max(1, Math.min(7, rawAw)) : 7;
    out.set('range', range);
    out.set('aw', String(aw));
    out.set('g', q.get('g') === 'cum' ? 'cum' : 'inc');
  } else {
    // پیامِ یک‌بارمصرف و علامتِ refresh نباید cache را تکثیر کنند. بقیه‌ی فیلترها
    // همان‌طور که route اعتبارسنجی می‌کند حفظ می‌شوند تا داده‌ی دو فیلتر قاطی نشود.
    for (const [key, value] of [...q.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!['bot', 'msg', 'refresh'].includes(key)) out.append(key, value);
    }
  }
  return `${path}?${out.toString()}`;
}

// نام قدیمی را برای تست‌ها و مصرف‌کننده‌های داخلی نگه می‌داریم.
export const canonicalDashUrl = canonicalAnalyticsUrl;

export function dashCacheKey(rawUrl) {
  return createHash('sha256').update(canonicalAnalyticsUrl(rawUrl)).digest('hex');
}

const cacheFile = (key) => join(CACHE_DIR, `${key}.json`);

export function readDashCache(rawUrl) {
  try {
    const item = JSON.parse(readFileSync(cacheFile(dashCacheKey(rawUrl)), 'utf8'));
    return typeof item.body === 'string' && Number.isFinite(item.createdAt) ? item : null;
  } catch { return null; }
}

/** atomic rename: بازدیدکننده هرگز JSON نیمه‌نوشته نمی‌خواند. */
export function writeDashCache(rawUrl, body, createdAt = Date.now()) {
  const key = dashCacheKey(rawUrl);
  const target = cacheFile(key);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ createdAt, body }));
  renameSync(tmp, target);
}

const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const updatedAt = (ms) => new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'medium',
}).format(new Date(ms));
const refreshForm = (url, label = 'به‌روزرسانی همین بخش') => `<form method="post" action="/analytics/refresh" class="inline" style="margin-inline-start:auto">
  <input type="hidden" name="target" value="${escapeAttr(canonicalAnalyticsUrl(url))}">
  <button type="submit">↻ ${label}</button>
</form>`;

const waitingBody = (url) => `<div class="card" role="status">
  <h2>📊 در حال آماده‌سازی آمار</h2>
  <p>هنوز هیچ نسخهٔ آماده‌ای از این بخش نداریم؛ اولین محاسبه در پس‌زمینه اجرا شده است. این صفحه خودکار به‌روز می‌شود و ورود، پشتیبانی و عملیات کاربر در این فاصله در دسترس‌اند.</p>
  <p class="muted">اگر دادهٔ حجیم باشد، ممکن است آماده‌شدن آن چند دقیقه طول بکشد.</p>
  ${refreshForm(url, 'تلاش دوباره برای همین بخش')}
</div><script>setTimeout(() => location.reload(), 5000)</script>`;

const freshnessNote = (url, createdAt, refreshing) => `<div class="card muted" role="status" style="display:flex;align-items:center;gap:.75rem">
  <span>📊 داده‌ها آخرین‌بار در ${updatedAt(createdAt)} به‌روزرسانی شده‌اند${refreshing ? '؛ نسخهٔ تازه در پس‌زمینه در حال آماده‌سازی است.' : '.'}</span>
  ${refreshForm(url)}
</div>`;

function queueBuild(rawUrl, { force = false } = {}) {
  const canonical = canonicalAnalyticsUrl(rawUrl);
  const key = dashCacheKey(canonical);
  if (queued.has(key)) return;
  // فقط یک worker هم‌زمان داریم، ولی درخواستِ بخش بعدی باید پشتِ آن واقعاً صف شود.
  if (running) { queued.set(key, canonical); return; }
  if (!force && Date.now() < (retryAfter.get(key) || 0)) return;
  queued.set(key, canonical);
  runNext();
}

function spawnWorker(url, done) {
  const child = spawn(process.execPath, [WORKER, url], { stdio: 'ignore' });
  let finished = false;
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    done(ok);
  };
  const killTimer = setTimeout(() => {
    logErr('dashboard cache: build exceeded 3 minutes; keeping the last good view');
    child.kill('SIGTERM');
  }, BUILD_BUDGET_MS);
  child.once('error', () => finish(false));
  child.once('close', (code) => finish(code === 0));
  return child;
}

function runNext() {
  if (running) return;
  const next = queued.entries().next().value;
  if (!next) return;
  const [key, url] = next;
  queued.delete(key);
  running = true;
  spawnWorker(url, (ok) => {
    running = false;
    if (!ok) retryAfter.set(key, Date.now() + RETRY_AFTER_FAILURE_MS);
    else log(`dashboard cache refreshed: ${url}`);
    runNext();
  });
}

/** مسیر HTTP: فقط خواندنِ کوتاه از فایل + صف‌کردن worker؛ هیچ SQLite ای این‌جا نیست. */
export function cachedAnalyticsBody(url) {
  const item = readDashCache(url);
  const ageMs = item ? Date.now() - item.createdAt : Infinity;
  if (!item || ageMs >= FRESH_FOR_MS) queueBuild(url);
  const refreshing = !item || ageMs >= FRESH_FOR_MS || queued.has(dashCacheKey(url));
  return item ? `${freshnessNote(url, item.createdAt, refreshing)}${item.body}` : waitingBody(url);
}

export const cachedDashBody = cachedAnalyticsBody;

/** دکمهٔ دستی فقط همان URL canonical را صف می‌کند؛ سایر گزارش‌ها منتظرش نمی‌مانند. */
export function refreshAnalyticsSection(url) {
  queueBuild(url, { force: true });
  return canonicalAnalyticsUrl(url);
}

/** prewarm برای مسیر معمول بعد از boot؛ کاربر اول قربانی ساخت گزارش نمی‌شود. */
export function prewarmDashCache() {
  queueBuild('/dash?bot=tarot&range=week&aw=7&g=inc');
}
