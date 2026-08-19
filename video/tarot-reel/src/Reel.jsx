// Reel.jsx — چیدنِ کلِ ویدیو.
//
// سه لایه از پایین به بالا، و ترتیبشان عمدی است:
//   ۱) `<Background>`  ثابت و بیرونِ صحنه‌ها، تنها چیزی که هرگز نمی‌بُرد.
//   ۲) `<Cards>`       پیوسته و بیرونِ صحنه‌ها (دلیلِ کاملش در `scenes/Cards.jsx`).
//   ۳) متنِ هر صحنه    داخلِ `Sequence` خودش، با فیدِ ورود و خروج.
//
// چرا متن بالای کارت‌هاست: در حالتِ عادی هیچ‌کدام روی هم نمی‌افتند (`CAPTION_BOX` زیرِ کارتِ
// بزرگ‌شده و `VERDICT_BOX` زیرِ ردیفِ بالاست). ولی اگر روزی یک باکس تیون شود و چند پیکسل
// همپوشانی بسازد، خواناییِ متن باید برنده باشد نه تصویر.
//
// «کراس‌فید» اینجا یعنی خروجِ نرمِ صحنه و ورودِ نرمِ صحنه‌ی بعد، بدونِ همپوشانیِ زمانی. عمداً
// همپوشانی نمی‌دهیم: دو متنِ فارسیِ نیمه‌شفاف روی یک باکس، در کسری از ثانیه به هم می‌ریزند و
// خوانده نمی‌شوند. چون کارت‌ها بیرونِ این فیدند، حرکت در همان لحظه پیوسته می‌ماند و مرزِ صحنه
// به‌جای «قطع»، «تعویضِ متن» دیده می‌شود.

import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from 'remotion';
import { FONT, COLORS, themeOf } from './layout.js';
import { buildPlan } from './timing.js';
import { Background } from './scenes/Background.jsx';
import { Cards } from './scenes/Cards.jsx';
import { Intro } from './scenes/Intro.jsx';
import { CardFocus } from './scenes/CardFocus.jsx';
import { Verdict } from './scenes/Verdict.jsx';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
// بازشدنِ اولِ ویدیو از سیاهی. فریمِ اولِ ریلز اگر ناگهانی روشن شود، در پخشِ خودکارِ اینستاگرام
// شبیهِ خطای بارگذاری دیده می‌شود.
const OPEN_FRAMES = 14;

const SceneBody = ({ scene }) => {
  if (scene.kind === 'intro') return <Intro scene={scene} />;
  if (scene.kind === 'focus') return <CardFocus scene={scene} />;
  return <Verdict scene={scene} />;
};

// فیدِ صحنه. بازه‌ها از خودِ برنامه می‌آیند؛ تنها کارِ اینجا مطمئن‌شدن از صعودی‌بودنِ ورودیِ
// `interpolate` است، چون یک صحنه‌ی خیلی کوتاه (نتیجه‌ی فشرده‌سازیِ شدید) بازه را وارونه می‌کند.
const SceneFade = ({ scene, children }) => {
  const frame = useCurrentFrame();
  const d = scene.durationInFrames;
  const f = Math.max(1, Math.min(scene.fadeFrames, Math.floor((d - 1) / 2)));
  const opacity = d < 4 ? 1 : interpolate(frame, [0, f, d - f, d], [0, 1, 1, 0], CLAMP);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Reel = (props) => {
  const plan = useMemo(() => buildPlan(props), [props]);
  const theme = themeOf(props.background);
  const cards = Array.isArray(props.cards) ? props.cards : [];
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg0,
        fontFamily: FONT.family,
        color: COLORS.ink,
      }}
    >
      <Background variant={props.background} />

      <Cards plan={plan} cards={cards} />

      {plan.scenes.map((scene) => (
        <Sequence key={scene.id} name={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
          <SceneFade scene={scene}>
            <SceneBody scene={scene} />
          </SceneFade>
        </Sequence>
      ))}

      <AbsoluteFill
        style={{
          backgroundColor: '#000',
          opacity: interpolate(frame, [0, OPEN_FRAMES], [1, 0], CLAMP),
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
