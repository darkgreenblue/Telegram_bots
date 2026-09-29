#!/usr/bin/env node
// 📏 سنجه‌های کیفیتِ «گفتگو با تاروت‌خوان» روی **دیتای واقعی** (نه آزمایشگاه).
//
// تعریفِ سنجه‌ها، روشِ تکرار و خطِ پایه: analytics/tarot/chat-quality/README.md
// این فایل فقط بخشِ **قطعی** را حساب می‌کند؛ داوریِ پنج معیارِ کیفیت کارِ سشن است
// (همان تصمیمِ ثبت‌شده در tools/reading-lab/chat-rubric.mjs: داور مدلِ سوم نیست) و
// نتیجه‌اش به‌صورتِ یک فایلِ JSON از «شناسه‌ی پیام ← ۰/۱» به این ابزار داده می‌شود.
//
// ⚠️ متنِ کاربر فقط در scratchpad می‌ماند. ورودی‌ها (chats.json، transcript) هرگز
// کامیت نمی‌شوند؛ فقط فایلِ داوری (شناسه + ۰/۱، بدونِ متن) و اعدادِ تجمیعی.
//
// استفاده:
//   node tools/chat-quality.mjs sql                          ← کوئریِ Ops (db-query-sealed)
//   node tools/chat-quality.mjs transcript <chats.json> <out.txt> [--after <msgId>]
//   node tools/chat-quality.mjs score <chats.json> [--judged <file.json>] [--after <msgId>]
import fs from 'node:fs';
import CARDS from '../bots/tarot/cards.js';

export const SQL = "WITH c AS MATERIALIZED (SELECT user_id, MIN(created_at) t FROM ab_exposures WHERE experiment_key LIKE 'chat_rollout_%' AND variant='chat' GROUP BY user_id), m AS MATERIALIZED (SELECT * FROM chat_messages WHERE user_id IN (SELECT user_id FROM c)) SELECT 'msg' kind, m.id id, m.reading_id rid, m.user_id uid, m.role role, m.text text, m.price price, m.refunded refunded, m.model model, m.created_at ts, m.follow_up fu, m.follow_up_used fu_used, m.want_reading wr, m.want_support ws, m.want_end we, '' q, '' cards, '' llm FROM m UNION ALL SELECT 'reading', r.id, r.id, r.user_id, r.type, '', r.price, 0, '', r.created_at, '', 0, 0, 0, 0, r.question, r.cards_json, r.llm_json FROM readings r WHERE r.id IN (SELECT reading_id FROM m) UNION ALL SELECT 'ev', ev.id, 0, ev.user_id, ev.event, ev.props, 0, 0, '', ev.created_at, '', 0, 0, 0, 0, '', '', '' FROM events ev WHERE ev.event>='chat_' AND ev.event<'chat`' AND ev.user_id IN (SELECT user_id FROM c)";

// پنج معیارِ داوری (تعریفِ کامل و مثال‌ها در README). ترتیب = ترتیبِ گزارش.
export const JUDGED = ['answer', 'new', 'safe', 'offer', 'button'];

// اعراب (کسره‌ی اضافه، همزه‌ی «ۀ») و نیم‌فاصله حذف می‌شوند: «چوب‌دستِ» و «سکهٔ» همان کارت‌اند.
const nz = (s) => String(s || '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه')
  .replace(/[ً-ٰٟ‌]/g, '').replace(/چوب ?دست/g, 'چوبدست').replace(/\s+/g, ' ');

/* 🃏 نامِ کارت‌هایی که در متن آمده‌اند. آرکانای بزرگی که نامشان کلمه‌ی روزمره است
 * (ماه، قدرت، جهان، …) عمداً بیرون‌اند: «چند ماه» کارتِ ماه نیست، و سنجه‌ای که مدام
 * قرمزِ کاذب بدهد بی‌فایده است (بند ۶ب-۲ ریشه). یعنی این سنجه **کم‌شمار** است، نه پرشمار. */
const AMBIGUOUS = new Set(['m00', 'm06', 'm08', 'm11', 'm13', 'm14', 'm17', 'm18', 'm19', 'm21']);
const NAME_RE = CARDS.filter((c) => !AMBIGUOUS.has(c.key)).map((c) => {
  const [head, ...rest] = nz(c.fa).split(' ');
  // «ملکه جام»، «ملکه‌ی جام»، «ملکهٔ جام»، «سکهٔ»، «سکه‌ی» همه یک کارت‌اند.
  const src = [head, ...rest].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('ی?\\s*');
  return { key: c.key, re: new RegExp(`(^|[^آ-ی])${src}ی?(?![آ-ی])`) };
});
export function cardsNamed(text) {
  const t = nz(text);
  return NAME_RE.filter((c) => c.re.test(t)).map((c) => c.key);
}

export function load(file, { after = 0 } = {}) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.rows;
  const readings = new Map(rows.filter((r) => r.kind === 'reading').map((r) => [r.id, r]));
  const events = rows.filter((r) => r.kind === 'ev');
  const byR = new Map();
  for (const m of rows.filter((r) => r.kind === 'msg').sort((a, b) => a.id - b.id)) {
    if (!byR.has(m.rid)) byR.set(m.rid, []);
    byR.get(m.rid).push(m);
  }
  // یک گفتگو فقط وقتی در این دور است که **اولین** پیامش بعد از `after` باشد، تا یک
  // گفتگوی نیمه‌داوری‌شده بینِ دو دور تقسیم نشود.
  const convs = [...byR.entries()].filter(([, ms]) => ms[0].id > after).map(([rid, ms]) => {
    const r = readings.get(rid) || {};
    let spread = [];
    try { spread = (JSON.parse(r.cards || '[]') || []).map((c) => c.key); } catch {}
    return { rid, uid: ms[0].uid, type: r.role, question: r.q || '', spread, llm: r.llm || '', msgs: ms };
  });
  return { convs, events };
}

export function transcript(convs) {
  let out = '';
  convs.forEach((c, i) => {
    let head = '';
    try { head = JSON.parse(c.llm || '{}').headline || ''; } catch {}
    out += `\n######## C${i + 1} rid${c.rid} ${c.type} | Q: ${c.question.replace(/\n/g, ' ')}\nCARDS: ${c.spread.join(' ')} | HEAD: ${head}\n`;
    for (const m of c.msgs) {
      const t = String(m.text || '').replace(/\n/g, ' ⏎ ');
      if (m.role === 'user') out += `[U${m.id}${m.price ? ' paid' : ' free'}] ${t}\n`;
      else if (m.role === 'pending') out += `[PENDING${m.id} پی‌وال، بی‌جواب] ${t}\n`;
      else out += `[A${m.id}${m.wr ? ' NEWREADING' : ''}${m.ws ? ' SUPPORT' : ''}${m.we ? ' END' : ''} fu=«${m.fu}»] ${t}\n`;
    }
  });
  return out;
}

// فاصله‌ی اطمینانِ ویلسون ۹۵٪، تا تفاوتِ دو دور با نویز اشتباه گرفته نشود.
export function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const LEAK = /[{}]|"(answer|offer|follow_up|wants_\w+|needs_support)"|\b(answer|follow_up|offer)\s*:/;
const LATIN = /[A-Za-z]{3,}/;

export function score({ convs, events }, judged = null) {
  const answers = convs.flatMap((c) => c.msgs.filter((m) => m.role === 'assistant').map((m) => ({ ...m, conv: c })));
  const rids = new Set(convs.map((c) => c.rid));
  const ev = events.filter((e) => {
    try { return rids.has(Number(JSON.parse(e.text || '{}').reading_id)); } catch { return false; }
  });
  const count = (name) => ev.filter((e) => e.role === name).length;

  // ۱) سلامتِ فنی: شکستِ مدل، ریفاند، نشتِ قالب (JSON/انگلیسی)، جوابِ خالی.
  const broken = answers.filter((a) => LEAK.test(a.text) || LATIN.test(a.text) || String(a.text).trim().length < 20);
  const failures = count('chat_llm_failed') + count('chat_refund');
  // ۲) کارتِ بیرونِ همین فال (توهم). فقط کارت‌های بدونِ ابهامِ نام سنجیده می‌شوند.
  const invented = answers.filter((a) => cardsNamed(a.text).some((k) => !a.conv.spread.includes(k)));

  // رفتارِ کاربر، per گفتگو. «سؤالِ بعدی» = پیامِ کاربر بعد از اولین جواب، چه جواب
  // گرفته باشد چه پشتِ پی‌وال مانده باشد (هر دو یعنی کاربر ادامه خواست).
  let cont = 0, next = 0, viaBtn = 0, paid = 0, pending = 0;
  for (const c of convs) {
    const asks = c.msgs.filter((m) => m.role === 'user' || m.role === 'pending');
    if (asks.length >= 2) cont++;
    for (let i = 1; i < c.msgs.length; i++) {
      const m = c.msgs[i];
      if (m.role !== 'user' && m.role !== 'pending') continue;
      next++;
      const prev = [...c.msgs.slice(0, i)].reverse().find((x) => x.role === 'assistant');
      if (prev?.fu && nz(prev.fu).trim() === nz(m.text).trim()) viaBtn++;
      if (m.role === 'pending') pending++; else if (m.price > 0) paid++;
    }
  }

  const pct = (k, n) => ({ k, n, p: n ? k / n : 0, ci: wilson(k, n) });
  const out = {
    scope: { conversations: convs.length, answers: answers.length,
      minMsgId: Math.min(...convs.map((c) => c.msgs[0].id)), maxMsgId: Math.max(...convs.flatMap((c) => c.msgs.map((m) => m.id))) },
    health: {
      // مخرج = هر تلاشِ جواب (جوابِ رسیده + شکستی که به جواب نرسید)، صورت = جوابِ سالم.
      tech_ok: pct(answers.length - broken.length, answers.length + failures),
      cards_ok: pct(answers.length - invented.length, answers.length),
    },
    behavior: {
      continue: pct(cont, convs.length),
      via_button: pct(viaBtn, next),
      paywall_stop: pct(pending, pending + paid),
    },
    flagged: { broken: broken.map((a) => a.id), invented: invented.map((a) => [a.id, cardsNamed(a.text).filter((k) => !a.conv.spread.includes(k))]) },
  };

  if (judged) {
    const ids = answers.map((a) => String(a.id));
    const missing = ids.filter((id) => !judged[id]);
    out.quality = {};
    for (const k of JUDGED) out.quality[k] = pct(ids.filter((id) => judged[id]?.[k] === 1).length, ids.length - missing.length);
    const js = JUDGED.map((k) => out.quality[k].p);
    out.quality_score = js.reduce((s, x) => s + x, 0) / js.length;
    const push = new Set((judged._pushback || []).map(String));
    const pushConvs = convs.filter((c) => c.msgs.some((m) => push.has(String(m.id)))).length;
    out.behavior.pushback = pct(pushConvs, convs.length);
    out.flagged.unjudged = missing;
  }
  return out;
}

function fmt(r) {
  const row = (label, x, good = 'high') => `${label.padEnd(28)} ${(100 * x.p).toFixed(1).padStart(5)}%  (${x.k}/${x.n}, CI95 ${(100 * x.ci[0]).toFixed(0)}–${(100 * x.ci[1]).toFixed(0)}%)${good === 'low' ? '  ↓ کمتر بهتر' : ''}`;
  const L = [`دامنه: ${r.scope.conversations} گفتگو، ${r.scope.answers} جواب (پیام‌های ${r.scope.minMsgId}..${r.scope.maxMsgId})`, ''];
  L.push('— سلامت فنی (خودکار) —', row('بدونِ خطای فنی', r.health.tech_ok), row('بدونِ کارتِ بیرونِ فال', r.health.cards_ok));
  if (r.quality) {
    L.push('', '— کیفیتِ جواب (داوری) —');
    const T = { answer: 'جوابِ همان سؤال', new: 'چیزِ تازه', safe: 'ایمن و صادق', offer: 'پیشنهادِ ارزشمند', button: 'دکمه = پیشنهاد' };
    for (const k of JUDGED) L.push(row(T[k], r.quality[k]));
    L.push(`${'نمره‌ی کیفیت (میانگینِ پنج)'.padEnd(28)} ${(100 * r.quality_score).toFixed(1).padStart(5)}%`);
  }
  L.push('', '— رفتارِ کاربر (خودکار) —', row('ادامه (سؤالِ دوم)', r.behavior.continue), row('سؤالِ بعدی از دکمه', r.behavior.via_button),
    row('ماندن پشتِ پی‌وال', r.behavior.paywall_stop, 'low'));
  if (r.behavior.pushback) L.push(row('نارضایتی/تکرارِ سؤال', r.behavior.pushback, 'low'));
  L.push('', `پرچم‌دار برای بازبینیِ چشمی: خرابِ فنی ${JSON.stringify(r.flagged.broken)} · کارتِ بیرونِ فال ${JSON.stringify(r.flagged.invented)}${r.flagged.unjudged?.length ? ` · داوری‌نشده ${JSON.stringify(r.flagged.unjudged)}` : ''}`);
  return L.join('\n');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
  const after = Number(opt('--after') || 0);
  if (cmd === 'sql') console.log(SQL);
  else if (cmd === 'selftest') {
    /* کنترلِ مثبتِ هر سنجه‌ی خودکار، قبل از هر دورِ امتیازدهی. سبزیِ «چیزی پیدا نکردم»
     * فقط وقتی معنی دارد که ثابت شود ابزار **می‌تواند** پیدا کند (بند ۶ب-۲ ریشه). */
    const m = (id, role, text, extra = {}) => ({ kind: 'msg', id, rid: 1, uid: 9, role, text, price: 1, fu: '', ...extra });
    const rows = [
      { kind: 'reading', id: 1, role: 'love3', q: 'q', cards: JSON.stringify([{ key: 'c13' }, { key: 'w10' }]), llm: '{}' },
      m(1, 'user', 'سؤال', { price: 0 }),
      m(2, 'assistant', 'ملکهٔ جام و ده چوب‌دستِ معکوس می‌گن آره. اگه بخوای می‌تونم نشونه‌ها رو جدا کنم.', { fu: 'نشونه‌ها رو جدا کن' }),
      m(3, 'user', 'نشونه‌ها رو جدا کن'),
      m(4, 'assistant', 'شاه شمشیر می‌گه {"answer": x}'),
      m(5, 'pending', 'بعدی'),
      { kind: 'ev', role: 'chat_llm_failed', text: '{"reading_id":1}' },
    ];
    const f = `${process.env.TMPDIR || '/tmp'}/chat-quality-selftest.json`;
    fs.writeFileSync(f, JSON.stringify(rows));
    const r = score(load(f));
    const checks = [
      [r.health.cards_ok.k === 1, 'کارتِ بیرونِ فال (شاه شمشیر) پیدا شد'],
      [r.health.tech_ok.k === 1 && r.health.tech_ok.n === 3, 'نشتِ JSON و شکستِ مدل هر دو شمرده شدند'],
      [r.behavior.via_button.k === 1 && r.behavior.via_button.n === 2, 'سؤالِ دکمه‌ای از تایپی جدا شد'],
      [r.behavior.paywall_stop.k === 1, 'سؤالِ پشتِ پی‌وال شمرده شد'],
      [JSON.stringify(cardsNamed('چند ماه صبر کن، قدرتت رو باور کن')) === '[]', 'کلمه‌ی روزمره کارت حساب نشد'],
    ];
    for (const [ok, msg] of checks) console.log(`${ok ? '✅' : '❌'} ${msg}`);
    fs.unlinkSync(f);
    if (checks.some(([ok]) => !ok)) process.exit(1);
  }
  else if (cmd === 'transcript') fs.writeFileSync(rest[1], transcript(load(rest[0], { after }).convs));
  else if (cmd === 'score') {
    const judged = opt('--judged') ? JSON.parse(fs.readFileSync(opt('--judged'), 'utf8')) : null;
    const r = score(load(rest[0], { after }), judged);
    console.log(rest.includes('--json') ? JSON.stringify(r, null, 1) : fmt(r));
  } else {
    console.error('استفاده: sql | transcript <chats.json> <out.txt> | score <chats.json> [--judged f] [--after id] [--json]');
    process.exit(1);
  }
}
