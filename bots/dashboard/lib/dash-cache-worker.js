// worker یک‌بارمصرفِ ساختِ cache. اجرای SQLite هر قدر هم طول بکشد، process HTTP را قفل نمی‌کند.
import { renderCachedAnalyticsPage } from './analytics-pages.js';
import { setPriority } from 'node:os';
import { canonicalAnalyticsUrl, writeDashCache } from './dash-cache.js';

const requested = process.argv[2];
if (!requested) process.exit(2);

try {
  // اولویت پایین: این کار صرفاً تحلیل است و نباید به ربات‌ها یا پشتیبانی حق تقدم بگیرد.
  try { setPriority(0, 19); } catch { /* پلتفرم آن را پشتیبانی نمی‌کند */ }
  const url = new URL(canonicalAnalyticsUrl(requested), 'http://127.0.0.1');
  const body = renderCachedAnalyticsPage(url);
  if (body === null) throw new Error(`analytics path is not cacheable: ${url.pathname}`);
  writeDashCache(url, body);
} catch (error) {
  // parent تنها نتیجه‌ی موفق را publish می‌کند؛ cache قبلی در خطا دست‌نخورده می‌ماند.
  console.error(`dashboard cache worker: ${error.stack || error.message}`);
  process.exitCode = 1;
}
