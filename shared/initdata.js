/**
 * تأییدِ امضای `initData` مینی‌اپِ تلگرام.
 *
 * 🔐 چرا این فایل مهم‌ترین تکه‌ی مینی‌اپ است: صفحه‌ی وب هر چیزی می‌تواند ادعا کند.
 * تنها چیزی که ثابت می‌کند «این واقعاً کاربرِ تلگرام است و نه یک اسکریپت»، همین
 * امضاست. بدونِ آن، هر کسی می‌توانست با یک `curl` خودش را کاربرِ دیگری جا بزند و
 * روی حسابِ او فاکتور بسازد. پس این تابع تنها دروازه‌ی ورود است و هیچ مسیرِ دیگری
 * نباید `user_id` را از بدنه‌ی درخواست باور کند.
 *
 * الگوریتم (مستندِ Telegram، بخشِ Validating data received via the Mini App):
 *   secret        = HMAC_SHA256(key: "WebAppData", message: <bot token>)
 *   checkString   = همه‌ی فیلدها بجز `hash` به شکلِ `key=value`، مرتب‌شده، با `\n`
 *   expected      = HMAC_SHA256(key: secret, message: checkString)  →  hex
 * و `expected` باید با فیلدِ `hash` برابر باشد.
 *
 * ⚠️ سه نکته‌ای که پیاده‌سازی‌های اشتباه معمولاً از دست می‌دهند:
 *  ۱. مقدارها **decode شده** وارد checkString می‌شوند، نه خام.
 *  ۲. `signature` (امضای شخصِ ثالث) هم مثل `hash` از checkString بیرون می‌ماند.
 *  ۳. مقایسه باید **زمان‌ثابت** باشد، وگرنه از راهِ زمان‌سنجی نشت می‌کند.
 *
 * قواعدِ `shared/` (بند ۶): هیچ importی از npm. فقط built-inهای Node.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** پنجره‌ی پیش‌فرضِ تازگی: امضای کهنه یعنی صفحه‌ای که ساعت‌ها باز مانده یا بازپخشِ ضبط‌شده. */
export const INITDATA_MAX_AGE_SEC = 3600;

const hmac = (key, msg) => createHmac('sha256', key).update(msg).digest();

/** مقایسه‌ی زمان‌ثابت روی رشته‌ی hex؛ طولِ نابرابر بدونِ نشت رد می‌شود. */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * @param {string} initData رشته‌ی خامِ `window.Telegram.WebApp.initData`
 * @param {string} botToken توکنِ همان رباتی که مینی‌اپ را باز کرده
 * @param {{ maxAgeSec?: number, now?: number }} [opts]
 * @returns {{ ok: true, user: object|null, authDate: number, queryId: string|null, startParam: string|null, params: Record<string,string> }
 *          | { ok: false, reason: 'empty'|'no_hash'|'bad_hash'|'expired'|'bad_auth_date'|'no_token' }}
 *
 * هرگز throw نمی‌کند: مسیرِ ورودیِ عمومی نباید با یک ورودیِ بدشکل ۵۰۰ بدهد.
 */
export function verifyInitData(initData, botToken, opts = {}) {
  const maxAge = opts.maxAgeSec ?? INITDATA_MAX_AGE_SEC;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!botToken) return { ok: false, reason: 'no_token' };
  if (typeof initData !== 'string' || initData.length === 0) return { ok: false, reason: 'empty' };

  /* URLSearchParams خودش decode می‌کند، که دقیقاً همان چیزی است که تلگرام امضا کرده.
   * ساختنِ دستیِ checkString از رشته‌ی خام یکی از رایج‌ترین اشتباه‌هاست. */
  let sp;
  try { sp = new URLSearchParams(initData); } catch { return { ok: false, reason: 'empty' }; }

  const params = {};
  for (const [k, v] of sp.entries()) params[k] = v;

  const hash = params.hash;
  if (!hash) return { ok: false, reason: 'no_hash' };

  const checkString = Object.keys(params)
    .filter(k => k !== 'hash' && k !== 'signature')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('\n');

  const secret = hmac('WebAppData', botToken);
  const expected = hmac(secret, checkString).toString('hex');
  if (!safeEqualHex(expected, hash)) return { ok: false, reason: 'bad_hash' };

  /* امضا درست است، ولی تازگی هم لازم است: یک `initData`ِ معتبرِ دزدیده‌شده تا ابد
   * معتبر می‌ماند اگر تاریخش را نسنجیم. */
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'bad_auth_date' };
  if (maxAge > 0 && now - authDate > maxAge) return { ok: false, reason: 'expired' };

  let user = null;
  try { user = params.user ? JSON.parse(params.user) : null; } catch { user = null; }

  return {
    ok: true,
    user,
    authDate,
    queryId: params.query_id || null,
    startParam: params.start_param || null,
    params,
  };
}

/** شناسه‌ی عددیِ کاربر، یا `null`. تنها منبعِ مجازِ هویت در مسیرِ مینی‌اپ. */
export function initDataUserId(result) {
  if (!result?.ok) return null;
  const id = result.user?.id;
  return Number.isInteger(id) ? id : null;
}
