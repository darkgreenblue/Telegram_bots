// چکِ CI برای «🔎 ثبتِ کاملِ خروجیِ ایجنتِ رسید + فیلدهای فقط-ثبت» (tarot، v3.126.0 — فازِ ۴ِ
// bots/tarot/PAYMENT-V2-PLAN.md).
//
// قراردادی که این فایل قفل می‌کند:
//   • فیلدهای تازه (پیشوندِ کارتِ مبدأ، اپِ بانکی، خطای انتقال) **هرگز** روی تصمیمِ پول اثر
//     ندارند: `decideReceipt` با و بدونِ آن‌ها دقیقاً یک خروجی می‌دهد.
//   • پرچمِ خاموش ⟵ پرامپتِ ایجنت بیت‌به‌بیت همان قبلی (رول‌بک).
//   • هر اجرای ایجنت (موفق یا شکست‌خورده) یک ردیفِ `receipt_analyses` می‌سازد، **قبل از** هر
//     ارسال به ادمین، و خطای دیتابیس هرگز مسیرِ پول را نمی‌شکند.
//   • خطِ ایجنت فقط روی پیامِ **مالک** است (تصمیمِ مالک: ادمین‌های دیگر شلوغ نشوند).
//
// کدِ واقعی از index.js بریده و روی SQLite با تلگرامِ قلابی اجرا می‌شود.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import * as CP from '../bots/tarot/cardpay.js';
import * as RT from '../bots/tarot/receipt-tags.js';

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

console.log('\n🔎 خروجیِ کاملِ ایجنتِ رسید\n');

/* ── ۱) نرمال‌سازیِ خالص ───────────────────────────────────────────────────── */
console.log('shadowFields:');
const SF = CP.shadowFields;
ok(SF({ source_card_prefix: '۶۰۳۷ ۹۹** **** ۱۲۳۴' }).src_prefix === '60379912', 'ارقامِ فارسی + فاصله ⟵ لاتین، حداکثر ۸ رقم');
ok(SF({ source_card_prefix: '6037' }).src_prefix === null, 'کمتر از ۶ رقم بانک را مشخص نمی‌کند ⟵ null');
ok(SF({ source_card_prefix: { a: 1 } }).src_prefix === null, 'نوعِ غلط ⟵ null (کرش نه)');
ok(SF({ bank_app: 'BLU' }).app === 'blu' && SF({ bank_app: '780' }).app === '780', 'اپ: حساس به حروفِ بزرگ نیست');
ok(SF({ bank_app: 'melli-app' }).app === null, 'اپِ بیرون از فهرستِ بسته ⟵ null');
ok(SF({ transfer_error: true }).transfer_error === true, 'خطای انتقال با true');
ok(SF({ transfer_error: 'true' }).transfer_error === false && SF({ transfer_error: 1 }).transfer_error === false,
  'خطای انتقال فقط با true ِ صریح (رشته/عدد نه) — فازِ ۵ رویش اقدامِ خودکار می‌زند');
for (const bad of [null, undefined, 'x', [], 5]) {
  const r = SF(bad);
  ok(r && r.src_prefix === null && r.app === null && r.transfer_error === false, `ورودیِ ${JSON.stringify(bad)} ⟵ همه null/false`);
}
ok(Object.keys(SF({})).sort().join(',') === 'app,app_name,src_prefix,transfer_error,transfer_error_text', 'خروجی همیشه همان پنج کلید');
ok(SF({ bank_app_name: 'x'.repeat(100) }).app_name.length === 40, 'نامِ اپ به ۴۰ نویسه بریده می‌شود');

/* ── ۲) پرامپت: خاموش = بیت‌به‌بیت قبلی؛ روشن = فیلدها + «هرگز verdict را عوض نکن» ─── */
console.log('\nپرامپت:');
const exp = { amount_toman: 60000, recipient: 'علیرضا اولیا', dest_last4: '5405' };
const off = CP.systemPrompt(exp), offF = CP.systemPrompt(exp, false), on = CP.systemPrompt(exp, true);
ok(off === offF, 'پیش‌فرضِ systemPrompt خاموش است');
ok(!/source_card_prefix|bank_app|transfer_error/.test(off), 'خاموش: هیچ اثری از فیلدهای تازه');
for (const k of ['source_card_prefix', 'bank_app', 'bank_app_name', 'transfer_error', 'transfer_error_text']) {
  ok(on.includes(`"${k}"`) && on.includes(`extracted.${k}`), `روشن: «${k}» هم در قاعده، هم در اسکیمای JSON`);
}
ok(/NEVER change your verdict/.test(on), 'روشن: صریح می‌گوید فیلدها verdict را عوض نمی‌کنند');
ok(on.startsWith(off.slice(0, off.indexOf('Notes:'))), 'روشن: همه‌ی قواعدِ تصمیم قبل از بخشِ تازه دست‌نخورده‌اند');
{
  const bodies = [];
  const fetchImpl = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"verdict":"review","reason_code":"uncertain","extracted":{}}' } }] }) }; };
  await CP.analyzeReceipt({ apiKey: 'k', models: ['m'], expected: exp, text: 'x', fetchImpl });
  await CP.analyzeReceipt({ apiKey: 'k', models: ['m'], expected: exp, text: 'x', fetchImpl, shadow: true });
  ok(!bodies[0].messages[0].content.includes('transfer_error'), 'analyzeReceipt بدونِ shadow ⟵ پرامپتِ قبلی روی سیم');
  ok(bodies[1].messages[0].content.includes('transfer_error'), 'analyzeReceipt با shadow ⟵ پرامپتِ تازه روی سیم');
  ok(JSON.stringify(Object.keys(bodies[0]).sort()) === JSON.stringify(Object.keys(bodies[1]).sort()), 'بدنه‌ی ریکوئست کلیدِ تازه‌ای نگرفت');
}

/* ── ۳) فیلدهای تازه روی تصمیمِ پول بی‌اثرند ──────────────────────────────── */
console.log('\nبی‌اثری روی پول:');
const EXTRA = { source_card_prefix: '603799', bank_app: 'blu', transfer_error: true, transfer_error_text: 'امکان انتقال وجه وجود ندارد' };
const cases = [
  { verdict: 'approve', reason_code: 'ok', extracted: { amount_raw: 600000 } },
  { verdict: 'approve', reason_code: 'ok', extracted: { amount_raw: 60000 } },
  { verdict: 'reject', reason_code: 'amount_too_low', extracted: { amount_raw: 300000 } },
  { verdict: 'reject', reason_code: 'not_a_receipt', extracted: {} },
  { verdict: 'review', reason_code: 'uncertain', extracted: { amount_raw: null } },
  { verdict: 'approve', reason_code: 'ok', extracted: {} },
];
for (const c of cases) {
  const a = CP.decideReceipt(c, 60000);
  const b = CP.decideReceipt({ ...c, extracted: { ...c.extracted, ...EXTRA } }, 60000);
  ok(JSON.stringify(a) === JSON.stringify(b), `decideReceipt یکسان: ${c.verdict}/${c.reason_code}/${c.extracted.amount_raw ?? '-'} ⟵ ${a.action}`);
}
ok(CP.validateVerdict({ verdict: 'approve', extracted: { amount_raw: 600000, bank_app: 42, transfer_error: 'yes', source_card_prefix: [] } }) === null,
  'فیلدِ تازه با نوعِ غلط باعثِ retry نمی‌شود (فقط ثبت است)');

/* ── ۴) خطِ نمایشی ────────────────────────────────────────────────────────── */
console.log('\nخطِ ایجنت:');
ok(RT.shadowLine(undefined) === '' && RT.shadowLine({ ok: 0, app: 'blu' }) === '', 'بدونِ ردیف یا ایجنتِ شکست‌خورده ⟵ هیچ خطی');
ok(RT.shadowLine({ ok: 1, app: '', src_prefix: '', transfer_error: 0 }) === '', 'هیچ فیلدی خوانده نشد ⟵ هیچ خطی (نه «نامشخص»)');
{
  const l = RT.shadowLine({ ok: 1, app: 'blu', src_prefix: '603799', transfer_error: 1 });
  ok(l.includes('بلو') && l.includes('۶۰۳۷۹۹') && l.includes('خطای انتقال'), `خطِ کامل: «${l}»`);
}
ok(Object.keys(RT.APP_LABELS).sort().join() === CP.BANK_APPS.slice().sort().join(), 'هر اپِ enum برچسبِ نمایشی دارد (و برعکس)');
{
  const line = RT.shadowLine({ ok: 1, app: 'ap' });
  const cap = RT.withShadowLine('x'.repeat(2000), line, 1024);
  ok(cap.length <= 1024 && cap.endsWith(line), 'کپشنِ بلند: خط سالم می‌ماند و سقفِ ۱۰۲۴ رعایت می‌شود');
  ok(RT.withShadowLine('abc', '', 1024) === 'abc', 'بدونِ خط ⟵ کپشن بیت‌به‌بیت');
}

/* ── ۵) رفتاری: ثبت روی SQLite با کدِ index.js ──────────────────────────── */
console.log('\nثبت (رفتاری):');
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS receipt_analyses', '`);');
const recorder = region('let _raIns;', '\nasync function processReceipt', { includeTo: false });
const db = new Database(':memory:');
if (schema) new Function('db', schema)(db);
const tracked = [], logs = [], errs = [];
let FLAG = true;
const mk = (d) => new Function('db', 'shadowFields', 'shadowLine', 'log', 'logErr', 'track', 'RECEIPT_SHADOW_ENABLED',
  `${recorder}\nreturn { recordReceiptAnalysis, lastReceiptAnalysis, ownerShadowLine };`)(
  d, CP.shadowFields, RT.shadowLine, (m) => logs.push(m), (...a) => errs.push(a.join(' ')),
  (_db, uid, ev, props) => tracked.push({ uid, ev, props }), FLAG);
const R = recorder ? mk(db) : null;
if (R) {
  const v = { verdict: 'approve', reason_code: 'ok', reason_fa: 'ok', extracted: { amount_raw: 600000, ...EXTRA }, risk_flags: [],
    agent: { ok: true, model: 'google/gemini-2.5-flash', attempts: [] } };
  R.recordReceiptAnalysis({ id: 7 }, 42, v, { action: 'approve', paid: 60000 }, 'photo', 1234);
  const row = R.lastReceiptAnalysis(7);
  ok(row && row.ok === 1 && row.user_id === 42 && row.source === 'photo' && row.ms === 1234, 'ردیفِ موفق با کاربر، منبع و زمان');
  ok(row?.app === 'blu' && row.src_prefix === '603799' && row.transfer_error === 1, 'سه ستونِ سریع از shadowFields');
  ok(row?.verdict === 'approve' && row.action === 'approve' && row.model === 'google/gemini-2.5-flash', 'verdict، action و مدل');
  const raw = JSON.parse(row?.raw_json || '{}');
  ok(raw.extracted?.transfer_error_text === EXTRA.transfer_error_text && raw.decision?.paid === 60000, 'raw_json کلِ خروجی + تصمیم را دارد');
  ok(tracked.some((t) => t.ev === 'receipt_analyzed' && t.props.payment_id === 7 && t.props.terr === 1), 'رویدادِ افزایشیِ receipt_analyzed');
  ok(logs.some((l) => l.startsWith('🔎 RECEIPT_SHADOW #7 ok=1 app=blu')), 'لاگِ greppable');
  R.recordReceiptAnalysis({ id: 8 }, 42, { verdict: 'review', extracted: EXTRA, agent: { ok: false, attempts: [] } },
    { action: 'review', agentFailed: true }, 'text', 60000);
  const f = R.lastReceiptAnalysis(8);
  ok(f?.ok === 0 && f.app === '' && f.transfer_error === 0, 'ایجنتِ شکست‌خورده ⟵ ردیف با ok=0 و بدونِ فیلدِ نمایشی (فالبکِ ساختگی اعتبار ندارد)');
  R.recordReceiptAnalysis({ id: 9 }, 42, null, { action: 'review', agentFailed: true }, 'text', 5);
  ok(R.lastReceiptAnalysis(9)?.ok === 0, 'verdict=null (پرتاب شد) ⟵ باز هم یک ردیف');
  ok(R.ownerShadowLine({ id: 7 }).includes('بلو') && R.ownerShadowLine({ id: 8 }) === '' && R.ownerShadowLine(null) === '', 'ownerShadowLine از تازه‌ترین ردیف');
  R.recordReceiptAnalysis({ id: 7 }, 42, { ...v, extracted: { amount_raw: 1 }, agent: { ok: true } }, { action: 'review' }, 'photo', 1);
  ok(R.lastReceiptAnalysis(7)?.app === '', 'رسیدِ دوم ⟵ تازه‌ترین ردیف ملاک است');
  const broken = new Database(':memory:');
  const RB = mk(broken);
  let threw = false;
  try { RB.recordReceiptAnalysis({ id: 1 }, 1, v, { action: 'approve' }, 'photo', 1); } catch { threw = true; }
  ok(!threw && errs.some((e) => e.startsWith('recordReceiptAnalysis:')), 'جدولِ غایب ⟵ فقط لاگِ خطا، هرگز پرتاب (مسیرِ پول سالم)');
  ok(RB.lastReceiptAnalysis(1) === undefined, 'خواندنِ ناموفق ⟵ undefined');
  FLAG = false;
  ok(mk(db).ownerShadowLine({ id: 7, _: 1 }) === '' && mk(db).ownerShadowLine({ id: 7 }) === '', 'پرچمِ خاموش ⟵ هیچ خطی روی پیامِ مالک');
  FLAG = true;
}

/* ── ۶) رفتاری: فقط پیامِ مالک خط می‌گیرد ───────────────────────────────── */
console.log('\nمسیریابیِ خط:');
const sender = region('async function sendToReceiptRecipients', '\n  return first;\n}');
if (sender) {
  const run = async (recips, line, { failFull = false } = {}) => {
    const sent = [];
    const bot = { telegram: {
      sendPhoto: async (id, _f, o) => { if (failFull && id !== 1) throw new Error('blocked'); sent.push({ id, cap: o.caption }); return { message_id: 1 }; },
      sendMessage: async (id, cap) => { if (failFull && id !== 1) throw new Error('blocked'); sent.push({ id, cap }); return { message_id: 1 }; },
    } };
    const fn = new Function('receiptRecipients', 'ownerCopyHeader', 'ownerShadowLine', 'withShadowLine', 'OWNER_ID', 'bot', 'logErr',
      `${sender}\nreturn sendToReceiptRecipients;`)(() => recips, () => 'HDR\n', () => line, RT.withShadowLine, 1, bot, () => {});
    await fn({ id: 5 }, { caption: 'CAP', photoFileId: 'f', kb: null });
    return sent;
  };
  const L = '🔎 ایجنت: اپ: بلو';
  let s = await run([{ id: 1, full: true }], L);
  ok(s.length === 1 && s[0].cap === `CAP\n\n${L}`, 'مالکِ ادمینِ کارت ⟵ یک پیام، با خط');
  s = await run([{ id: 9, full: true }, { id: 1, full: false }], L);
  ok(s.find((x) => x.id === 9).cap === 'CAP', 'ادمینِ کارتِ دیگر ⟵ کپشن بیت‌به‌بیت، بدونِ خط');
  ok(s.find((x) => x.id === 1).cap === `HDR\nCAP\n\n${L}`, 'کپیِ اطلاعاتیِ مالک ⟵ سرتیتر + خط');
  s = await run([{ id: 9, full: true }, { id: 1, full: false }], L, { failFull: true });
  ok(s.some((x) => x.id === 1 && x.cap.startsWith('⚠️') && x.cap.endsWith(L)), 'تورِ ایمنیِ مالک هم خط را دارد');
  s = await run([{ id: 1, full: true }], '');
  ok(s[0].cap === 'CAP', 'بدونِ تحلیل ⟵ کپشنِ مالک بیت‌به‌بیت');
}

/* ── ۷) ساختاری ───────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
ok(/const RECEIPT_SHADOW_ENABLED = true;/.test(CODE), 'پرچمِ رول‌بک تعریف شده و روشن است');
ok((CODE.match(/RECEIPT_SHADOW_ENABLED/g) || []).length === 4, 'پرچم دقیقاً چهار جا: تعریف، پرامپت، خطِ مالک، و گیتِ فازِ ۵ (terrOn)');
ok(/text: textBody, shadow: RECEIPT_SHADOW_ENABLED/.test(CODE), 'analyzeReceipt پرچم را می‌گیرد');
{
  const body = region('async function processReceipt', '\nasync function notifyAdminAutoApproved');
  const iRec = body.indexOf('recordReceiptAnalysis(p, uid, verdict, decision');
  const iFail = body.indexOf('if (decision.agentFailed)');
  const iSend = body.indexOf('await sleep(receiptDecisionDelayMs');
  ok(iRec > 0 && iRec < iFail && iRec < iSend, 'ثبت قبل از هر ارسال به ادمین (هم مسیرِ شکست، هم تصمیم)');
  ok(body.indexOf('decision = decideReceipt(') < iRec, 'ثبت بعد از تصمیم (action در ردیف می‌نشیند)');
}
ok(/\['receipt_analyses','user_id'\]/.test(CODE), 'wipeUser تحلیل‌های کاربر را هم پاک می‌کند');
ok(/const PRODUCT_VERSION = '3\.1(2[6-9]|[3-9]\d)\.\d+';/.test(CODE), 'PRODUCT_VERSION ≥ 3.126.0');
ok(/receipt-tags\.js/.test(readFileSync('tools/check-undefined.mjs', 'utf8')), 'check-undefined ماژولِ تازه را می‌بیند');

console.log(`\n${fail ? '❌' : '✅'} ${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
