// چکِ CI برای پیشنهاددهنده‌ی فال (bots/tarot/reco.js).
// مهم‌ترین ادعا، خواسته‌ی صریح مالک است: «تحت هیچ شرایطی فالی که کاربر تازه تمام کرده
// دوباره پیشنهاد نشود» — حتی اگر محبوب‌ترین و هم‌حوزه‌ترین فالِ ربات باشد.
import { scoreSpreads, RECO } from '../bots/tarot/reco.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { fail++; console.error(`  ❌ ${msg}`); } };
const day = 86400;
const NOW = 1_800_000_000;

const SPREADS = [
  { id: 'yesno',  size: 2 },
  { id: 'three',  size: 3 },
  { id: 'love',   size: 5, focus: 'love' },
  { id: 'career', size: 5, focus: 'career' },
  { id: 'money',  size: 5, focus: 'money' },
  { id: 'choice', size: 5 },
  { id: 'celtic', size: 10 },
];
const ids = (arr) => arr.map(s => s.id);

console.log('\n▶ قفلِ سخت: فالِ همین لحظه هرگز پیشنهاد نمی‌شود');
{
  // three را هم محبوب‌ترین و هم هم‌حوزه می‌کنیم تا اگر قفل نباشد حتماً اول لیست بیاید
  const out = scoreSpreads(SPREADS, {
    currentType: 'three', focus: 'love', focusIds: new Set(['three', 'love']),
    popMap: new Map([['three', 1]]), lastByType: new Map(), nowS: NOW,
  });
  ok(!ids(out).includes('three'), 'فالِ جاری با وجود محبوبیت و هم‌حوزه بودن حذف شد');
  ok(out.length === RECO.SLOTS, `دقیقاً ${RECO.SLOTS} پیشنهاد برگشت`);
}

console.log('\n▶ قفلِ سخت: فالِ تازه‌گرفته‌شده در بازه‌ی cooldown');
for (const d of [0, 0.5, 1, 2, 2.9]) {
  const out = scoreSpreads(SPREADS, {
    currentType: null, popMap: new Map([['celtic', 1]]),
    lastByType: new Map([['celtic', NOW - d * day]]), nowS: NOW,
  });
  ok(!ids(out).includes('celtic'), `فالِ ${d} روز پیش پیشنهاد نشد (cooldown=${RECO.COOLDOWN_DAYS} روز)`);
}
{
  const out = scoreSpreads(SPREADS, {
    currentType: null, popMap: new Map([['celtic', 1]]),
    lastByType: new Map([['celtic', NOW - 40 * day]]), nowS: NOW, slots: 7,
  });
  ok(ids(out).includes('celtic'), 'بعد از ۴۰ روز دوباره وارد رقابت شد');
}

console.log('\n▶ سناریوی واقعیِ باگ: فالِ سه‌کارتی → کارت روز → پیشنهاد');
{
  // کاربر امروز three را کامل گرفته، بعد کارت روزِ رایگان می‌گیرد (currentType=null)
  const out = scoreSpreads(SPREADS, {
    currentType: null, focus: 'question', focusIds: new Set(),
    popMap: new Map([['three', 1], ['celtic', 0.4]]),
    lastByType: new Map([['three', NOW - 2 * 3600]]), nowS: NOW,
  });
  ok(!ids(out).includes('three'), 'همان فالی که ۲ ساعت پیش گرفته دوباره پیشنهاد نشد');
  ok(out.length === 3, 'سه جایگاه پر شد');
}

console.log('\n▶ پارامترِ حوزه‌ی تمرکز');
{
  const out = scoreSpreads(SPREADS, {
    currentType: null, focus: 'career', focusIds: new Set(['career']),
    popMap: new Map(), lastByType: new Map(), nowS: NOW,
  });
  ok(ids(out)[0] === 'career', 'فالِ هم‌حوزه اولِ لیست آمد');
}

console.log('\n▶ پارامترِ اقبال عمومی');
{
  const out = scoreSpreads(SPREADS, {
    currentType: null, popMap: new Map([['choice', 1]]), lastByType: new Map(), nowS: NOW,
  });
  ok(ids(out)[0] === 'choice', 'محبوب‌ترین فال (بدونِ تازگی و حوزه) اول آمد');
}

console.log('\n▶ جریمه‌ی تازگی هفته‌به‌هفته کم می‌شود');
{
  const rank = (d) => {
    const out = scoreSpreads(SPREADS, {
      currentType: null, popMap: new Map(), lastByType: new Map([['choice', NOW - d * day]]),
      nowS: NOW, slots: 7,
    });
    return ids(out).indexOf('choice');
  };
  const r4 = rank(4), r30 = rank(30), r120 = rank(120);
  ok(r4 >= r30 && r30 >= r120, `هرچه قدیمی‌تر، بالاتر (۴روز=${r4} ≥ ۳۰روز=${r30} ≥ ۱۲۰روز=${r120})`);
  ok(r4 === 6, 'فالِ ۴روزه ته لیست است');
}

console.log('\n▶ حالت‌های مرزی');
{
  ok(scoreSpreads([], {}).length === 0, 'لیستِ خالی → خروجی خالی');
  const all = new Map(SPREADS.map(s => [s.id, NOW]));
  ok(scoreSpreads(SPREADS, { lastByType: all, nowS: NOW }).length === 0,
    'اگر همه‌ی فال‌ها تازه گرفته شده‌اند، هیچ پیشنهادی نمی‌دهیم (به‌جای پیشنهادِ تکراری)');
  ok(scoreSpreads(SPREADS, { nowS: NOW, slots: 99 }).length === SPREADS.length, 'slots بزرگ‌تر از لیست نمی‌شکند');
  ok(!scoreSpreads([null, undefined, { size: 1 }, ...SPREADS], { nowS: NOW }).some(x => !x?.id),
    'ردیف‌های خراب نادیده گرفته می‌شوند');
}

console.log(`\n${fail ? '❌' : '✅'} نتیجه: ${pass} پاس، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
