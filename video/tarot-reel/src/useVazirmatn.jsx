// useVazirmatn.jsx — بارگذاریِ فونتِ فارسی، به شکلی که رندرِ کامل را نکشد.
//
// این فایل فقط به‌خاطرِ یک باگِ واقعی وجود دارد و منطقِ ظاهراً ساده‌اش عمدی است. ماجرا:
//
// روشِ اولِ قرارداد `loadFont`ِ `@remotion/fonts` در **سطحِ ماژول** بود. آن تابع اول
// `delayRender` می‌گیرد و بعد فایلِ فونت را از شبکه می‌خواند. مشکل جای فراخوانی است نه خودِ
// تابع: هندلی که هنگامِ **ارزیابیِ ماژول** گرفته شود (یعنی پیش از آنکه Remotion صفحه را کامل
// راه بیندازد) صفحه را قفل می‌کند و در آن حالت هیچ درخواستِ شبکه‌ای در این مرورگرِ هدلس کامل
// نمی‌شود. بن‌بست: هندل منتظرِ فونت، فونت منتظرِ پیشرویِ صفحه. ۲۸ ثانیه بعد Remotion با
// «delayRender پاک نشد» کلِ رندر را می‌کشد.
//
// چرا دیر پیدا شد: با `remotion still` هرگز دیده نمی‌شود، چون هر عکس زیرِ ۲۸ ثانیه تمام
// می‌شود. بدتر اینکه در همان حالت متن با **فونتِ جایگزینِ سیستمی** رندر می‌شد، پس عکس‌های
// تستی سالم به نظر می‌رسیدند. فقط رندرِ کاملِ ۱۷۱۱ فریمی باگ را نشان داد.
//
// راهِ درست همان کاری است که خودِ Remotion برای `<Img>` می‌کند: هندل **داخلِ کامپوننت** گرفته
// می‌شود، یعنی وقتی صفحه از قبل راه افتاده. آن‌جا شبکه پیش می‌رود و هندل درست آزاد می‌شود.
//
// دو نکته‌ی دیگر:
//   • `FontFace` از روی **بافر** ساخته می‌شود نه از روی url، تا خطای ۴۰۴ به‌جای یک انتظارِ
//     بی‌پایان، یک خطای صریح بدهد.
//   • شکستِ فونت **رندر را نمی‌کشد**: هر دو شاخه به `release` می‌رسند و متن با فونتِ سیستمی
//     رندر می‌شود. یک ویدیوی زشت از هیچ ویدیویی بهتر است.

import { useState, useEffect } from 'react';
import { delayRender, continueRender, staticFile } from 'remotion';

export const FONT_FAMILY = 'Vazirmatn';

const FACES = [
  ['fonts/Vazirmatn-Regular.woff2', '400'],
  ['fonts/Vazirmatn-Bold.woff2', '700'],
];

const registerFace = async (file, weight) => {
  const res = await fetch(staticFile(file));
  if (!res.ok) throw new Error(`font ${file}: HTTP ${res.status}`);
  const face = new FontFace(FONT_FAMILY, await res.arrayBuffer(), { weight, style: 'normal' });
  await face.load();
  document.fonts.add(face);
};

// یک‌بار per صفحه. Remotion هر تبِ رندر را جدا بالا می‌آورد، پس این کش per تب است و همان
// چیزی است که می‌خواهیم: هر تب فونتِ خودش را لازم دارد، ولی فقط یک‌بار.
let pending = null;
const ensureFonts = () => {
  if (!pending) pending = Promise.all(FACES.map(([f, w]) => registerFace(f, w)));
  return pending;
};

export const useVazirmatn = () => {
  const [handle] = useState(() => delayRender('font'));
  useEffect(() => {
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      continueRender(handle);
    };
    ensureFonts().then(release, release);
  }, [handle]);
};
