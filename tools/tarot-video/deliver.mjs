#!/usr/bin/env node
// ارسالِ ویدیوی رندرشده به چتِ ادمین‌ها، و تازه بعدِ آن علامت‌زدنِ ردیفِ نوشن.
//
// ترتیب عمدی است و تنها ترتیبِ درست است: تا ویدیو واقعاً به دستِ مالک نرسیده، سوال
// «استفاده‌شده» نمی‌شود. اگر برعکس بود، هر شکستِ رندر یا ارسال یک سوال را برای همیشه
// می‌سوزاند. حالتِ برعکسش (ارسالِ موفق ولی شکستِ علامت‌زدن) تنها مسیری است که می‌تواند
// یک سوال را دوبار مصرف کند، پس صریح قرمز می‌شود و به مالک می‌گوید دستی علامتش بزند.
//
// اجرا:
//   node tools/tarot-video/deliver.mjs --video out/reel.mp4 --props props.json
//   node tools/tarot-video/deliver.mjs --video out/reel.mp4 --props props.json --dry
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createNotion, notionErrorFa } from './notion.mjs';
import { validateProps } from './props.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

// سقفِ عملیِ آپلودِ Bot API روی ۵۰ مگابایت است؛ کمی زیرش می‌ایستیم تا سربارِ مالتی‌پارت
// ما را از لبه رد نکند.
const MAX_BYTES = 49 * 1024 * 1024;
// سقفِ ریلزِ اینستاگرام. زمان‌بندیِ کامپوزیشن خودش زیرِ ۵۸ ثانیه می‌ماند؛ این‌جا آخرین
// شبکه‌ی ایمنی است، روی خودِ فایلِ رندرشده نه روی برنامه‌ی صحنه‌ها.
const MAX_SECONDS = 60;
const CAPTION_MAX = 1024;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? d) : d; };

const DRY = flag('dry');
const VIDEO = val('video');
const PROPS = val('props');

const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };
const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p));
// نامِ فلگ از یک تابع می‌آید و نه مستقیم داخلِ متنِ فارسی. دلیل: قاعده‌ی بند ۱۰ ریشه
// خطِ تیره را در متنِ رو-به-کاربر ممنوع می‌کند و سنجه‌های خودکار نمی‌توانند «نشانه‌گذاری»
// را از «نامِ فلگ» تشخیص بدهند. این‌طوری پیام نامِ واقعیِ فلگ را می‌گوید بدونِ ابهام.
const cli = (n) => `--${n}`;

// متنِ سوال از نوشن می‌آید و ورودیِ بیرونی است؛ کپشن با `parse_mode: HTML` می‌رود، پس
// هر `<` یا `&` می‌تواند کلِ پیام را رد کند. داده است نه نشانه‌گذاری.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const admins = () => String(process.env.OWNER_TELEGRAM_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** فراخوانیِ Bot API. `isForm` برای مالتی‌پارت (الگوی `tools/marketing/publish-day.mjs`). */
async function tg(method, token, body, isForm = false) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    ...(isForm ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({ ok: false, description: 'پاسخ غیر JSON' }));
  if (!json.ok) throw new Error(json.description || 'خطای ناشناخته تلگرام');
  return json.result;
}

/**
 * مدتِ ویدیو به ثانیه با `ffprobe`.
 * @returns {number|null} `null` یعنی نشد اندازه گرفت (ابزار نبود یا فایل خوانده نشد).
 *   نبودنِ ffprobe عمداً کشنده نیست: این یک لایه‌ی اضافه است، نه تنها گاردِ مدت.
 */
export function probeDuration(file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const sec = Number(String(out).trim());
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  } catch {
    return null;
  }
}

/**
 * کپشنِ کوتاهِ فارسی. **خالص** تا سقفِ ۱۰۲۴ کاراکترش قابلِ تست بماند.
 * ترتیب عمدی است: سوال اول (چیزی که مالک باید بخواند)، بعد نامِ چیدمان، بعد لینکِ ران
 * که فقط برای پیگیری است.
 */
export function buildCaption(props, runUrl = '') {
  const q = String(props?.question || '').replace(/\s+/g, ' ').trim();
  const spread = String(props?.spreadFa || '').replace(/\s+/g, ' ').trim();
  const tail = [
    spread ? `🔮 چیدمان: ${esc(spread)}` : '',
    runUrl ? `🔗 ${esc(runUrl)}` : '',
  ].filter(Boolean).join('\n');

  // کوتاه‌کردن روی **سوال** انجام می‌شود نه روی لینک: لینکِ نصفه بی‌فایده است ولی سوالِ
  // کوتاه‌شده هنوز خواناست. اندازه بعد از escape سنجیده می‌شود، چون یک `&` سه کاراکتر
  // می‌شود و شمارشِ قبل از escape می‌تواند ما را از سقف رد کند.
  const assemble = (text) => [`❓ ${esc(text)}`, tail].filter(Boolean).join('\n\n').trim();
  if (assemble(q).length <= CAPTION_MAX) return assemble(q);
  let shortQ = q;
  while (shortQ && assemble(`${shortQ}…`).length > CAPTION_MAX) shortQ = shortQ.slice(0, -1);
  return assemble(`${shortQ}…`);
}

async function main() {
  if (!VIDEO) fail(`فلگ ${cli('video')} لازم است`);
  if (!PROPS) fail(`فلگ ${cli('props')} لازم است`);

  const videoPath = abs(VIDEO);
  const propsPath = abs(PROPS);

  if (!existsSync(videoPath)) fail(`فایلِ ویدیو پیدا نشد: ${VIDEO}`);
  if (!existsSync(propsPath)) fail(`فایلِ props پیدا نشد: ${PROPS}`);

  let props;
  try { props = JSON.parse(readFileSync(propsPath, 'utf8')); }
  catch (e) { fail(`propsِ نامعتبر: ${e.message}`); }

  // اعتبارسنجیِ دوباره‌ی props درست قبل از ارسال: بینِ ساخت و این‌جا یک رندر فاصله است
  // و فایل ممکن است دستی عوض شده باشد.
  const errs = validateProps(props);
  if (errs.length) {
    console.error(`❌ props معتبر نیست (${errs.length} ایراد):`);
    for (const e of errs) console.error(`   • ${e}`);
    fail('propsِ نامعتبر؛ چیزی ارسال نشد');
  }

  const size = statSync(videoPath).size;
  if (size > MAX_BYTES) {
    fail(`حجمِ ویدیو ${(size / 1024 / 1024).toFixed(1)} مگابایت است؛ سقفِ ارسال ${(MAX_BYTES / 1024 / 1024).toFixed(0)} مگابایت`);
  }
  if (!size && !DRY) fail('فایلِ ویدیو خالی است');

  const duration = probeDuration(videoPath);
  if (duration === null) console.log('⚠️ مدتِ ویدیو اندازه‌گیری نشد (ffprobe در دسترس نبود یا فایل خوانده نشد)');
  else if (duration > MAX_SECONDS) fail(`مدتِ ویدیو ${duration.toFixed(1)} ثانیه است؛ اینستاگرام بالای ${MAX_SECONDS} ثانیه را می‌بُرد`);
  else console.log(`⏱ مدت: ${duration.toFixed(1)} ثانیه`);

  const runUrl = process.env.RUN_URL || '';
  const caption = buildCaption(props, runUrl);
  console.log(`📝 کپشن (${caption.length} کاراکتر):\n${caption}`);

  if (DRY) {
    console.log(`🔎 حالت dry: ${(size / 1024 / 1024).toFixed(2)} مگابایت آماده‌ی ارسال بود، ولی چیزی فرستاده نشد و ردیفِ نوشن هم دست نخورد`);
    return;
  }

  const token = process.env.TAROT_BOT_TOKEN;
  if (!token) fail('TAROT_BOT_TOKEN ست نیست');
  const ids = admins();
  if (!ids.length) fail('OWNER_TELEGRAM_ID ست نیست؛ گیرنده‌ای برای ویدیو وجود ندارد');

  const buf = readFileSync(videoPath);
  let sent = 0;
  for (const chatId of ids) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('width', '1080');
    form.append('height', '1920');
    if (duration !== null) form.append('duration', String(Math.round(duration)));
    form.append('supports_streaming', 'true');
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('video', new Blob([buf], { type: 'video/mp4' }), path.basename(videoPath));
    try {
      const r = await tg('sendVideo', token, form, true);
      sent++;
      console.log(`✅ ویدیو برای ${chatId} فرستاده شد (message_id=${r.message_id})`);
    } catch (e) {
      console.error(`❌ ارسال به ${chatId} نشد: ${e.message}`);
    }
  }
  if (!sent) fail('ویدیو به هیچ ادمینی نرسید؛ ردیفِ نوشن دست‌نخورده ماند و همان سوال دوباره استفاده می‌شود');

  /* ── علامت‌زدنِ ردیفِ نوشن، فقط بعد از حداقل یک ارسالِ موفق ── */
  const pageId = String(props?.meta?.pageId || '');
  if (!pageId) { console.log('ℹ️ این فال از نوشن نیامده بود؛ چیزی برای علامت‌زدن نیست'); return; }

  const notionToken = process.env.NOTION_TOKEN || process.env.TAROT_VIDEO_NOTION_TOKEN || '';
  const notion = createNotion({ token: notionToken });
  if (!notion) {
    fail(`ویدیو رسید ولی ردیفِ Notion علامت نخورد (توکنِ نوشن ست نیست). صفحه‌ی ${pageId} را دستی استفاده‌شده کن، وگرنه همین سوال دوباره ویدیو می‌شود.`);
  }
  try {
    await notion.markUsed(pageId, { runUrl });
    console.log(`🗂 ردیفِ نوشن استفاده‌شده علامت خورد: ${pageId}`);
  } catch (e) {
    console.error(notionErrorFa(e));
    fail(`ویدیو رسید ولی ردیفِ Notion علامت نخورد. صفحه‌ی ${pageId} را دستی استفاده‌شده کن، وگرنه همین سوال دوباره ویدیو می‌شود.`);
  }
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));
