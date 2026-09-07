// 🔮 بازیابیِ یک‌باره‌ی فال‌هایی که پولشان کم شد ولی هرگز تحویل نشدند.
//
// ── مسئله ────────────────────────────────────────────────────────────────────
// رکوردی با `status='paid'` یعنی کاربر اندازه را انتخاب و پول را داده، کارت‌ها کشیده
// شده و خوانش هم ساخته شده، ولی گذارِ `paid → started` نیفتاده (ری‌استارتِ وسطِ کار یا
// مرگِ ربات). چنین رکوردی در هیچ توری نمی‌افتد:
//   · `recoverOrphanReadings`  شرطِ `llm_json=''` دارد  → نمی‌بیندش
//   · `resumableReading`       شرطِ `status='started'` دارد → کاربر نمی‌تواند ادامه دهد
//   · `sweepAbandonedPaidReadings` پشتِ `REFUND_ON_CANCEL=false` است → ریفاند هم نمی‌شود
// یعنی پول رفته، فال ساخته شده، و کاربر نه می‌گیردش نه پولش برمی‌گردد.
// و حالتِ دومِ همان خانواده، `status='started'`: نمایش شروع شد ولی وسطش قطع شد. آن یکی
// **قابلِ ادامه** است (`/start` دکمه‌ی ادامه می‌آورد) ولی کاربر خبر ندارد، و اگر استیتش
// عوض شده باشد دکمه‌های `next:` هم دیگر کار نمی‌کنند.
//
// ── قواعدِ صریحِ مالک ─────────────────────────────────────────────────────────
//   ۱) پیام فقط وقتی می‌رود که کاربر بعد از آن فالِ گیرکرده، فالِ دیگری **گرفته باشد**
//      یعنی واقعاً `delivered` شده. اگر بعدش دوباره تلاش کرده و آن یکی هم خراب شده،
//      همچنان پیام می‌گیرد — چون هنوز چیزی به دستش نرسیده. (چکِ CI این را گرفت: نسخه‌ی
//      اولِ قاعده «هر فالِ بعدی» را می‌شمرد و کسی را که دو بار پشتِ سرِ هم گیر کرده بود
//      کاملاً حذف می‌کرد، یعنی دقیقاً بدترین حالت را ساکت می‌گذاشت.)
//   ۱ب) هر کاربر حداکثر **یک** پیام، برای تازه‌ترین فالِ گیرکرده‌اش.
//   ۲) استثنا: کاربری که به پشتیبانی پیام داده (`TICKET_UID`) در هر صورت پیام و ریفاند
//      می‌گیرد؛ و چون فالِ گیرکرده‌اش آخرین نیست، متنش «یکی از فال‌هایی که» می‌گوید.
//   ۳) فال **خودکار فرستاده نمی‌شود**. پیام یک دکمه دارد و تا کاربر نزند هیچ‌چیز نمی‌آید.
//
// ── ترتیبِ مقدس ──────────────────────────────────────────────────────────────
// ریفاند **قبل از** ارسال ثبت می‌شود. اگر پیام نرسد (بلاک، قطعی شبکه) پول سرِ جایش است.
// عکسش یعنی کاربری که پیام گرفته ولی پولش برنگشته.
//
// ── اجرا ─────────────────────────────────────────────────────────────────────
//   node tools/recover-stuck-readings.mjs <dataDir>           ← گزارشِ کامل، هیچ ارسالی (پیش‌فرض)
//   node tools/recover-stuck-readings.mjs <dataDir> --send    ← ریفاند + ارسالِ واقعی
//   env RECOVER_ONLY="<id>,<id>"  ← فقط این آی‌دی‌ها (تستِ زنده روی خودِ مالک)
//
// اجرای دوباره بی‌خطر است: دفترِ `recover_log` هم ارسال و هم ریفاند را جدا مهر می‌زند،
// پس نه کسی دوبار پیام می‌گیرد نه دوبار الماس. کاربری که ربات را بلاک کرده رد می‌شود و
// کلِ اجرا را نمی‌شکند.
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** کاربری که تیکت زد (#TRT-8305812291): پیام و ریفاند در هر صورت. */
export const TICKET_UID = 8305812291;
/** برچسبِ دکمه‌ی CTA (خواسته‌ی صریحِ مالک). */
export const CTA_LABEL = '🔮 مشاهده فال';

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* ═══════ متنِ پیام — تک‌منبع، و در چکِ CI ادعا می‌شود ═══════ */
// دو نسخه فقط در **یک عبارت** فرق دارند و یک خطِ ریفاند. بقیه بایت‌به‌بایت یکی است.
const lead = (lastOne) => lastOne
  ? 'یه جایی از فال آخری که داشتی می‌گرفتی، احتمالاً یه اختلال توی ربات پیش اومد و فال کامل به دستت نرسید.'
  : 'یه جایی از یکی از فال‌هایی که داشتی می‌گرفتی، احتمالاً یه اختلال توی ربات پیش اومد و فال کامل به دستت نرسید.';

export function messageFor({ lastOne, refunded }) {
  return [
    'یه فال از تو پیش ما مونده 🌿',
    '',
    lead(lastOne) + ' کارت‌هات و خوانشت سر جاشون امن موندن و با زدنِ دکمه‌ی «' + CTA_LABEL + '» می‌تونی دوباره کاملش رو ببینی.',
    '',
    refunded
      ? `در ضمن هیچ الماسی ازت دوباره کم نمی‌شه، و ${fa(refunded)} الماسی هم که بابتش کم شده بود به ذخایرت برگشت ✅`
      : 'در ضمن هیچ الماسی ازت دوباره کم نمی‌شه ✅',
  ].join('\n');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** کیست که باید پیام بگیرد. خالص و بدونِ I/O تا چکِ CI بتواند مستقیم بسنجدش. */
export function planFrom(rows) {
  const byUser = new Map();
  for (const r of rows) {
    const isTicket = r.user_id === TICKET_UID;
    if (r.later > 0 && !isTicket) continue;        // قاعده ۱: بعدش فالِ تحویل‌شده دارد → بی‌خیال
    // قاعده ۱ب: یک پیام per کاربر، برای تازه‌ترین فالِ گیرکرده‌اش.
    const prev = byUser.get(r.user_id);
    if (prev && prev.id >= r.id) continue;
    byUser.set(r.user_id, r);
  }
  const plan = [];
  for (const r of byUser.values()) {
    const isTicket = r.user_id === TICKET_UID;
    plan.push({
      readingId: r.id,
      userId: r.user_id,
      price: r.price,
      status: r.status,
      lastOne: r.later === 0,                      // قاعده ۲: متنِ «یکی از فال‌ها»
      refund: isTicket ? r.price : 0,              // ریفاند فقط برای کاربرِ تیکت
    });
  }
  return plan.sort((a, b) => a.readingId - b.readingId);
}

async function send(token, chatId, text, readingId) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [[{ text: CTA_LABEL, callback_data: `rview:${readingId}` }]] },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.ok) return { ok: true };
  if (j.error_code === 429) return { ok: false, retryAfter: j.parameters?.retry_after || 5 };
  return { ok: false, fatal: j.description || 'unknown' };
}

export async function run(dbFile, { token, only, sendReal }) {
  const Database = require(path.resolve('bots/tarot/node_modules/better-sqlite3'));
  const db = new Database(dbFile);
  db.exec(`CREATE TABLE IF NOT EXISTS recover_log (
             reading_id  INTEGER PRIMARY KEY,
             refunded_at INTEGER NOT NULL DEFAULT 0,
             sent_at     INTEGER NOT NULL DEFAULT 0
           );`);

  const rows = db.prepare(`
    SELECT r.id, r.user_id, r.price, r.status,
           (SELECT COUNT(*) FROM readings a
              WHERE a.user_id=r.user_id AND a.id>r.id AND a.status='delivered') AS later
    FROM readings r
    WHERE r.status IN ('paid','started') AND r.llm_json<>'' AND r.cards_json<>'' AND r.price>0
    ORDER BY r.id`).all();

  let plan = planFrom(rows);
  if (only.length) plan = plan.filter(p => only.includes(p.userId));

  console.log(`\n📁 ${path.basename(dbFile)} — ${fa(rows.length)} فالِ گیرکرده، ${fa(plan.length)} نفر در برنامه`);
  const skipped = rows.length - planFrom(rows).length;
  if (skipped) console.log(`   ⏭ ${fa(skipped)} نفر رد شدند (بعدش فال دیگری گرفته‌اند)`);

  const ensureRow = db.prepare('INSERT OR IGNORE INTO recover_log (reading_id) VALUES (?)');
  const claimRefund = db.prepare('UPDATE recover_log SET refunded_at=unixepoch() WHERE reading_id=? AND refunded_at=0');
  const markSent = db.prepare('UPDATE recover_log SET sent_at=unixepoch() WHERE reading_id=?');
  const getLog = db.prepare('SELECT refunded_at, sent_at FROM recover_log WHERE reading_id=?');
  const credit = db.prepare('UPDATE users SET balance=balance+? WHERE telegram_id=?');
  const curStatus = db.prepare('SELECT status FROM readings WHERE id=?');

  let sent = 0;
  for (const p of plan) {
    const text = messageFor({ lastOne: p.lastOne, refunded: p.refund });
    const log = getLog.get(p.readingId);
    if (log?.sent_at) { console.log(`   ⏭ #${p.readingId} قبلاً پیام گرفته`); continue; }
    // وضعیتِ لحظه‌ای دوباره خوانده می‌شود: اگر بینِ گزارش و اجرا خودش گرفتتش، دست نمی‌خورد.
    const st = curStatus.get(p.readingId)?.status;
    if (st !== 'paid' && st !== 'started') { console.log(`   ⏭ #${p.readingId} دیگر نیمه‌تمام نیست (${st})`); continue; }

    if (!sendReal) {
      console.log(`\n   ── uid=${p.userId} · فال #${p.readingId} · ${p.status} · ${fa(p.price)}💎` +
        (p.refund ? ` · ریفاند ${fa(p.refund)}💎` : '') + (p.lastOne ? '' : ' · «یکی از فال‌ها»'));
      console.log(text.split('\n').map(l => '      ' + l).join('\n'));
      console.log(`      [${CTA_LABEL}] → rview:${p.readingId}`);
      continue;
    }

    ensureRow.run(p.readingId);
    // ⚠️ ترتیبِ مقدس: اول پول، بعد پیام.
    if (p.refund && claimRefund.run(p.readingId).changes) {
      credit.run(p.refund, p.userId);
      console.log(`   💎 ${fa(p.refund)} الماس به ${p.userId} برگشت`);
    }
    let attempt = 0;
    for (;;) {
      const res = await send(token, p.userId, text, p.readingId);
      if (res.ok) { markSent.run(p.readingId); sent++; console.log(`   ✅ uid=${p.userId} (فال #${p.readingId})`); break; }
      if (res.retryAfter && attempt < 3) { await sleep((res.retryAfter + 1) * 1000); attempt++; continue; }
      console.log(`   ⚠️ uid=${p.userId} نرسید: ${res.fatal || 'rate limit'}`);
      break;
    }
    await sleep(120);
  }
  if (!sendReal) console.log('\n   ℹ️ آزمایشی — هیچ پیامی نرفت و هیچ الماسی جابه‌جا نشد (برای اجرای واقعی: --send)');
  db.close();
  return sent;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dataDir = process.argv[2];
  const sendReal = process.argv.includes('--send');
  if (!dataDir || !existsSync(dataDir)) { console.error(`❌ مسیر data نامعتبر: ${dataDir}`); process.exit(1); }
  let token = process.env.BOT_TOKEN || '';
  if (!token) {
    const envFile = path.resolve('bots/tarot/.env');
    if (existsSync(envFile)) token = (readFileSync(envFile, 'utf8').match(/^BOT_TOKEN=(.+)$/m) || [])[1]?.trim() || '';
  }
  if (!token && sendReal) { console.error('❌ BOT_TOKEN پیدا نشد'); process.exit(1); }
  const only = String(process.env.RECOVER_ONLY || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
  // فقط دیتابیسِ فارسی: این بازیابی برای کاربرانِ همان ربات است.
  const total = await run(path.join(dataDir, 'bot-fa.db'), { token, only, sendReal });
  if (sendReal) console.log(`\n🏁 تمام شد (${fa(total)} پیام).`);
}
