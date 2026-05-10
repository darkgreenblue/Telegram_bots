# tg-voice2text

بات تلگرام: ویس → انتخاب نوع پردازش و مدل Gemini → متن. اجرا با Node ۲۰ و وبهوک (مناسب Cloud Run).

## اجرای محلی

```bash
cp .env.example .env
# مقادیر BOT_TOKEN، GEMINI_API_KEY، WH_SECRET را در .env بگذارید

npm install
npm start
```

## دیپلوی روی Cloud Run

از ریشهٔ پروژه (با `gcloud` لاگین و پروژهٔ درست):

```bash
gcloud run deploy tg-voice2text --source . --region us-central1 --allow-unauthenticated
```

متغیرهای محیط سرویس را در کنسول Cloud Run ست کنید (`BOT_TOKEN`, `GEMINI_API_KEY`, `WH_SECRET`) و وبهوک تلگرام را به `https://<آدرس-سرویس>/webhook` بزنید.

## نکته

فایل اصلی اپ به‌خاطر نام قبلی `voicetotext.py` است ولی محتوای آن **JavaScript** است؛ اسکریپت `start` همان را با `node` اجرا می‌کند.
