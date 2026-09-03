// چکِ CI برای ریفاندِ استارز و `/paysupport`.
//
// چرا این فایل بیشتر دربارهٔ **ترتیب** است تا دربارهٔ نتیجه: ریفاند دو طرف دارد که
// یکی‌شان (تلگرام) بیرونی و برگشت‌ناپذیر است و یکی (دفترِ ما) داخلی. اگر ترتیب برعکس
// شود، در حالتِ شکست کاربر **هم** الماسش را از دست می‌دهد **هم** استارزش را. با ترتیبِ
// درست بدترین حالت به نفعِ کاربر تمام می‌شود (بند ۹ ریشه).
import { readFileSync } from 'fs';
import { refundStars } from '../bots/tarot/starspay.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const SRC = readFileSync('bots/tarot/index.js', 'utf8');

/** بدنه‌ی یک `bot.command('x', ...)` تا `});` هم‌ترازِ خودش.
 *  ⚠️ نسخه‌ی اول یک `slice` با طولِ ثابت بود و به کدِ همسایه نشت می‌کرد: پنجره‌ی
 *  `/paysupport` تا داخلِ `/refund` می‌رسید و `isAdmin` آن‌جا را می‌دید. یعنی چک درباره‌ی
 *  دستوری قضاوت می‌کرد که اصلاً نگاهش نمی‌کرد. */
function commandBody(name) {
  const start = SRC.indexOf(`bot.command('${name}'`);
  if (start < 0) return '';
  const end = SRC.indexOf('\n});', start);
  return end < 0 ? SRC.slice(start) : SRC.slice(start, end + 4);
}
const PAY = { id: 7, user_id: 42, status: 'approved', charge_id: 'chg_abc', amount: 250, original_amount: 30, pkg: 'gold' };

/** تلگرامِ قلابی که هر فراخوانی را با ترتیب ثبت می‌کند. */
function fakeTelegram({ throws = null } = {}) {
  const calls = [];
  return {
    calls,
    callApi: async (method, params) => {
      calls.push({ method, params, at: calls.length });
      if (throws) throw new Error(throws);
      return true;
    },
  };
}

const psBodyLeak = (b) => /bot\.(command|action|on)\(/.test(b.slice(b.indexOf('{') + 1).replace(/bot\.command\('refund'/, ''));

console.log('\n⭐ ریفاندِ استارز\n');

/* ══ ۱) مسیرِ موفق: اول تلگرام، بعد دفتر ═════════════════════════════════ */
{
  const order = [];
  const tg = { calls: [], callApi: async (m, p) => { order.push('telegram'); tg.calls.push({ method: m, params: p }); return true; } };
  const res = await refundStars(tg, {
    getPayment: () => ({ ...PAY }),
    markRefunded: () => { order.push('ledger'); return { back: 30 }; },
    paymentId: 7,
  });
  ok(res.ok === true, 'پرداختِ معتبر ریفاند می‌شود');
  ok(order.join('>') === 'telegram>ledger',
    'اول تلگرام صدا زده می‌شود، بعد دفتر', `شد: ${order.join('>')}`);
  ok(tg.calls[0]?.method === 'refundStarPayment', 'متدِ درستِ Bot API صدا زده می‌شود');
  ok(tg.calls[0]?.params?.user_id === 42, 'شناسه‌ی کاربر از خودِ رکورد می‌آید، نه از ورودی');
  ok(tg.calls[0]?.params?.telegram_payment_charge_id === 'chg_abc',
    'شناسه‌ی شارژ همان است که موقعِ پرداخت ذخیره شد');
  ok(Object.keys(tg.calls[0]?.params || {}).length === 2, 'هیچ پارامترِ اضافه‌ای فرستاده نمی‌شود');
  ok(res.clawed === 30, 'مقدارِ کسرشده گزارش می‌شود');
}

/* ══ ۲) شکستِ تلگرام هرگز نباید دفتر را دست بزند ══════════════════════════
 * این مهم‌ترین ادعای فایل است: اگر استارز برنگشته، الماس هم نباید کسر شود. */
{
  let ledgerTouched = false;
  const res = await refundStars(fakeTelegram({ throws: 'CHARGE_ALREADY_REFUNDED' }), {
    getPayment: () => ({ ...PAY }),
    markRefunded: () => { ledgerTouched = true; return { back: 30 }; },
    paymentId: 7,
  });
  ok(res.ok === false, 'شکستِ تلگرام یعنی ریفاندِ ناموفق');
  ok(!ledgerTouched, '⭐ دفترِ اعتبار **اصلاً** لمس نمی‌شود وقتی استارز برنگشته');
  ok(String(res.reason).startsWith('telegram:'), 'علتِ شکست شفاف گزارش می‌شود');
  ok(String(res.reason).includes('CHARGE_ALREADY_REFUNDED'), 'پیامِ خودِ تلگرام حفظ می‌شود');
}

/* ══ ۳) گاردهای وضعیت — هیچ‌کدام نباید به تلگرام برسند ════════════════════ */
for (const [label, patch, why] of [
  ['پرداختِ در انتظار', { status: 'pending' }, 'status:pending'],
  ['پرداختِ ردشده', { status: 'rejected' }, 'status:rejected'],
  ['پرداختِ قبلاً برگشته', { status: 'reversed' }, 'status:reversed'],
  ['بدونِ شناسه‌ی شارژ (ریلِ کارت‌به‌کارت)', { charge_id: '' }, 'no_charge_id'],
]) {
  const tg = fakeTelegram();
  /* ⚠️ استاب **ثبت** می‌کند و throw نمی‌کند: نسخه‌ی اول throw می‌کرد و وقتی گارد را
   * برداشتم چک با یک استثنای مدیریت‌نشده مرد. درست بود (خروجی ۱) ولی گزارشِ خوانا نداد
   * و در لاگِ CI معلوم نمی‌شد کدام ادعا شکست. */
  let ledgerTouched = false;
  const res = await refundStars(tg, {
    getPayment: () => ({ ...PAY, ...patch }),
    markRefunded: () => { ledgerTouched = true; return { back: 30 }; },
    paymentId: 7,
  });
  ok(res.ok === false && res.reason === why, `${label} رد می‌شود`, `شد: ${JSON.stringify(res)}`);
  ok(tg.calls.length === 0, `${label}: هیچ فراخوانیِ تلگرامی نمی‌رود`);
  ok(!ledgerTouched, `${label}: دفتر لمس نمی‌شود`);
}
{
  const tg = fakeTelegram();
  const res = await refundStars(tg, { getPayment: () => null, markRefunded: () => null, paymentId: 999 });
  ok(res.ok === false && res.reason === 'not_found', 'پرداختِ ناموجود رد می‌شود');
  ok(tg.calls.length === 0, 'پرداختِ ناموجود: هیچ فراخوانیِ تلگرامی نمی‌رود');
}

/* ══ ۴) ریفاندِ قانونی کاربر را مجرم نمی‌کند ══════════════════════════════
 * `cardrev:` عمداً `setDistrust` دارد چون برای پرداختِ جعلی است. مسیرِ ریفاند
 * نباید آن را به ارث ببرد، وگرنه کاربری که فقط پولش را پس خواسته برای همیشه به
 * بازبینیِ دستی می‌افتد. */
{
  const body = commandBody('refund');
  ok(body.includes('refundStars('), '`/refund` از مسیرِ refundStars می‌رود');
  /* ⚠️ روی **فراخوانی** سنجیده می‌شود نه روی خودِ واژه: کامنتِ همین بلوک عمداً
   * می‌گوید «بدونِ setDistrust»، و ادعای متنیِ ساده روی همان کامنت قرمز می‌داد. */
  ok(!/setDistrust\s*[(.]/.test(body), 'ریفاندِ قانونی کاربر را بی‌اعتماد نمی‌کند');
  ok(/if \(!isAdmin\(ctx\.from\.id\)\) return;/.test(body), '`/refund` فقط ادمین است');
  ok(body.includes('markPaymentReversed'), 'گذارِ اتمیکِ approved→reversed حفظ شده (ضدِ دوبار ریفاند)');
  ok(!body.includes("bot.command('paysupport'") && !psBodyLeak(body),
    'پنجره‌ی استخراجِ بدنه به دستورِ همسایه نشت نمی‌کند');
}

/* ══ ۵) `/paysupport` در هر چهار زبان ═════════════════════════════════════ */
{
  const psBody = commandBody('paysupport');
  ok(SRC.includes("bot.command('paysupport'"), 'دستورِ /paysupport ثبت شده');
  ok(!psBody.includes('isAdmin'), '/paysupport برای همه‌ی کاربران است، نه فقط ادمین');
  ok(psBody.includes('L.support.payBody'), 'متنش از locale می‌آید، نه هاردکد');
  for (const loc of ['fa', 'ru', 'pt', 'es']) {
    const L = (await import(`../bots/tarot/locales/${loc}.js`)).default;
    const t = String(L.support.payBody('#TRT-42'));
    ok(t.includes('#TRT-42'), `[${loc}] کدِ پیگیری در متنِ /paysupport هست`);
    ok(!/—|–|--/.test(t), `[${loc}] بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)`);
    ok(t.length > 20 && t.length < 400, `[${loc}] طولِ متن منطقی است`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
