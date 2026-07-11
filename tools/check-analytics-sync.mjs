// چک قرارداد آنالیتیکس: کپی محلی voice2text باید با shared/analytics.js هم‌نسخه و هم‌قرارداد بماند.
// voice2text عمداً از shared import نمی‌کند (قانون خودکفایی)؛ این چک drift را از «باگ خاموش در اعداد
// داشبورد» به «خطای قرمز CI» تبدیل می‌کند. اجرا: node tools/check-analytics-sync.mjs (از ریشه‌ی ریپو)
import { readFileSync } from 'fs';

const shared = readFileSync('shared/analytics.js', 'utf8');
const v2t = readFileSync('bots/voice2text/index.js', 'utf8');
const py = readFileSync('bots/tabir-khab/analytics.py', 'utf8');

const sharedVer = shared.match(/ANALYTICS_SCHEMA_VERSION = (\d+)/)?.[1];
const v2tVer = v2t.match(/ANALYTICS_SCHEMA_VERSION = (\d+)/)?.[1];
const pyVer = py.match(/ANALYTICS_SCHEMA_VERSION = (\d+)/)?.[1];

// قطعه‌های قراردادی که باید در هر دو نسخه عیناً وجود داشته باشند
const MUST_HAVE = [
  'CREATE TABLE IF NOT EXISTS events',
  "props      TEXT    NOT NULL DEFAULT '{}'",
  'idx_events_user',
  'idx_events_event',
  "ADD COLUMN first_source TEXT NOT NULL DEFAULT ''",
  "ADD COLUMN first_payload TEXT NOT NULL DEFAULT ''",
  "ADD COLUMN first_version TEXT NOT NULL DEFAULT ''",
  "first_version=? WHERE telegram_id=? AND first_version=''",
  'c_([A-Za-z0-9]{1,32})',
  'r(?:ef)?_(\\d+)',
  'busy_timeout = 5000',
];

// پورت پایتونی (tabir-khab): همان قرارداد با regex های پایتونی — created_at با strftime
// (سرور ممکن است sqlite قدیمی بدون unixepoch داشته باشد؛ مقدار همان ثانیه‌ی یونیکس است)
const PY_MUST_HAVE = [
  'CREATE TABLE IF NOT EXISTS events',
  "props      TEXT    NOT NULL DEFAULT '{}'",
  'idx_events_user',
  'idx_events_event',
  'first_source',
  'first_payload',
  'first_version',
  'c_([A-Za-z0-9]{1,32})',
  'r(?:ef)?_(\\d+)',
  'busy_timeout = 5000',
];

let fail = false;
if (!sharedVer || sharedVer !== v2tVer || sharedVer !== pyVer) {
  console.error(`❌ ANALYTICS_SCHEMA_VERSION ناهماهنگ: shared=${sharedVer} voice2text=${v2tVer} tabir=${pyVer}`);
  fail = true;
}
for (const piece of MUST_HAVE) {
  for (const [name, src] of [['shared/analytics.js', shared], ['bots/voice2text/index.js', v2t]]) {
    if (!src.includes(piece)) {
      console.error(`❌ ${name} فاقد قطعه‌ی قرارداد: ${piece}`);
      fail = true;
    }
  }
}
for (const piece of PY_MUST_HAVE) {
  if (!py.includes(piece)) {
    console.error(`❌ bots/tabir-khab/analytics.py فاقد قطعه‌ی قرارداد: ${piece}`);
    fail = true;
  }
}
if (fail) process.exit(1);
console.log(`✅ قرارداد آنالیتیکس سینک است (v${sharedVer} — shared/voice2text/tabir-khab)`);
