#!/usr/bin/env node
/* فرستادنِ فایل و متنِ داخلِ ریپو به تلگرامِ مالک.
 *
 * 🐛 چرا اسکریپت شد و در YAML نماند: نسخه‌ی اولِ این ابزار یک حلقه‌ی شل بود که
 * آیتم‌ها را با **خطِ جدید** از هم جدا می‌کرد. اولین استفاده‌ی واقعی شکستش: خودِ
 * کپشن‌ها چندخطی بودند، پس خطِ دومِ هر کپشن به‌عنوان «مسیرِ فایلِ بعدی» خوانده شد و
 * جاب وسطِ کار مرد — بعد از اینکه اولین عکس **واقعاً فرستاده شده بود**. یعنی نه فقط
 * شکست، بلکه شکستِ نیمه‌کاره.
 *
 * ورودی حالا JSON است (مبهم نیست)، و منطق این‌جاست تا `tools/check-send-owner.mjs`
 * بتواند واقعاً اجرایش کند.
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DRY = process.argv.includes('--dry');
const CAPTION_MAX = 1024;   // سقفِ کپشنِ عکس در Bot API
const TEXT_MAX = 4096;      // سقفِ پیامِ متنی

export function parseItems(raw) {
  if (!raw || !raw.trim()) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { throw new Error(`items باید JSON معتبر باشد: ${e.message}`); }
  if (!Array.isArray(arr)) throw new Error('items باید یک آرایه باشد');
  return arr.map((it, i) => {
    const path = String(it?.path ?? '').trim();
    const caption = String(it?.caption ?? '');
    if (!path) throw new Error(`آیتمِ ${i + 1}: path خالی است`);
    if (caption.length > CAPTION_MAX) {
      throw new Error(`آیتمِ ${i + 1}: کپشن ${caption.length} کاراکتر است، سقف ${CAPTION_MAX}`);
    }
    return { path, caption };
  });
}

/** مسیر باید داخلِ خودِ ریپو بماند و یک فایلِ واقعی باشد. */
export function safePath(path) {
  const abs = resolve(ROOT, path);
  const rel = relative(ROOT, abs);
  if (rel.startsWith('..') || resolve(path) === path) {
    throw new Error(`مسیر باید نسبی و داخلِ ریپو باشد: ${path}`);
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`فایل نیست: ${path}`);
  return abs;
}

async function post(api, method, form) {
  const res = await fetch(`${api}/${method}`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`${method} شکست خورد: ${res.status} ${body.description || ''}`);
  }
}

async function main() {
  const token = process.env.TOKEN || '';
  const owner = process.env.OWNER || '';
  const text = process.env.TEXT || '';
  const items = parseItems(process.env.ITEMS || '');

  if (!DRY) {
    if (!token) throw new Error('TOKEN ست نیست (VOICE2TEXT_BOT_TOKEN)');
    if (!owner) throw new Error('OWNER ست نیست (OWNER_TELEGRAM_ID)');
  }
  if (text.length > TEXT_MAX) throw new Error(`متن ${text.length} کاراکتر است، سقف ${TEXT_MAX}`);
  // OWNER می‌تواند چندتایی باشد؛ گیرنده اولین آی‌دی است.
  const chat = owner.split(',')[0].trim();
  const api = `https://api.telegram.org/bot${token}`;

  // ⚠️ همه‌ی مسیرها **قبل از** اولین ارسال اعتبارسنجی می‌شوند. نسخه‌ی شلی وسطِ کار
  // می‌مرد و بعضی عکس‌ها رفته بودند و بعضی نه.
  const files = items.map((it) => ({ ...it, abs: safePath(it.path) }));

  if (text) {
    if (DRY) console.log(`[dry] پیامِ متنی (${text.length} کاراکتر)`);
    else {
      const f = new FormData();
      f.set('chat_id', chat); f.set('text', text);
      await post(api, 'sendMessage', f);
    }
    console.log('✅ پیامِ متنی');
  }
  for (const it of files) {
    if (DRY) { console.log(`[dry] عکس: ${it.path} (کپشن ${it.caption.length} کاراکتر)`); continue; }
    const f = new FormData();
    f.set('chat_id', chat);
    if (it.caption) f.set('caption', it.caption);
    f.set('photo', new Blob([readFileSync(it.abs)]), it.path.split('/').pop());
    await post(api, 'sendPhoto', f);
    console.log(`✅ ${it.path}`);
  }
  console.log(`تمام: ${text ? 1 : 0} پیام، ${files.length} عکس`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
