// جاروی نگه‌داری روزانه: rollup روزانه‌ی events هر ربات در platform.db + (اختیاری) حذف خام‌های قدیمی.
// حذف پیش‌فرض خاموش است (settings: events_retention_days خالی/۰ = فقط rollup، بدون حذف) —
// چون حذف داده برگشت‌ناپذیر است، روشن کردنش تصمیم صریح ادمین در صفحه‌ی مارکتینگ/تنظیمات است.
import { instances, withDb, withWritableDb, hasTable, rows } from '../lib/bots.js';
import { pdb, getSetting, setSetting, audit } from './platform.js';
import { logErr, log } from '../../../shared/logger.js';
import { nowSec, tehranDayStr } from './util.js';

const SWEEP_EVERY_S = 6 * 3600; // هر ۶ ساعت چک؛ فقط اگر از آخرین اجرا ≥۲۰ ساعت گذشته باشد اجرا می‌شود

function rollupInstance(inst) {
  // روزهای کامل‌شده (تا دیروزِ تهران) را جمع می‌زنیم — امروزِ ناتمام rollup نمی‌شود
  const upTo = nowSec() - 86400;
  const rowsAgg = withDb(inst.file, (db) => {
    if (!hasTable(db, 'events')) return [];
    return rows(db, `
      SELECT date(created_at + 12600, 'unixepoch') day, event,
             COUNT(DISTINCT user_id) users, COUNT(*) cnt
      FROM events WHERE created_at <= ? GROUP BY day, event`, [upTo]);
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
    setSetting('maintenance_last_run', String(nowSec()));
    const retention = parseInt(getSetting('events_retention_days', '0'), 10) || 0;
    for (const inst of instances()) {
      const n = rollupInstance(inst);
      let pruned = 0;
      if (retention >= 30) pruned = pruneInstance(inst, retention); // گارد: کمتر از ۳۰ روز هرگز
      if (n || pruned) log(`maintenance ${inst.id}: rollup=${n} روز-رویداد${pruned ? ` حذف خام=${pruned}` : ''}`);
      if (pruned) audit('maintenance.prune', inst.id, `retention=${retention}d deleted=${pruned}`);
    }
  } catch (e) { logErr('maintenance:', e.message); }
}

export function scheduleMaintenance() {
  setTimeout(runMaintenance, 60_000); // اولین اجرا یک دقیقه بعد از boot
  setInterval(runMaintenance, SWEEP_EVERY_S * 1000);
}
