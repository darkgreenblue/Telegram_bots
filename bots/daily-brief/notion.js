// notion.js — خواندنِ رودمپِ آموزشی از پیجِ «دستیار آموزشی» نوشن.
//
// چرا fetch خام و نه SDK: الگوی جاافتاده‌ی voice2text (index.js حوالیِ خطِ ۱۱۳۱) — یک وابستگیِ npm
// کمتر و همان سه هدرِ ثابت. Notion-Version روی 2022-06-28 قفل است تا تغییرِ سمتِ نوشن پارس را نشکند.
//
// قرارداد پیج (کاملش در CLAUDE.md همین ربات):
//   پیجِ ریشه → هر child_page یک «موضوع» (ترتیبِ صفحه‌ها = اولویتِ تدریس)
//   داخلِ موضوع: خطوطِ «هدف:/عمق:/منابع:/نکته:» = متادیتا، بقیه‌ی متن = یادداشتِ کانتکست،
//   و هر بلوکِ to_do = یک «جلسه».
//
// دو قاعده‌ی سختِ این ماژول:
//   ۱) هرگز در نوشن نمی‌نویسد. چک‌باکس خوانده می‌شود ولی دست نمی‌خورد (پیشرفت در DB خودمان است).
//   ۲) پارس بخشنده است: بلوکِ ناشناخته/خراب رد می‌شود، نه اینکه کلِ رودمپ را بشکند.

import { log, logErr } from '../../shared/logger.js';

const NOTION_VERSION = '2022-06-28';
const ROOT_PAGE_TITLE = 'دستیار آموزشی';
// یادداشتِ کانتکستِ هر موضوع که به مدل داده می‌شود. سقف دارد چون مستقیم وارد پرامپت می‌شود
// و پرامپتِ متورم هم گران است هم کیفیتِ خروجی را پایین می‌آورد (درسِ tarot: STYLE.md).
const MAX_NOTES_CHARS = 2000;
const META_RE = /^\s*(هدف|عمق|منابع|نکته|سبک)\s*[:：]\s*(.*)$/;
const META_KEY_MAP = { هدف: 'goal', عمق: 'depth', منابع: 'sources', نکته: 'note', سبک: 'style' };

// ── کلاینتِ خام ────────────────────────────────────────────────────────────────
// خطاها با پیشوندِ ثابت بالا می‌روند تا هندلرِ UI بتواند پیامِ اقدام‌پذیرِ فارسی بسازد
// (مثلاً ۴۰۴ = «پیج با اینتگریشن share نشده») به‌جای نشان‌دادنِ متنِ خامِ انگلیسیِ نوشن.
export function createNotion({ token, fetchImpl = fetch }) {
  if (!token) return null;

  async function api(method, path, body) {
    const res = await fetchImpl(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => String(res.status));
      const err = new Error(`Notion ${res.status}: ${String(msg).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // همه‌ی فرزندانِ یک بلوک/پیج با صفحه‌بندی (نوشن سقفِ ۱۰۰ دارد و رودمپِ بلند رد می‌شود).
  async function children(blockId) {
    const out = [];
    let cursor;
    do {
      const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
      const res = await api('GET', `/blocks/${blockId}/children?${qs}`);
      out.push(...(res.results || []));
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return out;
  }

  // پیدا کردنِ پیجِ ریشه با عنوان. فقط وقتی صدا زده می‌شود که آی‌دیِ کش‌شده نداریم.
  async function findRootPage(title = ROOT_PAGE_TITLE) {
    const res = await api('POST', '/search', {
      query: title,
      filter: { value: 'page', property: 'object' },
      page_size: 20,
    });
    const hit = (res.results || []).find((p) => pageTitle(p) === title)
      || (res.results || []).find((p) => pageTitle(p).includes(title));
    return hit ? hit.id : null;
  }

  return { api, children, findRootPage };
}

// ── پارسِ خالص (بدون شبکه — همین‌ها در چکِ CI تست می‌شوند) ─────────────────────
export function pageTitle(p) {
  return p?.properties?.title?.title?.[0]?.plain_text
      || p?.child_page?.title
      || '';
}

export function blockText(b) {
  const rt = b?.[b?.type]?.rich_text;
  if (!Array.isArray(rt)) return '';
  return rt.map((t) => t?.plain_text || '').join('').trim();
}

// بلوک‌های یک موضوع → {meta, notes, lessons}
// lessons به ترتیبِ ظاهرشان است و کلیدشان block_id است، پس مالک می‌تواند عنوانِ جلسه را
// عوض کند بدون اینکه پیشرفتش پاک شود.
export function parseTopicBlocks(blocks) {
  const meta = {};
  const notes = [];
  const lessons = [];
  for (const b of blocks || []) {
    try {
      const type = b?.type;
      if (type === 'to_do') {
        const title = blockText(b);
        if (!title) continue;
        lessons.push({
          blockId: b.id,
          title,
          // چک‌باکسِ نوشن فقط خوانده می‌شود؛ نوشتنِ تیک کارِ آینده است.
          checked: !!b.to_do?.checked,
        });
        continue;
      }
      if (!['paragraph', 'bulleted_list_item', 'numbered_list_item',
            'heading_1', 'heading_2', 'heading_3', 'quote', 'callout'].includes(type)) continue;
      const text = blockText(b);
      if (!text) continue;
      const m = META_RE.exec(text);
      if (m && META_KEY_MAP[m[1]]) {
        const key = META_KEY_MAP[m[1]];
        // خطِ متادیتای تکراری به هم می‌چسبد (مثلاً چند خط «منابع:») به‌جای بازنویسی
        meta[key] = meta[key] ? `${meta[key]}؛ ${m[2].trim()}` : m[2].trim();
        continue;
      }
      notes.push(text);
    } catch (e) { logErr('notion parse block:', e.message); }
  }
  return {
    meta,
    notes: notes.join('\n').slice(0, MAX_NOTES_CHARS),
    lessons,
  };
}

// ── واکشیِ کاملِ رودمپ ─────────────────────────────────────────────────────────
// خروجی: [{pageId, title, order, meta, notes, lessons:[{blockId,title,checked}]}]
export async function fetchRoadmap(notion, rootPageId) {
  const roots = await notion.children(rootPageId);
  const topics = [];
  let order = 0;
  for (const b of roots) {
    if (b?.type !== 'child_page') continue;
    const title = b.child_page?.title?.trim() || 'بدون عنوان';
    let parsed = { meta: {}, notes: '', lessons: [] };
    try {
      parsed = parseTopicBlocks(await notion.children(b.id));
    } catch (e) {
      // یک موضوعِ خراب نباید کلِ رودمپ را از کار بیندازد
      logErr(`notion topic "${title}":`, e.message);
    }
    topics.push({ pageId: b.id, title, order: order++, ...parsed });
  }
  log(`📚 rodmap: ${topics.length} موضوع، ${topics.reduce((n, t) => n + t.lessons.length, 0)} جلسه`);
  return topics;
}

// ── همگام‌سازی با DB (منبعِ حقیقتِ پیشرفت = همین‌جا، نه نوشن) ───────────────────
// قواعد:
//   • جلسه‌ی جدید → pending
//   • عنوان/ترتیبِ عوض‌شده → آپدیت (کلید block_id پایدار است)
//   • تیک‌خورده در نوشن و هنوز pending → done_in_notion (مالک جای دیگری یادش گرفته)
//   • حذف‌شده از نوشن و هنوز pending → skipped (جلسه‌ی delivered هرگز دست نمی‌خورد)
export function syncLessons(db, topics) {
  const seen = new Set();
  const upsert = db.prepare(`
    INSERT INTO lessons (block_id, topic_page_id, topic_title, topic_order, lesson_order, title)
    VALUES (@blockId, @topicPageId, @topicTitle, @topicOrder, @lessonOrder, @title)
    ON CONFLICT(block_id) DO UPDATE SET
      topic_page_id = excluded.topic_page_id,
      topic_title   = excluded.topic_title,
      topic_order   = excluded.topic_order,
      lesson_order  = excluded.lesson_order,
      title         = excluded.title
  `);
  const markNotionDone = db.prepare(
    "UPDATE lessons SET status='done_in_notion' WHERE block_id=? AND status='pending'"
  );
  const unmarkNotionDone = db.prepare(
    "UPDATE lessons SET status='pending' WHERE block_id=? AND status='done_in_notion'"
  );
  const allPending = db.prepare("SELECT block_id FROM lessons WHERE status IN ('pending','done_in_notion')");
  const markSkipped = db.prepare(
    "UPDATE lessons SET status='skipped' WHERE block_id=? AND status IN ('pending','done_in_notion')"
  );

  const run = db.transaction(() => {
    for (const t of topics) {
      let li = 0;
      for (const l of t.lessons) {
        seen.add(l.blockId);
        upsert.run({
          blockId: l.blockId,
          topicPageId: t.pageId,
          topicTitle: t.title,
          topicOrder: t.order,
          lessonOrder: li++,
          title: l.title,
        });
        // تیک برداشته شد؟ جلسه دوباره در صف قرار می‌گیرد (کاربر نظرش عوض شده)
        if (l.checked) markNotionDone.run(l.blockId);
        else unmarkNotionDone.run(l.blockId);
      }
    }
    for (const row of allPending.all()) {
      if (!seen.has(row.block_id)) markSkipped.run(row.block_id);
    }
  });
  run();
  return seen.size;
}

// جلسه‌ی بعدی: اولین pending به ترتیبِ (موضوع، جلسه). خالی = رودمپ تمام شده.
export function pickNextLesson(db) {
  return db.prepare(`
    SELECT * FROM lessons WHERE status='pending'
    ORDER BY topic_order, lesson_order LIMIT 1
  `).get() || null;
}

// پیامِ فارسیِ اقدام‌پذیر از خطای خام نوشن (کاربر نباید متنِ انگلیسیِ API را ببیند).
export function notionErrorFa(err) {
  const s = err?.status;
  if (s === 401) return 'توکن Notion معتبر نیست. Secret را دوباره بساز و دیپلوی کن.';
  if (s === 404) return 'پیج «دستیار آموزشی» پیدا نشد. مطمئن شو که با همان Integration ربات share شده باشد.';
  if (s === 429) return 'Notion فعلاً درخواست‌ها را محدود کرده. چند دقیقه دیگر دوباره امتحان کن.';
  return `ارتباط با Notion برقرار نشد: ${String(err?.message || '').slice(0, 120)}`;
}
