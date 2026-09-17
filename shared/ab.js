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

export const AB_SCHEMA_VERSION = 2;
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
      stratum        TEXT    NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (experiment_key, user_id)
    );
    /* رزروِ انتساب از exposure جداست: برای رندرِ درمان باید قبل از ارسال بدانیم کاربر
       کدام شاخه را می‌بیند، اما exposure فقط پس از ارسالِ موفق ثبت می‌شود. */
    CREATE TABLE IF NOT EXISTS ab_assignments (
      experiment_key TEXT    NOT NULL,
      user_id        INTEGER NOT NULL,
      variant        TEXT    NOT NULL,
      stratum        TEXT    NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      exposed_at     INTEGER,
      PRIMARY KEY (experiment_key, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ab_assignments_stratum
      ON ab_assignments (experiment_key, stratum, variant);
  `);
  // SQLite قدیمیِ ربات قبل از v2 این ستون را ندارد؛ ALTER idempotent است.
  try { db.prepare("ALTER TABLE ab_exposures ADD COLUMN stratum TEXT NOT NULL DEFAULT ''").run(); } catch {}
}

const prepCache = new WeakMap();
function prep(db) {
  let c = prepCache.get(db);
  if (!c) {
    c = {
      getExposure: db.prepare('SELECT variant FROM ab_exposures WHERE experiment_key=? AND user_id=?'),
      insertExposure: db.prepare('INSERT OR IGNORE INTO ab_exposures (experiment_key, user_id, variant) VALUES (?,?,?)'),
      allExperiments: db.prepare('SELECT * FROM experiments'),
      getAssignment: db.prepare('SELECT variant, stratum, exposed_at FROM ab_assignments WHERE experiment_key=? AND user_id=?'),
      insertAssignment: db.prepare('INSERT OR IGNORE INTO ab_assignments (experiment_key, user_id, variant, stratum) VALUES (?,?,?,?)'),
      assignmentCounts: db.prepare('SELECT variant, COUNT(*) AS count FROM ab_assignments WHERE experiment_key=? AND stratum=? GROUP BY variant'),
      markAssignedExposed: db.prepare('UPDATE ab_assignments SET exposed_at=COALESCE(exposed_at, unixepoch()) WHERE experiment_key=? AND user_id=?'),
      insertStratifiedExposure: db.prepare('INSERT OR IGNORE INTO ab_exposures (experiment_key, user_id, variant, stratum) VALUES (?,?,?,?)'),
      releaseAssignment: db.prepare('DELETE FROM ab_assignments WHERE experiment_key=? AND user_id=? AND exposed_at IS NULL'),
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

/* ══════════════════════════════════════════════════════════════════════════
 * تخصیصِ لایه‌بندی‌شده (stratified)
 *
 * برای آزمایشی که هم‌زمان با یک آزمایشِ اثرگذارِ دیگر اجرا می‌شود، هشِ مستقلِ معمولی
 * فقط «در میانگین» متعادل است. این مسیر کاربر را داخلِ یک لایه‌ی مشخص (مثلاً بازوی
 * قیمت) تخصیص می‌دهد و در همان لایه، نسبتِ وزن‌ها را تا نزدیک‌ترین عدد صحیح حفظ
 * می‌کند. برای split 50/50 اختلافِ تعدادِ دو شاخه در هر لایه هرگز بیش از یک نفر نیست.
 *
 * چرا reservation جدا از exposure است؟ ظاهرِ دکمه باید پیش از ارسال معلوم باشد، ولی
 * exposure طبق قرارداد فقط بعد از رسیدنِ موفق پیام ثبت می‌شود. reservation فقط انتساب
 * را قفل می‌کند؛ caller در موفقیت `exposeStratifiedVariant` و در شکست
 * `releaseStratifiedReservation` را صدا می‌زند.
 * ══════════════════════════════════════════════════════════════════════════ */
const cleanStratum = (value) => String(value || 'default').slice(0, 96);

function weightedBalancedChoice(exp, counts, seed) {
  let variants;
  try { variants = JSON.parse(exp.variants_json).filter(v => (Number(v.weight) || 0) > 0); }
  catch { return 'control'; }
  if (!variants.length) return 'control';
  const totalWeight = variants.reduce((n, v) => n + Number(v.weight), 0);
  const assigned = variants.reduce((n, v) => n + (counts.get(v.key) || 0), 0);
  // بعد از انتساب بعدی، کدام بازو بیشترین کسری نسبت به سهم هدف دارد؟
  const scored = variants.map(v => ({
    key: v.key,
    deficit: ((assigned + 1) * Number(v.weight) / totalWeight) - (counts.get(v.key) || 0),
  }));
  const best = Math.max(...scored.map(v => v.deficit));
  const ties = scored.filter(v => Math.abs(v.deficit - best) < 1e-12);
  return ties[Math.floor(hash01(seed) * ties.length)]?.key || 'control';
}

/** رزروِ شاخه بدون ثبت exposure. باید درست پیش از ساختِ UI صدا زده شود. */
export function reserveStratifiedVariant(db, userId, expKey, stratum = 'default') {
  try {
    const exp = getExp(db, expKey);
    const p = prep(db);
    const existingExposure = p.getExposure.get(expKey, userId);
    if (existingExposure) {
      return exp && (exp.status === 'running' || exp.status === 'draining') ? existingExposure.variant : 'control';
    }
    if (!exp || !['running', 'draining'].includes(exp.status)) return 'control';
    const existing = p.getAssignment.get(expKey, userId);
    if (existing) return existing.variant;
    // draining انتساب تازه نمی‌پذیرد؛ فقط reservation/ exposure موجود ادامه می‌یابد.
    if (exp.status !== 'running') return 'control';
    const layer = cleanStratum(stratum);
    const assign = db.transaction(() => {
      const seen = p.getExposure.get(expKey, userId);
      if (seen) return seen.variant;
      const held = p.getAssignment.get(expKey, userId);
      if (held) return held.variant;
      const counts = new Map(p.assignmentCounts.all(expKey, layer).map(r => [r.variant, Number(r.count) || 0]));
      const chosen = weightedBalancedChoice(exp, counts, `${userId}:${expKey}:${layer}:tie`);
      p.insertAssignment.run(expKey, userId, chosen, layer);
      return chosen;
    });
    // BEGIN IMMEDIATE پیش از خواندنِ شمارش قفلِ نوشتن می‌گیرد؛ بدون آن دو callback
    // هم‌زمان می‌توانند هر دو همان بازویِ کم‌تعداد را ببینند و توازن دقیق بشکند.
    return typeof assign.immediate === 'function' ? assign.immediate() : assign();
  } catch (e) { logErr('ab stratified reserve:', expKey, e.message); return 'control'; }
}

/** ثبتِ exposure پس از اینکه همان UI واقعاً برای کاربر ارسال/ادیت شد. */
export function exposeStratifiedVariant(db, userId, expKey, stratum = 'default') {
  try {
    const exp = getExp(db, expKey);
    if (!exp || !['running', 'draining'].includes(exp.status)) return 'control';
    const p = prep(db);
    const seen = p.getExposure.get(expKey, userId);
    if (seen) return seen.variant;
    const assigned = p.getAssignment.get(expKey, userId);
    if (!assigned) return 'control'; // در draining هیچ exposure تازه‌ای از انتسابِ تازه ساخته نشود.
    const layer = assigned.stratum || cleanStratum(stratum);
    const commit = db.transaction(() => {
      const already = p.getExposure.get(expKey, userId);
      if (already) return already.variant;
      p.insertStratifiedExposure.run(expKey, userId, assigned.variant, layer);
      p.markAssignedExposed.run(expKey, userId);
      track(db, userId, EVENTS.AB_EXPOSURE, { exp: expKey, variant: assigned.variant, stratum: layer });
      return assigned.variant;
    });
    return commit();
  } catch (e) { logErr('ab stratified expose:', expKey, e.message); return 'control'; }
}

/** ارسال شکست خورد: reservation دیده نشده نباید در توازنِ نمونه بماند. */
export function releaseStratifiedReservation(db, userId, expKey) {
  try { prep(db).releaseAssignment.run(expKey, userId); }
  catch (e) { logErr('ab stratified release:', expKey, e.message); }
}
