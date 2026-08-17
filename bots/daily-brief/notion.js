// notion.js — خواندنِ رودمپِ آموزشی از پیجِ «دستیار آموزشی» نوشن.
//
// چرا fetch خام و نه SDK: الگوی جاافتاده‌ی voice2text (index.js حوالیِ خطِ ۱۱۳۱) — یک وابستگیِ npm
// کمتر و همان سه هدرِ ثابت. Notion-Version روی 2022-06-28 قفل است تا تغییرِ سمتِ نوشن پارس را نشکند.
//
// قرارداد پیج (کاملش در CLAUDE.md همین ربات) — عمداً با **ساختارِ طبیعیِ یادداشت‌برداری**
// می‌خواند، نه با یک قالبِ تحمیلی:
//   • هر **هدینگ** در پیجِ ریشه یک «موضوع» را شروع می‌کند.
//   • هر **زیرصفحه** یک «جلسه» است و متنِ خودش موادِ خامِ همان قسمتِ پادکست می‌شود.
//   • هر **چک‌باکس** هم یک جلسه است (برای رودمپ‌هایی که هنوز زیرصفحه ندارند).
//   • متنِ آزادِ زیرِ هر هدینگ یادداشتِ کانتکستِ همان موضوع است، و خطوطِ
//     «هدف:/عمق:/منابع:/نکته:» اگر باشند به‌عنوان متادیتا خوانده می‌شوند (اختیاری).
//
// سه قاعده‌ی سختِ این ماژول:
//   ۱) هرگز در نوشن نمی‌نویسد. چک‌باکس خوانده می‌شود ولی دست نمی‌خورد (پیشرفت در DB خودمان است).
//   ۲) پارس بخشنده است: بلوکِ ناشناخته/خراب رد می‌شود، نه اینکه کلِ رودمپ را بشکند.
//   ۳) متنِ جلسه‌ها **موقعِ ساختِ همان قسمت** خوانده می‌شود، نه در هر همگام‌سازی. رودمپِ
//      ۲۱ جلسه‌ای وگرنه هر بار ۲۱ درخواستِ اضافه به نوشن می‌زد.

import { log, logErr } from '../../shared/logger.js';

const NOTION_VERSION = '2022-06-28';
// عنوان‌هایی که هنگامِ نبودِ آی‌دیِ ذخیره‌شده دنبالشان می‌گردیم (به همین ترتیب).
const ROOT_PAGE_TITLES = ['Learning', 'دستیار آموزشی'];
// یادداشتِ کانتکستِ هر موضوع که به مدل داده می‌شود. سقف دارد چون مستقیم وارد پرامپت می‌شود
// و پرامپتِ متورم هم گران است هم کیفیتِ خروجی را پایین می‌آورد (درسِ tarot: STYLE.md).
const MAX_NOTES_CHARS = 2000;
// متنِ خودِ جلسه: ماده‌ی اصلیِ قسمت است، پس سقفش بازتر است ولی همچنان محدود.
const MAX_LESSON_CHARS = 8000;
const HEADINGS = ['heading_1', 'heading_2', 'heading_3'];
const TEXT_BLOCKS = [
  'paragraph', 'bulleted_list_item', 'numbered_list_item', 'quote', 'callout',
  'toggle', 'code', 'to_do',
];
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
  async function findRootPage(titles = ROOT_PAGE_TITLES) {
    for (const title of titles) {
      const res = await api('POST', '/search', {
        query: title,
        filter: { value: 'page', property: 'object' },
        page_size: 20,
      });
      const results = res.results || [];
      // تطبیقِ دقیق مقدم است؛ عنوانِ نوشن ممکن است ایموجی یا فاصله‌ی اضافه داشته باشد
      const hit = results.find((p) => pageTitle(p).trim() === title)
        || results.find((p) => pageTitle(p).includes(title));
      if (hit) return hit.id;
    }
    return null;
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

// بلوک‌های یک صفحه → موضوع‌ها به ترتیبِ ظاهرشان.
// مدلِ ذهنی: خواندنِ صفحه از بالا به پایین، دقیقاً مثل آدم. هر هدینگ یک موضوعِ تازه شروع
// می‌کند و هر زیرصفحه/چک‌باکسی که بعدش می‌آید جلسه‌ی همان موضوع است.
// خروجی: [{key, title, order, meta, notes, lessons:[{blockId,title,kind,checked}]}]
export function parseRoadmapBlocks(blocks, { rootTitle = 'یادگیری' } = {}) {
  const topics = [];
  let cur = null;
  // موضوعِ پیش‌فرض برای جلسه‌هایی که قبل از اولین هدینگ می‌آیند
  const ensureTopic = (title, key) => {
    if (cur && cur.title === title) return cur;
    cur = { key: key || `t${topics.length}`, title, order: topics.length, meta: {}, notesArr: [], lessons: [] };
    topics.push(cur);
    return cur;
  };

  for (const b of blocks || []) {
    try {
      const type = b?.type;
      if (HEADINGS.includes(type)) {
        const t = blockText(b);
        if (t) ensureTopic(t, b.id);
        continue;
      }
      if (type === 'child_page') {
        const title = b.child_page?.title?.trim();
        if (!title) continue;
        ensureTopic(cur ? cur.title : rootTitle, cur?.key);
        cur.lessons.push({ blockId: b.id, title, kind: 'page', checked: false });
        continue;
      }
      if (type === 'to_do') {
        const title = blockText(b);
        if (!title) continue;
        ensureTopic(cur ? cur.title : rootTitle, cur?.key);
        // چک‌باکسِ نوشن فقط خوانده می‌شود؛ نوشتنِ تیک کارِ آینده است.
        cur.lessons.push({ blockId: b.id, title, kind: 'todo', checked: !!b.to_do?.checked });
        continue;
      }
      if (!TEXT_BLOCKS.includes(type)) continue;
      const text = blockText(b);
      if (!text) continue;
      ensureTopic(cur ? cur.title : rootTitle, cur?.key);
      const m = META_RE.exec(text);
      if (m && META_KEY_MAP[m[1]]) {
        const key = META_KEY_MAP[m[1]];
        // خطِ متادیتای تکراری به هم می‌چسبد (مثلاً چند خط «منابع:») به‌جای بازنویسی
        cur.meta[key] = cur.meta[key] ? `${cur.meta[key]}؛ ${m[2].trim()}` : m[2].trim();
        continue;
      }
      cur.notesArr.push(text);
    } catch (e) { logErr('notion parse block:', e.message); }
  }

  return topics
    .map((t) => ({
      key: t.key, title: t.title, order: t.order, meta: t.meta,
      notes: t.notesArr.join('\n').slice(0, MAX_NOTES_CHARS),
      lessons: t.lessons,
    }))
    // موضوعِ بی‌جلسه (مثلاً هدینگِ «موضوعات» که فقط تیتر است) وارد رودمپ نمی‌شود
    .filter((t) => t.lessons.length)
    .map((t, i) => ({ ...t, order: i }));
}

// ── واکشیِ رودمپ (فقط عنوان‌ها؛ متنِ جلسه‌ها موقعِ ساخت خوانده می‌شود) ──────────
export async function fetchRoadmap(notion, rootPageId, rootTitle) {
  const topics = parseRoadmapBlocks(await notion.children(rootPageId), { rootTitle });
  log(`📚 roadmap: ${topics.length} موضوع، ${topics.reduce((n, t) => n + t.lessons.length, 0)} جلسه`);
  return topics;
}

// ── متنِ یک جلسه ──────────────────────────────────────────────────────────────
// ماده‌ی خامِ قسمت. برای جلسه‌ی زیرصفحه‌ای، محتوای همان صفحه؛ برای چک‌باکس، خودِ عنوان
// (چیزی برای خواندن وجود ندارد و مدل باید از دانشِ خودش بسازد).
export async function fetchLessonBody(notion, lesson) {
  if (!lesson || lesson.kind === 'todo') return '';
  const out = [];
  let total = 0;
  const walk = async (blockId, depth) => {
    if (total >= MAX_LESSON_CHARS || depth > 2) return;
    let blocks = [];
    try { blocks = await notion.children(blockId); } catch (e) { logErr('lesson body:', e.message); return; }
    for (const b of blocks) {
      if (total >= MAX_LESSON_CHARS) return;
      const type = b?.type;
      if (type === 'child_page') continue; // زیرصفحه‌ی تودرتو جلسه‌ی خودش است، نه بدنه‌ی این یکی
      if (!HEADINGS.includes(type) && !TEXT_BLOCKS.includes(type)) continue;
      const text = blockText(b);
      if (!text) continue;
      const line = HEADINGS.includes(type) ? `\n${text}` : text;
      out.push(line);
      total += line.length;
      if (b.has_children && type === 'toggle') await walk(b.id, depth + 1);
    }
  };
  await walk(lesson.block_id || lesson.blockId, 0);
  return out.join('\n').slice(0, MAX_LESSON_CHARS).trim();
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
    INSERT INTO lessons (block_id, topic_page_id, topic_title, topic_order, lesson_order, title, kind)
    VALUES (@blockId, @topicPageId, @topicTitle, @topicOrder, @lessonOrder, @title, @kind)
    ON CONFLICT(block_id) DO UPDATE SET
      topic_page_id = excluded.topic_page_id,
      topic_title   = excluded.topic_title,
      topic_order   = excluded.topic_order,
      lesson_order  = excluded.lesson_order,
      title         = excluded.title,
      kind          = excluded.kind
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
          topicPageId: t.key,
          topicTitle: t.title,
          topicOrder: t.order,
          lessonOrder: li++,
          title: l.title,
          kind: l.kind || 'page',
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
