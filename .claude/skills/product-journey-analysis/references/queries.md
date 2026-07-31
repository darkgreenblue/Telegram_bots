# کوئری‌های استاندارد تحلیل جرنی

> همه از طریق workflow `Ops` اکشن `db-query` اجرا می‌شوند (اتصال **readonly**، سقف ۲۰۰ ردیف).
> `T` = مرزِ نسخه (epoch)، `x` = کاربرانِ حذف‌شده. الگوی ثابتِ سرِ هر کوئری:
>
> ```sql
> WITH x(id) AS (VALUES(429557996),(409581917),(100257975)),
>      c(t) AS (SELECT CAST(strftime('%s','YYYY-MM-DD HH:MM:00') AS INT))
> ```

## قاعده‌ی طلاییِ فرمتِ خروجی
خروجی `db-query` به‌صورت JSON زیبا (هر فیلد یک خط) چاپ می‌شود، پس یک جدولِ ۵۰ ردیفی
حدود ۴۰۰ خط لاگ می‌شود و صدرش برید. **همیشه با `group_concat` نتیجه را در یک ردیف جمع کن:**

```sql
SELECT (SELECT group_concat(s,'; ') FROM (SELECT col1||' '||col2 s FROM ... )) AS bucket1,
       (SELECT group_concat(s,'; ') FROM (SELECT ... )) AS bucket2
```

### تله‌ی رایج: `aggregate functions are not allowed in the GROUP BY clause`
اگر رشته را **هم‌زمان با** تجمیع بسازی و بعد `GROUP BY 1` بزنی، SQLite خطا می‌دهد چون ستونِ ۱
خودش شاملِ `COUNT(*)` است. همیشه **دو لایه** بنویس: اول تجمیع با نامِ ستون، بعد ساختِ رشته.

```sql
-- ❌ خطا
SELECT k||' n'||COUNT(*) s FROM t GROUP BY 1

-- ✅ درست
SELECT group_concat(s,'; ') FROM (
  SELECT k||' n'||n s FROM (SELECT key k, COUNT(*) n FROM t GROUP BY k ORDER BY n DESC))
```

## ۱) پنجره و حجم
```sql
SELECT 'now' k, datetime('now') v
UNION ALL SELECT 'users_total', COUNT(*) FROM users WHERE telegram_id NOT IN (SELECT id FROM x)
UNION ALL SELECT 'users_new_post', COUNT(*) FROM users WHERE telegram_id NOT IN (SELECT id FROM x) AND created_at>=(SELECT t FROM c)
UNION ALL SELECT 'events_pre', COUNT(*) FROM events WHERE user_id NOT IN (SELECT id FROM x) AND created_at<(SELECT t FROM c)
UNION ALL SELECT 'events_post', COUNT(*) FROM events WHERE user_id NOT IN (SELECT id FROM x) AND created_at>=(SELECT t FROM c)
UNION ALL SELECT 'revenue_post', COALESCE(SUM(amount),0) FROM payments WHERE user_id NOT IN (SELECT id FROM x) AND status='approved' AND created_at>=(SELECT t FROM c);
```

## ۲) قیفِ رویدادی، قبل و بعد (مهم‌ترین کوئری)
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT event||' PRE '||SUM(created_at<(SELECT t FROM c))||'/'||COUNT(DISTINCT CASE WHEN created_at<(SELECT t FROM c) THEN user_id END)
       ||' POST '||SUM(created_at>=(SELECT t FROM c))||'/'||COUNT(DISTINCT CASE WHEN created_at>=(SELECT t FROM c) THEN user_id END) s
  FROM events WHERE user_id NOT IN (SELECT id FROM x) AND event NOT IN ('view','act')
  GROUP BY event ORDER BY event);
```
`n/u` = تعداد رویداد / کاربرِ یکتا. **همیشه `u` را برای قیف بخوان، `n` را برای شدت.**

## ۳) کاربرِ واقعاً فعال (تلهٔ رایج)
رویدادهای **ربات‌فرست** (`daily_reminder_sent`, `credit_granted`ِ بک‌فیل) کاربر را «فعال»
نشان می‌دهند بدون اینکه کاری کرده باشد. فعالِ واقعی = کسی که `act` دارد:
```sql
SELECT COUNT(DISTINCT user_id) FROM events
WHERE user_id NOT IN (SELECT id FROM x) AND event='act' AND created_at>=(SELECT t FROM c);
```

## ۴) اقدام‌های کاربر (کدام دکمه‌ها زده شدند)
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT COALESCE(json_extract(props,'$.d'),json_extract(props,'$.a'))||' n'||COUNT(*)||'/u'||COUNT(DISTINCT user_id) s
  FROM events WHERE user_id NOT IN (SELECT id FROM x) AND event='act' AND created_at>=(SELECT t FROM c)
  GROUP BY 1 ORDER BY COUNT(DISTINCT user_id) DESC LIMIT 30);
```
برای سنجشِ CTRِ یک پیامِ خاص (مثل پیامِ هدیه) `$.d` را با `callback_data` همان دکمه مقایسه کن.

## ۵) کاربرانِ گیرکرده + آخرین صفحه‌ای که دیدند (لیدِ داغ)
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT u.state||' u'||u.telegram_id||' bal'||u.balance
       ||' last='||COALESCE((SELECT json_extract(e.props,'$.k') FROM events e
            WHERE e.user_id=u.telegram_id AND e.event='view' ORDER BY e.id DESC LIMIT 1),'-') s
  FROM users u WHERE u.telegram_id NOT IN (SELECT id FROM x) AND u.state<>'idle' ORDER BY u.state);
```
کلیدِ صفحه را با `SELECT k,label,sample FROM screens WHERE k IN (...)` به متنِ واقعی وصل کن.

## ۶) پرداخت‌ها: کجا مُردند
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT status||'/'||COALESCE(step,'-')||' PRE '||SUM(created_at<(SELECT t FROM c))
       ||' POST '||SUM(created_at>=(SELECT t FROM c)) s
  FROM payments WHERE user_id NOT IN (SELECT id FROM x) GROUP BY status,step);
```
جزئیاتِ هر پرداختِ پنجره (برای تشخیصِ پرداختِ واقعیِ کاربر از اقدامِ دستیِ پشتیبانی):
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT 'p'||id||' u'||user_id||' amt'||amount||' orig'||COALESCE(original_amount,0)
       ||' '||status||'/'||COALESCE(step,'-') s
  FROM payments WHERE user_id NOT IN (SELECT id FROM x) AND created_at>=(SELECT t FROM c) ORDER BY id);
```
**هشدار:** ردیف‌هایی که از پنلِ پشتیبانی ساخته می‌شوند (شارژ/کسرِ دستی) پرداختِ کاربر نیستند.
`amt=0` یا `orig` بدونِ رسید معمولاً اقدامِ دستی است. قبل از گفتنِ «نرخِ تبدیل» جدایشان کن.

## ۷) فال‌ها: نوع × وضعیت
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT type||'/'||status||' PRE '||SUM(created_at<(SELECT t FROM c))
       ||' POST '||SUM(created_at>=(SELECT t FROM c)) s
  FROM readings WHERE user_id NOT IN (SELECT id FROM x) GROUP BY type,status);
```

## ۸) موجودیِ استفاده‌نشده (بعد از هر کمپینِ اعتبارِ هدیه اجباری)
```sql
SELECT group_concat(s,'; ') FROM (
  SELECT 'bal'||balance||' n'||COUNT(*) s FROM users
  WHERE telegram_id NOT IN (SELECT id FROM x) GROUP BY balance ORDER BY balance DESC);
```
اعتبارِ داده‌شده‌ی خرج‌نشده = هزینه‌ی فرصتِ کمپین. اگر توده‌ای دقیقاً روی مبلغِ هدیه نشسته،
یعنی هدیه دریافت شده ولی فعال نشده.
