# 🎙 voice2text — ربات ویس → متن

ربات SaaS تلگرام: ویس/فایل صوتی → متن (کامل/مفید/خلاصه/صورت‌جلسه) با مدل‌های Gemini از طریق OpenRouter. کیف‌پول تومانی با شارژ کارت‌به‌کارت و تأیید ادمین. **ربات زنده و درآمدزاست — هرگز نباید بشکند.**

> 📖 جزئیات کامل معماری، شِمای دیتابیس و منطق محصول در [`CLAUDE.md`](CLAUDE.md) همین پوشه.

## اجرا
```bash
cp .env.example .env   # BOT_TOKEN و OPENROUTER_API_KEY (و اختیاری METIS_API_KEY/NOTION_TOKEN)
npm ci
node index.js          # long-polling؛ روی سرور با pm2 (ecosystem.config.cjs ریشه)
```

نیازمندی سیستم: **ffmpeg / ffprobe** روی سرور (برای تشخیص طول فایل و تبدیل mp3 برای مدل فالبک).

## متغیرهای محیطی
| متغیر | شرح |
|-------|-----|
| `BOT_TOKEN` | توکن تلگرام (الزامی) |
| `OPENROUTER_API_KEY` | کلید OpenRouter (الزامی) |
| `METIS_API_KEY` | اختیاری — فقط فلوهای مالک که «برای کافه‌بازار» روشن است، با Gemini از API متیس اجرا می‌شوند |
| `NOTION_TOKEN` | اختیاری — قابلیت «ارسال به Notion» (فقط برای OWNER) |

روی سرور، `.env` خودکار از GitHub Secrets ساخته می‌شود (`VOICE2TEXT_*`) — بند ۴ CLAUDE.md ریشه.
