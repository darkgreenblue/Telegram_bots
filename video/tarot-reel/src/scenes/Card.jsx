// Card.jsx — رندرِ یک کارت از روی مستطیلی که `cardRectAt` داده است.
//
// این کامپوننت عمداً هیچ تصمیمِ هندسی‌ای نمی‌گیرد: نه x را جابه‌جا می‌کند، نه اندازه را کلمپ
// می‌کند، نه مسیری می‌سازد. هر عددی که اینجا حساب شود از دیدِ چکِ CI پنهان می‌ماند و می‌تواند
// از گاردِ `SAFE_BOX` فرار کند. تنها اعدادِ اینجا زیبایی‌شناختی‌اند و همه از خودِ عرضِ کارت
// مشتق می‌شوند (شعاعِ گوشه، ضخامتِ قاب)، پس با هر اندازه‌ای متناسب می‌مانند.
//
// فلیپ با `rotateY` و دو وجهِ `backfaceVisibility:'hidden'` انجام می‌شود، نه با عوض کردنِ src
// در نیمه‌ی راه: عوض کردنِ src یعنی یک فریم تصویرِ نیمه‌بارگذاری‌شده، و در رندرِ موازیِ Remotion
// این خطا همیشه در فریمِ دیگری ظاهر می‌شود.

import React from 'react';
import { Img, staticFile } from 'remotion';
import { COLORS } from '../layout.js';

const face = (radius) => ({
  position: 'absolute',
  inset: 0,
  borderRadius: radius,
  overflow: 'hidden',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  border: `${Math.max(2, Math.round(radius * 0.22))}px solid ${COLORS.gold}`,
  boxShadow: `0 ${Math.round(radius * 1.2)}px ${Math.round(radius * 2.4)}px ${COLORS.shadow}`,
  backgroundColor: '#120c1e',
});

export const Card = ({ rect, file, reversed = false }) => {
  const { x, y, w, h } = rect;
  if (!(w > 0) || !(h > 0)) return null;
  const opacity = rect.opacity ?? 1;
  if (opacity <= 0.002) return null;

  const radius = Math.max(8, Math.round(w * 0.05));
  const rotate = rect.rotate ?? 0;
  const rotateY = rect.rotateY ?? 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        opacity,
        zIndex: Math.round(rect.z ?? 0),
        transform: `rotate(${rotate}deg)`,
        // پرسپکتیو روی والد می‌نشیند تا فلیپِ فرزند حجم داشته باشد نه اینکه فقط پهن و باریک شود.
        perspective: 1600,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: `rotateY(${rotateY}deg)`,
        }}
      >
        <div style={face(radius)}>
          <Img
            src={staticFile(`cards/${file}`)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              // کارتِ معکوس در تاروت واقعاً وارونه روی میز می‌افتد؛ همین چرخش تنها نشانه‌ای است
              // که بدونِ هیچ متنی هم برای بیننده معنا دارد.
              transform: reversed ? 'rotate(180deg)' : 'none',
            }}
          />
        </div>
        <div style={{ ...face(radius), transform: 'rotateY(180deg)' }}>
          <Img src={staticFile('cards/back.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </div>
    </div>
  );
};
