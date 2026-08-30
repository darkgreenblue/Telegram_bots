#!/usr/bin/env node
// دفترِ تیکت‌های پشتیبانی — افزودن/جستجو/نمایش روی support/tickets.jsonl
// قرارداد و دلیلِ فایل‌بودن: support/README.md
//
// استفاده:
//   node tools/support-log.mjs add '<json>'     یک تیکت (JSON) اضافه می‌کند و id می‌سازد
//   node tools/support-log.mjs add --file x.json
//   node tools/support-log.mjs user <uid>       سابقه‌ی کاملِ یک کاربر
//   node tools/support-log.mjs show <id>        یک تیکت
//   node tools/support-log.mjs list [n]         n تیکتِ آخر (پیش‌فرض ۲۰)
//   node tools/support-log.mjs stats            آمارِ دسته/نتیجه
//   node tools/support-log.mjs sqlite [out.db]  خروجی SQLite برای کوئریِ دلخواه
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'support', 'tickets.jsonl');
export const SUPPORT_LOG_SCHEMA_VERSION = 1;

const CATEGORIES = ['payment', 'credit', 'reading', 'bug', 'question', 'feature', 'other'];
const VERDICTS = ['confirmed_bug', 'partial', 'user_error', 'no_issue', 'info', 'pending'];
const STATUSES = ['answered', 'awaiting_user', 'in_progress', 'closed'];

export function load() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try { return JSON.parse(l); } catch { throw new Error(`خطِ ${i + 1} در tickets.jsonl معتبر نیست`); }
    });
}

// تاریخِ تهران بدونِ وابستگی: Intl با timeZone (پایه‌ی همه‌ی تجمیع‌های ریپو)
const tehran = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tehranTime = (ts) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(ts * 1000)).replace(',', '');

export function nextId(all, day = tehran()) {
  const key = `T-${day.replace(/-/g, '')}`;
  const n = all.filter((t) => String(t.id).startsWith(key)).length + 1;
  return `${key}-${String(n).padStart(2, '0')}`;
}

export function addTicket(input) {
  const all = load();
  const now = Math.floor(Date.now() / 1000);
  const t = {
    id: input.id || nextId(all),
    schema: SUPPORT_LOG_SCHEMA_VERSION,
    ts: input.ts || now,
    date: tehranTime(input.ts || now),
    bot: input.bot || '',
    support_code: input.support_code || '',
    user_id: input.user_id ?? null,
    user_message: input.user_message || '',
    category: input.category || 'other',
    verdict: input.verdict || 'pending',
    findings: input.findings || '',
    actions: input.actions || [],
    reply: input.reply || '',
    bug_ref: input.bug_ref || '',
    status: input.status || 'answered',
    notes: input.notes || '',
  };
  if (!CATEGORIES.includes(t.category)) throw new Error(`category نامعتبر: ${t.category} (${CATEGORIES.join('|')})`);
  if (!VERDICTS.includes(t.verdict)) throw new Error(`verdict نامعتبر: ${t.verdict} (${VERDICTS.join('|')})`);
  if (!STATUSES.includes(t.status)) throw new Error(`status نامعتبر: ${t.status} (${STATUSES.join('|')})`);
  if (t.verdict === 'confirmed_bug' && !t.bug_ref) throw new Error('باگِ تأییدشده بدونِ bug_ref ثبت نمی‌شود (قاعده‌ی ۳ در support/README.md)');
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify(t) + '\n', 'utf8');
  return t;
}

const short = (s, n = 90) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
const line = (t) => `${t.id}  ${t.date}  ${t.bot || '-'}  uid=${t.user_id ?? '-'}  [${t.category}/${t.verdict}/${t.status}]  ${short(t.user_message)}`;

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const all = load();
  if (cmd === 'add') {
    const raw = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args[0] || readFileSync(0, 'utf8');
    const t = addTicket(JSON.parse(raw));
    console.log('✅ ثبت شد: ' + t.id);
    return;
  }
  if (cmd === 'user') {
    const uid = Number(args[0]);
    const mine = all.filter((t) => Number(t.user_id) === uid);
    if (!mine.length) return console.log(`(هیچ تیکتِ قبلی برای ${uid} نیست)`);
    for (const t of mine) {
      console.log('─'.repeat(70));
      console.log(line(t));
      if (t.findings) console.log('  یافته: ' + t.findings);
      if (t.actions?.length) console.log('  اقدام: ' + t.actions.join(' | '));
      if (t.bug_ref) console.log('  باگ: ' + t.bug_ref);
    }
    return;
  }
  if (cmd === 'show') {
    const t = all.find((x) => x.id === args[0]);
    return console.log(t ? JSON.stringify(t, null, 1) : '(پیدا نشد)');
  }
  if (cmd === 'stats') {
    const by = (k) => all.reduce((a, t) => ((a[t[k]] = (a[t[k]] || 0) + 1), a), {});
    console.log('تعداد کل: ' + all.length);
    console.log('دسته: ' + JSON.stringify(by('category')));
    console.log('نتیجه: ' + JSON.stringify(by('verdict')));
    console.log('وضعیت: ' + JSON.stringify(by('status')));
    console.log('ربات: ' + JSON.stringify(by('bot')));
    return;
  }
  if (cmd === 'sqlite') {
    const out = args[0] || join(ROOT, 'support', 'tickets.db');
    const sql = [
      'CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, ts INTEGER, date TEXT, bot TEXT, support_code TEXT,',
      'user_id INTEGER, user_message TEXT, category TEXT, verdict TEXT, findings TEXT, actions TEXT, reply TEXT,',
      'bug_ref TEXT, status TEXT, notes TEXT);',
      ...all.map((t) => {
        const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
        return `INSERT OR REPLACE INTO tickets VALUES (${q(t.id)},${t.ts || 0},${q(t.date)},${q(t.bot)},${q(t.support_code)},${Number(t.user_id) || 'NULL'},${q(t.user_message)},${q(t.category)},${q(t.verdict)},${q(t.findings)},${q((t.actions || []).join(' | '))},${q(t.reply)},${q(t.bug_ref)},${q(t.status)},${q(t.notes)});`;
      }),
    ].join('\n');
    writeFileSync(out + '.sql', sql, 'utf8');
    console.log(`✅ ${all.length} تیکت → ${out}.sql  (اجرا: sqlite3 ${out} < ${out}.sql)`);
    return;
  }
  const n = Number(args[0]) || 20;
  if (!all.length) return console.log('(دفتر خالی است)');
  for (const t of all.slice(-n)) console.log(line(t));
  console.log(`--- ${Math.min(n, all.length)} از ${all.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('support-log.mjs')) main();
