-- price_ladder_p6_gold_25: درآمد و ترکیبِ بسته per بازو (فقط تجمیعی، پس db-query ِ ساده کافی است).
-- اجرا: Ops → db-query روی app=tarot (bot-fa.db).
-- متریکِ تصمیم: rev_per_exposed (درآمدِ کل ÷ کاربرِ exposed). ترکیبِ بسته (n_basic/n_gold/n_magic)
-- خودِ فرضیه را می‌سنجد: آیا gold کمتر و magic بیشتر شد بدونِ جهشِ basic؟
-- فقط پرداختِ تأییدشده‌ای شمرده می‌شود که ردیفش **بعد از** exposure ساخته شده.
WITH ex(id) AS (VALUES (429557996),(409581917),(100257975),(5725984933)),
x AS MATERIALIZED (
  SELECT user_id, variant, created_at FROM ab_exposures
  WHERE experiment_key='price_ladder_p6_gold_25' AND user_id NOT IN (SELECT id FROM ex)
),
p AS MATERIALIZED (
  SELECT x.variant, pa.user_id, pa.amount, pa.pkg
  FROM x JOIN payments pa ON pa.user_id=x.user_id
  WHERE pa.status='approved' AND pa.created_at >= x.created_at
)
SELECT x.variant,
  COUNT(*) AS exposed,
  (SELECT COUNT(DISTINCT user_id) FROM p WHERE p.variant=x.variant) AS payers,
  (SELECT COALESCE(SUM(amount),0) FROM p WHERE p.variant=x.variant) AS revenue,
  ROUND((SELECT COALESCE(SUM(amount),0) FROM p WHERE p.variant=x.variant) * 1.0 / COUNT(*)) AS rev_per_exposed,
  (SELECT COUNT(*) FROM p WHERE p.variant=x.variant AND pkg='basic') AS n_basic,
  (SELECT COUNT(*) FROM p WHERE p.variant=x.variant AND pkg='gold')  AS n_gold,
  (SELECT COUNT(*) FROM p WHERE p.variant=x.variant AND pkg='magic') AS n_magic
FROM x GROUP BY x.variant;
