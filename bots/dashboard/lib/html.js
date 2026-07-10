// رندر HTML سمت سرور — RTL فارسی، بدون build step و بدون هیچ منبع خارجی (self-contained)
import { esc } from './util.js';

const NAV = [
  ['/', 'نمای کلی'],
  ['/marketing', 'مارکتینگ'],
  ['/experiments', 'تست‌ها'],
  ['/funnels', 'فانل‌ها'],
  ['/retention', 'ریتنشن'],
  ['/finance', 'مالی'],
  ['/discounts', 'کد تخفیف'],
  ['/support', 'پشتیبانی'],
  ['/journal', 'ژورنال'],
];

const CSS = `
  :root { --bg:#f6f7fb; --card:#fff; --line:#e3e6ef; --text:#1d2333; --dim:#6b7280; --accent:#4f46e5; --ok:#0a7d33; --bad:#b42318; --warn:#92400e; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:Vazirmatn,Tahoma,'Segoe UI',sans-serif; font-size:14px; }
  a { color:var(--accent); text-decoration:none; }
  header { background:var(--card); border-bottom:1px solid var(--line); padding:10px 20px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  header .brand { font-weight:700; }
  header nav { display:flex; gap:4px; flex-wrap:wrap; }
  header nav a { padding:6px 12px; border-radius:8px; color:var(--text); }
  header nav a.active { background:var(--accent); color:#fff; }
  main { max-width:1100px; margin:20px auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; overflow-x:auto; }
  .card h2 { margin:0 0 12px; font-size:16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat .k { color:var(--dim); font-size:12px; }
  .stat .v { font-size:20px; font-weight:700; margin-top:2px; }
  table { border-collapse:collapse; width:100%; white-space:nowrap; }
  th, td { border-bottom:1px solid var(--line); padding:7px 10px; text-align:right; }
  th { color:var(--dim); font-weight:600; font-size:12px; }
  tr:hover td { background:#fafbff; }
  .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:12px; background:#eef0f7; }
  .badge.ok { background:#e7f6ec; color:var(--ok); }
  .badge.bad { background:#fdebe9; color:var(--bad); }
  .badge.warn { background:#fef3e2; color:var(--warn); }
  form.inline { display:flex; gap:8px; flex-wrap:wrap; align-items:end; }
  label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--dim); }
  input, select, textarea { padding:7px 10px; border:1px solid var(--line); border-radius:8px; font:inherit; background:#fff; min-width:120px; }
  button { padding:8px 16px; border:0; border-radius:8px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
  button.ghost { background:#eef0f7; color:var(--text); }
  .muted { color:var(--dim); font-size:12px; }
  .mono { font-family:ui-monospace,monospace; direction:ltr; unicode-bidi:embed; }
  .note { background:#fef3e2; border:1px solid #fcd9a0; border-radius:8px; padding:8px 12px; font-size:13px; margin-bottom:12px; }
  .copy { cursor:pointer; }
`;

export function layout(title, active, body, { msg = '' } = {}) {
  return `<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — داشبورد ربات‌ها</title>
<style>${CSS}</style></head><body>
<header>
  <span class="brand">🧠 داشبورد ربات‌ها</span>
  <nav>${NAV.map(([href, label]) =>
    `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('')}</nav>
  <form method="post" action="/logout" style="margin-inline-start:auto"><button class="ghost" type="submit">خروج</button></form>
</header>
<main>
${msg ? `<div class="note">${esc(msg)}</div>` : ''}
${body}
</main>
<script>
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-copy]');
  if (!el) return;
  navigator.clipboard.writeText(el.getAttribute('data-copy')).then(() => {
    const t = el.textContent; el.textContent = '✅ کپی شد';
    setTimeout(() => { el.textContent = t; }, 1200);
  });
});
</script>
</body></html>`;
}

export function loginPage(error = '') {
  return `<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>ورود — داشبورد ربات‌ها</title><style>${CSS}
  .login { max-width:360px; margin:15vh auto; }
</style></head><body><main class="login"><div class="card">
<h2>🧠 ورود به داشبورد</h2>
${error ? `<div class="note">${esc(error)}</div>` : ''}
<form method="post" action="/login" style="display:flex;flex-direction:column;gap:10px">
  <label>توکن دسترسی<input type="password" name="token" autofocus autocomplete="current-password"></label>
  <button type="submit">ورود</button>
</form>
<p class="muted">توکن همان مقدار Secret با نام DASHBOARD_TOKEN است.</p>
</div></main></body></html>`;
}

// جدول ساده: headers = [label,...] ، rows = آرایه‌ی آرایه‌ی سلول‌های از قبل escape/render شده
export function table(headers, bodyRows, emptyText = 'داده‌ای نیست') {
  if (!bodyRows.length) return `<p class="muted">${esc(emptyText)}</p>`;
  return `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${bodyRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export const stat = (k, v) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;

export function statusBadge(s) {
  const cls = s === 'approved' || s === 'delivered' || s === 'completed' ? 'ok'
    : s === 'rejected' || s === 'refunded' || s === 'failed' ? 'bad'
    : s === 'waiting_review' || s === 'pending' || s === 'pending_payment' ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(s)}</span>`;
}
