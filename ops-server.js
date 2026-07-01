// ops-server.js — standalone HTTPS ops endpoint (logs / pm2 status / restart)
//
// چرا جداست: این سرور مستقل از ربات اجرا می‌شود (pm2 app جداگانه: voice2text-ops)
// تا حتی وقتی ربات اصلی crash کرده یا در restart loop است، Claude Code بتواند
// لاگ‌ها را بخواند، وضعیت pm2 را ببیند و ربات را restart کند.
//
// همان توکن/گواهیِ Admin API را استفاده می‌کند. مستندسازی: CLAUDE.md
import 'dotenv/config';
import https from 'https';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';

const execFileAsync = promisify(execFile);

const TOKEN = process.env.ADMIN_API_TOKEN?.trim() || '';
const CERT  = process.env.ADMIN_API_CERT?.trim()  || '';
const KEY   = process.env.ADMIN_API_KEY?.trim()   || '';
const PORT  = parseInt(process.env.ADMIN_OPS_PORT || '3002', 10);
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || `${homedir()}/.pm2/logs`;

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function log(...a) { console.log(`[${ts()}]`, ...a); }

// نام‌های مجاز pm2 app (جلوگیری از تزریق در دستور و مسیر فایل)
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

// آخرین N خط از یک فایل لاگ (فقط ~۳۰۰KB انتهایی خوانده می‌شود تا سریع بماند)
function tailFile(path, lines) {
  let size;
  try { size = statSync(path).size; } catch { return `(log file not found: ${path})`; }
  const readBytes = Math.min(size, 300_000);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(readBytes);
    readSync(fd, buf, 0, readBytes, size - readBytes);
    const text = buf.toString('utf8');
    const all  = text.split('\n');
    return all.slice(-lines).join('\n');
  } finally { closeSync(fd); }
}

async function handler(req, res) {
  const send = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data, null, 2));
  };
  const auth = (req.headers['authorization'] || '').trim();
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) return send({ error: 'unauthorized' }, 401);

  try {
    const url  = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/$/, '') || '/';
    const app  = (url.searchParams.get('app') || 'voice2text').trim();
    if (!SAFE_NAME.test(app)) return send({ error: 'invalid app name' }, 400);

    // ── GET /ops/health ──
    if (req.method === 'GET' && path === '/ops/health') return send({ ok: true, ts: ts() });

    // ── GET /ops/logs?app=&type=out|error&lines=N ──
    if (req.method === 'GET' && path === '/ops/logs') {
      const type  = url.searchParams.get('type') || 'error';
      const lines = Math.min(parseInt(url.searchParams.get('lines') || '80'), 1000);
      const suffix = type === 'out' ? 'out' : 'error';
      const file = `${PM2_LOG_DIR}/${app}-${suffix}.log`;
      return send({ app, type: suffix, lines, file, content: tailFile(file, lines) });
    }

    // ── GET /ops/status ── (pm2 jlist خلاصه)
    if (req.method === 'GET' && path === '/ops/status') {
      const { stdout } = await execFileAsync('pm2', ['jlist']);
      let list = [];
      try { list = JSON.parse(stdout); } catch {}
      const apps = list.map(p => ({
        name: p.name,
        status: p.pm2_env?.status,
        restarts: p.pm2_env?.restart_time,
        uptime_ms: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
        cpu: p.monit?.cpu,
        memory_mb: p.monit?.memory ? Math.round(p.monit.memory / 1048576) : null,
      }));
      return send({ apps });
    }

    // ── POST /ops/restart?app= ──
    if (req.method === 'POST' && path === '/ops/restart') {
      const { stdout, stderr } = await execFileAsync('pm2', ['restart', app]);
      log(`🔧 ops restart app=${app}`);
      return send({ ok: true, app, stdout: stdout.trim(), stderr: stderr.trim() });
    }

    return send({ error: 'not found' }, 404);
  } catch (e) {
    log('ops error:', e.message);
    send({ error: e.message }, 500);
  }
}

if (TOKEN && CERT && KEY) {
  const tlsOpts = { cert: readFileSync(CERT), key: readFileSync(KEY) };
  https.createServer(tlsOpts, handler).listen(PORT, () => {
    log(`🔧 Ops server https://0.0.0.0:${PORT}/ops  (TLS + token)`);
  });
} else {
  log('⚠️  Ops server disabled (need ADMIN_API_TOKEN + ADMIN_API_CERT + ADMIN_API_KEY)');
  process.exit(1);
}
