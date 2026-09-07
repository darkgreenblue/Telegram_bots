#!/usr/bin/env node
// ساختِ فایلِ روز از «متنِ تفسیر» + متادیتای زبان.
//
// قاعده‌ی مهم (بندِ ۳ اسکیل): ساختارِ کپشن را **کد** می‌سازد نه نویسنده — هشتگ، تاریخ،
// نامِ کارت، جهت، تگِ اسپویلر، CTA و دکمه. نویسنده فقط بدنه‌ی تفسیر را می‌دهد، پس
// خطای فرمت ساختاراً ممکن نیست و در هر چهار زبان یکسان است.
//
//   node tools/marketing/build-day.mjs --locale ru --in bodies-ru.json [--offschedule]
//
// شکلِ ورودی: { "<YYYY-MM-DD>": { header: "…", cta: "…", bodies: { "1": "…", … "12": "…" } } }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signs, cardNames, dateLabel, hashtag, buttonUrl, CHANNEL, postsDir, offscheduleDir,
} from './locales.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
const LOC = arg('locale');
const IN = arg('in');
const OFF = argv.includes('--offschedule');
if (!LOC || !IN) { console.error('استفاده: build-day.mjs --locale <loc> --in <bodies.json>'); process.exit(1); }

/** خطِ اولِ توضیحی که هشتگ داخلش می‌نشیند. هشتگِ برهنه ممنوع است (استراتژی، بند ۱). */
const LEAD = {
  fa: (h) => `فال روزانه متولدین ${h}`,
  ru: (h) => `Ежедневный расклад для знака ${h}`,
  pt: (h) => `Leitura diária do tarot para ${h}`,
  es: (h) => `Lectura diaria del tarot para ${h}`,
};
const ORIENT = {
  fa: { up: 'مستقیم', down: 'معکوس' },
  ru: { up: 'в прямом положении', down: 'перевёрнутая' },
  pt: { up: 'em pé', down: 'invertida' },
  es: { up: 'al derecho', down: 'invertida' },
};
const TITLE = {
  fa: '🔮 فال تاروت روزانه ماه تولد',
  ru: '🔮 Ежедневное Таро по знаку зодиака',
  pt: '🔮 Tarot do dia por signo',
  es: '🔮 Tarot del día por signo',
};
const BUTTON = {
  fa: '🔮 ورود به ربات حرفه‌ای فال تاروت',
  ru: '🔮 Открыть профессионального бота Таро',
  pt: '🔮 Abrir o bot profissional de Tarô',
  es: '🔮 Abrir el bot profesional de Tarot',
};

const bodiesByDate = JSON.parse(readFileSync(IN, 'utf8'));
const SIGNS = await signs(LOC);
const NAMES = await cardNames(LOC);

// کارت و جهتِ هر روز از فایلِ **فارسیِ** همان روز می‌آید: انتخاب یک بار انجام شده و
// بینِ زبان‌ها مشترک است (یک دفترِ ضدتکرار، و مخاطب‌ها هم روی هم نمی‌افتند).
function picksOf(date) {
  for (const d of [postsDir('fa'), offscheduleDir('fa')]) {
    const p = join(ROOT, d, `${date}-day.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).posts;
  }
  throw new Error(`فایلِ فارسیِ روزِ ${date} پیدا نشد؛ کارت‌ها از آن‌جا می‌آیند`);
}

let made = 0;
for (const [date, spec] of Object.entries(bodiesByDate)) {
  const picks = picksOf(date);
  const label = dateLabel(LOC, date);
  const posts = picks.map((p, i) => {
    const body = String(spec.bodies[String(p.monthIndex)] ?? '').trim();
    if (!body) throw new Error(`${date} ${LOC}: تفسیرِ ماهِ ${p.monthIndex} خالی است`);
    const sign = SIGNS[i];
    const card = NAMES[p.key];
    if (!card) throw new Error(`${date} ${LOC}: نامِ کارتِ ${p.key} پیدا نشد`);
    const cap = `${LEAD[LOC](hashtag(LOC, sign))}\n🗓 ${label}\n\n`
      + `<tg-spoiler>🃏 <b>${card}</b> (${ORIENT[LOC][p.orientation]})\n\n${body}\n\n${spec.cta}</tg-spoiler>`;
    if (cap.length > 1024) throw new Error(`${date} ${LOC} ماهِ ${p.monthIndex}: کپشن ${cap.length} کاراکتر (سقف ۱۰۲۴)`);
    if (cap.includes('—') || cap.includes('--')) throw new Error(`${date} ${LOC} ماهِ ${p.monthIndex}: خط تیره‌ی ممنوع`);
    return {
      month: sign, monthIndex: p.monthIndex, key: p.key, cardFa: card,
      orientation: p.orientation, file: p.file, caption: cap,
      button_text: BUTTON[LOC], button_url: buttonUrl(LOC, date, p.monthIndex), silent: true,
    };
  });
  const doc = {
    bot: 'tarot', locale: LOC, chat: CHANNEL[LOC], date, dateLabel: label,
    pillar: 'ai_tarot_daily', topic: 'فال تاروت روزانه‌ی ماه تولد', axis: 'کارت روز هر ماه تولد',
    header: `🗓 ${label}\n\n${TITLE[LOC]}\n\n${spec.header}`,
    headerSilent: false, posts,
  };
  const dir = join(ROOT, OFF ? offscheduleDir(LOC) : postsDir(LOC));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${date}-day.json`), JSON.stringify(doc, null, 2) + '\n');
  const lens = posts.map((x) => x.caption.length);
  console.log(`✅ ${LOC} ${date} — ۱۲ پست، کپشن ${Math.min(...lens)} تا ${Math.max(...lens)}`);
  made++;
}
console.log(`\n${made} روز ساخته شد (${OFF ? 'offschedule' : 'posts'}/${LOC})`);
