#!/usr/bin/env node
// چکِ آزمایشِ `love_slot` (tarot v3.31.0) — کدام دکمه‌ی عاطفی جایگاهِ سومِ منوی کوتاه را بگیرد.
//
// چرا **رفتاری** است نه فقط regex روی سورس: اعتبارِ کلِ آزمایش به یک چیز بند است، اینکه
// کاربرِ قدیمی هرگز وارد نشود. اگر آن گارد بی‌صدا بشکند، آزمایش قرمز نمی‌شود؛ فقط نتیجه‌ای
// می‌دهد که غلط است و مالک روی همان تصمیم می‌گیرد. پس همان منطق این‌جا روی یک دیتابیسِ
// واقعیِ در-حافظه اجرا می‌شود، با همان `variant()` واقعیِ shared/ab.js.
//
// اجرا: node tools/check-love-slot.mjs
import fs from 'node:fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
import { ensureAnalytics } from '../shared/analytics.js';
import { ensureAb, variant } from '../shared/ab.js';

const SRC = fs.readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
let pass = 0; const errs = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✅ ${msg}`); } else { errs.push(msg); console.log(`  ❌ ${msg}`); } };

/* ═══ ۱) قرارداد در سورس ═══ */
console.log('\n▶ قرارداد آزمایش در سورس');
ok(/const LOVE_SLOT_EXP = 'love_slot';/.test(SRC), 'کلیدِ آزمایش یک ثابت است، نه رشته‌ی پراکنده');
const varBlock = (SRC.match(/const MENU_SLOT_VARIANTS = \{[\s\S]*?\};/) || [''])[0];
ok(/control: MENU_SLOTS_DEFAULT/.test(varBlock),
  'control همان جفتِ پیش‌فرض است (kill از داشبورد = رفتارِ دقیقاً قبلی)');
const arms = [...varBlock.matchAll(/^\s{2}(\w+):\s*(?:MENU_SLOTS_DEFAULT|\['(\w+)', '(\w+)'\])/gm)]
  .map(m => ({ key: m[1], slots: m[2] ? [m[2], m[3]] : ['yesno', 'love'] }));
ok(arms.length === 3, `آزمایش دقیقاً سه شاخه دارد (${arms.map(a => a.key).join('، ')})`);
// تک‌متغیره بودن: جایگاهِ دوم در هر سه شاخه یکی است و فقط جایگاهِ سوم فرق می‌کند.
ok(new Set(arms.map(a => a.slots[0])).size === 1,
  'جایگاهِ دومِ منو در هر سه شاخه یکسان است (آزمایش تک‌متغیره است)');
ok(new Set(arms.map(a => a.slots[1])).size === 3,
  'جایگاهِ سوم در هر سه شاخه متفاوت است (همان چیزی که سنجیده می‌شود)');
ok(/if \(!inLoveSlotAudience\(uid\)\) return MENU_SLOTS_DEFAULT;/.test(SRC),
  'گاردِ دامنه **قبل از** variant() اجرا می‌شود (وگرنه کاربرِ خارج از دامنه exposure می‌گیرد)');
ok(/status IN \('running','draining'\)/.test(SRC),
  'مرزِ زمانی از خودِ آزمایش خوانده می‌شود، نه یک تاریخِ دستی در کد');

/* ═══ ۲) رفتارِ واقعی روی دیتابیسِ در-حافظه ═══ */
console.log('\n▶ رفتارِ واقعی (همان variant() واقعی)');
const db = new Database(':memory:');
db.exec('CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL)');
ensureAnalytics(db); ensureAb(db);

const LOVE_SLOT_EXP = 'love_slot';
const MENU_SLOTS_DEFAULT = ['yesno', 'love'];
const MENU_SLOT_VARIANTS = Object.fromEntries(arms.map(a => [a.key, a.slots]));
const expStartedAt = db.prepare("SELECT started_at FROM experiments WHERE key=? AND status IN ('running','draining')");
const getUser = db.prepare('SELECT * FROM users WHERE telegram_id=?');
function inLoveSlotAudience(uid) {
  try {
    const startedAt = expStartedAt.get(LOVE_SLOT_EXP)?.started_at;
    if (!startedAt) return false;
    const u = getUser.get(uid);
    return !!u && Number(u.created_at) >= Number(startedAt);
  } catch { return false; }
}
const menuSlotsFor = (uid) => {
  try {
    if (!inLoveSlotAudience(uid)) return MENU_SLOTS_DEFAULT;
    return MENU_SLOT_VARIANTS[variant(db, uid, LOVE_SLOT_EXP)] || MENU_SLOTS_DEFAULT;
  } catch { return MENU_SLOTS_DEFAULT; }
};

const T = 1_000_000, OLD = 300, NEW = 300;
const ins = db.prepare('INSERT INTO users (telegram_id, created_at) VALUES (?,?)');
for (let i = 1; i <= OLD + NEW; i++) ins.run(i, i <= OLD ? T - 500 : T + 500);

ok(menuSlotsFor(1).join() === MENU_SLOTS_DEFAULT.join() && menuSlotsFor(400).join() === MENU_SLOTS_DEFAULT.join(),
  'تا آزمایش start نشده، هیچ‌کس از control بیرون نمی‌رود');
ok(db.prepare('SELECT count(*) c FROM ab_exposures').get().c === 0,
  'قبل از start هیچ exposureای ثبت نمی‌شود');

db.prepare('INSERT INTO experiments (key,status,started_at,variants_json) VALUES (?,?,?,?)').run(
  LOVE_SLOT_EXP, 'running', T,
  JSON.stringify(arms.map((a, i) => ({ key: a.key, weight: i === 0 ? 34 : 33 }))));

const seen = { old: new Set(), fresh: {} };
for (let i = 1; i <= OLD; i++) seen.old.add(menuSlotsFor(i).join());
for (let i = OLD + 1; i <= OLD + NEW; i++) {
  const k = menuSlotsFor(i).join(); seen.fresh[k] = (seen.fresh[k] || 0) + 1;
}
ok(seen.old.size === 1 && seen.old.has(MENU_SLOTS_DEFAULT.join()),
  'کاربرِ ثبت‌نام‌شده قبل از start همیشه control می‌بیند');
ok(db.prepare('SELECT count(*) c FROM ab_exposures WHERE user_id<=?').get(OLD).c === 0,
  '⭐ هیچ exposureای از کاربرِ قدیمی ثبت نمی‌شود (اعتبارِ کلِ آزمایش به همین بند است)');
const buckets = Object.values(seen.fresh);
ok(buckets.length === 3, `کاربرِ جدید بینِ هر سه شاخه پخش می‌شود (${JSON.stringify(seen.fresh)})`);
// توزیعِ تقریباً مساوی: هیچ شاخه‌ای نباید کمتر از نصفِ سهمِ منصفانه بگیرد.
ok(Math.min(...buckets) > (NEW / 3) * 0.5, 'توزیعِ سه شاخه تقریباً مساوی است');

const first = menuSlotsFor(OLD + 1).join();
ok(menuSlotsFor(OLD + 1).join() === first, 'شاخه‌ی کاربر چسبنده است (دو بار دیدنِ منو یک جواب می‌دهد)');

db.prepare("UPDATE experiments SET status='stopped' WHERE key=?").run(LOVE_SLOT_EXP);
const afterKill = new Set();
for (let i = OLD + 1; i <= OLD + NEW; i++) afterKill.add(menuSlotsFor(i).join());
ok(afterKill.size === 1 && afterKill.has(MENU_SLOTS_DEFAULT.join()),
  'kill از داشبورد همه را فوراً به control برمی‌گرداند (بند ۲ج/۸)');

/* ═══ ۳) ادعای معکوس: اگر گارد برداشته شود، چک باید بفهمد ═══ */
console.log('\n▶ ادعای معکوس (چک واقعاً دندان دارد)');
db.prepare("UPDATE experiments SET status='running' WHERE key=?").run(LOVE_SLOT_EXP);
db.prepare('DELETE FROM ab_exposures').run();
const noGate = (uid) => MENU_SLOT_VARIANTS[variant(db, uid, LOVE_SLOT_EXP)] || MENU_SLOTS_DEFAULT;
for (let i = 1; i <= OLD; i++) noGate(i);
ok(db.prepare('SELECT count(*) c FROM ab_exposures WHERE user_id<=?').get(OLD).c > 0,
  'بدونِ گارد، کاربرِ قدیمی واقعاً exposure می‌گیرد (پس بندِ ⭐ بالا الکی سبز نیست)');

console.log(errs.length ? `\n❌ نتیجه: ${pass} پاس، ${errs.length} خطا` : `\n✅ نتیجه: ${pass} پاس، 0 خطا`);
process.exit(errs.length ? 1 : 0);
