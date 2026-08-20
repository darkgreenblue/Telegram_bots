// 💎 مهاجرتِ یک‌باره‌ی موجودیِ تومانی به الماس (تصمیمِ صریحِ مالک ۱۴۰۵/۰۵/۲۹).
//
// چرا لازم است: تا امروز `users.balance` تومانِ واقعی بود و هدیه‌ی خوش‌آمد ۳۰٬۰۰۰ تومان.
// در دنیای الماس همان ستون واحدِ الماس را نگه می‌دارد (`COIN_VALUE = 10٬000`، یعنی هر
// ۱۰٬۰۰۰ واحد = ۱ الماس) و هدیه‌ی خوش‌آمد ۵ الماس است. پس موجودیِ کاربرانِ فعلی باید با
// نسبتِ «۳۰٬۰۰۰ تومان = ۵ الماس» بازنویسی شود، وگرنه کاربری که ۳۰٬۰۰۰ تومان دارد در
// دنیای جدید ۳ الماس می‌بیند (یعنی هدیه‌اش از ۵ به ۳ آب رفته).
//
// ── فرمول (تک‌خطی، دقیقاً همان چیزی که مالک گفت) ──────────────────────────────
//   ۳۰٬۰۰۰ تومان ⟶ ۵ الماس   یعنی   هر ۶٬۰۰۰ تومان ⟶ ۱ الماس
//   الماس = ceil(موجودیِ تومانی / ۶٬۰۰۰)     ← گردکردن **به بالا**، به نفعِ کاربر
//   موجودیِ جدید = الماس × ۱۰٬۰۰۰
// مثال‌های خودِ مالک: ۳۰٬۰۰۰ ⟶ ۵ الماس · ۱۰٬۰۰۰ ⟶ ۱.۶۶ ⟶ **۲** الماس · ۰ ⟶ هیچ.
//
// ⚠️ نکته‌ی مهم: مالک هدیه‌ی خوش‌آمد و «بقیه‌ی موجودیِ غیرپرداختی» (دعوت، استریک، …) را
// جدا توضیح داد ولی برای هر دو **همان نسبت** را خواست. پس عملاً یک قاعده است و لازم
// نیست منشأِ هر ریال ردیابی شود؛ همین ساده‌بودن، خودش ضامنِ درستی است.
//
// ── چه کسانی مهاجرت می‌کنند و چه کسانی نه ────────────────────────────────────
//   ✅ کاربری که **هیچ پرداختِ تأییدشده‌ای** ندارد → خودکار تبدیل می‌شود.
//   ⛔️ کاربری که پرداختِ واقعی داشته → **دست نمی‌خورد** و در گزارش می‌آید تا مالک
//      تک‌تک تصمیم بگیرد (خواسته‌ی صریحش). پولِ واقعیِ کاربر با یک فرمولِ کلی جابه‌جا
//      نمی‌شود (بند ۹ ریشه: پول مقدس‌ترین چیزِ ریپوست).
//   ⛔️ موجودیِ صفر → کاری لازم نیست.
//
// ── اجرا ─────────────────────────────────────────────────────────────────────
//   node tools/coin-migration-tarot.mjs <dataDir>            ← گزارش (dry-run، پیش‌فرض)
//   node tools/coin-migration-tarot.mjs <dataDir> --apply    ← اعمالِ واقعی
//   env SET_USER="<id>=<الماس>,<id>=<الماس>"  ← موجودیِ دستیِ کاربرانِ پرداخت‌کرده،
//        دقیقاً همان اعدادی که مالک بعد از دیدنِ گزارش اعلام می‌کند. عدد **الماس** است،
//        نه تومان، تا هیچ ابهامِ واحدی نماند (درسِ باگِ ریال/تومانِ ۱۴۰۵/۰۵/۱۲).
//   env ZERO_USER="<id>,<id>"                 ← صفرکردنِ حسابِ دوستانِ تستی.
//
// امن: قبل از هر نوشتن یک بکاپِ سازگار (`VACUUM INTO`) کنارِ خودِ فایل می‌سازد، همه‌ی
// تغییرات در **یک تراکنش** انجام می‌شود، و هر تغییر یک رویدادِ `coin_migration` ثبت
// می‌کند تا حسابرسی‌پذیر بماند (بند ۹ ریشه: هر ریال ردپای DB دارد).
import { readdirSync, existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

/* ═══════ ثابت‌های قرارداد — تک‌منبع، و در چکِ CI با index.js تطبیق داده می‌شوند ═══════ */
export const COIN_VALUE = 10_000;        // ارزشِ داخلیِ هر الماس (واحدِ ستونِ balance)
export const OLD_WELCOME_TOMAN = 30_000; // هدیه‌ی خوش‌آمدِ دنیای تومانی
export const NEW_WELCOME_COINS = 5;      // هدیه‌ی خوش‌آمدِ دنیای الماس

/* ── دو نرخ، چون دو گروهِ کاملاً متفاوت‌اند (تصمیمِ صریحِ مالک ۱۴۰۵/۰۵/۳۰) ──────────
   • **هدیه‌بگیر** (خوش‌آمد، دعوت، استریک): نرخِ «۳۰٬۰۰۰ تومان = ۵ الماس»، یعنی هر
     ۶٬۰۰۰ تومان یک الماس. این عدد تصادفی نیست: هدیه‌ی خوش‌آمدِ قدیم دقیقاً ۳۰٬۰۰۰
     تومان بود و هدیه‌ی جدید دقیقاً ۵ الماس، پس کسی که هدیه‌اش را خرج نکرده **عیناً**
     همان چیزی را می‌گیرد که یک کاربرِ تازه امروز می‌گیرد. اگر این گروه هم با نرخِ
     ۱٬۵۰۰ تبدیل می‌شد، ۳۰٬۰۰۰ تومان می‌شد ۲۰ الماس، یعنی کاربرِ قدیمیِ هدیه‌بگیر
     چهار برابرِ کاربرِ جدید هدیه می‌گرفت.
   • **پرداخت‌کرده** (پولِ واقعی داده): نرخِ **۱٬۵۰۰ تومان = ۱ الماس**، یعنی ارزان‌ترین
     نرخِ فروشگاه (بسته‌ی جادویی). کسی که پولِ واقعی داده باید بهترین نرخِ ممکن را
     بگیرد، نه نرخِ هدیه.
   هر دو **به بالا** گرد می‌شوند (به نفعِ کاربر). */
export const TOMAN_PER_COIN_GIFT = OLD_WELCOME_TOMAN / NEW_WELCOME_COINS; // = ۶٬۰۰۰
export const TOMAN_PER_COIN_PAID = 1_500;                                 // بسته‌ی جادویی

/** تومانِ قدیمی ⟶ تعدادِ الماس، با نرخِ دلخواه. به بالا گرد می‌شود و هرگز منفی نیست. */
export const coinsAt = (toman, rate) => Math.max(0, Math.ceil(Math.max(0, toman) / rate));
export const coinsFor = (toman) => coinsAt(toman, TOMAN_PER_COIN_GIFT);
export const coinsForPaid = (toman) => coinsAt(toman, TOMAN_PER_COIN_PAID);
/** تومانِ قدیمی ⟶ مقدارِ جدیدِ ستونِ balance. */
export const newBalanceFor = (toman) => coinsFor(toman) * COIN_VALUE;
export const newBalanceForPaid = (toman) => coinsForPaid(toman) * COIN_VALUE;

/* ═══════ ورودی‌ها ═══════ */
const dataDir = process.argv[2];
const apply = process.argv.includes('--apply');

/** `"111=5,222=0"` ⟶ Map(id → الماس). ورودیِ خصمانه/غلط را رد می‌کند، نه اینکه حدس بزند. */
export function parseSetUser(raw) {
  const out = new Map();
  for (const part of String(raw || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)=(\d+)$/);
    if (!m) throw new Error(`قالبِ SET_USER نامعتبر: «${part}» (انتظار: <id>=<الماس>)`);
    out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}
export function parseIdList(raw) {
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean).map((s) => {
    if (!/^\d+$/.test(s)) throw new Error(`آی‌دیِ نامعتبر: «${s}»`);
    return Number(s);
  });
}

/* ═══════ خودِ مهاجرت ═══════ */
const fa = (n) => n.toLocaleString('fa-IR');

export function planFor(db, { setUser = new Map(), zeroUser = [], autoOff = false } = {}) {
  const payers = new Set(
    db.prepare("SELECT DISTINCT user_id FROM payments WHERE status='approved'").all().map(r => r.user_id));
  const rows = db.prepare('SELECT telegram_id, name, username, balance FROM users').all();
  const plan = [];
  for (const u of rows) {
    const id = u.telegram_id;
    // ⚠️ ترتیبِ این شرط‌ها خودش قرارداد است: صفرکردن بر همه چیز مقدم است (کاربرِ تستی
    // حتی اگر پرداختِ تأییدشده داشته باشد باید صفر شود، چون رسیدش جعلی بوده).
    let to, kind;
    if (zeroUser.includes(id)) { to = 0; kind = 'zero'; }
    else if (setUser.has(id)) { to = setUser.get(id) * COIN_VALUE; kind = 'manual'; }
    else if (!u.balance) { continue; }                     // چیزی برای تبدیل نیست
    else if (autoOff) { continue; }                        // اجرای دوباره: فقط تصمیم‌های صریح
    else if (payers.has(id)) { to = newBalanceForPaid(u.balance); kind = 'paid'; }
    else { to = newBalanceFor(u.balance); kind = 'gift'; }
    if (to === u.balance) continue;                        // بدونِ تغییر، ردیفی هم ثبت نمی‌شود
    plan.push({ id, name: u.name, username: u.username, from: u.balance, to, kind });
  }
  // پرداخت‌هایی که باید از **درآمد** بیرون بروند: فقط کاربرانِ صفرشده (رسیدِ جعلی).
  // وضعیتِ `reversed` عمداً انتخاب شده چون از قبل دقیقاً معنیِ «رسیدِ فیک، برگشت خورد»
  // را دارد و همه‌ی کوئری‌های درآمد روی `status='approved'` می‌نشینند، پس خودکار حذف
  // می‌شود بدونِ اینکه ردیف پاک شود (بند ۹ ریشه: هر ریال ردپای DB دارد).
  const voidPays = zeroUser.length
    ? db.prepare(`SELECT id, user_id, amount FROM payments WHERE status='approved' AND user_id IN (${zeroUser.map(() => '?').join(',')})`).all(...zeroUser)
    : [];
  return { plan, payers, voidPays };
}

function run(file, opts) {
  const db = new Database(file);
  db.pragma('busy_timeout = 5000');
  const { plan, payers, voidPays } = planFor(db, opts);

  console.log(`\n📄 ${path.basename(file)}`);
  console.log(`   نرخِ هدیه‌بگیر: هر ${fa(TOMAN_PER_COIN_GIFT)} تومان = ۱ الماس (${fa(OLD_WELCOME_TOMAN)} تومان = ${fa(NEW_WELCOME_COINS)} الماس)`);
  console.log(`   نرخِ پرداخت‌کرده: هر ${fa(TOMAN_PER_COIN_PAID)} تومان = ۱ الماس (ارزان‌ترین نرخِ فروشگاه)`);
  const gift = plan.filter(p => p.kind === 'gift');
  const paid = plan.filter(p => p.kind === 'paid');
  const manual = plan.filter(p => p.kind === 'manual');
  const zero = plan.filter(p => p.kind === 'zero');
  const coins = (b) => Math.round(b / COIN_VALUE);
  const sum = (a, f) => a.reduce((s, p) => s + f(p), 0);
  console.log(`   🎁 هدیه‌بگیر: ${fa(gift.length)} کاربر · ${fa(sum(gift, p => p.from))} تومان ⟵⟶ ${fa(sum(gift, p => coins(p.to)))} الماس`);
  console.log(`   💳 پرداخت‌کرده: ${fa(paid.length)} کاربر · ${fa(sum(paid, p => p.from))} تومان ⟵⟶ ${fa(sum(paid, p => coins(p.to)))} الماس`);
  if (manual.length) console.log(`   ✍️ موجودیِ دستی (اعلامِ مالک): ${fa(manual.length)} کاربر`);
  if (zero.length) console.log(`   🧹 صفر شد: ${fa(zero.length)} کاربر`);
  if (voidPays.length) {
    console.log(`   🚫 از درآمد حذف می‌شود (approved ⟶ reversed): ${fa(voidPays.length)} پرداخت · ${fa(sum(voidPays, p => p.amount))} تومان`);
  }
  const untouched = [...payers].filter(id => !plan.some(p => p.id === id));
  if (untouched.length) console.log(`   ℹ️ پرداخت‌کرده‌ی بدونِ تغییر (موجودیِ صفر یا از قبل درست): ${fa(untouched.length)}`);

  for (const p of plan) {
    const who = `${p.id}${p.username ? ` @${p.username}` : ''}${p.name ? ` (${p.name})` : ''}`;
    console.log(`   · ${p.kind.padEnd(6)} ${who}: ${fa(p.from)} تومان ⟶ ${fa(coins(p.to))} الماس`);
  }

  if (!apply) { console.log('   ℹ️ dry-run — چیزی نوشته نشد (برای اعمال: --apply)'); db.close(); return plan.length; }
  if (!plan.length && !voidPays.length) { console.log('   ℹ️ چیزی برای تغییر نیست'); db.close(); return 0; }

  const bak = `${file}.pre-coins.bak`;
  if (existsSync(bak)) rmSync(bak);
  db.prepare('VACUUM INTO ?').run(bak);
  console.log(`   💾 بکاپ: ${path.basename(bak)}`);

  const setBalance = db.prepare('UPDATE users SET balance=? WHERE telegram_id=?');
  const hasEvents = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").get();
  const logEvent = hasEvents
    ? db.prepare("INSERT INTO events (user_id, event, props) VALUES (?, 'coin_migration', ?)")
    : null;

  const voidPay = db.prepare("UPDATE payments SET status='reversed' WHERE id=? AND status='approved'");

  db.transaction(() => {
    for (const p of plan) {
      setBalance.run(p.to, p.id);
      logEvent?.run(p.id, JSON.stringify({ from: p.from, to: p.to, coins: coins(p.to), kind: p.kind }));
    }
    for (const v of voidPays) {
      voidPay.run(v.id);
      logEvent?.run(v.user_id, JSON.stringify({ kind: 'void_payment', payment_id: v.id, amount: v.amount }));
    }
  })();
  console.log(`   ✅ ${fa(plan.length)} ردیفِ موجودی${voidPays.length ? ` و ${fa(voidPays.length)} پرداخت` : ''} به‌روز شد`);
  db.close();
  return plan.length;
}

/* ═══════ نقطه‌ی ورود (هنگام import شدن در تست اجرا نمی‌شود) ═══════ */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (!dataDir || !existsSync(dataDir)) {
    console.error(`❌ مسیر data نامعتبر: ${dataDir}`);
    process.exit(1);
  }
  // ⚠️ گاردِ یک‌بارمصرف. این اسکریپت **idempotent نیست و نمی‌تواند باشد**: بعد از تبدیل،
  // موجودیِ جدید هم یک عددِ معتبر برای فرمول است، پس اجرای دوم آن را دوباره تبدیل می‌کند
  // (۳۰٬۰۰۰ ⟶ ۵ الماس = ۵۰٬۰۰۰ ⟶ ۹ الماس ⟶ …). یعنی یک اجرای تکراری **پولِ کاربران را
  // باد می‌کند**، و چون اسکریپت روزی از `deploy.yml` صدا زده می‌شود این حالت واقعی است.
  // تنها راهِ درست، فایلِ marker است؛ `--force` برای وقتی که آگاهانه دوباره لازم شد.
  const marker = path.join(dataDir, '.coin-migration-done');
  if (existsSync(marker) && !process.argv.includes('--force')) {
    console.log(`✅ مهاجرت قبلاً انجام شده (${marker}) — رد شد.`);
    console.log('   برای اعمالِ تصمیمِ موردیِ مالک روی کاربرانِ پرداخت‌کرده: همین دستور با --force و SET_USER/ZERO_USER.');
    process.exit(0);
  }
  const opts = { setUser: parseSetUser(process.env.SET_USER), zeroUser: parseIdList(process.env.ZERO_USER) };
  // با --force فقط تصمیم‌های صریحِ مالک اجرا می‌شوند، نه تبدیلِ خودکارِ دوباره.
  if (existsSync(marker) && !opts.setUser.size && !opts.zeroUser.length) {
    console.error('❌ --force بدونِ SET_USER/ZERO_USER یعنی تبدیلِ دوباره‌ی همه — متوقف شد.');
    process.exit(2);
  }
  const rerun = existsSync(marker);
  const files = readdirSync(dataDir).filter(f => /^bot-[a-z-]+\.db$/.test(f));
  if (!files.length) { console.log('ℹ️ دیتابیسی پیدا نشد — رد شد'); process.exit(0); }
  let total = 0;
  // در اجرای دوباره (`--force`) فقط تصمیم‌های موردیِ مالک اجرا می‌شوند؛ تبدیلِ خودکار
  // خاموش می‌شود تا موجودیِ از-قبل-تبدیل‌شده دوباره ضرب نشود.
  for (const f of files) total += run(path.join(dataDir, f), { ...opts, autoOff: rerun });
  if (apply) {
    writeFileSync(path.join(dataDir, '.coin-migration-done'), new Date().toISOString());
    console.log(`\n🏁 مهاجرت تمام شد (${fa(total)} ردیف). marker نوشته شد.`);
  }
}
