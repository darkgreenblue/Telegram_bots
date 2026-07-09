// هندلرهای خطای سراسری — قرارداد بند ۸ CLAUDE.md: هیچ فلویی نباید بی‌صدا بمیرد.
// قانون shared/: بدون import از npm.

import { logErr } from './logger.js';

// bot.catch سراسری: لاگ کامل با stack + پیام عذرخواهی عمومی به کاربر.
export function makeBotCatch({ apology = '😕 خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کن.', getState = null } = {}) {
  return async (err, ctx) => {
    const state = getState && ctx.from ? getState(ctx.from.id) : '-';
    logErr(`❌ GLOBAL [${ctx.updateType}] uid=${ctx.from?.id} state=${state}:`, err.stack || err.message);
    try { await ctx.reply(apology); } catch {}
  };
}

// خطاهای سطح پروسه:
// - unhandledRejection: فقط لاگ (کرش‌کردن، همه‌ی سشن‌های در جریان را می‌کشد — بدترین اختلال).
// - uncaughtException: لاگ کامل و خروج با کد ۱ (همان رفتار پیش‌فرض Node؛ pm2 ری‌استارت می‌کند)
//   تا state خراب ادامه پیدا نکند — فقط حالا stack در error.log ثبت می‌شود.
export function registerGlobalErrorHandlers(appName = 'bot') {
  process.on('unhandledRejection', (reason) => {
    logErr(`❌ UNHANDLED_REJECTION [${appName}]:`, reason?.stack || reason);
  });
  process.on('uncaughtException', (err) => {
    logErr(`❌ UNCAUGHT_EXCEPTION [${appName}] — exiting for pm2 restart:`, err.stack || err.message);
    process.exit(1);
  });
}
