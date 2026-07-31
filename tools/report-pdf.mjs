#!/usr/bin/env node
// گزارشِ Markdown فارسی → PDF راست‌به‌چپ.
//
// چرا وجود دارد: گزارش‌های تحلیلِ جرنی (اسکیل `product-journey-analysis`) قرار است با
// شریک/تیم به اشتراک گذاشته شوند، پس باید یک فایلِ قابلِ فرستادن باشند نه متنِ چت.
// عمداً بدونِ هیچ dependency ای نوشته شده (نه npm، نه puppeteer): یک مبدلِ کوچکِ
// Markdown→HTML + رندر با همان کرومیومی که در محیط هست.
//
// استفاده:  node tools/report-pdf.mjs <file.md> [خروجی.pdf]

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  // هر نسخه‌ی دیگری از کرومیومِ playwright
  try {
    const out = execFileSync('bash', ['-lc',
      'ls -d /opt/pw-browsers/chromium*/chrome-linux/{chrome,headless_shell} 2>/dev/null | head -1'],
      { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch {}
  return null;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// اینلاین: **بولد**، `کد`، [متن](لینک)
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

// مبدلِ کوچکِ Markdown: عنوان، جدول، لیست، نقل‌قول، خطِ افقی، پاراگراف
function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const flushPara = (buf) => { if (buf.length) { out.push(`<p>${inline(buf.join(' '))}</p>`); buf.length = 0; } };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { flushPara(para); i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(para); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) { flushPara(para); out.push('<hr>'); i++; continue; }

    // جدول: خطِ دوم باید جداکننده باشد
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      flushPara(para);
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushPara(para);
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara(para);
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) {
          // ادامه‌ی همان آیتم (خطِ تورفته)
          if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        items.push(m[3]);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    if (/^```/.test(line)) {
      flushPara(para);
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara(para);
  return out.join('\n');
}

const CSS = `
@page { size: A4; margin: 18mm 15mm 16mm 15mm; }
* { box-sizing: border-box; }
body {
  font-family: 'Vazirmatn', 'Noto Naskh Arabic', 'DejaVu Sans', sans-serif;
  direction: rtl; text-align: right; color: #1b1b1f; line-height: 1.9;
  font-size: 10.5pt; margin: 0;
}
h1 { font-size: 19pt; margin: 0 0 4pt; color: #4b2c7f; line-height: 1.5; }
h2 { font-size: 14pt; margin: 20pt 0 6pt; color: #4b2c7f;
     border-bottom: 1.5pt solid #e5ddf3; padding-bottom: 4pt; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 13pt 0 4pt; color: #2c2c34; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 10pt 0 3pt; color: #55555f; page-break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-right: 18pt; padding-left: 0; }
li { margin-bottom: 3pt; }
blockquote {
  margin: 8pt 0; padding: 7pt 11pt; background: #f6f3fc;
  border-right: 3pt solid #8b6fc4; border-radius: 3pt; color: #3a3a44;
}
table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; font-size: 9.5pt;
        page-break-inside: avoid; }
th, td { border: 0.6pt solid #d9d4e4; padding: 4.5pt 7pt; text-align: right; }
th { background: #4b2c7f; color: #fff; font-weight: 600; }
tbody tr:nth-child(even) { background: #faf8fd; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 9pt;
       background: #f1eef7; padding: 1pt 4pt; border-radius: 3pt; direction: ltr;
       display: inline-block; }
pre { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; background: #f6f3fc;
      padding: 8pt 10pt; border-radius: 4pt; direction: ltr; text-align: left;
      overflow-wrap: break-word; white-space: pre-wrap; page-break-inside: avoid; }
hr { border: 0; border-top: 0.6pt solid #ddd8e8; margin: 14pt 0; }
strong { color: #35204f; }
a { color: #4b2c7f; }
.meta { color: #6c6c78; font-size: 9pt; margin-bottom: 14pt; }
`;

const src = process.argv[2];
if (!src) { console.error('استفاده: node tools/report-pdf.mjs <file.md> [out.pdf]'); process.exit(1); }
const md = readFileSync(src, 'utf8');
const outPdf = process.argv[3] || src.replace(/\.md$/, '') + '.pdf';

// عنوان = اولین h1
const title = (md.match(/^#\s+(.*)$/m) || [, basename(src)])[1].trim();

const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
${mdToHtml(md)}
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'rpt-'));
const htmlPath = join(dir, 'r.html');
writeFileSync(htmlPath, html);

const chrome = findChrome();
if (!chrome) {
  writeFileSync(outPdf.replace(/\.pdf$/, '.html'), html);
  console.error('❌ کرومیوم پیدا نشد — به‌جای PDF فایل HTML ساخته شد.');
  process.exit(1);
}

execFileSync(chrome, [
  '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  `--print-to-pdf=${outPdf}`, `file://${htmlPath}`,
], { stdio: 'pipe' });

rmSync(dir, { recursive: true, force: true });
console.log(`✅ ${outPdf}`);
