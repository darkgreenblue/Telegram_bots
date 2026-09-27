// چکِ CI برای دو کارِ یک‌باره‌ی v3.132.0 (tarot، تصمیمِ مالک ۱۴۰۵/۰۷/۰۵):
//   ۱) مهاجرتِ `tags_v2_manual_only`: تگ‌های خودکارِ هوش مصنوعی پاک، اپِ «بلو» غیرفعال و تگ‌های دستیِ
//      «بلو» ⟵ «موبایل‌بانک»، ترتیبِ تازه‌ی اپ‌ها، «نمی‌تونم تشخیص بدم» اولِ بانک‌ها، و `approved_at`ِ
//      پرداخت‌های قدیمی. یک‌باره و بی‌اثر روی تگِ دستیِ دیگر.
//   ۲) بازبینیِ رسیدهای گذشته برای **اکانتِ پشتیبانی**: آخرین رسیدِ تأییدشده‌ی عکس‌دارِ هر کاربر که
//      مالک دستی تگش نزده، پرتراکنش‌ترین اول، فقط با دکمه‌های اپ/بانک. ری‌استارت از همان‌جا ادامه
//      می‌دهد، ۴۲۹ صبر می‌کند، و پایان یک مارکر و یک پیام دارد.
// خرابی‌های بی‌صدایی که این‌جا گرفته می‌شوند: پیامِ تکراری به پشتیبانی بعد از هر ری‌استارت، رسیدی که
// مالک خودش تگ زده دوباره فرستاده شود، دکمه‌ی پولی یا کارت روی پیامِ پشتیبانی، یا مهاجرتی که تگِ
// دستیِ مالک را پاک کند.
import * as RT from '../bots/tarot/receipt-tags.js';
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.error(`  ❌ ${m}`); } };
const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}
const tagSchema = region('/* 🏷 فازِ ۶ (v3.128.0): تگِ اپ/بانکِ مبدأ per رسید.', "} catch (e) { logErr('tag_values seed:', e.message); }");
const migration = region('/* 🧹 v3.132.0، یک‌باره', "} catch (e) { logErr('tags_v3 migration:', e.message); }");
const review = region('/* 🧾 بازبینیِ رسیدهای گذشته برای اکانتِ پشتیبانی', '/* 💰 تأیید یا اصلاحِ', { includeTo: false });
const OWNER = 111, SUPPORT_ID = 555;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, status TEXT,
      receipt_file_id TEXT, invoice_no INTEGER NOT NULL DEFAULT 0, card_id INTEGER NOT NULL DEFAULT 1, approved_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE migrations (key TEXT PRIMARY KEY, done_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, name TEXT, display_name TEXT);`);
  return db;
}

/* ── ۱) مهاجرت ─────────────────────────────────────────────────────────────── */
console.log('\n🧹 مهاجرتِ تگ‌ها (یک‌باره)\n');
{
  const db = freshDb();
  const errs = [];
  // دیتابیسِ «دیروز»: سیدِ قدیمیِ اپ‌ها (بلو اول) با همان جدول‌ها.
  db.exec(`CREATE TABLE tag_values (dim TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (dim, key))`);
  [['blu', 'بلو'], ['ap', 'آپ'], ['780', '۷۸۰'], ['top', 'تاپ'], ['hamrahcard', 'همراه‌کارت'], ['mobilebank', 'موبایل‌بانک']]
    .forEach(([k, l], i) => db.prepare("INSERT INTO tag_values (dim, key, label, sort) VALUES ('app', ?, ?, ?)").run(k, l, i + 1));
  const run = () => new Function('db', 'RT', 'logErr', `${tagSchema}\n${migration}`)(db, RT, (...a) => errs.push(a.join(' ')));
  run();   // اولین بوت: جدولِ تگ ساخته شده، ولی رسید و پرداخت هنوز نیامده‌اند (مهاجرت همین حالا مهر خورده)
  ok(db.prepare("SELECT 1 FROM migrations WHERE key='tags_v2_manual_only'").get(), 'مهرِ یک‌باره خورد');
  // دیتابیسِ واقعی: ردیف‌ها **قبل از** بوتِ این نسخه وجود دارند ⟵ سناریوی دوم از صفر.
  const db2 = freshDb();
  db2.exec(`CREATE TABLE tag_values (dim TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (dim, key));
    CREATE TABLE receipt_tags (payment_id INTEGER NOT NULL, user_id INTEGER NOT NULL, dim TEXT NOT NULL, value_key TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'admin', by_id INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (payment_id, dim, source));`);
  [['blu', 'بلو'], ['ap', 'آپ'], ['780', '۷۸۰'], ['top', 'تاپ'], ['hamrahcard', 'همراه‌کارت'], ['mobilebank', 'موبایل‌بانک']]
    .forEach(([k, l], i) => db2.prepare("INSERT INTO tag_values (dim, key, label, sort) VALUES ('app', ?, ?, ?)").run(k, l, i + 1));
  db2.prepare("INSERT INTO tag_values (dim, key, label, sort) VALUES ('bank', 'blu', 'بلو', 1)").run();
  const T = db2.prepare('INSERT INTO receipt_tags (payment_id, user_id, dim, value_key, source) VALUES (?,?,?,?,?)');
  T.run(1, 9, 'app', 'blu', 'admin'); T.run(1, 9, 'bank', 'blu', 'admin');
  T.run(2, 9, 'app', 'ap', 'auto'); T.run(2, 9, 'bank', 'melli', 'auto'); T.run(3, 8, 'app', 'blu', 'auto');
  T.run(4, 8, 'bank', 'saman', 'admin');
  db2.prepare("INSERT INTO payments (user_id, amount, status, updated_at) VALUES (9, 60000, 'approved', 1790000000)").run();
  db2.prepare("INSERT INTO payments (user_id, amount, status, updated_at) VALUES (9, 60000, 'rejected', 1790000000)").run();
  const run2 = () => new Function('db', 'RT', 'logErr', `${tagSchema}\n${migration}`)(db2, RT, (...a) => errs.push(a.join(' ')));
  run2();
  const tags = db2.prepare('SELECT payment_id p, dim, value_key k, source s FROM receipt_tags ORDER BY payment_id, dim').all();
  ok(!tags.some((t) => t.s === 'auto'), 'همه‌ی تگ‌های خودکار پاک شدند');
  ok(JSON.stringify(tags) === JSON.stringify([
    { p: 1, dim: 'app', k: 'mobilebank', s: 'admin' }, { p: 1, dim: 'bank', k: 'blu', s: 'admin' }, { p: 4, dim: 'bank', k: 'saman', s: 'admin' }]),
  'تگِ دستیِ اپِ «بلو» ⟵ «موبایل‌بانک» (بانکش بلو ماند)؛ بقیه‌ی تگ‌های دستی دست‌نخورده');
  const app = db2.prepare("SELECT key, active, sort FROM tag_values WHERE dim='app' ORDER BY active DESC, sort").all();
  const APP_ORDER = JSON.stringify(['mobilebank', 'ap', '780', 'hamrahcard', 'top', 'bale', '724', 'atm', 'other', 'unknown']);
  ok(JSON.stringify(app.filter((v) => v.active).map((v) => v.key)) === APP_ORDER,
    'اپ‌های فعال به ترتیبِ مالک، با «بله»، «۷۲۴»، «خودپرداز»، «سایر» و «نمی‌تونم تشخیص بدم»');
  {
    // وضعیتِ واقعیِ سرور: v2 با فهرستِ قبلی از قبل اجرا شده (مهر دارد) و حالا سیدِ تازه + v3 می‌رسد.
    const db3 = freshDb();
    new Function('db', 'RT', 'logErr', tagSchema)(db3, RT, () => {});
    ['mobilebank', 'ap', '780', 'hamrahcard', 'top', 'atm', 'unknown'].forEach((k, i) => db3.prepare("UPDATE tag_values SET sort=? WHERE dim='app' AND key=?").run(i + 1, k));
    db3.prepare("INSERT INTO migrations (key, done_at) VALUES ('tags_v2_manual_only', 1)").run();
    ['bale', '724', 'other'].forEach((k) => db3.prepare("UPDATE tag_values SET sort=6 WHERE dim='app' AND key=?").run(k));   // جایگاهِ برخوردیِ سیدِ تازه
    new Function('db', 'RT', 'logErr', `${tagSchema}\n${migration}`)(db3, RT, (...a) => errs.push(a.join(' ')));
    const order = db3.prepare("SELECT key FROM tag_values WHERE dim='app' AND active=1 ORDER BY sort, rowid").all().map((r) => r.key);
    ok(JSON.stringify(order) === APP_ORDER, `سرورِ واقعی (v2 از قبل اجرا شده): ترتیبِ تازه یک‌باره درست می‌شود (${order.join('،')})`);
  }
  ok(app.find((v) => v.key === 'blu')?.active === 0, 'اپِ «بلو» غیرفعال شد (هرگز حذف نمی‌شود؛ برچسبِ تگِ قدیمی خوانا می‌ماند)');
  ok(db2.prepare("SELECT sort FROM tag_values WHERE dim='bank' AND key='unknown'").get()?.sort === 0, '«نمی‌تونم تشخیص بدم» اولِ فهرستِ بانک');
  const pays = db2.prepare('SELECT status, approved_at FROM payments ORDER BY id').all();
  ok(pays[0].approved_at === 1790000000 && pays[1].approved_at === null, 'approved_atِ تأییدشده‌های قبلی از updated_at پر شد؛ ردشده نه');
  // یک‌باره: بوتِ بعدی دست به تگِ تازه‌ی مالک نمی‌زند.
  T.run(5, 7, 'app', 'blu', 'admin');
  run2();
  ok(db2.prepare('SELECT value_key FROM receipt_tags WHERE payment_id=5').get().value_key === 'blu', 'بوتِ دوباره ⟵ مهاجرت اجرا نمی‌شود');
  ok(!errs.length, `بدونِ خطا${errs.length ? ': ' + errs[0] : ''}`);
}

/* ── ۲) بازبینی برای اکانتِ پشتیبانی ───────────────────────────────────────── */
console.log('\n🧾 بازبینیِ رسیدهای گذشته\n');
function boot(db, { flag = true, tagsOn = true, fail429Once = false, failFor = null } = {}) {
  const sent = [], logs = [], errs = [], sleeps = [];
  let first429 = fail429Once;
  const bot = { telegram: {
    sendMessage: async (to, text) => { sent.push({ to, text }); return {}; },
    sendPhoto: async (to, file, extra) => {
      if (first429) { first429 = false; const e = new Error('429'); e.response = { parameters: { retry_after: 3 } }; throw e; }
      if (file === failFor) throw new Error('Bad Request: wrong file identifier');
      sent.push({ to, file, text: extra.caption, extra }); return {};
    },
  } };
  const env = {
    db, bot, RT, SUPPORT: { id: SUPPORT_ID }, OWNER_ID: OWNER, TAG_REVIEW_ENABLED: flag, tagsOn: () => tagsOn,
    log: (m) => logs.push(m), logErr: (...a) => errs.push(a.join(' ')), sleep: async (ms) => { sleeps.push(ms); },
    getUser: (u) => db.prepare('SELECT * FROM users WHERE telegram_id=?').get(u),
    dispName: (u) => (u?.display_name || '').trim(), invoiceNoOf: (p) => Number(p?.invoice_no) || p.id,
    receiptInfoLines: (p) => `INFO#${p.id}`, curTagsOf: () => ({}), tagLabelFn: () => (_d, k) => k,
  };
  const f = new Function(...Object.keys(env), `${review}\nreturn { runTagReview, trSt };`);
  return { ...f(...Object.values(env)), sent, logs, errs, sleeps };
}
{
  const db = freshDb();
  new Function('db', 'RT', 'logErr', tagSchema)(db, RT, () => {});
  const P = db.prepare("INSERT INTO payments (user_id, amount, status, receipt_file_id, invoice_no) VALUES (?, ?, ?, ?, ?)");
  // کاربرِ ۱: سه پرداخت (آخرین عکس‌دار: F1c)؛ کاربرِ ۲: یک پرداخت؛ کاربرِ ۳: دو پرداخت ولی آخرین رسیدش را مالک تگ زده؛
  // کاربرِ ۴: فقط رسیدِ ردشده؛ کاربرِ ۵: پرداختِ متنی (بی‌عکس)؛ کاربرِ ۶: دو پرداخت.
  P.run(1, 15000, 'approved', 'F1a', 11); P.run(1, 15000, 'approved', 'F1b', 12); const u1last = P.run(1, 60000, 'approved', 'F1c', 13).lastInsertRowid;
  const u2 = P.run(2, 30000, 'approved', 'F2', 21).lastInsertRowid;
  P.run(3, 15000, 'approved', 'F3a', 31); const u3last = P.run(3, 15000, 'approved', 'F3b', 32).lastInsertRowid;
  P.run(4, 15000, 'rejected', 'F4', 41);
  P.run(5, 15000, 'approved', null, 51);
  P.run(6, 20000, 'approved', 'F6a', 61); const u6last = P.run(6, 20000, 'approved', 'F6b', 62).lastInsertRowid;
  P.run(1, 15000, 'pending', null, 14);   // فاکتورِ بازِ بعدی ⟵ «آخرین رسیدِ تأییدشده» عوض نمی‌شود
  db.prepare("INSERT INTO receipt_tags (payment_id, user_id, dim, value_key, source, by_id) VALUES (?, 3, 'bank', 'melli', 'admin', ?)").run(u3last, OWNER);
  db.prepare("INSERT INTO users (telegram_id, name, display_name) VALUES (1, 'a', 'سارا')").run();

  const h = boot(db, { fail429Once: true });
  await h.runTagReview();
  const photos = h.sent.filter((s) => s.file);
  ok(JSON.stringify(photos.map((p) => p.file)) === JSON.stringify(['F1c', 'F6b', 'F2']),
    `فقط آخرین رسیدِ تأییدشده‌ی عکس‌دار، پرتراکنش‌ترین اول؛ رسیدِ تگ‌خورده‌ی مالک، ردشده و متنی بیرون (${photos.map((p) => p.file)})`);
  ok(photos.every((p) => p.to === SUPPORT_ID) && h.sent.every((s) => s.to === SUPPORT_ID || s.to === OWNER), 'همه به اکانتِ پشتیبانی (و فقط خلاصه‌ی پایان به مالک)');
  const cbs = photos.flatMap((p) => p.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data));
  ok(cbs.length === 6 && cbs.every((c) => /^tg:o:\d+:(app|bank)$/.test(c)), 'زیرِ هر رسید فقط «📱 اپ» و «🏦 بانک»؛ نه کارت، نه هیچ دکمه‌ی پولی');
  ok(photos[0].text.startsWith('🧾 رسیدِ ۱ از ۳') && photos[0].text.includes('سارا [1]') && photos[0].text.includes('#13')
    && photos[0].text.includes(`INFO#${u1last}`) && photos[2].text.startsWith('🧾 رسیدِ ۳ از ۳'), 'کپشن: شماره‌ی ردیف، کاربر، فاکتور و خطِ کارت/سوابق');
  ok(h.sent[0].to === SUPPORT_ID && /۳ رسید/.test(h.sent[0].text) && !h.sent[0].file, 'اول یک پیامِ راهنما');
  ok(h.sleeps.includes(4000) && h.sleeps.filter((s) => s === 1100).length === 3, '۴۲۹ ⟵ همان retry_after صبر و دوباره؛ بینِ پیام‌ها ۱٫۱ ثانیه');
  ok(db.prepare("SELECT 1 FROM migrations WHERE key='tag_review_1'").get() && h.sent.some((s) => s.to === OWNER && /۳ رسید/.test(s.text)),
    'پایان ⟵ مهرِ tag_review_1 + خلاصه‌ی کوتاه به مالک');
  const again = boot(db);
  await again.runTagReview();
  ok(!again.sent.length, 'بعد از پایان، بوتِ بعدی هیچ پیامی نمی‌فرستد');
  void u2; void u6last;
}
{
  // ری‌استارت وسطِ کار: دو تا رفته، بقیه از همان‌جا (بدونِ تکرار و بدونِ پیامِ راهنمای دوباره).
  const db = freshDb();
  new Function('db', 'RT', 'logErr', tagSchema)(db, RT, () => {});
  const P = db.prepare("INSERT INTO payments (user_id, amount, status, receipt_file_id) VALUES (?, 15000, 'approved', ?)");
  const ids = [1, 2, 3, 4].map((u) => Number(P.run(u, `F${u}`).lastInsertRowid));
  db.prepare('INSERT INTO tag_review_sent (payment_id) VALUES (?), (?)').run(ids[3], ids[2]);
  const h = boot(db);
  await h.runTagReview();
  const files = h.sent.filter((s) => s.file).map((s) => s.file);
  ok(JSON.stringify(files) === JSON.stringify(['F2', 'F1']) && !h.sent.some((s) => !s.file && /بازبینیِ رسیدهای گذشته/.test(s.text)),
    'ری‌استارت ⟵ فقط باقی‌مانده‌ها، بدونِ تکرار و بدونِ پیامِ راهنمای دوباره');
  ok(h.sent.find((s) => s.file === 'F2').text.startsWith('🧾 رسیدِ ۳ از ۴'), 'شماره‌ی ردیف از همان‌جا ادامه می‌دهد');
}
{
  // 🐛 بازبینیِ خصمانه: تأییدِ تازه وسطِ ارسال مهرِ پایان را قفل می‌کرد و بوتِ بعدی دوباره می‌فرستاد.
  const db = freshDb();
  new Function('db', 'RT', 'logErr', tagSchema)(db, RT, () => {});
  const P = db.prepare("INSERT INTO payments (user_id, amount, status, receipt_file_id) VALUES (?, 15000, 'approved', ?)");
  P.run(1, 'F1'); P.run(2, 'F2');
  const h = boot(db);
  const orig = h.sent.push.bind(h.sent);
  let once = false;
  h.sent.push = (x) => { if (!once && x.file) { once = true; P.run(3, 'F3new'); } return orig(x); };
  await h.runTagReview();
  ok(db.prepare("SELECT 1 FROM migrations WHERE key='tag_review_1'").get(), 'تأییدِ تازه وسطِ ارسال ⟵ مهرِ پایان باز هم می‌خورد (دامنه = فهرستِ اول)');
  const again = boot(db);
  await again.runTagReview();
  ok(!again.sent.length, 'و بوتِ بعدی رسیدِ تازه را نمی‌فرستد (یک‌باره واقعاً یک‌باره است)');
}
{
  // فایلِ خراب ⟵ رد می‌شود و ثبت می‌شود (ok=0)؛ کار ادامه دارد.
  const db = freshDb();
  new Function('db', 'RT', 'logErr', tagSchema)(db, RT, () => {});
  const P = db.prepare("INSERT INTO payments (user_id, amount, status, receipt_file_id) VALUES (?, 15000, 'approved', ?)");
  P.run(1, 'BAD'); P.run(2, 'F2');
  const h = boot(db, { failFor: 'BAD' });
  await h.runTagReview();
  ok(h.sent.filter((s) => s.file).map((s) => s.file).join() === 'F2' && db.prepare('SELECT COUNT(*) n FROM tag_review_sent WHERE ok=0').get().n === 1
    && h.errs.some((e) => /TAG_REVIEW_SKIP/.test(e)) && h.sent.some((s) => s.to === OWNER && /۱ ارسال نشد/.test(s.text)),
  'فایلِ نامعتبر ⟵ ثبت با ok=0، مارکرِ لاگ، ادامه‌ی کار، و در خلاصه گزارش می‌شود');
}
{
  const db = freshDb();
  new Function('db', 'RT', 'logErr', tagSchema)(db, RT, () => {});
  db.prepare("INSERT INTO payments (user_id, amount, status, receipt_file_id) VALUES (1, 15000, 'approved', 'F')").run();
  for (const [label, o] of [['TAG_REVIEW_ENABLED=false', { flag: false }], ['ریلِ استارز (tagsOn=false)', { tagsOn: false }]]) {
    const h = boot(db, o);
    await h.runTagReview();
    ok(!h.sent.length && !db.prepare('SELECT COUNT(*) n FROM tag_review_sent').get().n, `${label} ⟵ هیچ پیامی`);
  }
}

/* ── ۳) ساختاری ────────────────────────────────────────────────────────────── */
console.log('\nساختاری:');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(/setTimeout\(\(\) => \{ runTagReview\(\)\.catch/.test(CODE), 'بعد از بوت یک‌باره اجرا می‌شود (نه setInterval)');
ok((CODE.match(/\bTAG_REVIEW_ENABLED\b/g) || []).length === 4, 'پرچم: تعریف + گاردِ ورود + گاردِ حلقه + گاردِ مهرِ پایان (رول‌بکِ یک‌خطی)');
ok(!/sendPhoto\([^)]*OWNER_ID/.test(review) && /const to = Number\(SUPPORT\.id\);/.test(review), 'رسیدها فقط به SUPPORT.id می‌روند');
ok(!/tagCollapsedRows\([^)]*cardLabel/.test(review), 'پیامِ پشتیبانی دکمه‌ی کارت نمی‌گیرد');

console.log(`\n${fail ? '❌' : '✅'} ${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
