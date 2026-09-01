#!/usr/bin/env node
// همپوشانیِ «ممبرِ کانال» و «کاربرِ ربات».
//
// چرا این شکلی و نه لیست‌کردنِ ممبرها: **Bot API هیچ متدی برای لیست‌کردنِ ممبرهای
// کانال ندارد** (نه getChatMembers، نه معادلش؛ getChatAdministrators فقط ادمین‌هاست).
// فقط دو چیز در دسترس است: شمارشِ کلِ ممبرها، و وضعیتِ **یک کاربرِ مشخص**.
// پس تنها راهِ ممکن این است: از سمتِ ربات به کانال نگاه کنیم، نه برعکس.
//
//   getChatMemberCount(کانال)                      → کلِ ممبرها            (A)
//   getChatMember(کانال, هر کاربرِ ربات)            → چند کاربرِ ربات عضوند (B)
//   A - B                                          → ممبرهایی که هرگز وارد ربات نشده‌اند
//
// یعنی **تعدادشان** قابل‌محاسبه است ولی **هویتشان** نه؛ این محدودیتِ خودِ تلگرام است
// نه انتخابِ ما. برای رسیدن به هویت باید MTProto با اکانتِ کاربری زد که عمداً
// انتخاب نشده (بندِ ۲ه‍ی CLAUDE.md).
//
//   node tools/marketing/channel-overlap.mjs <dataDir> <@channel>
// توکن از env: TELEGRAM_TOKEN

import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dataDir, channel] = process.argv.slice(2);
const token = process.env.TELEGRAM_TOKEN;
if (!dataDir || !channel) { console.error('استفاده: channel-overlap.mjs <dataDir> <@channel>'); process.exit(1); }
if (!token) { console.error('TELEGRAM_TOKEN ست نیست'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json().catch(() => ({ ok: false, description: 'پاسخ غیر JSON' }));
    if (json.ok) return json.result;
    // 429: تلگرام خودش می‌گوید چقدر صبر کنیم
    if (json.error_code === 429 && json.parameters?.retry_after) {
      await sleep((json.parameters.retry_after + 1) * 1000);
      continue;
    }
    return { __err: json.description || 'خطای ناشناخته' };
  }
  return { __err: 'بعد از چند تلاش هم نشد' };
}

const dbFile = readdirSync(dataDir).find((f) => /^bot.*\.db$/.test(f));
if (!dbFile) { console.error(`هیچ .db در ${dataDir} نیست`); process.exit(1); }
const db = new Database(join(dataDir, dbFile), { readonly: true, fileMustExist: true });

const users = db.prepare('SELECT telegram_id FROM users').all().map((r) => r.telegram_id);
const total = await tg('getChatMemberCount', { chat_id: channel });
if (total?.__err) { console.error(`getChatMemberCount شکست خورد: ${total.__err}`); process.exit(1); }

console.log(`کانال: ${channel}`);
console.log(`کلِ ممبرهای کانال (A): ${total}`);
console.log(`کلِ کاربرانِ ربات: ${users.length}`);
console.log('در حال بررسیِ عضویتِ تک‌تکِ کاربرانِ ربات...\n');

const OK = new Set(['member', 'administrator', 'creator']);
const tally = {};
let inChannel = 0, errors = 0;
for (let i = 0; i < users.length; i++) {
  const m = await tg('getChatMember', { chat_id: channel, user_id: users[i] });
  if (m?.__err) { errors++; tally['error'] = (tally['error'] || 0) + 1; }
  else {
    tally[m.status] = (tally[m.status] || 0) + 1;
    if (OK.has(m.status)) inChannel++;
  }
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${users.length} بررسی شد...`);
  await sleep(120); // زیرِ سقفِ نرخِ تلگرام
}

const botUsersNotInChannel = users.length - inChannel - errors;
const channelOnly = total - inChannel;

console.log('\n================ نتیجه ================');
console.log(`A) کلِ ممبرهای کانال:                       ${total}`);
console.log(`B) کاربرانِ ربات که الان عضوِ کانال‌اند:      ${inChannel}`);
console.log(`   کاربرانِ ربات که عضوِ کانال نیستند:       ${botUsersNotInChannel}`);
if (errors) console.log(`   خطا در بررسی:                            ${errors}`);
console.log('---------------------------------------');
console.log(`A-B) ممبرهایی که هرگز وارد ربات نشده‌اند:   ${channelOnly}`);
console.log('---------------------------------------');
console.log('تفکیکِ وضعیتِ کاربرانِ ربات نسبت به کانال:');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(14)} ${v}`);
console.log('=======================================');
if (channelOnly < 0) {
  console.log('⚠️ عددِ منفی یعنی بینِ شمارشِ کل و بررسیِ تک‌تک، ممبرها عوض شده‌اند');
}
