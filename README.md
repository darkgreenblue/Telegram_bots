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

## استقرار از Cursor فقط برای «نسخهٔ توافقی» (GitHub → Cloud Run)

جریان: در Cursor کد را عوض می‌کنید → commit → وقتی همه توافق کردند **تگ semver** می‌زنید → push تگ → GitHub Actions همان commit را به Cloud Run می‌فرستد. push معمولی به `main` **به‌تنهایی** دیپلوی نمی‌کند.

### یک‌بار در GitHub (Secrets / Variables)

در repo: **Settings → Secrets and variables → Actions**

**Secrets (ضروری):**

| نام | مقدار |
|-----|--------|
| `GCP_SA_KEY` | JSON یک [Service Account](https://console.cloud.google.com/iam-admin/serviceaccounts) در پروژهٔ GCP با نقش‌های لازم برای `gcloud run deploy --source` (حداقل معمولاً: Cloud Run Admin، Cloud Build Editor، Service Account User؛ بسته به پروژه ممکن است Storage/Artifact هم لازم شود — اگر خطای permission گرفتید از متن خطا نقش اضافه کنید). کل فایل JSON را کپی کنید. |
| `BOT_TOKEN` | توکن تلگرام |
| `GEMINI_API_KEY` | کلید Gemini |
| `WH_SECRET` | همان رشتهٔ وبهوک |

**Variables (اختیاری):**

| نام | پیش‌فرض در workflow |
|-----|---------------------|
| `GCP_REGION` | `us-central1` |
| `CLOUD_RUN_SERVICE` | `tg-voice2text` |

### در Cursor (بعد از توافق روی نسخه)

```bash
cd /Users/divar/Desktop/voicetotext
git add -A && git commit -m "Release: توضیح کوتاه"
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

با `git push origin v1.0.0` workflow **Deploy to Cloud Run** اجرا می‌شود و همان تگ روی Cloud Run می‌رود.

### دیپلوی دستی بدون تگ جدید

GitHub → **Actions** → **Deploy to Cloud Run** → **Run workflow** → در `git_ref` مثلاً `v1.0.0` یا یک **SHA** بگذارید.

### وبهوک

بعد از اولین deploy، URL سرویس را از خروجی Actions یا Cloud Run بردارید و وبهوک را به `/webhook` با `secret_token` برابر `WH_SECRET` ست کنید (مثل قبل).
