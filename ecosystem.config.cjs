// PM2 ecosystem — همه‌ی ربات‌های تلگرام این ریپو اینجا تعریف می‌شوند.
// هر ربات با cwd مخصوص خودش اجرا می‌شود؛ بنابراین dotenv فایل .env و دیتابیس
// SQLite (./data) را از پوشه‌ی همان ربات می‌خواند و پروژه‌ها کاملاً جدا می‌مانند.
module.exports = {
  apps: [
    { name: 'voice2text',    cwd: 'bots/voice2text',    script: 'index.js' },
    { name: 'resume-tailor', cwd: 'bots/resume-tailor',  script: 'index.js' },
  ],
};
