// worker کم‌اولویتِ نگه‌داری داشبورد. جدا از HTTP اجرا می‌شود تا SQLite هم‌زمان،
// دسترسی ادمین را قفل نکند. این فایل مستقیماً با Node اجرا می‌شود، نه PM2.
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMaintenance } from './maintenance.js';
import { log, logErr } from '../../../shared/logger.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = join(DIR, '..', 'data', 'maintenance.lock');

function acquireLock() {
  try {
    const fd = openSync(LOCK_FILE, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    return fd;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // ری‌استارتِ داشبورد می‌تواند lockِ workerِ کشته‌شده را جا بگذارد. فقط اگر PID دیگر
    // زنده نیست، lock کهنه را پس می‌گیریم؛ اجرای هم‌زمان هیچ‌وقت مجاز نیست.
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
    log('maintenance worker: اجرای قبلی هنوز در حال کار است؛ اجرای تکراری رد شد');
  } else {
    try { process.setPriority(19); } catch {}
    runMaintenance();
  }
} catch (e) {
  logErr('maintenance worker:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  try { if (lock !== undefined && lock !== null) closeSync(lock); } catch {}
  try { if (lock !== undefined && lock !== null) unlinkSync(LOCK_FILE); } catch {}
}
