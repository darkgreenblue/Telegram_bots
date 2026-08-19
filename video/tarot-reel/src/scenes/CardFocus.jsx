// CardFocus.jsx — کپشنِ کارتِ فعال، زیرِ کارتِ بزرگ‌شده.
//
// کارت خودش اینجا نیست (لایه‌ی `<Cards>`). اینجا فقط نامِ کارت، برچسبِ ترتیبی و متنِ تفسیر است.
//
// چرا ورودِ کپشن به پروازِ کارت گره خورده: اگر متن هم‌زمان با شروعِ صحنه بیاید، بیننده وسطِ
// حرکتِ کارت شروع به خواندن می‌کند و هیچ‌کدام را درست نمی‌گیرد. کپشن دقیقاً وقتی می‌نشیند که
// کارت رسیده باشد. عددِ این لحظه از خودِ `motion.flyIn`ِ برنامه می‌آید نه از یک ثابتِ حدسی،
// پس با فشرده‌سازیِ زمان هم هماهنگ می‌ماند.

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { CAPTION_BOX, CAPTION_HEAD_H, captionTextBox, COLORS, FONT } from '../layout.js';
import { LINE_HEIGHT } from '../text.js';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const CardFocus = ({ scene }) => {
  const frame = useCurrentFrame();
  const span = Math.max(1, scene.durationInFrames - 1);
  const t = frame / span;

  const fi = Math.max(0.02, scene.motion?.flyIn ?? 0.2);
  const fo = Math.max(0.02, scene.motion?.flyOut ?? 0.2);
  const appear = interpolate(t, [fi * 0.55, fi * 0.98], [0, 1], CLAMP);
  const leave = interpolate(t, [1 - fo, 1 - fo * 0.35], [1, 0], CLAMP);
  const rise = interpolate(t, [fi * 0.55, fi * 0.98], [22, 0], CLAMP);

  const text = captionTextBox();

  return (
    <div style={{ opacity: appear * leave }}>
      <div
        style={{
          position: 'absolute',
          left: CAPTION_BOX.x,
          top: CAPTION_BOX.y,
          width: CAPTION_BOX.w,
          height: CAPTION_HEAD_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          direction: 'rtl',
          fontFamily: FONT.family,
        }}
      >
        <span style={{ fontSize: FONT.label, fontWeight: 700, color: COLORS.gold, whiteSpace: 'nowrap' }}>
          {scene.cardFa}
        </span>
        {scene.reversed ? (
          <span
            style={{
              fontSize: FONT.meta * 0.78,
              color: COLORS.goldDim,
              border: `1px solid ${COLORS.panelEdge}`,
              borderRadius: 999,
              padding: '2px 14px',
              whiteSpace: 'nowrap',
            }}
          >
            معکوس
          </span>
        ) : null}
        {scene.label ? (
          <span style={{ fontSize: FONT.meta * 0.86, color: COLORS.inkSoft, whiteSpace: 'nowrap' }}>
            {scene.label}
          </span>
        ) : null}
      </div>

      <div
        style={{
          position: 'absolute',
          left: text.x,
          top: text.y,
          width: text.w,
          height: text.h,
          display: 'flex',
          // بالاچین + کلیپِ سخت. قاعده‌ی «هیچ چیزی واردِ SAFE_BOX نمی‌شود» نباید به این
          // وابسته بماند که متنِ مدل همیشه کوتاه است: `fitFontSize` وقتی حتی کفِ فونت هم جا
          // نشود همان کف را برمی‌گرداند و متن سرریز می‌کند. با کف‌چینِ قبلی، آن سرریز به
          // سمتِ **بالا** می‌رفت و در حالتِ حدی تا داخلِ خودِ باکسِ استیکر بالا می‌آمد
          // (بازبینیِ خصمانه با تفسیرِ ۲۲۰۰ نویسه‌ای نشانش داد). حالا سرریز بریده می‌شود و
          // چون بالاچین است، بریدگی از **آخرِ** متن است نه اولش.
          alignItems: 'flex-start',
          overflow: 'hidden',
          justifyContent: 'center',
          transform: `translateY(${rise}px)`,
        }}
      >
        <div
          style={{
            direction: 'rtl',
            textAlign: 'center',
            fontFamily: FONT.family,
            fontWeight: 400,
            fontSize: scene.fontSize,
            lineHeight: LINE_HEIGHT,
            color: COLORS.ink,
            textShadow: `0 3px 18px ${COLORS.shadow}`,
          }}
        >
          {scene.text}
        </div>
      </div>
    </div>
  );
};
