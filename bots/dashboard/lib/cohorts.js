// «پشتِ هر عدد، کاربرانش» — تک‌منبعِ تبدیلِ یک عددِ داشبورد به لیستِ کاربرانِ همان عدد.
//
// چرا این فایل هست: هر عددی که در داشبورد به کاربر اشاره می‌کند باید قابلِ باز شدن باشد تا مالک
// بتواند دقیقاً همان آدم‌ها را ببیند و باهاشان حرف بزند (user discovery). اگر هر صفحه لیستِ خودش
// را جدا می‌ساخت، عدد و لیست از هم می‌پاشیدند؛ این‌جا شرطِ عدد و شرطِ لیست **یکی** است.
//
// امنیت (قاعده‌ی سختِ داشبورد): هیچ رشته‌ای از URL داخل SQL تزریق نمی‌شود.
//  - نام جدول/ستون/statusExpr فقط از پروفایلِ ربات (lib/bots.js) و تعاریفِ lib/funnels-def.js می‌آید.
//  - هر مقدارِ ورودیِ کاربر (نام رویداد، status، step، کد کمپین، شماره‌ی هفته) bound parameter است.
//  - انتخابِ چنل/نسخه/نوع از لیستِ whitelist ایندکس می‌شود، نه از متنِ خام.
import {
  instancesOf, getInstance, withDb, hasTable, rows,
  userPk, userNameCol, moneyOf, unixOf, userCreatedExpr, familyOf } from './bots.js';
import { FUNNELS, CHANNELS, verCond } from './funnels-def.js';
// شرط‌های مسیرِ ریز از همان‌جایی می‌آیند که عددها ساخته می‌شوند (تک‌منبع؛ ضدِ واگراییِ عدد و لیست)
import { KEY_EXPR, notAdmin } from './journey.js';
// شرط‌های «درگیری و ماندگاری» از همان‌جایی می‌آیند که عددهای داشبوردِ اصلی ساخته می‌شوند
import {
  DONE, notAdminReadings, READ_BUCKETS, RET_DAYS, SATISFIED_MIN_AVG,
  activeUsersSql, readerUsersSql, repeatUsersSql, satisfiedUsersSql, ratersUsersSql,
  successfulReferrersSql, bucketUsersSql, retainedUsersSql,
} from './engage.js';
import { weekIdx, weekExpr, weekLabel, nowSec, postRefLabel } from './util.js';

// سقفِ لیست: داشبورد ابزارِ تماس‌گرفتن است نه export انبوه (برای انبوه، تب «کاربران» + CSV هست).
export const COHORT_LIMIT = 300;

/* اجرای یک کوئریِ کاربرمحور روی instanceهای هدف و نرمال‌کردن خروجی.
   هر کوئری باید ستون‌های id/nm/un را با همین نام برگرداند. */
function collect(targets, botKey, build) {
  const out = [];
  const pk = userPk(botKey);
  const nameCol = userNameCol(botKey);
  for (const inst of targets) {
    if (out.length >= COHORT_LIMIT) break;
    withDb(inst.file, (db) => {
      const q = build(db, { pk, nameCol, bot: botKey });
      if (!q) return;
      for (const u of rows(db, q.sql, q.params)) {
        out.push({ instId: inst.id, instTitle: inst.title, uid: u.id, name: u.nm || '', username: u.un || '' });
      }
    });
  }
  return out;
}

const targetsOf = (url, botKey) => {
  const instId = url.searchParams.get('inst') || '';
  if (instId) { const i = getInstance(instId); return i ? [i] : []; }
  return instancesOf(botKey);
};

const intParam = (url, key, def = 0) => {
  const v = parseInt(url.searchParams.get(key) ?? '', 10);
  return Number.isFinite(v) ? v : def;
};

// انتخابِ ایمنِ عبارتِ چنل از whitelist (هرگز از متنِ خام)
const CHAN_CONDS = {
  organic: { cond: "first_source = 'organic'", label: 'ارگانیک' },
  referral: { cond: "first_source LIKE 'referral:%'", label: 'رفرال' },
  other: { cond: "first_source LIKE 'other:%'", label: 'سایر payload' },
  unknown: { cond: "first_source IS NULL OR first_source = ''", label: 'نامشخص (قبل از اتریبیوشن)' },
  campaign: { cond: 'first_source = ?', label: 'کمپین' }, // مقدار bound می‌شود
};

/* قیفِ اتریبیوشن — مشترکِ «کمپین» و «پستِ کانال»: هر دو یک ستونِ write-onceِ users را با یک مقدار
   می‌سنجند (کمپین → first_source = campaign:<code> ، پست → first_payload = c_<code>_<postref>)
   و چهار حالتِ یکسان دارند: کاربر جدید / به اولین ارزش رسید / پی‌وال دید / خریدار.
   امنیت: `col` هرگز از URL نمی‌آید (فقط ثابتِ داخلِ همان case)؛ `val` همیشه bound parameter است. */
const ATTR_EVENT = { fv: 'first_value', pw: 'paywall_shown' };
const ATTR_LABEL = { fv: 'به اولین ارزش رسید', pw: 'پی‌وال دید', payers: 'خریدار' };

function attrCohort(targets, botKey, col, val, mode) {
  const lim = ` LIMIT ${COHORT_LIMIT}`;
  const m = moneyOf(botKey);
  const test = m.testFilter ? ` AND p.${m.testFilter}` : '';
  const byEvent = ATTR_EVENT[mode];
  return collect(targets, botKey, (db, { pk, nameCol }) => {
    if (byEvent) {
      if (!hasTable(db, 'events')) return null;
      return {
        sql: `SELECT DISTINCT u.${pk} id, u.${nameCol} nm, u.username un FROM events e JOIN users u ON u.${pk} = e.user_id
              WHERE u.${col} = ? AND e.event = ? ORDER BY u.${pk}${lim}`,
        params: [val, byEvent],
      };
    }
    if (mode === 'payers') {
      if (!hasTable(db, m.table)) return null;
      return {
        sql: `SELECT DISTINCT u.${pk} id, u.${nameCol} nm, u.username un FROM ${m.table} p JOIN users u ON u.${pk} = p.user_id
              WHERE u.${col} = ? AND p.status = '${m.successStatus}'${test} ORDER BY u.${pk}${lim}`,
        params: [val],
      };
    }
    return {
      sql: `SELECT ${pk} id, ${nameCol} nm, username un FROM users WHERE ${col} = ?
            ORDER BY ${userCreatedExpr(botKey)} DESC${lim}`,
      params: [val],
    };
  });
}

/* ═══ حلّالِ اصلی ═══
   خروجی: { title, users, truncated } — یا { error } اگر پارامترها نامعتبر بودند. */
export function resolveCohort(url) {
  const k = url.searchParams.get('k') || '';
  const botKey = url.searchParams.get('bot') || '';
  const since = Math.max(0, intParam(url, 'since', 0));
  const targets = targetsOf(url, botKey);
  if (!targets.length) return { error: 'ربات/دیتابیسی برای این عدد پیدا نشد.' };

  const lim = ` LIMIT ${COHORT_LIMIT}`;
  const sel = (pk, nameCol, alias = 'u') => `${alias}.${pk} id, ${alias}.${nameCol} nm, ${alias}.username un`;

  switch (k) {
    /* قیف رویدادی: کاربرانی که یک رویداد مشخص را در بازه انجام داده‌اند (+ بُرشِ چنل و کوهورت نسخه) */
    case 'funnel': {
      const ev = url.searchParams.get('ev') || '';
      const ci = Math.min(CHANNELS.length - 1, Math.max(0, intParam(url, 'ch', 0)));
      const ver = url.searchParams.get('ver') || '';
      const v = verCond(ver);
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'events')) return null;
        return {
          sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM events e JOIN users u ON u.${pk} = e.user_id
                WHERE e.event = ? AND e.created_at >= ? AND ${CHANNELS[ci][1]} AND ${v.cond}
                ORDER BY u.${pk}${lim}`,
          params: [ev, since, ...v.params],
        };
      });
      return done(`رویداد «${ev}» · ${CHANNELS[ci][0]}${ver ? ` · نسخه ${ver}` : ''}`, users);
    }

    /* وضعیت رکوردهای قطعی (readings/voice_flows/dreams): کاربرانِ رکوردهایی با آن وضعیت */
    case 'entity': {
      const entity = FUNNELS[familyOf(botKey)]?.entity;
      if (!entity) return { error: 'این ربات جدول رکورد قطعی ندارد.' };
      const st = url.searchParams.get('st') || '';
      const statusExpr = entity.statusExpr || 't.status';
      const catExpr = unixOf(botKey === 'tabir-khab' ? 'iso' : 'unix', 't.created_at');
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, entity.table)) return null;
        return {
          sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM ${entity.table} t JOIN users u ON u.${pk} = t.user_id
                WHERE ${statusExpr} = ? AND ${catExpr} >= ? ORDER BY u.${pk}${lim}`,
          params: [st, since],
        };
      });
      return done(`${entity.title} · وضعیت «${st}»`, users);
    }

    /* نقطه‌ی رها کردن شارژ: کاربرانِ پرداخت‌های ناتمام در یک مرحله */
    case 'paystep': {
      const step = url.searchParams.get('step') || '';
      const m = moneyOf(botKey);
      const catExpr = unixOf(m.createdKind, 'p.created_at');
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, m.table)) return null;
        return {
          sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM ${m.table} p JOIN users u ON u.${pk} = p.user_id
                WHERE COALESCE(p.step,'-') = ? AND ${catExpr} >= ?
                  AND p.status IN ('pending','canceled','cancelled') ORDER BY u.${pk}${lim}`,
          params: [step, since],
        };
      });
      return done(`شارژِ ناتمام، رها شده در مرحله‌ی «${step}»`, users);
    }

    /* کوهورتِ ریتنشن: کاربرانِ واردشده در یک هفته */
    case 'retc': {
      const w = intParam(url, 'w', 0);
      const users = collect(targets, botKey, (db, { pk, nameCol }) => ({
        sql: `SELECT ${pk} id, ${nameCol} nm, username un FROM users
              WHERE ${weekExpr(userCreatedExpr(botKey))} = ? ORDER BY ${pk}${lim}`,
        params: [w],
      }));
      return done(`کاربرانِ واردشده در هفته‌ی ${weekLabel(w)}`, users);
    }

    /* سلولِ ریتنشن: از کوهورتِ هفته‌ی w، کدام‌ها در هفته‌ی w+off فعال بوده‌اند */
    case 'retcell': {
      const w = intParam(url, 'w', 0);
      const off = Math.max(0, intParam(url, 'off', 0));
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'events')) return null;
        return {
          sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM events e JOIN users u ON u.${pk} = e.user_id
                WHERE ${weekExpr('e.created_at')} = ? AND ${weekExpr(userCreatedExpr(botKey, 'u.created_at'))} = ?
                ORDER BY u.${pk}${lim}`,
          params: [w + off, w],
        };
      });
      return done(`کوهورتِ ${weekLabel(w)} که در هفته‌ی +${off} فعال بودند`, users);
    }

    /* lifecycle هفته‌ی جاری: فعال / جدید / خفته */
    case 'life': {
      const t = url.searchParams.get('t') || 'active';
      const nowW = weekIdx(nowSec());
      if (t === 'new') {
        const users = collect(targets, botKey, (db, { pk, nameCol }) => ({
          sql: `SELECT ${pk} id, ${nameCol} nm, username un FROM users
                WHERE ${weekExpr(userCreatedExpr(botKey))} = ? ORDER BY ${pk}${lim}`,
          params: [nowW],
        }));
        return done('کاربرانِ جدیدِ این هفته', users);
      }
      if (t === 'dormant') {
        // هفته‌ی قبل فعال بوده، این هفته نه (خفته‌ها = مهم‌ترین لیست برای بازگرداندن)
        const users = collect(targets, botKey, (db, { pk, nameCol }) => {
          if (!hasTable(db, 'events')) return null;
          return {
            sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM events e JOIN users u ON u.${pk} = e.user_id
                  WHERE ${weekExpr('e.created_at')} = ?
                    AND NOT EXISTS (SELECT 1 FROM events e2 WHERE e2.user_id = e.user_id AND ${weekExpr('e2.created_at')} = ?)
                  ORDER BY u.${pk}${lim}`,
            params: [nowW - 1, nowW],
          };
        });
        return done('خفته‌ها (هفته‌ی قبل فعال، این هفته نه)', users);
      }
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'events')) return null;
        return {
          sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM events e JOIN users u ON u.${pk} = e.user_id
                WHERE ${weekExpr('e.created_at')} = ? ORDER BY u.${pk}${lim}`,
          params: [nowW],
        };
      });
      return done('کاربرانِ فعالِ این هفته', users);
    }

    /* کاربرانِ ثبت‌نام‌شده (کل یا از یک زمان به بعد) — اعداد نمای کلی */
    case 'users': {
      const createdExpr = userCreatedExpr(botKey);
      const users = collect(targets, botKey, (db, { pk, nameCol }) => ({
        sql: `SELECT ${pk} id, ${nameCol} nm, username un FROM users
              ${since ? `WHERE ${createdExpr} >= ?` : ''} ORDER BY ${createdExpr} DESC${lim}`,
        params: since ? [since] : [],
      }));
      return done(since ? 'کاربرانِ جدید در این بازه' : 'همه‌ی کاربران', users);
    }

    /* کاربرانِ فعال (هر رویدادی) از یک زمان به بعد — DAU/WAU */
    case 'actives': {
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'events')) return null;
        return {
          sql: `SELECT DISTINCT ${sel(pk, nameCol)} FROM events e JOIN users u ON u.${pk} = e.user_id
                WHERE e.created_at >= ? ORDER BY u.${pk}${lim}`,
          params: [since],
        };
      });
      return done('کاربرانِ فعال در این بازه', users);
    }

    /* چنلِ ورود (first_source) — جدولِ مقایسه‌ی چنل‌ها در مارکتینگ */
    case 'chan': {
      const c = CHAN_CONDS[url.searchParams.get('c') || ''] ? url.searchParams.get('c') : '';
      if (!c) return { error: 'چنل نامعتبر.' };
      const val = url.searchParams.get('val') || '';
      const users = collect(targets, botKey, (db, { pk, nameCol }) => ({
        sql: `SELECT ${pk} id, ${nameCol} nm, username un FROM users
              WHERE ${CHAN_CONDS[c].cond} ORDER BY ${userCreatedExpr(botKey)} DESC${lim}`,
        params: c === 'campaign' ? [val] : [],
      }));
      return done(`چنلِ ورود: ${CHAN_CONDS[c].label}${c === 'campaign' ? ` (${val})` : ''}`, users);
    }

    /* قدمِ ریزِ یک مرحله‌ی قیف: کاربرانی که این پیام را دیدند یا این دکمه را زدند، در همان
       پنجره‌ی بینِ دو milestone. شرطِ پنجره **عیناً** همان چیزی است که microSteps عدد را با آن
       ساخته (lib/journey.js) تا عدد و لیست هرگز از هم نپاشند. */
    case 'micro': {
      const ev = url.searchParams.get('ev') === 'act' ? 'act' : 'view';
      const key = url.searchParams.get('key') || '';
      const stage = url.searchParams.get('stage') || '';
      const next = url.searchParams.get('next') || '';
      if (!stage) return { error: 'مرحله نامعتبر است.' };
      const ci = Math.min(CHANNELS.length - 1, Math.max(0, intParam(url, 'ch', 0)));
      const v = verCond(url.searchParams.get('ver') || '');
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'events')) return null;
        return {
          sql: `WITH st AS (SELECT user_id, MIN(id) sid FROM events WHERE event=? AND created_at>=? GROUP BY user_id),
                     nx AS (SELECT user_id, MIN(id) nid FROM events WHERE event=? AND created_at>=? GROUP BY user_id)
                SELECT DISTINCT ${sel(pk, nameCol)} FROM events e
                JOIN st ON st.user_id = e.user_id
                LEFT JOIN nx ON nx.user_id = e.user_id
                JOIN users u ON u.${pk} = e.user_id
                WHERE e.event = ? AND ${KEY_EXPR('e')} = ?
                  AND e.id > st.sid AND (nx.nid IS NULL OR e.id < nx.nid)
                  AND e.created_at >= ? AND ${CHANNELS[ci][1]} AND ${v.cond} AND ${notAdmin('e')}
                ORDER BY u.${pk}${lim}`,
          params: [stage, since, next, since, ev, key, since, ...v.params],
        };
      });
      return done(`قدمِ ریز «${key}» در مرحله‌ی «${stage}» · ${CHANNELS[ci][0]}`, users);
    }

    /* نقطه‌ی خروج: کاربرانی که آخرین رویدادشان همین بوده و دیگر برنگشته‌اند */
    case 'exit': {
      const ev = url.searchParams.get('ev') || '';
      const key = url.searchParams.get('key') || '';
      const idle = intParam(url, 'idle', 0);
      if (!ev || !idle) return { error: 'نقطه‌ی خروج نامعتبر است.' };
      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'events')) return null;
        return {
          sql: `WITH last AS (SELECT user_id, MAX(id) mid FROM events WHERE created_at>=? GROUP BY user_id)
                SELECT DISTINCT ${sel(pk, nameCol)} FROM events e
                JOIN last ON last.mid = e.id
                JOIN users u ON u.${pk} = e.user_id
                WHERE e.event = ? AND ${KEY_EXPR('e')} = ? AND e.created_at < ? AND ${notAdmin('e')}
                ORDER BY u.${pk}${lim}`,
          params: [since, ev, key, idle],
        };
      });
      return done(`کسانی که آخرین کارشان «${key || ev}» بود و دیگر برنگشتند`, users);
    }

    /* قیفِ یک کمپین: کاربر جدید / به ارزش رسید / پی‌وال دید / خریدار */
    case 'camp': {
      const code = url.searchParams.get('code') || '';
      const mode = url.searchParams.get('m') || 'new';
      const users = attrCohort(targets, botKey, 'first_source', `campaign:${code}`, mode);
      return done(`کمپین ${code} · ${ATTR_LABEL[mode] || 'کاربر جدید'}`, users);
    }

    /* قیفِ یک پستِ کانال: همان چهار حالتِ کمپین، ولی روی payload کاملِ لینکِ پست
       (users.first_payload = c_<code>_<postref>) تا معلوم شود کدام پست آدمِ واقعی آورد. */
    case 'post': {
      const pl = url.searchParams.get('pl') || '';
      const mode = url.searchParams.get('m') || 'new';
      // شکلِ payload عیناً همان الگوی parseStartPayload است (مقدار به‌هرحال bound می‌شود)
      if (!/^c_[A-Za-z0-9]{1,32}_[A-Za-z0-9]{1,24}$/.test(pl)) return { error: 'شناسه‌ی پست نامعتبر است.' };
      const users = attrCohort(targets, botKey, 'first_payload', pl, mode);
      const post = pl.slice(pl.indexOf('_', 2) + 1);
      return done(`پستِ ${postRefLabel(post)} · ${ATTR_LABEL[mode] || 'کاربر جدید'}`, users);
    }

    /* ═══ سنجه‌های داشبوردِ اصلیِ تاروت ═══
       هر زیرنوع دقیقاً همان SQL ای را صدا می‌زند که عددش را ساخته (`lib/engage.js`)،
       پس عدد و لیست هرگز از هم نمی‌پاشند. زیرنوع از whitelist انتخاب می‌شود و هیچ
       رشته‌ای از URL داخل SQL نمی‌رود. */
    case 'tarot': {
      const t = url.searchParams.get('t') || '';
      const aw = Math.min(7, Math.max(1, intParam(url, 'aw', 7)));
      const now = nowSec();
      const LABEL = {
        active: `کاربران فعال (پنجره‌ی ${aw} روز)`,
        readers: 'کاربرانی که حداقل یک فالِ کامل گرفته‌اند',
        repeat: 'کاربرانِ برگشتی (فال در ≥۲ روزِ متفاوت)',
        satisfied: `کاربران راضی (میانگین نمره > ${SATISFIED_MIN_AVG})`,
        raters: 'کاربرانی که به فال نمره داده‌اند',
        referrer: 'دعوت‌کننده‌های موفق',
        churn: 'ریزشِ هفتگی (هفته‌ی قبل فال گرفت، این هفته نه)',
        bucket: 'کاربرانِ این سطلِ تعدادِ فال',
        ret: 'کاربرانی که بعد از این تعداد روز دوباره فال گرفتند',
      };
      if (!LABEL[t]) return { error: 'نوع سنجه نامعتبر است.' };

      const users = collect(targets, botKey, (db, { pk, nameCol }) => {
        if (!hasTable(db, 'readings') && t !== 'referrer') return null;
        const ev = hasTable(db, 'events');
        let inner = null;
        if (t === 'active') inner = activeUsersSql(now, aw, ev);
        else if (t === 'readers') inner = readerUsersSql(ev);
        else if (t === 'repeat') inner = repeatUsersSql(ev);
        else if (t === 'satisfied') inner = satisfiedUsersSql(ev);
        else if (t === 'raters') inner = ratersUsersSql(ev);
        else if (t === 'referrer') { if (!hasTable(db, 'referrals')) return null; inner = successfulReferrersSql(); }
        else if (t === 'bucket') inner = bucketUsersSql(Math.max(0, intParam(url, 'i', -1)), ev);
        else if (t === 'ret') {
          const d = RET_DAYS.includes(intParam(url, 'd', 0)) ? intParam(url, 'd', 0) : 0;
          if (!d) return null;
          inner = retainedUsersSql(d, now, ev);
        } else if (t === 'churn') {
          inner = {
            sql: `SELECT r.user_id AS uid FROM readings r
                  WHERE ${DONE}${notAdminReadings(ev)} AND r.created_at >= ? AND r.created_at < ?
                  GROUP BY r.user_id
                  HAVING r.user_id NOT IN (SELECT user_id FROM readings WHERE status='delivered' AND price>0 AND created_at >= ?)`,
            params: [now - 14 * 86400, now - 7 * 86400, now - 7 * 86400],
          };
        }
        if (!inner) return null;
        return {
          sql: `SELECT ${sel(pk, nameCol)} FROM users u WHERE u.${pk} IN (${inner.sql}) ORDER BY u.${pk}${lim}`,
          params: inner.params,
        };
      });
      const extra = t === 'bucket' ? ` · ${READ_BUCKETS[Math.max(0, intParam(url, 'i', -1))]?.label || ''}`
        : t === 'ret' ? ` · D+${intParam(url, 'd', 0)}` : '';
      return done(LABEL[t] + extra, users);
    }

    default:
      return { error: 'نوع کوهورت نامعتبر است.' };
  }
}

function done(title, users) {
  return { title, users: users.slice(0, COHORT_LIMIT), truncated: users.length >= COHORT_LIMIT };
}

// رشته‌ی query یک کوهورت (همان چیزی که دکمه‌ی عدد حمل می‌کند)
export const cohortQuery = (params) => new URLSearchParams(
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
).toString();
