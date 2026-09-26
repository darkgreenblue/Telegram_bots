#!/usr/bin/env node
// چکِ «ایجنتِ رسید هرگز بی‌صدا نمی‌میرد» + «رسید تکراری روی همه‌ی پیام‌ها» (tarot v3.120.0).
//
// دو خواسته‌ی صریحِ مالک (۱۴۰۵/۰۷/۰۴) که این چک قفل می‌کند:
//   ۱) خروجیِ مدل با **کد** سنجیده شود و خروجیِ نامعتبر دوباره پرسیده شود؛ زنجیره‌ی فالبکِ
//      جمنای ۲.۵ فلش (اوپن‌روتر تاریخِ حذفش را ۲۰۲۶-۱۰-۲۰ اعلام کرده) ⟵ جمنای ۳ فلش ⟵ luna؛
//      ددلاینِ کل ۶۰ ثانیه؛ و شکست = تأییدِ دستی با برچسبِ «ربات تأییدکننده ایراد دارد».
//   ۲) هر پیامِ رسیدِ اعتباردیده «رسید تکراری» هم داشته باشد، و آن دکمه الماس را بی‌صدا و
//      **بدونِ** تگِ بی‌اعتماد پس بگیرد (برخلافِ «پیامکش نیومده»).
//
// درسِ v3.118.0 (فالِ آویزان) این‌جا هم رعایت شده: استابِ fetch در یکی از سناریوها abort را
// **نادیده می‌گیرد**، چون روی سرور دقیقاً همین دیده شد و چکی که abort را محترم بشمارد همان
// فرضی را می‌سنجد که شکست خورد.
//
// اجرا: node tools/check-receipt-agent.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tarot = join(root, 'bots', 'tarot');
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error(`❌ ${msg}`); } };

const { analyzeReceipt, validateVerdict, RECEIPT_DEADLINE_MS } = await import(join(tarot, 'cardpay.js'));
const { FLASH, GEMINI3_FLASH, LUNA } = await import(join(tarot, 'reading-core.js'));

const GOOD = JSON.stringify({
  verdict: 'approve', reason_code: 'ok', reason_fa: 'ok',
  extracted: { amount_raw: 1500000, amount_currency: 'rial' }, risk_flags: [],
});
const reply = (content, status = 200) => ({
  ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }] }),
});
// استابی که بر اساسِ شماره‌ی فراخوانی پاسخ می‌دهد و بدنه‌ها را ثبت می‌کند
function stub(plan) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const step = plan[calls.length - 1] ?? plan[plan.length - 1];
    if (step === 'hang') return new Promise(() => {}); // abort را هم نادیده می‌گیرد
    if (step === 'throw') throw new Error('ECONNRESET');
    if (typeof step === 'number') return reply('', step);
    return reply(step);
  };
  return { calls, fetchImpl };
}
const CHAIN = [FLASH, FLASH, GEMINI3_FLASH, LUNA];
const base = { apiKey: 'k', models: CHAIN, expected: { amount_toman: 150000, amount_rial: 1500000 }, text: 'x' };

// ── ۱) مسیرِ عادی: یک فراخوانی، بدونِ تغییرِ شکلِ بدنه ─────────────────────────────
{
  const s = stub([GOOD]);
  const v = await analyzeReceipt({ ...base, fetchImpl: s.fetchImpl });
  ok(v.agent?.ok === true && v.verdict === 'approve', 'پاسخِ سالمِ اول پذیرفته شود');
  ok(s.calls.length === 1, `مسیرِ عادی فقط یک فراخوانی (دیده شد ${s.calls.length})`);
  ok(s.calls[0].model === FLASH, 'تلاشِ اول با مدلِ اصلی (FLASH)');
  ok(JSON.stringify(Object.keys(s.calls[0])) === JSON.stringify(['model', 'temperature', 'messages']),
    'بدنه‌ی ریکوئست همان سه کلیدِ قبلی است (رفتارِ مدلِ اصلی دست‌نخورده)');
}

// ── ۲) خروجیِ نامعتبر ⟵ دوباره پرسیده می‌شود ───────────────────────────────────────
for (const [name, bad] of [
  ['JSONِ خراب', '{"verdict": "approve", '],
  ['بدونِ JSON', 'I think this is fine'],
  ['verdictِ ناشناخته', JSON.stringify({ verdict: 'maybe', extracted: {} })],
  ['تأیید بدونِ extracted', JSON.stringify({ verdict: 'approve', reason_code: 'ok' })],
  ['مبلغِ غیرعددی', JSON.stringify({ verdict: 'approve', extracted: { amount_raw: 'پانصد' } })],
]) {
  const s = stub([bad, GOOD]);
  const v = await analyzeReceipt({ ...base, fetchImpl: s.fetchImpl });
  ok(s.calls.length === 2 && v.agent?.ok === true, `${name}: باید یک بار دوباره پرسیده شود و بعد پذیرفته`);
  ok(v.agent?.attempts?.[0]?.ok !== true, `${name}: تلاشِ اول شکست ثبت شود`);
}

// ── ۳) مدلِ حذف‌شده (۴۰۴) ⟵ زنجیره خودش جلو می‌رود ───────────────────────────────
{
  const s = stub([404, 404, GOOD]);
  const v = await analyzeReceipt({ ...base, fetchImpl: s.fetchImpl });
  ok(v.agent?.ok === true && v.agent.model === GEMINI3_FLASH, 'حذفِ جمنای ۲.۵ ⟵ جمنای ۳ فلش جواب می‌دهد');
  ok(s.calls.map((c) => c.model).join() === [FLASH, FLASH, GEMINI3_FLASH].join(), 'ترتیبِ زنجیره رعایت شود');
}
{
  const s = stub([404, 404, 'throw', GOOD]);
  const v = await analyzeReceipt({ ...base, fetchImpl: s.fetchImpl });
  ok(v.agent?.ok === true && v.agent.model === LUNA, 'شکستِ جمنای ۳ هم ⟵ luna آخرین حلقه است');
}

// ── ۴) همه شکست ⟵ review + agent.ok=false (هرگز تأیید/ردِ خودکار) ─────────────────
{
  const s = stub(['throw']);
  const v = await analyzeReceipt({ ...base, fetchImpl: s.fetchImpl });
  ok(v.agent?.ok === false, 'شکستِ همه‌ی مدل‌ها ⟵ agent.ok=false');
  ok(v.verdict === 'review', 'شکستِ همه ⟵ review (نه approve/reject)');
  ok(v.risk_flags.includes('agent_error'), 'برچسبِ agent_error ثبت شود');
  ok(s.calls.length === CHAIN.length, `همه‌ی حلقه‌های زنجیره امتحان شوند (دیده شد ${s.calls.length})`);
}

// ── ۵) ددلاینِ سخت، مستقل از abort ───────────────────────────────────────────────
{
  const s = stub(['hang']);
  const t0 = Date.now();
  const v = await analyzeReceipt({ ...base, fetchImpl: s.fetchImpl, deadlineMs: 900, timeoutMs: 300, minAttemptMs: 100 });
  const el = Date.now() - t0;
  ok(v.agent?.ok === false && v.verdict === 'review', 'fetchِ آویزان ⟵ review');
  ok(el < 1200, `ددلاینِ کل رعایت شود حتی وقتی fetch هرگز settle نمی‌شود (${el}ms)`);
}
ok(RECEIPT_DEADLINE_MS === 60_000, 'ددلاینِ پیش‌فرضِ ایجنت ۶۰ ثانیه (تصمیمِ مالک)');

// کنترلِ مثبتِ اعتبارسنج: پاسخِ سالمِ «رد» و «بازبینی» نباید قرمزِ کاذب بگیرد
ok(validateVerdict({ verdict: 'reject', reason_code: 'not_a_receipt' }) === null, 'ردِ بدونِ extracted سالم است');
ok(validateVerdict({ verdict: 'Review', extracted: { amount_raw: null } }) === null, 'reviewِ با مبلغِ null سالم است');
ok(validateVerdict({ verdict: 'approve', extracted: { amount_raw: '1500000' } }) === null, 'مبلغِ رشته‌ی عددی سالم است');

// ── ۶) ساختار: زنجیره و مسیرِ «ربات تأییدکننده ایراد دارد» در خودِ ربات ─────────────
const src = readFileSync(join(tarot, 'index.js'), 'utf8');
ok(/const RECEIPT_MODELS = \[FLASH, FLASH, GEMINI3_FLASH, LUNA\];/.test(src), 'زنجیره‌ی ایجنتِ رسید در index.js');
ok(/models: RECEIPT_MODELS/.test(src), 'processReceipt زنجیره را پاس بدهد (نه مدلِ تکی)');
ok(!/RECEIPT_MODEL\b/.test(src), 'ثابتِ تک‌مدلیِ قدیمی نماند');
ok(GEMINI3_FLASH === 'google/gemini-3-flash-preview', 'جانشینِ جمنای ۲.۵ = gemini-3-flash-preview');
const pr = src.slice(src.indexOf('async function processReceipt('));
const iFail = pr.indexOf('if (decision.agentFailed)');
const iSleep = pr.indexOf('await sleep(receiptDecisionDelayMs(p))');
ok(iFail > 0 && iSleep > iFail, 'شکستِ ایجنت **قبل از** تأخیرِ ساختگی به ادمین برود');
ok(/sendReceiptToAdmin\(ctx, uid, paymentId, photoFileId, textBody, L\.wallet\.agentBroken\)/.test(pr),
  'شکستِ ایجنت با برچسبِ agentBroken به ادمین برود');
ok(/verdict\.agent\?\.ok/.test(pr), 'processReceipt خروجیِ agent.ok را بخواند');
const fa = (await import(join(tarot, 'locales', 'fa.js'))).default;
ok(/ربات تأییدکننده ایراد دارد/.test(fa.wallet.agentBroken), 'متنِ برچسب همان عبارتِ مالک است');

// ── ۷) «رسید تکراری» روی همه‌ی پیام‌های اعتباردیده ──────────────────────────────
ok((src.match(/L\.buttons\.smsNotArrived/g) || []).length === 1,
  '«پیامکش نیومده» فقط از creditedReceiptKb ساخته شود (هیچ مسیری تکراری را جا نیندازد)');
const kbUses = (src.match(/creditedReceiptKb\(/g) || []).length;
ok(kbUses >= 4, `creditedReceiptKb در approve + susyes + تأییدِ خودکار + کم‌پرداخت (دیده شد ${kbUses})`);
const helper = src.slice(src.indexOf('const creditedReceiptKb'), src.indexOf('const creditedReceiptKb') + 400);
ok(/duplicate:\$\{pid\}/.test(helper), 'creditedReceiptKb دکمه‌ی duplicate دارد');
const dupH = src.slice(src.indexOf("bot.action(/^duplicate:"), src.indexOf("bot.action(/^dupno:"));
ok(/status === 'approved'[\s\S]*confirmDuplicate[\s\S]*dupyes:/.test(dupH), 'تکراری روی رسیدِ اعتباردیده اول تأییدِ دوم بخواهد');
const dupYes = dupH.slice(dupH.indexOf("bot.action(/^dupyes:"));
ok(/clawbackDuplicate\(/.test(dupYes), 'dupyes از clawbackDuplicate استفاده کند');
ok(!/sendMessage\(done\.p\.user_id/.test(dupYes), 'dupyes هیچ پیامی به کاربر نفرستد');

// ── ۸) رفتارِ پولی روی SQLite واقعی ───────────────────────────────────────────────
const require = createRequire(join(tarot, 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, pay_distrust INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, original_amount INTEGER,
           pkg TEXT, status TEXT, updated_at INTEGER);`);
const sqlOf = (name) => {
  const m = src.match(new RegExp(`\\b${name}: db\\.prepare\\((['"\`])(.+?)\\1\\)`));
  if (!m) throw new Error(`SQL ${name} پیدا نشد`);
  return db.prepare(m[2]);
};
const stmts = {
  markPaymentReversed: sqlOf('markPaymentReversed'),
  clawback: sqlOf('clawback'),
  setDistrust: sqlOf('setDistrust'),
  getPayment: db.prepare('SELECT * FROM payments WHERE id=?'),
};
const events = [];
const cut = (name) => {
  const i = src.indexOf(name);
  let depth = 0, j = src.indexOf(') {', i) + 2; // بعد از پرانتزِ پارامترها (پیش‌فرضِ `= {}` را رد می‌کند)
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`cut ${name}`);
};
const fnSrc = [cut('function clawbackApproved('), cut('async function reversePayment('), cut('function clawbackDuplicate(')].join('\n');
const mk = new Function('stmts', 'db', 'track', 'bonusFor',
  `${fnSrc}\nreturn { clawbackApproved, reversePayment, clawbackDuplicate };`);
const fns = mk(stmts, db, (_db, uid, ev, props) => events.push({ uid, ev, props }), () => 0);

db.prepare('INSERT INTO users (telegram_id, balance) VALUES (1, 10), (2, 3)').run();
db.prepare("INSERT INTO payments (id, user_id, amount, original_amount, pkg, status) VALUES (10, 1, 15000, 5, 'basic', 'approved'), (11, 1, 15000, 5, 'basic', 'waiting_review'), (12, 2, 15000, 5, 'basic', 'approved')").run();
const d = fns.clawbackDuplicate(10);
const u1 = db.prepare('SELECT * FROM users WHERE telegram_id=1').get();
ok(d && d.back === 5 && u1.balance === 5, 'تکراری: دقیقاً الماسِ همان پرداخت پس گرفته شود');
ok(u1.pay_distrust === 0, 'تکراری: کاربر بی‌اعتماد **نشود**');
ok(stmts.getPayment.get(10).status === 'reversed', 'تکراری: پرداخت از درآمد خارج شود (reversed)');
ok(events.some((e) => e.ev === 'payment_reversed' && e.props.via === 'duplicate_receipt'), 'رویدادِ payment_reversed با via=duplicate_receipt');
ok(fns.clawbackDuplicate(10) === null, 'تپِ دوم هیچ کاری نکند (ضدِ دوبار کسر)');
ok(fns.clawbackDuplicate(11) === null, 'رسیدِ هنوز تأییدنشده از این مسیر پس گرفته نشود');
await fns.reversePayment(12);
const u2 = db.prepare('SELECT * FROM users WHERE telegram_id=2').get();
ok(u2.balance === 0, 'کسر کفِ صفر دارد');
ok(u2.pay_distrust === 1, 'کنترلِ مثبت: «پیامکش نیومده» همچنان بی‌اعتماد می‌کند');

console.log(fails ? `\n❌ ${fails} ادعا شکست خورد (${passes} سبز)` : `✅ همه سبز (${passes} ادعا)`);
process.exit(fails ? 1 : 0);
