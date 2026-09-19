// چکِ CI برای «راهِ خروج از فلوی پرداخت» (tarot) — بند ۹ب/۱ و ۹ب/۲ ریشه.
//
// از یک تیکتِ واقعی آمد (#TRT-8976388520): کاربر هر دکمه‌ی منویی می‌زد پیامِ «یه فاکتور
// شارژ باز داری» می‌گرفت، انصراف می‌زد، و دوباره همان پیام. روی دیتای زنده شش ردیفِ
// پرداختِ **خالیِ لغوشده** پشتِ سرِ هم ثبت شده بود؛ اثرانگشتِ خودِ حلقه.
//
// ریشه: دکمه‌ی گارد به `pay_cancel` وصل بود، ولی آن اکشن از ۱۴۰۵/۰۶/۱۱ معنیِ دیگری
// گرفت («یک قدم عقب به صفحه‌ی بسته‌ها») و برای کاربرِ الماسی یک ردیفِ پرداختِ تازه باز
// می‌کند و در `pay_amount` می‌ماند — دقیقاً شرطی که گارد رویش فعال می‌شود.
//
// این فایل خودِ حلقه را **اجرا** می‌کند: اول ثابت می‌کند رفتارِ قدیمی قفل می‌ساخت، بعد
// ثابت می‌کند رفتارِ تازه قفل را می‌شکند.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  return m[2];
}
function bodyOf(marker, end = '\n});') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n🚪 راهِ خروج از فلوی پرداخت\n');

/* ══ ۱) مدلِ گارد از خودِ سورس ════════════════════════════════════════════ */
// PAY_STATES از سورس خوانده می‌شود، و شکلِ خودِ گارد هم ادعا می‌شود تا این مدلِ دوخطی
// نتواند بی‌صدا از کدِ واقعی واگرا شود.
const PAY_STATES = JSON.parse(
  (SRC.match(/const PAY_STATES = (\[[^\]]+\])/)?.[1] || '[]').replace(/'/g, '"'));
const guard = bodyOf('async function blockDuringOpenPay(ctx, intent, intentArg = 0) {', '\n}');
ok(PAY_STATES.length > 0, `PAY_STATES از سورس خوانده شد (${PAY_STATES.join(', ')})`);
ok(guard ? /PAY_STATES\.includes\(getState\(uid\)\)/.test(guard) : false,
  'گارد روی PAY_STATES تصمیم می‌گیرد');
ok(guard ? /issuedInvoiceOf\(uid\)/.test(guard) : false,
  'و روی **فاکتورِ صادرشده**، نه صرفاً وجودِ paymentId در سشن');
ok(guard ? /dropUnissuedPay\(uid\)/.test(guard) : false,
  'و اگر فاکتوری صادر نشده، استیتِ کهنه را پاک می‌کند و رد می‌شود');
const issued = bodyOf('function issuedInvoiceOf(uid) {', '\n}');
ok(issued ? /status === 'pending' && p\.step === 'receipt'/.test(issued) : false,
  'تعریفِ «فاکتور» رکوردی است: pending + step=receipt');

/* دو مدل، عمداً جدا:
   `blockedOld` رفتارِ **تاریخی** است (استیت + وجودِ paymentId) و فقط برای بازتولیدِ
   حلقه‌ی تیکتِ #TRT-8976388520 می‌ماند. `blockedNow` رفتارِ **امروز** است. یکی‌کردنشان
   یعنی یا بازتولیدِ باگ را از دست بدهیم یا رفتارِ فعلی را اشتباه مدل کنیم. */
const blockedOld = (st) => PAY_STATES.includes(st.state) && !!st.session.paymentId;
const blockedNow = (st) => PAY_STATES.includes(st.state) && !!st.invoiceIssued;
const blocked = blockedOld;

/* ══ ۲) خودِ حلقه، اجراشده روی SQLite واقعی ══════════════════════════════ */
console.log('\n  — 🔁 بازتولیدِ حلقه:');
const setStatus = sqlOf('setPaymentStatus');
if (setStatus) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0);`);
  const UID = 8976388520;
  const openRow = () => Number(db.prepare('INSERT INTO payments (user_id) VALUES (?)').run(UID).lastInsertRowid);
  const cancelPending = (pid) => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
    if (p && p.user_id === UID && p.status === 'pending') db.prepare(setStatus).run('canceled', p.id);
  };

  // کاربر سرِ صفحه‌ی بسته‌ها (همان چیزی که دیتای زنده نشان داد)
  let st = { state: 'pay_amount', session: { paymentId: openRow() } };
  ok(blocked(st), 'کاربرِ وسطِ فلو با تپِ منو بلاک می‌شود (رفتارِ درست و موردِ انتظار)');

  // رفتارِ قدیمِ دکمه‌ی گارد = شاخه‌ی الماسیِ pay_cancel
  const payCancelCoins = (s) => {
    cancelPending(s.session.paymentId);
    return { state: 'pay_amount', session: { ...s.session, paymentId: openRow() } };
  };
  for (let i = 0; i < 5; i++) st = payCancelCoins(st);
  ok(blocked(st), '🐛 با رفتارِ قدیم، بعد از پنج بار انصراف هنوز بلاک است (خودِ حلقه)');
  ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='canceled' AND amount=0").get().c === 5,
    'و پنج ردیفِ خالیِ لغوشده جا می‌گذارد — همان اثرانگشتی که در دیتای زنده دیده شد');

  /* رفتارِ تازه = **خودِ هندلرِ pay_exit، بریده از سورس و اجراشده**.
     ⚠️ نسخه‌ی اولِ این چک این‌جا یک بازنویسیِ محلی داشت (`payExit` سه‌خطی) و با چند
     ادعای رجکسی جبرانش می‌کرد. همان تله‌ی ثبت‌شده‌ی `check-lucky`/`check-announce`:
     مدل «طراحی» را اثبات می‌کند نه «کد» را، و رجکس شکلِ خط را می‌بیند نه شرطی که آن خط
     زیرش نشسته. نتیجه: تپِ دکمه‌ی گاردِ **کهنه** (که استیت را بی‌قید عوض می‌کرد)
     کاملاً نامرئی بود. حالا هیچ کپی‌ای در کار نیست. */
  const exitBody = (() => {
    const i = SRC.indexOf('bot.action(/^pay_exit:(\\d+)$/');
    const s0 = SRC.indexOf('{', SRC.indexOf('=>', i));
    let d = 0;
    for (let j = s0; j < SRC.length; j++) {
      if (SRC[j] === '{') d++;
      else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s0 + 1, j); }
    }
    return null;
  })();
  ok(!!exitBody, 'هندلرِ pay_exit از سورس استخراج شد (بدونِ کپیِ محلی)');

  /** هندلرِ واقعی را روی همان SQLite اجرا می‌کند و استیت/سشنِ نهایی را برمی‌گرداند. */
  // ⚠️ async است چون خودِ هندلر از اولین خط `await` دارد؛ نسخه‌ی اولِ این wrapper
  // همگام بود و `log` را **قبل از** تمام‌شدنِ بدنه برمی‌گرداند، یعنی همه‌ی ادعاها روی
  // حالتِ دست‌نخورده می‌نشستند. دقیقاً همان کلاسِ «تستی که کدِ واقعی را اجرا نمی‌کند».
  let deleteFails = false;   // شبیه‌سازیِ ردِ حذف توسطِ تلگرام (پیامِ کهنه)
  const payExit = async (s, tapPid) => {
    const log = { state: s.state, session: { ...s.session }, deleted: 0, kbCleared: 0 };
    const fn = new Function('ctx', 'deps', `
      const { getSession, setSession, setState, stmts, replyCanceled, offerPendingReading, dropInvoiceArtifacts } = deps;
      return (async () => {${exitBody}})();`);
    const p = fn({ from: { id: UID }, match: [null, String(tapPid ?? s.session.paymentId ?? 0)],
         answerCbQuery: () => Promise.resolve(),
         // 🗑 از v3.71.0 پیامِ گارد **کامل حذف** می‌شود. هر دو متد ثبت می‌شوند تا بشود
         // هم مسیرِ عادی را سنجید و هم فالبک را (پیامِ قدیمی‌تر از ۴۸ ساعت).
         deleteMessage: () => { log.deleted++; return deleteFails ? Promise.reject(new Error('too old')) : Promise.resolve(); },
         editMessageReplyMarkup: () => { log.kbCleared++; return Promise.resolve(); } },
       { getSession: () => log.session,
         setSession: (_u, v) => { log.session = v; },
         setState: (_u, v) => { log.state = v; },
         stmts: { getPayment: { get: (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id) },
                  setPaymentStatus: { run: (stt, id) => db.prepare(setStatus).run(stt, id) } },
         replyCanceled: () => Promise.resolve(), offerPendingReading: () => Promise.resolve(),
         dropInvoiceArtifacts: () => Promise.resolve() });
    await p;
    return log;
  };
  const after = await payExit(st);
  ok(!blocked(after), '✅ با pay_exit یک بار انصراف کافی است و قفل می‌شکند');

  /* 🗑 پیامِ گارد بعد از انصراف باید **کامل حذف** شود، نه فقط دکمه‌اش (گزارشِ مالک،
     ۱۴۰۵/۰۶/۱۷). تا v3.70.0 فقط `editMessageReplyMarkup` می‌خورد، پس متنِ «یه فاکتور
     شارژِ باز داری / مبلغ رو واریز کن / رسید رو بفرست» سرِ جایش می‌ماند و دستورالعملی
     را نشان می‌داد که کاربر همین حالا لغوش کرده. و چون هر تپِ منو یک گاردِ تازه
     می‌سازد، چند نسخه از همان متن بالای چت جمع می‌شد. */
  ok(after.deleted === 1, '🗑 پیامِ گارد حذف می‌شود (نه فقط دکمه‌اش)');
  ok(after.kbCleared === 0, 'و وقتی حذف موفق بود، دیگر لازم نیست کیبورد جدا برداشته شود');

  /* فالبک: تلگرام حذفِ پیامِ قدیمی‌تر از ۴۸ ساعت را رد می‌کند. آن‌وقت دستِ‌کم دکمه باید
     برداشته شود، وگرنه دکمه‌ی مرده روی پیام می‌ماند — یعنی رفتارِ قبلی، نه هیچ‌چیز. */
  {
    deleteFails = true;
    db.prepare('UPDATE payments SET status=? WHERE id=?').run('pending', st.session.paymentId);
    const old = await payExit(st);
    ok(old.deleted === 1 && old.kbCleared === 1,
      'اگر حذف ممکن نبود (پیامِ کهنه)، دستِ‌کم دکمه برداشته می‌شود');
    ok(!blocked(old), 'و انصراف در آن حالت هم واقعاً کار می‌کند');
    deleteFails = false;
    db.prepare('UPDATE payments SET status=? WHERE id=?').run('canceled', st.session.paymentId);
  }
  ok(!PAY_STATES.includes(after.state), `استیت از PAY_STATES بیرون می‌رود (${after.state})`);
  ok(!after.session.paymentId, 'paymentId از سشن پاک می‌شود');
  ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='pending'").get().c === 0,
    'هیچ ردیفِ پرداختِ بازی جا نمی‌ماند');

  // فالِ رزروشده: استیت باید به confirm_pay برود نه idle
  const withReading = await payExit({ state: 'pay_receipt', session: { paymentId: openRow(), readingId: 7 } });
  ok(withReading.state === 'confirm_pay', 'کاربری که فالِ رزروشده دارد به confirm_pay می‌رود، نه idle');
  ok(!blocked(withReading), 'و او هم دیگر بلاک نمی‌شود');

  /* 🕰 تپِ دکمه‌ی گاردِ **کهنه** (v3.59.1).
     کاربرِ تیکت **چند** پیامِ گارد گرفته بود، و `editMessageReplyMarkup` فقط دکمه‌ی
     پیامی را که تپ شده برمی‌دارد؛ بقیه زنده می‌مانند. پس تپ روی یکی از آن‌ها بعد از
     خروج یک سناریوی واقعی است، نه فرضی. آن‌جا هیچ فلوی پرداختِ بازی وجود ندارد و این
     دکمه **هیچ کاری** نباید بکند. */
  console.log('\n  — 🕰 تپِ گاردِ کهنه بعد از خروج:');
  {
    const dead = openRow(); db.prepare(setStatus).run('canceled', dead);
    const mid = await payExit({ state: 'picking', session: { readingId: 5, picks: [1], need: 3 } }, dead);
    ok(mid.state === 'picking',
      'کاربرِ وسطِ انتخابِ کارت سرِ جایش می‌ماند (گریدش نمی‌میرد)', `شد: ${mid.state}`);
    // فالِ در حالِ تحویل: پول داده و محصولش دارد می‌رسد (گاردِ blockDuringDelivering، v3.17.0)
    const rev = await payExit({ state: 'revealing', session: { readingId: 9, revealIdx: 2 } }, dead);
    ok(rev.state === 'revealing',
      'کاربرِ وسطِ افشای فالِ پول‌داده از فلویش بیرون انداخته نمی‌شود', `شد: ${rev.state}`);
    ok(rev.session.readingId === 9, 'و سشنِ فالش دست‌نخورده می‌ماند');
    const idle = await payExit({ state: 'idle', session: {} }, dead);
    ok(idle.state === 'idle', 'کاربرِ idle هم دست‌نخورده می‌ماند');
    // ...ولی کسی که واقعاً گیر کرده باید همچنان آزاد شود، حتی با تپ روی پیامِ کهنه.
    const stuckPid = openRow();
    const stuck = await payExit({ state: 'pay_amount', session: { paymentId: stuckPid } }, dead);
    ok(!blocked(stuck) && stuck.state === 'idle',
      '⚠️ و کاربرِ واقعاً گیرکرده هنوز با همان دکمه آزاد می‌شود (قفل‌شکن نشکسته)');
    // 🔑 و **فاکتورِ سشن** بسته می‌شود نه هرچه روی دکمه نوشته. اگر دکمه برنده می‌شد،
    // ردیفِ زنده‌ی کاربر `pending` جا می‌ماند و بعداً مسیرِ بازیابیِ رسید دوباره پیدایش
    // می‌کرد — یک نشتِ خاموش، دقیقاً همان کلاسی که این تیکت از آن آمد.
    ok(db.prepare('SELECT status FROM payments WHERE id=?').get(stuckPid).status === 'canceled',
      'فاکتورِ فعلیِ سشن بسته می‌شود، نه ردیفی که روی دکمه‌ی کهنه نوشته شده');
    ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE status='pending'").get().c === 0,
      'و هیچ ردیفِ pending ای پشتِ سر نمی‌ماند');
  }

  console.log('\n  — 💰 چیزی که نباید لمس شود:');
  // رسیدِ ثبت‌شده و پرداختِ تأییدشده هرگز با یک تپِ کاربر لغو نمی‌شوند (بند ۹ب/۳)
  const wr = openRow(); db.prepare(setStatus).run('waiting_review', wr);
  const ap = openRow(); db.prepare(setStatus).run('approved', ap);
  cancelPending(wr); cancelPending(ap);
  ok(db.prepare('SELECT status FROM payments WHERE id=?').get(wr).status === 'waiting_review',
    'رسیدِ در انتظارِ بررسی لغو نمی‌شود');
  ok(db.prepare('SELECT status FROM payments WHERE id=?').get(ap).status === 'approved',
    'پرداختِ تأییدشده لغو نمی‌شود');
  // پرداختِ کاربرِ دیگر
  const other = Number(db.prepare('INSERT INTO payments (user_id) VALUES (999)').run().lastInsertRowid);
  cancelPending(other);
  ok(db.prepare('SELECT status FROM payments WHERE id=?').get(other).status === 'pending',
    'پرداختِ کاربرِ دیگر دست‌نخورده می‌ماند (چکِ مالکیت)');
  db.close();
}

/* ══ ۳) سیمِ اتصال: گارد باید به همین اکشن وصل باشد ═════════════════════ */
console.log('\n  — 🔌 اتصال:');
ok(guard ? /pay_exit:\$\{pid\}/.test(guard) : false, 'دکمه‌ی گارد به pay_exit وصل است');
ok(guard ? !/pay_cancel:/.test(guard) : false,
  'گارد دیگر از pay_cancel استفاده نمی‌کند (همان باگی که حلقه را می‌ساخت)');

/* ══ ۳الف) «تکمیل پرداخت» بالای «انصراف» (خواسته‌ی صریحِ مالک، ۱۴۰۵/۰۶/۲۷) ══
 *
 * تا امروز تنها دکمه‌ی زیرِ این پیام **انصراف** بود، یعنی تنها اقدامِ ممکنِ کاربرِ
 * گیرکرده ترکِ خرید. همان ایرادی که v3.95.0 روی یادآوریِ فاکتور گرفت و این‌جا جا
 * مانده بود: متن می‌گوید «تکمیلش کن» و هیچ دکمه‌ای برای تکمیل نیست. */
{
  const rows = guard ? guard.slice(guard.indexOf('Markup.inlineKeyboard([')) : '';
  const iDone = rows.indexOf('completePayment');
  const iCancel = rows.indexOf('buttons.cancel');
  ok(iDone > -1 && iCancel > -1 && iDone < iCancel,
    '✅ «تکمیل پرداخت» **بالای** «انصراف» است (درِ خروج هیچ‌وقت بالای درِ ادامه نمی‌نشیند، بند ۱۰)');
  /* 🔑 همان `pay_resume:` و همان `pid`، نه یک مسیرِ تازه. آن هندلر از قبل فاکتورِ
   * **همان ردیف** را برمی‌گرداند (بدونِ `claimAmount` و بدونِ INSERT)، پس شماره‌ی
   * پرداخت عوض نمی‌شود و رسیدِ کاربری که قبلاً واریز کرده روی همان ردیف می‌نشیند.
   * مسیرِ دومِ موازی روی ریلِ پول دقیقاً همان چیزی است که بند ۹ب/۶ منع می‌کند. */
  ok(/pay_resume:\$\{pid\}/.test(rows),
    '🔑 و به همان `pay_resume:<pid>` وصل است (فاکتورِ تازه ساخته نمی‌شود)');
  const resumeFn = bodyOf("bot.action(/^pay_resume:(\\d+)$/, async (ctx) => {", '\n});') || '';
  ok(!!resumeFn, 'هندلرِ pay_resume از سورس استخراج شد');
  ok(!/claimAmount|INSERT INTO payments/i.test(resumeFn),
    'و همان هندلر هیچ ردیف یا شماره‌ی تازه‌ای نمی‌سازد (رسیدِ واریزشده بی‌صاحب نمی‌شود)');
  ok(/setState\(uid, 'pay_receipt'\)/.test(resumeFn) && /paymentId/.test(resumeFn),
    '🧾 و استیت و `session.paymentId` را برمی‌گرداند، پس رسید بعد از تپ هم پذیرفته می‌شود');
  /* ⚠️ حلقه‌ی بی‌پایانی که همین‌جا نزدیک بود ساخته شود: گارد در **هر سه** استیتِ پرداخت
   * شلیک می‌کند (`pay_amount`/`pay_receipt`/`pay_discount`)، ولی `pay_resume` فقط در
   * `pay_receipt` مجاز بود. یعنی کاربرِ وسطِ کدِ تخفیف دکمه را می‌زد، میدل‌ورِ مرکزی
   * می‌بلعیدش و **همان پیامِ گارد دوباره** می‌آمد — عیناً کلاسِ تیکتِ #TRT-8976388520،
   * و بی‌صدا چون هیچ خطایی نمی‌دهد. پس هر دو دکمه باید بی‌قیدِ استیت عبور کنند. */
  // ⚠️ `bodyOf` جداکننده را **شامل نمی‌کند**، پس آکولادِ بسته دستی برمی‌گردد.
  const allow = bodyOf('function paymentFlowAllowsCallback(state, data) {', '\n}') || '';
  const allows = new Function('state', 'data',
    `${allow}\n}\nreturn paymentFlowAllowsCallback(state, data);`);
  for (const st of ['pay_amount', 'pay_receipt', 'pay_discount']) {
    ok(allows(st, 'pay_resume:7') === true, `🚪 «تکمیل پرداخت» در استیتِ ${st} عبور می‌کند`);
    ok(allows(st, 'pay_exit:7') === true, `🚪 و «انصراف» هم در ${st}`);
  }
  // 🔁 کنترلِ معکوس: allowlist پهن نشده — یک اکشنِ بی‌ربط هنوز گارد می‌خورد.
  ok(allows('pay_discount', 'wallet_go') === false,
    '🔁 کنترلِ معکوس: اکشنِ بی‌ربط هنوز عبور نمی‌کند (allowlist پهن نشد)');
}

const exitFn = bodyOf("bot.action(/^pay_exit:");
ok(!!exitFn, 'هندلرِ pay_exit ثبت شده');
ok(exitFn ? /replyCanceled\(ctx, uid\)/.test(exitFn) : false,
  'نیتِ ذخیره‌شده برمی‌گردد (replyCanceled → replayIntent)، پس کاربر به مقصدِ خودش می‌رسد');
ok(exitFn ? /offerPendingReading\(ctx, uid\)/.test(exitFn) : false,
  'فالِ رزروشده سرگردان نمی‌ماند');
ok(exitFn ? /p\.status === 'pending'/.test(exitFn) : false, 'فقط پرداختِ pending لغو می‌شود');
ok(exitFn ? /p\.user_id === uid/.test(exitFn) : false, 'مالکیتِ رکورد چک می‌شود');
// ⚠️ درسِ جهشِ M4: شبیه‌سازیِ بالا **طراحی** را اثبات می‌کند نه **کد** را. هر قدمی که
// مدل انجام می‌دهد باید یک ادعای متناظر داشته باشد که هندلرِ واقعی هم همان را می‌کند،
// وگرنه حذفِ آن قدم از کد بی‌صدا سبز می‌ماند. paymentId ماندگارِ یک پرداختِ لغوشده در
// سشن، هر مسیری را که بعداً `s.paymentId` را می‌خواند به یک ردیفِ مرده وصل می‌کند.
ok(exitFn ? /delete s\.paymentId/.test(exitFn) && /setSession\(uid, s\)/.test(exitFn) : false,
  'paymentId واقعاً از سشن پاک و ذخیره می‌شود (نه فقط در مدلِ این تست)');
ok(exitFn ? /setState\(uid, s\.readingId \? 'confirm_pay' : 'idle'\)/.test(exitFn) : false,
  'استیت واقعاً بیرونِ PAY_STATES نوشته می‌شود، و فالِ رزروشده به confirm_pay می‌رود');
// ⚠️ و آن نوشتن باید **زیرِ شرطِ** «واقعاً یک پرداختِ باز بستیم» باشد، نه بی‌قید (v3.59.1).
// خودِ سناریو بالا اجرا می‌شود؛ این ادعا شکلِ ساختاری‌اش را هم قفل می‌کند تا اگر روزی
// خط از داخلِ if بیرون بیاید، پیامِ خطا بگوید چرا.
ok(exitFn ? /if \(s\.paymentId\) \{[\s\S]*?setState\(uid, s\.readingId/.test(exitFn) : false,
  'تغییرِ استیت زیرِ شرطِ داشتنِ paymentId است (تپِ گاردِ کهنه بی‌اثر می‌ماند)');
// ⚠️ قلبِ فیکس: این اکشن هرگز نباید ردیفِ پرداختِ تازه باز کند.
ok(exitFn ? !/openPaymentRow/.test(exitFn) : false,
  'pay_exit هیچ ردیفِ پرداختِ تازه‌ای باز نمی‌کند (وگرنه دوباره همان حلقه)');
ok(exitFn ? !/'pay_amount'/.test(exitFn) : false, 'و کاربر را به pay_amount برنمی‌گرداند');

/* ══ ۳ب) پیامِ فاکتور با **هر** دکمه‌ی انصرافی پاک می‌شود ═══════════════════
 *
 * 🐛 گزارشِ مالک (۱۴۰۵/۰۶/۲۲): انصراف از زیرِ پیامِ گارد، فقط پیامِ گارد را می‌بست و
 * فاکتور با شماره‌کارت و دکمه‌های زنده‌اش در چت می‌ماند، در حالی که ردیفش `canceled`
 * شده بود.
 *
 * ⚠️ و ریشه‌اش از خودِ باگ مهم‌تر است: در مسیرِ `pay_cancel` این پیام پاک **می‌شد**، ولی
 * نه با یک قاعده — دکمه‌ی آن مسیر زیرِ خودِ فاکتور است و `ctx.deleteMessage()` اتفاقاً
 * همان را می‌بست. یعنی درستی به «کدام پیام تپ شد» وابسته بود، و اولین دکمه‌ی انصرافی که
 * جای دیگری نشست از کنارش رد شد. پس این بخش **تک‌نقطه بودن** را می‌سنجد، نه رفتارِ یک
 * دکمه‌ی خاص: هر مسیرِ انصراف باید از `dropInvoiceArtifacts` رد شود و خودِ آن تابع
 * تصمیم بگیرد. */
console.log('\n  — 🧾 پاک‌سازیِ پیامِ فاکتور:');
ok(exitFn ? /dropInvoiceArtifacts\(ctx, uid, p\)/.test(exitFn) : false,
  'pay_exit از تک‌نقطه‌ی پاک‌سازی رد می‌شود');
const cancelFn = bodyOf('bot.action(/^pay_cancel:(\\d+)$/, async (ctx) => {');
ok(cancelFn ? /dropInvoiceArtifacts\(ctx, uid, p\)/.test(cancelFn) : false,
  'pay_cancel هم از همان تک‌نقطه رد می‌شود (قاعده، نه تصادفِ «کدام پیام تپ شد»)');

/* ⚠️ درسِ جهشِ M2 (زنده ماند و ادعای اولِ من را پوچ نشان داد): یک ادعای **ترتیبی**
 * («پاک‌سازی قبل از cancel») این‌جا بی‌معناست، چون `p` یک **اسنپ‌شات** است و
 * `setPaymentStatus` مقدارِ داخلِ آبجکت را عوض نمی‌کند. یعنی جابه‌جاییِ دو خط هیچ
 * رفتاری را نمی‌شکند و آن ادعا هیچ‌وقت قرمز نمی‌شد.
 * چیزی که **واقعاً** بار دارد این است: هر دو مصرف‌کننده باید همان **یک** خوانش را
 * ببینند. اگر روزی کسی بعد از cancel ردیف را دوباره بخواند و آن را پاس بدهد، شرطِ
 * `pending` بی‌صدا false می‌شود و فاکتور دوباره در چت می‌ماند — بدونِ هیچ خطایی. */
const reads = (s) => (s ? (s.match(/stmts\.getPayment\.get\(/g) || []).length : -1);
ok(reads(exitFn) === 1,
  'pay_exit ردیف را دقیقاً یک بار می‌خواند (همان اسنپ‌شات به پاک‌سازی و به cancel می‌رسد)',
  `شمارش: ${reads(exitFn)}`);
ok(reads(cancelFn) === 1,
  'pay_cancel هم همان یک اسنپ‌شات را به هر دو می‌دهد',
  `شمارش: ${reads(cancelFn)}`);

const DROP_MARK = 'async function dropInvoiceArtifacts(ctx, uid, p) {';
const dropBody = (() => {
  const i = SRC.indexOf(DROP_MARK);
  if (i < 0) return null;
  const s0 = i + DROP_MARK.length - 1;
  let d = 0;
  for (let j = s0; j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s0 + 1, j); }
  }
  return null;
})();
ok(!!dropBody, 'بدنه‌ی dropInvoiceArtifacts از سورس استخراج شد (بدونِ کپیِ محلی)');

const setInvSql = sqlOf('setInvoiceMsgId');
if (dropBody && setInvSql) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', invoice_msg_id INTEGER, stars_invoice_msg_id INTEGER);`);
  const U = 4242;
  const rowOf = (status, invMsg, uid = U, starsMsg = null) => {
    const id = Number(db.prepare(
      'INSERT INTO payments (user_id, status, invoice_msg_id, stars_invoice_msg_id) VALUES (?,?,?,?)')
      .run(uid, status, invMsg, starsMsg).lastInsertRowid);
    return db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  };
  const msgIdOf = (id) => db.prepare('SELECT invoice_msg_id m FROM payments WHERE id=?').get(id).m;

  let delFails = false;   // شبیه‌سازیِ ردِ حذف توسطِ تلگرام (پیامِ قدیمی‌تر از ۴۸ ساعت)
  const runDrop = async (p, session = {}) => {
    const log = { deleted: [], kbCleared: [], session: { ...session } };
    const fn = new Function('ctx', 'uid', 'p', 'deps', `
      const { getSession, patchSession, stmts } = deps;
      return (async () => {${dropBody}})();`);
    await fn(
      { chat: { id: U },
        telegram: {
          deleteMessage: (_c, m) => {
            log.deleted.push(m);
            return delFails ? Promise.reject(new Error('too old')) : Promise.resolve();
          },
          editMessageReplyMarkup: (_c, m) => { log.kbCleared.push(m); return Promise.resolve(); },
        } },
      U, p,
      { getSession: () => log.session,
        patchSession: (_u, v) => Object.assign(log.session, v),
        stmts: { setInvoiceMsgId: { run: (v, id) => db.prepare(setInvSql).run(v, id) } } });
    return log;
  };

  // ۱) فاکتورِ زنده: همان چیزی که مالک دید
  const live = rowOf('pending', 555);
  const r1 = await runDrop(live);
  ok(r1.deleted.includes(555), '🧾 پیامِ فاکتورِ زنده واقعاً پاک می‌شود');
  ok(msgIdOf(live.id) === null,
    'و مهرِ ستون صفر می‌شود، پس invoice_msg_id دقیقاً یعنی «پیامِ زنده‌ای در چت هست»');
  ok(r1.kbCleared.length === 0, 'حذفِ موفق دیگر فالبکِ برداشتنِ دکمه را اجرا نمی‌کند');

  // ۲) فالبکِ پیامِ کهنه (همان الگوی پیامِ گارد)
  {
    delFails = true;
    const old = rowOf('pending', 777);
    const r2 = await runDrop(old);
    ok(r2.kbCleared.includes(777),
      'پیامِ قدیمی‌تر از ۴۸ ساعت: دستِ‌کم دکمه‌هایش برداشته می‌شود (تپِ بی‌اثر روی مسیرِ پول نماند)');
    ok(msgIdOf(old.id) === 777,
      'و چون پیام هنوز در چت است، مهرِ ستون عمداً صفر **نمی‌شود**');
    delFails = false;
  }

  // ۳) چیزی که نباید لمس شود — با کنترلِ مثبت (بند ۶ب-۲ ریشه)
  for (const st of ['waiting_review', 'approved', 'canceled']) {
    const p = rowOf(st, 888);
    ok(!(await runDrop(p)).deleted.includes(888),
      `💰 فاکتورِ ${st} لمس نمی‌شود (بخشی از رکوردِ همان پرداخت است)`);
  }
  const ctrl = rowOf('pending', 888);
  ok((await runDrop(ctrl)).deleted.includes(888),
    '🎯 کنترلِ مثبت: همین هارنس روی ردیفِ pending واقعاً پاک می‌کند (پس ادعاهای بالا پوچ نیستند)');

  // ۴) مالکیت: شناسه‌ی پیام per چت است، پس ردیفِ کاربرِ دیگر می‌توانست پیامِ بی‌ربط ببرد
  const foreign = rowOf('pending', 999, 9999);
  ok(!(await runDrop(foreign)).deleted.includes(999),
    'فاکتورِ کاربرِ دیگر پاک نمی‌شود (چکِ مالکیت)');

  // ۵) دو پاک‌سازیِ قبلی نشکسته باشند
  const both = rowOf('pending', 111, U, 222);
  const r5 = await runDrop(both, { pickedMsgId: 333 });
  ok(r5.deleted.includes(222), 'فاکتورِ نیتیوِ استارز مثل قبل پاک می‌شود');
  ok(r5.deleted.includes(333), 'پیامِ بسته‌ی انتخاب‌شده مثل قبل پاک می‌شود');
  ok(r5.session.pickedMsgId === null, 'و نشانه‌اش از سشن برداشته می‌شود');
  db.close();
}

/* ══ ۴) جاروی خودکار: کسی که از قبل گیر افتاده نباید کاری بکند ══════════ */
// فیکسِ دکمه یک تپ می‌خواهد؛ کسی که هفته‌ی پیش گیر افتاده و رفته، هرگز آن تپ را نمی‌زند.
// این بخش ثابت می‌کند جارو دقیقاً همان‌ها را آزاد می‌کند و به پول دست نمی‌زند.
console.log('\n  — 🧹 جاروی فلوی رهاشده:');
const sweepSql = sqlOf('stuckPayCandidates');
if (sweepSql) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, state TEXT, session_json TEXT,
      balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', updated_at INTEGER NOT NULL DEFAULT 0);`);
  const OLD = Math.floor(Date.now() / 1000) - 7200;   // دو ساعت پیش
  const NEW = Math.floor(Date.now() / 1000);          // همین حالا
  // uid, state, payment(status, amount, updated_at), آیا باید آزاد شود؟
  const cases = [
    [1, 'pay_amount',   'pending',        0,   OLD, true,  'ردیفِ خالیِ پارک‌شده'],
    [2, 'pay_amount',   'canceled',       0,   OLD, true,  'فاکتورِ مرده (همان ۱۹ نفرِ دیتای زنده)'],
    [3, 'pay_receipt',  'canceled',       50,  OLD, true,  'رسیدِ لغوشده‌ی کهنه'],
    [4, 'pay_discount', 'refunded',       0,   OLD, true,  'ریفاندشده'],
    [5, 'pay_receipt',  'waiting_review', 100, OLD, false, '💰 رسیدِ در انتظارِ بررسی'],
    [6, 'pay_receipt',  'approved',       100, OLD, false, '💰 پرداختِ تأییدشده'],
    [7, 'pay_receipt',  'pending',        100, OLD, false, '💰 فاکتورِ زنده‌ی مبلغ‌دار'],
    [8, 'pay_amount',   'pending',        0,   NEW, false, 'کاربرِ همین‌حالا وسطِ کار'],
    [9, 'idle',         'pending',        0,   OLD, false, 'کاربری که اصلاً در فلو نیست'],
  ];
  for (const [uid, st, pst, amt, ts] of cases) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(uid, st, JSON.stringify({ paymentId: uid * 10 }), 7);
    db.prepare('INSERT INTO payments VALUES (?,?,?,?,?)').run(uid * 10, uid, amt, pst, ts);
  }
  /* 🐛 کاربرانی با session_json نامعتبر — همان چیزی که فیکسچرِ تمیزِ نسخه‌ی اول نداشت.
   * پیش‌فرضِ ستون رشته‌ی **خالی** است و json_extract روی آن خطا پرتاب می‌کند. روی سرور
   * جارو با «malformed JSON» ترکید و هیچ‌وقت اجرا نشد؛ ۳۵ کاربر گیر ماندند و این تست
   * سبز بود، چون در فیکسچرش همه‌ی کاربران JSON سالم داشتند. اکثریتِ کاربرانِ واقعی
   * اصلاً وارد فلوی پرداخت نشده‌اند، پس session_json خالی **حالتِ عادی** است نه لبه. */
  for (const [i, bad] of ['', 'not json', '{', '[1,2', 'null'].entries()) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(900 + i, 'idle', bad, 0);
  }
  const PAY = PAY_STATES;
  // اول از همه: کوئری اصلاً نباید بترکد. این ادعا مقدم بر درستیِ انتخاب است.
  let rowsOrErr;
  try { rowsOrErr = db.prepare(sweepSql).all(1800); }
  catch (e) { rowsOrErr = e; }
  ok(!(rowsOrErr instanceof Error),
    'کوئریِ جارو روی session_json نامعتبر نمی‌ترکد (خالی، ناقص، غیرJSON)',
    rowsOrErr instanceof Error ? rowsOrErr.message : '');
  const picked = new Set((Array.isArray(rowsOrErr) ? rowsOrErr : [])
    .filter(r => PAY.includes(r.state))     // همان فیلترِ جاوااسکریپتیِ خودِ جارو
    .map(r => r.uid));
  for (const [uid, , , , , want, label] of cases) {
    ok(picked.has(uid) === want, `${want ? 'آزاد می‌شود' : 'دست نمی‌خورد'}: ${label}`);
  }
  ok(!/balance/i.test(sweepSql), 'کوئریِ جارو اصلاً کلمه‌ی balance را ندارد');
  db.close();
}

const sweep = bodyOf('function sweepStuckPayFlows() {', '\n}');
ok(!!sweep, 'تابعِ جارو پیدا شد');
ok(sweep ? /PAY_STATES\.includes\(getState\(r\.uid\)\)/.test(sweep) : false,
  'فیلترِ استیت از خودِ PAY_STATES می‌آید و وضعیتِ **الانِ** کاربر را می‌خواند نه عکسِ لحظه‌ای');
// درسِ v3.59.1، این‌بار روی جارو: ربات حین اجرای جارو زنده است، پس کاربری که در همین
// فاصله فلوی تازه‌ای باز کرده نباید کوبیده شود.
ok(sweep ? /Number\(s\.paymentId\) !== r\.pid/.test(sweep) : false,
  'اگر کاربر در این فاصله سراغِ فاکتورِ دیگری رفته باشد، رد می‌شود');
ok(sweep ? /r\.pstatus === 'pending'/.test(sweep) : false,
  'فقط ردیفِ pending لغو می‌شود (ردیفِ مرده دوباره دست نمی‌خورد)');
ok(sweep ? /delete s\.paymentId/.test(sweep) && /setSession\(r\.uid, s\)/.test(sweep) : false,
  'paymentId از سشن پاک و ذخیره می‌شود');
ok(sweep ? /setState\(r\.uid, s\.readingId \? 'confirm_pay' : 'idle'\)/.test(sweep) : false,
  'استیت بیرونِ PAY_STATES می‌رود و فالِ رزروشده حفظ می‌شود');
ok(sweep ? /catch \(e\)/.test(sweep) : false, 'خطای یک کاربر بقیه‌ی جارو را نمی‌شکند');
ok(sweep ? !/credit|deduct|balance/.test(sweep) : false, 'جارو به موجودی دست نمی‌زند');
ok(/sweepStuckPayFlows\(\);/.test(SRC), 'در بوت صدا زده می‌شود');
ok(/setInterval\(sweepStuckPayFlows,/.test(SRC),
  'و دوره‌ای هم اجرا می‌شود (کسی که ظهر برمی‌گردد تا ری‌استارتِ بعدی منتظر نمی‌ماند)');

/* ══ ۵) جارو باید کاملاً **ساکت** باشد ══════════════════════════════════
 *
 * 🐛 تا v3.78.0 این‌جا یک پنجره‌ی اطلاع‌رسانی بود (`STUCK_NOTICE_UNTIL`) که به هر کسی
 * که جارو آزادش می‌کرد پیامِ «مشکل حل شد» می‌داد. مالک آن را روی اکانتِ خودش، چند بار،
 * دریافت کرد و درست هم گرفت: هدف‌گیری‌اش از روزِ اول غلط بود. دیتای زنده: از ۲۱۹ نفری
 * که پیام گرفتند، **۱۸۲ نفر حتی یک بار هم پیامِ گارد را ندیده بودند** و فقط ۵ نفر
 * الگوی حلقه‌ی واقعی داشتند. معیارِ جارو («ردیفِ مرده + ۳۰ دقیقه پارک در استیتِ
 * پرداخت») رها کردنِ عادیِ صفحه‌ی بسته‌ها را توصیف می‌کند، نه گیر افتادن را.
 *
 * 📌 قاعده‌ی سراسری (تصمیمِ صریحِ مالک): **تشخیص و ترمیم می‌توانند خودکار باشند؛ ارتباط
 * با کاربر هرگز.** هر پیامِ ناخواسته یک تصمیمِ انسانیِ per مورد است.
 *
 * پس ادعاهای این بخش **معکوس**‌اند: هیچ مسیرِ ارسالی نباید برگردد. */
console.log('\n  — 🔇 جارو هیچ پیامی نمی‌فرستد:');
{
  ok(!/telegram\.send/.test(sweep || ''), 'خودِ حلقه‌ی جارو هیچ پیامی نمی‌فرستد');
  ok(!/L\.unstuck/.test(SRC), 'متنِ «مشکل حل شد» از index حذف شده');
  ok(!/sendUnstuckNotices/.test(SRC), 'فرستنده‌ی پیام حذف شده، نه فقط خاموش');
  ok(!/STUCK_NOTICE_UNTIL\s*=/.test(SRC), 'پنجره‌ی زمانیِ ارسال دیگر تعریف نمی‌شود');
  ok(!/markUnstuck\s*:/.test(SRC), 'statement مهرِ ارسال هم حذف شده');
  // ⚠️ ستون طبق بند ۲ج/۱ روی دیتابیس می‌ماند (افزایشی و بی‌ضرر) — حذفش ممنوع است.
  ok(/ALTER TABLE users ADD COLUMN pay_unstuck_at/.test(SRC),
    'ولی ستونِ `pay_unstuck_at` می‌ماند (بند ۲ج/۱: هرگز DROP)');
  // و همان متن در هیچ locale ای نمانده، وگرنه یک روز کسی دوباره صدایش می‌زند.
  for (const loc of ['fa', 'ru', 'pt', 'es']) {
    const src = readFileSync(`bots/tarot/locales/${loc}.js`, 'utf8');
    ok(!/unstuck:/.test(src), `locale ${loc} هم بلوکِ unstuck را ندارد`);
  }
}

/* ══ ۵ب) نیتِ معلق باید از انصرافِ گارد جانِ سالم به در ببرد ═════════════
 *
 * 🐛 باگِ گزارش‌شده‌ی مالک (۱۴۰۵/۰۶/۱۹): وسطِ فال دکمه‌ی «ذخایر الماس» را زد، گاردِ
 * «یه فالِ باز داری» آمد، «انصراف» را زد، و به‌جای کیفِ الماس پیامِ عمومیِ «همیشه
 * اینجام» گرفت.
 *
 * ریشه **مکانیزمِ نیت نبود** (درست کار می‌کرد و `showWallet` هم نیت را به هر سه گارد
 * می‌داد): `reading:cancel` و `rcancel:` یک `setSession(uid, null)`ِ بی‌قید می‌زدند که
 * `intent` را هم با خودش می‌برد، و `replyCanceled` چند خط بعد چیزی برای بازپخش
 * پیدا نمی‌کرد. `pay_exit` از اول درست بود چون جراحی عمل می‌کند.
 *
 * قاعده‌ی مالک: «اگه به واسطه‌ی یه درخواستِ دیگه انصراف زدم، بعدش باید همون چیزی
 * بیاد که به‌خاطرش انصراف زدم.» */
console.log('\n  — 🎯 نیتِ معلق بعد از انصراف:');
{
  // ۱) ساختاری: هیچ‌کدام از دو مسیرِ انصرافِ گارد نباید سشن را بی‌قید پاک کند.
  for (const [name, marker, end] of [
    ['reading:cancel', "bot.action('reading:cancel', async (ctx) => {", '\n});'],
    ['rcancel:', "bot.action(/^rcancel:(\\d+)$/, async (ctx) => {", '\n});'],
  ]) {
    const fn = bodyOf(marker, end) || '';
    ok(fn.length > 0, `هندلرِ ${name} پیدا شد`);
    ok(/clearSessionKeepIntent\(uid\)/.test(fn), `${name} از clearSessionKeepIntent رد می‌شود`);
    ok(!/setSession\(uid, null\)/.test(fn), `${name} دیگر setSession(uid, null)ِ بی‌قید ندارد`);
    ok(fn.indexOf('clearSessionKeepIntent') < fn.indexOf('replyCanceled'),
      `${name}: پاک‌سازی قبل از replyCanceled است (ترتیبِ واقعیِ اجرا)`);
  }
  // و `pay_exit` که از اول درست بود همچنان جراحی می‌ماند (کنترلِ ثبات).
  const exitFn = bodyOf("bot.action(/^pay_exit:(\\d+)$/, async (ctx) => {", '\n});') || '';
  ok(/delete s\.paymentId/.test(exitFn) && !/setSession\(uid, null\)/.test(exitFn),
    'pay_exit همچنان فقط paymentId را برمی‌دارد (الگوی مرجع)');

  // ۲) رفتاری: خودِ توابع از سورس بریده و روی یک سشنِ ساختگی **اجرا** می‌شوند.
  const src = [
    bodyOf('function setIntent(uid, key, arg = 0) {', '\n}'),
    bodyOf('function takeIntent(uid) {', '\n}'),
    bodyOf('function clearSessionKeepIntent(uid) {', '\n}'),
  ];
  ok(src.every(Boolean), 'هر سه تابعِ نیت از سورس برداشته شدند');
  const INTENT_TTL_S = Number((SRC.match(/const INTENT_TTL_S = ([^;]+);/) || [])[1]
    ?.replace(/[^\d*]/g, '').split('*').reduce((a, b) => a * Number(b), 1)) || 1800;
  const make = (clearBody) => {
    const store = { s: {} };
    const body = `
      // ⚠️ کپی، نه ارجاع: getSession واقعی هر بار JSON.parse می‌کند و یک **اسنپ‌شات**
      // می‌دهد. با ارجاعِ مشترک، patchSession داخلِ takeIntent همان آبجکتی را که تازه
      // خوانده شده هم عوض می‌کرد و ادعا به دلیلِ اشتباه قرمز می‌شد (نقصِ خودِ هارنس).
      const getSession = () => ({ ...store.s });
      const setSession = (uid, v) => { store.s = v || {}; };
      const patchSession = (uid, p) => { Object.assign(store.s, p); return store.s; };
      ${src[0]}}
      ${src[1]}}
      ${clearBody}}
      return { store, setIntent, takeIntent, clearSessionKeepIntent };`;
    return new Function('store', 'INTENT_TTL_S', body)(store, INTENT_TTL_S);
  };

  const good = make(src[2]);
  good.store.s = { readingId: 42, spreadId: 'love3', picks: [1, 2, 3] };
  good.setIntent(1, 'wallet');
  good.clearSessionKeepIntent(1);
  ok(good.store.s.readingId === undefined && good.store.s.picks === undefined,
    'فلوی فال واقعاً پاک می‌شود (کارِ اصلیِ انصراف انجام شده)');
  ok(good.takeIntent(1)?.key === 'wallet', '🎯 ولی نیت زنده می‌ماند، پس کیفِ الماس بعد از انصراف می‌آید');
  ok(good.takeIntent(1) === null, 'و یک‌بارمصرف است (بازپخشِ دوباره نمی‌شود)');

  /* 🗣 v3.84.0 — **شناسه‌ی** نیت هم باید از انصراف جان سالم به در ببرد.
   * بدونِ این، گفتگو بعد از انصراف روی «فالِ صفر» بازپخش می‌شد: نیت زنده، مقصد غلط —
   * دقیقاً همان کلاسِ باگی که این بلوک برای بستنش نوشته شد، یک لایه پایین‌تر. */
  good.store.s = { readingId: 42 };
  good.setIntent(1, 'chat', 777);
  good.clearSessionKeepIntent(1);
  const carried = good.takeIntent(1);
  ok(carried?.key === 'chat' && carried?.arg === 777,
    '🎯 شناسه‌ی نیت (کدام فال) هم حمل می‌شود، نه فقط خودِ نیت');
  // کنترلِ معکوس: حاملی که فقط `intent` را نگه دارد باید این ادعا را قرمز کند.
  const noArg = make('function clearSessionKeepIntent(uid) { const s = getSession(uid) || {}; setSession(uid, s.intent ? { intent: s.intent, intentAt: s.intentAt || 0 } : null);');
  noArg.setIntent(1, 'chat', 777);
  noArg.clearSessionKeepIntent(1);
  ok((noArg.takeIntent(1)?.arg || 0) === 0,
    'کنترلِ معکوس: حاملِ بدونِ شناسه واقعاً شناسه را گم می‌کند (پس ادعای بالا آینه‌ی خودش نیست)');

  // بدونِ نیت، سشن کاملاً خالی می‌شود (هیچ آشغالی جا نمی‌ماند).
  good.store.s = { readingId: 7 };
  good.clearSessionKeepIntent(1);
  ok(Object.keys(good.store.s).length === 0, 'بدونِ نیت، سشن کاملاً خالی می‌شود');

  // نیتِ کهنه (بیرونِ TTL) بازپخش نمی‌شود، حتی اگر حمل شده باشد.
  good.store.s = { intent: 'wallet', intentAt: Math.floor(Date.now() / 1000) - INTENT_TTL_S - 60 };
  good.clearSessionKeepIntent(1);
  ok(good.takeIntent(1) === null, 'نیتِ کهنه‌تر از TTL بازپخش نمی‌شود (صفحه‌ی بی‌ربطِ ساعت‌ها بعد)');

  // ۳) کنترلِ معکوس: با رفتارِ قبلی، همان سناریو واقعاً باگ می‌داد.
  const bad = make('function clearSessionKeepIntent(uid) { setSession(uid, null);');
  bad.store.s = { readingId: 42 };
  bad.setIntent(1, 'wallet');
  bad.clearSessionKeepIntent(1);
  ok(bad.takeIntent(1) === null,
    'کنترلِ معکوس: با setSession(uid, null)ِ قدیمی نیت گم می‌شد (همان باگِ گزارش‌شده)');

  // ۴) و مقصدِ همان نیت واقعاً در جدولِ بازپخش هست، وگرنه حمل‌کردنش بی‌فایده است.
  for (const k of ['WALLET', 'SUPPORT', 'DAILY', 'INVITE', 'LUCKY', 'READING', 'SETTINGS', 'CHAT']) {
    ok(new RegExp(`\\[INTENT\\.${k}\\]:`).test(SRC), `INTENT.${k} در جدولِ بازپخش ردیف دارد`);
  }
}

/* ══ ۶) کارِ بوت باید واقعاً لحظه‌ی بوت اجرا شود ═════════════════════════ */
// 🐛 باگی که این بخش از آن آمد: جارو مرج و دیپلوی شد ولی روی سرور **هیچ‌کس را آزاد
// نکرد**. علت در خودِ جارو نبود، در جای صدا زدنش بود: `bot.launch()` برای long polling
// داخلش `await startPolling()` دارد، پس `.then()` لحظه‌ی **توقفِ** ربات اجرا می‌شود نه
// شروعش. کارِ بوت یک ری‌استارت دیر می‌رسید و `setInterval`ها هیچ‌وقت تیک نمی‌زدند.
//
// این ادعا با **خودِ کتابخانه** سنجیده می‌شود، نه با خواندنِ سورس: اگر روزی telegraf
// معناشناسی‌اش را عوض کند، همین‌جا قرمز می‌شود.
console.log('\n  — 🚀 لحظه‌ی اجرای کارِ بوت:');
{
  const { Telegraf } = await import('../bots/tarot/node_modules/telegraf/lib/index.js');
  const t = new Telegraf('1:fake');
  t.telegram.getMe = async () => ({ id: 1, username: 'fake', is_bot: true });
  t.telegram.deleteWebhook = async () => true;
  let stopPolling;
  t.startPolling = () => new Promise((r) => { stopPolling = r; });
  let atStart = false, atStop = false;
  t.launch({ dropPendingUpdates: true }, () => { atStart = true; }).then(() => { atStop = true; });
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await tick();
  ok(atStart, 'قلابِ onLaunch در لحظه‌ی **شروع** صدا زده می‌شود');
  ok(!atStop, '…و promise ی launch هنوز resolve نشده (پس .then هنوز اجرا نشده)');
  stopPolling();                       // یعنی ربات متوقف شد
  await tick();
  ok(atStop, 'و .then فقط بعد از **توقفِ** ربات اجرا می‌شود — پس جای کارِ بوت نیست');
}

const boot = bodyOf('function onLaunched() {', '\n}');
ok(!!boot, 'کارِ بوت در تابعِ onLaunched جمع شده');
for (const fn of ['recoverOrphanReadings', 'sweepStuckPayFlows', 'sweepAbandonedPaidReadings']) {
  ok(boot ? boot.includes(`${fn}();`) : false, `${fn} در قلابِ بوت صدا زده می‌شود`);
}
ok(boot ? /setInterval\(sweepStuckPayFlows,/.test(boot) : false, 'و اینتروال هم همان‌جا ثبت می‌شود');
ok(boot ? /if \(bootDone\) return;/.test(boot) : false,
  'گاردِ یک‌بار هست (launch بعد از خطا دوباره تلاش می‌کند و اینتروال نباید چند بار ثبت شود)');
ok(/bot\.launch\(\{ dropPendingUpdates: true \}, onLaunched\)/.test(SRC),
  'قلاب به خودِ launch پاس داده شده');

/* ⚠️ **همین قرارداد برای voice2text هم لازم است، و آن‌جا پولی‌تر است.**
   `recoverOrphanFlows` اعتبارِ **کسرشده**ی فلوهای یتیم را برمی‌گرداند. روی `.then()`
   دو خرابی در دو جهتِ مخالف می‌ساخت: در مسیرِ کرش (`uncaughtException` مستقیم
   `process.exit(1)` می‌زند) هرگز اجرا نمی‌شد و اعتبار برنمی‌گشت؛ و در خاموشیِ عادی
   پیش‌شرطِ خودِ تابع («هیچ پردازشی در جریان نیست») نقض می‌شد چون هندلرهای در جریان
   هنوز می‌دوند ⇒ احتمالِ اعتبارِ دوبار.
   ادعا این‌جاست چون همین فایل **خودِ telegraf را می‌دواند** و معناشناسیِ زمان‌بندی را
   بالاتر اثبات کرده؛ گذاشتنش جای دیگر یعنی اثبات و ادعا از هم جدا بیفتند. */
{
  const v2t = readFileSync('bots/voice2text/index.js', 'utf8');
  const code = v2t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/bot\.launch\(\{ dropPendingUpdates: true \}, onLaunched\)/.test(code),
    'voice2text هم کارِ بوت را در قلابِ onLaunch می‌دهد، نه .then');
  ok(!/\.then\(\(\) => \{[^}]*recoverOrphanFlows/.test(code),
    'و ریفاندِ فلوهای یتیم دیگر روی .then آویزان نیست');
  ok(/let bootDone = false;/.test(code) && /if \(bootDone\) return;/.test(code),
    'و گاردِ یک‌بار دارد (launch بعد از خطا دوباره تلاش می‌کند)');
}
ok(!/bot\.launch\([\s\S]{0,80}\)\s*\n?\s*\.then\(/.test(SRC),
  'هیچ کارِ بوتی روی .then ی launch آویزان نیست');

/* ══ ۴) دکمه‌های قدیمی نمی‌میرند (بند ۲ج/۶) ═════════════════════════════ */
console.log('\n  — 🕰 سازگاری با دکمه‌های کهنه:');
for (const a of ['pay_cancel', 'pay_back']) {
  ok(SRC.includes(`bot.action(/^${a}:`), `الگوی ${a} هنوز ثبت است (دکمه‌ی کهنه در چت خطا نمی‌دهد)`);
}

console.log('\n  — 🧾 فقط انصرافِ صریح فاکتور را می‌کشد:');
{
  /* 🐛 باگِ واقعیِ ۱۴۰۵/۰۶/۱۵ (فاکتور #۵۵۴، ۶۰٬۰۰۰ تومان): `pay_back` فاکتورِ **صادرشده**
     را cancel کرد، بعد رسیدِ کاربر به هیچ فاکتوری نچسبید و بی‌صدا دور ریخته شد.
     قاعده‌ی تثبیت‌شده: هیچ مسیری جز انصرافِ صریح نباید فاکتوری را که `step='receipt'`
     دارد بکشد.

     ⚠️ این چک **هر دو جهت** را می‌سنجد، و جهتِ دوم از خودِ نوشتنِ همین فیکس آمد: نسخه‌ی
     اولش اشتباهاً روی `pay_exit` نشست، یعنی دکمه‌ی انصرافِ صریح هم گارد می‌گرفت و
     انصراف **غیرممکن** می‌شد — دقیقاً همان حلقه‌ی بی‌پایانِ تیکتِ #TRT-8976388520 از
     سمتِ مقابل. پس «گارد هست» به‌تنهایی کافی نیست؛ «گارد جای درستی هست» هم لازم است. */
  const body = (name) => {
    const at = SRC.indexOf(`bot.action(/^${name}:`);
    if (at < 0) return '';
    const next = SRC.indexOf('\nbot.action(', at + 10);
    return SRC.slice(at, next < 0 ? SRC.length : next);
  };
  const back = body('pay_back');
  const exit = body('pay_exit');
  ok(back && exit, 'هر دو هندلر پیدا شدند');

  ok(/const live = issuedInvoiceOf\(uid\)/.test(back),
    'pay_back روی **فاکتورِ زنده‌ی سشن** تصمیم می‌گیرد، نه هر ردیفی که روی دکمه نوشته شده');
  ok(/L\.errors\.openInvoice/.test(back), 'و به‌جای cancel پیامِ «یا تکمیل یا انصراف» می‌دهد');
  ok(/pay_exit:\$\{live\.id\}/.test(back),
    'دکمه‌ی انصراف به همان فاکتورِ **زنده** وصل است');
  ok(/p\.step !== 'receipt'/.test(back),
    'و ردیفِ صادرشده هرگز از این مسیر cancel نمی‌شود (فقط ردیفِ هنوز-بی‌بسته)');
  ok(!/const live = issuedInvoiceOf/.test(exit),
    'pay_exit این گارد را **ندارد** (انصرافِ صریح باید همیشه کار کند)');
  ok(/setPaymentStatus\.run\('canceled'/.test(exit), 'pay_exit هنوز واقعاً cancel می‌کند');

  /* ⚠️ **چرا ادعای «به همان فاکتور وصل است» به‌تنهایی دروغ بود.**
     نسخه‌ی اولِ این بخش فقط `callback_data` را می‌خواند و سبز می‌شد. ولی تصمیمِ واقعی
     داخلِ `pay_exit` گرفته می‌شود و آن عمداً `s.paymentId` را به عددِ روی دکمه **ترجیح
     می‌دهد**. یعنی اگر گارد روی یک ردیفِ کهنه نشان داده می‌شد، دکمه‌اش در عمل فاکتورِ
     زنده را می‌کشت — همان باگی که این PR قرار بود ببندد، از درِ پشتی.
     پس این ادعا حالا **رفتاری** است: هر دو سرِ زنجیره با هم سنجیده می‌شوند. */
  ok(/Number\(s\.paymentId\) \|\| parseInt\(ctx\.match\[1\], 10\)/.test(exit),
    'pay_exit فاکتورِ سشن را به عددِ دکمه ترجیح می‌دهد (رفتارِ عمدیِ «قفل را بشکن»)');
  ok(/pay_exit:\$\{live\.id\}/.test(back) && /const live = issuedInvoiceOf\(uid\)/.test(back),
    '⇒ و چون گارد فقط روی فاکتورِ سشن فعال می‌شود، این دو هرگز به دو ردیفِ متفاوت اشاره نمی‌کنند');
}

console.log('\n  — 📸 رسید هیچ‌وقت بی‌صدا دور ریخته نمی‌شود:');
{
  const at = SRC.indexOf("bot.on('photo'");
  const ph = at < 0 ? '' : SRC.slice(at, SRC.indexOf('\n});', at));
  ok(ph, 'هندلرِ عکس پیدا شد');
  ok(!/if \(!pend\) return;/.test(ph), 'returnِ خالیِ قدیمی (سیاه‌چاله) دیگر نیست');
  ok(/receiptNoInvoice/.test(ph), 'وقتی هیچ فاکتوری پیدا نشد، به کاربر گفته می‌شود');
  ok(/canceledReceiptPayment/.test(ph) && /revivePayment/.test(ph),
    'فاکتورِ لغوشده‌ی تازه هم بازیابی و **احیا** می‌شود (وگرنه approve بعداً بی‌صدا شکست می‌خورد)');
}

console.log('\n  — 🧾 «فاکتور باز داری» فقط وقتی فاکتوری هست:');
{
  /* 🐛 باگی که مالک گرفت (۱۴۰۵/۰۶/۱۵): پیامِ «یه فاکتور شارژِ باز داری — مبلغ رو واریز
     کن، رسید رو بفرست» وقتی می‌آمد که کاربر **هنوز بسته‌اش را انتخاب نکرده بود**. در آن
     لحظه ردیف `amount=0, step='amount'` است: نه مبلغی هست که واریز شود، نه رسیدی که
     برود. گارد روی *استیت* می‌نشست و `pay_amount` هم داخلِ PAY_STATES است.

     این بخش هر سه حالت را روی SQLite واقعی و با SQLِ **برداشته‌شده از سورس** اجرا
     می‌کند تا مدل نتواند از کد واگرا شود. */
  const insert = sqlOf('insertPayment');
  const claim = sqlOf('claimAmount');
  const setSt = sqlOf('setPaymentStatus');
  ok(!!(insert && claim && setSt), 'SQLهای لازم از سورس برداشته شدند');
  if (insert && claim && setSt) {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
      step TEXT NOT NULL DEFAULT 'amount', updated_at INTEGER NOT NULL DEFAULT 0,
      invoice_issued_at INTEGER);`);
    const UID = 6149194760;
    const pid = Number(db.prepare(insert).run(UID).lastInsertRowid);
    const rowOf = (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id);
    // همان تعریفِ تابعِ سورس، ولی روی این دیتابیس
    const issuedOf = (id) => {
      const p = rowOf(id);
      return (p && p.user_id === UID && p.status === 'pending' && p.step === 'receipt') ? p : null;
    };

    // ۱) کاربر روی صفحه‌ی بسته‌هاست: هیچ فاکتوری صادر نشده
    ok(!issuedOf(pid), 'قبل از انتخابِ بسته: فاکتوری صادر نشده');
    ok(!blockedNow({ state: 'pay_amount', invoiceIssued: !!issuedOf(pid) }),
      '✔️ گارد فعال **نمی‌شود** (باگِ مالک)');
    ok(blockedOld({ state: 'pay_amount', session: { paymentId: pid } }),
      '🐛 و با مدلِ قدیمی فعال **می‌شد** — یعنی این چک واقعاً باگ را می‌دید');

    // ۲) بسته انتخاب شد → فاکتور صادر شد
    ok(db.prepare(claim).run(30, pid).changes === 1, 'claimAmount فاکتور را صادر کرد');
    ok(rowOf(pid).step === 'receipt', 'و رکورد به step=receipt رفت');
    ok(blockedNow({ state: 'pay_receipt', invoiceIssued: !!issuedOf(pid) }),
      '✔️ حالا گارد فعال می‌شود (کارت‌به‌کارت)');

    // ۳) ریلِ استارز: استیت عمداً روی pay_amount می‌ماند ولی رکورد صادر شده
    ok(blockedNow({ state: 'pay_amount', invoiceIssued: !!issuedOf(pid) }),
      '✔️ فاکتورِ استارز هم محافظت می‌شود، با اینکه استیت هنوز pay_amount است');

    // ۴) بعد از لغو، دیگر فاکتوری نیست
    db.prepare(setSt).run('canceled', pid);
    ok(!blockedNow({ state: 'pay_receipt', invoiceIssued: !!issuedOf(pid) }),
      'بعد از لغو، گارد کاربر را زندانی نمی‌کند');

    // ۵) dropUnissuedPay فقط ردیفِ اثباتاً بی‌فاکتور را می‌کشد
    const drop = bodyOf('function dropUnissuedPay(uid) {', '\n}');
    /* ⚠️ ادعا **معکوس** شد (ساده‌سازیِ آگاهانه، بند ۹/۰). نسخه‌ی اولِ این تابع ردیفِ
       `amount=0` را cancel می‌کرد و ادعا همان را پین می‌کرد. ولی آن cancel هم زائد بود
       (`sweepDeadAmountRows` از قبل صاحبِ چرخه‌ی عمرِ این ردیف‌هاست) و هم مضر: ردیفِ
       «canceled با مبلغِ صفر» اثرانگشتِ حلقه‌ی #TRT-8976388520 است، و ساختنش در مسیرِ
       عادی آن سیگنالِ تشخیصی را برای همیشه بی‌معنا می‌کرد. حالا ادعا این است که این
       تابع **هیچ ردیفی را دست نمی‌زند**. */
    ok(!!drop, 'dropUnissuedPay پیدا شد');
    ok(drop ? !/setPaymentStatus|db\.prepare|stmts\./.test(drop) : false,
      'dropUnissuedPay هیچ ردیفِ دیتابیسی را دست نمی‌زند (فقط استیت)');
    ok(/sweepDeadAmountRows/.test(SRC),
      'و چرخه‌ی عمرِ ردیفِ رهاشده از قبل صاحب دارد: sweepDeadAmountRows');
    ok(drop ? /setState\(uid, s\.readingId \? 'confirm_pay' : 'idle'\)/.test(drop) : false,
      'و استیتِ کهنه را پاک می‌کند (وگرنه تایپِ بعدیِ کاربر «مبلغ نامعتبر» می‌گیرد)');
  }
}

console.log('\n  — 🧭 nav:menu گاردِ کپی‌شده ندارد:');
{
  /* گاردِ کپی‌شده دیر یا زود از اصل عقب می‌افتد. اثباتِ زنده: وقتی `blockDuringOpenPay`
     از `pay_cancel` به `pay_exit` رفت (فیکسِ حلقه)، کپیِ داخلِ `nav:menu` جا ماند و
     همان حلقه را از مسیرِ «بازگشت به منو» زنده نگه داشت. */
  /* ⚠️ بدنه از ۱۴۰۵/۰۶/۲۷ به `navToMenu` منتقل شد (پشته‌ی ناوبری هم از همان‌جا به منوی
     اصلی می‌رسد، پس دو کپی نمی‌خواهیم). ادعا **تیزتر** شد نه خفه: علاوه بر گارد، حالا
     می‌سنجد که خودِ `bot.action('nav:menu')` جز delegate هیچ منطقی ندارد. */
  const nav = bodyOf('async function navToMenu(ctx) {', '\n}\nbot.action');
  ok(!!nav, 'تک‌منبعِ navToMenu پیدا شد');
  ok(nav ? /blockDuringOpenPay\(ctx\)/.test(nav) : false,
    'بازگشت به منو همان تک‌منبعِ گارد را صدا می‌زند');
  const navAct = bodyOf("bot.action('nav:menu'", '\n});');
  ok(navAct ? /navToMenu\(ctx\)/.test(navAct) && !/setSession|cancelReading/.test(navAct) : false,
    "bot.action('nav:menu') فقط delegate می‌کند (هیچ کپیِ منطق)");
  ok(nav ? !/L\.errors\.openInvoice/.test(nav) : false,
    'و پیامِ گارد را خودش دوباره نمی‌سازد');
  ok(nav ? !/pay_cancel:/.test(nav) : false,
    'و به pay_cancel وصل نیست (همان باگی که حلقه را می‌ساخت)');
}

console.log('\n  — ♻️ سه رگرسیونی که خودِ همین PR نزدیک بود بسازد:');
{
  /* هر سه از یک ریشه‌اند: یک فیکس روی مسیرِ فارسی نوشته شد و اثرش روی مسیرهای دیگر
     (منوی کهنه، ریلِ استارز) دیده نشد. ادعاها این‌جا هستند تا اگر روزی گاردها
     ساده‌سازی شوند، همان اثرِ جانبی دوباره بی‌صدا برنگردد. */
  const pkg = (() => {
    const at = SRC.indexOf('bot.action(/^pkg:');
    const next = SRC.indexOf('\nbot.action(', at + 10);
    return at < 0 ? '' : SRC.slice(at, next < 0 ? SRC.length : next);
  })();
  ok(!!pkg, 'هندلرِ pkg پیدا شد');
  ok(!/if \(getState\(uid\) !== 'pay_amount'\) return;/.test(pkg),
    'تپ روی بسته دیگر به‌خاطرِ استیتِ پاک‌شده بی‌صدا نمی‌میرد');
  ok(!/if \(!s\.paymentId\) return ctx\.reply\(L\.errors\.stateLost/.test(pkg),
    'و پیامِ بی‌ربطِ «حالتت گم شد» هم نمی‌دهد');
  const guardAt = pkg.indexOf('blockDuringOpenReading(ctx, INTENT.WALLET)');
  const repairAt = pkg.indexOf('openPaymentRow(uid)');
  ok(guardAt >= 0 && repairAt > guardAt,
    '⭐ فالِ پرداخت‌شده پیش از ترمیمِ دکمه‌ی کهنه گارد می‌شود؛ سؤال هرگز رسید نمی‌شود');
  ok(/openPaymentRow\(uid\)/.test(pkg) && /setState\(uid, 'pay_amount'\)/.test(pkg),
    'به‌جایش ردیفِ تازه باز می‌کند و تپِ کاربر کامل می‌شود (نیت روشن است)');

  const photo = (() => {
    const at = SRC.indexOf("bot.on('photo'");
    return at < 0 ? '' : SRC.slice(at, SRC.indexOf('\n});', at));
  })();
  ok(/if \(starsRail\) return;/.test(photo),
    'ریلِ استارز اصلاً واردِ مسیرِ رسید نمی‌شود (نه پیامِ بی‌ربط، نه احیای فاکتور)');
  /* ⚠️ کامنت‌ها پاک می‌شوند وگرنه خودِ کامنتِ توضیحی (که `receiptNoInvoice` را نام
     می‌برد) قبل از گارد می‌افتد و ادعای «ترتیب» را الکی قرمز می‌کند. */
  const photoCode = photo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const starsAt = photoCode.indexOf('if (starsRail) return;');
  const receiptAt = photoCode.indexOf('receiptNoInvoice');
  ok(starsAt >= 0 && receiptAt > starsAt,
    'و این گارد **قبل از** هر منطقِ رسیدی است، نه بعدش');
}

console.log('\n  — ♻️ احیای فاکتورِ لغوشده به منبعِ شناسه وابسته نیست:');
{
  /* ناهماهنگیِ خودم، بعد از مرجِ #274 پیدا شد: احیا فقط زیرِ `if (!paymentId)` بود،
     یعنی فقط وقتی استیت چیزی نداده بود. اگر شناسه **از استیت** می‌آمد و همان فاکتور
     meanwhile لغو شده بود، احیا رد می‌شد و گاردِ زودهنگام پیامِ «از قبل بررسی شده»
     می‌داد — که برای یک فاکتورِ canceled نه درست است نه کمک‌کننده. دو مکانیزم که هر دو
     مالِ خودم بودند، دو حرفِ متفاوت می‌زدند. */
  const revive = sqlOf('revivePayment');
  ok(!!revive, 'statement احیا از سورس برداشته شد');
  if (revive) {
    for (const cond of ['user_id=?', "status='canceled'", "step='receipt'", 'created_at > unixepoch()-?']) {
      ok(revive.includes(cond), `شرطِ «${cond}» داخلِ خودِ UPDATE است، نه در جاوااسکریپت`);
    }
    const db2 = new Database(':memory:');
    db2.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', step TEXT NOT NULL DEFAULT 'receipt',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT 0);`);
    const mk = (st, ageSec, uid = 7, step = 'receipt') => Number(db2.prepare(
      "INSERT INTO payments (user_id, status, step, created_at) VALUES (?,?,?,unixepoch()-?)")
      .run(uid, st, step, ageSec).lastInsertRowid);
    const WIN = 12 * 3600;
    const tryRevive = (id, uid = 7) => db2.prepare(revive).run(id, uid, WIN).changes;

    ok(tryRevive(mk('canceled', 60)) === 1, 'فاکتورِ لغوشده‌ی تازه احیا می‌شود');
    ok(tryRevive(mk('canceled', WIN + 60)) === 0, 'ولی لغوشده‌ی کهنه (بیرونِ پنجره) نه');
    ok(tryRevive(mk('approved', 60)) === 0, 'و پرداختِ تأییدشده هرگز احیا نمی‌شود');
    ok(tryRevive(mk('canceled', 60, 7, 'amount')) === 0, 'و ردیفِ بی‌فاکتور (step=amount) هم نه');
    ok(tryRevive(mk('canceled', 60, 999)) === 0, 'و فاکتورِ کاربرِ دیگر هرگز (مالکیتِ رکورد)');
    db2.close();
  }

  const ph = (() => {
    const at = SRC.indexOf("bot.on('photo'");
    return at < 0 ? '' : SRC.slice(at, SRC.indexOf('\n});', at));
  })();
  ok(/if \(paymentId && reviveIfFresh\(paymentId\)\) recovered = true;/.test(ph),
    'شناسه‌ی آمده از **استیت** هم از مسیرِ احیا رد می‌شود');
  ok((ph.match(/reviveIfFresh\(/g) || []).length >= 2,
    'و هر دو مسیرِ شناسه از همان یک helper استفاده می‌کنند (نه دو کپیِ منطق)');
}

console.log(`\n${fail ? '❌' : '✅'} راهِ خروجِ پرداخت: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
