// چکِ CI: مسیرِ پرداختِ استارز باید در هر سه زبان **یک فلو و یک سبک** باشد.
//
// خواسته‌ی صریحِ مالک بعد از تستِ دستیِ رباتِ روسی (۱۴۰۵/۰۶/۱۲): «همین رو دقیقاً
// تعمیم بدیم به اون دوتا زبان دیگه، دقیقاً همین فلو و همین سبک، فقط با زبانِ خودشون.»
//
// پس `ru` این‌جا **مرجع** است، چون تنها زبانی است که مالک خودش سرتاسرِ فلوی پرداختش
// را روی گوشی دیده و تأیید کرده. `pt` و `es` باید ساختارِ همان را داشته باشند.
//
// ⚠️ چرا ساختار و نه متن: متن باید فرق کند (سه زبانِ متفاوت‌اند). چیزی که نباید فرق
// کند شکلِ تجربه است: چند بند، کدام ایموجی‌ها و به چه ترتیب، چند بار واحدِ پول
// می‌آید، و اینکه جمله با «:» تمام شود یا نه. یک ترجمه‌ی خوب که ایموجیِ 💎 را جا
// بیندازد یا سه بند را دو بند کند، «همان سبک» نیست حتی اگر معنی‌اش درست باشد.
//
// 🐛 دقیقاً همین را گرفت: خطِ اولِ صفحه‌ی بسته‌های اسپانیایی «از سه بسته‌ی زیر» را
// نمی‌گفت در حالی که روسی و پرتغالی می‌گفتند، و «pras» تنها انقباضِ خیلی محاوره‌ایِ
// مسیرِ پول بود در حالی که روسی همان‌جا خنثی است.
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const REF = 'ru';
const LOCALES = ['ru', 'pt', 'es'];
const PACK = { key: 'gold', emoji: '💠', coins: 30, toman: 60_000 };
const STARS = 250;

/* هر ردیف یک صفحه یا دکمه‌ی واقعیِ مسیرِ پول است، با همان آرگومان‌هایی که ربات
 * می‌دهد. اگر مسیرِ تازه‌ای اضافه شد، ردیفش هم این‌جا اضافه شود. */
const SURFACE = [
  ['صفحه‌ی بسته‌ها',        (L, c) => L.wallet.coinPacks(c)],
  ['پیامِ انتخابِ بسته',     (L, c) => L.wallet.coinPackChosen(PACK, c)],
  ['عنوانِ فاکتور',          (L)    => L.wallet.starsInvoiceTitle(PACK)],
  ['توضیحِ فاکتور',          (L)    => L.wallet.starsInvoiceDesc(PACK, STARS)],
  ['تأییدِ واریز',            (L, c) => L.wallet.coinsApproved(30, 45, c)],
  ['فاکتورِ منقضی',          (L)    => L.wallet.starsStaleInvoice],
  ['خطای موقتِ پرداخت',      (L)    => L.wallet.starsTempError],
  ['گاردِ فاکتورِ باز',       (L)    => L.errors.openInvoice],
  ['دکمه‌ی بسته',            (L, c) => L.buttons.coinPack(PACK, c, STARS)],
  ['دکمه‌ی انصراف',          (L)    => L.buttons.cancel],
  ['دکمه‌ی بازگشت',          (L)    => L.buttons.backOneStep],
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

/** اثرانگشتِ **شکلِ** یک متن، مستقل از زبانش.
 *
 * ⚠️ اثرانگشت **per بند** گرفته می‌شود، نه فقط روی کلِ رشته. نسخه‌ی اول همه چیز را
 * روی کلِ متن حساب می‌کرد و یک جهشِ عمدی از کنارش رد شد: «:» پایانیِ بندِ **اول** را
 * به «.» عوض کردم و چک سبز ماند، چون کلِ متن با «Telegram Stars ⭐» تمام می‌شود و
 * هیچ‌وقت به «:» ختم نمی‌شد. یعنی آن فیلد برای متنِ چندبندی هیچ چیزی نمی‌سنجید. */
const fingerprint = (t) => ({
  emoji: (t.match(EMOJI) || []).join(''),   // هم کدام‌ها، هم به چه ترتیب
  diamonds: (t.match(/💎/g) || []).length,
  stars: (t.match(/⭐/g) || []).length,
  numbers: (t.match(/\d+/g) || []).length,
  endsWithColon: /:\s*$/.test(t.trim()),
  bold: (t.match(/\*/g) || []).length,
  sentences: (t.match(/[.!?…]+/g) || []).length,
});
const shapeOf = (s) => {
  const t = String(s);
  const paras = t.split(/\n\n+/);
  return {
    paragraphs: paras.length,
    lines: t.split('\n').length,
    whole: fingerprint(t),
    perParagraph: paras.map(fingerprint),
  };
};

const loaded = {};
for (const l of LOCALES) {
  const L = (await import(`../bots/tarot/locales/${l}.js`)).default;
  loaded[l] = { L, cur: { on: true, value: 1, name: L.coinUnit.name, emoji: L.coinUnit.emoji } };
}

console.log('\n💳 هم‌شکلیِ مسیرِ پرداختِ استارز (مرجع: ru)\n');

for (const [label, render] of SURFACE) {
  const shapes = {};
  let broke = false;
  for (const l of LOCALES) {
    try { shapes[l] = shapeOf(render(loaded[l].L, loaded[l].cur)); }
    catch (e) { broke = true; ok(false, `${label}: «${l}» اصلاً رندر نشد`, e.message); }
  }
  if (broke) continue;
  const ref = JSON.stringify(shapes[REF]);
  const off = LOCALES.filter(l => l !== REF && JSON.stringify(shapes[l]) !== ref);
  ok(off.length === 0, `${label}: هر سه زبان یک شکل دارند`,
    off.length ? off.map(l => `${l}=${JSON.stringify(shapes[l])}  ru=${ref}`).join('\n     ') : '');
}

/* ── قواعدی که به مقایسه با مرجع ربطی ندارند و روی **هر سه** باید برقرار باشند ── */
console.log('');
for (const l of LOCALES) {
  const { L, cur } = loaded[l];
  const all = SURFACE.map(([, r]) => String(r(L, cur))).join('\n');

  // بند ۱۰ ریشه: خط تیره‌ی بلند امضای متنِ ماشینی است
  ok(!/—|–|--/.test(all), `[${l}] هیچ خط تیره‌ی بلندی در مسیرِ پول نیست`);

  /* ⚠️ بند ۶ج ریشه: واحدِ پول باید از همان منبعی بیاید که واقعاً کسر می‌شود. فاکتور
   * استارز کم می‌کند، پس متنش باید ⭐ داشته باشد و هرگز واحدِ تومانی. */
  const desc = String(L.wallet.starsInvoiceDesc(PACK, STARS));
  ok(desc.includes('⭐'), `[${l}] توضیحِ فاکتور واحدِ استارز را دارد`);
  ok(desc.includes(String(STARS)), `[${l}] توضیحِ فاکتور همان عددی را می‌گوید که کسر می‌شود`);
  ok(!desc.includes(String(PACK.toman)) && !/تومان|toman|tomán|туман/i.test(desc),
    `[${l}] هیچ اثری از قیمتِ تومانی در مسیرِ استارز نیست`);

  // دکمه‌ی بسته هم عددِ استارز را می‌گوید، وگرنه کاربر قیمت را فقط سرِ فاکتور می‌بیند
  const btn = String(L.buttons.coinPack(PACK, cur, STARS));
  ok(btn.includes(String(STARS)) && btn.includes('⭐'),
    `[${l}] دکمه‌ی بسته قیمتِ استارز را نشان می‌دهد`);

  /* بسته‌ی بدونِ قیمت هرگز نباید عددِ واحدِ دیگری چاپ کند: «هیچ عددی» بهتر از
   * «عددِ درست با واحدِ دروغ» است (باگِ ۱۴۰۵/۰۶/۱۱). */
  const noPrice = String(L.buttons.coinPack(PACK, cur, null));
  ok(!noPrice.includes('⭐') && !noPrice.includes(String(PACK.toman)),
    `[${l}] بدونِ قیمتِ استارز هیچ قیمتی چاپ نمی‌شود`);
}

/* ── ساختاری: فارسی هرگز نباید وارد این مقایسه شود ──
 * ریلِ فارسی کارت‌به‌کارت است و عمداً فلوی دیگری دارد (بند ۲و/۴). اگر روزی کسی
 * `fa` را به فهرست اضافه کند، این چک بی‌معنا می‌شود و باید صریح رد شود. */
const SRC = readFileSync('tools/check-pay-parity.mjs', 'utf8');
const list = SRC.match(/const LOCALES = \[([^\]]+)\]/)?.[1] || '';
ok(!/['"]fa['"]/.test(list), 'فارسی در فهرستِ مقایسه نیست (ریلش عمداً فرق دارد)');

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
