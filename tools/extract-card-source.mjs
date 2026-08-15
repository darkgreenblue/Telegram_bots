#!/usr/bin/env node
// استخراجِ **فشرده**ی دانشِ ۷۸ کارت از کراولِ labyrinthos.co → bots/tarot/card-source.en.json
//
// چرا این مرحله جداست: فایلِ خامِ کراول ۲.۶ مگابایت و شاملِ طالع‌بینی و لنورماند و رون هم
// هست که هیچ‌کدام به این ربات ربطی ندارند. آن فایل **در ریپو کامیت نمی‌شود** (نه لازم است،
// نه سالم). این اسکریپت فقط چهار تکه‌ی مفیدِ هر کارت را بیرون می‌کشد و یک فایلِ ~۵۰ کیلوبایتی
// می‌سازد که ورودیِ مرحله‌ی ترجمه است (tools/build-card-knowledge.mjs).
//
// یک‌باره اجرا می‌شود و خروجی‌اش کامیت می‌شود:
//   node tools/extract-card-source.mjs <path-to-labyrinthos_knowledge_base.json>
import { readFileSync, writeFileSync } from 'fs';
import CARDS from '../bots/tarot/cards.js';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/extract-card-source.mjs <knowledge_base.json>'); process.exit(1); }

const kb = JSON.parse(readFileSync(src, 'utf8'));
const docs = kb.documents.filter(d => d.section === 'tarot_card_meanings');

// نامِ انگلیسیِ کارت → slug. «the-» در منبع گاهی هست و گاهی نیست، پس هر دو شکل امتحان می‌شود.
const bySlug = new Map();
for (const d of docs) bySlug.set(d.slug.replace(/-meaning(-major-arcana)?-tarot-card-meanings$/, ''), d);
const slugOf = (en) => {
  const base = String(en).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [base, base.replace(/^the-/, ''), `the-${base}`].find(k => bySlug.has(k)) || null;
};

// یک پاراگرافِ تمیز از یک بخشِ markdown (جدول‌ها و لینک‌ها و نقلِ‌قول‌ها کنار می‌روند)
function sectionText(md, heading, maxChars) {
  const re = new RegExp(`^#{2,3}\\s*${heading}\\s*$`, 'im');
  const m = re.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const end = rest.search(/^#{2,3}\s/m);
  const body = (end === -1 ? rest : rest.slice(0, end));
  const clean = body
    .split('\n')
    .filter(l => !/^\s*\|/.test(l) && !/^\s*>/.test(l))          // جدول و نقل‌قول
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                      // لینکِ markdown → متن
    .replace(/[*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, maxChars);
}

// ردیفِ جدولِ «Love | Career | Finances» (مستقیم یا معکوس)
function domains(md, upright) {
  const label = upright ? 'Upright' : 'Reversed';
  const re = new RegExp(`\\*\\*${label} Love Meaning\\*\\*[^|]*\\|[^|]*\\|[^|]*\\|\\s*\\n\\|([^\\n]*)\\|`, 'i');
  const m = re.exec(md);
  if (!m) return {};
  const cells = m[1].split('|').map(c => c.replace(/[*]/g, '').trim()).filter(Boolean);
  return { love: cells[0] || '', career: cells[1] || '', money: cells[2] || '' };
}

const out = {};
const missing = [];
for (const c of CARDS) {
  const slug = slugOf(c.en);
  if (!slug) { missing.push(c.en); continue; }
  const md = bySlug.get(slug).content_markdown;
  const up = domains(md, true);
  const dn = domains(md, false);
  out[c.key] = {
    en: c.en,
    fa: c.fa,
    // ⭐ مهم‌ترین تکه: توصیفِ **تصویریِ** کارت. این دقیقاً چیزی است که cards.js ندارد و
    // نبودش باعث می‌شود مدل نمادِ کارت را از خودش بسازد.
    image: sectionText(md, `.*${c.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Tarot Card Description`, 700)
        || sectionText(md, '.*Tarot Card Description', 700),
    // ⚠️ عنوانِ بخشِ معکوس در منبع دو شکل دارد: «Reversed X Meaning» و «X Reversal Meaning».
    // شکلِ دوم فقط برای خالِ شمشیر به کار رفته و اگر جا بیفتد، **هر ۱۴ کارتِ شمشیر بی‌معنیِ
    // معکوس می‌مانند** (اولین اجرا دقیقاً همین را نشان داد).
    upright: sectionText(md, `Upright .* Meaning`, 700),
    reversed: sectionText(md, `Reversed .* Meaning`, 700) || sectionText(md, `.* Reversal Meaning`, 700),
    upLove: up.love, upCareer: up.career, upMoney: up.money,
    revLove: dn.love, revCareer: dn.career, revMoney: dn.money,
  };
}

if (missing.length) { console.error('❌ کارت‌های پیدانشده:', missing.join(', ')); process.exit(1); }
const dest = new URL('../bots/tarot/card-source.en.json', import.meta.url);
writeFileSync(dest, JSON.stringify(out, null, 1));
const bytes = JSON.stringify(out).length;
console.log(`✅ ${Object.keys(out).length} کارت استخراج شد (${Math.round(bytes / 1024)} KB)`);
const empty = Object.entries(out).filter(([, v]) => !v.image || !v.upright || !v.reversed);
if (empty.length) console.warn('⚠️ ناقص:', empty.map(([k]) => k).join(', '));
