/* 🌳 اتریبیوشنِ نسلیِ کمپین‌ها — کوئریِ مرجع (بازسازی‌شده و ذخیره‌شده ۱۴۰۵/۰۷/۰۴)
 *
 * گزارش: analytics/tarot/reports/2026-09-26-generational-attribution-recheck.md
 * قاعده: bots/tarot/CLAUDE.md بخشِ «🌳 قاعده‌ی ماندگار: هر حسابِ منفعتِ رفرال نسلی است».
 * ⚠️ کوئریِ دورِ اول (۲۰ شهریور) در ریپو ذخیره نشده بود؛ این نسخه از روشِ مکتوبِ همان
 *    گزارش بازسازی شد و درآمدِ پیش‌از-پنجره‌ی لایه‌های ۱+ را دقیقاً همان ۸۱۵٬۰۰۰ درآورد.
 *
 * اجرا: Ops → db-query، app=tarot، only=bot-fa.db (خروجی فقط تجمیعی است؛ ~۵۰ ردیف).
 * قبلش دو ورودی را تازه کن:
 *   ۱) p0 = مرزِ دورِ قبل (unix). این‌جا ۱۱ سپتامبر ۰۸:۴۰ UTC.
 *   ۲) cc = نرخِ تبلیغِ روزانه (دلار per کاربرِ کمپین) از داشبورد:
 *      Ops → db-query، app=dashboard:
 *      SELECT day, usd FROM campaign_costs WHERE bot='tarot'
 *      روزِ واردنشده میانگینِ وزنی می‌گیرد (همان campaignCostModel داشبورد).
 *
 * ساختار:
 *   anc  = بالا رفتن از هر گره تا ریشه با ایندکسِ یکتای referrals.referee_id (سریع، بدونِ
 *          اسکنِ تو-در-تو). ریشه = گره‌ای که پدرِ موجود در users ندارد.
 *   n    = هر کاربر (بجز ادمین) + ریشه + عمق + کانالِ ریشه + درآمد/هزینه (کلِ عمر و پنجره).
 *   بخش‌ها: M متادیتا و راستی‌آزمایی · L per لایه · C per کانال (کلِ عمر، پنجره، کوهورت).
 *   رشته‌ی لایه‌ها: lvl:users:payers:rev:usd با فاصله.
 *
 * دامِ دوباره‌شماری: پاداشِ دعوت داخلِ llm_usageِ همان گره است؛ جدا اضافه نشود.
 * هر کاربر یک پدر دارد (referee_id UNIQUE)، پس در یک زیردرخت شمرده می‌شود.
 */
WITH RECURSIVE
adm(id) AS (VALUES (429557996),(409581917),(100257975),(5725984933)),
p0(t) AS (VALUES (1789116036)),
cc(d, usd) AS (VALUES ('2026-09-04',0.0169),('2026-09-05',0.0103),('2026-09-06',0.0049),('2026-09-07',0.0048),('2026-09-08',0.0065),('2026-09-09',0.0058),('2026-09-10',0.0035),('2026-09-11',0.005),('2026-09-12',0.0061),('2026-09-13',0.0062),('2026-09-14',0.0069),('2026-09-15',0.0082),('2026-09-16',0.007),('2026-09-17',0.0054),('2026-09-18',0.0034),('2026-09-19',0.0052)),
u AS MATERIALIZED (SELECT telegram_id uid, created_at t, first_source src, strftime('%Y-%m-%d', created_at + 12600, 'unixepoch') d FROM users),
anc(uid, cur, lvl) AS (
  SELECT uid, uid, 0 FROM u
  UNION ALL
  SELECT anc.uid, r.referrer_id, anc.lvl + 1 FROM anc JOIN referrals r ON r.referee_id = anc.cur
  WHERE anc.lvl < 40 AND r.referrer_id <> r.referee_id AND r.referrer_id IN (SELECT uid FROM u)),
ancm AS MATERIALIZED (SELECT * FROM anc),
dep AS MATERIALIZED (SELECT uid, MAX(lvl) m FROM ancm GROUP BY uid),
tr AS MATERIALIZED (SELECT a.uid, a.cur root, a.lvl FROM ancm a JOIN dep ON dep.uid = a.uid AND dep.m = a.lvl),
pay AS MATERIALIZED (SELECT user_id uid, SUM(amount) rev, SUM(CASE WHEN created_at >= (SELECT t FROM p0) THEN amount ELSE 0 END) rev_w FROM payments WHERE status = 'approved' GROUP BY user_id),
lu AS MATERIALIZED (SELECT user_id uid, SUM(cost_usd) usd, SUM(CASE WHEN created_at >= (SELECT t FROM p0) THEN cost_usd ELSE 0 END) usd_w FROM llm_usage WHERE user_id > 0 GROUP BY user_id),
cu AS MATERIALIZED (SELECT d, COUNT(*) n FROM u WHERE src LIKE 'campaign:%' AND uid NOT IN (SELECT id FROM adm) GROUP BY d),
avgr(v) AS (SELECT SUM(cc.usd * COALESCE(cu.n, 0)) / NULLIF(SUM(COALESCE(cu.n, 0)), 0) FROM cc LEFT JOIN cu ON cu.d = cc.d),
n AS MATERIALIZED (
  SELECT tr.uid, tr.root, tr.lvl, x.t, r.t root_t,
    CASE WHEN r.src LIKE 'campaign:%' THEN substr(r.src, 10) WHEN r.src IN ('', 'organic') THEN '~organic' WHEN r.src LIKE 'referral:%' THEN '~ref_orphan' ELSE '~other' END ch,
    COALESCE(pay.rev, 0) rev, COALESCE(pay.rev_w, 0) rev_w, COALESCE(lu.usd, 0) usd, COALESCE(lu.usd_w, 0) usd_w,
    CASE WHEN tr.lvl = 0 AND r.src LIKE 'campaign:%' THEN COALESCE((SELECT usd FROM cc WHERE cc.d = x.d), (SELECT v FROM avgr)) ELSE 0 END ad
  FROM tr JOIN u x ON x.uid = tr.uid JOIN u r ON r.uid = tr.root
  LEFT JOIN pay ON pay.uid = tr.uid LEFT JOIN lu ON lu.uid = tr.uid
  WHERE tr.uid NOT IN (SELECT id FROM adm)),
lay AS (SELECT ch, lvl, COUNT(*) c, SUM(rev > 0) p, SUM(rev) rv, SUM(usd) us FROM n GROUP BY ch, lvl),
layk AS (SELECT ch, lvl, COUNT(*) c, SUM(rev > 0) p, SUM(rev) rv, SUM(usd) us FROM n WHERE root_t >= (SELECT t FROM p0) GROUP BY ch, lvl),
ls AS (SELECT ch, GROUP_CONCAT(lvl || ':' || c || ':' || p || ':' || rv || ':' || printf('%.3f', us), ' ') s FROM (SELECT * FROM lay ORDER BY ch, lvl) GROUP BY ch),
lsk AS (SELECT ch, GROUP_CONCAT(lvl || ':' || c || ':' || p || ':' || rv || ':' || printf('%.3f', us), ' ') s FROM (SELECT * FROM layk ORDER BY ch, lvl) GROUP BY ch),
agg AS (SELECT ch,
    SUM(lvl = 0) roots, COUNT(*) tree, SUM(rev > 0) payers, SUM(rev) rev, ROUND(SUM(usd), 4) usd, ROUND(SUM(ad), 4) ad,
    SUM(CASE WHEN lvl = 0 THEN rev ELSE 0 END) root_rev, ROUND(SUM(CASE WHEN lvl = 0 THEN usd ELSE 0 END), 4) root_usd, SUM(lvl = 0 AND rev > 0) root_payers,
    SUM(rev_w) rev_w, ROUND(SUM(usd_w), 4) usd_w,
    SUM(lvl = 0 AND t >= (SELECT t FROM p0)) roots_w, ROUND(SUM(CASE WHEN t >= (SELECT t FROM p0) THEN ad ELSE 0 END), 4) ad_w,
    SUM(root_t >= (SELECT t FROM p0)) k_tree, SUM(root_t >= (SELECT t FROM p0) AND rev > 0) k_payers,
    SUM(CASE WHEN root_t >= (SELECT t FROM p0) THEN rev ELSE 0 END) k_rev, ROUND(SUM(CASE WHEN root_t >= (SELECT t FROM p0) THEN usd ELSE 0 END), 4) k_usd,
    SUM(CASE WHEN lvl = 0 AND root_t >= (SELECT t FROM p0) THEN rev ELSE 0 END) k_root_rev
  FROM n GROUP BY ch)
SELECT 'M' s, 'users' k, (SELECT COUNT(*) FROM u) c1, NULL c2, NULL c3, NULL c4, NULL c5, NULL c6, NULL c7, NULL c8, NULL c9, NULL c10, NULL c11, NULL c12, NULL c13, NULL c14, NULL c15, NULL c16, NULL c17, NULL c18, NULL c19, NULL c20
UNION ALL SELECT 'M', 'tree_nodes_ex_admin', (SELECT COUNT(*) FROM n), (SELECT COUNT(*) FROM tr), (SELECT MAX(lvl) FROM tr), (SELECT COUNT(*) FROM tr WHERE lvl>=40), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
UNION ALL SELECT 'M', 'referrals', (SELECT COUNT(*) FROM referrals), (SELECT COUNT(*) FROM referrals r WHERE r.referee_id IN (SELECT uid FROM u) AND r.referrer_id NOT IN (SELECT uid FROM u)), (SELECT COUNT(*) FROM referrals WHERE referrer_id IN (SELECT id FROM adm)), (SELECT COUNT(*) FROM n WHERE root IN (SELECT id FROM adm)), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
UNION ALL SELECT 'M', 'llm_span', (SELECT MIN(created_at) FROM llm_usage), (SELECT MAX(created_at) FROM llm_usage), (SELECT ROUND(SUM(cost_usd),4) FROM llm_usage), (SELECT ROUND(SUM(cost_usd),4) FROM llm_usage WHERE user_id=0), (SELECT ROUND(SUM(cost_usd),4) FROM llm_usage WHERE created_at >= (SELECT t FROM p0)), (SELECT ROUND(SUM(cost_usd),4) FROM llm_usage WHERE user_id IN (SELECT id FROM adm)), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
UNION ALL SELECT 'M', 'pay_span', (SELECT MIN(created_at) FROM payments WHERE status='approved'), (SELECT MAX(created_at) FROM payments WHERE status='approved'), (SELECT SUM(amount) FROM payments WHERE status='approved'), (SELECT SUM(amount) FROM payments WHERE status='approved' AND user_id IN (SELECT id FROM adm)), (SELECT SUM(amount) FROM payments WHERE status='approved' AND created_at >= (SELECT t FROM p0)), (SELECT SUM(amount) FROM payments WHERE status='approved' AND user_id NOT IN (SELECT uid FROM u)), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
UNION ALL SELECT 'M', 'ad_model', (SELECT ROUND(v,6) FROM avgr), (SELECT SUM(n) FROM cu), (SELECT SUM(n) FROM cu WHERE d IN (SELECT d FROM cc)), (SELECT MIN(d) FROM cu), (SELECT MAX(d) FROM cu), (SELECT SUM(n) FROM cu WHERE d >= '2026-09-11'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
UNION ALL SELECT 'L', CAST(lvl AS TEXT), COUNT(*), SUM(rev>0), SUM(rev), ROUND(SUM(usd),4), SUM(t >= (SELECT t FROM p0)), SUM(rev_w), ROUND(SUM(usd_w),4), SUM(root_t >= (SELECT t FROM p0)), SUM(root_t >= (SELECT t FROM p0) AND rev>0), SUM(CASE WHEN root_t >= (SELECT t FROM p0) THEN rev ELSE 0 END), ROUND(SUM(CASE WHEN root_t >= (SELECT t FROM p0) THEN usd ELSE 0 END),4), SUM(rev_w>0), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM n GROUP BY lvl
UNION ALL SELECT 'C', agg.ch, roots, tree, payers, rev, usd, ad, root_rev, root_usd, root_payers, ls.s, rev_w, usd_w, roots_w, ad_w, k_tree, k_payers, k_rev, k_usd, lsk.s, k_root_rev FROM agg LEFT JOIN ls ON ls.ch = agg.ch LEFT JOIN lsk ON lsk.ch = agg.ch
