/* ضربانِ زنده بودن — «آیا این ربات واقعاً دارد کار می‌کند؟»
 *
 * 🐛 چرا این ماژول هست (۱۴۰۵/۰۶/۱۶، دو خرابی در یک روز): رباتِ زنده دو بار خوابید و
 * **هر دو بار دیپلوی سبز تمام شد**. هشت باگِ دیپلویِ ثبت‌شده در CLAUDE.md ریشه یک چیزِ
 * مشترک دارند: همه بی‌صدا بودند و همه را یک انسان کشف کرد، نه سیستم.
 *
 * علتِ ساختاری این است که تعریفِ ما از «سالم» غلط بود: `pm2 status === 'online'`.
 * اپی که هر چند ثانیه می‌میرد و pm2 بالایش می‌آورد، **بینِ دو کرش online گزارش
 * می‌شود**. شمردنِ ری‌استارت هم کافی نیست، چون یک پروسه می‌تواند بدونِ هیچ ری‌استارتی
 * زنده و بی‌فایده باشد. تنها چیزی که واقعاً «کار می‌کند» را ثابت می‌کند، سیگنالی است
 * که **خودِ حلقه‌ی رویدادِ ربات** تولید کند.
 *
 * ## چرا فایل، نه دیتابیس
 * ریشه‌ی ریپو `node_modules` ندارد، پس `tools/health-watch.mjs` نمی‌تواند
 * better-sqlite3 را import کند، و گاردِ دیپلوی هم یک اسکریپتِ shell روی سرور است.
 * یک فایلِ متنیِ ساده از هر سه جا (ربات، Node، شل) بدونِ هیچ وابستگی خوانده می‌شود.
 * فایل در `data/` می‌نشیند که gitignore است، پس هرگز درختِ سرور را کثیف نمی‌کند
 * (درسِ بندِ «کلونِ سرور آینه‌ی فقط-خواندنیِ main است»).
 *
 * ## حدِ صداقتِ این سیگنال
 * ضربان ثابت می‌کند «پروسه از getMe رد شده و حلقه‌ی رویدادش می‌چرخد». این هر سه
 * خرابیِ واقعیِ تا امروز را می‌گیرد (ماژولِ گمشده، کرش‌لوپ، حلقه‌ی قفل‌شده). چیزی که
 * **نمی‌گیرد**: پروسه‌ای که زنده است ولی polling اش مرده (توکنِ باطل، ۴۰۹ Conflict).
 * آن یکی عمداً اینجا نیست، چون گرفتنش یعنی پیچیدنِ `callApi` رباتِ زنده‌ی درآمدزا و
 * ریسکش امروز بیشتر از سودش است. این حد صریح ثبت شده تا کسی بیش از آن‌چه هست از این
 * سیگنال برداشت نکند.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const HEARTBEAT_INTERVAL_MS = 20_000;

/** یک ضربان می‌نویسد. هرگز throw نمی‌کند: پایش نباید بتواند ربات را بشکند. */
export function beat(file, logErr) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, String(Math.floor(Date.now() / 1000)));
    return true;
  } catch (e) {
    if (logErr) logErr('❌ HEARTBEAT نوشتن:', e?.message || String(e));
    return false;
  }
}

/**
 * ضربان را شروع می‌کند و تابعِ توقف برمی‌گرداند.
 *
 * ⚠️ باید از قلابِ `onLaunch` صدا زده شود نه `.then()`ِ launch (بند ۹ب/۷ ریشه):
 * برای long polling، promiseِ `launch()` تا **توقفِ** ربات resolve نمی‌شود، پس
 * ضربانی که آن‌جا ثبت شود هیچ‌وقت تیک نمی‌زند و دقیقاً برعکسِ هدفش عمل می‌کند —
 * یک ضربانِ همیشه-کهنه که هر ۵ دقیقه هشدارِ کاذب می‌سازد.
 */
export function startHeartbeat(file, { intervalMs = HEARTBEAT_INTERVAL_MS, logErr } = {}) {
  beat(file, logErr);
  const t = setInterval(() => beat(file, logErr), intervalMs);
  // نگذار ضربان به‌تنهایی پروسه را زنده نگه دارد؛ اگر همه‌چیزِ دیگر تمام شد، این هم برود.
  if (typeof t.unref === 'function') t.unref();
  return () => clearInterval(t);
}

/** سنِ ضربان به ثانیه، یا `null` اگر فایلی نیست/خوانا نیست (= هرگز بالا نیامده). */
export function heartbeatAgeSec(file, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const raw = readFileSync(file, 'utf8').trim();
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return null;
    return nowSec - at;
  } catch { return null; }
}
