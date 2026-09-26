// چکِ CI برای «🏷 تگِ دستیِ اپ/بانک روی رسیدها» (tarot، v3.128.0 — فازِ ۶ِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// تصمیم‌های مالک که این فایل قفل می‌کند:
//   • دکمه‌های تگ **فقط** روی پیامِ رسیدِ مالک؛ ادمین‌های دیگر هیچ دکمه‌ی تگی نمی‌بینند و تپشان
//     (حتی با callbackِ دست‌ساز) هیچ چیزی نمی‌نویسد («تگ زدن فقط کار خودمه»).
//   • مالکی که ادمینِ کارت هم هست **یک** پیام می‌گیرد: دکمه‌های اکشن + ردیفِ تگ.
//   • تگ یک‌به‌چند per کاربر؛ سابقه فقط از رسیدهای **ردنشده**؛ تگِ دستی همیشه بر خودکار مقدم.
//   • «سایر» مقدار نیست؛ مقدارها از داشبورد اضافه/فعال/غیرفعال می‌شوند و هرگز حذف نمی‌شوند.
//   • بلو (بانک) جدا از سامان.
// خرابی‌های بی‌صدا که این‌جا گرفته می‌شوند: ردیفِ تگ بعد از «تأیید» از پیامِ مالک محو شود؛ گاردِ
// فلوی بازِ خودِ مالک تپِ تگ را ببلعد؛ داشبورد مستقیم بنویسد یا شکلی صف کند که ربات رد کند؛ سیدِ
// هر بوت مقدارِ غیرفعال‌شده را زنده کند.
//
// کدِ واقعیِ index.js بریده و روی SQLite اجرا می‌شود؛ داشبورد روی **همان** فایلِ دیتابیس رندر و
// صف می‌کند و بعد sweepِ واقعیِ ربات همان ردیفِ صف را اجرا می‌کند (سرتاسری).
import * as RT from '../bots/tarot/receipt-tags.js';
import { BANK_APPS } from '../bots/tarot/cardpay.js';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

/* ⚙️ دو جاب، یک فایل: بخشِ ربات در جابِ `tarot` اجرا می‌شود (تغییرِ `bots/tarot/` فقط همان جاب را
 * می‌زند، `tools/ci-changed-bots.mjs`) و بخشِ داشبورد در جابِ `dashboard` (فقط آن‌جا
 * `bots/dashboard/node_modules` نصب است). بدونِ آرگومان هر دو اجرا می‌شوند (`ci-local`). */
const PART = (process.argv.find((a) => a.startsWith('--part=')) || '--part=all').slice(7);
if (!['all', 'bot', 'dash'].includes(PART)) { console.error(`❌ --part نامعتبر: ${PART}`); process.exit(1); }
const Database = createRequire(path.resolve(`bots/${PART === 'dash' ? 'dashboard' : 'tarot'}/package.json`))('better-sqlite3');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}
const OWNER = 111, ADMIN2 = 222, USER = 9;

console.log('\n🏷 تگِ رسید (فازِ ۶)\n');

/* ── ۱) ماژولِ خالص ─────────────────────────────────────────────────────────── */
console.log('ماژولِ خالص:');
{
  const appKeys = RT.SEED_TAG_VALUES.app.map(([k]) => k);
  ok(JSON.stringify(appKeys) === JSON.stringify(BANK_APPS.filter((k) => k !== 'other')),
    'کلیدهای اپ = enumِ ایجنت منهای other (تگِ خودکارِ فازِ ۷ بی‌نگاشت می‌نشیند؛ «سایر» مقدار نیست)');
  const bankKeys = RT.SEED_TAG_VALUES.bank.map(([k]) => k);
  ok(bankKeys.includes('blu') && bankKeys.includes('saman'), 'بلو و سامان دو بانکِ جدا');
  ok(!appKeys.includes('other') && !bankKeys.includes('other'), 'هیچ مقدارِ «سایر»ی نیست');
  const all = [...appKeys, ...bankKeys];
  ok(all.every((k) => RT.TAG_KEY_RE.test(k)) && new Set(bankKeys).size === bankKeys.length, 'همه‌ی کلیدهای سید معتبر و یکتا');
  ok([...RT.SEED_TAG_VALUES.app, ...RT.SEED_TAG_VALUES.bank].every(([, l]) => RT.cleanTagLabel(l) === l), 'همه‌ی برچسب‌های سید تمیز');

  ok(RT.cleanTagLabel('<b>x</b>') === null && RT.cleanTagLabel('') === null && RT.cleanTagLabel('a'.repeat(25)) === null,
    'برچسب: HTML، خالی و بیش از ۲۴ نویسه رد');
  ok(RT.cleanTagLabel('  رسالت \n ') === 'رسالت', 'برچسب: فاصله و خطِ تازه تمیز می‌شود');

  const rows = [
    { payment_id: 1, dim: 'bank', value_key: 'melli', source: 'admin' },
    { payment_id: 1, dim: 'bank', value_key: 'saman', source: 'auto' },
    { payment_id: 2, dim: 'bank', value_key: 'saman', source: 'auto' },
    { payment_id: 2, dim: 'app', value_key: 'ap', source: 'admin' },
    { payment_id: 3, dim: 'bank', value_key: 'melli', source: 'admin' },
  ];
  const eff = RT.effectiveTags(rows);
  ok(eff[1].bank.key === 'melli' && RT.effectiveTags([...rows].reverse())[1].bank.key === 'melli',
    'ادمین بر خودکار مقدم است، مستقل از ترتیبِ ردیف‌ها');
  const hist = RT.tagHistory(rows);
  ok(JSON.stringify(hist.bank) === JSON.stringify([['melli', 2], ['saman', 1]]) && JSON.stringify(hist.app) === JSON.stringify([['ap', 1]]),
    'سابقه: شمارشِ تگِ مؤثر per رسید، نزولی (خودکارِ مغلوب شمرده نمی‌شود)');
  const line = RT.historyLine(hist, (d, k) => ({ melli: 'ملی', saman: 'سامان', ap: 'آپ' })[k] || k);
  ok(line === '🏷 سابقه‌ی کاربر: اپ: آپ ×۱ · بانک: ملی ×۲، سامان ×۱', `خطِ سابقه: «${line}»`);
  ok(RT.historyLine(RT.tagHistory([]), null) === '', 'بدونِ تگ ⟵ رشته‌ی خالی (خطی اضافه نمی‌شود)');

  const values = [...RT.SEED_TAG_VALUES.bank.map(([key, label]) => ({ dim: 'bank', key, label, active: 1 })),
    { dim: 'bank', key: 'zzz', label: 'غیرفعال', active: 0 }];
  const picker = RT.tagPickerRows(4242424242, 'bank', values, 'saman');
  const cbs = picker.flat().map((b) => b.callback_data);
  ok(cbs.every((c) => Buffer.byteLength(c) <= 64 && RT.TAG_CB.test(c)), 'همه‌ی callbackهای فهرست ≤۶۴ بایت و با الگوی TAG_CB جور');
  ok(picker.flat().some((b) => b.text === '✅ سامان') && !cbs.includes('tg:s:4242424242:bank:zzz'), 'مقدارِ فعلی ✅ دارد؛ غیرفعال در فهرست نیست');
  ok(JSON.stringify(picker.at(-1).map((b) => b.callback_data)) === JSON.stringify(['tg:c:4242424242:bank', 'tg:x:4242424242']),
    'ردیفِ آخر: پاک کردن + بستن');
  ok(picker.slice(0, -1).every((r) => r.length <= 3), 'حداکثر سه دکمه در هر ردیف (روی موبایل جا می‌شود)');
  const col = RT.tagCollapsedRows(7, { bank: { key: 'saman', source: 'admin' } }, (d, k) => (k === 'saman' ? 'سامان' : k));
  ok(col.length === 1 && col[0][0].text === '📱 اپ: —' && col[0][1].text === '🏦 بانک: سامان', 'ردیفِ جمع‌شده: «📱 اپ: —» و «🏦 بانک: سامان»');

  const actionRows = [[{ text: 'تأیید', callback_data: 'approve:7' }]];
  const withTags = RT.withTagRows({ inline_keyboard: actionRows }, col);
  ok(RT.hasTagRows(withTags) && RT.stripTagRows(withTags).length === 1, 'withTagRows/stripTagRows فقط ردیف‌های tg: را جابه‌جا می‌کنند');
  ok(JSON.stringify(RT.preserveTagRows(withTags, undefined)) === JSON.stringify({ inline_keyboard: col }),
    'حذفِ کاملِ کیبورد (undefined) ⟵ ردیفِ تگ می‌ماند');
  const credited = { inline_keyboard: [[{ text: 'نیومده', callback_data: 'cardsms:7' }]] };
  ok(JSON.stringify(RT.preserveTagRows(withTags, credited).inline_keyboard) === JSON.stringify([...credited.inline_keyboard, ...col]),
    'کیبوردِ تازه‌ی اکشن ⟵ ردیفِ تگ زیرش می‌ماند');
  ok(RT.preserveTagRows({ inline_keyboard: actionRows }, undefined) === undefined, 'پیامِ بی‌تگ دست‌نخورده (رفتارِ قبلی)');

  const pay = { id: 5, user_id: USER };
  const v = [{ dim: 'bank', key: 'saman', label: 'سامان', active: 1 }, { dim: 'bank', key: 'off', label: 'خاموش', active: 0 }];
  const P = (op, ctx = { values: v, payment: pay }) => RT.planTagOp(op, ctx);
  ok(P({ op: 'set', dim: 'bank', key: 'saman' }).apply?.t === 'set' && P({ op: 'set', dim: 'bank', key: 'saman' }).apply.uid === USER,
    'set معتبر ⟵ apply با uidِ خودِ پرداخت');
  ok(!P({ op: 'set', dim: 'bank', key: 'off' }).ok, 'set روی مقدارِ غیرفعال رد');
  ok(!P({ op: 'set', dim: 'bank', key: 'nope' }).ok && !P({ op: 'set', dim: 'bank', key: "x';--" }).ok, 'set روی مقدارِ ناشناخته/خصمانه رد');
  ok(!P({ op: 'set', dim: 'bank', key: 'saman' }, { values: v, payment: null }).ok, 'set بدونِ پرداخت رد');
  ok(!P({ op: 'set', dim: 'color', key: 'saman' }).ok && !P(null).ok && !P({ op: 'drop', dim: 'bank' }).ok, 'بُعد/دستورِ ناشناخته رد');
  ok(P({ op: 'clear', dim: 'app' }).apply?.t === 'clear', 'clear');
  ok(P({ op: 'value_add', dim: 'bank', key: 'saman', label: 'سامان' }).noop === true, 'افزودنِ مقدارِ عیناً موجود ⟵ noop');
  ok(P({ op: 'value_add', dim: 'bank', key: 'off', label: 'خاموش' }).apply?.t === 'value_add', 'افزودنِ کلیدِ غیرفعالِ موجود ⟵ دوباره فعال می‌شود');
  ok(!P({ op: 'value_add', dim: 'bank', key: 'Bad Key', label: 'x' }).ok && !P({ op: 'value_add', dim: 'bank', key: 'ok', label: '<i>' }).ok,
    'افزودن: کلیدِ نامعتبر و برچسبِ HTML رد');
  ok(P({ op: 'value_active', dim: 'bank', key: 'saman', active: true }).noop === true
    && P({ op: 'value_active', dim: 'bank', key: 'saman', active: false }).apply?.active === 0, 'فعال/غیرفعال: noop و تغییر');
}

/* ── ۲) رفتاری: کدِ index.js روی SQLite ─────────────────────────────────────── */
console.log('\nربات (رفتاری):');
const schema = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ اپ/بانکِ مبدأ per رسید.', "} catch (e) { logErr('tag_values seed:', e.message); }");
const helpers = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ دستیِ اپ/بانک، فقط روی پیام‌های رسیدِ **مالک**.', '\nfunction canActOnPayment', { includeTo: false });
const mw = region('/* 🏷 فازِ ۶: دکمه‌های تگِ رسید (`tg:`)', '\nconst CHAT_EARN_CB', { includeTo: false });

const BASE_SQL = `
  CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER,
    status TEXT NOT NULL DEFAULT 'waiting_review', receipt_file_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL, action TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'dashboard', created_at INTEGER NOT NULL DEFAULT (unixepoch()), done_at INTEGER,
    user_id INTEGER, amount INTEGER, ref_id INTEGER, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS users (telegram_id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));`;

function boot({ file = ':memory:', flag = true, stars = false, recipients = null } = {}) {
  const db = new Database(file);
  db.exec(BASE_SQL);
  const errs = [], logs = [], sent = [], uses = [];
  const env = {
    db, RT, OWNER_ID: OWNER, RECEIPT_TAGS_ENABLED: flag, starsRail: stars,
    log: (...a) => logs.push(a.join(' ')), logErr: (...a) => errs.push(a.join(' ')),
    receiptRecipients: () => recipients || [{ id: OWNER, full: false }, { id: ADMIN2, full: true }],
    ownerCopyHeader: () => 'COPY\n', ownerShadowLine: () => '',
    withShadowLine: (base, sline) => (sline ? `${base}\n\n${sline}` : base),
    bot: {
      use: (fn) => uses.push(fn),
      telegram: {
        sendMessage: async (to, text, extra) => { sent.push({ to, text, extra }); return { message_id: 700 + sent.length }; },
        sendPhoto: async (to, _f, extra) => { sent.push({ to, text: extra?.caption, extra }); return { message_id: 700 + sent.length }; },
      },
    },
  };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `${schema}\n${helpers}\n${mw}
    return { tagSt, tagValues, curTagsOf, tagHistoryLineFor, ownerReceiptMarkup, applyTagPlan, handleTagCallback, applyQueuedTagOp, sendToReceiptRecipients };`;
  const f = new Function(...Object.keys(env), body);
  const h = { ...f(...Object.values(env)), db, errs, logs, sent, mw: uses[0] };
  h.reboot = () => new Function(...Object.keys(env), `${schema}`)(...Object.values(env));
  h.payment = (uid = USER, status = 'waiting_review') =>
    Number(db.prepare("INSERT INTO payments (user_id, amount, status, receipt_file_id) VALUES (?, 60000, ?, 'F')").run(uid, status).lastInsertRowid);
  // تپِ یک دکمه از روی پیامی که کیبوردش `kb` است، از میانِ middlewareِ واقعی.
  h.tap = async (data, from, kb) => {
    const log = [];
    let nextCalled = false;
    const ctx = {
      from: { id: from }, callbackQuery: { data, message: { reply_markup: kb } },
      answerCbQuery: async (t, o) => { log.push(['cb', t || '', !!o?.show_alert]); },
      editMessageReplyMarkup: async (m) => { log.push(['editkb', m]); },
    };
    await h.mw(ctx, async () => { nextCalled = true; });
    return { log, nextCalled, ctx };
  };
  return h;
}
const cbOf = (kb) => (kb?.inline_keyboard || []).flat().map((b) => b.callback_data);
const tagsOfPay = (h, pid) => h.db.prepare('SELECT dim, value_key, source, by_id FROM receipt_tags WHERE payment_id=? ORDER BY dim, source').all(pid);

let h;
if (PART !== 'dash') try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ فازِ ۶ شکست خورد:', e.stack); }
if (h) {
  const { db } = h;
  const cnt = (dim) => db.prepare('SELECT COUNT(*) n FROM tag_values WHERE dim=?').get(dim).n;
  ok(cnt('app') === RT.SEED_TAG_VALUES.app.length && cnt('bank') === RT.SEED_TAG_VALUES.bank.length, 'بوت: جدول‌ها ساخته و سید نشست');
  db.prepare("UPDATE tag_values SET active=0 WHERE dim='bank' AND key='noor'").run();
  db.prepare("UPDATE tag_values SET label='بلوبانک' WHERE dim='bank' AND key='blu'").run();
  h.reboot();
  ok(cnt('bank') === RT.SEED_TAG_VALUES.bank.length
    && db.prepare("SELECT active FROM tag_values WHERE dim='bank' AND key='noor'").get().active === 0
    && db.prepare("SELECT label FROM tag_values WHERE dim='bank' AND key='blu'").get().label === 'بلوبانک',
    'بوتِ دوباره: سید تکرار نمی‌شود، مقدارِ غیرفعال زنده نمی‌شود و برچسبِ عوض‌شده برنمی‌گردد');

  // ارسالِ رسید: مالک کپی می‌گیرد، ادمینِ ۲۲۲ پیامِ کامل.
  const pid = h.payment();
  const kb = { inline_keyboard: [[{ text: 'تأیید', callback_data: `approve:${pid}` }]] };
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
  const first = await h.sendToReceiptRecipients(p, { caption: 'CAP', photoFileId: 'F', kb });
  const toOwner = h.sent.find((s) => s.to === OWNER), toAdmin = h.sent.find((s) => s.to === ADMIN2);
  ok(first && toOwner && toAdmin, 'هر دو گیرنده پیام گرفتند و پیامِ کامل برگشت');
  ok(JSON.stringify(cbOf(toOwner.extra.reply_markup)) === JSON.stringify([`tg:o:${pid}:app`, `tg:o:${pid}:bank`]),
    'کپیِ اطلاعاتیِ مالک: فقط ردیفِ تگ (بدونِ دکمه‌های اکشنِ ادمینِ کارت)');
  ok(JSON.stringify(cbOf(toAdmin.extra.reply_markup)) === JSON.stringify([`approve:${pid}`]) && toAdmin.text === 'CAP',
    'ادمینِ دیگر: کیبورد و کپشن بیت‌به‌بیت همان قبلی، هیچ دکمه‌ی تگی');

  // مالک = ادمینِ کارت ⟵ یک پیام با هر دو.
  const h2 = boot({ recipients: [{ id: OWNER, full: true }] });
  const pid2 = h2.payment();
  await h2.sendToReceiptRecipients(h2.db.prepare('SELECT * FROM payments WHERE id=?').get(pid2), { caption: 'CAP', photoFileId: 'F', kb: { inline_keyboard: [[{ text: 'تأیید', callback_data: `approve:${pid2}` }]] } });
  ok(h2.sent.length === 1 && JSON.stringify(cbOf(h2.sent[0].extra.reply_markup)) === JSON.stringify([`approve:${pid2}`, `tg:o:${pid2}:app`, `tg:o:${pid2}:bank`]),
    'مالکی که ادمینِ کارت است: یک پیام، دکمه‌های اکشن + ردیفِ تگ');

  // تپ‌ها از میانِ middlewareِ واقعی.
  const ownerKb = toOwner.extra.reply_markup;
  let r = await h.tap(`tg:o:${pid}:bank`, OWNER, ownerKb);
  const opened = r.log.find((x) => x[0] === 'editkb')?.[1];
  ok(!r.nextCalled && cbOf(opened).includes(`tg:s:${pid}:bank:saman`) && !cbOf(opened).includes(`tg:s:${pid}:bank:noor`),
    'مالک «🏦 بانک» را می‌زند ⟵ فهرستِ بانک‌های فعال باز می‌شود، و گاردهای بعدی اصلاً اجرا نمی‌شوند');
  r = await h.tap(`tg:s:${pid}:bank:saman`, OWNER, opened);
  ok(JSON.stringify(tagsOfPay(h, pid)) === JSON.stringify([{ dim: 'bank', value_key: 'saman', source: 'admin', by_id: OWNER }]),
    'انتخابِ «سامان» ⟵ ردیفِ تگِ دستی با by_idِ مالک');
  const collapsed = r.log.find((x) => x[0] === 'editkb')?.[1];
  ok(collapsed?.inline_keyboard?.length === 1 && collapsed.inline_keyboard[0][1].text === '🏦 بانک: سامان' && r.log.some((x) => x[0] === 'cb' && /سامان/.test(x[1])),
    'بعد از انتخاب: ردیف جمع می‌شود، «🏦 بانک: سامان» و پیامِ کوتاهِ تأیید');

  // مالک = ادمینِ کارت: تپِ تگ دکمه‌های اکشن را دست نمی‌زند.
  const fullKb = h2.sent[0].extra.reply_markup;
  const r2 = await h2.tap(`tg:o:${pid2}:app`, OWNER, fullKb);
  const opened2 = r2.log.find((x) => x[0] === 'editkb')?.[1];
  ok(cbOf(opened2)[0] === `approve:${pid2}` && cbOf(opened2).includes(`tg:s:${pid2}:app:blu`), 'بازکردنِ فهرست روی پیامِ کامل: دکمه‌ی تأیید سرِ جایش می‌ماند');

  // غیرمالک و ورودیِ خصمانه.
  r = await h.tap(`tg:s:${pid}:bank:melli`, ADMIN2, ownerKb);
  ok(!r.nextCalled && r.log.some((x) => x[0] === 'cb' && x[1] === '🔒') && tagsOfPay(h, pid)[0].value_key === 'saman',
    'ادمینِ دیگر با callbackِ دست‌ساز ⟵ 🔒 و هیچ نوشتنی');
  r = await h.tap(`tg:s:${pid}:bank:noor`, OWNER, ownerKb);
  ok(r.log.some((x) => x[0] === 'cb' && x[2]) && tagsOfPay(h, pid)[0].value_key === 'saman', 'مقدارِ غیرفعال (دکمه‌ی کهنه) ⟵ هشدار، بدونِ نوشتن');
  r = await h.tap('tg:s:999999:bank:saman', OWNER, ownerKb);
  ok(r.log.some((x) => x[0] === 'cb' && x[2]) && !tagsOfPay(h, 999999).length, 'پرداختِ ناموجود ⟵ هشدار، بدونِ نوشتن');
  r = await h.tap(`tg:z:${pid}`, OWNER, ownerKb);
  ok(!r.nextCalled && r.log.some((x) => x[1] === '🔒'), 'callbackِ tg: بدشکل ⟵ 🔒 (به هیچ هندلرِ دیگری نمی‌رسد)');

  // حفظِ ردیفِ تگ روی اکشن‌های دیگرِ همان پیام.
  r = await h2.tap(`approve:${pid2}`, OWNER, fullKb);
  ok(r.nextCalled, 'دکمه‌ی غیرتگ ⟵ به زنجیره‌ی عادی می‌رود');
  await r.ctx.editMessageReplyMarkup(undefined);
  ok(JSON.stringify(cbOf(r.log.at(-1)[1])) === JSON.stringify([`tg:o:${pid2}:app`, `tg:o:${pid2}:bank`]),
    'هندلرِ اکشن کیبورد را کامل پاک می‌کند ⟵ ردیفِ تگ روی پیامِ مالک می‌ماند');
  r = await h2.tap(`approve:${pid2}`, ADMIN2, { inline_keyboard: [[{ text: 'تأیید', callback_data: `approve:${pid2}` }]] });
  await r.ctx.editMessageReplyMarkup(undefined);
  ok(r.nextCalled && r.log.at(-1)[1] === undefined, 'ادمینِ دیگر: هیچ پیچشی، رفتارِ قبلی');

  // خاموشی.
  const hOff = boot({ flag: false });
  const pOff = hOff.payment();
  await hOff.sendToReceiptRecipients(hOff.db.prepare('SELECT * FROM payments WHERE id=?').get(pOff), { caption: 'CAP', photoFileId: 'F', kb });
  r = await hOff.tap(`tg:s:${pOff}:bank:saman`, OWNER, ownerKb);
  ok(!hOff.sent.find((s) => s.to === OWNER).extra.reply_markup && !tagsOfPay(hOff, pOff).length,
    'رول‌بک (RECEIPT_TAGS_ENABLED=false): نه دکمه‌ی تگ، نه نوشتن (دکمه‌ی کهنه هم)');

  // سابقه: فقط ردنشده‌ها، و خطِ سابقه فقط روی پیامِ مالک.
  const pRej = h.payment(USER, 'rejected'), pCan = h.payment(USER, 'canceled'), pOther = h.payment(77);
  for (const [x, k] of [[pRej, 'melli'], [pCan, 'saman'], [pOther, 'melli']]) await h.tap(`tg:s:${x}:bank:${k}`, OWNER, ownerKb);
  db.prepare("INSERT INTO receipt_tags (payment_id, user_id, dim, value_key, source) VALUES (?, ?, 'bank', 'melli', 'auto')").run(pid, USER);
  ok(h.tagHistoryLineFor(USER) === '🏷 سابقه‌ی کاربر: بانک: سامان ×۲',
    `سابقه: ردشده بیرون، کاربرِ دیگر بیرون، خودکارِ مغلوب بیرون («${h.tagHistoryLineFor(USER)}»)`);
  h.sent.length = 0;
  const pNew = h.payment();
  await h.sendToReceiptRecipients(db.prepare('SELECT * FROM payments WHERE id=?').get(pNew), { caption: 'CAP', photoFileId: 'F', kb });
  ok(/سابقه‌ی کاربر: بانک: سامان ×۲/.test(h.sent.find((s) => s.to === OWNER).text) && h.sent.find((s) => s.to === ADMIN2).text === 'CAP',
    'رسیدِ بعدیِ همان کاربر: خطِ سابقه فقط در کپشنِ مالک');
  r = await h.tap(`tg:c:${pid}:bank`, OWNER, ownerKb);
  ok(JSON.stringify(tagsOfPay(h, pid).map((t) => t.source)) === '["auto"]' && h.curTagsOf(pid).bank.key === 'melli',
    'پاک‌کردن فقط تگِ دستی را برمی‌دارد؛ تگِ خودکار دوباره مؤثر می‌شود');
  ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='events'").get() && !h.errs.length, 'هیچ رویدادِ analytics زیرِ کاربر ساخته نشد، هیچ خطایی');

  // صفِ داشبورد (شکل‌های دست‌ساز).
  const q = (note, ref = null) => ({ id: 1, ref_id: ref, note: JSON.stringify(note) });
  h.sent.length = 0;
  await h.applyQueuedTagOp(q({ op: 'value_add', dim: 'bank', key: 'resalat2', label: 'رسالت ۲' }));
  const nv = db.prepare("SELECT * FROM tag_values WHERE dim='bank' AND key='resalat2'").get();
  ok(nv?.active === 1 && nv.sort === db.prepare("SELECT MAX(sort) m FROM tag_values WHERE dim='bank'").get().m && !h.sent.length,
    'صف: افزودنِ مقدار ⟵ ته فهرست، بدونِ پیامِ موفقیت');
  await h.applyQueuedTagOp(q({ op: 'value_active', dim: 'bank', key: 'resalat2', active: false }));
  await h.applyQueuedTagOp(q({ op: 'set', dim: 'bank', key: 'resalat2' }, pNew));
  ok(!tagsOfPay(h, pNew).length && h.sent.some((s) => s.to === OWNER && /غیرفعال/.test(s.text)) && h.errs.some((e) => /TAG_OP_REJECTED/.test(e)),
    'صف: set روی مقدارِ غیرفعال ⟵ رد با پیامِ صریح به مالک و مارکرِ لاگ');
  await h.applyQueuedTagOp(q({ op: 'value_add', dim: 'bank', key: 'resalat2', label: 'رسالت' }));
  await h.applyQueuedTagOp(q({ op: 'set', dim: 'bank', key: 'resalat2' }, pNew));
  ok(tagsOfPay(h, pNew)[0]?.value_key === 'resalat2' && tagsOfPay(h, pNew)[0].by_id === 0
    && db.prepare("SELECT label, active FROM tag_values WHERE key='resalat2'").get().label === 'رسالت',
    'صف: افزودنِ دوباره‌ی کلید برچسب را عوض و فعالش می‌کند؛ set با by_id=0 (داشبورد)');
  await h.applyQueuedTagOp({ id: 9, ref_id: null, note: '{bad' });
  ok(h.errs.some((e) => /TAG_OP_REJECTED id=9/.test(e)), 'صف: JSONِ خراب ⟵ رد با مارکر، بدونِ کرش');
  const hs = boot({ stars: true });
  await hs.applyQueuedTagOp(q({ op: 'value_add', dim: 'bank', key: 'x', label: 'x' }));
  ok(hs.errs.some((e) => /TAG_OP_REFUSED/.test(e)) && !hs.db.prepare("SELECT 1 FROM tag_values WHERE key='x'").get(),
    'ریلِ استارز: sweep صریح امتناع می‌کند');
}

/* ── ۳) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
if (PART !== 'dash') {
  const at = (s) => SRC.indexOf(s);
  const mwAt = at('/* 🏷 فازِ ۶: دکمه‌های تگِ رسید (`tg:`)');
  ok(mwAt > 0 && mwAt < at('const CHAT_EARN_CB') && mwAt < at('/* 🔒 دروازه‌ی واحدِ همه‌ی دکمه‌ها'),
    'middlewareِ تگ قبل از گاردِ گفتگو و دروازه‌ی مرکزی ثبت شده');
  ok(/act\.action === 'receipt_tag'\)\s*\{[^}]*await applyQueuedTagOp\(act\)/.test(SRC), 'sweep: شاخه‌ی receipt_tag ⟵ applyQueuedTagOp');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok((code.match(/RECEIPT_TAGS_ENABLED/g) || []).length === 2, 'پرچمِ خام فقط در تعریف و `tagsOn` (بقیه از helper)');
  ok(/\['receipt_tags','user_id'\]/.test(SRC), 'ریستِ حساب (wipeUser) تگ‌های کاربر را هم پاک می‌کند');
  const apply = region('function applyTagPlan', '\n}');
  ok(apply && !/track\(/.test(apply), 'applyTagPlan رویدادِ analytics نمی‌سازد (فعالیتِ جعلی زیرِ کاربر)');
  ok(/const mk = r\.id === OWNER_ID \? ownerReceiptMarkup\(/.test(SRC), 'ردیفِ تگ فقط برای گیرنده‌ی OWNER_ID');
}

/* ── ۴) داشبورد روی همان فایل، سرتاسری ─────────────────────────────────────── */
console.log('\nداشبورد:');
if (PART !== 'bot') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'receipt-tags-'));
  const dataDir = path.join(root, 'tarot-data');
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'bot-fa.db');
  const hb = boot({ file });
  const p1 = hb.payment(), p2 = hb.payment(), pForeign = hb.payment(77);
  hb.db.prepare('INSERT INTO users (telegram_id, name) VALUES (?, ?)').run(USER, 'سارا');
  await hb.tap(`tg:s:${p1}:app:ap`, OWNER, null);
  hb.db.close();
  { const ru = boot({ file: path.join(dataDir, 'bot-ru.db') }); ru.payment(); ru.db.close(); }

  process.env.TAROT_DB_DIR = dataDir;
  const cwd = process.cwd();
  process.chdir(root);
  const base = path.resolve(cwd, 'bots/dashboard');
  try {
    const { tagsCard, tagAction } = await import(`file://${base}/routes/tags.js`);
    const { receiptTagsSupported, adminActionSupported, instancesOf } = await import(`file://${base}/lib/bots.js`);
    ok(receiptTagsSupported('tarot') && !receiptTagsSupported('voice2text'), 'تاروتِ فارسی کارتِ تگ دارد، voice2text نه');
    ok(!receiptTagsSupported('tarot-intl') && adminActionSupported('tarot-intl', 'receipt_tag'),
      'tarot-intl: اکشن اعلام شده (sweep همان کد است) ولی کارت ندارد (رسیدِ کارت‌به‌کارت ندارد)');
    const inst = instancesOf('tarot')[0];
    const html = tagsCard(inst, USER);
    ok(/🏷 تگ‌های رسید/.test(html) && /سابقه‌ی کاربر: اپ: آپ ×۱/.test(html), 'کارتِ پروفایل: سابقه‌ی کاربر');
    ok(new RegExp(`name="pid" value="${p2}"`).test(html) && /<option value="ap" selected>آپ<\/option>/.test(html),
      'کارتِ پروفایل: هر رسید با فهرستِ انتخاب و مقدارِ فعلیِ انتخاب‌شده');
    ok(/value="value_add"/.test(html) && /name="op" value="value_active"/.test(html), 'کارتِ پروفایل: افزودن و فعال/غیرفعالِ مقدارها');
    ok(tagsCard({ ...inst, bot: 'voice2text' }, USER) === '', 'رباتِ بی‌قابلیت: کارتی رندر نمی‌شود');

    const form = (o) => new URLSearchParams({ inst: inst.id, uid: String(USER), ...o });
    const rowsQ = () => { const d = new Database(file); const r = d.prepare("SELECT * FROM admin_actions WHERE action='receipt_tag' ORDER BY id").all(); d.close(); return r; };
    const msg = tagAction(form({ pid: String(p2), dim: 'bank', key: 'saman' }));
    const q1 = rowsQ().at(-1);
    ok(/در صفِ ربات/.test(msg) && q1.payment_id === 0 && q1.ref_id === p2 && q1.user_id === USER
      && JSON.stringify(JSON.parse(q1.note)) === JSON.stringify({ op: 'set', dim: 'bank', key: 'saman' }),
    'set از داشبورد ⟵ ردیفِ صف با payment_id=0 (قفلِ اقدام‌های پولی را نمی‌گیرد) و شکلِ تمیز');
    let threw = '';
    try { tagAction(form({ pid: String(p2), dim: 'app', key: 'blu' })); } catch (e) { threw = e.message; }
    ok(/در صف است/.test(threw), 'ضدِ دوبار: رسیدِ دارای تغییرِ در صف ⟵ خطا');
    for (const [o, re, why] of [
      [{ pid: String(pForeign), dim: 'bank', key: 'saman' }, /مالِ این کاربر نیست/, 'رسیدِ کاربرِ دیگر'],
      [{ pid: String(p1), dim: 'bank', key: 'nope' }, /تعریف نشده/, 'مقدارِ ناشناخته'],
      [{ op: 'value_add', dim: 'bank', key: 'bad-key', label: 'x' }, /کلید/, 'کلیدِ نامعتبر'],
    ]) {
      const before = rowsQ().length;
      let e = '';
      try { tagAction(form(o)); } catch (x) { e = x.message; }
      ok(re.test(e) && rowsQ().length === before, `رد بدونِ صف: ${why}`);
    }
    ok(/تغییری لازم نبود/.test(tagAction(form({ op: 'value_add', dim: 'bank', key: 'saman', label: 'سامان' }))), 'noop ⟵ چیزی صف نمی‌شود');
    const ru = instancesOf('tarot-intl')[0];
    let e2 = '';
    try { tagAction(new URLSearchParams({ inst: ru?.id || '', uid: String(USER), pid: '1', dim: 'bank', key: 'saman' })); } catch (x) { e2 = x.message; }
    const ruDb = new Database(path.join(dataDir, 'bot-ru.db'));
    const ruRows = ruDb.prepare('SELECT COUNT(*) n FROM admin_actions').get().n;
    ruDb.close();
    ok(ru && /اجرا نمی‌کند/.test(e2) && ruRows === 0, 'tarot-intl (ریلِ استارز) ⟵ خطای صریح قبل از هر نوشتن');
    tagAction(form({ pid: String(p1), dim: 'app', key: '' }));   // پاک‌کردن
    tagAction(form({ op: 'value_add', dim: 'app', key: 'sepino', label: 'سپینو' }));

    // sweepِ واقعیِ ربات همان ردیف‌ها را اجرا می‌کند.
    const hr = boot({ file });
    for (const act of hr.db.prepare("SELECT * FROM admin_actions WHERE action='receipt_tag' AND done_at IS NULL ORDER BY id").all()) {
      await hr.applyQueuedTagOp(act);
      hr.db.prepare('UPDATE admin_actions SET done_at=unixepoch() WHERE id=?').run(act.id);
    }
    ok(hr.curTagsOf(p2).bank?.key === 'saman' && !hr.curTagsOf(p1).app
      && hr.db.prepare("SELECT label FROM tag_values WHERE dim='app' AND key='sepino'").get()?.label === 'سپینو' && !hr.errs.length,
    'سرتاسری: صفِ داشبورد ⟵ sweepِ ربات ⟵ set، clear و افزودنِ مقدار بی‌خطا نشستند');
    hr.db.close();
  } catch (e) { fail++; console.error('  ❌ داشبورد:', e.stack); }
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
