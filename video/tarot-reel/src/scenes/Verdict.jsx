// Verdict.jsx — جوابِ نهایی و اسلایدهای جمع‌بندی، در `VERDICT_BOX`.
//
// یک کامپوننت برای دو نقش، چون هندسه‌شان یکی است و فرقشان فقط وزنِ بصری است: `headline`
// جوابی است که کاربر برایش آمده (طلایی، بولد، بزرگ) و `closing` توضیحِ آرامِ بعدش است.
// دوتاکردنِ کامپوننت یعنی دو جای مستقل برای همان باکس، و اولین باری که باکس تیون شود یکی‌شان
// جا می‌ماند.
//
// نقطه‌های صفحه پایینِ باکس فقط برای جمع‌بندیِ چندتکه‌اند: بیننده باید بداند متن ادامه دارد،
// وگرنه اسلایدِ دوم مثل تکرار به نظر می‌رسد.

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { VERDICT_BOX, VERDICT_DOTS_H, COLORS, FONT } from '../layout.js';
import { LINE_HEIGHT } from '../text.js';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const Verdict = ({ scene }) => {
  const frame = useCurrentFrame();
  const isHeadline = scene.kind === 'headline';
  const pages = scene.pages ?? 0;
  const rise = interpolate(frame, [0, Math.max(2, scene.fadeFrames * 2)], [24, 0], CLAMP);

  const showDots = !isHeadline && pages > 1;
  const boxH = VERDICT_BOX.h - (showDots ? VERDICT_DOTS_H : 0);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: VERDICT_BOX.x,
          top: VERDICT_BOX.y,
          width: VERDICT_BOX.w,
          height: boxH,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${rise}px)`,
        }}
      >
        <div
          style={{
            direction: 'rtl',
            textAlign: 'center',
            fontFamily: FONT.family,
            fontWeight: isHeadline ? 700 : 400,
            fontSize: scene.fontSize,
            lineHeight: LINE_HEIGHT,
            color: isHeadline ? COLORS.gold : COLORS.ink,
            textShadow: isHeadline
              ? `0 0 42px rgba(233,196,123,0.35), 0 4px 22px ${COLORS.shadow}`
              : `0 3px 18px ${COLORS.shadow}`,
          }}
        >
          {scene.text}
        </div>
      </div>

      {showDots ? (
        <div
          style={{
            position: 'absolute',
            left: VERDICT_BOX.x,
            top: VERDICT_BOX.y + boxH,
            width: VERDICT_BOX.w,
            height: VERDICT_DOTS_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          {Array.from({ length: pages }, (_, j) => (
            <div
              key={`dot-${j}`}
              style={{
                width: j === scene.page ? 26 : 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: j === scene.page ? COLORS.gold : COLORS.goldDim,
                opacity: j === scene.page ? 0.95 : 0.4,
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};
