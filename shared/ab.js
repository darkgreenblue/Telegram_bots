// shared/ab.js — موتور A/B تست (قرارداد CLAUDE.md ریشه، بند ۲الف)
// قوانین shared: بدون npm؛ db با DI. طراحی طبق بنچمارک GrowthBook/Statsig + نقد متخصص‌ها:
//  - انتساب با هش قطعی (بدون ذخیره‌ی state) + ثبت exposure در لحظه‌ی دیدن variant
//  - **exposure یعنی «کاربر واقعاً treatment را دید»، نه «کد شاخه‌اش را حساب کرد».** هرجا بین
//    محاسبه‌ی شاخه و دیدنِ کاربر یک گارد یا یک ارسالِ شکست‌خوردنی فاصله بیندازد، باید با
//    `peekVariant()` شاخه را خواند و بعد از رسیدنِ واقعیِ پیام `expose()` را صدا زد؛ وگرنه
//    آزمایش با کاربرانی که هیچ‌وقت چیزی ندیدند رقیق می‌شود (و اگر نرخِ آن گارد بین دو شاخه
//    فرق کند — که معمولاً می‌کند — سوگیریِ سیستماتیک می‌گیرد، نه صرفاً نویز).
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

/* تصمیمِ خالص: شاخه‌ی این کاربر چیست، و آیا این یک انتسابِ **تازه** است (یعنی هنوز
   exposure ثبت نشده). هیچ چیزی نمی‌نویسد — نوشتن کارِ expose() است. */
function decide(db, userId, expKey) {
  const p = prep(db);
  const exp = getExp(db, expKey);
  const seen = p.getExposure.get(expKey, userId);
  if (seen) {
    // sticky: در running/draining همان variant قبلی؛ در stopped (یا حذف آزمایش) → control
    if (exp && (exp.status === 'running' || exp.status === 'draining')) return { variant: seen.variant, fresh: false };
    return { variant: 'control', fresh: false };
  }
  if (!exp || exp.status !== 'running') return { variant: 'control', fresh: false }; // exposure جدید فقط در running
  const variants = JSON.parse(exp.variants_json);
  const total = variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);
  if (!total) return { variant: 'control', fresh: false };
  const h = hash01(`${userId}:${expKey}`);
  let acc = 0, chosen = variants[0]?.key || 'control';
  for (const v of variants) {
    acc += (Number(v.weight) || 0) / total;
    if (h < acc) { chosen = v.key; break; }
  }
  return { variant: chosen, fresh: true };
}

/* خواندنِ شاخه **بدونِ ثبتِ exposure**.
   کِی لازم است: وقتی خودِ شاخه تعیین می‌کند که کاربر اصلاً پیامی می‌گیرد یا نه (مثلِ جاروی
   یادآوریِ شبانه‌ی tarot که شرطِ «امروز انجام شده» per شاخه فرق می‌کند)، یا وقتی بین محاسبه و
   نمایش یک ارسالِ شکست‌خوردنی هست. چون bucketing یک هشِ قطعی است، peek و expose همیشه یک
   جواب می‌دهند و کاربر بینِ دو شب شاخه عوض نمی‌کند.
   ⚠️ peek تنها است بی‌فایده: اگر جایی peek کردی، در مسیرِ موفقیت حتماً expose() هم صدا بزن،
   وگرنه کاربر برای همیشه بی‌تگ می‌ماند و آزمایش هیچ دیتایی جمع نمی‌کند. */
export function peekVariant(db, userId, expKey) {
  try { return decide(db, userId, expKey).variant; }
  catch (e) { logErr('ab peek:', expKey, e.message); return 'control'; }
}

/* ثبتِ صریحِ exposure در همان لحظه‌ای که کاربر واقعاً شاخه را دید. برمی‌گرداند: خودِ شاخه.
   idempotent است (INSERT OR IGNORE + شرطِ fresh)، پس صدا زدنِ دوباره‌اش بی‌خطر است. */
export function expose(db, userId, expKey) {
  try {
    const d = decide(db, userId, expKey);
    if (d.fresh) {
      prep(db).insertExposure.run(expKey, userId, d.variant);
      track(db, userId, EVENTS.AB_EXPOSURE, { exp: expKey, variant: d.variant });
    }
    return d.variant;
  } catch (e) { logErr('ab expose:', expKey, e.message); return 'control'; }
}

/* انتخاب variant برای کاربر + ثبتِ exposure در همان لحظه. همیشه string برمی‌گرداند؛
   در هر ابهام/خطا: 'control'. این حالتِ درست برای مسیرِ متعارف است (شاخه همان‌جا رندر
   می‌شود)؛ فقط وقتی بینِ محاسبه و دیدن فاصله هست سراغِ peekVariant/expose برو. */
export function variant(db, userId, expKey) {
  return expose(db, userId, expKey);
}
