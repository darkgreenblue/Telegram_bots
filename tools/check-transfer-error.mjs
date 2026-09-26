// چکِ CI برای «⛔️ نتوانستم واریز کنم» (tarot، v3.127.0 — فازِ ۵ِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// تصمیم‌های مالک که این فایل قفل می‌کند (شماره‌ها از «سؤال‌های باز»ِ plan):
//   • ۱۲/۱۸: اگر با وجودِ خطا پیامکِ واریز آمده، «پیامکش اومده» ⟵ تأییدِ دوم ⟵ الماسِ کاملِ همان
//     فاکتور، درآمد، پیامِ «نیازی به واریزِ دوباره نیست»، و فاکتورِ سفید بسته.
//   • ۱۵: فاکتورِ سفید دکمه‌ی تعویض ندارد و سفید تا آخرِ روز کارتِ کاربر می‌ماند.
//   • ۱۶: اولویت با سفیدِ همان ادمین.
//   • ۱۷: پیام به ادمینِ کارتِ **ناموفق** (+ کپیِ اطلاعاتیِ مالک).
//   • ۱۹: فقط یک اقدامِ خودکار per فاکتور؛ فاکتورِ از قبل سفید ⟵ مستقیم ادمین.
// خرابی‌های پولیِ بی‌صدا که این‌جا گرفته می‌شوند: اقدامِ دوباره روی یک فاکتور، جابه‌جاییِ کارتِ
// رسیدِ در انتظارِ بررسی، تأییدِ دوباره‌ی پرداختِ تأییدشده، و ادمینِ بی‌ربطی که بتواند تأیید کند.
//
// کدِ واقعی از index.js بریده و روی SQLite با تلگرامِ قلابی اجرا می‌شود.
import * as CA from '../bots/tarot/cards-admin.js';
import * as RT from '../bots/tarot/receipt-tags.js';
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { Markup } from '../bots/tarot/node_modules/telegraf/lib/index.js';
import fa from '../bots/tarot/locales/fa.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}

console.log('\n⛔️ نتوانستم واریز کنم\n');

/* ── ۱) تابعِ خالصِ انتخابِ کارتِ سفید ─────────────────────────────────────── */
console.log('انتخاب (CA.pickWhiteCard):');
const C = (id, admin, kind, sort, extra = {}) => ({ id, admin_id: admin, kind, sort, active: 1, daily_cap: 0, ...extra });
{
  const cards = [C(1, 7, 'regular', 1), C(5, 8, 'white', 2), C(6, 7, 'white', 3)];
  ok(CA.pickWhiteCard({ cards, currentId: 1 })?.id === 6, 'سفیدِ همان ادمین اول است (پاسخِ ۱۶)، حتی اگر در ترتیب عقب‌تر باشد');
  ok(CA.pickWhiteCard({ cards: [C(1, 7, 'regular', 1), C(5, 8, 'white', 2)], currentId: 1 })?.id === 5, 'سفیدِ همان ادمین نبود ⟵ هر سفیدِ دیگر');
  ok(CA.pickWhiteCard({ cards: [C(1, 7, 'regular', 1), C(3, 7, 'regular', 2)], currentId: 1 }) === null, 'هیچ سفیدی نیست ⟵ null (کارتِ عادی هرگز مقصد نیست)');
  ok(CA.pickWhiteCard({ cards: cards.map((c) => (c.id === 6 ? { ...c, active: 0 } : c)), currentId: 1 })?.id === 5, 'سفیدِ غیرفعال هرگز مقصد نیست');
  ok(CA.pickWhiteCard({ cards, currentId: 6 })?.id === 5, 'مقصد هرگز همان کارتِ فعلی نیست');
  ok(CA.pickWhiteCard({ cards: [], currentId: 1 }) === null && CA.pickWhiteCard({}) === null, 'ورودیِ خالی ⟵ null (کرش نه)');
}

/* ── ۲) متن‌ها ───────────────────────────────────────────────────────────────── */
console.log('\nمتن‌ها:');
{
  const t = RT.terrAdminText({ invoiceNo: 42, userId: 9, userName: 'سارا', amount: 60000,
    from: { number: '6219861904145405', bank: 'بلوبانک' }, to: { number: '5022291612282234' }, errText: 'امکان انتقال وجه وجود ندارد' });
  ok(t.includes('…5405') && t.includes('بلوبانک') && t.includes('…2234'), 'پیامِ ادمین: هر دو کارت (ناموفق و سفید)');
  ok(t.includes('#42') && t.includes('۶۰٬۰۰۰') && t.includes('سارا'), 'پیامِ ادمین: شماره‌ی فاکتور، مبلغ و کاربر');
  ok(t.includes('امکان انتقال وجه وجود ندارد') && t.includes('پیامکش اومده'), 'پیامِ ادمین: متنِ خطا و راهنمای دکمه');
  ok(!/\n\n\n/.test(RT.terrAdminText({ invoiceNo: 1, userId: 1, amount: 1, from: {}, to: {} })), 'بدونِ متنِ خطا خطِ خالیِ تکراری نمی‌ماند');
  ok(!/—/.test(t) && !/--/.test(t), 'بدونِ خط‌تیره‌ی بلند (بند ۱۰ ریشه)');
}
ok(fa.wallet.transferErrorApproved === '✅ پرداختت تأیید شد، نیازی به واریزِ دوباره نیست.', 'پیامِ کاربر عینِ متنِ مالک (پاسخِ ۱۸)');
ok(/کارتِ جدیدِ زیر/.test(fa.wallet.transferErrorHeader) && !/—/.test(fa.wallet.transferErrorHeader), 'سرتیترِ فاکتورِ سفید');
for (const lang of ['en', 'es', 'pt', 'ru']) {
  const src = readFileSync(`bots/tarot/locales/${lang}.js`, 'utf8');
  ok(/transferErrorHeader:/.test(src) && /transferErrorApproved:/.test(src), `${lang}: کلیدهای فازِ ۵ هست (شکلِ locale یکی)`);
}

/* ── ۳) رفتاری: همان کدِ index.js روی SQLite ──────────────────────────────── */
console.log('\nرفتاری:');
const readers = region('let _cardSt = null;', '\n// ایجنتِ رسیدِ کارت‌به‌کارت', { includeTo: false });
const helpers = region('const cardCopyRow', '\n// دکمه‌ی سوییچ به استارز', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const phase5 = region('/* ⛔️ فازِ ۵: «نتوانستم واریز کنم». */', '\n/* 🔎 ثبتِ یک اجرای ایجنتِ رسید', { includeTo: false });
const actions = region('const terrSmsKb', '\n/* ⭐ سیم‌کشیِ ریلِ استارز.', { includeTo: false });
const OWNER = 111;

function boot({ flag = true, shadow = true, stars = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    original_amount INTEGER, status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'receipt', pkg TEXT,
    invoice_msg_id INTEGER, stars_toggle_at INTEGER, receipt_file_id TEXT, invoice_no INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  const clock = { day: '2026-09-26' };
  const CAx = { ...CA, cardDay: () => clock.day };
  const errs = [], events = [], sessions = {}, states = {}, notified = [], sentTo = [], approved = [], after = [], ownerNotes = [];
  const handlers = [];
  const tg = { log: [] };
  const env = {
    CA: CAx, db, OWNER_ID: OWNER, CARD_ROTATION_ENABLED: true, CARD_SWITCH_ENABLED: true, starsRail: stars,
    TRANSFER_ERROR_ACTION_ENABLED: flag, RECEIPT_SHADOW_ENABLED: shadow,
    Markup, L: fa, TERR_BTN: RT.TERR_BTN, terrAdminText: RT.terrAdminText, RECEIPT_LIVE_STATES: ['pending', 'waiting_review'],
    bot: {
      action: (re, fn) => handlers.push({ re, fn }),
      telegram: {
        deleteMessage: async (c, m) => { tg.log.push(['delete', c, m]); },
        editMessageReplyMarkup: async (c, m) => { tg.log.push(['editkb', c, m]); },
        sendMessage: async (c, t) => { tg.log.push(['send', c, t]); return { message_id: 900 }; },
      },
    },
    log: () => {}, logErr: (...a) => errs.push(a.join(' ')), track: (_d, u, e, p) => events.push({ u, e, p }),
    curOf: () => ({ on: true, name: 'الماس', emoji: '💎' }), invoicePurchaseFor: () => null,
    starsToggleRow: () => [], packOf: () => null, getUser: (u) => ({ telegram_id: u }), dispName: () => 'سارا',
    invoiceNoOf: (p) => Number(p?.invoice_no) || Number(p?.id) || 0,
    isAdmin: (u) => u === OWNER,
    sendToReceiptRecipients: async (p, o, card) => { sentTo.push({ p, o, card }); return { message_id: 700 }; },
    creditedReceiptKb: (pid) => ({ credited: pid }),
    notifyOwnerAction: (actor, pid, label) => ownerNotes.push({ actor, pid, label }),
    approvedMsg: () => 'APPROVED',
    afterApproval: async (u) => { after.push(u); },
    patchSession: (u, o) => { sessions[u] = { ...(sessions[u] || {}), ...o }; }, setState: (u, s) => { states[u] = s; },
  };
  env.stmts = {
    getPayment: db.prepare('SELECT * FROM payments WHERE id=?'),
    setInvoiceMsgId: db.prepare('UPDATE payments SET invoice_msg_id=? WHERE id=?'),
  };
  // تأیید = همان قرارداد: فقط وضعیتِ زنده، یک بار.
  env.approvePayment = (pid) => {
    const p = env.stmts.getPayment.get(pid);
    if (!p || !['pending', 'waiting_review'].includes(p.status)) return null;
    db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(pid);
    approved.push({ pid, card_id: p.card_id });
    return { p, creditAmount: p.original_amount || p.amount, bonus: 0 };
  };
  const body = `const LEGACY_CARD = { id: 0, number: '6219861904145405', holder: 'x', bank: '', kind: 'regular', active: 1, admin_id: OWNER_ID };
    ${readers}\n${schema}\n${helpers}
    function canActOnPayment(uid, pid) {
      if (isAdmin(uid)) return true;
      const p = stmts.getPayment.get(pid);
      return !!p && Number(cardOfPayment(p).admin_id) === uid;
    }
    ${phase5}\n${actions}
    return { issueInvoiceCard, cardSt, cardOfPayment, whiteTargetFor, handleTransferError, canActOnTerr, terrOn };`;
  const f = new Function(...Object.keys(env), body);
  const h = { ...f(...Object.values(env)), db, clock, errs, events, sessions, states, handlers, tg, sentTo, approved, after, ownerNotes };
  // کارت‌ها: ۱ عادی (سید، مالک)، ۲ سفید (سید، مالک)، ۳ عادی با ادمینِ ۲۲۲.
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('6037997599199013','ب','-',222,'regular',3)").run();
  h.invoice = (uid, cardId = null) => {
    const id = Number(db.prepare('INSERT INTO payments (user_id, amount, original_amount, invoice_msg_id) VALUES (?, 60000, 30, 500)').run(uid).lastInsertRowid);
    h.issueInvoiceCard(id);
    if (cardId) db.prepare('UPDATE payments SET card_id=? WHERE id=?').run(cardId, id);
    return id;
  };
  h.pay = (pid) => db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
  h.ctx = (uid) => {
    const log = [];
    return { log, ctx: {
      from: { id: uid },
      reply: async (text, extra) => { log.push(['reply', text, extra]); return { message_id: 600 + log.length }; },
      telegram: {
        deleteMessage: async (_c, m) => { log.push(['delete', m]); },
        editMessageReplyMarkup: async () => { log.push(['editkb']); },
      },
    } };
  };
  h.act = async (data, actor) => {
    const log = [];
    const hd = handlers.find((x) => x.re.test(data));
    if (!hd) return null;
    const ctx = {
      from: { id: actor }, match: hd.re.exec(data),
      answerCbQuery: async (t, o) => { log.push(['cb', t || '', !!o?.show_alert]); },
      editMessageReplyMarkup: async (kb) => { log.push(['editkb', kb]); },
    };
    await hd.fn(ctx);
    return log;
  };
  return h;
}

const kbData = (extra) => (extra?.reply_markup?.inline_keyboard || []).flat().map((b) => b.callback_data || (b.copy_text ? 'copy' : b.text));
const SH = { transfer_error: true, transfer_error_text: 'امکان انتقال وجه وجود ندارد' };

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ فازِ ۵ شکست خورد:', e.message); }
if (h) {
  const { db } = h;
  ok(db.prepare("SELECT 1 FROM pragma_table_info('payments') WHERE name='transfer_error_at'").get(), 'ستونِ افزایشیِ transfer_error_at ساخته شد');
  ok(h.handlers.length === 3, 'سه هندلرِ terrsms/terryes/terrno ثبت شد');
  ok(h.terrOn() === true, 'terrOn: پرچم + ثبتِ ایجنت روشن + ریلِ کارت');

  // سناریوی اصلی: کاربرِ ۱ روی کارتِ ۳ (ادمین ۲۲۲) فاکتور دارد و عکسِ خطا می‌فرستد.
  const a = h.invoice(1, 3);
  db.prepare("UPDATE payments SET receipt_file_id='errshot' WHERE id=?").run(a);
  const { ctx, log } = h.ctx(1);
  const done = await h.handleTransferError(ctx, 1, h.pay(a), 'errshot', '', SH);
  const p = h.pay(a);
  ok(done === true, 'اقدامِ خودکار انجام شد');
  ok(p.card_id === 2 && p.prev_card_id === 3 && p.transfer_error_at > 0, 'فاکتور روی کارتِ سفید (۲)، کارتِ ناموفق در prev_card_id، مهرِ یک‌باره خورد');
  ok(p.receipt_file_id == null && p.status === 'pending', 'عکسِ خطا رسید حساب نمی‌شود و فاکتور همچنان باز است');
  ok(p.card_switched_at > 0, 'مهرِ تعویض هم خورد (دکمه‌ی تعویضِ دوم ساخته نمی‌شود)');
  ok(db.prepare("SELECT card_id, via FROM card_assign WHERE user_id=1").get()?.via === 'transfer_error'
    && db.prepare("SELECT card_id FROM card_assign WHERE user_id=1").get().card_id === 2, 'سفید تا آخرِ روز کارتِ کاربر شد (پاسخِ ۱۵)');
  const kinds = log.map((x) => x[0]);
  ok(kinds[0] === 'delete' && log[0][1] === 500, 'اول پیامِ فاکتورِ کارتِ ناموفق حذف شد (یک فاکتورِ زنده در چت)');
  const replies = log.filter((x) => x[0] === 'reply');
  ok(replies.length === 2 && replies[0][1] === fa.wallet.transferErrorHeader, 'سرتیترِ «کارتِ جدید»، بعد فاکتور');
  ok(replies[1][1].includes('5022-2916-1228-2234'), 'فاکتورِ تازه شماره‌ی کارتِ سفید را دارد');
  const keys = kbData(replies[1][2]);
  ok(keys[0] === 'copy' && keys.at(-1) === `pay_cancel:${a}` && !keys.some((k) => /^card_switch:/.test(k)),
    'کیبورد: کپی … انصراف، **بدونِ** دکمه‌ی تعویض (فاکتورِ سفید)');
  ok(h.pay(a).invoice_msg_id > 600, 'شناسه‌ی فاکتورِ تازه ثبت شد (انصراف و «پیامکش اومده» همان را پاک می‌کنند)');
  ok(h.sessions[1]?.paymentId === a && h.states[1] === 'pay_receipt', 'سشن و استیت روی همان فاکتور (رسیدِ کارتِ سفید همان‌جا می‌نشیند)');
  ok(h.events.some((e) => e.e === 'transfer_error_switch' && e.p.from === 3 && e.p.to === 2 && e.p.src === 'photo'), 'رویدادِ افزایشیِ transfer_error_switch');
  const sent = h.sentTo[0];
  ok(sent && sent.card?.id === 3, 'پیامِ ادمین با کارتِ **ناموفق** مسیریابی شد (ادمین ۲۲۲ + کپیِ مالک، پاسخِ ۱۷)');
  ok(sent?.o.photoFileId === 'errshot' && sent.o.caption.includes('امکان انتقال وجه وجود ندارد') && sent.o.caption.includes('…2234'),
    'پیامِ ادمین: عکسِ خطا + متنِ خطا + کارتِ سفید');
  ok(sent?.o.kb?.inline_keyboard?.[0]?.[0]?.callback_data === `terrsms:${a}`, 'دکمه‌ی «پیامکش اومده»');

  // یک بار per فاکتور (پاسخِ ۱۹).
  const { ctx: c2, log: l2 } = h.ctx(1);
  ok(await h.handleTransferError(c2, 1, h.pay(a), 'x', '', SH) === false && l2.length === 0, 'خطای دوم روی همان فاکتور ⟵ هیچ اقدامی (به ادمین می‌رود)');
  ok(h.whiteTargetFor(h.pay(a)) === null, 'whiteTargetFor روی فاکتورِ اقدام‌شده ⟵ null');

  // اجازه: ادمینِ کارتِ ناموفق (۲۲۲)، مالک؛ ادمینِ بی‌ربط نه.
  ok(h.canActOnTerr(222, a) === true, 'ادمینِ کارتِ ناموفق اجازه دارد (حالا کارتِ فعلی سفید است)');
  ok(h.canActOnTerr(OWNER, a) === true && h.canActOnTerr(333, a) === false, 'مالک بله، ادمینِ بی‌ربط نه');
  ok((await h.act(`terrsms:${a}`, 333))?.[0]?.[1] === '🔒', 'ادمینِ بی‌ربط ⟵ 🔒');
  ok((await h.act(`terryes:${a}`, 333))?.[0]?.[1] === '🔒' && h.pay(a).status === 'pending', 'ادمینِ بی‌ربط نمی‌تواند تأیید کند');

  // دو مرحله‌ای: terrsms ⟵ بله/انصراف، terrno ⟵ برگشت.
  const s1 = await h.act(`terrsms:${a}`, 222);
  const kb1 = s1.find((x) => x[0] === 'editkb')?.[1]?.inline_keyboard?.flat().map((b) => b.callback_data);
  ok(kb1?.join() === `terryes:${a},terrno:${a}`, 'terrsms ⟵ تأییدِ دوم (بله / انصراف)، هیچ پولی جابه‌جا نشد');
  ok(h.pay(a).status === 'pending', 'terrsms خودش چیزی را تأیید نمی‌کند');
  const s2 = await h.act(`terrno:${a}`, 222);
  ok(s2.find((x) => x[0] === 'editkb')?.[1]?.inline_keyboard?.[0]?.[0]?.callback_data === `terrsms:${a}`, 'terrno ⟵ همان دکمه‌ی «پیامکش اومده» برمی‌گردد');

  // terryes: کارت به ناموفق برمی‌گردد، تأیید، فاکتورِ سفید حذف، پیامِ کاربر.
  h.tg.log.length = 0;
  const y = await h.act(`terryes:${a}`, 222);
  ok(h.approved.length === 1 && h.approved[0].card_id === 3, 'تأیید **بعد از** برگشتِ کارت به کارتِ ناموفق (سقف و ادمین همان کارت)');
  ok(h.pay(a).status === 'approved' && h.pay(a).card_id === 3 && h.pay(a).prev_card_id === 2, 'پرداخت approved روی کارتِ ۳');
  ok(y.some((x) => x[0] === 'editkb' && x[1]?.credited === a), 'کیبوردِ پیام ⟵ همان کیبوردِ رسیدِ اعتباردیده (پیامکش نیومده/تکراری)');
  ok(h.tg.log.some((x) => x[0] === 'delete' && x[1] === 1 && x[2] === h.pay(a).invoice_msg_id), 'فاکتورِ سفید از چتِ کاربر حذف شد');
  const msg = h.tg.log.find((x) => x[0] === 'send' && x[1] === 1);
  ok(msg?.[2].startsWith(fa.wallet.transferErrorApproved) && msg[2].includes('APPROVED'), 'پیامِ کاربر: «نیازی به واریزِ دوباره نیست» + پیامِ تأییدِ همیشگی');
  ok(h.after.includes(1), 'afterApproval (ادامه‌ی فالِ رزروشده، مثلِ هر تأیید)');
  ok(h.ownerNotes.some((n) => n.actor === 222 && n.pid === a), 'مالک از اقدامِ ادمینِ دیگر خبردار شد');
  ok(h.events.some((e) => e.e === 'transfer_error_confirmed' && e.p.payment_id === a), 'رویدادِ افزایشیِ transfer_error_confirmed');

  // دوبار-تپ / دکمه‌ی کهنه.
  const again = await h.act(`terryes:${a}`, 222);
  ok(again.some((x) => x[0] === 'cb' && x[2]) && h.approved.length === 1, 'تپِ دوم ⟵ پاپ‌آپِ «قبلاً پردازش شده»، تأییدِ دوم نه');

  // رسیدِ کارتِ ناموفق از قبل نسبت داده شده (card_id = ناموفق) ⟵ جابه‌جاییِ دوباره نه.
  const b = h.invoice(4, 3);
  await h.handleTransferError(h.ctx(4).ctx, 4, h.pay(b), null, 'نمیشه', { transfer_error: true });
  db.prepare("UPDATE payments SET card_id=3, prev_card_id=2, status='waiting_review' WHERE id=?").run(b);
  await h.act(`terryes:${b}`, OWNER);
  ok(h.pay(b).card_id === 3 && h.pay(b).status === 'approved', 'پرداختِ از قبل روی کارتِ ناموفق ⟵ کارت سرِ جایش، تأیید (رسیدِ در انتظار هم مجاز)');

  // کارتِ از قبل سفید ⟵ هیچ اقدامی.
  const w = h.invoice(5, 2);
  ok(await h.handleTransferError(h.ctx(5).ctx, 5, h.pay(w), null, 'x', SH) === false && h.pay(w).transfer_error_at == null,
    'فاکتورِ از قبل سفید ⟵ اقدامی نیست (مستقیم ادمین، پاسخِ ۱۹)');
  // رسیدِ ثبت‌شده هرگز جابه‌جا نمی‌شود.
  const r = h.invoice(6, 3);
  db.prepare("UPDATE payments SET status='waiting_review' WHERE id=?").run(r);
  ok(await h.handleTransferError(h.ctx(6).ctx, 6, h.pay(r), null, 'x', SH) === false && h.pay(r).card_id === 3, 'فاکتورِ غیرِ pending ⟵ دست نمی‌خورد');
  // هیچ سفیدی نیست.
  db.prepare('UPDATE cards SET active=0 WHERE id=2').run();
  const n = h.invoice(7, 3);
  ok(await h.handleTransferError(h.ctx(7).ctx, 7, h.pay(n), null, 'x', SH) === false && h.pay(n).card_id === 3, 'سفیدی نیست ⟵ اقدامی نیست');
  ok(!h.errs.length, `هیچ خطایی نیفتاد${h.errs.length ? ': ' + h.errs[0] : ''}`);
}

// رول‌بک، بدونِ ثبتِ ایجنت، و رباتِ استارز ⟵ terrOn خاموش.
for (const [label, opts] of [['TRANSFER_ERROR_ACTION_ENABLED=false', { flag: false }], ['RECEIPT_SHADOW_ENABLED=false', { shadow: false }], ['رباتِ استارز', { stars: true }]]) {
  let r; try { r = boot(opts); } catch (e) { fail++; console.error(`  ❌ ${label}:`, e.message); continue; }
  ok(r.terrOn() === false, `${label} ⟵ terrOn خاموش (processReceipt هیچ اقدامی نمی‌زند)`);
}

/* ── ۴) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
{
  const body = region('async function processReceipt', '\nasync function notifyAdminAutoApproved');
  const iRec = body.indexOf('recordReceiptAnalysis(p, uid, verdict, decision');
  const iTerr = body.indexOf('handleTransferError(ctx, uid, p');
  const iDist = body.indexOf('if (distrusted) {');
  const iFail = body.indexOf('if (decision.agentFailed) {');
  const iSleep = body.indexOf('await sleep(receiptDecisionDelayMs');
  ok(iRec > 0 && iRec < iTerr && iTerr < iDist && iTerr < iFail && iTerr < iSleep,
    'ترتیب: ثبت ⟵ تشخیصِ خطای انتقال ⟵ (بی‌اعتماد/شکستِ ایجنت/تأخیرِ ساختگی)؛ کاربر معطل نمی‌ماند');
  const cond = body.slice(body.indexOf('if (!decision.agentFailed && terrOn()'), iTerr);
  ok(/!decision\.agentFailed/.test(cond) && /terrOn\(\)/.test(cond) && /\.transfer_error/.test(cond)
    && /decision\.action !== 'approve'/.test(cond) && /decision\.action !== 'underpaid'/.test(cond),
    'شرط: ایجنتِ سالم + پرچم + خطای صریح + رسیدِ ناموفق (تأیید/کم‌پرداخت یعنی پول رسیده)');
  ok(/TERR_ADMIN_NOTE\);/.test(body.slice(iTerr, iDist)), 'اقدامِ ناممکن ⟵ مستقیم به ادمین با یادداشت (پاسخِ ۱۹)');
  ok(/RECEIPT_AI_AUTO_APPROVE \|\| \(distrusted && !terrOn\(\)\)/.test(body), 'بی‌اعتماد فقط برای همین تشخیص ایجنت را می‌بیند (پاسخِ ۲۰)');
}
ok(/_terrClaim \|\|= db\.prepare\("UPDATE payments SET [^"]*transfer_error_at=unixepoch\(\)[^"]*WHERE id=\? AND card_id=\? AND transfer_error_at IS NULL AND status='pending'"\)/.test(SRC),
  'ادعا اتمیک است: یک بار، فقط فاکتورِ باز، فقط از همان کارت');
ok(/terrsms:\\d\+\|terryes:\\d\+\|terrno:\\d\+/.test(SRC), 'گاردِ مرکزیِ کالبک سه دکمه را در pay_receipt عبور می‌دهد');
ok((CODE.match(/\bTRANSFER_ERROR_ACTION_ENABLED\b/g) || []).length === 2, 'پرچم فقط تعریف + terrOn (رول‌بکِ یک‌خطی)');
ok(/ALTER TABLE payments ADD COLUMN transfer_error_at INTEGER/.test(CODE), 'مهاجرت افزایشی است (بند ۲ج/۱)');
{
  const yes = region("bot.action(/^terryes:(\\d+)$/", '\n});');
  const iSwap = yes.indexOf('swapToPrev.run(pid)');
  const iApp = yes.indexOf('approvePayment(pid)');
  ok(iSwap > 0 && iSwap < iApp, 'برگشتِ کارت قبل از تأیید (سقفِ روزانه روی کارتی که پول آن‌جاست)');
  ok(/canActOnTerr\(ctx\.from\.id, pid\)/.test(yes) && !/\bcredit\.run\b/.test(yes), 'اجازه چک می‌شود و هیچ واریزِ موازی‌ای جز approvePayment نیست');
}
ok(/CA\.pickWhiteCard\(/.test(CODE) && !/function pickWhiteCard/.test(CODE), 'انتخاب فقط از تک‌منبعِ خالص (cards-admin.js)');
ok(/const PRODUCT_VERSION = '3\.1(2[7-9]|[3-9]\d)\.\d+';/.test(CODE), 'PRODUCT_VERSION ≥ 3.127.0');

console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
