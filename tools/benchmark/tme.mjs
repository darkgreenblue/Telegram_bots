// خواندنِ صفحه‌ی پیش‌نمایشِ عمومیِ کانال تلگرام (https://t.me/s/<username>)
//
// چرا این مسیر: Bot API اصلاً نمی‌تواند پستِ کانالی را که ادمینش نیست بخواند و فیلد «ویو» هم ندارد.
// این صفحه ولی HTML رندرشده‌ی سرور است: بدون اکانت، بدون کلید، بدون ریسکِ بن. محدودیت‌ها:
//   • کانالی که «Restrict saving content» را روشن کرده صفحه‌ی /s/ ندارد.
//   • ویو خلاصه‌شده است ("12.3K")، پس اعداد بزرگ تا ۳ رقم معنادار دقت دارند.
//   • تعداد کامنت در این صفحه نیست (در گروهِ گفتگوی لینک‌شده است).
// هیچ وابستگیِ npm ای ندارد (قرارداد ریپو) و فقط با fetch نود ۲۰ کار می‌کند.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** «12.3K» / «1.2M» / «۱۲۳» / «12 345» → عدد. ناشناخته → null */
export function parseCount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // ارقام فارسی/عربی → لاتین
  s = s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
       .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  s = s.replace(/[ ‌‏‎\s,]/g, '');
  const m = s.match(/^([\d.]+)\s*([KMkm])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1;
  return Math.round(n * mult);
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** HTML یک پست → متن ساده (br و /p به خط جدید) */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * از ایندکسِ یک `<tag` شروع می‌کند و محتوای همان تگ را با شمارشِ تودرتو برمی‌گرداند.
 * (رجکسِ non-greedy روی divهای تودرتوی تلگرام اشتباه می‌بُرد.)
 */
function extractBlock(html, openIdx, tag = 'div') {
  const gt = html.indexOf('>', openIdx);
  if (gt === -1) return null;
  if (html[gt - 1] === '/') return ''; // تگ خودبسته
  const re = new RegExp(`<(/?)${tag}\\b`, 'gi');
  re.lastIndex = openIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      depth--;
      if (depth === 0) return html.slice(gt + 1, m.index);
    } else {
      // تگِ خودبسته‌ی <div/> عملاً وجود ندارد؛ ایمن است
      depth++;
    }
  }
  return null;
}

/** همه‌ی بلوک‌هایی که کلاسِ داده‌شده را دارند */
function blocksByClass(html, className, tag = 'div') {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const body = extractBlock(html, m.index, tag);
    if (body != null) out.push({ open: m[0], body, index: m.index });
  }
  return out;
}

function firstBlockByClass(html, className, tag = 'div') {
  return blocksByClass(html, className, tag)[0] || null;
}

/** واکنش‌ها: ساختارِ تلگرام در طول زمان عوض شده، پس چند الگو را امتحان می‌کنیم. */
function parseReactions(chunk) {
  const out = [];
  // الگوی رایج: <span class="tgme_reaction"> <i>❤️</i> <span class="tgme_reaction_counter">12</span>
  const reBlocks = /<(span|a|div)\b[^>]*class="[^"]*\btgme_reaction\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = reBlocks.exec(chunk))) {
    const inner = m[2];
    const counterM = inner.match(/class="[^"]*\btgme_reaction_counter\b[^"]*"[^>]*>([^<]*)</i);
    const plain = htmlToText(inner);
    const count = counterM ? parseCount(counterM[1]) : parseCount((plain.match(/[\d.,KkMm]+$/) || [])[0]);
    const emoji = (plain.replace(/[\d.,KkMm\s]+$/, '') || '?').trim() || '?';
    if (count != null) out.push({ emoji, count });
  }
  return out;
}

/** آیا اصلاً چیزی شبیه واکنش در HTML هست؟ (برای تشخیصِ تغییرِ ساختار در حالت probe) */
export function reactionClassHints(html) {
  const hints = new Set();
  const re = /class="([^"]*react[^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) hints.add(m[1].trim());
  return [...hints].slice(0, 12);
}

/** هدرِ کانال: عنوان، توضیح، تعداد ممبر و شمارنده‌های دیگر */
export function parseChannelHeader(html) {
  const titleB = firstBlockByClass(html, 'tgme_channel_info_header_title');
  const descB = firstBlockByClass(html, 'tgme_channel_info_description');
  const counters = {};
  for (const c of blocksByClass(html, 'tgme_channel_info_counter')) {
    const val = (c.body.match(/class="[^"]*\bcounter_value\b[^"]*"[^>]*>([^<]*)</i) || [])[1];
    const type = (c.body.match(/class="[^"]*\bcounter_type\b[^"]*"[^>]*>([^<]*)</i) || [])[1];
    if (type) counters[htmlToText(type)] = parseCount(val);
  }
  return {
    title: titleB ? htmlToText(titleB.body) : null,
    description: descB ? htmlToText(descB.body) : null,
    subscribers: counters.subscribers ?? counters.members ?? null,
    counters,
  };
}

/** یک صفحه (۲۰ پست) → آرایه‌ی پست‌ها */
export function parsePosts(html, username) {
  const posts = [];
  for (const wrap of blocksByClass(html, 'tgme_widget_message_wrap')) {
    const chunk = wrap.body;
    const postM = chunk.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!postM) continue;
    const id = Number(postM[2]);

    const isService = /\btgme_widget_message_service\b/.test(chunk);
    const viewsM = chunk.match(/class="[^"]*\btgme_widget_message_views\b[^"]*"[^>]*>([^<]*)</i);
    const timeM = chunk.match(/<time\b[^>]*datetime="([^"]+)"/i);
    const textB = firstBlockByClass(chunk, 'tgme_widget_message_text');
    const text = textB ? htmlToText(textB.body) : '';

    const media = [];
    if (/\btgme_widget_message_photo\b/.test(chunk)) media.push('photo');
    if (/\btgme_widget_message_video\b/.test(chunk) && !/\btgme_widget_message_roundvideo\b/.test(chunk)) media.push('video');
    if (/\btgme_widget_message_roundvideo\b/.test(chunk)) media.push('roundvideo');
    if (/\btgme_widget_message_voice\b/.test(chunk)) media.push('voice');
    if (/\btgme_widget_message_document\b/.test(chunk)) media.push('document');
    if (/\btgme_widget_message_poll\b/.test(chunk)) media.push('poll');
    if (/\btgme_widget_message_sticker\b/.test(chunk)) media.push('sticker');

    const reactions = parseReactions(chunk);
    const links = [...chunk.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/gi)]
      .map((m) => m[1])
      .filter((u) => !u.startsWith('https://t.me/' + username + '/'));

    posts.push({
      id,
      username,
      date: timeM ? timeM[1] : null,
      views: viewsM ? parseCount(viewsM[1]) : null,
      text,
      textLen: text.length,
      media,
      reactions,
      reactionTotal: reactions.reduce((a, r) => a + (r.count || 0), 0),
      forwarded: /\btgme_widget_message_forwarded_from\b/.test(chunk),
      isReply: /\btgme_widget_message_reply\b/.test(chunk),
      hasLink: links.length > 0,
      externalLinks: [...new Set(links)].slice(0, 5),
      isService,
    });
  }
  // ترتیبِ صفحه صعودی است؛ همیشه نزولی برگردان
  return posts.sort((a, b) => b.id - a.id);
}

export async function fetchPreview(username, before = null, { timeoutMs = 20000 } = {}) {
  const url = `https://t.me/s/${encodeURIComponent(username)}${before ? `?before=${before}` : ''}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': UA, 'accept-language': 'fa,en;q=0.8' },
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, url };
  } finally {
    clearTimeout(t);
  }
}

/**
 * تاریخچه‌ی یک کانال را تا `pages` صفحه (هر صفحه ~۲۰ پست) عقب می‌رود.
 * با فاصله‌ی مودبانه بین درخواست‌ها تا t.me محدودمان نکند.
 */
export async function collectChannel(username, opts = {}) {
  const pages = opts.pages ?? 5;
  const delayMs = opts.delayMs ?? 1200;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const first = await fetchPreview(username);
  if (!first.ok) {
    return { username, ok: false, error: `HTTP ${first.status}`, posts: [], header: null };
  }
  const header = parseChannelHeader(first.html);
  const seen = new Map();
  let page = parsePosts(first.html, username);
  if (page.length === 0) {
    const priv = /tgme_page_context_link|preview_channel|Please open Telegram/i.test(first.html);
    return {
      username,
      ok: false,
      error: priv ? 'preview-unavailable (کانال خصوصی یا پیش‌نمایشِ وب بسته)' : 'no-posts-parsed',
      header,
      posts: [],
      sampleHints: reactionClassHints(first.html),
    };
  }
  for (const p of page) seen.set(p.id, p);
  let oldest = Math.min(...page.map((p) => p.id));
  log(`  ${username}: صفحه ۱ → ${page.length} پست (تا id ${oldest})`);

  for (let i = 1; i < pages; i++) {
    await sleep(delayMs);
    const r = await fetchPreview(username, oldest);
    if (!r.ok) {
      log(`  ${username}: صفحه ${i + 1} خطا HTTP ${r.status} — توقف`);
      break;
    }
    const more = parsePosts(r.html, username);
    const fresh = more.filter((p) => !seen.has(p.id));
    if (fresh.length === 0) {
      log(`  ${username}: صفحه ${i + 1} چیز جدیدی نداشت — پایان تاریخچه`);
      break;
    }
    for (const p of fresh) seen.set(p.id, p);
    oldest = Math.min(...more.map((p) => p.id));
    log(`  ${username}: صفحه ${i + 1} → ${fresh.length} پست جدید (تا id ${oldest})`);
  }

  const posts = [...seen.values()].sort((a, b) => b.id - a.id);
  return {
    username,
    ok: true,
    header,
    posts,
    reactionHints: posts.some((p) => p.reactions.length) ? null : reactionClassHints(first.html),
  };
}
