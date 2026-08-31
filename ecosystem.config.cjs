// PM2 ecosystem — همه‌ی ربات‌های تلگرام این ریپو اینجا تعریف می‌شوند.
// هر ربات با cwd مخصوص خودش اجرا می‌شود؛ بنابراین dotenv فایل .env و دیتابیس
// SQLite (./data) را از پوشه‌ی همان ربات می‌خواند و پروژه‌ها کاملاً جدا می‌مانند.
module.exports = {
  apps: [
    { name: 'voice2text',    cwd: 'bots/voice2text',    script: 'index.js' },
    // resume-tailor بازنشسته شد (منسوخ؛ deploy.yml یک‌باره از pm2 حذفش می‌کند). کدش برای آرشیو می‌ماند.
    { name: 'tarot',         cwd: 'bots/tarot',          script: 'index.js' },
    /* 🌍 تاروتِ چندزبانه (بند ۲و): **یک کدبیس، N ربات** — نه N فورک.
     * هر زبان همان `bots/tarot/index.js` را اجرا می‌کند و فقط `ENV_FILE` فرق دارد؛
     * خودِ آن فایل `LOCALE` و توکن و کلیدِ OpenRouterِ همان زبان را می‌آورد، و
     * `index.js` دیتابیسش را از روی `LOCALE` جدا می‌کند (`data/bot-<locale>.db`).
     * الگوی اثبات‌شده‌ی `bots/tabir-khab` با شش ربات روی یک کدبیس.
     * ⚠️ تا وقتی سکرتِ آن زبان ست نشود، دیپلوی `.env.<locale>` را نمی‌سازد و
     * `deploy_bot` بی‌صدا ردش می‌کند، پس این ردیف‌ها بی‌اثرند. */
    { name: 'tarot-ru',      cwd: 'bots/tarot',          script: 'index.js', env: { ENV_FILE: '.env.ru' } },
    { name: 'tarot-pt',      cwd: 'bots/tarot',          script: 'index.js', env: { ENV_FILE: '.env.pt' } },
    { name: 'tarot-es',      cwd: 'bots/tarot',          script: 'index.js', env: { ENV_FILE: '.env.es' } },
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
