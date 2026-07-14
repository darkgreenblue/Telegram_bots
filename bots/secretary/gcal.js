// gcal.js — Google Calendar با Service Account (بدون npm؛ JWT را با node:crypto امضا می‌کنیم).
// راه‌اندازی مالک: در GCP یک Service Account بساز، Calendar API را فعال کن، کلید JSON را base64
// کن و در Secret `SECRETARY_GOOGLE_SA_KEY_B64` بگذار؛ تقویم مقصد را با ایمیلِ SA به‌صورت
// «Make changes to events» share کن و آیدی‌اش را در `SECRETARY_GOOGLE_CALENDAR_ID` بگذار.
// نبودِ env = قابلیت خاموش (نه کرش) تا boot CI سالم بماند.
import crypto from 'crypto';
import { log, logErr } from '../../shared/logger.js';

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID?.trim() || '';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let sa = null; // {client_email, private_key}
function loadSA() {
  if (sa) return sa;
  const b64 = process.env.GOOGLE_SA_KEY_B64?.trim();
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (!json.client_email || !json.private_key) throw new Error('کلید SA ناقص است');
    sa = { client_email: json.client_email, private_key: json.private_key };
    return sa;
  } catch (e) {
    logErr('gcal: بارگذاری کلید SA شکست خورد:', e.message);
    return null;
  }
}

export function gcalEnabled() {
  return !!(loadSA() && CALENDAR_ID);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

let tokenCache = { token: null, exp: 0 };
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const key = loadSA();
  if (!key) throw new Error('gcal disabled');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = b64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), key.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`gcal token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

// آیدی قطعیِ رویداد از item.id (charset مجاز تقویم = a-v و 0-9؛ اینجا فقط s,e,c و رقم). idempotent.
const eventIdFor = (itemId) => 'sec' + String(itemId).padStart(8, '0');

function tehranDate(unixSec) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(unixSec * 1000)); // YYYY-MM-DD
}

// ساخت رویداد. برمی‌گرداند eventId. کرش بین insert و ثبت DB → retry به 409 می‌خورد = موفق (exactly-once).
export async function createEvent(item) {
  if (!gcalEnabled()) throw new Error('gcal disabled');
  const token = await getAccessToken();
  const eventId = eventIdFor(item.id);
  const body = {
    id: eventId,
    summary: item.title,
    description: item.body || '',
  };
  if (item.all_day) {
    const startDate = tehranDate(item.due_at);
    const endDate = tehranDate((item.end_at && item.end_at > item.due_at) ? item.end_at : item.due_at + 86400);
    body.start = { date: startDate };
    body.end = { date: endDate };
  } else {
    const endUnix = (item.end_at && item.end_at > item.due_at) ? item.end_at : item.due_at + 3600;
    body.start = { dateTime: new Date(item.due_at * 1000).toISOString(), timeZone: 'Asia/Tehran' };
    body.end = { dateTime: new Date(endUnix * 1000).toISOString(), timeZone: 'Asia/Tehran' };
  }
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    // از قبل با همین id هست → فیلدها را PATCH کن (هم retryِ کرش را idempotent می‌کند، هم ویرایش را)
    const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
    const { id, ...patchBody } = body;
    const pr = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    if (!pr.ok && pr.status !== 404) throw new Error(`gcal patch ${pr.status}: ${(await pr.text()).slice(0, 200)}`);
    log('gcal: رویداد از قبل بود (409) → به‌روزرسانی شد');
    return eventId;
  }
  if (!res.ok) throw new Error(`gcal insert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return eventId;
}

// حذف رویداد (undo). 404/410 = از قبل نبود = موفق.
export async function deleteEvent(eventId) {
  if (!gcalEnabled()) throw new Error('gcal disabled');
  const token = await getAccessToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (res.ok || res.status === 404 || res.status === 410) return true;
  throw new Error(`gcal delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
