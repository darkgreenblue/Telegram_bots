// پیشنهاددهنده‌ی فال — منطقِ خالص و قابل‌تست (بدونِ DB، بدونِ تلگراف، بدونِ LLM).
// index.js دیتا را می‌دهد، این‌جا فقط امتیاز حساب و مرتب می‌شود. تستِ CI: tools/check-reco.mjs
//
// امتیاز = BASE + بونوسِ حوزه + بونوسِ اقبال عمومی − جریمه‌ی تازگی
// و **قبل از هر امتیازی** دو قفلِ سخت اعمال می‌شود که هیچ امتیازی نمی‌تواند بشکندشان:
//   ۱) فالی که همین الان تمام شده (currentType)
//   ۲) فالی که ظرفِ cooldownDays تحویل گرفته شده
// خواسته‌ی صریح مالک: «تحت هیچ شرایطی فالی که تازه تمام کرده دوباره پیشنهاد نشود.»

export const RECO = {
  BASE: 100,
  SLOTS: 3,
  COOLDOWN_DAYS: 3,
  FOCUS_BONUS: 40,
  POP_MAX: 25,
  RECENCY_MAX: 90,
  RECENCY_WEEKS: 12,
};

/**
 * @param {object[]} spreads      لیستِ کاملِ چیدمان‌ها ({id, size, focus?})
 * @param {object}   o
 * @param {string?}  o.currentType   فالی که همین الان تمام شد (همیشه حذف)
 * @param {string}   o.focus         حوزه‌ی تمرکزِ کاربر
 * @param {Set}      o.focusIds      idهای هم‌حوزه (از FOCUS_SUGGEST)
 * @param {Map}      o.popMap        id → ۰..۱ (اقبال عمومیِ نرمال‌شده)
 * @param {Map}      o.lastByType    id → unix آخرین تحویل به همین کاربر
 * @param {number}   o.nowS          زمانِ حال (ثانیه) — تزریقی تا تست قطعی بماند
 * @param {number}   o.slots
 * @returns {object[]} چیدمان‌های مرتب‌شده (بالاترین امتیاز اول)
 */
export function scoreSpreads(spreads, o = {}) {
  const {
    currentType = null, focus = '', focusIds = new Set(),
    popMap = new Map(), lastByType = new Map(),
    nowS = Math.floor(Date.now() / 1000), slots = RECO.SLOTS,
  } = o;

  const scored = [];
  for (const sp of spreads) {
    if (!sp || !sp.id) continue;
    if (sp.id === currentType) continue;                     // قفلِ سخت ۱
    const lastAt = lastByType.get(sp.id);
    const days = lastAt ? (nowS - lastAt) / 86400 : Infinity;
    if (days < RECO.COOLDOWN_DAYS) continue;                 // قفلِ سخت ۲

    let score = RECO.BASE;
    if (focusIds.has(sp.id) || (sp.focus && sp.focus === focus)) score += RECO.FOCUS_BONUS;
    score += (popMap.get(sp.id) || 0) * RECO.POP_MAX;
    if (Number.isFinite(days)) {
      // جریمه هفته‌به‌هفته آب می‌رود؛ بعد از RECENCY_WEEKS اثرش صفر است
      const decay = Math.max(0, 1 - (days / 7) / RECO.RECENCY_WEEKS);
      score -= RECO.RECENCY_MAX * decay;
    }
    scored.push({ sp, score });
  }
  // مساوی شد؟ فالِ کوچک‌تر (ارزان‌تر) جلو می‌افتد تا قدمِ بعدی کم‌اصطکاک‌تر باشد
  scored.sort((a, b) => b.score - a.score || (a.sp.size || 0) - (b.sp.size || 0));
  return scored.slice(0, slots).map(x => x.sp);
}
