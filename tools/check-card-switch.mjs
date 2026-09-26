// چکِ CI برای «🔄 تعویض شماره کارت» (tarot، v3.125.0 — فازِ ۳ِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// تصمیم‌های مالک که این فایل قفل می‌کند:
//   • دکمه زیرِ دکمه‌ی کپی و بالای انصراف، **یک بار برای هر فاکتور**.
//   • انتخاب: کارتِ بعدیِ همان ادمین ⟵ (نبود یا پر بود) کارتِ ادمینِ بعدی ⟵ (نبود) کارتِ سفید.
//   • کارتِ تازه کارتِ امروزِ کاربر می‌شود؛ فاکتورهای بعدیِ امروزش هم روی همان می‌نشینند.
//   • پیامِ فاکتورِ قبلی **حذف** می‌شود (دو فاکتورِ هم‌زمان نه)، اول سرتیترِ «فاکتور جدید»،
//     بعد همان فاکتور با کارتِ تازه و یک خطِ هشدارِ اضافه در پایین.
//   • هر فاکتوری که دکمه دارد تذکرِ «در صورت خطا از دکمه‌ی تعویض استفاده کنید» را هم دارد.
// خرابی‌های پولیِ بی‌صدا که این‌جا گرفته می‌شوند: دو تعویض روی یک فاکتور، تعویض روی فاکتورِ
// بسته، دو فاکتورِ زنده با دو شماره‌ی متفاوت در چت، و دکمه‌ای که به کارتی نرسد.
//
// کدِ واقعی از index.js بریده و روی SQLite با تلگرامِ قلابی اجرا می‌شود.
import * as CA from '../bots/tarot/cards-admin.js';
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

console.log('\n🔄 تعویضِ شماره کارت\n');

/* ── ۱) تابعِ خالصِ انتخاب ─────────────────────────────────────────────────── */
console.log('انتخاب (CA.pickSwitchCard):');
const C = (id, admin, kind, sort, extra = {}) => ({ id, admin_id: admin, kind, sort, active: 1, daily_cap: 0, ...extra });
const cards = [C(1, 7, 'regular', 1), C(2, 7, 'white', 2), C(3, 8, 'regular', 3), C(4, 7, 'regular', 4)];
const sw = (currentId, o = {}) => CA.pickSwitchCard({ cards, currentId, ...o });
ok(sw(1)?.card.id === 4 && sw(1).via === 'same_admin', 'کارتِ بعدیِ همان ادمین اول است (۱ ⟵ ۴، از روی کارتِ ادمینِ دیگر رد می‌شود)');
ok(sw(4)?.card.id === 1 && sw(4).via === 'same_admin', 'ترتیب دوره‌ای است (۴ ⟵ ۱)');
ok(sw(3)?.card.id === 4 && sw(3).via === 'next_admin', 'ادمین کارتِ دیگری ندارد ⟵ کارتِ ادمینِ بعدی (بعد از جایگاهِ فعلی)');
ok(sw(1, { used: new Map([[4, 5]]), cards: cards.map((c) => (c.id === 4 ? { ...c, daily_cap: 5 } : c)) })?.card.id === 3,
  'کارتِ همان ادمین پر است ⟵ ادمینِ بعدی');
ok(sw(1, { cards: cards.map((c) => (c.id === 4 ? { ...c, active: 0 } : c)) })?.card.id === 3, 'کارتِ غیرفعال هرگز مقصد نیست');
{
  const two = [C(1, 7, 'regular', 1), C(2, 7, 'white', 2)];
  const r = CA.pickSwitchCard({ cards: two, currentId: 1 });
  ok(r?.card.id === 2 && r.via === 'white', 'هیچ کارتِ عادیِ دیگری نیست ⟵ کارتِ سفید');
  ok(CA.pickSwitchCard({ cards: two, currentId: 2 })?.card.id === 1, 'از سفید هم می‌شود به عادی رفت');
  ok(CA.pickSwitchCard({ cards: [C(1, 7, 'regular', 1)], currentId: 1 }) === null, 'تنها کارت ⟵ null (دکمه ساخته نمی‌شود)');
  ok(CA.pickSwitchCard({ cards: two, currentId: 1, used: new Map([[2, 3]]) })?.card.id === 2, 'کارتِ سفیدِ بی‌سقف همیشه در دسترس است');
}
ok(sw(0)?.card.id === 1, 'کارتِ فعلیِ ناشناخته ⟵ اولین کارتِ عادی (کرش نه)');
ok([1, 2, 3, 4].every((id) => sw(id)?.card.id !== id), 'مقصد هرگز همان کارتِ فعلی نیست');

/* ── ۲) متنِ فاکتور ────────────────────────────────────────────────────────── */
console.log('\nمتنِ فاکتور:');
const INV = (extra) => fa.wallet.invoice(60000, '6219861904145405', 'علیرضا اولیا — بلوبانک', null, null, extra);
const WARN = '⚠️🔴 لطفا از اپلیکیشن‌های آپ، ۷۸۰، همراه کارت و تاپ استفاده نکنید!🔴';
const NOTE = '❗️🔁 در صورت مواجهه با خطا در انتقال وجه، از دکمه‌ی «تعویض شماره کارت» استفاده کنید.';
ok(INV(null) === fa.wallet.invoice(60000, '6219861904145405', 'علیرضا اولیا — بلوبانک'), 'بدونِ extra متن بیت‌به‌بیت همان قبلی است');
ok(INV({ note: true }).endsWith(`━━━━━━━━━━━━━\n${NOTE}`) && !INV({ note: true }).includes(WARN), 'فاکتورِ دکمه‌دار: فقط تذکر، در خطِ آخر');
ok(INV({ switched: true }).endsWith(`━━━━━━━━━━━━━\n${WARN}`) && !INV({ switched: true }).includes(NOTE), 'فاکتورِ تعویض‌شده: فقط خطِ هشدار، در پایین');
ok(fa.wallet.cardSwitchHeader === '👇👇🔄 فاکتور جدید با شماره کارت جدید 💳👇👇', 'سرتیترِ فاکتورِ جدید عینِ متنِ مالک است');
ok(fa.buttons.cardSwitch === '🔄 تعویض شماره کارت', 'برچسبِ دکمه عینِ خواسته‌ی مالک است');
for (const lang of ['en', 'es', 'pt', 'ru']) {
  const src = readFileSync(`bots/tarot/locales/${lang}.js`, 'utf8');
  ok(/cardSwitch:/.test(src) && /cardSwitchHeader:/.test(src) && /cardSwitchNone:/.test(src) && /cardSwitchUsed:/.test(src),
    `${lang}: همه‌ی کلیدهای تعویض هست (شکلِ locale یکی)`);
}

/* ── ۳) رفتاری: همان کدِ index.js روی SQLite ──────────────────────────────── */
console.log('\nرفتاری:');
const readers = region('let _cardSt = null;', '\n// ایجنتِ رسیدِ کارت‌به‌کارت', { includeTo: false });
const helpers = region('const cardCopyRow', '\n// دکمه‌ی سوییچ به استارز', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();");
const handler = region('bot.action(/^card_switch:(\\d+)$/', '\n});');
const OWNER = 111;

function boot({ flag = true, stars = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'receipt', pkg TEXT,
    invoice_msg_id INTEGER, stars_toggle_at INTEGER)`);
  const clock = { day: '2026-09-26' };
  const CAx = { ...CA, cardDay: () => clock.day };
  const errs = [], events = [], sessions = {}, states = {};
  const handlers = [];
  const env = {
    CA: CAx, db, OWNER_ID: OWNER, CARD_ROTATION_ENABLED: true, CARD_SWITCH_ENABLED: flag, starsRail: stars,
    Markup, L: fa, bot: { action: (re, fn) => handlers.push({ re, fn }) },
    log: () => {}, logErr: (...a) => errs.push(a.join(' ')), track: (_d, u, e, p) => events.push({ u, e, p }),
    curOf: () => ({ on: true, name: 'الماس', emoji: '💎' }), invoicePurchaseFor: () => null,
    starsToggleRow: () => [], packOf: () => null,
    patchSession: (u, o) => { sessions[u] = { ...(sessions[u] || {}), ...o }; }, setState: (u, s) => { states[u] = s; },
  };
  env.stmts = {
    getPayment: db.prepare('SELECT * FROM payments WHERE id=?'),
    setInvoiceMsgId: db.prepare('UPDATE payments SET invoice_msg_id=? WHERE id=?'),
  };
  const body = `const LEGACY_CARD = { id: 0, number: '6219861904145405', holder: 'x', bank: '', kind: 'regular', active: 1, admin_id: OWNER_ID };
    ${readers}\n${schema}\n${helpers}\n${handler}
    return { issueInvoiceCard, cardSwitchRow, invoiceExtra, switchTargetFor, cardSt, receiptExpectedCards, attributeReceiptCard };`;
  const f = new Function(...Object.keys(env), body);
  const h = { ...f(...Object.values(env)), db, clock, errs, events, sessions, states, handlers };
  // کارت‌ها: ۱ عادی (سید، ادمینِ مالک)، ۲ سفید (سید)، ۳ عادی با ادمینِ دیگر.
  db.prepare("INSERT INTO cards (number, holder, bank, admin_id, kind, sort) VALUES ('6037997599199013','ب','-',222,'regular',3)").run();
  h.invoice = (uid) => {
    const id = Number(db.prepare('INSERT INTO payments (user_id, amount, invoice_msg_id) VALUES (?, 60000, 500)').run(uid).lastInsertRowid);
    h.issueInvoiceCard(id); return id;
  };
  h.pay = (pid) => db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
  h.tap = async (uid, pid, { deleteFails = false } = {}) => {
    const log = [];
    const ctx = {
      from: { id: uid }, match: [`card_switch:${pid}`, String(pid)], callbackQuery: { message: { message_id: 500 } },
      answerCbQuery: async (t, o) => { log.push(['cb', t || '', !!o?.show_alert]); },
      editMessageReplyMarkup: async () => { log.push(['editkb']); },
      reply: async (text, extra) => { log.push(['reply', text, extra]); return { message_id: 600 + log.length }; },
      telegram: { deleteMessage: async (_c, m) => { if (deleteFails) throw new Error('too old'); log.push(['delete', m]); } },
    };
    const hd = h.handlers.find((x) => x.re.test(`card_switch:${pid}`));
    await hd.fn(ctx);
    return log;
  };
  return h;
}

const kbData = (extra) => (extra?.reply_markup?.inline_keyboard || []).flat().map((b) => b.callback_data || (b.copy_text ? 'copy' : b.text));

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ تعویض شکست خورد:', e.message); }
if (h) {
  const { db } = h;
  ok(db.prepare("SELECT 1 FROM pragma_table_info('payments') WHERE name='card_switched_at'").get(), 'ستونِ افزایشیِ card_switched_at ساخته شد');
  ok(h.handlers.length === 1, 'هندلرِ card_switch: ثبت شد');
  const a = h.invoice(1);
  ok(h.pay(a).card_id === 1, 'فاکتورِ اول روی کارتِ ۱');
  ok(h.cardSwitchRow(a).length === 1 && h.cardSwitchRow(a)[0][0].callback_data === `card_switch:${a}`, 'فاکتورِ باز دکمه‌ی تعویض دارد');
  ok(h.invoiceExtra(a).note === true && h.invoiceExtra(a).switched === false, 'و تذکرِ متنِ فاکتور هم با همان تصمیم روشن است');

  const log = await h.tap(1, a);
  const p = h.pay(a);
  ok(p.card_id === 3 && p.card_switched_at > 0, 'تپ ⟵ فاکتور روی کارتِ ادمینِ بعدی (۳) و مهرِ تعویض خورد');
  ok(p.prev_card_id === 1, 'کارتِ قبلی روی پرداخت ثبت شد (رسیدِ واریز به آن هم معتبر است)');
  ok(db.prepare("SELECT card_id, via FROM card_assign WHERE user_id=1 AND day='2026-09-26'").get()?.card_id === 3,
    'کارتِ امروزِ کاربر هم کارتِ تازه شد');
  ok(db.prepare("SELECT via FROM card_assign WHERE user_id=1").get().via === 'switch', 'با via=switch (قابلِ تفکیک در آمار)');
  const kinds = log.map((x) => x[0]);
  ok(kinds.indexOf('delete') >= 0 && kinds.indexOf('delete') < kinds.indexOf('reply'), 'پیامِ فاکتورِ قبلی **قبل از** فاکتورِ تازه حذف شد');
  ok(log.find((x) => x[0] === 'delete')?.[1] === 500, 'همان پیامِ ثبت‌شده‌ی فاکتور حذف شد');
  const replies = log.filter((x) => x[0] === 'reply');
  ok(replies.length === 2 && replies[0][1] === fa.wallet.cardSwitchHeader, 'اول سرتیترِ «فاکتور جدید»، بعد فاکتور');
  ok(replies[1][1].includes('6037-9975-9919-9013') && replies[1][1].includes(WARN) && !replies[1][1].includes(NOTE),
    'فاکتورِ تازه: شماره‌ی کارتِ ۳ + خطِ هشدار، بدونِ تذکرِ دکمه');
  const keys = kbData(replies[1][2]);
  ok(keys[0] === 'copy' && keys.at(-1) === `pay_cancel:${a}` && !keys.some((k) => /^card_switch:/.test(k)),
    'کیبوردِ فاکتورِ تازه: کپی … انصراف، و **بدونِ** دکمه‌ی تعویضِ دوم');
  ok(h.pay(a).invoice_msg_id > 600, 'شناسه‌ی پیامِ فاکتورِ تازه ثبت شد (انصرافِ بعدی همان را پاک می‌کند)');
  ok(h.sessions[1]?.paymentId === a && h.states[1] === 'pay_receipt', 'سشن و استیت روی همان فاکتور (رسید همان‌جا می‌نشیند)');
  ok(h.events.some((e) => e.e === 'card_switched' && e.p.from === 1 && e.p.to === 3 && e.p.via === 'next_admin'),
    'رویدادِ افزایشیِ card_switched با from/to/via');

  const again = await h.tap(1, a);
  ok(again.length === 1 && again[0][0] === 'cb' && again[0][1] === fa.wallet.cardSwitchUsed && again[0][2],
    'تپِ دوم (دکمه‌ی کهنه) ⟵ فقط پاپ‌آپِ «یک بار عوض شده»، هیچ پیامی');
  ok(h.pay(a).card_id === 3, 'و کارت دوباره عوض نشد');

  const b = h.invoice(1);
  ok(h.pay(b).card_id === 3, 'فاکتورِ بعدیِ همان کاربر همان روز روی کارتِ تازه می‌نشیند');
  ok(h.cardSwitchRow(b).length === 1, 'و خودش دوباره دکمه‌ی تعویض دارد (هر فاکتور یک بار)');

  // رسیدِ کارتِ قبلی (تصمیمِ مالک: معتبر است و به ادمینِ کارتی می‌رود که در رسید دیده می‌شود).
  const exp = h.receiptExpectedCards(h.pay(a));
  ok(exp.dest_last4 === '9013 or 5405' && exp.recipient.includes(' or '), 'ایجنت برای فاکتورِ تعویض‌شده هر دو کارت را می‌پذیرد');
  const plain = h.receiptExpectedCards(h.pay(b));
  ok(plain.dest_last4 === '9013' && !plain.recipient.includes(' or '), 'فاکتورِ تعویض‌نشده: ورودیِ ایجنت بیت‌به‌بیت همان قبلی');
  ok(h.attributeReceiptCard(h.pay(a), { dest_card_last4: '9013' }) === false && h.pay(a).card_id === 3, 'رسید به کارتِ تازه ⟵ دست نمی‌خورد');
  ok(h.attributeReceiptCard(h.pay(a), { dest_card_last4: null }) === false && h.pay(a).card_id === 3, 'چهار رقم خوانده نشد ⟵ دست نمی‌خورد (کارتِ فعلی)');
  ok(h.attributeReceiptCard(h.pay(a), { dest_card_last4: '****۵۴۰۵' }) === true
    && h.pay(a).card_id === 1 && h.pay(a).prev_card_id === 3, 'رسید به کارتِ قبلی (حتی با رقمِ فارسی) ⟵ پرداخت به همان کارت برگشت');
  ok(h.events.some((e) => e.e === 'card_receipt_prev' && e.p.to === 1), 'رویدادِ افزایشیِ card_receipt_prev');
  ok(h.attributeReceiptCard(h.pay(b), { dest_card_last4: '5405' }) === false && h.pay(b).card_id === 3, 'پرداختِ تعویض‌نشده هرگز جابه‌جا نمی‌شود');
  db.prepare('UPDATE payments SET card_id=3, prev_card_id=1 WHERE id=?').run(a);

  // مالکیت و فاکتورِ بسته.
  const other = await h.tap(2, b);
  ok(other.length === 1 && other[0][1] === '' && h.pay(b).card_switched_at == null, 'کاربرِ دیگر نمی‌تواند فاکتورِ کسی را عوض کند');
  db.prepare("UPDATE payments SET status='waiting_review' WHERE id=?").run(b);
  const closed = await h.tap(1, b);
  ok(closed.some((x) => x[0] === 'reply' && x[1] === fa.wallet.invoiceGone({ on: true, name: 'الماس', emoji: '💎' })),
    'فاکتورِ در انتظارِ بررسی ⟵ پیامِ «فاکتور بسته شده»');
  ok(h.pay(b).card_switched_at == null && h.pay(b).card_id === 3, 'و رسیدِ ثبت‌شده هرگز کارتش عوض نمی‌شود');
  ok(h.cardSwitchRow(b).length === 0 && h.invoiceExtra(b).note === false, 'فاکتورِ غیرِباز نه دکمه دارد نه تذکر');

  // حذفِ ناموفق (پیامِ قدیمی) ⟵ دست‌کم دکمه‌ها برداشته می‌شوند.
  const c = h.invoice(3);
  const logC = await h.tap(3, c, { deleteFails: true });
  ok(logC.some((x) => x[0] === 'editkb') && logC.filter((x) => x[0] === 'reply').length === 2,
    'پیامِ قبلی حذف نشد ⟵ دکمه‌هایش برداشته و فاکتورِ تازه همچنان فرستاده شد');
  ok(!h.errs.length, `هیچ خطایی در مسیرِ تعویض نیفتاد${h.errs.length ? ': ' + h.errs[0] : ''}`);
}

// سفید و «هیچ کارتی نیست».
{
  let r; try { r = boot(); } catch (e) { fail++; console.error('  ❌ boot:', e.message); }
  if (r) {
    r.db.prepare('UPDATE cards SET active=0 WHERE id=3').run();
    const p = r.invoice(9);
    await r.tap(9, p);
    ok(r.pay(p).card_id === 2, 'فقط یک کارتِ عادی ⟵ تعویض به کارتِ سفید');
    r.db.prepare('UPDATE cards SET active=0 WHERE id=2').run();
    const q = r.invoice(10);
    ok(r.cardSwitchRow(q).length === 0 && r.invoiceExtra(q).note === false, 'هیچ کارتِ دیگری نیست ⟵ نه دکمه، نه تذکر');
    const tap = await r.tap(10, q);
    ok(tap.length === 1 && tap[0][1] === fa.wallet.cardSwitchNone && tap[0][2] && r.pay(q).card_switched_at == null,
      'دکمه‌ی کهنه وقتی کارتی نیست ⟵ پاپ‌آپِ صادقانه، بدونِ تغییر');
  }
}

// رول‌بک و ربات‌های استارز.
for (const [label, opts] of [['CARD_SWITCH_ENABLED=false', { flag: false }], ['رباتِ استارز', { stars: true }]]) {
  let r; try { r = boot(opts); } catch (e) { fail++; console.error(`  ❌ ${label}:`, e.message); continue; }
  const p = r.invoice(1);
  ok(r.cardSwitchRow(p).length === 0 && r.invoiceExtra(p).note === false && r.invoiceExtra(p).switched === false,
    `${label} ⟵ نه دکمه، نه تذکر (فاکتور بیت‌به‌بیت v3.124.0)`);
  const t = await r.tap(1, p);
  ok(r.pay(p).card_switched_at == null && t.length === 1, `${label} ⟵ دکمه‌ی کش‌شده هیچ کاری نمی‌کند`);
}

/* ── ۴) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
{
  const invoiceCalls = (CODE.match(/L\.wallet\.invoice\(/g) || []).length;
  const withExtra = (CODE.match(/L\.wallet\.invoice\([^;]*?invoiceExtra\(/g) || []).length;
  ok(invoiceCalls >= 7 && withExtra === invoiceCalls, `هر فاکتورِ کارت‌به‌کارت invoiceExtra می‌گیرد (${withExtra}/${invoiceCalls})`);
  const copyRows = (CODE.match(/cardCopyRow\(([^)]+)\),\s*\n?\s*\.\.\.cardSwitchRow\(\1\)/g) || []).length;
  const copyTotal = (CODE.match(/\bcardCopyRow\([^)]+\)/g) || []).length;
  ok(copyRows === copyTotal && copyTotal >= 7, `دکمه‌ی تعویض درست زیرِ دکمه‌ی کپی، در هر فاکتور (${copyRows}/${copyTotal})`);
}
ok(/switchClaim:\s*db\.prepare\("UPDATE payments SET card_id=\?, prev_card_id=\?, card_switched_at=unixepoch\(\) WHERE id=\? AND card_id=\? AND card_switched_at IS NULL AND status='pending'"\)/.test(SRC),
  'ادعای تعویض اتمیک است: یک بار، فقط فاکتورِ باز، فقط از همان کارتی که کاربر دید');
ok(/\^\(card_switch:\\d\+\|/.test(SRC), 'گاردِ مرکزیِ کالبک card_switch را در pay_receipt عبور می‌دهد');
ok((CODE.match(/\bCARD_SWITCH_ENABLED\b/g) || []).length === 2, 'پرچمِ تعویض فقط تعریف + یک گارد (رول‌بکِ یک‌خطی)');
ok(/ALTER TABLE payments ADD COLUMN card_switched_at INTEGER/.test(CODE)
  && /ALTER TABLE payments ADD COLUMN prev_card_id INTEGER NOT NULL DEFAULT 0/.test(CODE), 'مهاجرت‌ها افزایشی‌اند (بند ۲ج/۱)');
ok(/\.\.\.receiptExpectedCards\(p\)/.test(CODE) && /if \(attributeReceiptCard\(p, verdict\.extracted\)\) p = stmts\.getPayment\.get\(paymentId\);/.test(CODE),
  'ایجنتِ رسید هر دو کارت را می‌بیند و بعد از خواندن، پرداخت به کارتِ واقعیِ رسید نسبت داده می‌شود');
ok(/CA\.pickSwitchCard\(/.test(CODE) && !/function pickSwitchCard/.test(CODE), 'انتخاب فقط از تک‌منبعِ خالص (cards-admin.js)');

console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
