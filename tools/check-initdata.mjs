// چکِ CI برای تأییدِ امضای initData مینی‌اپ (shared/initdata.js).
//
// چرا این فایل جدی‌تر از یک چکِ معمولی است: این تابع **تنها** چیزی است که بینِ حسابِ
// کاربر و یک درخواستِ جعلی ایستاده. اگر روزی سهواً ضعیف شود، هیچ خطایی نمی‌دهد و هیچ
// لاگی نمی‌سازد؛ فقط از آن به بعد هر کسی می‌تواند خودش را کاربرِ دیگری جا بزند. پس
// تستِ مثبت به‌تنهایی بی‌معنی است و بیشترِ ادعاهای این فایل **منفی**اند.
import { createHmac } from 'node:crypto';
import { verifyInitData, initDataUserId, INITDATA_MAX_AGE_SEC } from '../shared/initdata.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); if (extra) console.error(`     ${extra}`); }
};

const TOKEN = '7123456789:AAF-fake-token-for-tests-only-not-a-secret';

/* امضاکننده‌ی مرجع — عمداً **جدا** از ماژول نوشته شده و مستقیم از متنِ مستندِ تلگرام
 * پیاده شده، تا چک آینه‌ی خودِ ماژول نباشد (درسِ بند ۲و/۶ب ریشه). */
function signInitData(fields, token = TOKEN) {
  const checkString = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  const sp = new URLSearchParams({ ...fields, hash });
  return sp.toString();
}

const NOW = 1_760_000_000;
const USER = { id: 100257975, first_name: 'A', username: 'a', language_code: 'ru' };
const baseFields = () => ({
  auth_date: String(NOW - 10),
  query_id: 'AAH_test',
  user: JSON.stringify(USER),
});

console.log('\n🔐 امضای initData مینی‌اپ\n');

/* ══ ۱) مسیرِ درست ═════════════════════════════════════════════════════════ */
{
  const good = signInitData(baseFields());
  const r = verifyInitData(good, TOKEN, { now: NOW });
  ok(r.ok === true, 'امضای معتبر پذیرفته می‌شود');
  ok(initDataUserId(r) === USER.id, 'شناسه‌ی کاربر از فیلدِ امضاشده بیرون می‌آید');
  ok(r.queryId === 'AAH_test', 'query_id خوانده می‌شود');
  ok(r.authDate === NOW - 10, 'auth_date عددی برمی‌گردد');
}

/* ══ ۲) هر شکلِ دستکاری باید رد شود ═══════════════════════════════════════
 * این بخش قلبِ فایل است: تک‌تکِ راه‌هایی که یک مهاجم امتحان می‌کند. */
{
  const f = baseFields();
  const good = signInitData(f);

  // الف) عوض‌کردنِ کاربر بدونِ عوض‌کردنِ امضا — اصلی‌ترین حمله
  const tamperedUser = new URLSearchParams(good);
  tamperedUser.set('user', JSON.stringify({ ...USER, id: 999 }));
  ok(verifyInitData(tamperedUser.toString(), TOKEN, { now: NOW }).reason === 'bad_hash',
    'عوض‌کردنِ شناسه‌ی کاربر رد می‌شود (جعلِ هویت)');

  // ب) افزودنِ فیلدِ تازه
  const added = new URLSearchParams(good);
  added.set('is_premium', 'true');
  ok(verifyInitData(added.toString(), TOKEN, { now: NOW }).reason === 'bad_hash',
    'افزودنِ فیلدِ امضانشده رد می‌شود');

  // ج) حذفِ یک فیلدِ امضاشده
  const removed = new URLSearchParams(good);
  removed.delete('query_id');
  ok(verifyInitData(removed.toString(), TOKEN, { now: NOW }).reason === 'bad_hash',
    'حذفِ یک فیلدِ امضاشده رد می‌شود');

  // د) توکنِ دیگر (رباتِ دیگر) — هر زبان توکنِ خودش را دارد، پس این واقعاً ممکن است
  ok(verifyInitData(good, TOKEN.replace('7123', '7999'), { now: NOW }).reason === 'bad_hash',
    'امضای رباتِ دیگر روی این ربات معتبر نیست (توکنِ per زبان)');

  // ه‍) هشِ دستکاری‌شده و هشِ خالی
  const badHash = new URLSearchParams(good);
  badHash.set('hash', 'f'.repeat(64));
  ok(verifyInitData(badHash.toString(), TOKEN, { now: NOW }).reason === 'bad_hash', 'هشِ ساختگی رد می‌شود');
  const noHash = new URLSearchParams(good); noHash.delete('hash');
  ok(verifyInitData(noHash.toString(), TOKEN, { now: NOW }).reason === 'no_hash', 'نبودِ هش رد می‌شود');

  // و) هشِ کوتاه‌شده: نباید با «شروعش درست است» قبول شود
  const shortHash = new URLSearchParams(good);
  shortHash.set('hash', new URLSearchParams(good).get('hash').slice(0, 32));
  ok(verifyInitData(shortHash.toString(), TOKEN, { now: NOW }).reason === 'bad_hash',
    'هشِ کوتاه‌شده رد می‌شود (مقایسه‌ی پیشوندی ممنوع)');

  /* ز) ترتیبِ فیلدها در رشته با ترتیبِ الفبایی فرق دارد.
   *
   * ⚠️ این ادعا از یک جهشِ زنده‌مانده آمد: نسخه‌ی اولِ این فایل فیلدها را اتفاقاً به
   * ترتیبِ الفبایی می‌چید (auth_date, query_id, user)، پس برداشتنِ `.sort()` از ماژول
   * هیچ تستی را قرمز نمی‌کرد. یعنی چک درباره‌ی مرتب‌سازی **هیچ چیز** نمی‌گفت. */
  const unsorted = new URLSearchParams();
  const f2 = baseFields();
  unsorted.set('user', f2.user);          // عمداً برعکسِ الفبا
  unsorted.set('query_id', f2.query_id);
  unsorted.set('auth_date', f2.auth_date);
  const cs = ['auth_date=' + f2.auth_date, 'query_id=' + f2.query_id, 'user=' + f2.user].join('\n');
  const h2 = createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest())
    .update(cs).digest('hex');
  unsorted.set('hash', h2);
  ok(verifyInitData(unsorted.toString(), TOKEN, { now: NOW }).ok === true,
    'ترتیبِ فیلدها در رشته مهم نیست؛ رشته‌ی چک همیشه الفبایی ساخته می‌شود');

  /* ح) هشِ بلندترِ حاویِ هشِ درست: مقایسه‌ی پیشوندی/زیررشته‌ای نباید قبولش کند. */
  const longHash = new URLSearchParams(good);
  longHash.set('hash', new URLSearchParams(good).get('hash') + 'deadbeef');
  ok(verifyInitData(longHash.toString(), TOKEN, { now: NOW }).reason === 'bad_hash',
    'هشِ بلندشده رد می‌شود (هیچ مقایسه‌ی زیررشته‌ای در کار نیست)');
}

/* ══ ۳) تازگی ═════════════════════════════════════════════════════════════
 * امضای معتبرِ دزدیده‌شده تا ابد معتبر می‌ماند اگر تاریخش سنجیده نشود. */
{
  const old = signInitData({ ...baseFields(), auth_date: String(NOW - INITDATA_MAX_AGE_SEC - 60) });
  ok(verifyInitData(old, TOKEN, { now: NOW }).reason === 'expired', 'امضای کهنه رد می‌شود');
  const edge = signInitData({ ...baseFields(), auth_date: String(NOW - INITDATA_MAX_AGE_SEC + 5) });
  ok(verifyInitData(edge, TOKEN, { now: NOW }).ok === true, 'درست داخلِ پنجره پذیرفته می‌شود');
  ok(verifyInitData(old, TOKEN, { now: NOW, maxAgeSec: 0 }).ok === true,
    'maxAgeSec=0 یعنی بدونِ سقفِ سنی (برای تستِ دستی)');
  const noDate = new URLSearchParams(signInitData({ query_id: 'x', user: JSON.stringify(USER) }));
  ok(verifyInitData(noDate.toString(), TOKEN, { now: NOW }).reason === 'bad_auth_date',
    'نبودِ auth_date رد می‌شود');
}

/* ══ ۴) ورودیِ بدشکل هرگز نباید throw کند ══════════════════════════════════
 * این یک مسیرِ عمومیِ اینترنتی است؛ یک ۵۰۰ روی ورودیِ زباله یعنی ابزارِ اسکنِ رایگان. */
for (const bad of [null, undefined, '', 123, {}, [], 'not-a-query-string', '%%%%', 'hash=', 'a=1&a=2']) {
  let threw = false, res;
  try { res = verifyInitData(bad, TOKEN, { now: NOW }); } catch { threw = true; }
  ok(!threw && res && res.ok === false, `ورودیِ بدشکل بدونِ throw رد می‌شود: ${JSON.stringify(bad)}`);
}
ok(verifyInitData(signInitData(baseFields()), '', { now: NOW }).reason === 'no_token',
  'توکنِ خالی یعنی رد، نه پذیرشِ سهوی');

/* ══ ۵) `signature` نباید وارد checkString شود ═════════════════════════════
 * تلگرام امضای شخصِ ثالث را در همین رشته می‌گذارد ولی خودش امضایش نمی‌کند. */
{
  const good = signInitData(baseFields());
  const withSig = new URLSearchParams(good);
  withSig.set('signature', 'abc_third_party_signature');
  ok(verifyInitData(withSig.toString(), TOKEN, { now: NOW }).ok === true,
    'فیلدِ signature امضا را نمی‌شکند (از checkString بیرون است)');
}

/* ══ ۶) مقدارها باید decode شده امضا شوند ═════════════════════════════════
 * ساختنِ checkString از رشته‌ی خام رایج‌ترین باگِ این الگوریتم است: با نامِ ساده
 * هر دو راه یک جواب می‌دهند و باگ تا رسیدنِ اولین کاربرِ با فاصله/ایموجی پنهان می‌ماند. */
{
  const tricky = { id: 5, first_name: 'Мария Ивановна', username: 'a b', language_code: 'ru' };
  const r = verifyInitData(signInitData({ ...baseFields(), user: JSON.stringify(tricky) }), TOKEN, { now: NOW });
  ok(r.ok === true, 'نامِ حاویِ فاصله و حروفِ غیرلاتین امضا را نمی‌شکند');
  ok(r.user?.first_name === 'Мария Ивановна', 'مقدار درست decode می‌شود');
}

/* ══ ۷) آزمونِ پاسخِ معلوم — قفلِ رفتار در برابرِ ریفکتور ═══════════════════
 * اگر روزی کسی الگوریتم را «تمیز» کند و ترتیب یا کلید عوض شود، این عدد می‌شکند. */
{
  const fixed = { auth_date: '1760000000', query_id: 'AAHfixed', user: '{"id":1,"first_name":"T"}' };
  const KNOWN = createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest())
    .update(`auth_date=1760000000\nquery_id=AAHfixed\nuser={"id":1,"first_name":"T"}`).digest('hex');
  const sp = new URLSearchParams({ ...fixed, hash: KNOWN });
  ok(verifyInitData(sp.toString(), TOKEN, { now: 1760000100 }).ok === true,
    'رشته‌ی چک دقیقاً «کلید=مقدار» مرتب‌شده با \\n است');
}

/* ══ ۸) قواعدِ shared/ (بند ۶) ════════════════════════════════════════════ */
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('shared/initdata.js', 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  ok(imports.every(i => i.startsWith('node:') || i.startsWith('.')),
    `فقط built-in و نسبی import می‌شود (${imports.join(', ') || 'هیچ'})`);
  ok(/timingSafeEqual/.test(src), 'مقایسه زمان‌ثابت است، نه === روی رشته');
  ok(!/—|--/.test(src.replace(/-->/g, '')), 'بدونِ خط تیره‌ی بلند (بند ۱۰ ریشه)');
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} ادعا، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
