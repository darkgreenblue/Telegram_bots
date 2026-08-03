#!/usr/bin/env node
// انتشارِ «روزِ کامل» در کانال: یک پیامِ هدر (تاریخ) + دوازده پستِ تصویری، از فروردین تا اسفند.
//
//   node tools/marketing/publish-day.mjs --file marketing/tarot/posts/2026-08-02-day.json
//   node tools/marketing/publish-day.mjs --file <path> --dry-run     (فقط اعتبارسنجی، بدون ارسال)
//
// توکن از env: TELEGRAM_TOKEN
//
// چرا Node و نه bash: ارسالِ مالتی‌پارتِ عکس + کیبوردِ اینلاین + اعتبارسنجیِ دوازده پست
// در bash شکننده می‌شود. اینجا هر خطا صریح است و جاب با کدِ غیرصفر می‌میرد تا هشدار برود.
//
// محدودیتِ سختِ تلگرام: کپشنِ عکس حداکثر ۱۰۲۴ کاراکتر است (متنِ پیامِ ساده ۴۰۹۶).
// اگر تفسیر بلندتر شد باید کوتاه شود، وگرنه تلگرام کلِ پست را رد می‌کند.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPTION_MAX = 1024;
const GAP_MS = 2500; // فاصله‌ی بین پست‌ها؛ سیزده پیام در ~۳۵ ثانیه، خیلی زیر سقفِ نرخِ تلگرام
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
                'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function args() {
  const a = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = a.indexOf(`--${k}`);
    return i === -1 ? d : a[i + 1];
  };
  return { file: get('file'), dryRun: a.includes('--dry-run') };
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/** اعتبارسنجیِ کاملِ فایلِ روز — قبل از ارسالِ حتی یک پیام */
export function validateDay(day) {
  const errs = [];
  if (!day || typeof day !== 'object') return ['فایل روز آبجکت نیست'];
  if (!/^(@[A-Za-z0-9_]+|-100\d+)$/.test(String(day.chat || ''))) errs.push(`chat نامعتبر: «${day.chat}»`);
  if (!day.header || typeof day.header !== 'string' || !day.header.trim()) errs.push('هدر خالی است');
  else if (day.header.length > 4096) errs.push(`هدر ${day.header.length} کاراکتر است (سقف ۴۰۹۶)`);

  const posts = Array.isArray(day.posts) ? day.posts : [];
  if (posts.length !== 12) errs.push(`تعداد پست‌ها ${posts.length} است، باید ۱۲ باشد`);

  const seenCards = new Set();
  posts.forEach((p, i) => {
    const tag = `پست ${i + 1}`;
    if (p.month !== MONTHS[i]) errs.push(`${tag}: ماه «${p.month}» است ولی باید «${MONTHS[i]}» باشد (ترتیب فروردین تا اسفند)`);
    if (!p.caption || !p.caption.trim()) errs.push(`${tag}: کپشن خالی`);
    else if (p.caption.length > CAPTION_MAX) errs.push(`${tag}: کپشن ${p.caption.length} کاراکتر (سقف ${CAPTION_MAX})`);
    if (p.caption && !p.caption.includes(`#${p.month}`)) errs.push(`${tag}: هشتگ #${p.month} در کپشن نیست`);
    if (!p.file) errs.push(`${tag}: فیلد file ندارد`);
    else if (!existsSync(join(ROOT, 'bots/tarot/assets/cards', p.file))) errs.push(`${tag}: تصویر «${p.file}» پیدا نشد`);
    if (p.key) {
      if (seenCards.has(p.key)) errs.push(`${tag}: کارت «${p.key}» در همین روز تکراری است`);
      seenCards.add(p.key);
    }
    if (!p.button_text || !p.button_url) errs.push(`${tag}: دکمه‌ی CTA ندارد`);
    else if (!/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_]+$/.test(p.button_url))
      errs.push(`${tag}: لینک دکمه نامعتبر: ${p.button_url}`);
  });
  return errs;
}

async function tg(method, token, body, isForm = false) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    ...(isForm ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({ ok: false, description: 'پاسخ غیر JSON' }));
  if (!json.ok) throw new Error(json.description || 'خطای ناشناخته تلگرام');
  return json.result;
}

async function main() {
  const opt = args();
  if (!opt.file) fail('فلگ --file لازم است');
  const path = opt.file.startsWith('/') ? opt.file : resolve(ROOT, opt.file);
  if (!existsSync(path)) fail(`فایل روز پیدا نشد: ${opt.file}`);

  let day;
  try { day = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { fail(`JSON نامعتبر: ${e.message}`); }

  const errs = validateDay(day);
  if (errs.length) {
    console.error(`❌ اعتبارسنجیِ فایلِ روز شکست خورد (${errs.length} ایراد):`);
    for (const e of errs) console.error(`   • ${e}`);
    process.exit(1);
  }
  console.log(`✅ اعتبارسنجی: هدر + ۱۲ پست، کارت‌ها یکتا، کپشن‌ها زیر ${CAPTION_MAX}، تصاویر موجود`);

  if (opt.dryRun) {
    console.log('🔎 حالت dry-run — چیزی ارسال نشد');
    return;
  }
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) fail('TELEGRAM_TOKEN ست نیست');

  const sent = [];
  const head = await tg('sendMessage', token, {
    chat_id: day.chat, text: day.header, parse_mode: 'HTML',
    disable_web_page_preview: true, disable_notification: !!day.headerSilent,
  });
  sent.push(head.message_id);
  console.log(`✅ هدر منتشر شد: message_id=${head.message_id}`);

  for (const p of day.posts) {
    await sleep(GAP_MS);
    const form = new FormData();
    const buf = readFileSync(join(ROOT, 'bots/tarot/assets/cards', p.file));
    form.append('chat_id', day.chat);
    form.append('caption', p.caption);
    form.append('parse_mode', 'HTML');
    form.append('disable_notification', String(p.silent !== false));
    form.append('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: p.button_text, url: p.button_url }]] }));
    form.append('photo', new Blob([buf], { type: 'image/jpeg' }), p.file);
    try {
      const r = await tg('sendPhoto', token, form, true);
      sent.push(r.message_id);
      console.log(`✅ #${p.month} (${p.cardFa || p.key}) message_id=${r.message_id}`);
    } catch (e) {
      console.error(`❌ #${p.month} ارسال نشد: ${e.message}`);
      console.error(`   ${sent.length} پیام تا اینجا منتشر شده: ${sent.join(',')}`);
      process.exit(1);
    }
  }
  console.log(`\n🎉 روزِ ${day.date} کامل منتشر شد: ${sent.length} پیام (۱ هدر + ۱۲ فال)`);
  console.log(`message_ids: ${sent.join(',')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => fail(e?.stack || e?.message || String(e)));
}
