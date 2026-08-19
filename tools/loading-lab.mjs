#!/usr/bin/env node
// 🧪 آزمایشگاهِ نشانگرِ انتظار — هر پنج طرح را **زنده** در تلگرامِ مالک پخش می‌کند.
//
// چرا این ابزار وجود دارد (خواسته‌ی صریحِ مالک): «این لودینگ رو اگه بتونی کارش رو در
// بیاری... جاهای دیگه نیاز دارم استفاده بشه، برای همین ارزش وقت گذاشتن و تست داره.
// مثلا ۵ مدل مختلف طراحی کن، یه دستور بساز.»
//
// نمی‌شود این را از روی کد قضاوت کرد: عرضِ اموجی، رندرِ RTL و «حس»ِ سرعت فقط روی
// کلاینتِ واقعی معلوم می‌شوند. پس هر پنج طرح با **همان ضرب‌آهنگی که ربات استفاده
// می‌کند** در چتِ واقعی پخش می‌شوند و مالک یکی را انتخاب می‌کند.
//
// اجرا (روی سرور، از طریق workflow `Ops` با action=loading-lab):
//   node tools/loading-lab.mjs <chat_id> [only]
// `only` اختیاری است: فهرستِ کاماییِ نام طرح‌ها، مثل `moon,hybrid`.
//
// ⚠️ به هیچ دیتابیسی دست نمی‌زند و هیچ رباتی را ری‌استارت نمی‌کند؛ فقط چند پیام
// می‌فرستد و ادیتشان می‌کند.

import { readFileSync } from 'fs';
import { LOADERS, pace, ACTIVE } from '../bots/tarot/loading.js';

const [, , chatArg, onlyArg] = process.argv;
const chatId = (chatArg || process.env.LAB_CHAT_ID || '').trim();
if (!chatId) { console.error('❌ chat_id لازم است: node tools/loading-lab.mjs <chat_id>'); process.exit(1); }

// توکن از .env همان ربات خوانده می‌شود (همان جایی که روی سرور هست)؛ هیچ سکرتی چاپ نمی‌شود.
function botToken() {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN;
  for (const p of ['bots/tarot/.env', '.env']) {
    try {
      const m = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').match(/^BOT_TOKEN=(.+)$/m);
      if (m) return m[1].trim();
    } catch {}
  }
  return '';
}
const TOKEN = botToken();
if (!TOKEN) { console.error('❌ BOT_TOKEN پیدا نشد'); process.exit(1); }

const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  // 429 را **گزارش** می‌کنیم نه اینکه بی‌صدا رد شویم: نکته‌ی اصلیِ همین آزمایش این است
  // که بفهمیم ضرب‌آهنگِ انتخاب‌شده به سقف می‌خورد یا نه.
  if (!j.ok) throw new Error(`${method}: ${j.error_code} ${j.description}`);
  return j.result;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const LABEL = 'در حال تفسیر کارت‌ها';
const PLAY_MS = 22_000;   // به‌قدرِ کافی بلند که هر دو فازِ ضرب‌آهنگ دیده شوند

const names = onlyArg ? onlyArg.split(',').map(s => s.trim()).filter(Boolean) : Object.keys(LOADERS);
let rateLimited = 0;

for (const name of names) {
  const def = LOADERS[name];
  if (!def) { console.log(`⏭ طرحِ ناشناخته: ${name}`); continue; }
  const tag = name === ACTIVE ? ' ← الان فعال است' : '';
  await api('sendMessage', { chat_id: chatId, text: `${def.fa}${tag}` });

  const frame = def.frames(LABEL);
  const msg = await api('sendMessage', { chat_id: chatId, text: frame(0) });
  const startedAt = Date.now();
  let i = 1, edits = 0;
  while (Date.now() - startedAt < PLAY_MS) {
    await sleep(pace(Date.now() - startedAt));
    try {
      await api('editMessageText', { chat_id: chatId, message_id: msg.message_id, text: frame(i) });
      edits++;
    } catch (e) {
      if (/429/.test(e.message)) { rateLimited++; console.log(`   ⚠️ 429 روی «${name}»: ${e.message}`); }
      else if (!/message is not modified/.test(e.message)) console.log(`   ⚠️ ${e.message}`);
    }
    i++;
  }
  console.log(`✅ ${name.padEnd(7)} ${edits} ادیت در ${PLAY_MS / 1000} ثانیه`);
  await sleep(1200);
}

console.log(rateLimited
  ? `\n⚠️ ${rateLimited} بار 429 گرفتیم — ضرب‌آهنگ باید آرام‌تر شود (FAST_MS در bots/tarot/loading.js).`
  : '\n✅ هیچ 429ای نگرفتیم؛ ضرب‌آهنگِ فعلی امن است.');
console.log(`طرحِ فعالِ ربات: ${ACTIVE}. عوض کردنش = تغییرِ همان یک کلمه در bots/tarot/loading.js`);
