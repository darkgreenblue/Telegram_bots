// ژورنال محصول: بایگانی نسخه‌ها، فرضیه‌ها و اینسایت‌ها — حافظه‌ی بلندمدت تیم (طرح، بند ژورنال)
import { BOTS } from '../lib/bots.js';
import { addVersion, listVersions, addInsight, listInsights, audit } from '../lib/platform.js';
import { esc, tehranDateTime } from '../lib/util.js';
import { table } from '../lib/html.js';

export function journalBody() {
  const botOptions = ['<option value="">پلتفرم</option>', ...BOTS.map(b => `<option value="${b.key}">${esc(b.title)}</option>`)].join('');
  const versionForm = `<div class="card"><h2>🏷 ثبت نسخه‌ی محصول</h2>
  <form method="post" action="/journal/version" class="inline">
    <label>ربات<select name="bot">${BOTS.map(b => `<option value="${b.key}">${esc(b.title)}</option>`).join('')}</select></label>
    <label>برچسب<input name="label" placeholder="مثلاً v2 پی‌وال جدید" required></label>
    <label>شرح<input name="description" placeholder="چه چیزی عوض شد و چرا"></label>
    <label>ref گیت<input name="git_ref" dir="ltr" placeholder="sha یا شماره PR"></label>
    <button type="submit">ثبت</button>
  </form></div>`;
  const insightForm = `<div class="card"><h2>💡 ثبت اینسایت</h2>
  <form method="post" action="/journal/insight" class="inline">
    <label>ربات<select name="bot">${botOptions}</select></label>
    <label style="flex:1;min-width:280px">اینسایت<input name="text" placeholder="چه فهمیدیم؟" required></label>
    <label>کلید آزمایش مرتبط (اختیاری)<input name="experiment_key" dir="ltr"></label>
    <button type="submit">ثبت</button>
  </form></div>`;
  const versions = table(['زمان', 'ربات', 'برچسب', 'شرح', 'ref'],
    listVersions().map(v => [tehranDateTime(v.created_at), esc(v.bot), `<b>${esc(v.label)}</b>`, esc(v.description), `<span class="mono">${esc(v.git_ref)}</span>`]),
    'نسخه‌ای ثبت نشده.');
  const insights = table(['زمان', 'ربات', 'اینسایت', 'آزمایش'],
    listInsights().map(i => [tehranDateTime(i.created_at), esc(i.bot || 'پلتفرم'), esc(i.text), i.experiment_key ? `<span class="mono">${esc(i.experiment_key)}</span>` : '-']),
    'اینسایتی ثبت نشده.');
  return versionForm + insightForm
    + `<div class="card"><h2>🏷 تاریخچه‌ی نسخه‌ها</h2>${versions}</div>`
    + `<div class="card"><h2>💡 اینسایت‌ها</h2>${insights}</div>`;
}

export function journalVersion(body) {
  if (!body.get('label')) throw new Error('برچسب لازم است');
  addVersion(body.get('bot') || '', body.get('label'), body.get('description'), body.get('git_ref'));
  audit('journal.version', body.get('bot') || '', body.get('label'));
  return 'نسخه ثبت شد';
}
export function journalInsight(body) {
  if (!body.get('text')) throw new Error('متن لازم است');
  addInsight(body.get('bot'), body.get('text'), body.get('experiment_key'));
  audit('journal.insight', body.get('bot') || '', '');
  return 'اینسایت ثبت شد';
}
