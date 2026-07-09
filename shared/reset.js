// دکمه‌ی «ریست تست» — قرارداد بند ۶ب CLAUDE.md (همه‌ی ربات‌ها در فاز تست).
// قانون shared/: بدون import از npm؛ bot و wipe به‌صورت پارامتر می‌آیند.

export const RESET_TEST_BTN = '🔄 ریست ربات (تست)';

// ربات بدون‌درآمد: testPhase=true و ownerOnly=false → برای همه فعال.
// ربات درآمدزا: ownerOnly=true → فقط OWNER_ID (کاربر پولی تصادفاً پاک نشود).
// wipe(uid) باید همه‌ی داده‌های کاربرمحور همان ربات را پاک کند؛ after(ctx) معمولاً handleStart است.
export function registerTestReset(bot, { ownerId, ownerOnly = false, testPhase = true, wipe, after }) {
  const doReset = async (ctx) => {
    const uid = ctx.from.id;
    if (ownerOnly && uid !== ownerId) return;
    wipe(uid);
    await ctx.reply('🧹 همه‌ی داده‌هایت پاک شد — مثل یک کاربر تازه شروع می‌کنی.');
    if (after) await after(ctx);
  };
  if (testPhase) bot.hears(RESET_TEST_BTN, doReset);
  // /reset همیشه برای مالک باقی می‌ماند (حتی بعد از پایان فاز تست)
  bot.command('reset', (ctx) => {
    if (!testPhase && ctx.from.id !== ownerId) return;
    return doReset(ctx);
  });
}
