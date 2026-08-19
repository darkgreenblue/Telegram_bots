// PM2 ecosystem — همه‌ی ربات‌های تلگرام این ریپو اینجا تعریف می‌شوند.
// هر ربات با cwd مخصوص خودش اجرا می‌شود؛ بنابراین dotenv فایل .env و دیتابیس
// SQLite (./data) را از پوشه‌ی همان ربات می‌خواند و پروژه‌ها کاملاً جدا می‌مانند.
module.exports = {
  apps: [
    { name: 'voice2text',    cwd: 'bots/voice2text',    script: 'index.js' },
    // resume-tailor بازنشسته شد (منسوخ؛ deploy.yml یک‌باره از pm2 حذفش می‌کند). کدش برای آرشیو می‌ماند.
    { name: 'tarot',         cwd: 'bots/tarot',          script: 'index.js' },
    // پادکستِ آموزشیِ روزانه‌ی شخصیِ مالک (فقط ادمین؛ Notion → LLM → TTS → تلگرام)
    { name: 'daily-brief',   cwd: 'bots/daily-brief',    script: 'index.js' },
    // داشبورد ادمین — ربات نیست ولی همین زنجیره‌ی deploy/backup/ops را استفاده می‌کند؛
    // فقط روی 127.0.0.1:8787 گوش می‌دهد و از Cloudflare Tunnel در دسترس است (deploy.yml)
    { name: 'dashboard',     cwd: 'bots/dashboard',      script: 'index.js' },
    // ناظرِ سلامت — ربات نیست و .env هم ندارد؛ توکن و ADMIN_IDS را از .envِ خودِ ربات‌ها
    // می‌خواند. جای پایشِ هر ۳۰ دقیقه‌ایِ GitHub Actions را گرفت (که ۷۲٪ سهمیه‌ی حساب را
    // می‌خورد و ۱ تا ۴ ساعت هم عقب می‌افتاد). cwd ریشه است چون به کلِ ecosystem و به
    // .envِ همه‌ی ربات‌ها نگاه می‌کند. جزئیات: tools/health-watch.mjs
    { name: 'health-watch',  cwd: '.',                   script: 'tools/health-watch.mjs' },
  ],
};
