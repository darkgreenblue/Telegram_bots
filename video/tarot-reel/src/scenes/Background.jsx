// Background.jsx — پس‌زمینه‌ی ثابتِ زیرِ همه‌ی صحنه‌ها.
//
// چرا زیرِ همه و بیرونِ صحنه‌ها: اگر پس‌زمینه هم داخلِ `Sequence` می‌رفت، کراس‌فیدِ بینِ صحنه‌ها
// باعثِ یک پرشِ روشناییِ محسوس در هر مرز می‌شد. پس‌زمینه باید تنها چیزی باشد که هرگز نمی‌بُرد.
//
// چرا ذرات از `seeded` و نه `Math.random`: Remotion فریم‌ها را موازی و خارج از ترتیب رندر
// می‌کند، پس دو فریمِ پشتِ سرِ هم دو چینشِ متفاوتِ ذرات می‌گرفتند و خروجی برفک می‌شد.
//
// رنگ‌ها همه از `THEMES` می‌آیند. چیزی که اینجا محلی است فقط **دستورِ بصری** هر تم است
// (شکلِ گرادیان، چگالیِ ذرات)، نه هیچ عددِ هندسیِ مربوط به کارت یا متن.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { W, H, SAFE_BOX, themeOf } from '../layout.js';
import { bgParticles } from '../motion.js';

const TAU = Math.PI * 2;

// چگالی و «جانِ» هر تم. مینیمال عمداً ساکت‌تر است: کلِ ارزشِ آن تم نبودنِ شلوغی است.
// `vignette` برای مینیمال پایین آمده چون پالتِ آن از اول تیره است و وینیتِ کامل روی آن دیگر
// «تمرکز» نمی‌سازد، فقط قاب را یکدست سیاه می‌کند و رندر شبیه خطا دیده می‌شود.
const RECIPES = {
  mystic: { particles: 46, glow: 0.5, drift: 1, vignette: 1 },
  nature: { particles: 38, glow: 0.42, drift: 0.8, vignette: 0.9 },
  minimal: { particles: 18, glow: 0.16, drift: 0.6, vignette: 0.45 },
};

const baseGradient = (variant, th) => {
  if (variant === 'nature') {
    return `radial-gradient(120% 80% at 50% 100%, ${th.bg2} 0%, ${th.bg1} 45%, ${th.bg0} 100%)`;
  }
  if (variant === 'minimal') {
    // نورِ ملایم از بالای قاب: همان‌جا که کارت‌ها می‌نشینند، پس قاب حتی در ساکت‌ترین تم هم فرم دارد.
    return `radial-gradient(140% 72% at 50% 6%, ${th.bg2} 0%, ${th.bg1} 42%, ${th.bg0} 100%)`;
  }
  return `linear-gradient(155deg, ${th.bg1} 0%, ${th.bg0} 38%, ${th.bg2} 78%, ${th.bg0} 100%)`;
};

export const Background = ({ variant = 'mystic' }) => {
  const frame = useCurrentFrame();
  const th = themeOf(variant);
  const recipe = RECIPES[variant] || RECIPES.mystic;
  const particles = bgParticles(recipe.particles, 7);

  // نفسِ کندِ هاله: دوره‌ی ~۸ ثانیه‌ای، آن‌قدر آرام که به‌جای دیده شدن، حس شود.
  const breath = 0.5 + 0.5 * Math.sin((frame / 240) * TAU);
  const glowA = recipe.glow * (0.7 + 0.3 * breath);

  return (
    <AbsoluteFill style={{ backgroundColor: th.bg0 }}>
      <AbsoluteFill style={{ background: baseGradient(variant, th) }} />

      {recipe.glow > 0.2 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(46% 30% at 22% 18%, ${th.glow} 0%, transparent 70%),
                         radial-gradient(52% 34% at 78% 86%, ${th.glow} 0%, transparent 72%)`,
            opacity: glowA,
            filter: 'blur(30px)',
          }}
        />
      ) : null}

      {particles.map((p, i) => {
        // حرکتِ رو به بالا با پیچشِ دورانی: ذره از بالای قاب که رد شد از پایین برمی‌گردد،
        // پس هیچ‌وقت قاب خالی از ذره نمی‌شود.
        const y = (((p.y - frame * p.speed * recipe.drift) % H) + H) % H;
        const twinkle = 0.55 + 0.45 * Math.sin((frame / 30) * TAU * (0.3 + p.phase * 0.5) + p.phase * TAU);
        return (
          <div
            key={`p-${i}`}
            style={{
              position: 'absolute',
              left: p.x,
              top: y,
              width: p.r * 2,
              height: p.r * 2,
              borderRadius: '50%',
              backgroundColor: th.particle,
              opacity: p.alpha * twinkle * (variant === 'minimal' ? 0.5 : 1),
              boxShadow: `0 0 ${Math.round(p.r * 5)}px ${th.particle}`,
            }}
          />
        );
      })}

      {/* آرام‌کردنِ ناحیه‌ی استیکر: هیچ محتوایی آن‌جا نمی‌رود، ولی اگر پس‌زمینه همان‌جا پرجنب‌وجوش
          بماند، استیکرِ اینستاگرام روی یک زمینه‌ی شلوغ می‌نشیند و خواندنش سخت می‌شود. */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_BOX.x - 120,
          top: SAFE_BOX.y - 120,
          width: SAFE_BOX.w + 240,
          height: SAFE_BOX.h + 240,
          background: 'radial-gradient(closest-side, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.16) 58%, transparent 100%)',
        }}
      />

      {/* وینیت: چشم را به مرکزِ قاب می‌کشد و لبه‌ها را در فشرده‌سازیِ اینستاگرام تمیزتر نگه می‌دارد. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(${W}px ${H * 0.62}px at 50% 46%, transparent 40%, rgba(0,0,0,0.30) 74%, rgba(0,0,0,0.62) 100%)`,
          opacity: recipe.vignette,
        }}
      />
    </AbsoluteFill>
  );
};
