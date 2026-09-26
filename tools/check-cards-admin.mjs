// چکِ CI برای مدیریتِ کارت‌ها داخلِ ربات (tarot، v3.123.0 — فازِ ۱bِ bots/tarot/PAYMENT-V2-PLAN.md).
//
// چرا: از این نسخه مالک از داخلِ ربات کارت اضافه/ویرایش/فعال‌وغیرفعال می‌کند و **شماره‌ای که
// او تایپ می‌کند همان شماره‌ای است که کاربران رویش پول واریز می‌کنند.** خرابی‌هایی که این چک
// جلویشان را می‌گیرد، همه گران و بی‌صدا:
//   ۱) یک رقمِ اشتباه‌تایپ‌شده ذخیره شود (پولِ کاربر به کارتِ ناموجود/دیگران).
//   ۲) کاربرِ عادی یا ادمینِ دیگر به این صفحه یا اکشن‌هایش برسد.
//   ۳) آخرین کارتِ عادیِ فعال غیرفعال یا سفید شود ⟵ فاکتورِ تازه بی‌کارت.
//   ۴) دوبار-تپِ «سفید/عادی» دو کارتِ تکراری بسازد، یا شماره‌ی تکراری پذیرفته شود.
//   ۵) کارتی حذف شود (فاکتورهای قدیمی به آن اشاره می‌کنند).
//
// هم ماژولِ خالصِ `cards-admin.js` مستقیم اجرا می‌شود، هم خودِ هندلرهای index.js از سورس
// بریده و روی SQLite در-حافظه با تلگرامِ قلابی **اجرا** می‌شوند (نه کپیِ منطق).
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import * as CA from '../bots/tarot/cards-admin.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function region(from, to, { includeTo = true } = {}) {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) { fail++; console.error(`  ❌ بخشِ «${from.slice(0, 40)}» در index.js پیدا نشد`); return ''; }
  return SRC.slice(a, includeTo ? b + to.length : b);
}

console.log('\n💳 مدیریتِ کارت‌ها\n');

/* ── ۱) ماژولِ خالص ─────────────────────────────────────────────────────────── */
console.log('اعتبارسنجی:');
ok(CA.normCardNumber('۶۲۱۹-۸۶۱۹ ۰۴۱۴-۵۴۰۵') === '6219861904145405', 'ارقامِ فارسی، خط تیره و فاصله نرمال می‌شوند');
ok(CA.normCardNumber('٥٠٢٢٢٩١٦١٢٢٨٢٢٣٤') === '5022291612282234', 'ارقامِ عربی هم');
ok(CA.normCardNumber('621986190414540') === null && CA.normCardNumber('62198619041454051') === null, '۱۵ و ۱۷ رقم رد می‌شوند');
ok(CA.luhnOk('6219861904145405') && CA.luhnOk('5022291612282234'), 'دو کارتِ واقعیِ فعلی از Luhn رد می‌شوند');
ok(!CA.luhnOk('6219861904145406') && !CA.luhnOk('6219861904145495'), 'یک رقمِ اشتباه ⟵ Luhn رد می‌کند');
{
  const r = CA.parseCardField('number', '6219 8619 0414 5406');
  ok(!r.ok && /اشتباه/.test(r.err), 'شماره‌ی ۱۶ رقمیِ نامعتبر با خطای «رقمِ اشتباه» رد می‌شود');
  ok(CA.parseCardField('number', '6219-8619-0414-5405').value === '6219861904145405', 'شماره‌ی معتبر نرمال‌شده ذخیره می‌شود');
}
ok(!CA.parseCardField('holder', 'ع').ok && !CA.parseCardField('holder', 'x'.repeat(41)).ok && CA.parseCardField('holder', 'علی رضایی').ok,
  'نامِ صاحب کارت: ۲ تا ۴۰ حرف');
ok(!CA.parseCardField('holder', 'علی\nرضایی').ok, 'ورودیِ چندخطی رد می‌شود');
ok(CA.parseCardField('bank', '-').value === '' && CA.parseCardField('bank', 'بلوبانک').value === 'بلوبانک', 'بانک: «-» یعنی خالی');
ok(CA.parseCardField('admin', '۱۰۰۲۵۷۹۷۵').value === 100257975 && !CA.parseCardField('admin', '@alireza').ok,
  'ادمین فقط آیدیِ عددی (ارقامِ فارسی هم)');
ok(CA.parseCardField('cap', '0').value === 0 && !CA.parseCardField('cap', '99999').ok && !CA.parseCardField('sort', '-1').ok,
  'سقف و ترتیب در بازه‌ی مجاز');
ok(!('number' in CA.EDITABLE), 'شماره‌ی کارت **قابلِ ویرایش نیست** (فاکتورهای باز به همین ردیف اشاره می‌کنند)');
ok(Object.values(CA.EDITABLE).every((c) => /^[a-z_]+$/.test(c)), 'ستون‌های ویرایش ثابت و بی‌خطرند (هیچ ورودی‌ای وارد SQL نمی‌شود)');

console.log('\nگاردِ کارتِ آخر:');
const R = (id, active = 1, kind = 'regular') => ({ id, active, kind });
ok(!CA.canDeactivate([R(1), R(2, 1, 'white')], 1), 'تنها کارتِ عادیِ فعال غیرفعال نمی‌شود');
ok(CA.canDeactivate([R(1), R(2)], 1), 'با دو کارتِ عادیِ فعال، یکی غیرفعال می‌شود');
ok(CA.canDeactivate([R(1), R(2, 1, 'white')], 2), 'کارتِ سفید همیشه غیرفعال می‌شود');
ok(CA.canDeactivate([R(1), R(2, 0)], 2), 'فعال‌کردن/غیرفعالِ دوباره‌ی کارتِ غیرفعال گارد ندارد');
ok(!CA.canMakeWhite([R(1), R(2, 1, 'white')], 1) && CA.canMakeWhite([R(1), R(2)], 1), 'تنها کارتِ عادیِ فعال سفید نمی‌شود');
{
  const txt = CA.listText([{ id: 1, active: 1, kind: 'regular', bank: 'بلوبانک', number: '6219861904145405', holder: 'علیرضا', admin_id: 7, sort: 1, daily_cap: 0 }], 7);
  ok(txt.includes('6219-8619-0414-5405') && txt.includes('(شما)') && !/—/.test(txt), 'فهرست شماره را چهارتا-چهارتا و ادمینِ مالک را «(شما)» نشان می‌دهد، بدونِ «—»');
}

/* ── ۲) ساختاری در index.js ───────────────────────────────────────────────────── */
console.log('\nساختاری:');
ok((CODE.match(/\bCARDS_ADMIN_ENABLED\b/g) || []).length === 2, 'پرچمِ خام دقیقاً دو بار است (تعریف + helper)');
ok(/const cardsAdminOn = \(uid\) => CARDS_ADMIN_ENABLED && !starsRail && Number\(uid\) === OWNER_ID;/.test(CODE),
  'دامنه: فقط مالک، فقط ریلِ کارت‌به‌کارت');
const kb = region('function mainKeyboard(uid) {', '\n}\n');
ok(/cardsAdminOn\(uid\) \? \[L\.buttons\.cardsAdmin\]/.test(kb), 'دکمه‌ی کیبورد فقط با cardsAdminOn ساخته می‌شود');
const caActions = [...CODE.matchAll(/bot\.action\((\/\^ca:|'ca:)[^\n]*/g)].map((m) => m[0]);
ok(caActions.length >= 8 && caActions.every((l) => /, caOnly\(async/.test(l)), `هر اکشنِ «ca:» پشتِ caOnly است (${caActions.length})`);
ok(/const caOnly = \(fn\) => async \(ctx\) => \{\n  if \(!cardsAdminOn\(ctx\.from\?\.id\)\) return/.test(SRC), 'caOnly اول دامنه را می‌سنجد');
ok(/bot\.hears\(allLabels\(l => l\.buttons\.cardsAdmin\), async \(ctx\) => \{\n  const uid = ctx\.from\.id;\n  if \(!cardsAdminOn\(uid\)\) return;/.test(SRC),
  'دکمه‌ی کیبورد برای غیرِمالک هیچ کاری نمی‌کند');
ok(/async function handleCardInput\(ctx, state, text\) \{\n  const uid = ctx\.from\.id;\n  if \(!cardsAdminOn\(uid\)\)/.test(SRC), 'ورودیِ متنی هم دوباره گارد دارد');
ok(/if \(state === 'card_add' \|\| state === 'card_edit'\) return await handleCardInput/.test(CODE), 'متنِ دو استیتِ کارت به handleCardInput می‌رود');
ok(!/DELETE FROM cards/i.test(CODE), 'هیچ مسیری کارت حذف نمی‌کند');
{
  const quiet = region('const KB_QUIET_STATES = new Set([', ']);');
  ok(/'card_add', 'card_edit'/.test(quiet), 'دو استیتِ ورودیِ کارت کیبوردِ تایپ را نمی‌کشند (KB_QUIET_STATES)');
}
ok(/const LEGACY_ADMINS_FULL = false;/.test(CODE), 'ادمین‌های بی‌کارت دیگر پیامِ رسید نمی‌گیرند (تصمیمِ مالک)');

/* ── ۳) رفتاری: خودِ هندلرها روی SQLite ─────────────────────────────────────── */
console.log('\nرفتاری:');
const OWNER = 1000001, OTHER = 2000002, NEWADMIN = 3000003;
const readers = region('let _cardSt = null;', '\nfunction defaultInvoiceCard()', { includeTo: false });
const schema = region('db.exec(`\n  CREATE TABLE IF NOT EXISTS cards', "VALUES ('cards_seed_1', unixepoch())\").run();\n})();")
  .replace('const LEGACY_CARD_NUMBER = LEGACY_CARD.number;', "const LEGACY_CARD_NUMBER = '6219861904145405';");
const handlers = region('const caOnly = (fn) =>', '/* ---------- هندلر متن', { includeTo: false });

function boot() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL DEFAULT 0)');
  const actions = [], hears = [], sent = [], events = [];
  const state = new Map(), sess = new Map();
  const bot = {
    action: (pat, fn) => actions.push([pat, fn]),
    hears: (_l, fn) => hears.push(fn),
    telegram: {
      sendMessage: async (to, text) => { sent.push({ to, text }); return {}; },
      getChat: async (id) => { if (id === NEWADMIN) throw new Error('chat not found'); return { id }; },
    },
  };
  const Markup = {
    inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
    button: { callback: (text, data) => ({ text, callback_data: data }) },
  };
  const env = {
    db, bot, Markup, CA, OWNER_ID: OWNER, L: { buttons: { cardsAdmin: '💳 کارت‌ها' } },
    allLabels: (f) => [f({ buttons: { cardsAdmin: '💳 کارت‌ها' } })],
    cardsAdminOn: (u) => Number(u) === OWNER,
    upsertUser: () => {}, blockDuringOpenPay: async () => false, blockDuringOpenReading: async () => false,
    blockDuringOpenLucky: async () => false,
    getState: (u) => state.get(u) || 'idle', setState: (u, s) => state.set(u, s),
    getSession: (u) => ({ ...(sess.get(u) || {}) }),
    patchSession: (u, p) => { const s = { ...(sess.get(u) || {}), ...p }; sess.set(u, s); return s; },
    track: (_d, u, e, pr) => events.push({ u, e, pr }), log: () => {}, logErr: () => {},
    editOrSend: async (ctx, text, rows) => ctx.reply(text, Markup.inlineKeyboard(rows)),
  };
  const body = `${readers}\n${schema}\n${handlers}\nreturn { cardSt, handleCardInput };`;
  const out = new Function(...Object.keys(env), body)(...Object.values(env));
  return { ...out, db, actions, hears, sent, events, state, sess };
}

function ctxFor(uid) {
  const replies = [], cbs = [];
  return {
    from: { id: uid }, replies, cbs,
    reply: async (text, extra) => { replies.push({ text, extra }); return {}; },
    answerCbQuery: async (t, o) => { cbs.push({ t, o }); },
    editMessageText: async (text) => { replies.push({ text }); },
    editMessageReplyMarkup: async () => {},
  };
}
async function tap(h, uid, data) {
  const ctx = ctxFor(uid);
  for (const [pat, fn] of h.actions) {
    const m = typeof pat === 'string' ? (pat === data ? [data] : null) : pat.exec(data);
    if (m) { ctx.match = m; await fn(ctx); return ctx; }
  }
  throw new Error(`no action for ${data}`);
}
async function type(h, uid, text) {
  const ctx = ctxFor(uid);
  await h.handleCardInput(ctx, h.state.get(uid), text);
  return ctx;
}

let h;
try { h = boot(); } catch (e) { fail++; console.error('  ❌ اجرای هندلرهای کارت شکست خورد:', e.message); }
if (h) {
  const count = () => h.db.prepare('SELECT COUNT(*) n FROM cards').get().n;
  ok(count() === 2, 'دو کارتِ سیدشده');

  // غیرِمالک: هیچ اکشنی اثر ندارد.
  const cOther = await tap(h, OTHER, 'ca:add');
  ok(cOther.cbs[0]?.t === '🔒' && !h.state.get(OTHER), 'غیرِمالک روی «افزودن» فقط 🔒 می‌گیرد و استیتش عوض نمی‌شود');
  await tap(h, OTHER, 'ca:t:1');
  ok(h.db.prepare('SELECT active FROM cards WHERE id=1').get().active === 1, 'غیرِمالک نمی‌تواند کارت را غیرفعال کند');

  // گاردِ کارتِ آخر: کارت ۱ تنها کارتِ عادیِ فعال است.
  const cLast = await tap(h, OWNER, 'ca:t:1');
  ok(cLast.cbs[0]?.o?.show_alert && h.db.prepare('SELECT active FROM cards WHERE id=1').get().active === 1,
    'تنها کارتِ عادیِ فعال غیرفعال نمی‌شود (پاپ‌آپِ توضیح)');
  await tap(h, OWNER, 'ca:k:1');
  ok(h.db.prepare('SELECT kind FROM cards WHERE id=1').get().kind === 'regular', 'تنها کارتِ عادیِ فعال سفید نمی‌شود');

  // افزودن: شماره‌ی نامعتبر ⟵ در همان مرحله می‌ماند.
  await tap(h, OWNER, 'ca:add');
  ok(h.state.get(OWNER) === 'card_add', 'افزودن استیتِ ورودی را باز می‌کند');
  const bad = await type(h, OWNER, '6219861904145406');
  ok(/❌/.test(bad.replies[0]?.text) && h.sess.get(OWNER).cardAdd.step === 'number', 'رقمِ اشتباه ⟵ خطا و ماندن در همان مرحله');
  const dup = await type(h, OWNER, '6219-8619-0414-5405');
  ok(/قبلاً ثبت شده/.test(dup.replies[0]?.text) && h.sess.get(OWNER).cardAdd.step === 'number', 'شماره‌ی تکراری رد می‌شود');
  // یک شماره‌ی معتبرِ Luhn می‌سازیم (رقمِ کنترل حساب می‌شود، نه حدس زده).
  let valid = '603799759919901';
  for (let d = 0; d < 10; d++) if (CA.luhnOk(valid + d)) { valid += d; break; }
  await type(h, OWNER, valid.replace(/(\d{4})(?=\d)/g, '$1 '));
  ok(h.sess.get(OWNER).cardAdd.step === 'holder', 'شماره‌ی معتبر ⟵ مرحله‌ی نام');
  await type(h, OWNER, 'زهرا احمدی');
  await type(h, OWNER, '-');
  await type(h, OWNER, String(NEWADMIN));
  ok(h.sess.get(OWNER).cardAdd.step === 'kind', 'بعد از ادمین ⟵ انتخابِ نوع با دکمه');
  const before = count();
  const addCtx = await tap(h, OWNER, 'ca:ak:regular');
  await tap(h, OWNER, 'ca:ak:regular'); // دوبار-تپ
  ok(count() === before + 1, 'دوبار-تپِ «عادی» فقط یک کارت می‌سازد');
  const nc = h.db.prepare('SELECT * FROM cards ORDER BY id DESC LIMIT 1').get();
  ok(nc.holder === 'زهرا احمدی' && nc.bank === '' && nc.admin_id === NEWADMIN && nc.kind === 'regular' && nc.active === 1 && nc.sort === 3,
    'کارتِ تازه با همه‌ی فیلدهای واردشده و ترتیبِ بعدی ثبت شد');
  ok(/استارت نکرده/.test(addCtx.replies.at(-1)?.text || ''), 'ادمینی که ربات را استارت نکرده ⟵ هشدارِ صریح به مالک');
  ok(h.state.get(OWNER) === 'idle', 'بعد از ثبت استیت آزاد می‌شود');
  ok(h.events.some((e) => e.e === 'card_changed' && e.pr.card_id === nc.id), 'رویدادِ card_changed ثبت شد');

  // حالا دو کارتِ عادیِ فعال داریم ⟵ غیرفعال‌کردنِ کارتِ ۱ مجاز است.
  await tap(h, OWNER, 'ca:t:1');
  ok(h.db.prepare('SELECT active FROM cards WHERE id=1').get().active === 0, 'با کارتِ عادیِ دوم، کارتِ ۱ غیرفعال می‌شود');
  await tap(h, OWNER, 'ca:t:1');

  // ویرایشِ ادمین.
  await tap(h, OWNER, 'ca:e:2:admin');
  const eBad = await type(h, OWNER, 'abc');
  ok(/❌/.test(eBad.replies[0]?.text) && h.state.get(OWNER) === 'card_edit', 'ورودیِ نامعتبرِ ویرایش ⟵ خطا، بدونِ نوشتن');
  await type(h, OWNER, String(OTHER));
  ok(h.db.prepare('SELECT admin_id FROM cards WHERE id=2').get().admin_id === OTHER && h.state.get(OWNER) === 'idle', 'ادمینِ کارت ویرایش شد');
  // انصراف.
  await tap(h, OWNER, 'ca:e:2:bank');
  await tap(h, OWNER, 'ca:x');
  ok(h.state.get(OWNER) === 'idle' && h.db.prepare('SELECT bank FROM cards WHERE id=2').get().bank === 'بانک پاسارگاد',
    'انصراف ⟵ هیچ چیز نوشته نشد');
  // تغییرِ مالک خودش به خودش پیام نمی‌دهد (تأییدِ روی صفحه کافی است).
  ok(!h.sent.some((m) => m.to === OWNER), 'تغییرِ خودِ مالک پیامِ اضافه به خودش نمی‌فرستد');
  // دکمه‌ی کهنه‌ی «نوع» بعد از پایانِ افزودن.
  const stale = await tap(h, OWNER, 'ca:ak:white');
  ok(/تمام شده/.test(stale.cbs[0]?.t || '') && count() === before + 1, 'دکمه‌ی کهنه‌ی انتخابِ نوع کارتی نمی‌سازد');
  // دکمه‌ی کهنه‌ی «نوع» (از افزودنِ قبلی) وسطِ یک افزودنِ **تازه** که هنوز شماره ندارد.
  await tap(h, OWNER, 'ca:add');
  const mid = await tap(h, OWNER, 'ca:ak:white');
  ok(/تمام شده/.test(mid.cbs[0]?.t || '') && count() === before + 1 && h.sess.get(OWNER).cardAdd?.step === 'number',
    'دکمه‌ی کهنه‌ی نوع وسطِ افزودنِ تازه کارتِ نیمه‌کاره نمی‌سازد و پیش‌نویس را نمی‌کشد');
  await tap(h, OWNER, 'ca:x');
}

console.log(`\n${pass} پاس، ${fail} خطا`);
if (fail) process.exit(1);
