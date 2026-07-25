// index.js — داشبورد ادمین همه‌ی ربات‌ها (وب، SSR، فارسی RTL)
//
// معماری (CLAUDE.md ریشه، بخش داشبورد):
// - فقط روی 127.0.0.1 گوش می‌دهد؛ دسترسی بیرونی از Cloudflare Tunnel (deploy.yml سرویسش را می‌سازد).
// - خواندن دیتای ربات‌ها: اتصال readonly کوتاه‌عمر per-request (هیچ باری روی ربات‌ها نمی‌گذارد).
// - نوشتن فقط config (کد تخفیف) در DB ربات با گارد schema + هر write/export در audit_log.
// - احراز هویت: DASHBOARD_TOKEN → کوکی سشن HttpOnly+SameSite=Strict؛ چک Origin روی همه‌ی POST ها.
import 'dotenv/config';
import http from 'http';
import { log, logErr } from '../../shared/logger.js';
import { registerGlobalErrorHandlers } from '../../shared/errors.js';
import { esc } from './lib/util.js';
import { layout, loginPage } from './lib/html.js';
import {
  tokenMatches, newSession, validSession, dropSession, loginRateLimited,
  parseCookies, sameOrigin, clientIp, sessionCookie, clearCookie,
} from './lib/auth.js';
import { audit } from './lib/platform.js';
import { overviewBody } from './routes/overview.js';
import { marketingBody, marketingCreate, marketingToggle, marketingUsernames } from './routes/marketing.js';
import { supportBody, supportUserBody } from './routes/support.js';
import { financeBody, financeCsv, financeAction } from './routes/finance.js';
import { funnelsBody } from './routes/funnels.js';
import { discountsBody, discountCreate, discountToggle } from './routes/discounts.js';
import { experimentsBody, experimentViewBody, experimentCreate, experimentStatus, experimentDecide } from './routes/experiments.js';
import { retentionBody } from './routes/retention.js';
import { journalBody, journalVersion, journalInsight } from './routes/journal.js';
import { cohortBody, cohortFragment } from './routes/cohort.js';
import { usersBody, usersCsv } from './routes/users.js';
import { scheduleMaintenance } from './lib/maintenance.js';

/* ===== ENV ===== */
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN?.trim();
if (!DASHBOARD_TOKEN) { logErr('❌ DASHBOARD_TOKEN خالی است'); process.exit(1); }
const PORT = parseInt(process.env.PORT || '8787', 10);

/* ===== helpers ===== */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 100_000) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(new URLSearchParams(data)));
    req.on('error', reject);
  });
}
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
};
const redirect = (res, to, extraHeaders = {}) => { res.writeHead(303, { Location: to, ...extraHeaders }); res.end(); };

/* ===== صفحات GET (بعد از احراز هویت) ===== */
const PAGES = {
  '/': (url) => ['نمای کلی', overviewBody(url)],
  '/marketing': (url) => ['مارکتینگ', marketingBody(url)],
  '/support': (url) => ['پشتیبانی', supportBody(url)],
  '/support/user': (url) => ['پشتیبانی', supportUserBody(url), '/support'],
  '/finance': (url) => ['مالی', financeBody(url)],
  '/funnels': (url) => ['فانل‌ها', funnelsBody(url)],
  '/discounts': () => ['کد تخفیف', discountsBody()],
  '/experiments': () => ['تست‌ها', experimentsBody()],
  '/experiments/view': (url) => ['تست‌ها', experimentViewBody(url), '/experiments'],
  '/retention': () => ['ریتنشن', retentionBody()],
  '/journal': () => ['ژورنال', journalBody()],
  '/users': (url) => ['کاربران', usersBody(url)],
  // «کاربرانِ پشتِ یک عدد» — نسخه‌ی صفحه‌ی کامل (قطعه‌ی کشویی پایین‌تر، خارج از PAGES)
  '/cohort': (url) => ['کاربران', cohortBody(url), '/users'],
};

/* ===== اکشن‌های POST: هرکدام پیام موفقیت برمی‌گرداند و به backTo ری‌دایرکت می‌شود ===== */
const ACTIONS = {
  '/marketing/create': { fn: marketingCreate, backTo: '/marketing' },
  '/marketing/toggle': { fn: marketingToggle, backTo: '/marketing' },
  '/marketing/usernames': { fn: marketingUsernames, backTo: '/marketing' },
  '/finance/action': { fn: financeAction, backTo: '/finance' },
  '/discounts/create': { fn: discountCreate, backTo: '/discounts' },
  '/discounts/toggle': { fn: discountToggle, backTo: '/discounts' },
  '/experiments/create': { fn: experimentCreate, backTo: '/experiments' },
  '/experiments/status': { fn: experimentStatus, backTo: '/experiments' },
  '/experiments/decide': { fn: experimentDecide, backTo: '/experiments' },
  '/journal/version': { fn: journalVersion, backTo: '/journal' },
  '/journal/insight': { fn: journalInsight, backTo: '/journal' },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname;
  try {
    /* ---- ورود/خروج ---- */
    if (path === '/login') {
      if (req.method === 'POST') {
        if (!sameOrigin(req)) return send(res, 403, 'Origin نامعتبر');
        const ip = clientIp(req);
        if (loginRateLimited(ip)) { audit('login.ratelimited', ip); return send(res, 429, loginPage('تلاش زیاد؛ یک دقیقه صبر کن.')); }
        const body = await readBody(req);
        if (tokenMatches(body.get('token'), DASHBOARD_TOKEN)) {
          const sid = newSession();
          audit('login.ok', ip);
          return redirect(res, '/', { 'Set-Cookie': sessionCookie(sid, req) });
        }
        audit('login.fail', ip);
        return send(res, 401, loginPage('توکن اشتباه است.'));
      }
      return send(res, 200, loginPage());
    }

    /* ---- گارد سشن ---- */
    const sid = parseCookies(req).dash_sid;
    if (!validSession(sid)) return redirect(res, '/login');

    if (path === '/logout' && req.method === 'POST') {
      dropSession(sid);
      return redirect(res, '/login', { 'Set-Cookie': clearCookie });
    }

    /* ---- POST اکشن‌ها (همه با چک Origin — ضد CSRF) ---- */
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, 'Origin نامعتبر');
      const action = ACTIONS[path];
      if (!action) return send(res, 404, 'یافت نشد');
      const body = await readBody(req);
      let msg;
      try { msg = action.fn(body); }
      catch (e) { logErr('dashboard action:', path, e.message); msg = `❌ ${e.message}`; }
      return redirect(res, `${action.backTo}?msg=${encodeURIComponent(msg || '')}`);
    }

    /* ---- CSV (export — در خود handler در audit ثبت می‌شود) ---- */
    if (path === '/finance.csv') {
      return send(res, 200, financeCsv(url), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="payments.csv"',
      });
    }
    if (path === '/users.csv') {
      return send(res, 200, usersCsv(url), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="users.csv"',
      });
    }

    /* ---- قطعه‌ی کشویی «کاربرانِ پشتِ این عدد» (fetch از خودِ صفحه؛ HTML خام بدون layout) ---- */
    if (path === '/cohort.fragment') {
      return send(res, 200, cohortFragment(url));
    }

    /* ---- صفحات ---- */
    const page = PAGES[path];
    if (!page) return send(res, 404, layout('یافت نشد', '', '<div class="card"><p>صفحه‌ای این‌جا نیست.</p></div>'));
    const [title, body, activeOverride] = page(url);
    return send(res, 200, layout(title, activeOverride || path, body, { msg: url.searchParams.get('msg') || '' }));
  } catch (e) {
    logErr('❌ GLOBAL dashboard:', path, e.stack || e.message);
    try { send(res, 500, layout('خطا', '', `<div class="card"><p>خطای داخلی: ${esc(e.message)}</p></div>`)); } catch {}
  }
});

server.listen(PORT, '127.0.0.1', () => log(`✅ dashboard listening on http://127.0.0.1:${PORT} (فقط لوکال — دسترسی از تونل)`));
registerGlobalErrorHandlers('dashboard');
scheduleMaintenance(); // rollup روزانه‌ی رویدادها (+ حذف خام فقط اگر events_retention_days ست شده باشد)
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
