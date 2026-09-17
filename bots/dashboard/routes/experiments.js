// تست‌ها (A/B): ساخت/اجرا/توقف نرم/kill/تصمیم + نتایج آماری صادقانه برای نمونه‌ی کم.
// config آزمایش در DB خود ربات نوشته می‌شود (ربات با کش ۶۰ثانیه‌ای می‌خواند — توقف بدون deploy).
import { instancesOf, getInstance, withDb, withWritableDb, hasTable, scalar, rows, abSupported, familyOf } from '../lib/bots.js';
import { scopeBot } from '../lib/nav.js';
import { ensureAb } from '../../../shared/ab.js';
import { chanceToWin, rateCI, srmCheck, meanSE, MIN_SAMPLE, SHIP_CTW } from '../lib/stats.js';
import { audit, listCampaigns } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, nowSec, parseJsonSafe } from '../lib/util.js';
import { table, stat } from '../lib/html.js';
import { FUNNELS } from './funnels.js';

const STATUS_FA = { draft: 'پیش‌نویس', running: 'در حال اجرا', draining: 'توقف نرم (drain)', stopped: 'متوقف' };
const DECISION_FA = { shipped: 'اجرا شد (ship)', rolled_back: 'برگشت خورد', inconclusive: 'بی‌نتیجه' };

function listExperiments(botKey) {
  const out = [];
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'experiments')) return;
      for (const e of rows(db, 'SELECT * FROM experiments ORDER BY created_at DESC')) out.push({ inst, e });
    });
  }
  return out;
}

/* ---------- صفحه‌ی فهرست + فرم ساخت ---------- */
export function experimentsBody(url) {
  const bot = scopeBot(url);
  // فقط ربات‌هایی که variant() را سیم‌کشی کرده‌اند (abSupport) قابل تست‌اند
  const abInstances = instancesOf(bot).filter(i => abSupported(i.bot));
  const instOptions = abInstances.map(i => `<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('')
    || '<option value="">(این ربات هنوز A/B را سیم‌کشی نکرده)</option>';
  const form = `<div class="card"><h2>➕ آزمایش جدید</h2>
  <form method="post" action="/experiments/create" class="inline">
    <label>ربات<select name="inst">${instOptions}</select></label>
    <label>کلید (انگلیسی — همین کلید در کد ربات صدا زده می‌شود)<input name="key" dir="ltr" placeholder="onboard_cta_order" required></label>
    <label>نام<input name="name" placeholder="ترتیب دکمه‌های آنبوردینگ"></label>
    <label>فرضیه<input name="hypothesis" placeholder="اگر ... آنگاه ..."></label>
    <label>حالت<select name="mode">
      <option value="split">split (تقسیم هم‌زمان — معتبرترین)</option>
      <option value="switchover">switchover (همه از این به بعد — شواهد ضعیف)</option>
    </select></label>
    <label>نوع متریک<select name="metric_kind">
      <option value="rate">نرخ تبدیل (rate)</option>
      <option value="value">مقداری (value — فقط میانگین±SE)</option>
    </select></label>
    <label>کلید variant دوم<input name="vkey" dir="ltr" value="b"></label>
    <label>وزن variant دوم ٪<input name="vweight" type="number" min="1" max="100" value="50"></label>
    <label>متریک اصلی (نام رویداد)<input name="primary" dir="ltr" value="product_delivered"></label>
    <label>گاردریل‌ها (با کاما)<input name="guardrails" dir="ltr" value="refund"></label>
    <button type="submit">بساز (پیش‌نویس)</button>
  </form>
  <p class="muted">گردش‌کار: کلید و شاخه‌های variant باید در کد ربات با <span class="mono">variant(db, uid, 'key')</span> پیاده شده باشد (از Claude بخواه) → این‌جا آزمایش را بساز و «شروع» بزن → توقف/تصمیم هم همین‌جا، بدون deploy. وزن‌ها بعد از شروع فریز می‌شوند؛ برای تغییر وزن آزمایش جدید بساز.</p></div>`;

  const list = table(
    ['آزمایش', 'ربات', 'حالت/متریک', 'وضعیت', 'تصمیم', 'شروع', ''],
    listExperiments(bot).map(({ inst, e }) => [
      `<b>${esc(e.name || e.key)}</b><div class="muted mono">${esc(e.key)}</div>`,
      esc(inst.title),
      `${esc(e.mode)} / ${esc(e.metric_kind)}`,
      `<span class="badge ${e.status === 'running' ? 'ok' : e.status === 'stopped' ? '' : 'warn'}">${STATUS_FA[e.status] || esc(e.status)}</span>`,
      e.decision ? esc(DECISION_FA[e.decision.split(':')[0]] || e.decision) : '-',
      e.started_at ? tehranDateTime(e.started_at) : '-',
      `<a href="/experiments/view?inst=${encodeURIComponent(inst.id)}&key=${encodeURIComponent(e.key)}">نتایج ←</a>`,
    ]),
    'هنوز آزمایشی نساخته‌ای.'
  );
  return form + `<div class="card"><h2>🧪 آزمایش‌ها (آرشیو کامل — تگ کاربران در ab_exposures برای همیشه می‌ماند)</h2>${list}</div>`;
}

/* ---------- نتایج ---------- */
function expResults(inst, e) {
  return withDb(inst.file, (db) => {
    const variants = parseJsonSafe(e.variants_json, []);
    const exp = rows(db, 'SELECT variant, COUNT(*) c FROM ab_exposures WHERE experiment_key=? GROUP BY variant', [e.key]);
    const expByV = new Map(exp.map(r => [r.variant, r.c]));
    const conv = e.primary_metric ? rows(db, `
      SELECT x.variant, COUNT(DISTINCT ev.user_id) c
      FROM ab_exposures x JOIN events ev ON ev.user_id = x.user_id
      WHERE x.experiment_key=? AND ev.event=? AND ev.created_at >= x.created_at
      GROUP BY x.variant`, [e.key, e.primary_metric]) : [];
    const convByV = new Map(conv.map(r => [r.variant, r.c]));
    const guardrails = parseJsonSafe(e.guardrails_json, []).map(g => ({
      event: g,
      byV: new Map(rows(db, `
        SELECT x.variant, COUNT(DISTINCT ev.user_id) c
        FROM ab_exposures x JOIN events ev ON ev.user_id = x.user_id
        WHERE x.experiment_key=? AND ev.event=? AND ev.created_at >= x.created_at
        GROUP BY x.variant`, [e.key, g]).map(r => [r.variant, r.c])),
    }));
    // متریک مقداری: تعداد رخداد متریک per کاربر expose شده
    let valueByV = null;
    if (e.metric_kind === 'value' && e.primary_metric) {
      valueByV = new Map();
      for (const r of rows(db, `
        SELECT x.variant, x.user_id, COUNT(ev.id) n
        FROM ab_exposures x LEFT JOIN events ev ON ev.user_id = x.user_id AND ev.event=? AND ev.created_at >= x.created_at
        WHERE x.experiment_key=?
        GROUP BY x.variant, x.user_id`, [e.primary_metric, e.key])) {
        if (!valueByV.has(r.variant)) valueByV.set(r.variant, []);
        valueByV.get(r.variant).push(r.n);
      }
    }
    /* اگر آزمایش با تخصیصِ لایه‌بندی‌شده اجرا شده باشد، نتیجه‌ی هر لایه جدا می‌آید.
     * این برای آزمایش‌های هم‌زمان (مثلاً ظاهرِ CTA کنارِ قیمت) حیاتی است: جمع‌زدنِ
     * کورکورانه‌ی لایه‌ها می‌تواند اثرِ یک آزمایش را به دیگری نسبت بدهد. try/catch
     * سازگاری داشبورد با DBهای قدیمیِ قبل از ستون stratum را حفظ می‌کند. */
    let strata = [];
    try {
      strata = rows(db, `
        SELECT x.stratum, x.variant, COUNT(*) exposure,
          COUNT(DISTINCT ev.user_id) conversion
        FROM ab_exposures x
        LEFT JOIN events ev ON ev.user_id=x.user_id AND ev.event=? AND ev.created_at >= x.created_at
        WHERE x.experiment_key=? AND COALESCE(x.stratum,'')<>''
        GROUP BY x.stratum, x.variant
        ORDER BY x.stratum, x.variant`, [e.primary_metric, e.key]);
    } catch {}
    return { variants, expByV, convByV, guardrails, valueByV, strata };
  }, null);
}

function variantFunnel(inst, e, funnelSteps) {
  return withDb(inst.file, (db) => {
    const variants = parseJsonSafe(e.variants_json, []).map(v => v.key);
    const body = funnelSteps.map(([ev, label]) => [
      esc(label),
      ...variants.map(vk => fmt(scalar(db, `
        SELECT COUNT(DISTINCT ev.user_id) c
        FROM ab_exposures x JOIN events ev ON ev.user_id = x.user_id
        WHERE x.experiment_key=? AND x.variant=? AND ev.event=? AND ev.created_at >= x.created_at`,
        [e.key, vk, ev]))),
    ]);
    return table(['مرحله (بعد از exposure)', ...variants.map(esc)], body, 'دیتایی نیست.');
  }, '');
}

export function experimentViewBody(url) {
  const inst = getInstance(url.searchParams.get('inst') || '');
  const key = url.searchParams.get('key') || '';
  if (!inst) return '<div class="card"><p class="muted">ربات نامعتبر.</p></div>';
  const e = withDb(inst.file, db => db.prepare('SELECT * FROM experiments WHERE key=?').get(key), null);
  if (!e) return '<div class="card"><p class="muted">آزمایش پیدا نشد.</p></div>';

  const r = expResults(inst, e);
  const variants = r.variants.map(v => v.key);
  const control = variants.includes('control') ? 'control' : variants[0];
  const totalExposed = variants.reduce((s, v) => s + (r.expByV.get(v) || 0), 0);
  const minExposed = Math.min(...variants.map(v => r.expByV.get(v) || 0));

  /* --- هشدارها --- */
  let warnings = '';
  if (minExposed < MIN_SAMPLE) warnings += `<div class="note">⚠️ کم‌نمونه (${fmt(minExposed)} < ${fmt(MIN_SAMPLE)} per variant) — نتیجه فقط جهت‌نماست، نه قطعی.</div>`;
  const { p: srmP, srm } = srmCheck(variants.map(v => r.expByV.get(v) || 0), r.variants.map(v => Number(v.weight) || 0));
  if (srm) warnings += `<div class="note">🚨 SRM: توزیع exposure با وزن‌ها نمی‌خواند (p=${srmP.toExponential(1)}) — احتمالاً باگ انتساب؛ به نتایج اعتماد نکن.</div>`;
  if (e.mode === 'switchover') {
    warnings += `<div class="note">⚠️ switchover = مقایسه‌ی قبل/بعد زمانی؛ روز هفته/کمپین/فصل می‌تواند نتیجه را آلوده کند — شواهد ضعیف.</div>`;
    const overlapping = listCampaigns().filter(c => c.bot === inst.bot && e.started_at && c.created_at >= e.started_at);
    if (overlapping.length) warnings += `<div class="note">🚨 هم‌زمان با این آزمایش کمپین ساخته‌ای (${overlapping.map(c => esc(c.name || c.code)).join('، ')}) — مقایسه‌ی قبل/بعد بی‌اعتبار می‌شود.</div>`;
  }

  /* --- جدول نتایج متریک اصلی --- */
  let resultsCard;
  if (e.metric_kind === 'rate') {
    const cConv = r.convByV.get(control) || 0, cN = r.expByV.get(control) || 0;
    const body = variants.map(vk => {
      const n = r.expByV.get(vk) || 0, conv = r.convByV.get(vk) || 0;
      const rate = n ? conv / n : 0;
      const [lo, hi] = rateCI(conv, n);
      let ctwCell = '—', liftCell = '—';
      if (vk !== control && n && cN) {
        const ctw = chanceToWin(conv, n, cConv, cN);
        const liftPct = cConv && cN ? ((rate - cConv / cN) / (cConv / cN)) * 100 : null;
        liftCell = liftPct === null ? '—' : `${liftPct >= 0 ? '+' : ''}${liftPct.toFixed(1)}٪`;
        const cls = ctw >= SHIP_CTW ? 'ok' : ctw <= 1 - SHIP_CTW ? 'bad' : 'warn';
        ctwCell = `<span class="badge ${cls}">${(ctw * 100).toFixed(1)}٪</span>`;
      }
      return [
        `<b>${esc(vk)}</b>${vk === control ? ' <span class="muted">(مبنا)</span>' : ''}`,
        fmt(n), fmt(conv),
        `${(rate * 100).toFixed(1)}٪ <span class="muted">[${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}]</span>`,
        liftCell, ctwCell,
      ];
    });
    resultsCard = `<div class="card"><h2>📊 متریک اصلی: <span class="mono">${esc(e.primary_metric)}</span> (نرخ تبدیل بعد از exposure)</h2>
    ${table(['variant', 'exposure', 'تبدیل', 'نرخ [بازه ۹۵٪]', 'lift نسبی', 'شانس برد'], body)}
    <p class="muted">قانون پیش‌فرض تصمیم: ship اگر شانس برد > ${SHIP_CTW * 100}٪ و هیچ گاردریلی بدتر نشده باشد.</p></div>`;
  } else {
    const body = variants.map(vk => {
      const { n, mean, se } = meanSE(r.valueByV?.get(vk) || []);
      return [`<b>${esc(vk)}</b>`, fmt(n), `${mean.toFixed(2)} ± ${se.toFixed(2)}`];
    });
    resultsCard = `<div class="card"><h2>📊 متریک مقداری: <span class="mono">${esc(e.primary_metric)}</span> (میانگین رخداد per کاربر)</h2>
    ${table(['variant', 'کاربر', 'میانگین ± SE'], body)}
    <p class="muted">برای متریک مقداری «شانس برد» گزارش نمی‌شود (صداقت آماری) — همپوشانی بازه‌ها یعنی هنوز نتیجه‌ای نیست.</p></div>`;
  }

  /* --- گاردریل‌ها --- */
  const guardCard = r.guardrails.length ? `<div class="card"><h2>🛡 گاردریل‌ها (نباید بدتر شوند)</h2>
  ${table(['رویداد', ...variants.map(esc)], r.guardrails.map(g => [
    `<span class="mono">${esc(g.event)}</span>`,
    ...variants.map(vk => {
      const n = r.expByV.get(vk) || 0, c = g.byV.get(vk) || 0;
      return `${fmt(c)} <span class="muted">(${n ? (c / n * 100).toFixed(1) : 0}٪)</span>`;
    }),
  ]))}</div>` : '';

  /* جدولِ مستقل برای اثرِ مشترکِ آزمایش‌ها: «exposure / تبدیل / نرخ» هر variant در
   * هر لایه. با این جدول، توازن 50/50 و نرخِ رنگ در control/bulk قیمت جدا دیده می‌شود. */
  const strataMap = new Map();
  for (const row of r.strata || []) {
    if (!strataMap.has(row.stratum)) strataMap.set(row.stratum, new Map());
    strataMap.get(row.stratum).set(row.variant, row);
  }
  const strataCard = strataMap.size ? `<div class="card"><h2>🧩 نتایج لایه‌بندی‌شده</h2>
    <p class="muted">هر لایه باید جدا خوانده شود؛ نرخِ جمع‌شده فقط نمای کلی است و جای تحلیلِ اثرِ متقابل را نمی‌گیرد.</p>
    ${table(['لایه', ...variants.map(esc)], [...strataMap.entries()].map(([stratum, byVariant]) => [
      `<span class="mono">${esc(stratum)}</span>`,
      ...variants.map(vk => {
        const row = byVariant.get(vk); const n = Number(row?.exposure) || 0; const c = Number(row?.conversion) || 0;
        return `${fmt(n)} / ${fmt(c)} / ${n ? (c / n * 100).toFixed(1) : '0.0'}٪`;
      }),
    ]), 'هنوز exposure لایه‌بندی‌شده‌ای نیست.')}
    <p class="muted">هر خانه: exposure / تبدیلِ متریک اصلی / نرخ تبدیل</p></div>` : '';

  /* --- فانل per variant --- */
  const funnelDef = FUNNELS[familyOf(inst.bot)];
  const funnelCard = funnelDef ? `<div class="card"><h2>🔻 فانل به تفکیک variant</h2>${variantFunnel(inst, e, funnelDef.steps)}</div>` : '';

  /* --- کنترل چرخه --- */
  const btn = (to, label, ghost = false) => `<form method="post" action="/experiments/status" style="display:inline">
    <input type="hidden" name="inst" value="${esc(inst.id)}"><input type="hidden" name="key" value="${esc(e.key)}">
    <input type="hidden" name="to" value="${to}"><button type="submit" ${ghost ? 'class="ghost"' : ''}>${label}</button></form>`;
  let controls = '';
  if (e.status === 'draft') controls = btn('running', '▶️ شروع آزمایش');
  else if (e.status === 'running') controls = btn('draining', '⏸ توقف نرم (drain)', true) + ' ' + btn('stopped', '🛑 Kill (برگشت فوری همه به control)');
  else if (e.status === 'draining') controls = btn('stopped', '⏹ پایان (stopped)');
  const decisionForm = e.status === 'stopped' && !e.decision ? `
    <form method="post" action="/experiments/decide" class="inline" style="margin-top:8px">
      <input type="hidden" name="inst" value="${esc(inst.id)}"><input type="hidden" name="key" value="${esc(e.key)}">
      <label>تصمیم<select name="decision">
        <option value="shipped">ship — variant برنده اجرا شود</option>
        <option value="rolled_back">برگشت — control می‌ماند</option>
        <option value="inconclusive">بی‌نتیجه</option>
      </select></label>
      <label>یادداشت<input name="note" placeholder="چرا؟"></label>
      <button type="submit">ثبت تصمیم</button>
    </form>` : '';

  const header = `<div class="card"><h2>🧪 ${esc(e.name || e.key)} <span class="badge ${e.status === 'running' ? 'ok' : 'warn'}">${STATUS_FA[e.status]}</span></h2>
  <p>${esc(e.hypothesis || '')}</p>
  <div class="grid">
    ${stat('کلید', `<span class="mono">${esc(e.key)}</span>`)}
    ${stat('حالت/متریک', `${esc(e.mode)} / ${esc(e.metric_kind)}`)}
    ${stat('کل exposure', fmt(totalExposed))}
    ${stat('شروع', e.started_at ? tehranDateTime(e.started_at) : '-')}
    ${stat('پایان', e.stopped_at ? tehranDateTime(e.stopped_at) : '-')}
    ${e.decision ? stat('تصمیم', esc(e.decision)) : ''}
  </div>
  <div style="margin-top:12px">${controls}</div>${decisionForm}</div>`;

  return header + warnings + resultsCard + guardCard + strataCard + funnelCard;
}

/* ---------- اکشن‌ها ---------- */
export function experimentCreate(body) {
  const inst = getInstance(body.get('inst') || '');
  if (!inst) throw new Error('ربات نامعتبر');
  if (!abSupported(inst.bot)) throw new Error('این ربات هنوز A/B را سیم‌کشی نکرده (variant() در کدش نیست)');
  const key = (body.get('key') || '').trim();
  if (!/^[a-z0-9_]{3,48}$/.test(key)) throw new Error('کلید فقط حروف کوچک/عدد/underscore');
  const mode = body.get('mode') === 'switchover' ? 'switchover' : 'split';
  const metricKind = body.get('metric_kind') === 'value' ? 'value' : 'rate';
  const vkey = (body.get('vkey') || 'b').trim() || 'b';
  if (!/^[a-z0-9_]{1,32}$/.test(vkey) || vkey === 'control') throw new Error('کلید variant نامعتبر');
  let w = Math.min(100, Math.max(1, parseInt(body.get('vweight'), 10) || 50));
  if (mode === 'switchover') w = 100; // switchover یعنی همه‌ی کاربران جدید variant را ببینند
  const variantsJson = JSON.stringify([{ key: 'control', weight: 100 - w }, { key: vkey, weight: w }]);
  const primary = (body.get('primary') || '').trim().slice(0, 64);
  const guardrails = (body.get('guardrails') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
  withWritableDb(inst.file, (db) => {
    ensureAb(db); // اگر ربات هنوز با ensureAb دیپلوی نشده، جدول‌ها با همان DDL مشترک ساخته می‌شوند
    db.prepare(`INSERT INTO experiments (key, name, hypothesis, mode, metric_kind, variants_json, primary_metric, guardrails_json)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(key, body.get('name')?.slice(0, 100) || '', body.get('hypothesis')?.slice(0, 500) || '',
        mode, metricKind, variantsJson, primary, JSON.stringify(guardrails));
  });
  audit('experiment.create', `${inst.id}/${key}`, `${mode}/${metricKind} primary=${primary}`);
  return `آزمایش ${key} ساخته شد (پیش‌نویس — با «شروع» فعال می‌شود)`;
}

export function experimentStatus(body) {
  const inst = getInstance(body.get('inst') || '');
  const key = body.get('key') || '';
  const to = body.get('to') || '';
  if (!inst || !['running', 'draining', 'stopped'].includes(to)) throw new Error('پارامتر نامعتبر');
  withWritableDb(inst.file, (db) => {
    const e = db.prepare('SELECT * FROM experiments WHERE key=?').get(key);
    if (!e) throw new Error('آزمایش پیدا نشد');
    const allowed = { draft: ['running'], running: ['draining', 'stopped'], draining: ['stopped'] }[e.status] || [];
    if (!allowed.includes(to)) throw new Error(`گذار ${e.status} → ${to} مجاز نیست`);
    db.prepare(`UPDATE experiments SET status=?,
      started_at = COALESCE(started_at, CASE WHEN ?='running' THEN unixepoch() END),
      stopped_at = CASE WHEN ? IN ('draining','stopped') THEN unixepoch() ELSE stopped_at END
      WHERE key=?`).run(to, to, to, key);
  });
  audit('experiment.status', `${inst.id}/${key}`, to);
  return `وضعیت آزمایش ${key} → ${STATUS_FA[to]} (حداکثر ۶۰ ثانیه تا اثر روی ربات)`;
}

export function experimentDecide(body) {
  const inst = getInstance(body.get('inst') || '');
  const key = body.get('key') || '';
  const d = body.get('decision') || '';
  if (!inst || !['shipped', 'rolled_back', 'inconclusive'].includes(d)) throw new Error('پارامتر نامعتبر');
  const note = (body.get('note') || '').slice(0, 300);
  withWritableDb(inst.file, (db) => {
    db.prepare("UPDATE experiments SET decision=? WHERE key=? AND status='stopped'").run(note ? `${d}: ${note}` : d, key);
  });
  audit('experiment.decide', `${inst.id}/${key}`, `${d} ${note}`);
  return `تصمیم آزمایش ${key} ثبت شد`;
}
