// Cards.jsx — لایه‌ی پیوسته‌ی کارت‌ها.
//
// **مهم‌ترین تصمیمِ معماریِ رندر:** این لایه بیرونِ همه‌ی `Sequence`هاست.
//
// اگر کارت‌ها داخلِ صحنه‌ها می‌رفتند، هر مرزِ صحنه یک unmount/mount بود: کارت وسطِ پرواز
// ناپدید می‌شد و در صحنه‌ی بعد از جای دیگری دوباره ظاهر می‌شد، و کراس‌فیدِ متن هم روی خودِ
// کارت‌ها می‌افتاد و آن‌ها را وسطِ حرکت محو می‌کرد. کارت‌ها یک شیءِ پیوسته‌ی صحنه‌اند نه
// محتوای یک اسلاید، پس فریمِ **مطلق** می‌گیرند و خودشان از `sceneAt` می‌پرسند الان کجای
// برنامه‌اند. نتیجه: پروازِ برگشتِ کارت در فریمِ آخرِ یک صحنه دقیقاً به نشستنِ آن در فریمِ اولِ
// صحنه‌ی بعد وصل می‌شود، بدون یک فریم پرش.
//
// ترتیبِ روی‌هم افتادن با `zIndex` از خودِ `z`ِ موشن می‌آید، نه با مرتب‌سازیِ آرایه: مرتب‌سازی
// یعنی جابه‌جا شدنِ گره‌های DOM بینِ فریم‌ها، که هم بارگذاریِ تصویر را دوباره راه می‌اندازد و
// هم انیمیشن را می‌پراند.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { cardRectAt, deckRectAt, decorSlots } from '../motion.js';
import { sceneAt } from '../timing.js';
import { Card } from './Card.jsx';

export const Cards = ({ plan, cards = [] }) => {
  const frame = useCurrentFrame();
  const n = cards.length;
  const at = sceneAt(plan, frame);
  if (!at || !n) return null;

  const { scene, t } = at;
  const motion = scene.motion ?? 'verdict';
  // کارت‌های تزئینیِ دک فقط در اینترو معنا دارند؛ بعد از آن اصلاً وجود ندارند.
  const decor = scene.kind === 'intro' ? decorSlots(n) : [];

  return (
    // zIndex صفر عمدی است و یک خطِ حیاتی: بدونش این AbsoluteFill استکینگ‌کانتکست
    // نمی‌سازد و zIndexِ ۱۰۰ی کارتِ فوکوس در ریشه با Sequenceهای متن رقابت می‌کند و
    // برنده می‌شود، یعنی تفسیر پشتِ کارت گم می‌شود. با این خط، لایه‌بندیِ کارت‌ها داخلِ
    // خودشان محبوس می‌ماند و متن همیشه بالای تصویر است.
    <AbsoluteFill style={{ zIndex: 0 }}>
      {decor.map((k) => (
        <Card key={`deck-${k}`} rect={deckRectAt({ t, k, n })} file="back.jpg" />
      ))}
      {cards.map((c, i) => (
        <Card
          key={c?.key || `card-${i}`}
          rect={cardRectAt({ scene: motion, t, i, n })}
          file={c?.file || 'back.jpg'}
          reversed={Boolean(c?.reversed)}
        />
      ))}
    </AbsoluteFill>
  );
};
