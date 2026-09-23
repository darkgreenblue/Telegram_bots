// صفحه‌هایی که فقط برای تحلیل‌اند؛ عملیات پشتیبانی/کاربر/مالی عمداً این‌جا نیستند.
// آن مسیرها همیشه مستقیم و مستقل از صفِ گزارش‌گیری می‌مانند.
import { dashBody } from '../routes/dash.js';
import { engagementBody } from '../routes/engagement.js';
import { acquisitionBody } from '../routes/acquisition.js';
import { economicsBody } from '../routes/economics.js';
import { funnelsBody } from '../routes/funnels.js';
import { screensBody } from '../routes/journey.js';
import { retentionBody } from '../routes/retention.js';

const PAGES = new Map([
  ['/dash', dashBody],
  ['/engagement', engagementBody],
  ['/acquisition', acquisitionBody],
  ['/economics', economicsBody],
  ['/funnels', funnelsBody],
  ['/screens', screensBody],
  ['/retention', retentionBody],
]);

export const isCachedAnalyticsPath = (path) => PAGES.has(path);
export const renderCachedAnalyticsPage = (url) => PAGES.get(url.pathname)?.(url) ?? null;
