// احراز هویت داشبورد: توکن → کوکی سشن HttpOnly+SameSite=Strict، rate-limit ورود،
// چک Origin/Host روی همه‌ی POST ها (ضد CSRF). توکن هرگز در URL قرار نمی‌گیرد.
import { randomBytes, timingSafeEqual, createHash } from 'crypto';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // ۳۰ روز؛ ری‌استارت پروسه = ورود دوباره (قابل قبول برای تک‌ادمین)
const sessions = new Map(); // sid -> expireAt(ms)
const attempts = new Map(); // ip  -> { count, resetAt }

export function tokenMatches(input, expected) {
  // مقایسه‌ی زمان-ثابت روی hash تا طول ورودی هم لو نرود
  const a = createHash('sha256').update(String(input || '')).digest();
  const b = createHash('sha256').update(String(expected || '')).digest();
  return timingSafeEqual(a, b);
}

export function newSession() {
  const sid = randomBytes(32).toString('hex');
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
  return sid;
}
export function validSession(sid) {
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(sid); return false; }
  return true;
}
export function dropSession(sid) { sessions.delete(sid); }

// حداکثر ۵ تلاش ورود در دقیقه per IP
export function loginRateLimited(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now > a.resetAt) { attempts.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  a.count += 1;
  return a.count > 5;
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ضد CSRF: هر POST باید Origin (یا در نبودش Referer) هم‌میزبان با Host داشته باشد.
// مرورگرهای مدرن برای POST همیشه Origin می‌فرستند؛ درخواست بدون هر دو رد می‌شود.
export function sameOrigin(req) {
  const host = req.headers.host || '';
  const src = req.headers.origin || req.headers.referer || '';
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

export function clientIp(req) {
  // پشت cloudflared واقعی‌ترین چیز CF-Connecting-IP است؛ لوکال، آدرس سوکت
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
}

// کوکی Secure فقط وقتی از پشت تونل (https) آمده — تست لوکال http://127.0.0.1 هم کار کند
export function sessionCookie(sid, req) {
  const secure = (req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-visitor']) ? '; Secure' : '';
  return `dash_sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}
export const clearCookie = 'dash_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
