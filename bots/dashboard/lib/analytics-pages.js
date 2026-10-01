// صفحه‌هایی که فقط برای تحلیل‌اند؛ عملیات پشتیبانی/کاربر/مالی عمداً این‌جا نیستند.
// آن مسیرها همیشه مستقیم و مستقل از صفِ گزارش‌گیری می‌مانند.
import { dashBody } from '../routes/dash.js';
import { engagementBody } from '../routes/engagement.js';
import { acquisitionBody } from '../routes/acquisition.js';
import { economicsBody } from '../routes/economics.js';
import { funnelsBody } from '../routes/funnels.js';
import { screensBody } from '../routes/journey.js';
import { retentionBody } from '../routes/retention.js';
import { marketingStatsData } from '../routes/marketing.js';
import { trendsBody } from '../routes/trends.js';

const PAGES = new Map([
  ['/dash', dashBody],
  ['/engagement', engagementBody],
  ['/acquisition', acquisitionBody],
  // کارتِ ورودی‌های دستی زنده است (`economicsPage`)؛ worker فقط جایش نشانگر می‌گذارد
  ['/economics', (url) => economicsBody(url, { inputsSlot: true })],
  ['/funnels', funnelsBody],
  ['/screens', screensBody],
  ['/retention', retentionBody],
  // ترندها: سنجه‌ها از platform.db (ثبتِ شبانه)، ولی پول زنده از `profitFor` که DBِ ربات را می‌خواند
  ['/trends', trendsBody],
  // مارکتینگ: فقط آمار (JSON)، نه کلِ صفحه — `marketingBody` فرم‌ها و فهرست را زنده می‌سازد
  ['/marketing', (url) => JSON.stringify(marketingStatsData(url))],
]);

export const isCachedAnalyticsPath = (path) => PAGES.has(path);
export const renderCachedAnalyticsPage = (url) => PAGES.get(url.pathname)?.(url) ?? null;
