// رندر HTML سمت سرور — RTL فارسی، بدون build step و بدون هیچ منبع خارجی (self-contained)
import { esc, fmt, tehranDateTime } from './util.js';
import { NAV, inGroup, link, botsForPicker, langPicker } from './nav.js';

const CSS = `
  :root { --bg:#f6f7fb; --card:#fff; --line:#e3e6ef; --text:#1d2333; --dim:#6b7280; --accent:#4f46e5; --ok:#0a7d33; --bad:#b42318; --warn:#92400e; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:Vazirmatn,Tahoma,'Segoe UI',sans-serif; font-size:14px; }
  a { color:var(--accent); text-decoration:none; }
  /* ═══ پوسته: منوی عمودیِ سمت راست (RTL: inline-start) + ستونِ محتوا ═══
     منو کلِ ارتفاع را می‌گیرد و چسبان است تا در صفحه‌های بلند هم همیشه در دسترس باشد. */
  .shell { display:flex; align-items:flex-start; min-height:100vh; }
  .side { flex:0 0 252px; width:252px; background:var(--card); border-inline-end:1px solid var(--line);
    position:sticky; top:0; height:100vh; overflow-y:auto; padding:14px 12px; display:flex; flex-direction:column; gap:12px; }
  .side .brand { font-weight:700; font-size:15px; padding:2px 4px; }
  .botpick select { width:100%; min-width:0; font-weight:700; background:#fbfcff; }
  .botpick .lbl { color:var(--dim); font-size:11px; margin-bottom:4px; display:block; }
  .who { display:flex; gap:9px; align-items:center; border:1px solid var(--line); border-radius:10px; padding:8px 9px; background:#fbfcff; }
  .who .avatar { width:36px; height:36px; border-radius:50%; background:var(--accent); color:#fff;
    display:flex; align-items:center; justify-content:center; font-size:17px; flex:0 0 36px; }
  .who .nm { font-weight:700; font-size:13px; }
  .who .mt { color:var(--dim); font-size:11px; }
  .side nav { display:flex; flex-direction:column; gap:2px; }
  .side nav a { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:9px; color:var(--text); }
  .side nav a:hover { background:#f2f4fb; }
  .side nav a.active { background:var(--accent); color:#fff; }
  .side nav .sub { display:flex; flex-direction:column; gap:2px; margin:2px 0 6px; margin-inline-start:15px;
    border-inline-start:2px solid var(--line); padding-inline-start:7px; }
  .side nav .sub a { padding:6px 9px; font-size:13px; color:var(--dim); }
  .side nav .sub a.active { background:#eef0ff; color:var(--accent); font-weight:700; }
  .side .foot { margin-top:auto; padding-top:8px; }
  main { flex:1; min-width:0; max-width:1180px; padding:20px; }
  /* موبایل: منوی عمودی به یک نوارِ فشرده‌ی بالای صفحه تبدیل می‌شود.
     ⚠️ align-items هم باید به stretch برگردد: در حالتِ ستونی، flex-start محورِ
     **عرضی** را می‌گیرد و main به‌جای پرکردنِ صفحه به اندازه‌ی محتوایش پهن می‌شود
     (باگِ واقعی: اسکرولِ افقیِ کلِ صفحه به‌خاطرِ حداقل‌عرضِ نمودارِ زمانی). */
  @media (max-width: 820px) {
    .shell { flex-direction:column; align-items:stretch; }
    .side { position:static; width:auto; height:auto; flex:none; border-inline-end:0;
      border-bottom:1px solid var(--line); gap:9px; }
    .side nav { flex-direction:row; flex-wrap:wrap; gap:4px; }
    .side nav a { padding:6px 10px; font-size:13px; }
    .side nav .sub { flex-direction:row; flex-wrap:wrap; margin:0; padding:0; border:0; }
    .side .foot { margin-top:0; }
    .side .foot button { width:auto !important; }
    main { padding:12px; max-width:none; width:100%; }
    .hero .v { font-size:25px; }
    .hero.big .v { font-size:30px; }
    .hb-l { flex-basis:110px; max-width:110px; }
  }
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
  /* عددِ کاربرمحورِ قابل‌کلیک: باز می‌شود و لیستِ کاربرانِ پشتِ همان عدد را نشان می‌دهد */
  details.cohort { display:inline-block; }
  details.cohort > summary { cursor:pointer; list-style:none; font-weight:700; color:var(--accent);
    text-decoration:underline dotted; text-underline-offset:3px; }
  details.cohort > summary::-webkit-details-marker { display:none; }
  details.cohort[open] { display:block; }
  .cohort-body { margin-top:6px; min-width:280px; max-width:420px; max-height:280px; overflow:auto;
    border:1px solid var(--line); border-radius:8px; padding:8px; background:#fbfcff; white-space:normal; font-weight:400; }
  .cohort-body .u { display:block; padding:3px 4px; border-bottom:1px solid #eef0f7; }
  .cohort-body .u:last-child { border-bottom:0; }
  /* بازشویِ «قدم‌های ریزِ» یک مرحله‌ی قیف: تمام‌عرض، داخلِ همان ردیف */
  details.drill > summary { cursor:pointer; list-style:none; display:inline-flex; align-items:center; gap:6px; }
  details.drill > summary::-webkit-details-marker { display:none; }
  details.drill > summary .chev { color:var(--dim); transition:transform .15s; display:inline-block; }
  details.drill[open] > summary .chev { transform:rotate(-90deg); }
  .drill-body { margin-top:10px; border-top:1px dashed var(--line); padding-top:10px; white-space:normal; }
  .drill-body table { font-size:13px; }
  td.step { white-space:normal; max-width:520px; }
  .step-txt { display:block; color:var(--text); }
  .step-meta { display:block; color:var(--dim); font-size:11px; margin-top:2px; }
  .bar { display:inline-block; height:6px; border-radius:3px; background:var(--accent); vertical-align:middle; min-width:2px; }
  .drop { color:var(--bad); font-weight:700; }

  /* ═══ داشبوردِ اصلی (BI) ═══ */
  .dash-head h2 { font-size:18px; }
  .dash-filters { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  .pills { display:flex; gap:6px; flex-wrap:wrap; }
  .pills .pill { padding:6px 13px; border:1px solid var(--line); border-radius:99px; color:var(--text); background:#fff; font-size:13px; }
  .pills .pill.on { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:700; }
  /* اعدادِ درشتِ ردیفِ ثابت: مهم‌ترین‌ها بزرگ‌تر، دقیقاً برای «در یک نگاه» */
  .heroes { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; margin-bottom:16px; }
  .hero { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .hero .k { color:var(--dim); font-size:12px; }
  .hero .v { font-size:30px; font-weight:800; line-height:1.25; margin-top:4px; }
  .hero .s { color:var(--dim); font-size:11px; margin-top:4px; }
  .hero.big { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
  .hero.big .v { font-size:38px; color:var(--accent); }
  .hero .v details.cohort > summary { font-weight:800; }
  h3.ch { font-size:13px; color:var(--dim); font-weight:600; margin:0 0 10px; }
  .two { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:22px; }
  /* میله‌ی افقی (مقایسه‌ی دسته‌ها) */
  .hbars { display:flex; flex-direction:column; gap:7px; }
  .hb { display:flex; align-items:center; gap:9px; font-size:13px; }
  .hb-l { flex:0 0 150px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hb-t { flex:1; height:11px; background:#f1f3f9; border-radius:4px; overflow:hidden; min-width:40px; }
  .hb-f { display:block; height:100%; border-radius:4px; }
  .hb-v { flex:0 0 auto; min-width:38px; text-align:left; direction:ltr; }
  .hb-p { flex:0 0 46px; text-align:left; direction:ltr; }
  /* ستونی (مقادیرِ ترتیبی) */
  .cols { display:flex; align-items:flex-end; gap:10px; padding-top:22px; overflow-x:auto; }
  .col { display:flex; flex-direction:column; align-items:center; gap:5px; justify-content:flex-end; flex:1; min-width:52px; }
  .col-b { display:block; width:100%; max-width:64px; border-radius:4px 4px 0 0; }
  .col-v { font-size:12px; direction:ltr; }
  .col-l { font-size:11px; color:var(--dim); text-align:center; }
`;

/* منوی عمودی + محتوا. `active` مسیرِ صفحه‌ی جاری است و `bot` اسکوپِ رباتِ انتخاب‌شده
   (که `index.js` قبل از dispatch resolve کرده). همه‌ی لینک‌های منو اسکوپ را حمل می‌کنند
   تا عوض‌کردنِ صفحه هرگز ربات را بی‌صدا عوض نکند. */
export function layout(title, active, body, { msg = '', bot = '', session = null, path = '', query = null } = {}) {
  const navLink = ([href, label], cls = '') =>
    `<a href="${link(href, bot)}" class="${cls}${active === href ? ' active' : ''}">${esc(label)}</a>`;
  const nav = NAV.map((n) => {
    if (!n.children) return navLink([n.href, `${n.icon} ${n.label}`]);
    // ریشه‌ی گروه وقتی فعال است که یا خودش باز باشد یا یکی از زیرمنوهایش
    const on = active === n.href || inGroup(active);
    return `<a href="${link(n.href, bot)}" class="${on ? 'active' : ''}">${esc(`${n.icon} ${n.label}`)}</a>`
      + `<span class="sub">${n.children.map(c => navLink(c)).join('')}</span>`;
  }).join('');

  // منوی کشوییِ ربات: با تغییر، همان صفحه با اسکوپِ جدید باز می‌شود. فیلترهای صفحه حفظ
  // می‌شوند، ولی پارامترهای **رکوردمحور** (یک کاربر، یک کمپین، یک آزمایش) عمداً حذف
  // می‌شوند — وگرنه با عوض‌کردنِ ربات روی پروفایلِ یک کاربر، به رکوردِ رباتِ دیگر می‌رسیدی.
  const DROP = new Set(['bot', 'inst', 'id', 'q', 'key', 'pl', 'code', 'page']);
  const keep = [...(query || [])].filter(([k]) => !DROP.has(k))
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  /* 🌍 فیلترِ زبان — فقط برای رباتی که واقعاً چند زبان دارد (بند ۲و/۷: نمای پیش‌فرضِ
   * تجمیعی، با امکانِ تفکیک). مقدارش روی **همان** پارامترِ `bot` سوار می‌شود
   * (`tarot-intl@ru`)، نه یک پارامترِ جدا؛ این‌طور فیلتر خودکار روی همه‌ی صفحه‌ها و
   * همه‌ی لینک‌های داخلی می‌ماند بدونِ اینکه هیچ route ای عوض شود. */
  const langs = langPicker(bot);
  const curLang = String(bot).split('@')[1] || '';
  const base = String(bot).split('@')[0];
  const langSelect = langs.length ? `<select name="bot" data-autosubmit style="margin-top:6px">
      <option value="${esc(base)}" ${curLang ? '' : 'selected'}>همه‌ی زبان‌ها</option>
      ${langs.map(l => `<option value="${esc(base)}@${esc(l)}" ${l === curLang ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select>` : '';

  const picker = `<form class="botpick" method="get" action="${esc(path || '/')}">
    <span class="lbl">داشبوردِ کدام ربات؟</span>${keep}
    <select name="bot" data-autosubmit>${botsForPicker().map(b =>
      `<option value="${esc(b.key)}" ${b.key === String(bot).split('@')[0] ? 'selected' : ''}>${esc(b.title)}${b.hasDb ? '' : ' (بدون دیتابیس)'}</option>`).join('')}</select>
    ${langSelect}
    <noscript><button type="submit" style="margin-top:6px">برو</button></noscript>
  </form>`;

  const since = session?.createdAt ? tehranDateTime(Math.floor(session.createdAt / 1000)) : '-';
  return `<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — داشبورد ربات‌ها</title>
<style>${CSS}</style></head><body>
<div class="shell">
<aside class="side">
  <span class="brand">🧠 داشبورد ربات‌ها</span>
  ${picker}
  <div class="who">
    <span class="avatar">🧑‍💻</span>
    <span><span class="nm">ادمین مالک</span><br><span class="mt">ورود از ${esc(since)}</span></span>
  </div>
  <nav>${nav}</nav>
  <div class="foot">
    <form method="post" action="/logout"><button class="ghost" type="submit" style="width:100%">خروج</button></form>
  </div>
</aside>
<main>
${msg ? `<div class="note">${esc(msg)}</div>` : ''}
${body}
</main>
</div>
<script>
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-copy]');
  if (!el) return;
  navigator.clipboard.writeText(el.getAttribute('data-copy')).then(() => {
    const t = el.textContent; el.textContent = '✅ کپی شد';
    setTimeout(() => { el.textContent = t; }, 1200);
  });
});
// منوی کشوییِ ربات (و هر select دیگری با data-autosubmit) بدون دکمه‌ی «برو» کار می‌کند
document.addEventListener('change', (e) => {
  if (e.target.matches('select[data-autosubmit]')) e.target.form?.submit();
});
// عددهای کاربرمحور: با اولین باز شدن، لیستِ کاربرانش را همان‌جا (بدون ترک صفحه) می‌گیرد.
// رویداد toggle بابل نمی‌شود → شنونده در فاز capture ثبت می‌شود.
// هر <details data-frag="مسیر" data-q="query"> با اولین باز شدن، محتوایش را از سرور می‌گیرد
// (lazy — هزینه‌ی رندرِ صفحه صفر می‌ماند). عددهای کاربرمحور و قدم‌های ریزِ قیف هر دو از همین‌جا.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d || d.tagName !== 'DETAILS' || !d.open || d.dataset.loaded) return;
  const frag = d.dataset.frag || (d.classList.contains('cohort') ? '/cohort.fragment' : '');
  if (!frag) return;
  const box = d.querySelector('.cohort-body, .drill-body');
  if (!box) return;
  d.dataset.loaded = '1';
  box.textContent = 'در حال آوردن…';
  fetch(frag + '?' + d.dataset.q, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
    .then((h) => { box.innerHTML = h; })
    .catch(() => { box.innerHTML = '<span class="muted">باز نشد؛ دوباره امتحان کن.</span>'; d.dataset.loaded = ''; });
}, true);
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

/* عددِ کاربرمحورِ قابل‌کلیک (قرارداد: هیچ عددی که به کاربر اشاره می‌کند بن‌بست نباشد).
   params همان توصیفِ کوهورت است (lib/cohorts.js) — با کلیک، لیستِ کاربران همان‌جا باز می‌شود
   و هر آی‌دی به پروفایلِ همان کاربر در همان ربات می‌رود. صفر = بدون لینک (چیزی برای دیدن نیست). */
export function cohortCount(n, params, { suffix = '' } = {}) {
  const num = fmt(n);
  if (!Number(n)) return `<span class="muted">${num}</span>${suffix}`;
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  return `<details class="cohort" data-q="${esc(q)}"><summary>${num}</summary>`
    + `<div class="cohort-body muted">…</div></details>${suffix}`;
}

export function statusBadge(s) {
  const cls = s === 'approved' || s === 'delivered' || s === 'completed' ? 'ok'
    : s === 'rejected' || s === 'refunded' || s === 'failed' ? 'bad'
    : s === 'waiting_review' || s === 'pending' || s === 'pending_payment' ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(s)}</span>`;
}
