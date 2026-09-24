#!/usr/bin/env node
/* 🔐 نیمه‌ی محلیِ `Ops → db-query-sealed`: ساختِ کلید و بازکردنِ خروجیِ مهروموم‌شده.
 *
 * چرا وجود دارد: خروجیِ `db-query` مستقیم در لاگِ جاب چاپ می‌شود، و وقتی ریپو
 * موقتاً public است (بند ۳ج ریشه) آن لاگ برای **همه** خواناست. عددِ تجمیعی آن‌جا
 * بی‌خطر است، ولی متنِ خامِ کاربر (سؤالِ فال، خودِ فال، هر چیزی که آدم درباره‌ی
 * زندگی‌اش نوشته) نیست. `db-query-sealed` همان کوئریِ فقط-خواندنی را روی سرور اجرا
 * می‌کند و خروجی را قبل از چاپ با یک کلیدِ عمومی رمز می‌کند؛ این فایل تنها جایی
 * است که بازش می‌کند.
 *
 * رمزنگاری: AES-256-GCM برای خودِ داده (کلیدِ تصادفیِ per اجرا) + RSA-OAEP-SHA256
 * برای آن کلید. قالبِ بلوب: 'SQ1' | u16 طولِ کلیدِ رمزشده | کلیدِ رمزشده | iv(12) |
 * tag(16) | متنِ رمزشده‌ی gzip شده. دوقلوی سمتِ سرور در `.github/workflows/ops.yml`
 * است و `tools/check-ops-sealed.mjs` هر دو را با هم اجرا می‌کند؛ عوض‌کردنِ قالب
 * فقط در یکی، چک را قرمز می‌کند.
 *
 * ⚠️ کلیدِ خصوصی هرگز در ریپو نمی‌نشیند و هرگز به ورک‌فلو داده نمی‌شود. آن را در
 * پوشه‌ی موقتِ سشن بساز (نه داخلِ درختِ ریپو) و بعد از کار پاکش کن.
 *
 * استفاده:
 *   node tools/ops-unseal.mjs keygen <dir>
 *       → <dir>/ops-sealed.key (خصوصی، 0600) و چاپِ کلیدِ عمومی برای ورودیِ `pubkey`
 *   node tools/ops-unseal.mjs open <keyfile> <logfile> [out.json]
 *       → بلوکِ بینِ دو نشانگر را از لاگِ دانلودشده بیرون می‌کشد و باز می‌کند
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const BEGIN = '-----BEGIN OPS SEALED-----';
export const END = '-----END OPS SEALED-----';
const MAGIC = 'SQ1';

/** یک جفت‌کلیدِ تازه: کلیدِ عمومی به شکلِ ورودیِ ورک‌فلو (base64ِ DERِ SPKI). */
export function keygen(bits = 4096) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
  return {
    pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/* بلوب را از لاگِ خامِ جاب درمی‌آورد.
 *
 * لاگِ گیت‌هاب اولِ هر خط یک مهرِ زمان می‌گذارد و ssh-action ممکن است پیشوندِ خودش
 * را هم اضافه کند، پس از هر خطِ بینِ دو نشانگر فقط آخرین توکن برداشته می‌شود و از
 * آن هم فقط نویسه‌های base64. اگر نشانگرها نبودند یا بیش از یک بلوک بود، خطا می‌دهد:
 * حدس‌زدنِ بلوکِ درست روی دیتای کاربر جای حدس نیست.
 *
 * نشانگر فقط وقتی نشانگر است که **آخرِ خط** بنشیند و قبلش فقط مهرِ زمان یا فاصله باشد.
 * 🐛 باگِ اولین اجرای واقعی (۳ مهر ۱۴۰۵): لاگِ گیت‌هاب خودِ اسکریپتِ مرحله را هم (دو بار)
 * در سرِ مرحله چاپ می‌کند، و همان اسکریپت خطِ console.log با هر دو نشانگر را دارد. جستجوی
 * «شامل بودن» آن خطِ کد را بلوک گرفت و بازکردن با «بیش از یک بلوک» شکست. لاگِ ساختگیِ
 * چک فقط خروجی را داشت نه سرِ مرحله را، پس سبز بود. */
const markerRe = (m) => new RegExp(`(^|\\s)${m}\\s*$`);
const IS_BEGIN = markerRe(BEGIN), IS_END = markerRe(END);
export function extract(text) {
  const lines = String(text).split(/\r?\n/);
  const b = lines.findIndex((l) => IS_BEGIN.test(l));
  const e = lines.findIndex((l, i) => i > b && IS_END.test(l));
  if (b < 0 || e < 0) throw new Error('نشانگرهای بلوکِ مهروموم‌شده پیدا نشد');
  if (lines.slice(e + 1).some((l) => IS_BEGIN.test(l))) throw new Error('بیش از یک بلوک در لاگ هست');
  return lines.slice(b + 1, e)
    .map((l) => (l.trim().split(/\s+/).pop() || '').replace(/[^A-Za-z0-9+/=]/g, ''))
    .join('');
}

/** بازکردنِ بلوب؛ هر دستکاری یا کلیدِ اشتباه با خطا تمام می‌شود، نه با خروجیِ نیمه‌کاره. */
export function unseal(b64, privPem) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.subarray(0, 3).toString() !== MAGIC) throw new Error('بلوبِ نامعتبر (نشانِ قالب نمی‌خواند)');
  const n = buf.readUInt16BE(3);
  let o = 5;
  const ek = buf.subarray(o, o += n);
  const iv = buf.subarray(o, o += 12);
  const tag = buf.subarray(o, o += 16);
  const ct = buf.subarray(o);
  const key = crypto.privateDecrypt({ key: privPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ek);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const gz = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'keygen' && a) {
    fs.mkdirSync(a, { recursive: true });
    const k = keygen();
    const kf = path.join(a, 'ops-sealed.key');
    fs.writeFileSync(kf, k.priv, { mode: 0o600 });
    console.error(`کلیدِ خصوصی: ${kf} (هرگز کامیت نشود)`);
    console.log(k.pub);
  } else if (cmd === 'open' && a && b) {
    const rows = unseal(extract(fs.readFileSync(b, 'utf8')), fs.readFileSync(a, 'utf8'));
    if (c) { fs.writeFileSync(c, JSON.stringify(rows)); console.error(`${rows.length} ردیف ← ${c}`); }
    else console.log(JSON.stringify(rows, null, 1));
  } else {
    console.error('استفاده: keygen <dir> | open <keyfile> <logfile> [out.json]');
    process.exit(2);
  }
}
