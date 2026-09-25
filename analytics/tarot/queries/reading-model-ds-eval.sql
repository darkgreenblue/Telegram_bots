/* reading_model_ds re-evaluation, Q1 (metrics per arm).
   Aggregate-only: safe for plain Ops db-query (app=tarot, only=bot-fa.db).
   Output: one row per metric key k, with j = a JSON array of named fields.
   Legend and how to use: analytics/tarot/briefs/reading-model-ds-reevaluation.md
   Window: experiment start .. now (or stopped_at, if set). */
WITH
st AS (SELECT started_at s, stopped_at so FROM experiments WHERE key='reading_model_ds'),
nw AS (SELECT t, CAST((t+12600)/86400 AS INTEGER) d FROM (SELECT MIN(CAST(strftime('%s','now') AS INTEGER), COALESCE((SELECT so FROM st), 9000000000)) t)),
w0 AS (SELECT MIN((SELECT s FROM st) - 3600, (SELECT t FROM nw) - 31*86400) w),
fp AS MATERIALIZED (SELECT user_id uid, MIN(created_at) fpt FROM payments WHERE status='approved' GROUP BY user_id),
ex AS MATERIALIZED (
  SELECT x.user_id uid, x.variant arm, x.created_at xt, CAST((x.created_at+12600)/86400 AS INTEGER) xd,
         CASE WHEN u.created_at >= (SELECT s FROM st) THEN 1 ELSE 0 END nu,
         CASE WHEN fp.fpt < x.created_at THEN 1 ELSE 0 END pb,
         CASE WHEN u.first_source LIKE 'campaign:%' THEN 'cam' WHEN u.first_source LIKE 'referral%' OR u.first_source LIKE 'ref%' THEN 'ref' WHEN COALESCE(u.first_source,'')='' THEN 'unk' ELSE 'org' END src
  FROM ab_exposures x JOIN users u ON u.telegram_id = x.user_id LEFT JOIN fp ON fp.uid = x.user_id
  WHERE x.experiment_key='reading_model_ds' AND x.created_at < (SELECT t FROM nw) AND x.user_id NOT IN (429557996,409581917,100257975,5725984933)
),
lu AS MATERIALIZED (SELECT id, ref_id, kind, model, cost_usd, prompt_tokens, completion_tokens, cached_tokens, ms, user_id, created_at FROM llm_usage WHERE created_at >= (SELECT w FROM w0) AND created_at < (SELECT t FROM nw)),
rc AS (
  SELECT ref_id rid, SUM(cost_usd) usd,
         SUM(kind='reading') att, SUM(kind='repair') rep,
         SUM(CASE WHEN kind='repair' THEN cost_usd ELSE 0 END) usd_rep,
         SUM(CASE WHEN kind='reading' THEN prompt_tokens ELSE 0 END) tin,
         SUM(CASE WHEN kind='reading' THEN completion_tokens ELSE 0 END) tout,
         SUM(CASE WHEN kind='reading' THEN cached_tokens ELSE 0 END) tcache,
         SUM(kind='reading' AND model LIKE 'deepseek/deepseek-v4%') dsn,
         SUM(kind='reading' AND model LIKE 'openai/%') lun,
         SUM(CASE WHEN kind='reading' AND model LIKE 'deepseek/deepseek-v4%' THEN cost_usd ELSE 0 END) usd_ds,
         SUM(CASE WHEN kind='reading' THEN ms ELSE 0 END) lms
  FROM lu WHERE kind IN ('reading','repair') AND ref_id > 0 GROUP BY ref_id
),
sm AS (SELECT rid, model, ms FROM (SELECT ref_id rid, model, ms, ROW_NUMBER() OVER (PARTITION BY ref_id ORDER BY id DESC) rn FROM lu WHERE kind='reading' AND ref_id > 0) WHERE rn=1),
rwe AS MATERIALIZED (
  SELECT CAST(json_extract(e.props,'$.reading_id') AS INTEGER) rid, json_extract(e.props,'$.arm') arm, CAST(json_extract(e.props,'$.ms') AS REAL) ms, e.user_id uid
  FROM events e WHERE e.event='reading_wait' AND e.created_at >= (SELECT s FROM st) - 60 AND e.created_at < (SELECT t FROM nw) AND e.user_id NOT IN (429557996,409581917,100257975,5725984933)
),
rw AS (SELECT rid, MIN(arm) arm, MAX(ms) ms, COUNT(*) nwv FROM rwe GROUP BY rid),
fr AS (SELECT user_id uid, MIN(id) fid FROM readings GROUP BY user_id),
rg AS MATERIALIZED (
  SELECT r.id rid, r.user_id uid, r.price sz, r.status, r.feedback fb, r.created_at t, LENGTH(r.llm_json) lj, r.focus_area fa, r.type ty,
         CASE WHEN r.question_audio <> '' THEN 1 ELSE 0 END au,
         CASE WHEN fr.fid = r.id AND (fp.fpt IS NULL OR fp.fpt > r.created_at) AND r.price <= 3 THEN 1 ELSE 0 END ff,
         CASE WHEN fp.fpt IS NULL OR fp.fpt > r.created_at THEN 1 ELSE 0 END np,
         CASE WHEN r.created_at >= (SELECT s FROM st) - 900 THEN 1 ELSE 0 END inx,
         COALESCE(rw.arm,'none') arm, rw.ms ms,
         COALESCE(rc.usd,0) usd, COALESCE(rc.att,0) att, COALESCE(rc.rep,0) rep, COALESCE(rc.usd_rep,0) usd_rep,
         COALESCE(rc.tin,0) tin, COALESCE(rc.tout,0) tout, COALESCE(rc.tcache,0) tcache,
         COALESCE(rc.dsn,0) dsn, COALESCE(rc.lun,0) lun, COALESCE(rc.usd_ds,0) usd_ds, sm.ms sms,
         CASE WHEN r.feedback LIKE 'rate:%' THEN CAST(SUBSTR(r.feedback,6) AS INTEGER) ELSE 0 END sc,
         CASE WHEN sm.model LIKE 'deepseek/deepseek-v4%' THEN 'ds4' WHEN sm.model LIKE 'deepseek/%' THEN 'ds3' WHEN sm.model LIKE 'openai/%' THEN 'luna'
              WHEN sm.model LIKE 'google/%' THEN 'gem' WHEN sm.model IS NULL THEN 'nocall' ELSE 'other' END mf
  FROM readings r LEFT JOIN fr ON fr.uid = r.user_id LEFT JOIN fp ON fp.uid = r.user_id
       LEFT JOIN rw ON rw.rid = r.id LEFT JOIN rc ON rc.rid = r.id LEFT JOIN sm ON sm.rid = r.id
  WHERE r.created_at >= (SELECT w FROM w0) AND r.created_at < (SELECT t FROM nw) AND r.user_id NOT IN (429557996,409581917,100257975,5725984933)
),
pay AS MATERIALIZED (SELECT id, user_id, amount, created_at FROM payments WHERE status='approved' AND created_at < (SELECT t FROM nw)),
pa AS (
  SELECT ex.uid, COUNT(p.id) npay, COALESCE(SUM(p.amount),0) rev, MIN(p.created_at) p1t,
         SUM(CASE WHEN p.created_at < ex.xt+86400 THEN p.amount ELSE 0 END) rev24,
         SUM(CASE WHEN p.created_at < ex.xt+259200 THEN p.amount ELSE 0 END) rev72,
         SUM(CASE WHEN p.created_at < ex.xt+604800 THEN p.amount ELSE 0 END) rev7,
         SUM(CASE WHEN p.created_at < ex.xt+604800 THEN 1 ELSE 0 END) npay7
  FROM ex JOIN pay p ON p.user_id=ex.uid AND p.created_at>=ex.xt GROUP BY ex.uid
),
p12 AS (
  SELECT uid, MAX(CASE WHEN rn=1 THEN pt END) p1x, MAX(CASE WHEN rn=2 THEN pt END) p2x, MAX(CASE WHEN rn=1 THEN amt END) a1x FROM (
    SELECT ex.uid, p.created_at pt, p.amount amt, ROW_NUMBER() OVER (PARTITION BY ex.uid ORDER BY p.created_at, p.id) rn
    FROM ex JOIN pay p ON p.user_id=ex.uid AND p.created_at>=ex.xt) GROUP BY uid
),
ea AS (
  SELECT ex.uid,
    SUM(e.event='product_delivered') nd,
    SUM(e.event='product_delivered' AND e.created_at < ex.xt+172800) nd48,
    SUM(e.event='refund') nref, SUM(e.event='payment_rejected') nrej,
    COUNT(DISTINCT CASE WHEN e.event IN ('daily_card','lucky_card','product_delivered') THEN (e.created_at+12600)/86400 END) adays,
    MAX(CASE WHEN e.event IN ('daily_card','lucky_card','product_delivered') THEN (e.created_at+12600)/86400 END) lastd,
    MAX(CASE WHEN e.event IN ('daily_card','lucky_card','product_delivered') AND (e.created_at+12600)/86400 = ex.xd+1 THEN 1 ELSE 0 END) u1,
    MAX(CASE WHEN e.event IN ('daily_card','lucky_card','product_delivered') AND (e.created_at+12600)/86400 BETWEEN ex.xd+1 AND ex.xd+3 THEN 1 ELSE 0 END) u13,
    MAX(CASE WHEN e.event='product_delivered' AND (e.created_at+12600)/86400 BETWEEN ex.xd+1 AND ex.xd+3 THEN 1 ELSE 0 END) r13,
    MAX(CASE WHEN e.event='product_delivered' AND (e.created_at+12600)/86400 >= ex.xd+1 THEN 1 ELSE 0 END) rlater,
    MAX(CASE WHEN e.event IN ('daily_card','lucky_card','product_delivered') AND (e.created_at+12600)/86400 = ex.xd+7 THEN 1 ELSE 0 END) u7,
    MAX(CASE WHEN e.event IN ('daily_card','lucky_card','product_delivered') AND (e.created_at+12600)/86400 BETWEEN ex.xd+7 AND ex.xd+13 THEN 1 ELSE 0 END) w2
  FROM ex JOIN events e ON e.user_id=ex.uid AND e.created_at>=ex.xt AND e.created_at < (SELECT t FROM nw)
   AND e.event IN ('product_delivered','refund','payment_rejected','daily_card','lucky_card')
  GROUP BY ex.uid
),
uc AS (SELECT ex.uid, SUM(l.cost_usd) ucost FROM ex JOIN lu l ON l.user_id=ex.uid AND l.created_at>=ex.xt-900 GROUP BY ex.uid),
nbp AS (SELECT ex.uid, COUNT(r.rid) n FROM ex JOIN pa ON pa.uid = ex.uid JOIN rg r ON r.uid = ex.uid AND r.t > ex.xt AND r.t < pa.p1t GROUP BY ex.uid),
rs AS (
  SELECT ex.uid, COUNT(*) nr, SUM(r.sz) dia, SUM(r.sz>3) big
  FROM ex JOIN rg r ON r.uid=ex.uid AND r.t >= ex.xt-900 AND r.status IN ('delivered','started','paid') GROUP BY ex.uid
),
xu AS MATERIALIZED (
  SELECT ex.uid, ex.arm, ex.xt, ex.xd, ex.nu, ex.pb, ex.src,
    COALESCE(pa.npay,0) npay, COALESCE(pa.rev,0) rev, pa.p1t p1t, COALESCE(pa.rev24,0) rev24, COALESCE(pa.rev72,0) rev72,
    COALESCE(ea.nd,0) nd, COALESCE(ea.nd48,0) nd48, COALESCE(ea.nref,0) nref, COALESCE(ea.nrej,0) nrej,
    COALESCE(ea.adays,0) adays, ea.lastd lastd, COALESCE(ea.u1,0) u1, COALESCE(ea.u13,0) u13, COALESCE(ea.r13,0) r13, COALESCE(ea.rlater,0) rlater,
    COALESCE(uc.ucost,0) ucost, COALESCE(rs.nr,0) nr, COALESCE(rs.dia,0) dia, COALESCE(rs.big,0) big,
    COALESCE(pa.rev7,0) rev7, COALESCE(pa.npay7,0) npay7, COALESCE(ea.u7,0) u7, COALESCE(ea.w2,0) w2, p12.p2x p2t, COALESCE(p12.a1x,0) rev1, COALESCE(nbp.n,0) nbp
  FROM ex LEFT JOIN pa ON pa.uid=ex.uid LEFT JOIN ea ON ea.uid=ex.uid LEFT JOIN uc ON uc.uid=ex.uid LEFT JOIN rs ON rs.uid=ex.uid LEFT JOIN p12 ON p12.uid=ex.uid LEFT JOIN nbp ON nbp.uid=ex.uid
),
fbe AS MATERIALIZED (
  SELECT ex.arm, CAST(json_extract(e.props,'$.score') AS INTEGER) sc
  FROM ex JOIN events e ON e.user_id=ex.uid
  WHERE e.event='feedback' AND e.created_at>=ex.xt AND e.created_at < (SELECT t FROM nw) AND json_extract(e.props,'$.score') IS NOT NULL
),
wq AS (SELECT arm, ms, ROW_NUMBER() OVER (PARTITION BY arm ORDER BY ms) rk, COUNT(*) OVER (PARTITION BY arm) cnt FROM rwe WHERE ms IS NOT NULL),
adm AS (SELECT 429557996 u UNION ALL SELECT 409581917 UNION ALL SELECT 100257975 UNION ALL SELECT 5725984933),
nxt AS MATERIALIZED (
  SELECT a.rid, MAX(COALESCE(NULLIF(b.fa,''), b.ty) = COALESCE(NULLIF(a.fa,''), a.ty)) same, COUNT(b.rid) anyn
  FROM rg a JOIN rg b ON b.uid = a.uid AND b.rid > a.rid AND b.t <= a.t + 86400 AND b.status IN ('delivered','started','paid')
  WHERE a.inx = 1 AND a.au = 0 AND a.status = 'delivered' AND a.arm IN ('control','ds') AND a.t <= (SELECT t FROM nw) - 86400
  GROUP BY a.rid
)

SELECT 'meta' AS k, json_object('status', status, 'started_at', started_at, 'stopped_at', stopped_at, 'variants', json(variants_json), 'now', (SELECT t FROM nw), 'today_day', (SELECT d FROM nw), 'today', date((SELECT d FROM nw)*86400, 'unixepoch'), 'w0', (SELECT w FROM w0)) AS j FROM experiments WHERE key='reading_model_ds'
UNION ALL SELECT 'exp', json_group_array(json_object('arm', arm, 'users', n, 'first_xt', a1, 'last_xt', a2, 'new_users', nu, 'avg_xt', av)) FROM (SELECT arm, COUNT(*) n, MIN(xt) a1, MAX(xt) a2, SUM(nu) nu, AVG(xt) av FROM ex GROUP BY arm)
UNION ALL SELECT 'bal', json_group_array(json_object('arm', arm, 'src', src, 'nu', nu, 'pb', pb, 'users', n)) FROM (SELECT arm, src, nu, pb, COUNT(*) n FROM ex GROUP BY arm, src, nu, pb)
UNION ALL SELECT 'conv', json_group_array(json_object('arm', arm, 'nu', nu, 'pb', pb, 'users', n, 'payers', a1, 'payments', a2, 'rev_toman', a3, 'cost_usd', a4)) FROM (SELECT arm, nu, pb, COUNT(*) n, SUM(npay>0) a1, SUM(npay) a2, SUM(rev) a3, SUM(ucost) a4 FROM xu GROUP BY arm, nu, pb)
UNION ALL SELECT 'convw', json_group_array(json_object('arm', arm, 'elig24', a1, 'pay24', a2, 'elig72', a3, 'pay72', a4, 'rev72_toman', a5)) FROM (SELECT arm, SUM(xt <= (SELECT t FROM nw)-86400) a1, SUM(xt <= (SELECT t FROM nw)-86400 AND p1t IS NOT NULL AND p1t < xt+86400) a2, SUM(xt <= (SELECT t FROM nw)-259200) a3, SUM(xt <= (SELECT t FROM nw)-259200 AND p1t IS NOT NULL AND p1t < xt+259200) a4, SUM(CASE WHEN xt <= (SELECT t FROM nw)-259200 THEN rev72 ELSE 0 END) a5 FROM xu GROUP BY arm)
UNION ALL SELECT 'conv7', json_group_array(json_object('arm', arm, 'pb', pb, 'elig7', a1, 'payers7', a2, 'payments7', a3, 'rev7_toman', a4)) FROM (SELECT arm, pb, SUM(xt <= (SELECT t FROM nw)-604800) a1, SUM(xt <= (SELECT t FROM nw)-604800 AND npay7 > 0) a2, SUM(CASE WHEN xt <= (SELECT t FROM nw)-604800 THEN npay7 ELSE 0 END) a3, SUM(CASE WHEN xt <= (SELECT t FROM nw)-604800 THEN rev7 ELSE 0 END) a4 FROM xu GROUP BY arm, pb)
UNION ALL SELECT 'rep2', json_group_array(json_object('arm', arm, 'pb', pb, 'payers', a1, 'payers_2plus', a2, 'payers_mature7', a3, 'payers_mature7_2nd_within7d', a4)) FROM (SELECT arm, pb, SUM(npay >= 1) a1, SUM(npay >= 2) a2, SUM(npay >= 1 AND p1t <= (SELECT t FROM nw) - 604800) a3, SUM(npay >= 2 AND p1t <= (SELECT t FROM nw) - 604800 AND p2t < p1t + 604800) a4 FROM xu GROUP BY arm, pb)
UNION ALL SELECT 'revsplit', json_group_array(json_object('arm', arm, 'pb', pb, 'payers', a1, 'rev_first_payment', a2, 'rev_later_payments', a3)) FROM (SELECT arm, pb, SUM(npay >= 1) a1, SUM(rev1) a2, SUM(rev) - SUM(rev1) a3 FROM xu GROUP BY arm, pb)
UNION ALL SELECT 'paytiming', json_group_array(json_object('arm', arm, 'pb', pb, 'payers', a1, 'pay_within_1h', a2, 'pay_within_6h', a3, 'pay_before_2nd_reading', a4)) FROM (SELECT arm, pb, SUM(npay >= 1) a1, SUM(npay >= 1 AND p1t < xt + 3600) a2, SUM(npay >= 1 AND p1t < xt + 21600) a3, SUM(npay >= 1 AND nbp = 0) a4 FROM xu GROUP BY arm, pb)
UNION ALL SELECT 'revh', json_group_array(json_object('arm', arm, 'pb', pb, 'rev_toman', rev, 'users', n)) FROM (SELECT arm, pb, rev, COUNT(*) n FROM xu GROUP BY arm, pb, rev)
UNION ALL SELECT 'rev7h', json_group_array(json_object('arm', arm, 'pb', pb, 'rev7_toman', rev7, 'users', n)) FROM (SELECT arm, pb, rev7, COUNT(*) n FROM xu WHERE xt <= (SELECT t FROM nw) - 604800 GROUP BY arm, pb, rev7)
UNION ALL SELECT 'ucost', json_group_array(json_object('arm', arm, 'users', n, 'sum_usd', a1, 'sum_sq_usd', a2)) FROM (SELECT arm, COUNT(*) n, SUM(ucost) a1, SUM(ucost*ucost) a2 FROM xu GROUP BY arm)
UNION ALL SELECT 'ret', json_group_array(json_object('arm', arm, 'users', n, 'nd1', a1, 'nd2', a2, 'nd3', a3, 'nd_sum', a4)) FROM (SELECT arm, COUNT(*) n, SUM(nd>=1) a1, SUM(nd>=2) a2, SUM(nd>=3) a3, SUM(nd) a4 FROM xu GROUP BY arm)
UNION ALL SELECT 'ret48', json_group_array(json_object('arm', arm, 'elig48', a1, 'nd48_2plus', a2, 'nd48_1plus', a3, 'nd48_sum', a4)) FROM (SELECT arm, SUM(xt <= (SELECT t FROM nw)-172800) a1, SUM(xt <= (SELECT t FROM nw)-172800 AND nd48>=2) a2, SUM(xt <= (SELECT t FROM nw)-172800 AND nd48>=1) a3, SUM(CASE WHEN xt <= (SELECT t FROM nw)-172800 THEN nd48 ELSE 0 END) a4 FROM xu GROUP BY arm)
UNION ALL SELECT 'd1', json_group_array(json_object('arm', arm, 'elig_d1', a1, 'active_d1', a2, 'elig_d13', a3, 'active_d13', a4, 'reading_d13', a5)) FROM (SELECT arm, SUM(xd <= (SELECT d FROM nw)-2) a1, SUM(xd <= (SELECT d FROM nw)-2 AND u1=1) a2, SUM(xd <= (SELECT d FROM nw)-4) a3, SUM(xd <= (SELECT d FROM nw)-4 AND u13=1) a4, SUM(xd <= (SELECT d FROM nw)-4 AND r13=1) a5 FROM xu GROUP BY arm)
UNION ALL SELECT 'd7', json_group_array(json_object('arm', arm, 'elig_d7', a1, 'active_d7', a2, 'elig_w2', a3, 'active_w2', a4)) FROM (SELECT arm, SUM(xd <= (SELECT d FROM nw)-8) a1, SUM(xd <= (SELECT d FROM nw)-8 AND u7=1) a2, SUM(xd <= (SELECT d FROM nw)-14) a3, SUM(xd <= (SELECT d FROM nw)-14 AND w2=1) a4 FROM xu GROUP BY arm)
UNION ALL SELECT 'stick', json_group_array(json_object('arm', arm, 'elig3', a1, 'adays2', a2, 'adays3', a3, 'still_active', a4, 'avg_adays', a5)) FROM (SELECT arm, SUM(xd <= (SELECT d FROM nw)-3) a1, SUM(xd <= (SELECT d FROM nw)-3 AND adays>=2) a2, SUM(xd <= (SELECT d FROM nw)-3 AND adays>=3) a3, SUM(xd <= (SELECT d FROM nw)-3 AND lastd >= (SELECT d FROM nw)-1) a4, AVG(CASE WHEN xd <= (SELECT d FROM nw)-3 THEN adays END) a5 FROM xu GROUP BY arm)
UNION ALL SELECT 'spend', json_group_array(json_object('arm', arm, 'users', n, 'readings', a1, 'diamonds', a2, 'big_readings', a3, 'reading_later_day', a4)) FROM (SELECT arm, COUNT(*) n, SUM(nr) a1, SUM(dia) a2, SUM(big) a3, SUM(rlater) a4 FROM xu GROUP BY arm)
UNION ALL SELECT 'guard', json_group_array(json_object('arm', arm, 'users_refund', a1, 'refunds', a2, 'users_rejected', a3, 'rejections', a4)) FROM (SELECT arm, SUM(nref>0) a1, SUM(nref) a2, SUM(nrej>0) a3, SUM(nrej) a4 FROM xu GROUP BY arm)
UNION ALL SELECT 'fb_ev', json_group_array(json_object('arm', arm, 'n', n, 'avg', a1, 'low12', a2, 's5', a3, 's4', a4)) FROM (SELECT arm, COUNT(*) n, AVG(sc) a1, SUM(sc<=2) a2, SUM(sc=5) a3, SUM(sc=4) a4 FROM fbe GROUP BY arm)
UNION ALL SELECT 'fbd', json_group_array(json_object('arm', arm, 'score', sc, 'n', n)) FROM (SELECT arm, sc, COUNT(*) n FROM fbe GROUP BY arm, sc)
UNION ALL SELECT 'fb_rd', json_group_array(json_object('arm', arm, 'mf', mf, 'delivered', a1, 'rated', a2, 'avg', a3, 'low12', a4, 's5', a5)) FROM (SELECT arm, mf, SUM(status='delivered') a1, SUM(sc>0) a2, AVG(CASE WHEN sc>0 THEN sc END) a3, SUM(sc>0 AND sc<=2) a4, SUM(sc=5) a5 FROM rg WHERE arm IN ('control','ds') GROUP BY arm, mf)
UNION ALL SELECT 'fb_ff', json_group_array(json_object('arm', arm, 'ff', ff, 'delivered', a1, 'rated', a2, 'avg', a3, 'low12', a4, 'avg_usd', a5)) FROM (SELECT arm, ff, SUM(status='delivered') a1, SUM(sc>0) a2, AVG(CASE WHEN sc>0 THEN sc END) a3, SUM(sc>0 AND sc<=2) a4, AVG(usd) a5 FROM rg WHERE arm IN ('control','ds') GROUP BY arm, ff)
UNION ALL SELECT 'fbs', json_group_array(json_object('arm', arm, 'mf', mf, 'ff', ff, 'np', np, 'delivered', dl, 'score', sc, 'n', n)) FROM (SELECT arm, mf, ff, np, (status='delivered') dl, sc, COUNT(*) n FROM rg WHERE arm IN ('control','ds') GROUP BY arm, mf, ff, np, (status='delivered'), sc)
UNION ALL SELECT 'wait', json_group_array(json_object('arm', arm, 'n', a0, 'avg_ms', a1, 'p50_ms', a2, 'p90_ms', a3, 'p99_ms', a4)) FROM (SELECT arm, MAX(cnt) a0, AVG(ms) a1, MAX(CASE WHEN rk = CAST(0.5*cnt AS INTEGER) + (0.5*cnt > CAST(0.5*cnt AS INTEGER)) THEN ms END) a2, MAX(CASE WHEN rk = CAST(0.9*cnt AS INTEGER) + (0.9*cnt > CAST(0.9*cnt AS INTEGER)) THEN ms END) a3, MAX(CASE WHEN rk = CAST(0.99*cnt AS INTEGER) + (0.99*cnt > CAST(0.99*cnt AS INTEGER)) THEN ms END) a4 FROM wq GROUP BY arm)
UNION ALL SELECT 'wait_tail', json_group_array(json_object('arm', arm, 'n', n, 'waited', a1, 'gt20s', a2, 'gt60s', a3, 'gt120s', a4)) FROM (SELECT arm, COUNT(*) n, SUM(ms>0) a1, SUM(ms>20000) a2, SUM(ms>60000) a3, SUM(ms>120000) a4 FROM rwe GROUP BY arm)
UNION ALL SELECT 'model', json_group_array(json_object('arm', arm, 'mf', mf, 'readings', n, 'avg_usd', a1, 'avg_attempts', a2, 'delivered', a3, 'refunded', a4)) FROM (SELECT arm, mf, COUNT(*) n, AVG(usd) a1, AVG(att) a2, SUM(status='delivered') a3, SUM(status='refunded') a4 FROM rg WHERE arm IN ('control','ds') GROUP BY arm, mf)
UNION ALL SELECT 'st', json_group_array(json_object('arm', arm, 'status', status, 'n', n, 'avg_usd', a1)) FROM (SELECT arm, status, COUNT(*) n, AVG(usd) a1 FROM rg WHERE inx=1 GROUP BY arm, status)
UNION ALL SELECT 'size', json_group_array(json_object('arm', arm, 'size', sz, 'n', n, 'avg_usd', a1, 'avg_attempts', a2, 'avg_repairs', a3, 'avg_usd_repair', a4)) FROM (SELECT arm, sz, COUNT(*) n, AVG(usd) a1, AVG(att) a2, AVG(rep) a3, AVG(usd_rep) a4 FROM rg WHERE arm IN ('control','ds') GROUP BY arm, sz)
UNION ALL SELECT 'tok', json_group_array(json_object('arm', arm, 'mf', mf, 'size', sz, 'n', n, 'avg_in', a1, 'avg_out', a2, 'avg_cached', a3, 'avg_usd', a4)) FROM (SELECT arm, mf, sz, COUNT(*) n, AVG(tin) a1, AVG(tout) a2, AVG(tcache) a3, AVG(usd) a4 FROM rg WHERE arm IN ('control','ds') AND att=1 AND rep=0 GROUP BY arm, mf, sz)
UNION ALL SELECT 'lat', json_group_array(json_object('arm', arm, 'mf', mf, 'n', n, 'avg_model_ms', a1, 'max_model_ms', a2, 'avg_wait_ms', a3)) FROM (SELECT arm, mf, COUNT(*) n, AVG(sms) a1, MAX(sms) a2, AVG(ms) a3 FROM rg WHERE arm IN ('control','ds') AND sms IS NOT NULL GROUP BY arm, mf)
UNION ALL SELECT 'reask', json_group_array(json_object('arm', arm, 'np', np, 'delivered_mature', n, 'reask_same_topic_24h', a1, 'reask_any_24h', a2)) FROM (SELECT g.arm arm, g.np np, COUNT(*) n, SUM(COALESCE(x.same,0)) a1, SUM(COALESCE(x.anyn,0) > 0) a2 FROM rg g LEFT JOIN nxt x ON x.rid = g.rid WHERE g.inx = 1 AND g.au = 0 AND g.status = 'delivered' AND g.arm IN ('control','ds') AND g.t <= (SELECT t FROM nw) - 86400 GROUP BY g.arm, g.np)
UNION ALL SELECT 'dconv', json_group_array(json_object('date', date(xd*86400, 'unixepoch'), 'arm', arm, 'exposed', n, 'new_users', a1, 'first_payers', a2, 'payers', a3, 'rev_toman', a4)) FROM (SELECT xd, arm, COUNT(*) n, SUM(nu) a1, SUM(pb = 0 AND npay > 0) a2, SUM(npay > 0) a3, SUM(rev) a4 FROM xu GROUP BY xd, arm)
UNION ALL SELECT 'dsat', json_group_array(json_object('date', date(dd*86400, 'unixepoch'), 'arm', arm, 'readings', n, 'delivered', a1, 'rated', a2, 'sum_score', a3, 'served_luna', a4, 'waited', a5)) FROM (SELECT CAST((t+12600)/86400 AS INTEGER) dd, arm, COUNT(*) n, SUM(status='delivered') a1, SUM(status='delivered' AND sc>0) a2, SUM(CASE WHEN status='delivered' THEN sc ELSE 0 END) a3, SUM(mf='luna') a4, SUM(ms > 0) a5 FROM rg WHERE arm IN ('control','ds') GROUP BY dd, arm)
UNION ALL SELECT 'kind', json_group_array(json_object('kind', kind, 'calls', n, 'usd', a1, 'first', a2, 'last', a3, 'usd_admin', a4)) FROM (SELECT kind, COUNT(*) n, SUM(cost_usd) a1, MIN(created_at) a2, MAX(created_at) a3, SUM(CASE WHEN user_id IN (SELECT u FROM adm) THEN cost_usd ELSE 0 END) a4 FROM lu WHERE created_at >= (SELECT s FROM st) GROUP BY kind)
UNION ALL SELECT 'dcost', json_group_array(json_object('date', date(dd*86400, 'unixepoch'), 'calls', n, 'usd', a1, 'usd_reading', a2, 'usd_admin', a3)) FROM (SELECT CAST((created_at+12600)/86400 AS INTEGER) dd, COUNT(*) n, SUM(cost_usd) a1, SUM(CASE WHEN kind='reading' THEN cost_usd ELSE 0 END) a2, SUM(CASE WHEN user_id IN (SELECT u FROM adm) THEN cost_usd ELSE 0 END) a3 FROM lu WHERE created_at >= (SELECT t FROM nw) - 31*86400 GROUP BY dd)
UNION ALL SELECT 'drev', json_group_array(json_object('date', date(dd*86400, 'unixepoch'), 'payments', n, 'rev_toman', a1, 'payers', a2)) FROM (SELECT CAST((created_at+12600)/86400 AS INTEGER) dd, COUNT(*) n, SUM(amount) a1, COUNT(DISTINCT user_id) a2 FROM payments WHERE status='approved' AND created_at >= (SELECT t FROM nw) - 31*86400 AND created_at < (SELECT t FROM nw) AND user_id NOT IN (SELECT u FROM adm) GROUP BY dd)
UNION ALL SELECT 'dusr', json_group_array(json_object('date', date(dd*86400, 'unixepoch'), 'new_users', n, 'campaign', a1, 'ref', a2)) FROM (SELECT CAST((created_at+12600)/86400 AS INTEGER) dd, COUNT(*) n, SUM(first_source LIKE 'campaign:%') a1, SUM(first_source LIKE 'ref%') a2 FROM users WHERE created_at >= (SELECT t FROM nw) - 45*86400 AND created_at < (SELECT t FROM nw) AND telegram_id NOT IN (SELECT u FROM adm) GROUP BY dd)
UNION ALL SELECT 'drd', json_group_array(json_object('date', date(dd*86400, 'unixepoch'), 'readings', n, 'delivered', a1, 'usd', a2, 'audio', a3, 'first_free', a4)) FROM (SELECT CAST((t+12600)/86400 AS INTEGER) dd, COUNT(*) n, SUM(status='delivered') a1, SUM(usd) a2, SUM(au) a3, SUM(ff) a4 FROM rg WHERE t >= (SELECT t FROM nw) - 31*86400 GROUP BY dd)
UNION ALL SELECT 'noneX', json_group_array(json_object('mf', mf, 'status', status, 'n', n, 'usd', a1)) FROM (SELECT mf, status, COUNT(*) n, SUM(usd) a1 FROM rg WHERE arm='none' AND inx=1 AND au=0 GROUP BY mf, status)
UNION ALL SELECT 'xp', json_group_array(json_object('arm', arm, 'exp', ek, 'variant', vr, 'users', n)) FROM (SELECT ex.arm arm, p.experiment_key ek, p.variant vr, COUNT(*) n FROM ex JOIN ab_exposures p ON p.user_id=ex.uid AND p.experiment_key <> 'reading_model_ds' AND p.experiment_key IN (SELECT key FROM experiments WHERE status IN ('running','draining') OR stopped_at >= (SELECT s FROM st)) GROUP BY ex.arm, p.experiment_key, p.variant)
UNION ALL SELECT 'exps', json_group_array(json_object('key', key, 'status', status, 'started_at', started_at, 'stopped_at', stopped_at, 'variants', json(variants_json))) FROM experiments WHERE status IN ('running','draining') OR stopped_at >= (SELECT s FROM st)
UNION ALL SELECT 'rwdup', json_group_array(json_object('arm', arm, 'n', n, 'dup', a1)) FROM (SELECT arm, COUNT(*) n, SUM(nwv>1) a1 FROM rw GROUP BY arm)
UNION ALL SELECT 'rev_all', json_object('payments', COUNT(*), 'rev_toman', SUM(amount)) FROM payments WHERE status='approved' AND created_at >= (SELECT s FROM st) AND created_at < (SELECT t FROM nw) AND user_id NOT IN (SELECT u FROM adm)
