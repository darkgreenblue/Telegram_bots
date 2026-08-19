// Root.jsx — ثبتِ کامپوزیشن.
//
// `durationInFrames` از `calculateMetadata` می‌آید نه از یک عددِ ثابت. طولِ ویدیو تابعِ طولِ
// متنِ فال است و هر فال طولِ خودش را دارد؛ `buildPlan` همان تابعی است که این را حساب می‌کند و
// سقفِ ۵۸ ثانیه را هم قفل می‌کند. عددِ ثابت اینجا یعنی یا ویدیو وسطِ متن قطع شود یا چند ثانیه
// صفحه‌ی خالی ته ویدیو بماند.
//
// بارگذاریِ فونت عمداً اینجا (سطحِ ماژول) نیست؛ دلیلش با جزئیات در `useVazirmatn.jsx` است.

import React from 'react';
import { Composition } from 'remotion';
import { W, H, FPS } from './layout.js';
import { buildPlan } from './timing.js';
import { Reel } from './Reel.jsx';
import sampleProps from '../fixtures/props.sample.json';

export const RemotionRoot = () => {
  return (
    <Composition
      id="TarotReel"
      component={Reel}
      width={W}
      height={H}
      fps={FPS}
      // فقط یک مقدارِ اولیه است تا Remotion پیش از اجرای calculateMetadata چیزی داشته باشد.
      durationInFrames={FPS}
      defaultProps={sampleProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: buildPlan(props).totalFrames,
      })}
    />
  );
};
