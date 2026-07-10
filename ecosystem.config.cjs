// PM2 ecosystem — همه‌ی ربات‌های تلگرام این ریپو اینجا تعریف می‌شوند.
// هر ربات با cwd مخصوص خودش اجرا می‌شود؛ بنابراین dotenv فایل .env و دیتابیس
// SQLite (./data) را از پوشه‌ی همان ربات می‌خواند و پروژه‌ها کاملاً جدا می‌مانند.
module.exports = {
  apps: [
    { name: 'voice2text',    cwd: 'bots/voice2text',    script: 'index.js' },
    { name: 'resume-tailor', cwd: 'bots/resume-tailor',  script: 'index.js' },
    { name: 'tarot',         cwd: 'bots/tarot',          script: 'index.js' },
    // داشبورد ادمین — ربات نیست ولی همین زنجیره‌ی deploy/backup/ops را استفاده می‌کند؛
    // فقط روی 127.0.0.1:8787 گوش می‌دهد و از Cloudflare Tunnel در دسترس است (deploy.yml)
    { name: 'dashboard',     cwd: 'bots/dashboard',      script: 'index.js' },
  ],
};
