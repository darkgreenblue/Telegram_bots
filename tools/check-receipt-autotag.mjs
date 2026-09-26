// چکِ CI برای «🤖 تگِ خودکار + 🔁 تحلیلِ دوباره‌ی رسیدهای گذشته» (tarot، v3.129.0 — فازِ ۷ِ PAYMENT-V2-PLAN.md).
//
// خرابی‌های بی‌صدا که این‌جا گرفته می‌شوند:
//   • رقم‌های بعد از ماسکِ رسید («6219 86** **** 1234») به پیش‌شماره بچسبند و بلو «سامان» تگ بخورد.
//   • پیش‌شماره‌ی مبهم (۶ رقمِ سامان/بلو) حدس زده شود.
//   • تگِ خودکار روی تگِ دستیِ مالک بنویسد، یا مقدارِ خاموش‌شده را بزند.
//   • تحلیلِ دوباره به پول/کارت/کاربر دست بزند، رویدادِ «امروز» زیرِ کاربرِ قدیمی بسازد، رسیدِ
//     از قبل تحلیل‌شده را دوباره پولی تحلیل کند، یا بعد از تمام شدن باز هم بچرخد.
//   • قطعیِ OpenRouter رسیدهای صف را بسوزاند (قطع‌کن).
// کدِ واقعیِ index.js بریده و روی SQLite با ایجنت/تلگرامِ قلابی اجرا می‌شود.
import * as RT from '../bots/tarot/receipt-tags.js';
import { shadowFields } from '../bots/tarot/cardpay.js';
import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const Database = createRequire(path.resolve('bots/tarot/package.json'))('better-sqlite3');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };
const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}
const OWNER = 111, USER = 9;

console.log('\n🤖 تگِ خودکار و تحلیلِ دوباره (فازِ ۷)\n');

/* ── ۱) نگاشتِ پیش‌شماره (خالص) ────────────────────────────────────────────── */
console.log('نگاشتِ پیش‌شماره:');
{
  const B = RT.bankFromPrefix;
  ok(B('603799') === 'melli' && B('6037 99** **** 1234') === 'melli' && B('۶۰۳۷ ۹۹۱۲ **** ۱۲۳۴') === 'melli', 'ملی: ساده، ماسک‌دار و ارقامِ فارسی');
  ok(B('6219 86** **** 1234') === null && B('621986') === null, '۶ رقمِ سامان/بلو مبهم است ⟵ بی‌تگ (رقم‌های بعد از ماسک نمی‌چسبند)');
  ok(B('62198619') === 'blu' && B('6219-8618-1234-5678') === 'blu' && B('62198612') === 'saman', '۸ رقم: بلو (18/19، دادهٔ مالک) در برابرِ سامان');
  ok(B('5022') === null && B('') === null && B(null) === null && B({}) === null, 'کوتاه/خالی/نوعِ غلط ⟵ null');
  ok(B('502806') === null && B('604932') === null && B('639217') === null, 'پیش‌شماره‌های فقط-یک‌منبعی عمداً بیرون‌اند');
  const seed = new Set(RT.SEED_TAG_VALUES.bank.map(([k]) => k));
  ok([...Object.values(RT.BIN_BANK), ...Object.values(RT.BIN8_BANK)].every((k) => seed.has(k)), 'هر مقصدِ نگاشت در فهرستِ بانک‌های سید هست');
  ok(Object.keys(RT.BIN_BANK).every((k) => /^\d{6}$/.test(k)) && Object.keys(RT.BIN8_BANK).every((k) => /^\d{8}$/.test(k)), 'کلیدها ۶ و ۸ رقمی');
  ok(JSON.stringify(RT.autoTagsFrom({ app: 'other', src_prefix: '603799' })) === '[{"dim":"bank","key":"melli"}]'
    && JSON.stringify(RT.autoTagsFrom({ app: 'ap', src_prefix: null })) === '[{"dim":"app","key":"ap"}]'
    && RT.autoTagsFrom(null).length === 0, '«other» هرگز تگ نیست؛ ورودیِ خالی ⟵ هیچ');
  ok(shadowFields({ source_card_prefix: '6219 86** **** 1234' }).src_prefix === '621986', 'shadowFields هم همان قاعده (ثبتِ زنده)');
}

/* ── ۲) رفتاری ────────────────────────────────────────────────────────────── */
console.log('\nرفتاری:');
const raSchema = region('  CREATE TABLE IF NOT EXISTS receipt_analyses (', 'CREATE INDEX IF NOT EXISTS idx_receipt_analyses_payment ON receipt_analyses(payment_id);');
const tagSchema = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ اپ/بانکِ مبدأ per رسید.', "} catch (e) { logErr('tag_values seed:', e.message); }");
const tagHelpers = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ دستیِ اپ/بانک، فقط روی پیام‌های رسیدِ **مالک**.', '\n/** ارسالِ یک پیامِ رسید به گیرنده‌هایش.', { includeTo: false });
const phase7 = region('/* 🔎 ثبتِ یک اجرای ایجنتِ رسید (فازِ ۴)', '\nasync function processReceipt', { includeTo: false });

const EXT = (o) => ({ amount_raw: 600000, ...o });
function boot({ autotag = true, rean = true, stars = false, shadow = true, agent = null } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, status TEXT NOT NULL DEFAULT 'approved',
      receipt_file_id TEXT, card_id INTEGER);
    CREATE TABLE migrations (key TEXT PRIMARY KEY, done_at INTEGER);`);
  const errs = [], logs = [], events = [], sent = [], calls = [];
  const dl = { fail: new Set() };
  const env = {
    db, RT, OWNER_ID: OWNER, RECEIPT_TAGS_ENABLED: true, RECEIPT_AUTOTAG_ENABLED: autotag, RECEIPT_REANALYSIS_ENABLED: rean,
    RECEIPT_SHADOW_ENABLED: shadow, starsRail: stars, shadowFields, shadowLine: () => '',
    log: (...a) => logs.push(a.join(' ')), logErr: (...a) => errs.push(a.join(' ')),
    track: (_d, u, e, p) => events.push({ u, e, p }),
    OPENROUTER_API_KEY: 'k', RECEIPT_MODELS: ['m1'], receiptExpectedCards: () => ({ card_last4: '5405' }),
    analyzeReceipt: async (o) => { calls.push(o); return (agent || (() => ({ verdict: 'approve', extracted: EXT({ bank_app: 'ap', source_card_prefix: '6104 33** **** 1234' }), agent: { ok: true, model: 'm1', attempts: [] } })))(o); },
    fetch: async (href) => ({ ok: !dl.fail.has(href), status: dl.fail.has(href) ? 404 : 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
    bot: { telegram: {
      getFileLink: async (fid) => ({ href: `https://f/${fid}` }),
      sendMessage: async (to, text) => { sent.push({ to, text }); return {}; },
    } },
  };
  env.stmts = { getPayment: db.prepare('SELECT * FROM payments WHERE id=?') };
  const body = `db.exec(\`${raSchema}\`);\n${tagSchema}\n${tagHelpers}\n${phase7}
    return { recordReceiptAnalysis, applyAutoTags, backfillAutoTags, reanalyzeNextPastReceipt, curTagsOf, tagSt, rean };`;
  const h = { ...new Function(...Object.keys(env), body)(...Object.values(env)), db, errs, logs, events, sent, calls, dl };
  h.pay = (fid = 'F', amount = 60000) => Number(db.prepare('INSERT INTO payments (user_id, amount, receipt_file_id, card_id) VALUES (?,?,?,1)').run(USER, amount, fid).lastInsertRowid);
  h.tags = (pid) => db.prepare('SELECT dim, value_key, source FROM receipt_tags WHERE payment_id=? ORDER BY dim, source').all(pid).map((t) => `${t.dim}=${t.value_key}/${t.source}`).join(' ');
  h.drain = async (n = 20) => { for (let i = 0; i < n; i++) await h.reanalyzeNextPastReceipt(); };
  return h;
}
const good = (ext) => ({ verdict: 'approve', extracted: EXT(ext), agent: { ok: true, model: 'm1', attempts: [] } });

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای کدِ فازِ ۷ شکست خورد:', e.stack); }
if (h) {
  // ثبتِ زنده.
  const p1 = h.pay();
  h.recordReceiptAnalysis({ id: p1 }, USER, good({ bank_app: 'ap', source_card_prefix: '6037 99** **** 1234' }), { action: 'approve' }, 'photo', 10);
  ok(h.tags(p1) === 'app=ap/auto bank=melli/auto' && h.events.filter((e) => e.e === 'receipt_analyzed').length === 1,
    'ثبتِ زنده: تگِ خودکارِ اپ و بانک + همان یک رویدادِ همیشگی');
  const p2 = h.pay();
  h.tagSt().set.run(p2, USER, 'bank', 'saman', OWNER);
  h.recordReceiptAnalysis({ id: p2 }, USER, good({ bank_app: 'blu', source_card_prefix: '6219 86** **** 1234' }), null, 'photo', 1);
  ok(h.tags(p2) === 'app=blu/auto bank=saman/admin bank=blu/auto' && h.curTagsOf(p2).bank.source === 'admin',
    'اپِ بلو + پیش‌شماره‌ی مبهم ⟵ بانکِ بلو (خودکار)؛ تگِ دستیِ مالک دست‌نخورده و مؤثر');
  const p3 = h.pay();
  h.recordReceiptAnalysis({ id: p3 }, USER, good({ bank_app: 'other', source_card_prefix: '603799' }), null, 'photo', 1);
  h.db.prepare("UPDATE tag_values SET active=0 WHERE dim='bank' AND key='mellat'").run();
  const p4 = h.pay();
  h.recordReceiptAnalysis({ id: p4 }, USER, good({ bank_app: 'top', source_card_prefix: '610433' }), null, 'photo', 1);
  ok(h.tags(p3) === 'bank=melli/auto' && h.tags(p4) === 'app=top/auto', '«other» تگ نیست؛ مقدارِ خاموش‌شده خودکار هم زده نمی‌شود');
  const p5 = h.pay();
  h.recordReceiptAnalysis({ id: p5 }, USER, { verdict: 'review', extracted: EXT({ bank_app: 'ap', source_card_prefix: '603799' }), agent: { ok: false } }, null, 'photo', 1);
  h.recordReceiptAnalysis({ id: p5 }, USER, null, null, 'photo', 1);
  ok(h.tags(p5) === '', 'ایجنتِ شکست‌خورده یا پرتاب ⟵ هیچ تگی (فالبکِ ساختگی اعتبار ندارد)');
  const hOff = boot({ autotag: false });
  const q = hOff.pay();
  hOff.recordReceiptAnalysis({ id: q }, USER, good({ bank_app: 'ap', source_card_prefix: '603799' }), null, 'photo', 1);
  ok(hOff.tags(q) === '' && hOff.db.prepare('SELECT COUNT(*) n FROM receipt_analyses').get().n === 1, 'رول‌بک (RECEIPT_AUTOTAG_ENABLED=false): ثبت می‌شود، تگ نه');

  // پرکردنِ یک‌باره از تحلیل‌های موجود.
  const hb = boot();
  const b1 = hb.pay(), b2 = hb.pay(), b3 = hb.pay();
  const ins = hb.db.prepare("INSERT INTO receipt_analyses (payment_id, user_id, source, ok, raw_json) VALUES (?,?,?,?,?)");
  ins.run(b1, USER, 'photo', 1, JSON.stringify({ extracted: EXT({ bank_app: 'blu', source_card_prefix: '6219 8619 **** 1234' }) }));
  ins.run(b2, USER, 'photo', 1, JSON.stringify({ extracted: EXT({ bank_app: 'ap' }) }).slice(0, 20));   // بریده
  ins.run(b3, USER, 'photo', 0, JSON.stringify({ extracted: EXT({ bank_app: 'ap', source_card_prefix: '603799' }) }));
  hb.backfillAutoTags();
  ok(hb.tags(b1) === 'app=blu/auto bank=blu/auto' && hb.tags(b2) === '' && hb.tags(b3) === '' && hb.calls.length === 0,
    'پرکردنِ یک‌باره: فقط تحلیلِ سالم، JSONِ بریده بی‌خطا رد، **بدونِ هیچ فراخوانیِ مدل**');
  hb.db.prepare('DELETE FROM receipt_tags').run();
  hb.backfillAutoTags();
  ok(hb.tags(b1) === '' && hb.db.prepare("SELECT 1 FROM migrations WHERE key='receipt_autotag_backfill_1'").get(), 'مارکر ⟵ اجرای دوم هیچ کاری نمی‌کند');

  // تحلیلِ دوباره.
  const hr = boot();
  const done = hr.pay('D');
  hr.db.prepare("INSERT INTO receipt_analyses (payment_id, user_id, source, ok) VALUES (?,?,'photo',1)").run(done, USER);
  const noPhoto = hr.pay(null), gone = hr.pay('GONE'), badAmt = hr.pay('Z', 0), old = hr.pay('OLD');
  hr.dl.fail.add('https://f/GONE');
  const before = JSON.stringify(hr.db.prepare('SELECT * FROM payments ORDER BY id').all());
  await hr.drain();
  const analyzed = hr.calls.map((c) => c.imageBuffer && c.shadow === true && c.expected.amount_toman);
  ok(hr.calls.length === 1 && analyzed[0] === 60000 && hr.calls[0].expected.amount_rial === 600000,
    'فقط رسیدِ عکس‌دارِ بی‌تحلیل به ایجنت رفت (با فیلدهای فازِ ۴ و مبلغِ فاکتور)');
  ok(hr.tags(old) === 'app=ap/auto bank=mellat/auto', 'تحلیلِ موفق ⟵ تگِ خودکار');
  ok(JSON.stringify(hr.db.prepare('SELECT * FROM payments ORDER BY id').all()) === before, 'هیچ ستونی از هیچ پرداختی (وضعیت، کارت، …) عوض نشد');
  ok(!hr.events.length, 'هیچ رویدادِ analytics (نه «امروز» زیرِ کاربرِ قدیمی)');
  const rows = (pid) => hr.db.prepare("SELECT COUNT(*) n FROM receipt_analyses WHERE payment_id=? AND source='reanalysis'").get(pid).n;
  ok(rows(done) === 0 && rows(noPhoto) === 0, 'رسیدِ از قبل تحلیل‌شده و پرداختِ بی‌عکس لمس نشدند');
  ok(rows(gone) === 2 && rows(badAmt) === 2, 'دانلودِ ناموفق/مبلغِ نامعتبر ⟵ حداکثر دو تلاش، بعد رها');
  ok(hr.sent.length === 1 && hr.sent[0].to === OWNER && /تمام شد/.test(hr.sent[0].text)
    && hr.db.prepare("SELECT 1 FROM migrations WHERE key='receipt_reanalysis_1'").get(), 'پایان ⟵ مارکر + یک پیامِ خلاصه فقط به مالک');
  hr.db.prepare("INSERT INTO payments (user_id, amount, receipt_file_id) VALUES (?, 60000, 'NEW')").run(USER);
  await hr.drain(3);
  ok(hr.calls.length === 1 && hr.sent.length === 1, 'بعد از پایان هرگز دوباره نمی‌چرخد (پرداختِ تازه مالِ مسیرِ زنده است)');

  // قطع‌کن.
  const hc = boot({ agent: () => ({ verdict: 'review', extracted: {}, agent: { ok: false, attempts: [] } }) });
  for (let i = 0; i < 8; i++) hc.pay(`C${i}`);
  await hc.drain(10);
  ok(hc.calls.length === 5 && hc.rean.pauseUntil > Date.now() && hc.errs.some((e) => /REANALYSIS_PAUSE/.test(e)),
    'پنج شکستِ پیاپیِ ایجنت ⟵ یک ساعت مکث (قطعیِ OpenRouter صف را نمی‌سوزاند)');
  ok(!hc.db.prepare("SELECT 1 FROM migrations WHERE key='receipt_reanalysis_1'").get(), 'و مکث پایان حساب نمی‌شود');

  for (const [opts, why] of [[{ rean: false }, 'پرچمِ خاموش'], [{ stars: true }, 'ریلِ استارز'], [{ shadow: false }, 'فیلدهای فازِ ۴ خاموش']]) {
    const hx = boot(opts);
    hx.pay('X');
    await hx.drain(3);
    ok(hx.calls.length === 0 && hx.sent.length === 0, `${why} ⟵ هیچ فراخوانی`);
  }
}

/* ── ۳) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
{
  const re = region('async function reanalyzeNextPastReceipt', '\n}\n');
  const code = re.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(re && !/decideReceipt|attributeReceiptCard|approvePayment|setPaymentStatus|stmts\.|afterApproval/.test(code),
    'تحلیلِ دوباره هیچ مسیرِ پول/کارتی را صدا نمی‌زند');
  ok(!/sendMessage\((?!OWNER_ID)/.test(code), 'تنها پیامِ آن به مالک است (هیچ پیامی به کاربر)');
  ok(/trackEvent: false/.test(code), 'و رویداد نمی‌سازد');
  const boot2 = region('function onLaunched() {', '\n}\n');
  ok(/backfillAutoTags\(\);/.test(boot2) && /setInterval\(reanalyzeNextPastReceipt, REANALYSIS_PACE_MS\)/.test(boot2),
    'از قلابِ onLaunch شروع می‌شود (نه `.then()`ِ launch، بند ۹ب/۷)');
  ok(/if \(ok\) applyAutoTags\(p\.id, uid, sh\);/.test(SRC), 'تگِ خودکار فقط روی تحلیلِ سالم');
  ok(/REANALYSIS_PACE_MS = 20_000/.test(SRC) && /REANALYSIS_TRIES = 2/.test(SRC), 'آهنگ و سقفِ تلاش پین شده‌اند (هزینه‌ی مدل)');
}

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا`);
process.exit(fail ? 1 : 0);
