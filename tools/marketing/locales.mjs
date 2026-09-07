#!/usr/bin/env node
// تک‌منبعِ متادیتای کانالِ روزانه per زبان.
//
// قاعده‌ی مهم: نامِ دوازده «ماهِ تولد» این‌جا **دوباره نوشته نمی‌شود**؛ مستقیم از
// `bots/tarot/locales/<loc>.js` خوانده می‌شود، یعنی از همان جایی که خودِ ربات به کاربر
// نشان می‌دهد. اگر روزی برچسبی در ربات عوض شود، کانال خودبه‌خود همان را می‌گوید و
// هشتگ‌ها با ربات واگرا نمی‌شوند. همین برای نامِ کارت‌ها هم برقرار است
// (`langdata.<loc>.json` برای غیرفارسی، `cards.js` برای فارسی).
//
// ⚠️ اندیسِ ۱..۱۲ در هر چهار زبان یک چیز است: فروردین = Овен = Áries = Aries.
// تقویمِ فارسی از قبل با برج‌ها هم‌تراز بود، پس شناسه‌ی اتریبیوشنِ `m01..m12` بدونِ
// هیچ تغییری بینِ زبان‌ها مشترک می‌ماند.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const LOCALES = ['fa', 'ru', 'pt', 'es'];

/** منطقه‌ی زمانیِ هر زبان — عمداً همان جدولِ خودِ ربات (`reading-core.js`)، چون
 *  «۱۰ صبح» باید همان ۱۰ صبحی باشد که یادآوریِ شبانه‌ی ۲۲ همان ربات با آن سنجیده می‌شود. */
export const TZ = { fa: 'Asia/Tehran', ru: 'Europe/Moscow', pt: 'America/Sao_Paulo', es: 'America/Mexico_City' };

export const CHANNEL = { fa: '@taroot_fa', ru: '@TAROOT_RU', pt: '@TAROT_PT', es: '@TAROOT_ES' };
export const BOT_USERNAME = {
  fa: 'taroot_fa_bot', ru: 'TAROOT_RU_BOT', pt: 'TAROT_PT_BOT', es: 'TAROT_ES_BOT',
};
/** کلیدِ ربات در نگاشتِ توکنِ `.github/workflows/marketing.yml` */
export const BOT_KEY = { fa: 'tarot', ru: 'tarot-ru', pt: 'tarot-pt', es: 'tarot-es' };

/** کدِ کمپینِ کانالِ هر زبان (base62، بدونِ I/l/O/0/1). فارسی از قبل ثبت شده بود. */
export const CAMPAIGN = { fa: 'PKxwQ', ru: 'Rz7Kd', pt: 'Vn4Ht', es: 'Qm9Fs' };

const localeCache = new Map();
async function locale(loc) {
  if (!localeCache.has(loc)) {
    localeCache.set(loc, (await import(join(ROOT, 'bots/tarot/locales', `${loc}.js`))).default);
  }
  return localeCache.get(loc);
}

const langdataCache = new Map();
function langdata(loc) {
  if (!langdataCache.has(loc)) {
    const p = join(ROOT, 'bots/tarot', `langdata.${loc}.json`);
    langdataCache.set(loc, existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  }
  return langdataCache.get(loc);
}

/** دوازده برچسبِ ماه/برجِ تولد، به ترتیبِ اندیسِ ۱..۱۲، مستقیم از locale خودِ ربات. */
export async function signs(loc) {
  const L = await locale(loc);
  const arr = L?.buttons?.birthMonths;
  if (!Array.isArray(arr) || arr.length !== 12) throw new Error(`birthMonths زبانِ ${loc} دوازده‌تایی نیست`);
  return arr;
}

/** نامِ کارت به همان زبان. */
export async function cardNames(loc) {
  if (loc === 'fa') {
    const CARDS = (await import(join(ROOT, 'bots/tarot/cards.js'))).default;
    return Object.fromEntries(CARDS.map((c) => [c.key, c.fa]));
  }
  const d = langdata(loc);
  if (!d?.cardNames) throw new Error(`cardNames زبانِ ${loc} پیدا نشد`);
  return d.cardNames;
}

/** کلیدواژه‌های نمادشناسیِ کارت per جهت، به همان زبان (لنگرِ کیفیتِ تفسیر). */
export async function cardKeywords(loc) {
  if (loc === 'fa') {
    const CARDS = (await import(join(ROOT, 'bots/tarot/cards.js'))).default;
    return Object.fromEntries(CARDS.map((c) => [c.key, { up: c.up, down: c.down }]));
  }
  const d = langdata(loc);
  if (!d?.cardKeywords) throw new Error(`cardKeywords زبانِ ${loc} پیدا نشد`);
  return d.cardKeywords;
}

/** برچسبِ تاریخِ همان روز، به تقویم و زبانِ همان مخاطب.
 *  فارسی تقویمِ شمسی می‌گیرد (رفتارِ فعلی بیت‌به‌بیت حفظ می‌شود)، بقیه تقویمِ میلادی. */
const DATE_LOCALE = { fa: 'fa-IR', ru: 'ru-RU', pt: 'pt-BR', es: 'es-MX' };
export function dateLabel(loc, iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat(DATE_LOCALE[loc], {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ[loc],
  }).formatToParts(d);
  const g = (t) => parts.find((x) => x.type === t)?.value ?? '';
  if (loc === 'fa') return `${g('weekday')} ${g('day')} ${g('month')} ${g('year')}`;
  // ⚠️ روزِ هفته و نامِ ماه در هر سه زبان با حرفِ **کوچک** نوشته می‌شوند. بزرگ‌نویسیِ
  // «Сентября» یا «Setembro» فوراً بوی ترجمه‌ی ماشینی می‌دهد و اولین چیزی است که
  // خواننده‌ی بومی می‌بیند. (Intl خودش گاهی بزرگ می‌دهد، پس صریح کوچک می‌کنیم.)
  const low = (x) => x.toLocaleLowerCase(DATE_LOCALE[loc]);
  if (loc === 'ru') return `${low(g('weekday'))}, ${g('day')} ${low(g('month'))} ${g('year')}`;
  return `${low(g('weekday'))}, ${g('day')} de ${low(g('month'))} de ${g('year')}`;
}

/** هشتگِ ماه/برج. تلگرام در هشتگ حرفِ یونیکد را قبول می‌کند، ولی نویسه‌های ترکیبی و
 *  علائم شکستش می‌دهند؛ پس فاصله و نقطه حذف می‌شود. تصمیمِ نگه‌داشتن یا نگه‌نداشتنِ
 *  تشدید per زبان، در `HASHTAG_STRIP_ACCENT` می‌نشیند تا یک‌جا قابلِ تغییر باشد. */
export const HASHTAG_STRIP_ACCENT = { fa: false, ru: false, pt: false, es: false };
export function hashtag(loc, sign) {
  let s = String(sign).replace(/[\s.·]/g, '');
  if (HASHTAG_STRIP_ACCENT[loc]) s = s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  return `#${s}`;
}

/** مسیرِ فایل‌های روزِ هر زبان. */
export const postsDir = (loc) => `marketing/tarot/posts/${loc}`;
/** روزهایی که از زمان‌بندیِ کرون بیرون‌اند: یا عمداً رد شده‌اند یا دستی منتشر شده‌اند.
 *  کرون فقط `posts/` را نگاه می‌کند، پس گذاشتنِ فایل این‌جا یعنی «خودکار نفرست». */
export const offscheduleDir = (loc) => `marketing/tarot/offschedule/${loc}`;
export const dayFile = (loc, date) => `${postsDir(loc)}/${date}-day.json`;

/** شناسه‌ی اتریبیوشنِ پستِ هر ماه: c_<کمپین>_<YYMMDD>m<MM> */
export function startPayload(loc, date, monthIndex) {
  const yymmdd = date.slice(2).replace(/-/g, '');
  return `c_${CAMPAIGN[loc]}_${yymmdd}m${String(monthIndex).padStart(2, '0')}`;
}
export const buttonUrl = (loc, date, monthIndex) =>
  `https://t.me/${BOT_USERNAME[loc]}?start=${startPayload(loc, date, monthIndex)}`;
