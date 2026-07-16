// دکمه‌ی «ریست حساب (ادمین)» — ابزار مدیریتیِ فقط-ادمین، همیشه فعال (حتی خارج از فاز تست).
// قانون shared/: بدون import از npm؛ bot و isAdmin و wipe به‌صورت پارامتر می‌آیند (DI).
//
// فلسفه (CLAUDE.md بند ۶ب): فقط دو آی‌دیِ ADMIN_IDS این دکمه را می‌بینند و می‌زنند؛ زدنش فقط
// دیتای خودِ همان ادمین را پاک می‌کند و او را «مثل یک کاربر کاملاً جدید» معرفی می‌کند (after=handleStart
// که با upsertUser دوباره isNew می‌شود). هیچ کاربر دیگری آن را نمی‌بیند و در هیچ فلویی دخالت نمی‌کند؛
// فلوی ادمین هیچ تمایزی با کاربر عادی ندارد (این دکمه تنها تمایزِ رو-به-کاربرِ ادمین است).

export const RESET_TEST_BTN = '🔄 ریست حساب (ادمین)';
const OLD_LABEL = '🔄 ریست ربات (تست)'; // برچسبِ قدیمیِ فاز تست — برای دکمه‌ی کش‌شده‌ی احتمالی هم گرفته می‌شود

// isAdmin(uid): آیا این کاربر ادمین است. wipe(uid): همه‌ی جدول‌های کاربرمحورِ همین ربات را پاک کند.
// after(ctx): معمولاً handleStart — کاربر را از نو (مثل جدید) وارد فلو می‌کند.
export function registerAdminReset(bot, { isAdmin, wipe, after }) {
  const doReset = async (ctx) => {
    if (!isAdmin(ctx.from.id)) return; // لایه‌ی دومِ امنیت (دکمه هم فقط برای ادمین نمایش داده می‌شود)
    wipe(ctx.from.id);
    await ctx.reply('🧹 حسابت کامل ریست شد — از این لحظه مثل یک کاربر کاملاً جدید هستی.');
    if (after) await after(ctx);
  };
  bot.hears([RESET_TEST_BTN, OLD_LABEL], doReset);
  bot.command('reset', doReset); // /reset هم فقط برای ادمین (doReset خودش گارد دارد)
}

// کیبوردِ اصلی ردیفِ دکمه‌ی ریست را فقط برای ادمین اضافه کند:  ...(adminResetRow(isAdmin, uid))
export const adminResetRow = (isAdmin, uid) => (isAdmin(uid) ? [[RESET_TEST_BTN]] : []);
