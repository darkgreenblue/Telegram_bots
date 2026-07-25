// نمایشِ «کاربرانِ پشتِ یک عدد»: هم به‌صورت قطعه‌ی کشویی (داخل همان صفحه) و هم صفحه‌ی کامل.
// منطقِ انتخابِ کاربرها در lib/cohorts.js است؛ این‌جا فقط رندر است.
import { resolveCohort, COHORT_LIMIT } from '../lib/cohorts.js';
import { esc, fmt } from '../lib/util.js';
import { table } from '../lib/html.js';

// لینکِ پروفایلِ کاربر — همان مقصدی که ستون «کاربر» در تب مالی می‌رود
export const userLink = (instId, uid, text) =>
  `<a href="/support/user?inst=${encodeURIComponent(instId)}&id=${uid}" class="mono">${esc(text ?? uid)}</a>`;

const nameBit = (u) => {
  const bits = [];
  if (u.name) bits.push(esc(u.name));
  if (u.username) bits.push(`<span class="mono">@${esc(u.username)}</span>`);
  return bits.length ? ` <span class="muted">${bits.join(' · ')}</span>` : '';
};

/* قطعه‌ی کشویی (fetch از خودِ صفحه) — فقط لیستِ فشرده‌ی کاربران */
export function cohortFragment(url) {
  const r = resolveCohort(url);
  if (r.error) return `<span class="muted">${esc(r.error)}</span>`;
  if (!r.users.length) return `<span class="muted">کاربری در این گروه نیست.</span>`;

  // اگر چند instance (زبان/پلتفرم) قاطی‌اند، برچسبش را کنار هر کاربر نشان بده
  const multi = new Set(r.users.map(u => u.instId)).size > 1;
  const items = r.users.map(u =>
    `<span class="u">${userLink(u.instId, u.uid)}${nameBit(u)}`
    + (multi ? ` <span class="muted">${esc(u.instTitle)}</span>` : '')
    + `</span>`).join('');

  const head = `<div class="muted" style="margin-bottom:6px">${fmt(r.users.length)} کاربر`
    + (r.truncated ? ` (سقفِ نمایش ${fmt(COHORT_LIMIT)} — برای کاملش تب «کاربران» یا CSV)` : '')
    + ` · <a href="/cohort?${esc(url.searchParams.toString())}">صفحه‌ی کامل ←</a></div>`;
  return head + items;
}

/* صفحه‌ی کامل (هم fallback بدونِ جاوااسکریپت، هم وقتی لیست بلند است) */
export function cohortBody(url) {
  const r = resolveCohort(url);
  if (r.error) return `<div class="card"><p class="muted">${esc(r.error)}</p></div>`;
  const rowsHtml = r.users.map(u => [
    esc(u.instTitle),
    userLink(u.instId, u.uid),
    esc(u.name || '-'),
    u.username ? `<span class="mono">@${esc(u.username)}</span>` : '-',
    `<a href="/support/user?inst=${encodeURIComponent(u.instId)}&id=${u.uid}">پروفایل و تایم‌لاین ←</a>`,
  ]);
  return `<div class="card"><h2>👥 ${esc(r.title)}</h2>
  <p class="muted">${fmt(r.users.length)} کاربر${r.truncated ? ` — سقفِ نمایش ${fmt(COHORT_LIMIT)} کاربر است` : ''}. روی هر آی‌دی بزن تا پروفایل و تایم‌لاینش در همان ربات باز شود.</p>
  ${table(['ربات', 'آی‌دی', 'نام', 'یوزرنیم', ''], rowsHtml, 'کاربری در این گروه نیست.')}</div>`;
}
