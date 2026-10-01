// worker کم‌اولویتِ ثبتِ شبانه‌ی ترندها (`lib/trends.js: scheduleTrends`). جدا از HTTP اجرا
// می‌شود چون اولین اجرا کلِ تاریخچه را می‌خواند. stdout/stderr به لاگِ pm2ِ داشبورد وصل است.
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrendSnapshot } from './trends.js';
import { log, logErr } from '../../../shared/logger.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = join(DIR, '..', 'data', 'trends.lock');

function acquireLock() {
  try {
    const fd = openSync(LOCK_FILE, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    return fd;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // lockِ workerِ کشته‌شده (ری‌استارتِ داشبورد) فقط وقتی پس گرفته می‌شود که PID مرده باشد
    let pid = 0;
    try { pid = Number(JSON.parse(readFileSync(LOCK_FILE, 'utf8')).pid) || 0; } catch {}
    try { if (pid > 0) process.kill(pid, 0); return null; } catch {}
    unlinkSync(LOCK_FILE);
    return acquireLock();
  }
}

let lock;
try {
  lock = acquireLock();
  if (lock === null) {
    log('📈 TRENDS: اجرای قبلی هنوز در حال کار است؛ این اجرا رد شد');
  } else {
    try { process.setPriority(19); } catch {}
    const r = runTrendSnapshot();
    if (r.inserted) log(`📈 TRENDS scopes=${r.scopes} days=${r.days} inserted=${r.inserted} ms=${r.ms}`);
  }
} catch (e) {
  logErr('❌ TRENDS worker:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  try { if (lock !== undefined && lock !== null) closeSync(lock); } catch {}
  try { if (lock !== undefined && lock !== null) unlinkSync(LOCK_FILE); } catch {}
}
