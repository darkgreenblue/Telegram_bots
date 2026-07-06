// دانلود یک‌بارهٔ تصاویر public-domain دک Rider–Waite–Smith از Wikimedia Commons.
// اجرای محلی: node scripts/fetch-cards.mjs  (در deploy اجرا نمی‌شود — تصاویر کامیت شده‌اند)
// اگر فایلی بزرگ‌تر از MAX_BYTES بود و sharp نصب بود، فشرده می‌شود.
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'cards');
// ?width=600 → خود Commons نسخه‌ی thumbnail سبک (~۴۰-۸۰KB) می‌دهد؛ اصل فایل‌ها چند صد KB تا چند MB هستند
const BASE = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const THUMB_WIDTH = 600;
const MAX_BYTES = 100 * 1024;

const MAJORS = [
  'Fool', 'Magician', 'High_Priestess', 'Empress', 'Emperor', 'Hierophant',
  'Lovers', 'Chariot', 'Strength', 'Hermit', 'Wheel_of_Fortune', 'Justice',
  'Hanged_Man', 'Death', 'Temperance', 'Devil', 'Tower', 'Star', 'Moon',
  'Sun', 'Judgement', 'World',
];
const SUITS = { w: 'Wands', c: 'Cups', s: 'Swords', p: 'Pents' };

const files = [];
MAJORS.forEach((name, i) => {
  const nn = String(i).padStart(2, '0');
  files.push({ key: `m${nn}`, remote: `RWS_Tarot_${nn}_${name}.jpg` });
});
for (const [k, suit] of Object.entries(SUITS)) {
  for (let n = 1; n <= 14; n++) {
    const nn = String(n).padStart(2, '0');
    files.push({ key: `${k}${nn}`, remote: `${suit}${nn}.jpg` });
  }
}
files.push({ key: 'back', remote: 'Waite–Smith_Tarot_Roses_and_Lilies_cropped.jpg' });

async function maybeCompress(path) {
  if (statSync(path).size <= MAX_BYTES) return;
  let sharp;
  try { sharp = (await import('sharp')).default; } catch {
    console.warn(`⚠️  ${path} > 100KB و sharp نصب نیست (npm i -D sharp) — بدون فشرده‌سازی ماند`);
    return;
  }
  const buf = await sharp(path).resize(450, 810, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  writeFileSync(path, buf);
}

mkdirSync(OUT, { recursive: true });
let ok = 0, failed = [];
for (const f of files) {
  const dest = join(OUT, `${f.key}.jpg`);
  if (existsSync(dest) && statSync(dest).size > 5000) { ok++; continue; }
  try {
    let res;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(`${BASE}${encodeURIComponent(f.remote)}?width=${THUMB_WIDTH}`, {
        redirect: 'follow',
        headers: { 'User-Agent': 'TelegramTarotBot-AssetFetcher/1.0 (one-time public-domain asset download)' },
      });
      if (res.status !== 429) break;
      const wait = 3000 * (attempt + 1);
      console.log(`   ⏳ 429 برای ${f.key} — ${wait / 1000}s صبر`);
      await new Promise(r => setTimeout(r, wait));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) throw new Error(`too small (${buf.length}B)`);
    writeFileSync(dest, buf);
    await maybeCompress(dest);
    ok++;
    console.log(`✅ ${f.key}.jpg  (${Math.round(statSync(dest).size / 1024)}KB)`);
  } catch (e) {
    failed.push(f);
    console.error(`❌ ${f.key} ← ${f.remote}: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 1000)); // ملایم با سرور Commons
}
console.log(`\n${ok}/${files.length} آماده${failed.length ? ` — ناموفق: ${failed.map(x => x.key).join(', ')}` : ' 🎉'}`);
if (failed.length) process.exit(1);
