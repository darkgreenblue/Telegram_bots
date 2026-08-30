#!/usr/bin/env node
// کنترلِ آزمایشِ A/B از مسیرِ Ops (بدونِ داشبورد).
//
// چرا وجود دارد: تا امروز تنها نویسنده‌ی جدولِ `experiments` داشبورد بود، و داشبورد فقط
// از مرورگرِ مالک پشتِ تونل باز می‌شود. یعنی هر آزمایشی یک قدمِ دستیِ اجباری داشت و
// سشنِ Claude نمی‌توانست چیزی را که خودش ساخته start کند — خلافِ بند ۷ ریشه.
//
// چرا فایلِ جداست و نه `node -e` داخلِ ops.yml: اسکریپتِ درون‌خطی داخلِ رشته‌ی دابل‌کوتِ
// شل می‌نشیند، و SQLای که این‌جا لازم است backtick و `$` دارد؛ شل هر دو را تفسیر می‌کند
// (اولی command substitution، دومی بسط متغیر). نسخه‌ی درون‌خطی همین کار **قبل از رسیدن
// به سرور** با همین خطا شکست. الگوی مرجع: `tools/announce-tarot.mjs`.
//
// ⚠️ تنها نقطه‌ی **نوشتنِ** Ops است، پس عمداً تنگ است:
//   • ورودی JSON است نه SQL؛ هیچ رشته‌ای به کوئری نمی‌چسبد (همه prepared).
//   • فقط جدولِ `experiments` لمس می‌شود. users/payments/readings هرگز.
//   • جدولِ گذارهای مجاز عیناً همان داشبورد است (`routes/experiments.js`)، پس از این‌جا
//     هم گذارِ غیرمجاز ممکن نیست.
//
// اجرا: OPS_QUERY='{"op":"status","key":"love_slot","to":"running"}' node tools/ops-exp.mjs <dbfile>
import { createRequire } from 'node:module';

const KEY_RE = /^[a-z0-9_]{1,40}$/;
const VARIANT_RE = /^[a-z0-9_]{1,24}$/;
const TRANSITIONS = { draft: ['running'], running: ['draining', 'stopped'], draining: ['stopped'] };

export function runExp(db, spec) {
  const op = String(spec?.op || '');
  const key = String(spec?.key || '');
  if (op !== 'list' && !KEY_RE.test(key)) throw new Error('کلیدِ آزمایش نامعتبر');

  if (op === 'list') {
    return JSON.stringify(db.prepare(
      'SELECT key,name,status,variants_json,primary_metric,started_at,stopped_at FROM experiments',
    ).all(), null, 1);
  }

  if (op === 'create') {
    const variants = spec.variants;
    if (!Array.isArray(variants) || variants.length < 2) throw new Error('حداقل دو شاخه لازم است');
    // شاخه‌ی control اجباری است: `variant()` در هر خطا و در حالتِ non-running همین را
    // برمی‌گرداند، پس آزمایشی که control ندارد یعنی رول‌بک ندارد (بند ۲ج/۸).
    if (variants[0]?.key !== 'control') throw new Error('شاخه‌ی اول باید control باشد');
    for (const v of variants) {
      if (!VARIANT_RE.test(String(v?.key))) throw new Error('کلیدِ شاخه نامعتبر: ' + v?.key);
      if (!(Number(v?.weight) > 0)) throw new Error('وزنِ شاخه باید مثبت باشد: ' + v?.key);
    }
    const sql = 'INSERT OR IGNORE INTO experiments '
      + '(key, name, hypothesis, mode, metric_kind, variants_json, primary_metric, guardrails_json) '
      + 'VALUES (?,?,?,?,?,?,?,?)';
    const info = db.prepare(sql).run(
      key, String(spec.name || '').slice(0, 100), String(spec.hypothesis || '').slice(0, 500),
      'split', 'rate', JSON.stringify(variants), String(spec.primary || '').slice(0, 64),
      JSON.stringify((spec.guardrails || []).slice(0, 5)));
    // idempotent: اجرای دوباره آزمایشِ در حالِ اجرا را بازنویسی نمی‌کند (وزن‌ها بعد از
    // start فریزند — تغییرِ وزن یعنی آزمایشِ جدید، نه ادامه‌ی همین).
    return info.changes ? `ساخته شد (draft): ${key}` : `از قبل وجود داشت، دست نخورد: ${key}`;
  }

  if (op === 'status') {
    const to = String(spec.to || '');
    const e = db.prepare('SELECT * FROM experiments WHERE key=?').get(key);
    if (!e) throw new Error('آزمایش پیدا نشد: ' + key);
    if (!(TRANSITIONS[e.status] || []).includes(to)) {
      throw new Error(`گذار ${e.status} → ${to} مجاز نیست`);
    }
    const sql = 'UPDATE experiments SET status=?, '
      + "started_at = COALESCE(started_at, CASE WHEN ?='running' THEN unixepoch() END), "
      + "stopped_at = CASE WHEN ? IN ('draining','stopped') THEN unixepoch() ELSE stopped_at END "
      + 'WHERE key=?';
    db.prepare(sql).run(to, to, to, key);
    const a = db.prepare('SELECT status, started_at FROM experiments WHERE key=?').get(key);
    return `وضعیت ${key}: ${e.status} → ${a.status} (started_at=${a.started_at})`;
  }

  throw new Error('op نامعتبر (list|create|status)');
}

// اجرای مستقیم (نه import از تست)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dbFile = process.argv[2];
  if (!dbFile) { console.error('❌ مسیرِ فایلِ .db لازم است'); process.exit(1); }
  let spec;
  try { spec = JSON.parse(process.env.OPS_QUERY || ''); }
  catch { console.error('❌ اسپکِ JSON نامعتبر است'); process.exit(1); }
  const require = createRequire(import.meta.url);
  const Database = require(`${process.cwd()}/node_modules/better-sqlite3`);
  const db = new Database(dbFile, { fileMustExist: true });
  try { console.log(runExp(db, spec)); }
  catch (e) { console.error('❌ ' + e.message); process.exit(1); }
}
