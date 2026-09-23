// جاروی نگه‌داری روزانه: rollup روزانه‌ی events هر ربات در platform.db + (اختیاری) حذف خام‌های قدیمی.
// حذف پیش‌فرض خاموش است (settings: events_retention_days خالی/۰ = فقط rollup، بدون حذف) —
// چون حذف داده برگشت‌ناپذیر است، روشن کردنش تصمیم صریح ادمین در صفحه‌ی مارکتینگ/تنظیمات است.
import { instances, withDb, withWritableDb, hasTable, rows } from '../lib/bots.js';
import { pdb, getSetting, setSetting, audit } from './platform.js';
import { logErr, log } from '../../../shared/logger.js';
import { nowSec, tehranDayStart } from './util.js';

const SWEEP_EVERY_S = 6 * 3600; // هر ۶ ساعت چک؛ فقط اگر از آخرین اجرا ≥۲۰ ساعت گذشته باشد اجرا می‌شود
// رویدادِ دیررس (مثلاً نوشتنی که نیمه‌شب تمام شده) را می‌گیریم، اما هر روز کلِ تاریخچه را
// دوباره نمی‌خوانیم. داده‌ی ربات append-only است و rollup هم INSERT OR REPLACE است، پس
// سه روزِ آخر برای تصحیح امن است و تاریخ‌های قدیمیِ از قبل ساخته‌شده دست‌نخورده می‌مانند.
const RECONCILE_DAYS = 3;

export function rollupWindow(now = nowSec()) {
  // فقط روزهای کامل‌شده: شروع امروزِ تهران انتهای بازه است، نه «۲۴ ساعت قبل» که ممکن
  // است بخشی از امروز را داخلِ rollup ببرد.
  const upTo = tehranDayStart(0);
  return { from: upTo - RECONCILE_DAYS * 86400, upTo };
}

function rollupInstance(inst, { from, upTo }) {
  const rowsAgg = withDb(inst.file, (db) => {
    if (!hasTable(db, 'events')) return [];
    return rows(db, `
      SELECT date(created_at + 12600, 'unixepoch') day, event,
             COUNT(DISTINCT user_id) users, COUNT(*) cnt
      FROM events
      WHERE created_at >= ? AND created_at < ?
      GROUP BY day, event`, [from, upTo]);
  }, []);
  const up = pdb.prepare('INSERT OR REPLACE INTO events_rollup (bot, day, event, users, cnt) VALUES (?,?,?,?,?)');
  const tx = pdb.transaction((rs) => { for (const r of rs) up.run(inst.id, r.day, r.event, r.users, r.cnt); });
  tx(rowsAgg);
  return rowsAgg.length;
}

function pruneInstance(inst, retentionDays) {
  const cutoff = nowSec() - retentionDays * 86400;
  let deleted = 0;
  withWritableDb(inst.file, (db) => {
    if (!hasTable(db, 'events')) return;
    deleted = db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff).changes;
  });
  return deleted;
}

export function runMaintenance() {
  try {
    const last = parseInt(getSetting('maintenance_last_run', '0'), 10) || 0;
    if (nowSec() - last < 20 * 3600) return;
    const window = rollupWindow();
    const retention = parseInt(getSetting('events_retention_days', '0'), 10) || 0;
    for (const inst of instances()) {
      const n = rollupInstance(inst, window);
      let pruned = 0;
      if (retention >= 30) pruned = pruneInstance(inst, retention); // گارد: کمتر از ۳۰ روز هرگز
      if (n || pruned) log(`maintenance ${inst.id}: rollup=${n} روز-رویداد (۳ روز آخر)${pruned ? ` حذف خام=${pruned}` : ''}`);
      if (pruned) audit('maintenance.prune', inst.id, `retention=${retention}d deleted=${pruned}`);
    }
    // فقط پس از اجرای کامل مهر می‌زنیم؛ خطا نباید ۲۰ ساعت تلاشِ بعدی را بی‌صدا حذف کند.
    setSetting('maintenance_last_run', String(nowSec()));
  } catch (e) { logErr('maintenance:', e.message); }
}

export function scheduleMaintenance() {
  /* `better-sqlite3` هم‌زمانیِ Node را بلوکه می‌کند. این کار عمداً در worker جدا اجرا
   * می‌شود تا گزارش‌گیری حتی روی دیسکِ شلوغ، حلقه‌ی HTTP و صفحه‌ی ورود را نگه ندارد.
   * worker خودش lock دارد؛ اگر deploy یا timer دوباره صدا بزند، اجرای دوم بی‌صدا خارج
   * می‌شود. `ionice` در Linux این خواندنِ صرفاً تحلیلی را پشتِ کارهای ربات‌ها می‌گذارد. */
  const launch = async () => {
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const worker = fileURLToPath(new URL('./maintenance-worker.js', import.meta.url));
    const start = (cmd, args) => {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return child;
    };
    if (process.platform !== 'linux') return start(process.execPath, [worker]);
    // `ionice` روی VPS موجود است؛ اگر روزی حذف شد، fallback هنوز کار را اجرا می‌کند.
    const child = start('ionice', ['-c', '3', process.execPath, worker]);
    child.once('error', () => start(process.execPath, [worker]));
  };
  setTimeout(launch, 60_000); // اولین اجرا یک دقیقه بعد از boot
  setInterval(launch, SWEEP_EVERY_S * 1000);
}
