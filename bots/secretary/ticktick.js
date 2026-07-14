// ticktick.js — TickTick Open API (OAuth2). تک‌کاربره: توکن یک‌بار داخل خود ربات گرفته و در
// جدول settings ذخیره می‌شود (نه Secrets؛ چون ~۱۸۰ روزه منقضی می‌شود و DB در بکاپ شبانه هست).
// همه‌ی کارها/خواندنی‌ها/فکرها به یک پروژه‌ی واحد به اسم «منشی» می‌روند (مالک خودش دسته‌بندی می‌کند).
import { log, logErr } from '../../shared/logger.js';
import { getSetting, setSetting } from './db.js';

const CLIENT_ID = process.env.TICKTICK_CLIENT_ID?.trim() || '';
const CLIENT_SECRET = process.env.TICKTICK_CLIENT_SECRET?.trim() || '';
const REDIRECT_URI = 'http://localhost:8976/callback';
const AUTH_URL = 'https://ticktick.com/oauth/authorize';
const TOKEN_URL = 'https://ticktick.com/oauth/token';
const API = 'https://api.ticktick.com/open/v1';
const PROJECT_NAME = 'منشی';
const TOKEN_KEY = 'ticktick_token';       // JSON: {access_token, obtained_at}
const PROJECT_KEY = 'ticktick_project_id';

export class TicktickAuthError extends Error {}

export function ticktickConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

export function getAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: 'tasks:write tasks:read',
    state: String(state || ''),
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
  });
  return `${AUTH_URL}?${q.toString()}`;
}

function getToken(db) {
  const raw = getSetting(db, TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function hasToken(db) { return !!getToken(db); }

export function tokenAgeDays(db) {
  const t = getToken(db);
  if (!t?.obtained_at) return null;
  return (Date.now() / 1000 - t.obtained_at) / 86400;
}

// از ورودیِ کاربر (کل URL بازگشتی یا فقط کد) مقدار code را دربیاور.
export function parseCode(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/[?&]code=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return s.split(/\s+/)[0];
}

export async function exchangeCode(db, code) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, scope: 'tasks:write tasks:read',
    }),
  });
  if (!res.ok) { logErr('ticktick token exchange', res.status, (await res.text()).slice(0, 200)); return false; }
  const data = await res.json();
  if (!data.access_token) return false;
  setSetting(db, TOKEN_KEY, JSON.stringify({ access_token: data.access_token, obtained_at: Math.floor(Date.now() / 1000) }));
  return true;
}

async function apiFetch(db, method, path, body) {
  const t = getToken(db);
  if (!t?.access_token) throw new TicktickAuthError('no token');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw new TicktickAuthError(`ticktick ${res.status}`);
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 200);
    // DELETE روی چیزی که نیست
    if (method === 'DELETE' && (res.status === 404)) return {};
    throw new Error(`ticktick ${method} ${path} ${res.status}: ${txt}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

// پیدا/ساختِ پروژه‌ی «منشی» (کش id در settings).
async function ensureProject(db) {
  const cached = getSetting(db, PROJECT_KEY);
  if (cached) return cached;
  const list = await apiFetch(db, 'GET', '/project');
  const found = Array.isArray(list) ? list.find((p) => p.name === PROJECT_NAME) : null;
  let id = found?.id;
  if (!id) {
    const created = await apiFetch(db, 'POST', '/project', { name: PROJECT_NAME });
    id = created?.id;
    if (!id) throw new Error('ticktick: ساخت پروژه ناموفق');
    log(`ticktick: پروژه‌ی «${PROJECT_NAME}» ساخته شد (${id})`);
  }
  setSetting(db, PROJECT_KEY, id);
  return id;
}

function fmtDue(unixSec) {
  // TickTick: "yyyy-MM-ddTHH:mm:ss.SSSZ0000" — از UTC ISO با جایگزینی Z
  return new Date(unixSec * 1000).toISOString().replace('Z', '+0000');
}

// ساخت تسک در پروژه‌ی «منشی». external_id = "projectId:taskId".
export async function createTask(db, { title, content = '', dueAtUnix = null, allDay = false }) {
  const projectId = await ensureProject(db);
  const body = { title: String(title).slice(0, 300), content: String(content || '').slice(0, 2000), projectId };
  if (dueAtUnix) {
    body.dueDate = fmtDue(dueAtUnix);
    body.timeZone = 'Asia/Tehran';
    body.isAllDay = !!allDay;
  }
  const task = await apiFetch(db, 'POST', '/task', body);
  if (!task?.id) throw new Error('ticktick: تسک ساخته نشد');
  return `${projectId}:${task.id}`;
}

// به‌روزرسانی تسک موجود (برای ویرایشِ آیتمِ تحویل‌شده). external_id ثابت می‌ماند.
export async function updateTask(db, externalId, { title, content = '', dueAtUnix = null, allDay = false }) {
  const [projectId, taskId] = String(externalId || '').split(':');
  if (!projectId || !taskId) throw new Error('ticktick: external_id نامعتبر');
  const body = { id: taskId, projectId, title: String(title).slice(0, 300), content: String(content || '').slice(0, 2000) };
  if (dueAtUnix) { body.dueDate = fmtDue(dueAtUnix); body.timeZone = 'Asia/Tehran'; body.isAllDay = !!allDay; }
  await apiFetch(db, 'POST', `/task/${taskId}`, body);
  return externalId;
}

export async function deleteTask(db, externalId) {
  const [projectId, taskId] = String(externalId || '').split(':');
  if (!projectId || !taskId) return true;
  await apiFetch(db, 'DELETE', `/project/${projectId}/task/${taskId}`);
  return true;
}
