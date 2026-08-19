// Intro.jsx — تنها متنِ اینترو: یک برچسبِ کوتاهِ نوعِ فال.
//
// ⚠️ سوالِ فال عمداً **روی ویدیو نوشته نمی‌شود** (تصمیمِ صریحِ مالک). سوال قرار است در
// خودِ استیکرِ «سوال» اینستاگرام تایپ شود و کارِ این ویدیو فقط باز نگه‌داشتنِ جای آن
// مستطیل است (`SAFE_BOX`). نوشتنِ سوال روی ویدیو یعنی همان متن دو بار و روی هم دیده شود.
//
// خودِ کارت‌ها اینجا نیستند؛ در لایه‌ی پیوسته‌ی `<Cards>` رندر می‌شوند (دلیلش در همان فایل).
//
// چرا برچسب محو می‌شود: `TITLE_BOX` و `TOP_ROW` هر دو تنها فضای بالای `SAFE_BOX` را
// می‌گیرند و روی هم می‌افتند. تصادم واقعی نیست چون هم‌زمان نیستند: برچسب باید پیش از
// رسیدنِ کارت‌ها به ردیفِ بالا رفته باشد. پنجره‌اش (`TITLE_FADE`) کنارِ خودِ فازهای اینترو
// تعریف شده تا اگر ریتمِ اینترو تیون شد، این هم با آن جابه‌جا شود.

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { TITLE_BOX, COLORS, FONT } from '../layout.js';
import { TITLE_FADE } from '../motion.js';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const Intro = ({ scene }) => {
  const frame = useCurrentFrame();
  const span = Math.max(1, scene.durationInFrames - 1);
  const t = frame / span;

  const label = String(scene.spreadFa || '').trim();
  if (!label) return null;

  const gone = interpolate(t, TITLE_FADE, [1, 0], CLAMP);
  const enter = interpolate(t, [0, 0.14], [0, 1], CLAMP);
  const rise = interpolate(t, [0, 0.18], [24, 0], CLAMP);

  return (
    <div
      style={{
        position: 'absolute',
        left: TITLE_BOX.x,
        top: TITLE_BOX.y,
        width: TITLE_BOX.w,
        height: TITLE_BOX.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: gone * enter,
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          direction: 'rtl',
          fontFamily: FONT.family,
          fontSize: FONT.label,
          fontWeight: 700,
          color: COLORS.gold,
          border: `1px solid ${COLORS.panelEdge}`,
          backgroundColor: COLORS.panel,
          borderRadius: 999,
          padding: '10px 38px',
          whiteSpace: 'nowrap',
          textShadow: `0 4px 24px ${COLORS.shadow}`,
        }}
      >
        {label}
      </div>
    </div>
  );
};
