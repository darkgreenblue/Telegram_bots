// چک قرارداد پشتیبانی: حسابِ پشتیبانی و فرمتِ کدِ پیگیری باید در هر سه نسخه یکی بماند.
// shared/support.js تک‌منبعِ حقیقت است؛ voice2text کپیِ خودکفا دارد (قانونِ ربات زنده: از shared
// ایمپورت نمی‌کند) و tabir-khab پورتِ پایتونی. این چک drift را از «کاربر به آی‌دیِ اشتباه پیام
// می‌دهد» به «خطای قرمز CI» تبدیل می‌کند. اجرا: node tools/check-support-sync.mjs (از ریشه‌ی ریپو)
import { readFileSync } from 'fs';

const shared = readFileSync('shared/support.js', 'utf8');
const v2t = readFileSync('bots/voice2text/index.js', 'utf8');
const py = readFileSync('bots/tabir-khab/support.py', 'utf8');

let fail = false;
const bad = (m) => { console.error(`❌ ${m}`); fail = true; };

// ۱) یوزرنیمِ حسابِ پشتیبانی در هر سه یکی باشد
const uShared = shared.match(/username:\s*'([^']+)'/)?.[1];
const uV2t = v2t.match(/SUPPORT_USERNAME\s*=\s*'([^']+)'/)?.[1];
const uPy = py.match(/SUPPORT_USERNAME\s*=\s*"([^"]+)"/)?.[1];
if (!uShared || uShared !== uV2t || uShared !== uPy) {
  bad(`یوزرنیمِ پشتیبانی ناهماهنگ: shared=${uShared} voice2text=${uV2t} tabir=${uPy}`);
}

// ۲) هیچ‌جای دیگری (جز کامنت/چنج‌لاگ) آی‌دیِ پشتیبانی hardcode نشده باشد — تک‌منبع بودن
const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');
for (const name of ['bots/tarot/index.js', 'bots/tarot/locales/fa.js']) {
  if (uShared && codeOnly(readFileSync(name, 'utf8')).includes(`@${uShared}`)) {
    bad(`${name}: آی‌دیِ پشتیبانی hardcode شده؛ از shared/support.js بخوان (SUPPORT_CONTACT)`);
  }
}

// ۳) کدِ پیگیری per-bot یکتا و طبق قرارداد #<BOT>-<user_id> باشد
const codes = [...shared.matchAll(/^\s*'?[\w-]+'?:\s*'([A-Z0-9]{2,6})',/gm)].map((m) => m[1]);
if (new Set(codes).size !== codes.length) bad(`کدهای ربات‌ها در BOT_CODES تکراری‌اند: ${codes.join(',')}`);
const v2tCode = v2t.match(/SUPPORT_BOT_CODE\s*=\s*'([A-Z0-9]+)'/)?.[1];
const pyCode = py.match(/SUPPORT_BOT_CODE\s*=\s*"([A-Z0-9]+)"/)?.[1];
if (!shared.includes(`voice2text: '${v2tCode}'`)) bad(`کدِ voice2text (${v2tCode}) در BOT_CODES نیست`);
if (!shared.includes(`'tabir-khab': '${pyCode}'`)) bad(`کدِ tabir-khab (${pyCode}) در BOT_CODES نیست`);

// ۴) قطعه‌های قراردادی (فرمتِ کد، لینکِ ?text=، خطِ اولِ ASCII بودنِ کد)
const MUST = [
  { src: shared, name: 'shared/support.js', pieces: ['`#${String(botCode).toUpperCase()}-${uid}`', 'https://t.me/${SUPPORT.username}', '?text=${encodeURIComponent'] },
  { src: v2t, name: 'bots/voice2text/index.js', pieces: ['`#${SUPPORT_BOT_CODE}-${uid}`', 'https://t.me/${SUPPORT_USERNAME}?text=${encodeURIComponent'] },
  { src: py, name: 'bots/tabir-khab/support.py', pieces: ['f"#{SUPPORT_BOT_CODE}-{uid}"', 'f"https://t.me/{SUPPORT_USERNAME}"', '?text={quote('] },
];
for (const { src, name, pieces } of MUST) {
  for (const p of pieces) if (!src.includes(p)) bad(`${name} فاقد قطعه‌ی قرارداد: ${p}`);
}

// ۵) نسخه‌ی قرارداد در shared و پورت پایتونی یکی باشد
const vShared = shared.match(/SUPPORT_CONTRACT_VERSION = (\d+)/)?.[1];
const vPy = py.match(/SUPPORT_CONTRACT_VERSION = (\d+)/)?.[1];
if (!vShared || vShared !== vPy) bad(`SUPPORT_CONTRACT_VERSION ناهماهنگ: shared=${vShared} tabir=${vPy}`);

if (fail) process.exit(1);
console.log(`✅ قرارداد پشتیبانی سینک است (حساب: @${uShared}، نسخه‌ی قرارداد: ${vShared})`);
