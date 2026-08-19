// Root.jsx — ثبتِ کامپوزیشن و بارگذاریِ فونت.
//
// دو نکته‌ی غیربدیهی اینجا:
//
// ۱) `durationInFrames` از `calculateMetadata` می‌آید نه از یک عددِ ثابت. طولِ ویدیو تابعِ
//    طولِ متنِ فال است و هر فال طولِ خودش را دارد؛ `buildPlan` همان تابعی است که این را حساب
//    می‌کند و سقفِ ۵۸ ثانیه را هم قفل می‌کند. عددِ ثابت اینجا یعنی یا ویدیو وسطِ متن قطع شود
//    یا چند ثانیه صفحه‌ی خالی ته ویدیو بماند.
//
// ۲) فونت در سطحِ ماژول بارگذاری می‌شود، **بدونِ** یک `delayRender` بیرونیِ اضافه. خودِ
//    `loadFont` داخلش یک `delayRender` می‌گیرد و بعد از `document.fonts.add` آزادش می‌کند،
//    پس انتظارِ لازم قبل از فریمِ صفر از قبل تأمین است.
//
//    ⚠️ چرا هندلِ بیرونی برداشته شد (باگِ واقعی، نه سلیقه): `continueRender` فقط وقتی
//    `clearTimeout` می‌زند که در همان لحظه محیط را «در حالِ رندر» ببیند. هندلی که در سطحِ
//    ماژول گرفته شود و در یک میکروتسکِ بعدی آزاد شود، از آرایه‌ی هندل‌ها حذف می‌شود ولی
//    تایمرِ ۲۸ثانیه‌ایش زنده می‌ماند و بعداً کلِ رندر را با «delayRender cleared نشد» می‌کشد.
//    با `remotion still` دیده نمی‌شود چون رندر پیش از ۲۸ ثانیه تمام می‌شود؛ در رندرِ کاملِ
//    ۱۷۱۱ فریمی دقیقاً سرِ فریمِ ۱۵۲ (همان ۲۸ ثانیه) رندر می‌مُرد.

import React from 'react';
import { Composition, staticFile } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { W, H, FPS } from './layout.js';
import { buildPlan } from './timing.js';
import { Reel } from './Reel.jsx';
import sampleProps from '../fixtures/props.sample.json';


const url = staticFile('fonts/Vazirmatn-Regular.woff2');
console.log('PROBE url', url, 'FontFace?', typeof FontFace, 'fonts?', typeof document.fonts);
fetch(url).then((r) => r.arrayBuffer()).then((b) => {
  console.log('PROBE fetch ok bytes', b.byteLength);
  const ff = new FontFace('ProbeFont', b);
  return ff.load().then(() => { document.fonts.add(ff); console.log('PROBE buffer-load RESOLVED'); },
                        (e) => console.log('PROBE buffer-load REJECTED', String(e)));
}).catch((e) => console.log('PROBE fetch FAILED', String(e)));

const ff2 = new FontFace('ProbeUrlFont', `url('${url}') format('woff2')`);
ff2.load().then(() => console.log('PROBE url-load RESOLVED'), (e) => console.log('PROBE url-load REJECTED', String(e)));
document.fonts.ready.then(() => console.log('PROBE fonts.ready RESOLVED'));


export const RemotionRoot = () => {
  return (
    <Composition
      id="TarotReel"
      component={Reel}
      width={W}
      height={H}
      fps={FPS}
      // فقط یک مقدارِ اولیه است تا Remotion قبل از اجرای calculateMetadata چیزی داشته باشد.
      durationInFrames={FPS}
      defaultProps={sampleProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: buildPlan(props).totalFrames,
      })}
    />
  );
};
