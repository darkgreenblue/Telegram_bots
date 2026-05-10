# tg-voice2text

بات تلگرام: ویس → انتخاب نوع پردازش و مدل Gemini → متن. اجرا با Node ۲۰ و وبهوک (مناسب Cloud Run).

## اجرای محلی

```bash
cp .env.example .env
# مقادیر BOT_TOKEN، GEMINI_API_KEY، WH_SECRET و در صورت نیاز GOOGLE_DOCS_SCRIPT_URL را در .env بگذارید

npm install
npm start
```

## دیپلوی از ترمینال Cursor (فقط `gcloud`، بدون GitHub Actions)

### ۱) یک‌بار: نصب Google Cloud SDK روی مک

**روش الف — Homebrew (ساده):**

```bash
brew install --cask google-cloud-sdk
```

بعد ترمینال را ببندید و دوباره باز کنید (یا `exec $SHELL`) تا `gcloud` در `PATH` باشد.

**روش ب — نصب‌کنندهٔ رسمی:**  
[cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install) → macOS → دستورالعمل همان صفحه.

### ۲) یک‌بار: لاگین و پروژه

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

`YOUR_PROJECT_ID` را از بالای [کنسول GCP](https://console.cloud.google.com) بردارید.

### ۳) یک‌بار: APIهای لازم

در کنسول: **APIs & Services → Library** و این‌ها را **Enable** کنید:

- Cloud Run API  
- Cloud Build API  
- Artifact Registry API  

### ۴) یک‌بار: Docker برای build از سورس

`gcloud run deploy --source .` روی مک معمولاً به **Docker محلی** نیاز دارد. Docker Desktop را نصب کنید و یک‌بار اجرا کنید تا daemon بالا باشد.

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### ۵) هر بار که کد نهایی شد — یک دستور دیپلوی

از **ریشهٔ همین پروژه** (جایی که `Dockerfile` و `package.json` هست):

```bash
cd /Users/divar/Desktop/voicetotext
gcloud run deploy tg-voice2text --source . --region us-central1 --allow-unauthenticated
```

نام سرویس (`tg-voice2text`) یا منطقه را اگر خواستید عوض کنید.

**متغیرهای محیط** را یا همان اول در کنسول Cloud Run برای سرویس ست کنید (`BOT_TOKEN`, `GEMINI_API_KEY`, `WH_SECRET`, `GOOGLE_DOCS_SCRIPT_URL`)، یا اگر `.env` دارید و مقادیر بدون کاراکتر مشکل‌ساز هستند، می‌توانید بعد از بارگذاری متغیرها در شل، همراه deploy بفرستید:

```bash
cd /Users/divar/Desktop/voicetotext
set -a && source .env && set +a
gcloud run deploy tg-voice2text --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars="BOT_TOKEN=${BOT_TOKEN},GEMINI_API_KEY=${GEMINI_API_KEY},WH_SECRET=${WH_SECRET},GOOGLE_DOCS_SCRIPT_URL=${GOOGLE_DOCS_SCRIPT_URL}"
```

در پایان خروجی، **URL** سرویس را بردارید.

### Google Docs برای خروجی‌های طولانی

برای گزینهٔ «فایل Google Docs» یک Apps Script Web App بسازید که درخواست `POST` با بدنهٔ `{ "title": "...", "content": "..." }` بگیرد و پاسخ `{ "success": true, "url": "..." }` برگرداند. URL نهایی Web App را در `GOOGLE_DOCS_SCRIPT_URL` بگذارید.

نمونهٔ کد Apps Script:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const doc = DocumentApp.create(data.title || 'Voice transcript');
    doc.getBody().setText(data.content || '');
    doc.saveAndClose();

    const file = DriveApp.getFileById(doc.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, url: doc.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### ۶) وبهوک تلگرام

`https://<آدرس-سرویس>/webhook` را با `setWebhook` و `secret_token` برابر `WH_SECRET` ست کنید (مثل قبل).

---

## نکته

نقطهٔ ورود اپ **`index.js`** است (ماژول ES برای Node ۲۰).

## اتصال اختیاری به GitHub (فقط برای نگه‌داشتن کد)

```bash
cd /Users/divar/Desktop/voicetotext
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

این بخش برای backup/همکاری است؛ دیپلوی مستقیم با همان `gcloud run deploy` بالا انجام می‌شود.
