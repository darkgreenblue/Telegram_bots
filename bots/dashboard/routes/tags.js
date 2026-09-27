// 🏷 تگ‌های رسید (اپ/بانکِ مبدأ) — فازِ ۶ِ `bots/tarot/PAYMENT-V2-PLAN.md` (v3.128.0).
//
// کارتی داخلِ پروفایلِ کاربر (صفحه‌ی پشتیبانی): سابقه‌ی تگ‌های کاربر، تگِ هر رسیدش (دیدن و
// عوض‌کردن) و فهرستِ مقدارها (افزودن، فعال/غیرفعال).
//
// قرارداد نشکستنی (همان مسیرِ کارت‌ها و پشتیبانی): داشبورد **مستقیم روی جدول‌های تگ نمی‌نویسد**.
// هر تغییر یک ردیفِ `receipt_tag` در `admin_actions` می‌شود و sweepِ ۶۰ثانیه‌ایِ ربات اجرایش
// می‌کند. اعتبارسنجی تک‌منبع است (`planTagOp` از خودِ ربات): داشبورد قبل از صف‌کردن صدایش
// می‌زند تا خطا همین‌جا دیده شود، و ربات لحظه‌ی اجرا دوباره روی وضعیتِ همان لحظه.
import { getInstance, withDb, withWritableDb, assertColumns, hasTable, rows, receiptTagsSupported } from '../lib/bots.js';
import { fmt, esc, tehranDateTime } from '../lib/util.js';
import { table, statusBadge } from '../lib/html.js';
import { audit } from '../lib/platform.js';
import * as RT from '../../tarot/receipt-tags.js';

const SOURCE_MARK = { admin: '', auto: ' 🤖' };

/** کارتِ «🏷 تگ‌های رسید» برای پروفایلِ یک کاربر. رباتِ بدونِ قابلیت ⟵ `''` (کارت نیست). */
export function tagsCard(inst, uid) {
  if (!inst || !receiptTagsSupported(inst.bot)) return '';
  return withDb(inst.file, (db) => {
    if (!hasTable(db, 'tag_values') || !hasTable(db, 'receipt_tags')) {
      return `<div class="card"><h2>🏷 تگ‌های رسید</h2>
        <p class="muted">جدول‌های تگ هنوز ساخته نشده‌اند (ربات بعد از دیپلوی می‌سازدشان).</p></div>`;
    }
    const values = rows(db, 'SELECT dim, key, label, active, sort FROM tag_values ORDER BY dim, sort, rowid');
    const labelOf = (d, k) => values.find((v) => v.dim === d && v.key === k)?.label || k;
    // همان تعریفِ ربات (`tagSt().ofUser`): سابقه فقط از رسیدهای ردنشده.
    const histRows = rows(db, `SELECT t.payment_id, t.dim, t.value_key, t.source FROM receipt_tags t
      JOIN payments p ON p.id = t.payment_id WHERE t.user_id=? AND p.status NOT IN ('rejected','reversed')`, [uid]);
    const hist = RT.historyLine(RT.tagHistory(histRows), labelOf);
    const pays = rows(db, `SELECT id, amount, status, created_at AS t FROM payments
      WHERE user_id=? AND receipt_file_id IS NOT NULL ORDER BY id DESC LIMIT 15`, [uid]);
    const eff = RT.effectiveTags(pays.length
      ? rows(db, `SELECT payment_id, dim, value_key, source FROM receipt_tags
          WHERE payment_id IN (${pays.map(() => '?').join(',')})`, pays.map((p) => p.id))
      : []);
    const queued = new Set(rows(db,
      "SELECT ref_id FROM admin_actions WHERE action='receipt_tag' AND done_at IS NULL AND ref_id IS NOT NULL")
      .map((r) => r.ref_id));
    const hidden = `<input type="hidden" name="inst" value="${esc(inst.id)}"><input type="hidden" name="uid" value="${uid}">`;

    const dimForm = (pid, dim) => {
      const cur = eff[pid]?.[dim];
      const opts = values.filter((v) => v.dim === dim && (Number(v.active) === 1 || v.key === cur?.key));
      return `<form method="post" action="/support/tag" class="inline">${hidden}
        <input type="hidden" name="pid" value="${pid}"><input type="hidden" name="dim" value="${dim}">
        <select name="key"><option value="">— بدونِ تگ —</option>${opts.map((v) =>
          `<option value="${esc(v.key)}"${cur?.key === v.key ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <button type="submit" class="ghost">ثبت</button></form>`
        + (cur ? ` <span class="muted">${esc(labelOf(dim, cur.key))}${SOURCE_MARK[cur.source] || ''}</span>` : '');
    };
    const payRows = pays.map((p) => [
      `#${p.id}`, `${fmt(p.amount)} ت`, statusBadge(p.status), tehranDateTime(p.t),
      queued.has(p.id) ? '<span class="badge warn">در صف (تا ۱ دقیقه)</span>' : dimForm(p.id, 'app'),
      queued.has(p.id) ? '' : dimForm(p.id, 'bank'),
    ]);

    const valueRows = values.map((v) => [
      `${RT.TAG_DIM_ICON[v.dim] || ''} ${esc(RT.TAG_DIM_LABEL[v.dim] || v.dim)}`,
      esc(v.label), `<code>${esc(v.key)}</code>`,
      Number(v.active) === 1 ? '<span class="badge ok">فعال</span>' : '<span class="badge">غیرفعال</span>',
      `<form method="post" action="/support/tag" class="inline">${hidden}
        <input type="hidden" name="op" value="value_active"><input type="hidden" name="dim" value="${esc(v.dim)}">
        <input type="hidden" name="key" value="${esc(v.key)}"><input type="hidden" name="active" value="${Number(v.active) === 1 ? 0 : 1}">
        <button type="submit" class="ghost">${Number(v.active) === 1 ? 'غیرفعال کن' : 'فعال کن'}</button></form>`,
    ]);

    return `<div class="card"><h2>🏷 تگ‌های رسید</h2>
      <p>${hist ? esc(hist) : '<span class="muted">هنوز هیچ رسیدِ ردنشده‌ای از این کاربر تگ نخورده.</span>'}</p>
      <p class="muted">تگ فقط برای شماست (روی پیامِ رسید در تلگرام هم فقط برای مالک دیده می‌شود).
        سابقه از رسیدهای ردنشده شمرده می‌شود. 🤖 = تگِ خودکار؛ تگِ دستیِ شما همیشه بر آن مقدم است.
        «بدونِ تگ» فقط تگِ دستی را پاک می‌کند.</p>
      ${table(['رسید', 'مبلغ', 'وضعیت', 'زمان', '📱 اپ', '🏦 بانک'], payRows, 'این کاربر هنوز رسیدی نفرستاده')}
      <details style="margin-top:12px"><summary>مقدارهای تگ (افزودن / فعال‌وغیرفعال)</summary>
        <form method="post" action="/support/tag" class="inline" style="margin:10px 0">${hidden}
          <input type="hidden" name="op" value="value_add">
          <label>بُعد<select name="dim">${RT.TAG_DIMS.map((d) =>
            `<option value="${d}">${esc(RT.TAG_DIM_LABEL[d])}</option>`).join('')}</select></label>
          <label>کلید (لاتین)<input type="text" name="key" maxlength="24" pattern="[a-z0-9_]{1,24}" required style="width:120px" placeholder="resalat"></label>
          <label>برچسب<input type="text" name="label" maxlength="24" required style="width:140px" placeholder="رسالت"></label>
          <button type="submit">➕ افزودن</button>
        </form>
        <p class="muted">هیچ مقداری حذف نمی‌شود تا تگ‌های قدیمی همیشه برچسبِ خوانا داشته باشند؛ غیرفعال یعنی
          فقط از دکمه‌ها و فهرست‌های انتخاب محو می‌شود. کلیدِ تکراری برچسبش را به‌روز و فعالش می‌کند.</p>
        ${table(['بُعد', 'برچسب', 'کلید', 'وضعیت', ''], valueRows, 'مقداری نیست')}
      </details>
    </div>`;
  }, '');
}

/** ساختِ دستور از فرم. `key=''` روی یک رسید یعنی پاک‌کردنِ تگِ دستی. */
export function tagOpFromForm(body) {
  const op = String(body.get('op') || '');
  const dim = String(body.get('dim') || '');
  const key = String(body.get('key') || '');
  if (op === 'value_add') return { op, dim, key, label: String(body.get('label') || '') };
  if (op === 'value_active') return { op, dim, key, active: body.get('active') === '1' };
  return key ? { op: 'set', dim, key } : { op: 'clear', dim };
}

export function tagAction(body) {
  const inst = getInstance(body.get('inst') || '');
  if (!inst) throw new Error('ربات نامعتبر');
  const uid = parseInt(body.get('uid'), 10);
  if (!uid) throw new Error('کاربر نامعتبر');
  /* ⛔ گارد قبل از هر نوشتن (همان درسِ `support.js`/`cards.js`): فرمِ POST از تبِ کهنه هم
     می‌آید. رباتی که `receipt_tag` را اجرا نکند ردیف را بی‌صدا done می‌کرد. */
  if (!receiptTagsSupported(inst.bot)) throw new Error('این ربات تگِ رسید از داشبورد را اجرا نمی‌کند');
  const op = tagOpFromForm(body);
  const pid = op.op === 'set' || op.op === 'clear' ? parseInt(body.get('pid'), 10) : 0;

  let msg = '';
  withWritableDb(inst.file, (db) => {
    if (!hasTable(db, 'tag_values') || !hasTable(db, 'receipt_tags')) throw new Error('جدول‌های تگ هنوز ساخته نشده‌اند');
    assertColumns(db, 'admin_actions', ['payment_id', 'action', 'user_id', 'amount', 'ref_id', 'note']);
    let payment = null;
    if (op.op === 'set' || op.op === 'clear') {
      if (!pid) throw new Error('شماره‌ی رسید نامعتبر');
      payment = db.prepare('SELECT id, user_id, status FROM payments WHERE id=?').get(pid) || null;
      if (!payment) throw new Error('رسید پیدا نشد');
      if (payment.user_id !== uid) throw new Error('این رسید مالِ این کاربر نیست');
      if (db.prepare("SELECT 1 FROM admin_actions WHERE action='receipt_tag' AND ref_id=? AND done_at IS NULL").get(pid)) {
        throw new Error('برای این رسید یک تغییرِ تگ در صف است؛ صبر کن');
      }
    }
    // همان تک‌منبعِ اعتبارسنجیِ ربات، روی وضعیتِ همین لحظه.
    const plan = RT.planTagOp(op, { values: db.prepare('SELECT dim, key, label, active FROM tag_values').all(), payment });
    if (!plan.ok) throw new Error(plan.err);
    if (plan.noop) { msg = 'تغییری لازم نبود (مقدار از قبل همین است)'; return; }
    // ⚠️ فقط شکلِ **اعتبارسنجی‌شده** در صف می‌نشیند، نه ورودیِ خام؛ ربات دوباره می‌سنجدش.
    const a = plan.apply;
    const clean = a.t === 'set' ? { op: 'set', dim: a.dim, key: a.key }
      : a.t === 'clear' ? { op: 'clear', dim: a.dim }
        : a.t === 'value_add' ? { op: 'value_add', dim: a.dim, key: a.key, label: a.label }
          : { op: 'value_active', dim: a.dim, key: a.key, active: !!a.active };
    // payment_id=0 عمداً: این ردیف نباید قفلِ «یک اقدام در صف» ِ اقدام‌های پولیِ همان پرداخت را بگیرد.
    db.prepare('INSERT INTO admin_actions (payment_id, action, user_id, amount, ref_id, note) VALUES (?,?,?,?,?,?)')
      .run(0, 'receipt_tag', a.uid || null, null, a.pid || null, JSON.stringify(clean));
    msg = `«${plan.what}» در صفِ ربات قرار گرفت (تا ۱ دقیقه)`;
  });
  audit('support.tag', `${inst.id}/${uid}`, JSON.stringify(op).slice(0, 200));
  return msg;
}
