// چکِ CI برای «وضعیت دعوت‌ها و هدیه‌ها» (tarot v3.40.0).
//
// این صفحه از یک تیکتِ واقعی آمد (#TRT-5997485087): کاربر چهار نفر دعوت کرده بود، پاداشش
// را هم گرفته و خرج کرده بود، ولی چون هیچ‌جا وضعیتش را نمی‌دید فکر کرد چیزی نگرفته.
// پس عددهای این صفحه باید **دقیق** باشند، وگرنه به‌جای بستنِ آن کلاسِ تیکت، بازش می‌کنند.
//
// خطرناک‌ترین ساده‌سازیِ ممکن این‌جا `done × referralBonusFor(uid)` است. روی دیتای زنده
// دو مبلغِ متمایزِ پاداش دیده شد (۱ و ۱۰)، یعنی آن فرمول به کاربرانِ قدیمی عددِ غلط
// می‌داد. برای همین «چقدر گرفتی» از دفترِ رویداد می‌آید و این فایل همان را قفل می‌کند.
import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');
const FA  = readFileSync('bots/tarot/locales/fa.js', 'utf8');

function sqlOf(name) {
  const re = new RegExp(`${name}\\s*:\\s*db\\.prepare\\(\\s*(['"\`])([\\s\\S]*?)\\1\\s*\\)`);
  const m = SRC.match(re);
  if (!m) { fail++; console.error(`  ❌ statement «${name}» پیدا نشد`); return null; }
  return m[2];
}
function bodyOf(marker, end = '\n};') {
  const from = SRC.indexOf(marker);
  if (from < 0) return null;
  const to = SRC.indexOf(end, from);
  return to < 0 ? null : SRC.slice(from, to);
}

console.log('\n👥 وضعیت دعوت‌ها و هدیه‌ها\n');

/* ══ ۱) خودِ SQL روی SQLite واقعی ═════════════════════════════════════════ */
const counts = sqlOf('refCounts');
const sum = sqlOf('refRewardSum');
if (counts && sum) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE referrals (id INTEGER PRIMARY KEY, referrer_id INTEGER, referee_id INTEGER,
      rewarded INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT,
      props TEXT NOT NULL DEFAULT '{}');
  `);
  const ME = 5997485087, OTHER = 999;
  // چهار دعوت مثل تیکتِ واقعی: یکی کامل شده، سه تا نه.
  db.prepare('INSERT INTO referrals (referrer_id, referee_id, rewarded) VALUES (?,?,1)').run(ME, 11);
  for (const r of [12, 13, 14]) {
    db.prepare('INSERT INTO referrals (referrer_id, referee_id, rewarded) VALUES (?,?,0)').run(ME, r);
  }
  // همسایه: هرگز نباید در عددهای ما بیاید.
  db.prepare('INSERT INTO referrals (referrer_id, referee_id, rewarded) VALUES (?,?,1)').run(OTHER, 21);
  const ev = db.prepare('INSERT INTO events (user_id, event, props) VALUES (?,?,?)');
  ev.run(ME, 'credit_granted', JSON.stringify({ amount: 5, kind: 'welcome' }));
  ev.run(ME, 'credit_granted', JSON.stringify({ amount: 1, kind: 'lucky' }));
  ev.run(ME, 'credit_granted', JSON.stringify({ amount: 10, kind: 'referral' }));
  ev.run(OTHER, 'credit_granted', JSON.stringify({ amount: 10, kind: 'referral' }));

  const c = db.prepare(counts).get(ME);
  const s = db.prepare(sum).get(ME);
  console.log('  — شمارش:');
  ok(Number(c.total) === 4, 'تعدادِ کلِ دعوت‌ها درست است (۴)');
  ok(Number(c.done) === 1, 'تعدادِ کامل‌شده‌ها درست است (۱)');
  ok(Number(c.total) - Number(c.done) === 3, 'تعدادِ در انتظار از همان دو عدد درمی‌آید (۳)');

  console.log('  — مبلغ:');
  ok(Number(s.s) === 10, 'فقط پاداشِ دعوت جمع می‌شود، نه هدیه‌ی خوش‌آمد و کارتِ شانس');

  // ⚠️ قلبِ این فایل: مبلغِ پاداش در تاریخِ ربات عوض شده و دیتای زنده هر دو را دارد.
  ev.run(ME, 'credit_granted', JSON.stringify({ amount: 1, kind: 'referral' }));
  db.prepare('INSERT INTO referrals (referrer_id, referee_id, rewarded) VALUES (?,?,1)').run(ME, 15);
  const s2 = db.prepare(sum).get(ME);
  const c2 = db.prepare(counts).get(ME);
  ok(Number(s2.s) === 11,
    'با دو مبلغِ متفاوت (۱ و ۱۰) جمعِ واقعی می‌آید، نه تعداد ضرب در پاداشِ امروز',
    `گرفت: ${s2.s}`);
  ok(Number(c2.done) * 10 !== Number(s2.s),
    'همین فیکسچر ثابت می‌کند فرمولِ «تعداد × پاداش» غلط می‌شد (۲۰ در برابر ۱۱)');

  console.log('  — همسایه:');
  const zero = db.prepare(counts).get(123456);
  ok(Number(zero.total) === 0 && Number(zero.done) === 0, 'کاربرِ بدونِ دعوت صفر می‌گیرد، نه خطا');
  ok(Number(db.prepare(sum).get(123456).s) === 0, 'مبلغِ کاربرِ بدونِ دعوت صفر است، نه null');
  ok(Number(db.prepare(counts).get(OTHER).total) === 1, 'دعوت‌های کاربرِ دیگر با هم قاطی نمی‌شوند');
  ok(Number(db.prepare(sum).get(OTHER).s) === 10, 'مبلغِ کاربرِ دیگر هم جدا می‌ماند');

  console.log('  — شکلِ دستورها:');
  ok(/WHERE\s+referrer_id\s*=\s*\?/i.test(counts), 'شمارش با referrer_id محدود شده');
  ok(/user_id\s*=\s*\?/i.test(sum), 'جمعِ مبلغ با user_id محدود شده');
  ok(/'referral'/.test(sum), "فقط رویدادِ kind=referral جمع می‌شود");
  db.close();
}

/* ══ ۲) صفحه نباید مبلغ را از روی تعداد بسازد ════════════════════════════ */
console.log('\n  — 🧮 منبعِ عدد:');
const statFn = bodyOf('const inviteStatusScreen = (uid) => {');
ok(!!statFn, 'inviteStatusScreen پیدا شد');
ok(statFn ? /stmts\.refRewardSum\.get\(uid\)/.test(statFn) : false,
  'مبلغ از دفترِ رویداد خوانده می‌شود');
ok(statFn ? !/referralBonusFor/.test(statFn) : false,
  'صفحه‌ی وضعیت هرگز از referralBonusFor استفاده نمی‌کند (وگرنه به کاربرِ قدیمی دروغ می‌گفت)');
ok(statFn ? /total - done/.test(statFn) : false, 'عددِ «در انتظار» از همان دو عدد درمی‌آید');

/* ══ ۳) متن: خطِ دوم فقط وقتی کسی در انتظار باشد ═════════════════════════ */
console.log('\n  — ✍️ متن:');
const txt = FA.slice(FA.indexOf('inviteStatus: (total, done, got, pending, cur)'));
ok(txt.startsWith('inviteStatus: ('), 'متنِ وضعیت در locale هست');
ok(/pending > 0/.test(txt.slice(0, 900)), 'خطِ دوم پشتِ شرطِ pending > 0 است');
ok(!/[—–]|--/.test(txt.slice(0, 700)), 'متن خط تیره‌ی بلند ندارد (بند ۱۰ ریشه)');

/* ══ ۴) چیدمان و رنگ ═════════════════════════════════════════════════════ */
console.log('\n  — 🎨 دکمه‌ها:');
const invFn = bodyOf('const inviteScreen = (uid) => {');
ok(!!invFn, 'inviteScreen پیدا شد');
ok(invFn ? /styled\(Markup\.button\.url\(L\.buttons\.share\([^)]*\), shareUrlFor\(uid\)\), 'success'\)/.test(invFn) : false,
  'دکمه‌ی دعوت سبز است (style=success)');
ok(invFn ? /Markup\.button\.callback\(L\.buttons\.inviteStatus, 'invite_stat'\)/.test(invFn) : false,
  'دکمه‌ی وضعیت زیرِ آن است و بی‌رنگ می‌ماند');
{
  const i = invFn ? invFn.indexOf('L.buttons.share') : -1;
  const j = invFn ? invFn.indexOf('L.buttons.inviteStatus') : -1;
  ok(i > -1 && j > -1 && i < j, 'ترتیب درست است: اول دعوت، بعد وضعیت');
}
// کاربرِ بدونِ دعوت هم باید دکمه را ببیند (خواسته‌ی صریحِ مالک): هیچ شرطی رویِ کیبورد نیست.
// ⚠️ نسخه‌ی اولِ این ادعا یک رجکسِ حدسی بود و جهشِ واقعی (spread + ternary) از کنارش رد شد.
// پس به‌جای ردکردنِ یک شکلِ خاص، کلِ بلوکِ کیبورد سنجیده می‌شود.
{
  const i = invFn ? invFn.indexOf('Markup.inlineKeyboard([') : -1;
  const kb = i > -1 ? invFn.slice(i, invFn.indexOf(']),', i)) : '';
  ok(!!kb, 'بلوکِ کیبوردِ صفحه‌ی دعوت پیدا شد');
  /* ⚠️ از ۱۴۰۵/۰۶/۲۷ یک ردیفِ **ناوبری** هم آخرش می‌آید (`navBackRow`) که عمداً
     شرطی است (لایه‌ی ۱ ⟵ منوی اصلی، لایه‌ی ۲ ⟵ یک قدم عقب). ادعا به همان نیتِ اصلی
     تنگ شد: **دو ردیفِ محتوایی** هیچ شرطی ندارند، پس کاربرِ صفر-دعوت هم می‌بیندشان. */
  const kbCore = kb.slice(0, kb.indexOf('navBackRow') > -1 ? kb.indexOf('// لایه‌ی ۱') : kb.length);
  ok(kbCore && !/[?]|&&/.test(kbCore),
    'دو ردیفِ محتوایی بدونِ هیچ شرط‌اند (کاربرِ صفر-دعوت هم دکمه را می‌بیند)',
    kb.replace(/\s+/g, ' '));
}

/* ══ ۵) همان پیام ادیت شود، و بن‌بست نباشد (بند ۹ب) ══════════════════════ */
console.log('\n  — 🧭 ناوبری:');
const stat = bodyOf("bot.action('invite_stat'", '\n});');
const back = bodyOf("bot.action('invite_back'", '\n});');
ok(!!stat && !!back, 'هر دو هندلر ثبت شده‌اند');
ok(stat ? /ctx\.editMessageText\(/.test(stat) && !/ctx\.reply\(/.test(stat) : false,
  'وضعیت همان پیام را ادیت می‌کند، پیامِ تازه نمی‌فرستد');
ok(back ? /ctx\.editMessageText\(/.test(back) : false, 'بازگشت هم همان پیام را ادیت می‌کند');
ok(back ? /inviteScreen\(ctx\.from\.id\)/.test(back) : false,
  'بازگشت از همان تک‌منبعِ صفحه‌ی دعوت رندر می‌کند (نه یک کپیِ دوم)');
ok(statFn ? /L\.buttons\.inviteBack, 'invite_back'/.test(statFn) : false,
  'صفحه‌ی وضعیت دکمه‌ی بازگشت دارد (هیچ صفحه‌ای بن‌بست نیست)');
// این دو مسیر فقط می‌خوانند؛ اگر روزی چیزی بنویسند باید آگاهانه باشد نه تصادفی.
for (const [n, b] of [['invite_stat', stat], ['invite_back', back]]) {
  ok(b ? !/\.(run|exec)\(/.test(b.replace(/upsertUser\(ctx\);/, '')) : false,
    `${n} هیچ نوشتنی در دیتابیس ندارد (فقط خواندن)`);
}

/* ══ ۶) مسیرِ پول دست‌نخورده ماند ════════════════════════════════════════ */
console.log('\n  — 💰 مسیرِ پاداش:');
const claim = sqlOf('setReferralRewarded') || '';
ok(/rewarded\s*=\s*0/.test(claim), 'ادعای پاداش اتمیک است (شرطِ rewarded=0 داخلِ خودِ UPDATE)', claim);
{
  const i = SRC.indexOf('stmts.setReferralRewarded.run(ref.id)');
  const j = SRC.indexOf('stmts.credit.run(refAmt, ref.referrer_id)');
  // ⚠️ از v3.69.0 مبلغ از `referralPayoutFor(uid, ref)` می‌آید نه `referralBonusFor(uid)`:
  // پاداش دیگر فقط تابعِ کاربر نیست، تابعِ **خودِ ردیفِ دعوت** هم هست (grandfathering).
  // این‌جا فقط ترتیب مهم است؛ درستیِ خودِ مبلغ را `check-referral-bonus.mjs` می‌سنجد.
  const k = SRC.indexOf('const refAmt = referralPayoutFor(ref.referrer_id, ref)');
  ok(i > -1 && j > -1 && i < j, 'ادعا قبل از واریز است (ضدِ پرداختِ دوباره)');
  ok(k > -1 && k < i, 'مبلغ قبل از ادعا حساب می‌شود');
  ok(SRC.indexOf('countDelivered.get(uid).c === 1') > -1,
    'شرطِ «اولین فالِ کاملِ دعوت‌شده» دست‌نخورده است');
}

console.log(`\n${fail ? '❌' : '✅'} وضعیت دعوت‌ها: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
