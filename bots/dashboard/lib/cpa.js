// 💸 هزینه‌ی جذبِ هر کاربر (CPA) per کانالِ ورودی — تک‌منبعِ مدلِ هزینه.
//
// سؤالی که این فایل جواب می‌دهد: «هر کاربرِ جدید از هر کانال، چقدر برایمان آب خورد؟»
// و جوابش را از **خرجِ واقعیِ دلاریِ OpenRouter** می‌سازد، نه از ارزشِ اسمیِ الماس.
//
// ═══ چرا ارزشِ اسمیِ الماس غلط است ═══
// ۵ الماسِ خوش‌آمد یک «هزینه» نیست، یک **بدهیِ تبلیغاتی** است (همان بحثِ صفحه‌ی
// `/costs`). هزینه لحظه‌ای رخ می‌دهد که کاربر آن الماس را **خرج کند** و ما یک فال
// تحویل بدهیم؛ و اندازه‌اش هم قیمتِ فروشِ الماس نیست، **هزینه‌ی خدمت‌رسانی** است:
// همان دلاری که به OpenRouter دادیم. الماسی که هرگز خرج نشود (سوخت/breakage) صفر
// هزینه دارد و شمردنش، هزینه را سیستماتیک بیش‌برآورد می‌کند.
//
// ═══ سه قدم ═══
//   ۱) هزینه‌ی هر الماس، **per اندازه‌ی فال**. یک الماس در فالِ ده‌کارتی و یک الماس در
//      فالِ سه‌کارتی هزینه‌ی یکسانی ندارند (پرامپت و خروجی فرق دارد)، پس یک نرخِ واحد
//      ساختن غلط است. نرخ = مجموعِ دلارِ فال‌های آن اندازه ÷ مجموعِ الماسِ خرج‌شده در آن‌ها.
//   ۲) از هر کاربر، **کدام الماس‌ها واقعاً خرج شدند و از کدام سطل آمده بودند** — با یک
//      دفترِ FIFO (پایین).
//   ۳) جمعِ هزینه‌ی الماس‌های جذب (خوش‌آمد + پاداشِ دعوت) per کانال ÷ تعدادِ کاربرانِ
//      همان کانال = CPA.
//
// امنیت: هیچ رشته‌ای از URL وارد SQL نمی‌شود؛ همه‌ی ورودی‌ها عددِ بازه‌اند و bound.
import { withDb, hasTable, rows, scalar, instancesOf, testUserClause, coinLegacyFloorOf } from './bots.js';
/* ⚠️ نرخِ تبلیغ **per روز** از همان تک‌منبعی می‌آید که صفحه‌ی اقتصاد استفاده می‌کند.
   خواندنِ مستقلِ `cpa_campaign_usd` این‌جا یعنی صفحه‌ی «جذب» و صفحه‌ی «اقتصاد» دو
   هزینه‌ی تبلیغِ متفاوت بسازند — دقیقاً همان کلاسِ باگی که PR قبلی رفعش کرد. */
import { campaignCostModel } from './profit.js';
import { tehranDayStr } from './util.js';

/* سطل‌های هدیه‌ای که **هزینه‌ی جذبِ خودِ کاربر** حساب می‌شوند.
 * ⚠️ عمداً فقط `welcome`: پاداشِ `referral` هم هزینه‌ی جذب است، ولی جذبِ **کاربرِ
 * دعوت‌شده**، نه جذبِ دعوت‌کننده‌ای که پاداش را گرفت. اگر این‌جا هم می‌آمد، یک پاداش
 * دو بار شمرده می‌شد: یک‌بار در سطلِ کانالِ خودِ دعوت‌کننده و یک‌بار در `refShare`
 * برای دعوت‌شده. استریک و کارتِ شانس هم اصلاً جذب نیستند، هزینه‌ی نگه‌داشت‌اند. */
export const SELF_ACQ_KINDS = new Set(['welcome']);
/** همه‌ی سطل‌های جذب (برای مستندسازی و چکِ CI). */
export const ACQ_KINDS = new Set(['welcome', 'referral']);

/* 💎 ستونِ `original_amount` **دو واحد** دارد (بندِ اختصاصی‌اش در CLAUDE.md همین پوشه):
 * در دوره‌ی الماس تعدادِ الماس، و در ردیف‌های دوره‌ی تومانی که اصلاً `original_amount`
 * نگرفتند، `COALESCE` به `amount` می‌افتد که **تومان** است.
 *
 * 🐛 باگی که تا ۱۴۰۵/۰۶/۲۱ این‌جا زنده بود: دفترِ FIFO آن تومان‌ها را الماس می‌خواند. روی
 * دیتای زنده ۱۳ ردیف جمعاً **۶۳۵٬۰۰۰ الماسِ خیالی** وارد دفتر می‌کردند — همان عددی که
 * `/finance` قبلاً به‌شکلِ «۶۳۵٬۹۵۹💎 خریداری‌شده» نشان می‌داد و مالک گرفتش. اثرش این‌جا
 * وارونه است: با یک اعتبارِ نجومی، FIFO خرجِ آن کاربران را به `purchase` نسبت می‌دهد و
 * سهمِ `referral`شان (خطِ ۱۸۵) کم‌برآورد می‌شود.
 *
 * ⚠️ چرا **کنار گذاشتن** و نه تبدیل: همان کاری که `/finance` می‌کند، پس دو صفحه یک
 * تعریف از «خرید» دارند. خطای باقی‌مانده‌اش کراندار و ناچیز است — آن ۱۳ ردیف روی هم
 * ~۶۳ الماس معادل بودند، یعنی حداکثر همان‌قدر از خرجشان به‌جای خرید به هدیه نسبت
 * داده می‌شود (بیش‌برآوردِ ≤$۰٫۰۴ در کلِ هزینه‌ی جذب). تبدیلِ دقیق یک «نرخِ دوره‌ی
 * قدیم» به رجیستری اضافه می‌کرد که برای این اندازه توجیه ندارد (بند ۹/۰ ریشه).
 * رباتی که `coinLegacyFloor` ندارد صفر می‌گیرد و رفتارش بیت‌به‌بیت مثل قبل است. */
export const purchaseAmt = (bot) => {
  const floor = coinLegacyFloorOf(bot);
  const expr = 'COALESCE(original_amount, amount)';
  return { expr, where: floor ? ` AND ${expr} < ${floor}` : '' };
};

/** برچسبِ کانالِ ورودی از `users.first_source` (همان قراردادِ اتریبیوشن). */
export const CHANNELS = [
  { key: 'organic', label: 'ارگانیک', match: (s) => s === 'organic' || !s },
  { key: 'referral', label: 'دعوت دوستان', match: (s) => s.startsWith('referral:') },
  { key: 'campaign', label: 'کمپین تبلیغاتی', match: (s) => s.startsWith('campaign:') },
];
const channelOf = (src) => CHANNELS.find(c => c.match(String(src || '')))?.key || 'organic';

/* ═══ قدم ۱: هزینه‌ی هر الماس per اندازه‌ی فال ═══
   ⚠️ فقط فال‌هایی شمرده می‌شوند که ردیفِ هزینه دارند (`llm_usage`). چون ثبتِ هزینه از
   تاریخِ انتشارش شروع شده، فال‌های قدیمی‌تر نرخ نمی‌سازند — و **نباید** بسازند، وگرنه
   عددی از هوا درمی‌آید. خروجی می‌گوید نرخ روی چند فال بنا شده تا خواننده بداند چقدر
   به آن اعتماد کند. */
export function costPerDiamond(botKey) {
  const bySize = new Map(); // size → { usd, diamonds, readings }
  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'llm_usage') || !hasTable(db, 'readings')) return;
      // گروه‌بندیِ دومرحله‌ای لازم است: هر فال چند ردیفِ هزینه دارد (خوانش + تعمیر +
      // رونویسی)، پس اول per فال جمع می‌شود بعد per اندازه — وگرنه تعدادِ الماس در
      // تعدادِ فراخوانی‌ها ضرب می‌شد.
      for (const r of rows(db, `
        SELECT size, SUM(usd) AS usd, COUNT(*) AS readings, SUM(size) AS diamonds FROM (
          SELECT r.price AS size, r.id AS rid, SUM(l.cost_usd) AS usd
            FROM readings r JOIN llm_usage l ON l.ref_id = r.id
           WHERE r.status='delivered' AND r.price > 0 AND l.ref_id > 0
           GROUP BY r.id
        ) GROUP BY size ORDER BY size`)) {
        const cur = bySize.get(r.size) || { usd: 0, diamonds: 0, readings: 0 };
        cur.usd += r.usd || 0; cur.diamonds += r.diamonds || 0; cur.readings += r.readings || 0;
        bySize.set(r.size, cur);
      }
    });
  }
  const sizes = [...bySize.entries()].sort((a, b) => a[0] - b[0]).map(([size, v]) => ({
    size, ...v, cpd: v.diamonds ? v.usd / v.diamonds : 0,
  }));
  const totDiamonds = sizes.reduce((a, s) => a + s.diamonds, 0);
  const totUsd = sizes.reduce((a, s) => a + s.usd, 0);
  return {
    sizes,
    avgCpd: totDiamonds ? totUsd / totDiamonds : 0,
    readings: sizes.reduce((a, s) => a + s.readings, 0),
    hasData: totDiamonds > 0,
  };
}

/* ═══ قدم ۲: دفترِ FIFO — کدام الماسِ هدیه واقعاً خرج شد؟ ═══
   الماس‌ها با هم قاطی می‌شوند، پس «کدام الماس خرج شد» یک انتخابِ حسابداری است، نه یک
   واقعیتِ ثبت‌شده. FIFO (قدیمی‌ترین اول) انتخاب شده چون هم استانداردِ حسابداریِ موجودی
   است و هم با واقعیتِ محصول می‌خواند: هدیه‌ی خوش‌آمد لحظه‌ی ثبت‌نام می‌آید و طبیعتاً
   اولین چیزی است که خرج می‌شود.
   نکته‌ی درستیِ مدل: چون ربات هرگز اجازه‌ی خرجِ بیش از موجودی نمی‌دهد، «FIFO روی کلِ
   خرج» با «FIFO لحظه‌به‌لحظه» یکی می‌شود. پس این تقریب نیست، دقیق است. */
function fifoConsume(credits, totalSpent) {
  const consumed = {};
  let left = totalSpent;
  for (const c of credits.sort((a, b) => a.t - b.t)) {
    if (left <= 0) break;
    const take = Math.min(left, c.amt);
    consumed[c.kind] = (consumed[c.kind] || 0) + take;
    left -= take;
  }
  return consumed;
}

/* ═══ قدم ۳: جمع‌بندی per کانال ═══
   `sinceSec` کوهورتِ **ورود** را می‌برد (کاربرانی که در آن بازه ثبت‌نام کردند)، چون CPA
   ذاتاً یک سنجه‌ی کوهورتِ جذب است: «کاربرانی که این ماه آمدند چقدر خرج برداشتند». */
export function channelCosts(botKey, { sinceSec = 0, campaign = null } = {}) {
  const cam = campaign || campaignCostModel(botKey);
  const cpd = costPerDiamond(botKey);
  const out = {};
  for (const c of CHANNELS) out[c.key] = { users: 0, costUsd: 0, spenders: 0, diamonds: 0 };

  for (const inst of instancesOf(botKey)) {
    withDb(inst.file, (db) => {
      if (!hasTable(db, 'users')) return;
      const admin = hasTable(db, 'events')
        ? new Set(rows(db, "SELECT DISTINCT user_id FROM events WHERE json_extract(props,'$.adm') = 1").map(r => r.user_id))
        : new Set();

      /* --- کاربرانِ کوهورت --- */
      const users = new Map();
      for (const u of rows(db, 'SELECT telegram_id AS uid, first_source AS src, created_at AS t FROM users WHERE created_at >= ?', [sinceSec])) {
        if (admin.has(u.uid)) continue;
        users.set(u.uid, { ch: channelOf(u.src), t: u.t, credits: [], spent: 0, costAll: 0 });
      }
      if (!users.size) return;

      /* --- دفترِ اعتبار: هدیه‌ها + خریدها (خرید هم در FIFO هست، وگرنه ترتیب می‌شکند) --- */
      if (hasTable(db, 'events')) {
        for (const g of rows(db, `SELECT user_id AS uid, created_at AS t,
              COALESCE(json_extract(props,'$.kind'),'') AS kind,
              COALESCE(json_extract(props,'$.amount'),0) AS amt
            FROM events WHERE event='credit_granted'`)) {
          users.get(g.uid)?.credits.push({ t: g.t, kind: g.kind, amt: Math.max(0, g.amt) });
        }
      }
      if (hasTable(db, 'payments')) {
        const buy = purchaseAmt(inst.bot);
        for (const p of rows(db, `SELECT user_id AS uid, created_at AS t,
              ${buy.expr} AS amt FROM payments WHERE status='approved'${testUserClause(inst.bot)}${buy.where}`)) {
          users.get(p.uid)?.credits.push({ t: p.t, kind: 'purchase', amt: Math.max(0, p.amt) });
        }
      }

      /* --- خرج per اندازه (برای نرخِ وزنیِ همان کاربر) --- */
      if (hasTable(db, 'readings')) {
        for (const s of rows(db, `SELECT user_id AS uid, price AS size, COUNT(*) AS n
            FROM readings WHERE status='delivered' AND price > 0 GROUP BY user_id, price`)) {
          const u = users.get(s.uid);
          if (!u) continue;
          const diamonds = s.size * s.n;
          const rate = cpd.sizes.find(x => x.size === s.size)?.cpd ?? cpd.avgCpd;
          u.spent += diamonds;
          u.costAll += diamonds * rate;
        }
      }

      /* --- پاداشِ دعوت: هزینه‌ی جذبِ کاربرِ دعوت‌شده است، ولی الماسش دستِ **دعوت‌کننده**
             است. پس مصرفِ دعوت‌کننده حساب و به سهمِ هر دعوتش تقسیم می‌شود. --- */
      const refShare = new Map(); // refereeUid → costUsd
      if (hasTable(db, 'referrals')) {
        const byReferrer = new Map();
        for (const r of rows(db, 'SELECT referrer_id AS a, referee_id AS b FROM referrals WHERE rewarded=1')) {
          if (!byReferrer.has(r.a)) byReferrer.set(r.a, []);
          byReferrer.get(r.a).push(r.b);
        }
        // دعوت‌کننده ممکن است خودش بیرونِ کوهورت باشد، پس دفترش جدا خوانده می‌شود
        for (const [ref, kids] of byReferrer) {
          if (admin.has(ref) || !kids.length) continue;
          const credits = [];
          if (hasTable(db, 'events')) {
            for (const g of rows(db, `SELECT created_at AS t, COALESCE(json_extract(props,'$.kind'),'') AS kind,
                  COALESCE(json_extract(props,'$.amount'),0) AS amt
                FROM events WHERE event='credit_granted' AND user_id=?`, [ref])) {
              credits.push({ t: g.t, kind: g.kind, amt: Math.max(0, g.amt) });
            }
          }
          if (hasTable(db, 'payments')) {
            const buy = purchaseAmt(inst.bot);
            for (const p of rows(db, `SELECT created_at AS t, ${buy.expr} AS amt
                FROM payments WHERE status='approved'${testUserClause(inst.bot)}${buy.where} AND user_id=?`, [ref])) {
              credits.push({ t: p.t, kind: 'purchase', amt: Math.max(0, p.amt) });
            }
          }
          const spent = scalar(db, "SELECT COALESCE(SUM(price),0) FROM readings WHERE user_id=? AND status='delivered' AND price>0", [ref]);
          const consumedRef = fifoConsume(credits, spent).referral || 0;
          const perKid = (consumedRef / kids.length) * cpd.avgCpd;
          for (const k of kids) refShare.set(k, (refShare.get(k) || 0) + perKid);
        }
      }

      /* --- جمعِ نهایی --- */
      for (const [uid, u] of users) {
        const bucket = out[u.ch];
        bucket.users += 1;
        const consumed = fifoConsume(u.credits, u.spent);
        // نرخِ وزنیِ خودِ کاربر (اگر خرجی نداشته، نرخِ کلی)
        const userCpd = u.spent ? u.costAll / u.spent : cpd.avgCpd;
        let acq = 0;
        for (const k of Object.keys(consumed)) if (SELF_ACQ_KINDS.has(k)) acq += consumed[k];
        if (acq > 0) { bucket.spenders += 1; bucket.diamonds += acq; }
        bucket.costUsd += acq * userCpd + (refShare.get(uid) || 0);
        /* کمپین: هزینه‌ی تبلیغِ دستیِ **روزِ ورودِ همان کاربر** روی خودش می‌نشیند.
           تا ۱۴۰۵/۰۶/۱۶ یک نرخِ ثابت بود؛ حالا روزی که وارد شده نرخِ خودش را دارد. */
        if (u.ch === 'campaign') bucket.costUsd += cam.rateFor(tehranDayStr(u.t));
      }
    });
  }

  for (const k of Object.keys(out)) {
    out[k].cpaUsd = out[k].users ? out[k].costUsd / out[k].users : 0;
  }
  return { cpd, channels: out };
}
