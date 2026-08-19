#!/usr/bin/env node
// کپیِ عکسِ کارت‌های همین فال به پوشه‌ی عمومیِ پروژه‌ی Remotion.
//
// چرا کپی و نه اشاره‌ی مستقیم: `publicDir` پیش‌فرضِ Remotion (`video/tarot-reel/public/`)
// دست‌نخورده می‌ماند و هرگز به `bots/tarot/assets/` اشاره نمی‌کند. دلیلش دیپلوی است، نه
// سلیقه: هر تغییری زیرِ `bots/tarot/` رباتِ زنده را ری‌استارت می‌کند، پس آن پوشه فقط
// خوانده می‌شود و هیچ ابزاری داخلش چیزی نمی‌سازد.
//
// چرا فقط چند فایل و نه کلِ پوشه: دستِ کامل ۷۹ تصویر است و رندر فقط به سه یا پنج تای
// آن‌ها به‌علاوه‌ی پشتِ کارت نیاز دارد. کپیِ کامل هر بار چند مگابایتِ بی‌مصرف است.
//
// اجرا: node tools/tarot-video/stage-assets.mjs --props <path>
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const SRC_DIR = 'bots/tarot/assets/cards';
export const DEST_DIR = 'video/tarot-reel/public/cards';
// پشتِ کارت همیشه لازم است: صحنه‌ی اینترو کارت‌ها را رو-به-پایین نشان می‌دهد و بعد
// می‌چرخاندشان، پس هیچ فالی بدونِ این فایل رندر نمی‌شود.
export const BACK_FILE = 'back.jpg';

/**
 * فایل‌هایی که این props لازم دارد. **خالص** تا بدونِ لمسِ دیسک تست شود.
 * @returns {string[]} نام فایل‌ها، بدونِ تکرار
 */
export function neededFiles(props) {
  const cards = Array.isArray(props?.cards) ? props.cards : [];
  const files = cards.map((c) => String(c?.file || `${c?.key || ''}.jpg`)).filter((f) => f && f !== '.jpg');
  return [...new Set([BACK_FILE, ...files])];
}

/**
 * کپیِ تصاویرِ لازم به پوشه‌ی عمومیِ Remotion.
 * @returns {{dest:string, copied:string[]}}
 * @throws اگر تصویری پیدا نشود. نبودِ فایل باید همین‌جا صریح بمیرد، نه وسطِ رندر که
 *         خروجی‌اش یک قابِ خالی است و کسی نمی‌فهمد چرا.
 */
export function stageCards(props, { root = REPO_ROOT } = {}) {
  const src = path.join(root, SRC_DIR);
  const dest = path.join(root, DEST_DIR);
  mkdirSync(dest, { recursive: true });

  const copied = [];
  const missing = [];
  for (const file of neededFiles(props)) {
    const from = path.join(src, file);
    if (!existsSync(from)) { missing.push(file); continue; }
    copyFileSync(from, path.join(dest, file));
    copied.push(file);
  }
  if (missing.length) throw new Error(`تصویرِ کارت پیدا نشد: ${missing.join('، ')} (در ${SRC_DIR})`);
  return { dest, copied };
}

/* ═══════════════ CLI ═══════════════ */
function main() {
  const argv = process.argv.slice(2);
  const cli = (n) => `--${n}`;
  const val = (n) => { const i = argv.indexOf(cli(n)); return i >= 0 ? argv[i + 1] : ''; };
  const p = val('props');
  if (!p) { console.error(`::error::فلگ ${cli('props')} لازم است`); process.exit(1); }

  const file = path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
  if (!existsSync(file) || !statSync(file).isFile()) {
    console.error(`::error::فایلِ props پیدا نشد: ${p}`);
    process.exit(1);
  }
  let props;
  try { props = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error(`::error::propsِ نامعتبر: ${e.message}`); process.exit(1); }

  try {
    const { dest, copied } = stageCards(props, { root: REPO_ROOT });
    console.log(`🖼 ${copied.length} تصویر کپی شد به ${path.relative(REPO_ROOT, dest)}: ${copied.join('، ')}`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
