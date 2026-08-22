// 📣 اطلاع‌رسانیِ یک‌باره‌ی آپدیتِ v3.25.0 به کاربرانِ فعلیِ tarot.
//
// ⚠️ ترتیبِ اجرا اهمیتِ حیاتی دارد و قابلِ جابه‌جایی نیست:
//   ۱) `tools/coin-migration-tarot.mjs --apply`  ← موجودی‌ها الماس می‌شوند
//   ۲) `UX_V2_ADMIN_ONLY = false`                ← دنیای الماس برای همه باز می‌شود
//   ۳) همین اسکریپت                              ← پیام می‌رود
// اگر پیام زودتر برود، کاربر درباره‌ی رباتی می‌خواند که هنوز وجود ندارد و عددِ الماسی
// می‌بیند که در کیفش نیست. برای همین این‌جا گاردِ صریح داریم (پایین: `assertReady`).
//
// ── سه نسخه‌ی متن، دقیقاً همان سه دسته‌ای که مالک تعریف کرد ────────────────────
//   A) موجودی دارد **و پرداختِ واقعی داشته** → «با بالاترین نرخ تبدیل…» + عددِ الماس
//   B) موجودی دارد ولی هدیه‌بگیر بوده        → بدونِ «بالاترین نرخ» + عددِ الماس
//   C) موجودی‌اش صفر است                      → **هیچ** خطی درباره‌ی الماس و موجودی
// تفکیک از خودِ دیتا می‌آید نه از یک لیستِ دستی: کاربری که پرداختش به‌خاطرِ رسیدِ جعلی
// `reversed` شده دیگر پرداخت‌کننده حساب نمی‌شود (همان کاری که مهاجرت کرد)، و چون
// موجودی‌اش هم صفر شده خودکار در دسته‌ی C می‌افتد. یعنی هیچ آی‌دی‌ای این‌جا hardcode نیست.
//
// ── اجرا ─────────────────────────────────────────────────────────────────────
//   node tools/announce-tarot.mjs <dataDir>              ← گزارش + نمونه‌ی متن (dry-run)
//   node tools/announce-tarot.mjs <dataDir> --send       ← ارسالِ واقعی
//   env ANNOUNCE_ONLY="<id>,<id>"   ← فقط به این آی‌دی‌ها (تستِ زنده روی خودِ مالک)
//   env BOT_TOKEN=…                 ← از `.env` همان ربات خوانده می‌شود اگر ست نباشد
//
// ایمن: هر ارسالِ موفق در جدولِ `announce_log` ثبت می‌شود، پس اجرای دوباره **هیچ‌کس را
// دوبار پیام نمی‌دهد** (حتی اگر وسطِ کار قطع شود). کاربری که ربات را بلاک کرده رد می‌شود
// و کلِ اجرا را نمی‌شکند.
import { readdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));

export const ANNOUNCE_KEY = 'v3.25.0';
const COIN_VALUE = 10_000;

/* ═══════ متنِ پیام — تک‌منبع، و در چکِ CI ادعا می‌شود ═══════ */

// بدنه‌ی مشترکِ هر سه نسخه. ساختارِ خواسته‌ی مالک: کیفیتِ فال، کارت شانس، و بعد
// واحدِ جدید. عمداً **هیچ عدد و درصدی** درباره‌ی کاهشِ قیمت نمی‌آید («خودشان بروند
// ببینند»)؛ هر عددی که این‌جا بنویسیم برای بعضی کاربران دقیق نیست و اولین کسی که
// حسابش را بکند اعتمادش را از دست می‌دهد.
export const BODY = [
  '🔮 ربات تاروت آپدیت شد',
  '',
  'فال‌ها خیلی بهتر شدن. جواب‌ها روشن‌ترن و مستقیم به همون چیزی می‌رسن که پرسیدی.',
  '',
  '🎲 «کارت شانس» اضافه شد',
  'هر روز یک بار سه تا کارت انتخاب می‌کنی و پشتِ هرکدوم ممکنه الماس باشه.',
  '',
  '💎 واحد جدید: الماس',
  'کیف پولت حالا با الماس کار می‌کنه و قیمت هر فال خیلی خیلی کمتر شده.',
].join('\n');

// خطِ آخر. جمله‌ی «فرصت کمی براش مونده» با تصمیمِ مالک حذف شد و 👇 آمد تا چشم را به
// سه دکمه‌ی زیرِ پیام ببرد.
export const CTA = 'کارت شانس امروزت رو از دست نده 👇';

/** ارقامِ فارسی — همان قراردادی که کلِ ربات دارد (`fmt` در locales/fa.js).
 *  ⚠️ نسخه‌ی اول عددِ خام می‌گذاشت، یعنی کاربر در این پیام «7 الماس» می‌دید ولی یک تپ
 *  بعد داخلِ ربات «۷💎». همان عدد، دو شکل. */
const faNum = (n) => Number(n).toLocaleString('fa-IR');

/** دو خطِ موجودی. `paid=true` یعنی نسخه‌ی «بالاترین نرخ تبدیل». */
export const balanceLines = (coins, paid) => [
  paid
    ? 'موجودی قبلیت با بالاترین نرخ تبدیل، به الماس تبدیل شده.'
    : 'موجودی قبلیت هم به الماس تبدیل شده.',
  `موجودی ذخایر الماس: ${faNum(coins)} الماس`,
].join('\n');

/** متنِ کاملِ یک کاربر. `coins === 0` یعنی دسته‌ی C: هیچ خطی درباره‌ی موجودی. */
export function messageFor({ coins, paid }) {
  const parts = [BODY];
  if (coins > 0) parts.push(balanceLines(coins, paid));
  parts.push(CTA);
  return parts.join('\n\n');
}

/** سه دکمه، دقیقاً همان سه چیزی که در این آپدیت عوض شده (خواسته‌ی مالک). */
export const KEYBOARD = {
  inline_keyboard: [
    [{ text: '🎲 کارت شانس', callback_data: 'lucky_go' }],
    [{ text: '🔮 گرفتن فال جدید', callback_data: 'reading_go' }],
    [{ text: '💎 ذخایر الماس', callback_data: 'wallet_go' }],
  ],
};

/* ═══════ انتخابِ مخاطب ═══════ */

/** دسته‌ی هر کاربر **بعد از** مهاجرت. هیچ آی‌دی‌ای hardcode نیست. */
export function planFor(db, { only = [] } = {}) {
  const payers = new Set(
    db.prepare("SELECT DISTINCT user_id FROM payments WHERE status='approved'").all().map(r => r.user_id));
  const done = new Set(
    db.prepare('SELECT user_id FROM announce_log WHERE key=?').all(ANNOUNCE_KEY).map(r => r.user_id));
  const rows = db.prepare('SELECT telegram_id, name, username, balance FROM users').all();
  const plan = [];
  for (const u of rows) {
    const id = u.telegram_id;
    if (only.length && !only.includes(id)) continue;
    if (done.has(id)) continue;                       // قبلاً پیام گرفته
    // ⚠️ گردکردن با `round` نه `floor`: بعد از مهاجرت موجودی همیشه مضربِ COIN_VALUE
    // است، ولی اگر روزی نبود، `floor` می‌توانست عددی کمتر از واقعیت به کاربر نشان دهد.
    const coins = Math.round(u.balance / COIN_VALUE);
    plan.push({ id, name: u.name, username: u.username, coins, paid: payers.has(id) });
  }
  return plan;
}

export const groupOf = (p) => (p.coins <= 0 ? 'C' : p.paid ? 'A' : 'B');

/* ═══════ گاردِ «آیا اصلاً وقتش هست؟» ═══════ */

/** اگر ربات هنوز برای همه باز نشده یا مهاجرت اجرا نشده، ارسال متوقف می‌شود. */
export function assertReady(dataDir, src) {
  const problems = [];
  if (!/const UX_V2_ADMIN_ONLY = false/.test(src)) {
    problems.push('UX_V2_ADMIN_ONLY هنوز true است — کاربر دنیای الماس را نمی‌بیند');
  }
  if (!existsSync(path.join(dataDir, '.coin-migration-done'))) {
    problems.push('مهاجرتِ موجودی هنوز اجرا نشده — عددِ الماسِ پیام با کیفِ کاربر نمی‌خواند');
  }
  return problems;
}

/* ═══════ ارسال ═══════ */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ⌨️ کیبوردِ ماندگارِ نسل جدید — **دقیقاً** همان ترتیبِ `mainKeyboard` دنیای الماس.
 * چرا این‌جا هم لازم است: تلگرام کیبوردِ reply را روی گوشیِ کاربر تا **اولین جایگزینی**
 * نگه می‌دارد. مالک با اکانتِ تازه تست کرد: آپدیت آمده بود ولی منوی پایین همان نسل قبل
 * ماند تا وقتی `/start` زد. پس این پیامِ انبوه تنها فرصتی است که می‌توانیم منوی همه را
 * **یک‌جا** به‌روز کنیم؛ وگرنه هر کاربر باید تصادفاً به یکی از دو نقطه‌ی قراردادِ صدور
 * برسد که ممکن است هفته‌ها طول بکشد.
 * ⚠️ تلگرام در هر پیام فقط یک `reply_markup` می‌پذیرد و پیامِ اصلی سه دکمه‌ی inline دارد،
 * پس کیبورد روی یک پیامِ کوتاهِ دوم می‌رود. */
export const MENU_KEYBOARD = {
  keyboard: [
    [{ text: '🔮 فال بگیر' }],
    [{ text: '🎲 کارت شانس (استخراج الماس)' }],
    [{ text: '🎴 فال تک کارت امروز (رایگان)' }],
    [{ text: '💎 ذخایر الماس' }, { text: '📤 دعوت دوستان' }],
    [{ text: '💬 پشتیبانی' }],
  ],
  resize_keyboard: true,
};
export const MENU_NOTE = 'منوی پایین هم به‌روز شد 👇';

async function sendKeyboard(token, chatId) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: MENU_NOTE, reply_markup: MENU_KEYBOARD }),
  }).catch(() => {});
}

async function send(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: KEYBOARD }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.ok) return { ok: true };
  // ۴۲۹ = سقفِ نرخ. تلگرام خودش می‌گوید چند ثانیه صبر کن؛ همان را رعایت می‌کنیم.
  if (j.error_code === 429) return { ok: false, retryAfter: j.parameters?.retry_after || 5 };
  return { ok: false, fatal: j.description || 'unknown' };
}

const fa = (n) => n.toLocaleString('fa-IR');

async function run(file, { token, only, sendReal }) {
  const db = new Database(file);
  db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS announce_log (
    key TEXT NOT NULL, user_id INTEGER NOT NULL, sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (key, user_id))`);

  const plan = planFor(db, { only });
  const g = { A: 0, B: 0, C: 0 };
  for (const p of plan) g[groupOf(p)]++;

  console.log(`\n📄 ${path.basename(file)} — ${fa(plan.length)} گیرنده`);
  console.log(`   A) پرداخت‌کرده با موجودی (بالاترین نرخ): ${fa(g.A)}`);
  console.log(`   B) هدیه‌بگیر با موجودی:                  ${fa(g.B)}`);
  console.log(`   C) بدونِ موجودی (بدونِ خطِ الماس):        ${fa(g.C)}`);

  if (!sendReal) {
    for (const grp of ['A', 'B', 'C']) {
      const sample = plan.find(p => groupOf(p) === grp);
      if (!sample) continue;
      console.log(`\n────── نمونه‌ی نسخه‌ی ${grp} (کاربر ${sample.id}) ──────`);
      console.log(messageFor(sample));
    }
    console.log('\n   ℹ️ dry-run — هیچ پیامی نرفت (برای ارسال: --send)');
    db.close();
    return 0;
  }

  const log = db.prepare('INSERT OR IGNORE INTO announce_log (key, user_id) VALUES (?, ?)');
  let sent = 0, failed = 0;
  for (const p of plan) {
    const text = messageFor(p);
    let attempt = 0, ok = false;
    while (attempt < 3 && !ok) {
      const r = await send(token, p.id, text);
      if (r.ok) { ok = true; break; }
      if (r.retryAfter) { await sleep((r.retryAfter + 1) * 1000); attempt++; continue; }
      // بلاک‌شده / چت پاک‌شده: خطای دائمی است، تلاشِ دوباره بی‌فایده.
      failed++;
      break;
    }
    if (ok) {
      // پیامِ دومِ کوتاه که فقط حاملِ کیبوردِ جدید است. شکستش هرگز کلِ ارسال را
      // نمی‌شکند و در دفتر هم ثبت نمی‌شود (دفتر برای پیامِ اصلی است).
      await sendKeyboard(token, p.id);
      log.run(ANNOUNCE_KEY, p.id); sent++;
    }
    // ~۲۰ پیام در ثانیه: خیلی زیرِ سقفِ ۳۰تاییِ تلگرام برای پیامِ انبوه.
    await sleep(50);
    if ((sent + failed) % 25 === 0) console.log(`   … ${fa(sent)} فرستاده شد، ${fa(failed)} نرسید`);
  }
  console.log(`   ✅ ${fa(sent)} پیام رفت · ${fa(failed)} نرسید (بلاک/چت پاک‌شده)`);
  db.close();
  return sent;
}

/* ═══════ نقطه‌ی ورود ═══════ */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dataDir = process.argv[2];
  const sendReal = process.argv.includes('--send');
  if (!dataDir || !existsSync(dataDir)) { console.error(`❌ مسیر data نامعتبر: ${dataDir}`); process.exit(1); }

  const src = readFileSync(path.resolve('bots/tarot/index.js'), 'utf8');
  const problems = assertReady(dataDir, src);
  if (problems.length && sendReal) {
    console.error('❌ هنوز آماده‌ی ارسال نیست:');
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(2);
  }
  if (problems.length) console.log(`⚠️ (dry-run) ${problems.join(' · ')}`);

  let token = process.env.BOT_TOKEN || '';
  if (!token) {
    const envFile = path.resolve('bots/tarot/.env');
    if (existsSync(envFile)) {
      token = (readFileSync(envFile, 'utf8').match(/^BOT_TOKEN=(.+)$/m) || [])[1]?.trim() || '';
    }
  }
  if (!token && sendReal) { console.error('❌ BOT_TOKEN پیدا نشد'); process.exit(1); }

  const only = String(process.env.ANNOUNCE_ONLY || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const files = readdirSync(dataDir).filter(f => /^bot-[a-z-]+\.db$/.test(f));
  if (!files.length) { console.log('ℹ️ دیتابیسی پیدا نشد'); process.exit(0); }
  let total = 0;
  for (const f of files) total += await run(path.join(dataDir, f), { token, only, sendReal });
  if (sendReal) console.log(`\n🏁 تمام شد (${fa(total)} پیام).`);
}
