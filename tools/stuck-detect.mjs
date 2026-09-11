#!/usr/bin/env node
// 🔁 تشخیصِ «کاربر گیر کرده» از روی **رفتارِ واقعی**، نه وضعیتِ دیتابیس.
//
// ═══ چرا این فایل وجود دارد ═══
//
// 🐛 درسِ v3.78.0 (بند ۹ب-۴ ریشه): جاروی فلوی پرداخت یک «تشخیصِ گیر افتادن» داشت که
// معیارش **وضعیتِ لحظه‌ایِ دیتابیس** بود — «کاربر ۳۰ دقیقه در یکی از PAY_STATES پارک
// است». دیتای زنده نشان داد آن معیار در عمل **رها کردنِ عادیِ صفحه‌ی بسته‌ها** را
// توصیف می‌کند: از ۲۱۹ نفری که به‌عنوانِ «گیرکرده» شناخته شدند، ۱۸۲ نفر حتی یک بار
// هم پیامِ گارد را ندیده بودند و فقط ۵ نفر الگوی حلقه‌ی واقعی داشتند.
//
// **قاعده‌ای که از آن‌جا آمد:** «کاربر در استیتِ X پارک است» یک عکسِ لحظه‌ای است و
// معنیِ محصولی ندارد؛ «کاربر یک صفحه را چهار بار در دو ساعت دید» یک **الگوی رفتاری**
// است. تنها منبعی که الگوی رفتاری دارد جدولِ journey است (رویدادِ `view` با کلیدِ
// صفحه). پس این تشخیص از همان می‌خواند، نه از `users.state`.
//
// ═══ و چرا فقط به مالک خبر می‌دهد ═══
//
// بند ۹ب-۴ ریشه: **تشخیص و ترمیم می‌توانند خودکار باشند؛ ارتباط با کاربر هرگز.**
// این ماژول هیچ پیامی به هیچ کاربری نمی‌فرستد و هیچ ستونی را نمی‌نویسد. فقط یک پیام
// به مالک می‌دهد که **آماده‌ی کپی در Claude Code** است، و تصمیمِ بعدی با اوست.
//
// ═══ سه گاردِ ضدِ خودفریبی (خواسته‌ی صریحِ مالک) ═══
//   ۱) **بیش از یک کاربرِ متمایز** — «شاید خودِ کاربر دست‌وپاچلفتی بوده» یک توضیحِ
//      کاملاً محتمل است برای یک نفر، و یک توضیحِ مسخره برای پنج نفر. یک نفر هرگز
//      هشدار نمی‌سازد.
//   ۲) **ادمین/تستر حذف** — مالک عمداً فلوها را بارها تکرار می‌کند؛ او پرتکرارترین
//      «گیرکرده»ی هر دیتاست است و اگر شمرده شود هشدار دائماً شلیک می‌کند.
//   ۳) **یک هشدار per صفحه در ۲۴ ساعت** — هشداری که هر پنج دقیقه تکرار شود، در دو
//      روز به نویز تبدیل می‌شود و خرابیِ واقعی لایش گم می‌شود (همان پینگ‌پنگِ `chmod`
//      در بند ۳ ریشه).
//
// ⚠️ **چرا تشخیص در JS است و نه در SQL:** نسخه‌ی اول یک زیرکوئریِ همبسته داشت که برای
// هر ردیف کلِ پنجره را دوباره می‌شمرد (O(n²) روی چند هزار ردیف)، و بدتر از کندی این
// بود که عددی که به مالک گزارش می‌شد **معنیِ ادعاشده را نداشت**: با آستانه‌ی ۴ ویو،
// فقط ردیفِ چهارم شرط را پاس می‌کرد، پس «۴ بازدید» به‌صورت `views: 1` چاپ می‌شد. حالا
// یک کوئریِ ساده ردیف‌ها را می‌آورد و پنجره‌ی لغزان در JS حساب می‌شود؛ هم خواناست، هم
// هر عددِ گزارش دقیقاً همان چیزی است که اسمش می‌گوید، هم تست کردنش بی‌دردسر است.
import { pathToFileURL } from 'node:url';

/* ── پارامترها. عمداً export شده‌اند تا چکِ CI بتواند با مقادیرِ دیگر هم اجرا کند. ── */
export const STUCK = {
  WINDOW_H: 2,        // پنجره‌ی رفتاری: چهار بار دیدنِ یک صفحه در «دو ساعت» یعنی حلقه
  MIN_VIEWS: 4,       // زیرِ چهار بار، تکرارِ طبیعیِ ناوبری است نه گیر افتادن
  MIN_USERS: 2,       // خواسته‌ی مالک: «بیش از ۱ کاربر»
  LOOKBACK_H: 6,      // چقدر عقب را بگردیم (پنجره‌های همپوشان)
  COOLDOWN_H: 24,     // یک هشدار per صفحه در ۲۴ ساعت
};

/* ⚠️ «چهار بار دیدنِ یک صفحه» با «چهار بار رد شدن از یک صفحه» فرق دارد و همین تفاوت
 * کلِ ارزشِ این تشخیص است. صفحه‌ی منوی اصلی را کاربرِ سالم هم روزی ده بار می‌بیند.
 * پس پنجره **کوتاه** است (۲ ساعت) و آستانه روی تکرارِ فشرده می‌نشیند، نه مجموعِ روز.
 *
 * و صفحه‌ای که ذاتاً تکرارشونده است از تشخیص بیرون است: `content` سطلِ خروجیِ LLM
 * است (هر فال چند پیامِ محتوایی دارد، پس ۴ بار در ۲ ساعت کاملاً عادی است). شمردنش
 * یعنی هشدار برای رفتارِ کاملاً سالم. */
export const IGNORED_SCREENS = new Set(['content']);

/* SQL عمداً یک‌جا، ساده و پارامتری است (بند ۹ ریشه: هیچ ورودی‌ای در SQL interpolate
 * نمی‌شود). `props` یک JSON است و ستونِ رویداد `event` نام دارد (نه `name`) — قراردادِ
 * shared/analytics.js. `adm` وقتی ۱ است که کاربر ادمین/تستر باشد.
 * ترتیب با `id` است نه `created_at`: ثانیه‌ی یکسان در یک ثانیه چند رویداد دارد و
 * «قدمِ قبلی» بدونِ ترتیبِ قطعی بی‌معنی می‌شود. */
const SQL_VIEWS = `
  SELECT id, user_id AS uid, json_extract(props, '$.k') AS k, created_at AS ts
  FROM events
  WHERE event = 'view'
    AND created_at >= ?
    AND COALESCE(json_extract(props, '$.adm'), 0) = 0
    AND user_id IS NOT NULL
    AND json_extract(props, '$.k') IS NOT NULL
  ORDER BY id
`;

/** بیشترین تعدادِ بازدید در یک پنجره‌ی `windowS` ثانیه‌ای (پنجره‌ی لغزان روی زمان‌های
 *  مرتب). خروجی = «فشرده‌ترین خوشه»، که همان چیزی است که «حلقه» را می‌سازد؛ مجموعِ
 *  کلِ روز این را نشان نمی‌دهد. */
export function maxBurst(tsList, windowS) {
  let lo = 0, best = 0;
  for (let hi = 0; hi < tsList.length; hi++) {
    while (tsList[hi] - tsList[lo] > windowS) lo++;
    const n = hi - lo + 1;
    if (n > best) best = n;
  }
  return best;
}

/** یافتن صفحه‌هایی که چند کاربر در آن‌ها حلقه خورده‌اند.
 *  `db` هر شیئی با `prepare().all()/.get()` (better-sqlite3) — تزریق می‌شود تا تست
 *  بتواند دیتابیسِ در-حافظه بدهد و این فایل هیچ وابستگیِ npm نگیرد. */
export function findStuckScreens(db, { now = Math.floor(Date.now() / 1000), cfg = STUCK } = {}) {
  const since = now - cfg.LOOKBACK_H * 3600;
  const rows = db.prepare(SQL_VIEWS).all(since);

  // (۱) ردیف‌ها را per کاربر جمع کن. چون به ترتیبِ id آمده‌اند، «قدمِ قبلی» همان
  //     عنصرِ قبلی در همین آرایه است و هیچ join دومی لازم نیست.
  const byUser = new Map();
  for (const r of rows) {
    let a = byUser.get(r.uid);
    if (!a) byUser.set(r.uid, (a = []));
    a.push(r);
  }

  // (۲) per (کاربر × صفحه) خوشه‌ی فشرده را حساب کن.
  const perScreen = new Map(); // k → { users:Set, views, lastTs, prev:Map }
  for (const [uid, list] of byUser) {
    const seen = new Map(); // k → { ts:[], prev:string, first:boolean }
    for (let i = 0; i < list.length; i++) {
      const { k, ts } = list[i];
      let s = seen.get(k);
      if (!s) seen.set(k, (s = { ts: [], prev: '' }));
      s.ts.push(ts);
      // قدمِ قبلی = اولین صفحه‌ی **متفاوتی** که کاربر بلافاصله پیش از این دیده.
      // فقط بارِ اول ثبت می‌شود: ورودِ کاربر به حلقه مهم است، نه چرخشِ داخلِ آن.
      if (!s.prev) {
        for (let j = i - 1; j >= 0; j--) if (list[j].k !== k) { s.prev = list[j].k; break; }
      }
    }
    for (const [k, s] of seen) {
      if (IGNORED_SCREENS.has(k)) continue;
      if (maxBurst(s.ts, cfg.WINDOW_H * 3600) < cfg.MIN_VIEWS) continue;
      let agg = perScreen.get(k);
      if (!agg) perScreen.set(k, (agg = { users: new Set(), views: 0, lastTs: 0, prev: new Map() }));
      agg.users.add(uid);
      agg.views += s.ts.length;
      agg.lastTs = Math.max(agg.lastTs, s.ts[s.ts.length - 1]);
      if (s.prev) agg.prev.set(s.prev, (agg.prev.get(s.prev) || 0) + 1);
    }
  }

  // (۳) گاردِ «بیش از یک کاربر» + برچسبِ خوانای صفحه از کاتالوگ.
  const out = [];
  for (const [k, agg] of perScreen) {
    if (agg.users.size < cfg.MIN_USERS) continue;
    let label = '', sample = '', buttons = '';
    try {
      const s = db.prepare('SELECT label, sample, buttons FROM screens WHERE k=?').get(k) || {};
      ({ label = '', sample = '', buttons = '' } = s);
    } catch { /* جدولِ screens هنوز نیست (رباتِ بدونِ journey) — یافته بی‌برچسب می‌ماند */ }
    const prev = [...agg.prev.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    out.push({
      k, users: agg.users.size, views: agg.views, lastTs: agg.lastTs,
      uids: [...agg.users].slice(0, 10).map(String),
      label: String(label || ''), buttons: String(buttons || ''), prev,
      sample: String(sample || '').replace(/\s+/g, ' ').slice(0, 120),
    });
  }
  out.sort((a, b) => b.users - a.users || b.views - a.views);
  return out;
}

/* پیامِ مالک. شکلش عمداً **آماده‌ی کپی در Claude Code** است (خواسته‌ی صریحِ مالک:
 * «اون پیام رو بیام فقط کپی کنم برای کلاد کد که خودش بتونه بررسی کنه»)، پس:
 *   • با یک جمله‌ی دستوری شروع می‌شود که خودش یک prompt کامل است.
 *   • کلیدِ صفحه و آی‌دی‌ها خام می‌آیند تا مستقیم در کوئریِ Ops قابلِ استفاده باشند.
 *   • نمونه‌ی متنِ صفحه هست تا لازم نباشد اول دنبالِ «این کدام صفحه است» بگردیم. */
export function formatAlert(bot, findings, cfg = STUCK) {
  const lines = [
    `🔁 چند کاربر در ${findings.length === 1 ? 'یک صفحه' : `${findings.length} صفحه`} گیر کرده‌اند. ربات: ${bot}`,
    '',
    'این پیام را برای Claude Code کپی کن:',
    '─────────',
    `در ربات ${bot} این صفحه‌ها الگوی حلقه دارند (هر کاربر ${cfg.MIN_VIEWS}+ بار در ${cfg.WINDOW_H} ساعت). `
      + 'بررسی کن چرا کاربر از این صفحه جلو نمی‌رود و اگر باگ است فیکسش کن:',
    '',
  ];
  for (const f of findings) {
    lines.push(`• صفحه \`${f.k}\`${f.label ? ` (${f.label})` : ''} · ${f.users} کاربر، ${f.views} بازدید`);
    if (f.sample) lines.push(`  متنِ صفحه: «${f.sample}»`);
    if (f.buttons) lines.push(`  دکمه‌ها: ${f.buttons.slice(0, 100)}`);
    if (f.prev) lines.push(`  قدمِ قبلی: \`${f.prev}\``);
    lines.push(`  کاربرها: ${f.uids.join(', ')}`);
  }
  lines.push('─────────', '', '⚠️ هیچ پیامی به این کاربران نرفته و نباید خودکار برود (بند ۹ب-۴).');
  return lines.join('\n');
}

/** یک دورِ کامل: تشخیص + گاردِ کول‌داون. `state` همان state فایلِ health-watch است.
 *  خروجی: `{ text, keys }` یا `null` وقتی چیزی برای گفتن نیست. */
export function stuckCycle(db, bot, state, { now = Math.floor(Date.now() / 1000), cfg = STUCK } = {}) {
  const all = findStuckScreens(db, { now, cfg });
  state.stuck = state.stuck || {};
  const fresh = all.filter((f) => now - (state.stuck[`${bot}:${f.k}`] || 0) >= cfg.COOLDOWN_H * 3600);
  // ⚠️ مهر فقط روی همان‌هایی می‌نشیند که واقعاً گزارش می‌شوند. مهر زدن روی یافته‌ی
  // کول‌داون‌خورده، کول‌داون را برای همیشه تمدید می‌کرد و هشدار دیگر هرگز نمی‌آمد.
  if (!fresh.length) return null;
  for (const f of fresh) state.stuck[`${bot}:${f.k}`] = now;
  return { text: formatAlert(bot, fresh, cfg), keys: fresh.map((f) => f.k) };
}

/* اجرای دستی برای بررسیِ یک دیتابیس (بدونِ ارسالِ هیچ پیامی):
 *   node tools/stuck-detect.mjs bots/tarot/data/bot-fa.db
 *
 * ⚠️ گاردِ «این فایل مستقیم اجرا شده» با مقایسه‌ی خودِ مسیر است، نه `endsWith`:
 * `check-stuck-detect.mjs` هم به همان رشته ختم می‌شود، پس نسخه‌ی اول با importِ چک
 * هم شلیک می‌کرد و کلِ چک را با پیامِ usage می‌کشت. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) { console.error('usage: node tools/stuck-detect.mjs <db-path>'); process.exit(2); }
  const { default: Database } = await import(
    new URL('../bots/tarot/node_modules/better-sqlite3/lib/index.js', import.meta.url));
  const db = new Database(path, { readonly: true });
  const f = findStuckScreens(db);
  console.log(f.length ? formatAlert(path.split('/').pop(), f) : '✅ هیچ الگوی حلقه‌ای پیدا نشد.');
}
