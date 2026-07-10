// shared/ab.js — موتور A/B تست (قرارداد CLAUDE.md ریشه، بند ۲الف)
// قوانین shared: بدون npm؛ db با DI. طراحی طبق بنچمارک GrowthBook/Statsig + نقد متخصص‌ها:
//  - انتساب با هش قطعی (بدون ذخیره‌ی state) + ثبت exposure در لحظه‌ی دیدن variant
//  - **منبع حقیقت variant برای کاربرِ expose شده خودِ ab_exposures است** (sticky در برابر هر تغییر config)
//  - چرخه: draft → running → draining|stopped
//      draining (توقف نرم): exposure جدید ممنوع؛ expose شده‌ها تا پایان فلوشان همان variant را می‌گیرند
//      stopped (kill/پایان): همه فوراً control — kill switch برای variant باگ‌دار، بدون deploy
//  - وزن‌ها بعد از start فریز (تغییر وزن = آزمایش جدید) → sticky-bucket store لازم نیست
// خطای A/B هرگز فلو را نمی‌شکند: هر خطایی → control.
import { createHash } from 'crypto';
import { logErr } from './logger.js';
import { EVENTS, track } from './analytics.js';

export const AB_SCHEMA_VERSION = 1;
export const AB_STATUSES = ['draft', 'running', 'draining', 'stopped'];

// ساخت idempotent جدول‌ها — بعد از ensureAnalytics صدا زده شود (بات و داشبورد هر دو)
export function ensureAb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      key             TEXT PRIMARY KEY,
      name            TEXT    NOT NULL DEFAULT '',
      hypothesis      TEXT    NOT NULL DEFAULT '',
      mode            TEXT    NOT NULL DEFAULT 'split',      -- split | switchover
      metric_kind     TEXT    NOT NULL DEFAULT 'rate',       -- rate | value
      variants_json   TEXT    NOT NULL DEFAULT '[{"key":"control","weight":50},{"key":"b","weight":50}]',
      status          TEXT    NOT NULL DEFAULT 'draft',      -- draft|running|draining|stopped
      decision        TEXT    NOT NULL DEFAULT '',           -- shipped|rolled_back|inconclusive + یادداشت
      primary_metric  TEXT    NOT NULL DEFAULT '',           -- نام رویداد (مثل product_delivered)
      guardrails_json TEXT    NOT NULL DEFAULT '[]',         -- آرایه‌ی نام رویدادهای گاردریل (مثل refund)
      started_at      INTEGER,
      stopped_at      INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS ab_exposures (
      experiment_key TEXT    NOT NULL,
      user_id        INTEGER NOT NULL,
      variant        TEXT    NOT NULL,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (experiment_key, user_id)
    );
  `);
}

const prepCache = new WeakMap();
function prep(db) {
  let c = prepCache.get(db);
  if (!c) {
    c = {
      getExposure: db.prepare('SELECT variant FROM ab_exposures WHERE experiment_key=? AND user_id=?'),
      insertExposure: db.prepare('INSERT OR IGNORE INTO ab_exposures (experiment_key, user_id, variant) VALUES (?,?,?)'),
      allExperiments: db.prepare('SELECT * FROM experiments'),
    };
    prepCache.set(db, c);
  }
  return c;
}

// کش ۶۰ثانیه‌ای config آزمایش‌ها (داشبورد status را در DB عوض می‌کند؛ بدون deploy اثر می‌کند)
const CACHE_MS = 60_000;
const expCache = new WeakMap(); // db -> { at, map }
function getExp(db, key) {
  let c = expCache.get(db);
  if (!c || Date.now() - c.at > CACHE_MS) {
    c = { at: Date.now(), map: new Map() };
    try { for (const e of prep(db).allExperiments.all()) c.map.set(e.key, e); } catch {}
    expCache.set(db, c);
  }
  return c.map.get(key) || null;
}

// هش قطعی [0,1) — شامل نام آزمایش تا bucket بندی آزمایش‌ها از هم مستقل باشد
function hash01(s) {
  return createHash('sha1').update(s).digest().readUInt32BE(0) / 0x100000000;
}

// انتخاب variant برای کاربر. همیشه string برمی‌گرداند؛ در هر ابهام/خطا: 'control'.
export function variant(db, userId, expKey) {
  try {
    const p = prep(db);
    const exp = getExp(db, expKey);
    const seen = p.getExposure.get(expKey, userId);
    if (seen) {
      // sticky: در running/draining همان variant قبلی؛ در stopped (یا حذف آزمایش) → control
      if (exp && (exp.status === 'running' || exp.status === 'draining')) return seen.variant;
      return 'control';
    }
    if (!exp || exp.status !== 'running') return 'control'; // exposure جدید فقط در running
    const variants = JSON.parse(exp.variants_json);
    const total = variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);
    if (!total) return 'control';
    const h = hash01(`${userId}:${expKey}`);
    let acc = 0, chosen = variants[0]?.key || 'control';
    for (const v of variants) {
      acc += (Number(v.weight) || 0) / total;
      if (h < acc) { chosen = v.key; break; }
    }
    p.insertExposure.run(expKey, userId, chosen);
    track(db, userId, EVENTS.AB_EXPOSURE, { exp: expKey, variant: chosen });
    return chosen;
  } catch (e) {
    logErr('ab variant:', expKey, e.message);
    return 'control';
  }
}
