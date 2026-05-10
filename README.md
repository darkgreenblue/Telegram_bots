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

نقطهٔ ورود اپ **`index.js`** است (ماژول ES برای Node ۲۰).

## اتصال به GitHub

۱. در GitHub یک repository خالی بسازید (بدون تیک README اگر همین پوشه را push می‌کنید).

۲. در ترمینال:

```bash
cd /Users/divar/Desktop/voicetotext
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

برای push با SSH به‌جای HTTPS از آدرس `git@github.com:YOUR_USER/YOUR_REPO.git` استفاده کنید.
