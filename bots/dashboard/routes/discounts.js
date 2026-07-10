// کد تخفیف: ساخت/غیرفعال‌سازی از داشبورد با درج مستقیم در discount_codes همان ربات.
// منطق validate خودِ ربات‌ها دست نمی‌خورد؛ سازگاری کامل با schema هر ربات + گارد schema قبل از هر write.
// نکته‌ی voice2text: اگر نه سگمنت و نه لیست کاربر ست شود، کد برای هیچ‌کس معتبر نیست → فرم حداقل یکی را اجبار می‌کند.
import { randomBytes } from 'crypto';
import { instances, getInstance, withDb, withWritableDb, assertColumns, hasTable, rows } from '../lib/bots.js';
import { audit } from '../lib/platform.js';
import { fmt, esc, tehranDateTime, nowSec, parseJsonSafe } from '../lib/util.js';
import { table } from '../lib/html.js';

// همان سگمنت‌های تعریف‌شده در voice2text (SEGMENTS در index.js آن ربات) — فقط برچسب برای UI
const V2T_SEGMENTS = {
  all: 'همه', new: 'جدید (<۷روز)', no_balance: 'بدون موجودی', inactive: 'غیرفعال (>۳۰روز)',
  loyal: 'وفادار (۵+ شارژ)', premium: 'پریمیوم', first_charge: 'اولین شارژ',
  high_usage: 'پرمصرف (۱۰+)', low_balance: 'موجودی کم',
};

const discountInstances = () => instances().filter(i => withDb(i.file, db => hasTable(db, 'discount_codes'), false));

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[buf[i] % chars.length];
  return `DASH-${s}`;
}

export function discountsBody() {
  const insts = discountInstances();
  if (!insts.length) return `<div class="card"><p class="muted">هیچ رباتی با جدول کد تخفیف در دسترس نیست.</p></div>`;

  const instOptions = insts.map(i => `<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('');
  const segBoxes = Object.entries(V2T_SEGMENTS)
    .map(([k, l]) => `<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="seg_${k}" ${k === 'all' ? 'checked' : ''}>${esc(l)}</label>`).join('');

  const form = `<div class="card"><h2>➕ کد تخفیف جدید</h2>
  <form method="post" action="/discounts/create" class="inline">
    <label>ربات<select name="inst">${instOptions}</select></label>
    <label>کد (خالی = خودکار)<input name="code" dir="ltr" placeholder="مثلاً EYD1404"></label>
    <label>درصد تخفیف<input name="percent" type="number" min="1" max="100" value="20" required></label>
    <label>سقف مبلغ تخفیف (تومان، خالی = بدون سقف)<input name="max_amount" type="number" min="0"></label>
    <label>انقضا (روز، ۰ = بدون انقضا)<input name="days" type="number" min="0" value="30"></label>
    <label>سقف استفاده هر کاربر<input name="max_per_user" type="number" min="1" value="1"></label>
    <label>فقط این کاربر (اختیاری — tarot)<input name="only_user" dir="ltr" placeholder="آی‌دی عددی"></label>
    <label>کاربران مجاز (اختیاری — voice2text)<input name="user_entries" dir="ltr" placeholder="id یا @username با کاما"></label>
    <button type="submit">بساز</button>
  </form>
  <div class="inline" style="margin-top:8px"><span class="muted">سگمنت‌های voice2text:</span>${segBoxes}</div>
  <p class="muted">قاعده‌ی voice2text: کدِ بدون سگمنت و بدون لیست کاربر برای هیچ‌کس معتبر نیست؛ اگر هیچ‌کدام را ندهی «همه» ست می‌شود. کدها بزرگ‌نوشته ذخیره می‌شوند (همان قراردادی که ربات‌ها با آن validate می‌کنند).</p></div>`;

  let lists = '';
  for (const inst of insts) {
    const codes = withDb(inst.file, (db) => rows(db, `
      SELECT dc.*,
        (SELECT COUNT(*) FROM discount_uses du WHERE du.code_id = dc.id) uses_count,
        (SELECT COALESCE(SUM(du.discount_amount),0) FROM discount_uses du WHERE du.code_id = dc.id) discounted,
        (SELECT COUNT(DISTINCT du.user_id) FROM discount_uses du WHERE du.code_id = dc.id) users_count
      FROM discount_codes dc ORDER BY dc.id DESC LIMIT 100`), []);
    const body = codes.map(c => {
      const scope = c.only_user_id ? `فقط ${c.only_user_id}`
        : c.allowed_segments ? parseJsonSafe(c.allowed_segments, []).map(s => V2T_SEGMENTS[s] || s).join('، ')
        : c.allowed_user_ids ? `${parseJsonSafe(c.allowed_user_ids, []).length} کاربر مشخص` : 'عمومی';
      return [
        `<span class="mono">${esc(c.code)}</span>`,
        `${c.discount_percent}٪` + (c.max_discount_amount ? ` <span class="muted">تا ${fmt(c.max_discount_amount)} ت</span>` : ''),
        esc(scope),
        c.expires_at ? tehranDateTime(c.expires_at) : 'بدون انقضا',
        `${fmt(c.uses_count)} بار / ${fmt(c.users_count)} کاربر`,
        fmt(c.discounted) + ' ت',
        c.is_active ? '<span class="badge ok">فعال</span>' : '<span class="badge bad">غیرفعال</span>',
        `<form method="post" action="/discounts/toggle" style="display:inline">
          <input type="hidden" name="inst" value="${esc(inst.id)}"><input type="hidden" name="id" value="${c.id}">
          <button class="ghost" type="submit">${c.is_active ? 'غیرفعال کن' : 'فعال کن'}</button></form>`,
      ];
    });
    lists += `<div class="card"><h2>🎟 کدهای ${esc(inst.title)}</h2>
    ${table(['کد', 'تخفیف', 'محدوده', 'انقضا', 'استفاده', 'مبلغ تخفیف‌داده', 'وضعیت', ''], body, 'کدی نیست.')}</div>`;
  }
  return form + lists;
}

export function discountCreate(body) {
  const inst = getInstance(body.get('inst') || '');
  if (!inst) throw new Error('ربات نامعتبر');
  let code = (body.get('code') || '').trim().toUpperCase();
  if (!code) code = genCode();
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new Error('کد فقط حروف انگلیسی/عدد/خط تیره (۳ تا ۳۲)');
  const percent = parseInt(body.get('percent'), 10);
  if (!(percent >= 1 && percent <= 100)) throw new Error('درصد نامعتبر');
  const maxAmount = parseInt(body.get('max_amount'), 10) || null;
  const days = Math.max(0, parseInt(body.get('days'), 10) || 0);
  const expiresAt = days ? nowSec() + days * 86400 : null;
  const maxPerUser = Math.max(1, parseInt(body.get('max_per_user'), 10) || 1);

  withWritableDb(inst.file, (db) => {
    if (inst.bot === 'voice2text') {
      const segs = Object.keys(V2T_SEGMENTS).filter(k => body.get(`seg_${k}`));
      const entries = (body.get('user_entries') || '').split(',').map(s => s.trim()).filter(Boolean)
        .map(s => /^\d+$/.test(s) ? parseInt(s, 10) : s.replace(/^@/, '').toLowerCase());
      // بدون سگمنت و بدون کاربر = برای هیچ‌کس معتبر نیست (قاعده‌ی خود ربات) → پیش‌فرض «همه»
      const finalSegs = segs.length || entries.length ? segs : ['all'];
      assertColumns(db, 'discount_codes', ['code', 'discount_percent', 'max_discount_amount', 'expires_at', 'max_uses_per_user', 'allowed_segments', 'allowed_user_ids', 'created_by']);
      db.prepare(`INSERT INTO discount_codes (code, discount_percent, max_discount_amount, expires_at, max_uses_per_user, allowed_segments, allowed_user_ids, created_by)
        VALUES (?,?,?,?,?,?,?,0)`)
        .run(code, percent, maxAmount, expiresAt, maxPerUser,
          finalSegs.length ? JSON.stringify(finalSegs) : null,
          entries.length ? JSON.stringify(entries) : null);
    } else {
      const onlyUser = parseInt(body.get('only_user'), 10) || null;
      assertColumns(db, 'discount_codes', ['code', 'discount_percent', 'max_discount_amount', 'expires_at', 'max_uses_per_user', 'only_user_id', 'created_by']);
      db.prepare(`INSERT INTO discount_codes (code, discount_percent, max_discount_amount, expires_at, max_uses_per_user, only_user_id, created_by)
        VALUES (?,?,?,?,?,?,0)`)
        .run(code, percent, maxAmount, expiresAt, maxPerUser, onlyUser);
    }
  });
  audit('discount.create', `${inst.id}/${code}`, `${percent}% cap=${maxAmount || '-'} days=${days || '-'} perUser=${maxPerUser}`);
  return `کد ${code} برای ${inst.title} ساخته شد`;
}

export function discountToggle(body) {
  const inst = getInstance(body.get('inst') || '');
  const id = parseInt(body.get('id'), 10);
  if (!inst || !id) throw new Error('پارامتر نامعتبر');
  let code = '';
  withWritableDb(inst.file, (db) => {
    assertColumns(db, 'discount_codes', ['id', 'code', 'is_active']);
    const c = db.prepare('SELECT id, code, is_active FROM discount_codes WHERE id=?').get(id);
    if (!c) throw new Error('کد پیدا نشد');
    db.prepare('UPDATE discount_codes SET is_active=? WHERE id=?').run(c.is_active ? 0 : 1, id);
    code = c.code;
  });
  audit('discount.toggle', `${inst.id}/${code}`, '');
  return `وضعیت کد ${code} عوض شد`;
}
