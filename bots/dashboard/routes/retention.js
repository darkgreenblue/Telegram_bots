// ریتنشن: مثلث هفتگی (کوهورت = هفته‌ی ورود کاربر؛ بازگشت = هر رویدادی در هفته‌های بعد)
// + خلاصه‌ی lifecycle هفته‌ی جاری (جدید/برگشتی/خفته). هفته‌ها تقویم تهران، شروع از شنبه.
import { instancesOf, botByKey, withDb, hasTable, rows, userPk, userCreatedExpr } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { fmt, esc, weekIdx, weekExpr, weekLabel } from '../lib/util.js';
import { table, stat, cohortCount } from '../lib/html.js';

function botRetention(botKey, weeksBack = 8) {
  const nowW = weekIdx(Math.floor(Date.now() / 1000));
  const firstW = nowW - weeksBack + 1;
  // cohorts[w] = تعداد کاربر واردشده در هفته‌ی w ؛ active[w][offset] = Set کاربر فعال
  const cohortSize = new Map();
  const cohortOf = new Map(); // userId -> week
  const activeSets = new Map(); // `${w}:${off}` -> Set
  let lastWeekActive = new Set(), thisWeekActive = new Set(), thisWeekNew = 0;

  const pk = userPk(botKey);
  const createdExpr = userCreatedExpr(botKey);
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      for (const u of rows(db, `SELECT ${pk} id, ${createdExpr} c FROM users`)) {
        const w = weekIdx(u.c);
        cohortOf.set(`${inst.id}:${u.id}`, w);
        if (w >= firstW) cohortSize.set(w, (cohortSize.get(w) || 0) + 1);
        if (w === nowW) thisWeekNew++;
      }
      if (!hasTable(db, 'events')) return;
      const wexpr = weekExpr('created_at'); // همان فرمولِ هفته‌ی کوهورت‌ها (lib/util.js) — بدون drift
      for (const r of rows(db, `SELECT DISTINCT user_id id, ${wexpr} w FROM events WHERE user_id IS NOT NULL`)) {
        const cw = cohortOf.get(`${inst.id}:${r.id}`);
        if (cw === undefined) continue;
        const off = r.w - cw;
        if (cw >= firstW && off >= 0 && off < weeksBack) {
          const k = `${cw}:${off}`;
          if (!activeSets.has(k)) activeSets.set(k, new Set());
          activeSets.get(k).add(`${inst.id}:${r.id}`);
        }
        if (r.w === nowW) thisWeekActive.add(`${inst.id}:${r.id}`);
        if (r.w === nowW - 1) lastWeekActive.add(`${inst.id}:${r.id}`);
      }
    });
  }
  const cohorts = [...cohortSize.keys()].sort((a, b) => a - b);
  const dormant = [...lastWeekActive].filter(id => !thisWeekActive.has(id)).length;
  return { cohorts, cohortSize, activeSets, nowW, weeksBack, lifecycle: { active: thisWeekActive.size, newUsers: thisWeekNew, dormant } };
}

export function retentionBody(url) {
  const bot = scopeBot(url);
  let out = `<div class="card"><p class="muted">هر ردیف = کاربران واردشده در آن هفته؛ ستون‌ها = ٪ برگشت در هفته‌های بعد (هر رویدادی = فعال). مبنای فعالیت جدول events است، پس از زمان نصب آنالیتیکس معتبر است. هفته‌ها شنبه‌محور به وقت تهران.</p></div>`;
  for (const b of [botByKey(bot)].filter(Boolean)) {
    if (!instancesOf(b.key).length) { out += `<div class="card"><p class="muted">برای این ربات دیتابیسی پیدا نشد.</p></div>`; continue; }
    const r = botRetention(b.key);
    if (!r.cohorts.length) continue;
    const headers = ['هفته‌ی ورود', 'کاربر', ...Array.from({ length: r.weeksBack }, (_, i) => `+${i}`)];
    const body = r.cohorts.map((w) => {
      const size = r.cohortSize.get(w) || 0;
      return [
        `<span class="mono">${weekLabel(w)}</span>`,
        // اندازه‌ی کوهورت = کاربرانِ واردشده در آن هفته (قابل کلیک)
        cohortCount(size, { k: 'retc', bot: b.key, w: String(w) }),
        ...Array.from({ length: r.weeksBack }, (_, off) => {
          if (w + off > r.nowW) return '';
          const a = r.activeSets.get(`${w}:${off}`)?.size || 0;
          const pct = size ? Math.round(a / size * 100) : 0;
          const bg = pct >= 40 ? '#dcfce7' : pct >= 15 ? '#fef9c3' : pct > 0 ? '#fee2e2' : 'transparent';
          // هر سلول = همان کاربرانِ کوهورت که در هفته‌ی +off برگشته‌اند
          return `<span style="display:inline-block;min-width:44px;background:${bg};border-radius:6px;padding:2px 4px">${pct}٪ `
            + cohortCount(a, { k: 'retcell', bot: b.key, w: String(w), off: String(off) }) + `</span>`;
        }),
      ];
    });
    out += `<div class="card"><h2>${esc(b.title)} — ریتنشن هفتگی</h2>
    <div class="grid" style="margin-bottom:10px">
      ${stat('فعال این هفته', cohortCount(r.lifecycle.active, { k: 'life', bot: b.key, t: 'active' }))}
      ${stat('جدید این هفته', cohortCount(r.lifecycle.newUsers, { k: 'life', bot: b.key, t: 'new' }))}
      ${stat('خفته (هفته‌ی قبل فعال، این هفته نه)', cohortCount(r.lifecycle.dormant, { k: 'life', bot: b.key, t: 'dormant' }))}
    </div>
    ${table(headers, body)}</div>`;
  }
  return out;
}
