// Intro.jsx — نوعِ فال و سؤال، بالای قاب.
//
// خودِ کارت‌ها اینجا نیستند؛ آن‌ها در لایه‌ی پیوسته‌ی `<Cards>` رندر می‌شوند (دلیلش در همان فایل).
//
// چرا عنوان محو می‌شود: `TITLE_BOX` و `TOP_ROW` هر دو از تنها فضای بالای `SAFE_BOX` استفاده
// می‌کنند و روی هم می‌افتند. تصادم واقعی نیست چون هم‌زمان نیستند: عنوان باید پیش از رسیدنِ
// کارت‌ها به ردیفِ بالا رفته باشد. پنجره‌اش (`TITLE_FADE`) کنارِ خودِ فازهای اینترو تعریف شده
// تا اگر ریتمِ اینترو تیون شد، این هم با آن جابه‌جا شود.

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { TITLE_BOX, TITLE_LABEL_H, titleTextBox, COLORS, FONT } from '../layout.js';
import { TITLE_FADE } from '../motion.js';
import { LINE_HEIGHT } from '../text.js';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const Intro = ({ scene }) => {
  const frame = useCurrentFrame();
  const span = Math.max(1, scene.durationInFrames - 1);
  const t = frame / span;

  const main = scene.question || scene.spreadFa;
  // برچسبِ نوعِ فال وقتی سؤال هست معنا دارد؛ اگر سؤالی نبود خودِ نوعِ فال متنِ اصلی است و
  // تکرارش بالای خودش فقط شلوغی است.
  const label = scene.question ? scene.spreadFa : '';

  const gone = interpolate(t, TITLE_FADE, [1, 0], CLAMP);
  const enter = interpolate(t, [0, 0.14], [0, 1], CLAMP);
  const rise = interpolate(t, [0, 0.18], [30, 0], CLAMP);
  const box = titleTextBox();

  return (
    <div style={{ opacity: gone * enter }}>
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: TITLE_BOX.x,
            top: TITLE_BOX.y,
            width: TITLE_BOX.w,
            height: TITLE_LABEL_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              direction: 'rtl',
              fontFamily: FONT.family,
              fontSize: FONT.meta,
              fontWeight: 400,
              color: COLORS.gold,
              border: `1px solid ${COLORS.panelEdge}`,
              backgroundColor: COLORS.panel,
              borderRadius: 999,
              padding: '6px 26px',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
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
            fontWeight: 700,
            fontSize: scene.questionFontSize,
            lineHeight: LINE_HEIGHT,
            color: COLORS.ink,
            textShadow: `0 4px 24px ${COLORS.shadow}`,
          }}
        >
          {main}
        </div>
      </div>
    </div>
  );
};
