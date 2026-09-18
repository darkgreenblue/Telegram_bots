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
// است. تنها منبعی که الگوی رفتاری دارد جدولِ journey است (رویدادهای `view` و `act`،
// یعنی هم صفحه و هم اقدامِ قبلش). پس این تشخیص از همان می‌خواند، نه از `users.state`.
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
// ═══ ⚠️ معیار: تکرارِ **پیاپی**، نه تکرار در یک پنجره ═══
//
// این مهم‌ترین تصمیمِ این فایل است و روی **دیتای زنده** گرفته شد، نه از شهود. نسخه‌ی
// اول می‌گفت «۴ بار دیدنِ یک صفحه در ۲ ساعت = حلقه». همان معیار روی یک هفته‌ی واقعیِ
// رباتِ فارسی اجرا شد و **۲۹ صفحه** را علامت زد: پی‌وال، پیامِ خوش‌آمد، گیتِ عضویت،
// منوی تنظیمات، صفحه‌ی موجودی. هیچ‌کدام باگ نبودند؛ همه صفحه‌هایی‌اند که کاربرِ سالم
// طبیعتاً به آن‌ها **برمی‌گردد**. یعنی همان اشتباهِ v3.78.0 با لباسِ تازه: رها کردن و
// تجدیدِ نظر، «گیر افتادن» خوانده می‌شد.
//
// تفاوتِ واقعیِ «گیر افتادن» با «برگشتن» تکرار نیست، **نبودِ پیشرفت** است. کاربرِ
// سالم بینِ دو بازدید از منو، جای دیگری هم می‌رود؛ کاربرِ گیرکرده همان صفحه را پشتِ
// سرِ هم می‌بیند و هیچ صفحه‌ی دیگری وسطش نیست (اثرانگشتِ دقیقِ تیکتِ #TRT-8976388520:
// تپ ⟶ همان صفحه ⟶ تپ ⟶ همان صفحه).
//
// همان کوئری با شرطِ «پیاپی» روی همان هفته: **۲۹ صفحه ⟵ ۱ صفحه** (گیتِ عضویت، ۲
// کاربر). یعنی از ~۵ هشدارِ کاذب در روز به ~۱ هشدار در هفته. هشداری که همیشه شلیک
// کند همان‌قدر بی‌فایده است که هشداری که هیچ نمی‌گوید (بند ۳ ریشه، پینگ‌پنگِ chmod).
//
// ⚠️ **و تشخیص در JS است نه SQL:** نسخه‌ی اول یک زیرکوئریِ همبسته داشت که هم O(n²)
// بود (اجرای واقعی‌اش روی دیتابیسِ زنده از ۴ دقیقه گذشت و لغو شد) و هم عددی گزارش
// می‌کرد که **معنیِ ادعاشده را نداشت**: با آستانه‌ی ۴، «۴ بازدید» به‌صورت `views: 1`
// چاپ می‌شد. حالا یک کوئریِ ساده ردیف‌ها را می‌آورد و بقیه در JS حساب می‌شود.
import { pathToFileURL } from 'node:url';

/* ── پارامترها. عمداً export شده‌اند تا چکِ CI بتواند با مقادیرِ دیگر هم اجرا کند. ── */
export const STUCK = {
  WINDOW_H: 2,        // پنجره‌ی رفتاری: چهار بار دیدنِ یک صفحه در «دو ساعت» یعنی حلقه
  MIN_VIEWS: 4,       // زیرِ چهار بار، تکرارِ طبیعیِ ناوبری است نه گیر افتادن
  MIN_USERS: 2,       // خواسته‌ی مالک: «بیش از ۱ کاربر»
  LOOKBACK_H: 6,      // چقدر عقب را بگردیم (پنجره‌های همپوشان)
  COOLDOWN_H: 24,     // یک هشدار per صفحه در ۲۴ ساعت
};

/* ⚠️ `content` حتی با معیارِ «پیاپی» هم باید بیرون بماند، و این‌جا **مهم‌تر** از قبل
 * است نه کم‌اهمیت‌تر: سطلِ خروجیِ LLM است و هر فال چند پیامِ محتواییِ **پشتِ سرِ هم**
 * می‌سازد، یعنی دقیقاً شکلِ یک حلقه‌ی پیاپی را دارد در حالی که سالم‌ترین رفتارِ ممکن
 * است. */
export const IGNORED_SCREENS = new Set(['content']);

/* SQL عمداً یک‌جا، ساده و پارامتری است (بند ۹ ریشه: هیچ ورودی‌ای در SQL interpolate
 * نمی‌شود). `props` یک JSON است و ستونِ رویداد `event` نام دارد (نه `name`) — قراردادِ
 * shared/analytics.js. `adm` وقتی ۱ است که کاربر ادمین/تستر باشد.
 * ترتیب با `id` است نه `created_at`: ثانیه‌ی یکسان در یک ثانیه چند رویداد دارد و
 * «قدمِ قبلی» بدونِ ترتیبِ قطعی بی‌معنی می‌شود. */
const SQL_JOURNEY = `
  SELECT id, user_id AS uid, event,
    json_extract(props, '$.k') AS k,
    json_extract(props, '$.a') AS a,
    json_extract(props, '$.d') AS d,
    created_at AS ts
  FROM events
  WHERE event IN ('view', 'act')
    AND created_at >= ?
    AND COALESCE(json_extract(props, '$.adm'), 0) = 0
    AND user_id IS NOT NULL
    AND (event <> 'view' OR json_extract(props, '$.k') IS NOT NULL)
    AND (event <> 'act' OR json_extract(props, '$.a') IS NOT NULL)
  ORDER BY id
`;

// `/menu` یک دستورِ صریح برای نمایش دوباره‌ی همین صفحه‌ی ادامه است؛ تکرارِ آن توسطِ
// کاربر «خروجیِ گیرکرده» نیست. این استثنا عمداً بسیار باریک است: هیچ callback یا
// دستورِ دیگری را نادیده نمی‌گیریم، پس دکمه‌ای که به‌اشتباه همان صفحه را برمی‌گرداند
// همچنان با همین ناظر دیده می‌شود.
const isExplicitMenuCommand = (r) => r?.event === 'act' && r.a === 'cmd'
  && /^\/menu(?:@[A-Za-z0-9_]+)?$/i.test(String(r.d || ''));

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
  const rows = db.prepare(SQL_JOURNEY).all(since);

  // (۱) همه‌ی رویدادهای لازم را per کاربر جمع کن. «act» هم لازم است: وگرنه یک
  //     دستورِ آگاهانه‌ی /menu که همان صفحه را بازمی‌کشد، از چهار view پیاپی قابلِ
  //     تشخیص نیست. ترتیب با id قطعی است و هیچ join دومی لازم نیست.
  const byUser = new Map();
  for (const r of rows) {
    let a = byUser.get(r.uid);
    if (!a) byUser.set(r.uid, (a = []));
    a.push(r);
  }

  // (۲) per کاربر، فقط viewها را به **رشته‌های پیاپیِ** یک صفحه بشکن. نمایش‌هایی که
  //     بلافاصله پاسخِ /menu هستند از نامزدها کنار می‌روند؛ بقیه‌ی actionها عمداً
  //     رشته را نمی‌شکنند تا loop واقعیِ «تپ ⟶ همان صفحه» پنهان نشود.
  //     هر رشته یک نامزدِ
  //     حلقه است؛ صفحه‌ای که وسطش بیاید رشته را می‌بندد، چون یعنی کاربر پیشرفت کرد.
  const perScreen = new Map(); // k → { users:Set, views, lastTs, prev:Map }
  for (const [uid, list] of byUser) {
    const views = list.filter((r, i) => r.event === 'view' && !isExplicitMenuCommand(list[i - 1]));
    for (let i = 0; i < views.length;) {
      const k = views[i].k;
      let j = i;
      while (j < views.length && views[j].k === k) j++;
      const run = views.slice(i, j);
      const prev = i > 0 ? views[i - 1].k : '';
      i = j;
      if (IGNORED_SCREENS.has(k)) continue;
      // رشته‌ی پیاپی لازم است ولی کافی نیست: چهار تکرار در سه روز حلقه نیست.
      if (maxBurst(run.map((r) => r.ts), cfg.WINDOW_H * 3600) < cfg.MIN_VIEWS) continue;
      let agg = perScreen.get(k);
      if (!agg) perScreen.set(k, (agg = { users: new Set(), views: 0, lastTs: 0, prev: new Map() }));
      agg.users.add(uid);
      agg.views += run.length;
      agg.lastTs = Math.max(agg.lastTs, run[run.length - 1].ts);
      // قدمِ قبلی = صفحه‌ای که کاربر **بلافاصله** پیش از ورود به حلقه دیده.
      if (prev) agg.prev.set(prev, (agg.prev.get(prev) || 0) + 1);
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
    `در ربات ${bot} این صفحه‌ها الگوی حلقه دارند: کاربر همان صفحه را ${cfg.MIN_VIEWS}+ بارِ `
      + `**پشتِ سرِ هم** در ${cfg.WINDOW_H} ساعت دیده، بدونِ اینکه هیچ صفحه‌ی دیگری وسطش بیاید. `
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
