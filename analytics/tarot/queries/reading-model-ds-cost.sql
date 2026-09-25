/* reading_model_ds re-evaluation, Q2 (model cost by segment x arm, for routing scenarios).
   Aggregate-only: safe for plain Ops db-query (app=tarot, only=bot-fa.db).
   Window: the last 7 full Tehran days, never before the first full day of the experiment,
   and never after stopped_at. Legend and scenario formula: analytics/tarot/briefs/reading-model-ds-reevaluation.md */
WITH
st AS (SELECT started_at AS t0, stopped_at AS t1 FROM experiments WHERE key='reading_model_ds'),
win0 AS (SELECT ((t0 + 12600) / 86400 + 1) * 86400 - 12600 AS ws0,
  ((MIN(CAST(strftime('%s','now') AS INTEGER), COALESCE(t1, 9000000000)) + 12600) / 86400) * 86400 - 12600 AS we FROM st),
win AS (SELECT MAX(ws0, we - 7 * 86400) AS ws, we FROM win0),
u AS MATERIALIZED (
  SELECT user_id AS luid, kind, ref_id, model, cost_usd
  FROM llm_usage WHERE created_at >= (SELECT ws FROM win) AND created_at < (SELECT we FROM win)
),
refs AS MATERIALIZED (SELECT DISTINCT ref_id AS rid FROM u WHERE ref_id > 0),
ru AS MATERIALIZED (SELECT DISTINCT user_id AS uid FROM readings WHERE id IN (SELECT rid FROM refs)),
wb AS MATERIALIZED (
  SELECT user_id AS uid, MAX(CAST(json_extract(props,'$.amount') AS INTEGER)) AS w
  FROM events WHERE user_id IN (SELECT uid FROM ru) AND event = 'credit_granted' AND json_extract(props,'$.kind') = 'welcome'
  GROUP BY user_id
),
fp AS MATERIALIZED (
  SELECT user_id AS uid, MIN(created_at) AS fpt FROM payments
  WHERE status = 'approved' AND user_id IN (SELECT uid FROM ru) GROUP BY user_id
),
ur AS MATERIALIZED (
  SELECT id, user_id, price, status, created_at, CASE WHEN COALESCE(question_audio,'') <> '' THEN 1 ELSE 0 END AS au
  FROM readings WHERE user_id IN (SELECT uid FROM ru)
),
seq AS MATERIALIZED (
  SELECT id, user_id, price, status, created_at, au,
    COALESCE(SUM(CASE WHEN status IN ('paid','started','delivered','canceled') THEN price ELSE 0 END)
      OVER (PARTITION BY user_id ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
  FROM ur
),
rw AS MATERIALIZED (
  SELECT CAST(json_extract(props,'$.reading_id') AS INTEGER) AS rid, MIN(json_extract(props,'$.arm')) AS arm, COUNT(*) AS nw
  FROM events WHERE event = 'reading_wait' AND created_at >= (SELECT t0 FROM st) - 60
  GROUP BY 1
),
ex AS MATERIALIZED (SELECT user_id AS uid, variant FROM ab_exposures WHERE experiment_key = 'reading_model_ds'),
rc AS MATERIALIZED (
  SELECT ref_id AS rid, SUM(cost_usd) AS usd, COUNT(*) AS calls,
    SUM(CASE WHEN kind IN ('reading','repair') THEN cost_usd ELSE 0 END) AS usd_rr,
    MAX(CASE WHEN kind = 'reading' AND model LIKE 'deepseek/deepseek-v4%' THEN 1 ELSE 0 END) AS hasds
  FROM u WHERE ref_id > 0 AND luid NOT IN (429557996,409581917,100257975,5725984933) GROUP BY ref_id
),
x AS MATERIALIZED (
  SELECT s.id, s.price, s.au, rc.usd, rc.calls, rc.usd_rr, rc.hasds, COALESCE(rw.nw, 0) AS nw,
    CASE WHEN s.price > 0 THEN MAX(0, MIN(s.price, COALESCE(wb.w, 0) - s.before)) * 1.0 / s.price ELSE 0 END AS f,
    CASE WHEN fp.fpt IS NULL OR fp.fpt > s.created_at THEN 1 ELSE 0 END AS np,
    CASE WHEN s.au = 1 THEN 'audio'
         WHEN s.created_at < (SELECT t0 FROM st) THEN 'pre'
         WHEN rw.arm IN ('control','ds') THEN rw.arm
         ELSE 'u_' || COALESCE(ex.variant, 'none') END AS arm
  FROM seq s JOIN rc ON rc.rid = s.id
  LEFT JOIN wb ON wb.uid = s.user_id LEFT JOIN fp ON fp.uid = s.user_id
  LEFT JOIN rw ON rw.rid = s.id LEFT JOIN ex ON ex.uid = s.user_id
  WHERE s.user_id NOT IN (429557996,409581917,100257975,5725984933)
),
y AS MATERIALIZED (SELECT x.*, CASE WHEN f > 0 THEN 'w' WHEN np = 1 THEN 'g' ELSE 'p' END AS seg FROM x)
SELECT 'W_window' AS k, date((ws + 12600) / 86400 * 86400, 'unixepoch') || '..' || date((we + 12600) / 86400 * 86400 - 86400, 'unixepoch') || ' [' || ws || ',' || we || ')' AS grp, (we - ws) / 86400 AS n, NULL AS usd, NULL AS usd_rr, NULL AS n_hasds FROM win
UNION ALL SELECT 'A_all_nonadmin', '', COUNT(*), ROUND(SUM(cost_usd),5), NULL, NULL FROM u WHERE luid NOT IN (429557996,409581917,100257975,5725984933)
UNION ALL SELECT 'B_matched', '', COUNT(*), ROUND(SUM(usd),5), ROUND(SUM(usd_rr),5), SUM(calls) FROM y
UNION ALL SELECT 'C_seg_arm', seg || ':' || arm, COUNT(*), ROUND(SUM(usd),5), ROUND(SUM(usd_rr),5), SUM(hasds) FROM y GROUP BY seg, arm
UNION ALL SELECT 'D_seg_arm_size', seg || ':' || arm || ':' || price, COUNT(*), ROUND(SUM(usd),5), ROUND(SUM(usd_rr),5), SUM(hasds) FROM y WHERE arm IN ('control','ds') GROUP BY seg, arm, price
UNION ALL SELECT 'E_price0', seg, COUNT(*), ROUND(SUM(usd),5), NULL, NULL FROM y WHERE price = 0 GROUP BY seg
UNION ALL SELECT 'F_multiwait', '', SUM(nw > 1), NULL, NULL, NULL FROM y
UNION ALL SELECT 'G_exp', status || ':' || COALESCE(started_at,'') || ':' || variants_json, NULL, NULL, NULL, NULL FROM experiments WHERE key = 'reading_model_ds'
UNION ALL SELECT 'H_by_model_all', model, COUNT(*), ROUND(SUM(cost_usd),5), NULL, NULL FROM u GROUP BY model
