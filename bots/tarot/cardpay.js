// ماژولِ ایجنتِ رسیدِ کارت‌به‌کارت (Node) — Gemini Flash از طریق OpenRouter.
// دوقلوی نودیِ bots/tabir-khab/cardpay/agent.py (همان قرارداد). کپیِ محلی در هر ربات
// نگه داشته می‌شود تا دیپلوی ایزوله بماند و voice2text خودکفا (بدون shared/).
//
// خروجی: { verdict: approve|reject|review, reason_code, reason_fa, extracted, risk_flags }
// fail-safe: هر خطا → review (هرگز auto approve/reject در خطا).
//
// ⚠️ رسید اثباتِ پرداخت نیست (قابل جعل) — این ایجنت فیلترِ تقلب/ریسک است، نه مرجعِ قطعی.
// سیگنالِ قطعیِ «پول نشست» (پارسِ پیامک) فازِ بعد است — bots/tabir-khab/cardpay/RESEARCH.md.

const VERDICTS = ['approve', 'reject', 'review'];

function systemPrompt(expected) {
  const toman = Number(expected.amount_toman || 0).toLocaleString('en-US');
  const rial = Number(expected.amount_rial || (expected.amount_toman || 0) * 10).toLocaleString('en-US');
  return `You are a strict Iranian bank card-to-card (کارت به کارت) receipt verifier for a paid bot.

You are given (a) a payment receipt — an IMAGE (screenshot/photo of a bank app, ATM slip, USSD, or internet-banking receipt) or plain TEXT the user typed as their receipt — and (b) the EXPECTED payment details. Decide APPROVE, REJECT, or human REVIEW.

Iranian receipts usually contain (recognize in Persian): مبلغ (amount, almost always in ریال), کد رهگیری/پیگیری (tracking code), شماره مرجع/RRN, تاریخ و ساعت, شماره کارت مقصد (masked, last 4 visible), وضعیت: موفق (successful), and sometimes نام گیرنده (recipient name) and شماره کارت مبدأ.

EXPECTED:
- amount_toman: ${toman}
- amount_rial: ${rial}   ← a CORRECT receipt shows THIS number (one more zero than the Toman figure)
- recipient_name: ${expected.recipient || '(unknown)'}
- dest_card_last4: ${expected.dest_last4 || '(unknown)'}

AMOUNT RULE (the most important rule here, read it twice):
**Iranian bank receipts print RIAL, without exception.** So the ONE number that matters is: does the receipt show **${rial}** (or more)? That is ${toman} Toman written in Rial, i.e. exactly one more zero.
Do not reason about units and do not convert anything. Just read the digits:
- extracted.amount_raw = the amount EXACTLY as printed on the receipt (plain digits, no separators, NO conversion, NO added or removed zeros)
- extracted.amount_currency = "rial" if the receipt shows ریال/IRR, "toman" if it shows تومان/تومن, null if no unit is printed or you cannot read it. This is only recorded; the server does NOT use it for the arithmetic.
**Count the zeros carefully — that is the whole job.** ${rial} and ${toman} look alike at a glance and differ by one zero, and confusing them means the user paid one tenth.
The exact mistake to avoid: a receipt printed «${toman}» is only one tenth of what we are owed, no matter which unit word appears next to it. Report amount_raw=${String(expected.amount_toman || 0)} and let the server reject it. Do not "helpfully" read it as Toman to make it match.

DECISION RULES (in order). Compare the printed amount against amount_rial (${rial}):
1. If the input is NOT a payment receipt at all (random text, unrelated photo, a sentence, a greeting) → verdict "reject", reason_code "not_a_receipt".
2. If it IS a receipt and you can read the amount and the PAID amount is STRICTLY LESS than expected → verdict "reject", reason_code "amount_too_low".
3. If it IS a genuine-looking SUCCESSFUL receipt AND paid >= expected AND (recipient_name matches OR dest_card_last4 matches) AND no strong forgery signal → verdict "approve", reason_code "ok".
4. Otherwise (receipt but unreadable/low quality, amount ambiguous, missing key fields, status not clearly successful, recipient/last4 mismatch but still plausibly real, or unsure for ANY reason) → verdict "review", reason_code one of "low_quality","missing_fields","mismatch","uncertain".

CRITICAL AMOUNT RULE: paying MORE than expected is ALWAYS acceptable. When paid >= expected you must NEVER use "amount_too_low" and must NOT reject for the amount, EVER. "amount_too_low" is ONLY for paid < expected. Overpayment → approve (rule 3).

Notes: a round amount (exact multiple of 100,000) is a mild fraud signal, note in risk_flags, not a reason alone to reject. When in doubt choose "review", never "approve".

Return ONLY a JSON object, no markdown, EXACTLY these keys:
{"verdict":"approve|reject|review","reason_code":"ok|not_a_receipt|amount_too_low|low_quality|missing_fields|mismatch|uncertain","reason_fa":"<one short Persian sentence, no em dash>","extracted":{"amount_raw":<number|null>,"amount_currency":"rial|toman|null","recipient_name":"<string|null>","dest_card_last4":"<string|null>","tracking_code":"<string|null>","status_successful":<true|false|null>},"risk_flags":["<tags: round_amount, name_mismatch, last4_mismatch, no_recipient, edited_look>"]}`;
}

function normalize(data) {
  let v = String(data.verdict || '').trim().toLowerCase();
  if (!VERDICTS.includes(v)) v = 'review';
  const ext = (data.extracted && typeof data.extracted === 'object') ? data.extracted : {};
  const flags = Array.isArray(data.risk_flags) ? data.risk_flags.map(String).slice(0, 8) : [];
  return {
    verdict: v,
    reason_code: String(data.reason_code || 'uncertain').trim() || 'uncertain',
    reason_fa: String(data.reason_fa || '').trim(),
    extracted: ext,
    risk_flags: flags,
  };
}

function parse(raw) {
  let s = (raw || '').trim();
  if (s.startsWith('```')) { s = s.replace(/^```(json)?/i, '').replace(/```$/,'').trim(); }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1 && b > a) s = s.slice(a, b + 1);
  return normalize(JSON.parse(s));
}

// ── واحدِ پول: چرا حساب‌وکتابش این‌جاست و نه در مدل ───────────────────────────
// رسیدِ بانکیِ ایرانی تقریباً همیشه **ریال** چاپ می‌کند، ولی فاکتوری که ما به کاربر نشان
// می‌دهیم **تومان** است (چون همه به تومان می‌نویسند). یعنی رسیدِ درست همیشه یک صفر
// بیشتر از فاکتور دارد.
//
// باگِ واقعی (۱۴۰۵/۰۵/۱۲، tarot زنده): تبدیلِ ریال→تومان به عهده‌ی خودِ مدل بود
// (`extracted.amount_toman`). کاربری هر سه پرداختش را یک صفر کمتر واریز کرد (۱۰۰k و
// ۵۰k و ۳۰k)، مدل عددِ چاپ‌شده‌ی رسید را همان‌طور به‌عنوانِ «تومان» برگرداند، و چون
// paid == expected شد ربات **هر سه را خودکار تأیید کرد**: یک‌دهمِ پول رسید و اعتبارِ
// کامل داده شد. هیچ گاردی نگرفتش چون گاردِ قبلی فقط جهتِ «کمتر از انتظار» را می‌دید.
//
// درس: تبدیلِ واحد یک عملِ حسابیِ قطعی است و هرگز نباید به مدلِ احتمالاتی سپرده شود.
// از حالا مدل فقط **می‌خواند** (`amount_raw` عددِ چاپ‌شده + `amount_currency` واحدِ
// چاپ‌شده) و **کد** حساب می‌کند.
const RIAL_WORDS = new Set(['rial', 'rials', 'irr', 'ریال']);
const TOMAN_WORDS = new Set(['toman', 'tomans', 'tuman', 'tumans', 'irt', 'تومان', 'تومن']);

// ── قاعده‌ی «همه‌چیز ریال است» (تصمیمِ صریحِ مالک، ۱۴۰۵/۰۶/۰۴) ─────────────────
// نسخه‌ی قبلی واحد را از خودِ مدل می‌گرفت و اگر مدل می‌گفت «تومان»، عددِ چاپ‌شده را
// همان‌طور تومان حساب می‌کرد. دقیقاً همین یک خط سوراخِ باگِ دوم بود: کاربری برای بسته‌ی
// جادویی (۱۵۰٬۰۰۰ تومان) مبلغِ ۱۵۰٬۰۰۰ **ریال** (=۱۵٬۰۰۰ تومان) واریز کرد، مدل عددِ
// چاپ‌شده را «تومان» برچسب زد، `paid == expected` شد و ربات **خودکار تأیید کرد**.
// گاردِ `amount_unit_suspect` هم نگرفتش، چون آن گارد شرطِ `paid < exp` دارد و در این
// خوانش paid دقیقاً برابرِ exp شده بود.
//
// درمان همان چیزی است که مالک گفت و از قضا ساده‌ترین هم هست: **رسیدِ بانکیِ ایرانی
// بلااستثنا ریال چاپ می‌کند**، پس عددِ چاپ‌شده همیشه ریال خوانده می‌شود و برچسبِ واحدِ
// مدل فقط **ثبت** می‌شود، نه اینکه در حساب دخالت کند. یعنی حساب‌وکتاب دیگر هیچ ورودیِ
// احتمالاتی ندارد: یک تقسیم بر ۱۰، تمام.
//
// ⚠️ حالتِ «رسید واقعاً تومانی» به **رد** نمی‌رسد: عددِ چاپ‌شده‌ای که دقیقاً برابرِ
// فاکتورِ تومانی است در گاردِ `amount_unit_suspect` می‌افتد و به **تصمیمِ انسانی** می‌رود.
// پس نه پرداختِ یک‌دهمی خودکار تأیید می‌شود، نه پرداختِ درست خودکار رد.
//
// ⚠️ این قاعده عمداً **فقط در tarot** است. voice2text ربات زنده‌ی دیگری با قیمت‌های خودش
// است و مالک درباره‌اش تصمیمی نگرفته (بند ۶ ریشه: تغییرش فقط با تصمیمِ صریح). واگراییِ
// عمدیِ دو کپی در `tools/check-receipt-amount.mjs` قفل شده تا سهوی نماند.
const RIAL_PER_TOMAN = 10;

// resolvePaidToman: عددِ چاپ‌شده‌ی رسید → مبلغِ واقعی به **تومان**. یک تقسیم، بس.
// `basis` فقط می‌گوید واحد روی رسید صریح بود (`rial`) یا نه (`rial_assumed`)؛ روی خودِ
// حساب اثری ندارد و برای لاگ و پیامِ ادمین نگه داشته می‌شود.
// آرگومانِ دومِ `expectedToman` دیگر در حساب نقشی ندارد ولی در امضا مانده، چون این تابع
// export شده و هر دو کپیِ دیگرِ ایجنت با همان امضا صدایش می‌زنند.
function resolvePaidToman(ext, _expectedToman) {
  const printed = Number(ext.amount_raw);
  const legacy = Number(ext.amount_toman); // پاسخِ قدیمیِ مدل (قبل از amount_raw)
  const raw = (Number.isFinite(printed) && printed > 0) ? printed
            : ((Number.isFinite(legacy) && legacy > 0) ? legacy : null);
  if (raw === null) return { raw: null, toman: null, basis: 'none' };
  const cur = String(ext.amount_currency ?? '').trim().toLowerCase();
  const explicitRial = RIAL_WORDS.has(cur);
  // ⚠️ TOMAN_WORDS عمداً دیگر مسیرِ حساب ندارد؛ فقط برای لاگ نگه داشته شده تا در پیامِ
  // ادمین بشود گفت «مدل واحد را تومان خوانده بود». اگر روزی حذفش کردی، `basis` هم
  // معنیِ تشخیصی‌اش را از دست می‌دهد.
  const labeledToman = TOMAN_WORDS.has(cur);
  return {
    raw,
    toman: Math.floor(raw / RIAL_PER_TOMAN),
    basis: explicitRial ? 'rial' : (labeledToman ? 'rial_assumed_toman_label' : 'rial_assumed'),
  };
}

// decideReceipt: خروجیِ خامِ ایجنت را به یک «تصمیمِ قطعی» تبدیل می‌کند و گاردِ مبلغ می‌زند.
// مبلغ را **کد** داوری می‌کند نه مدل، و در **هر دو جهت**: تأییدِ اشتباهِ مدل هم اصلاح
// می‌شود، نه فقط ردِ اشتباهش (همان چیزی که نبودنش باگِ بالا را ساخت).
// overpaid = مبلغِ پرداختی وقتی به‌قدرِ محسوس (≥۱۰٪) بیشتر است، تا میزبان به ادمین اطلاع دهد.
// خروجی: { action: approve|reject|underpaid|review|not_a_receipt, reason_fa, reason_code, paid, overpaid, basis }
function decideReceipt(verdict, expectedToman) {
  const ext = verdict.extracted || {};
  const exp = Number(expectedToman) || 0;
  const rc = verdict.reason_code || '';
  const out = (action, extra = {}) => ({
    action, reason_fa: verdict.reason_fa || '', reason_code: rc,
    paid: null, overpaid: 0, basis: 'none', ...extra,
  });
  // «اصلاً رسید نیست» ربطی به مبلغ ندارد، پس اول بررسی می‌شود
  if (verdict.verdict === 'reject' && rc === 'not_a_receipt') return out('not_a_receipt');

  const { raw, toman: paid, basis } = resolvePaidToman(ext, exp);
  const hasPaid = Number.isFinite(paid) && paid > 0;
  // ⚠️ حالتِ `ambiguous` دیگر تولید نمی‌شود (از ۱۴۰۵/۰۶/۰۴ عدد همیشه ریال خوانده می‌شود).
  // خودِ شرط عمداً مانده چون یک گاردِ ارزان روی مقدارِ غیرمنتظره است: اگر روزی
  // `resolvePaidToman` دوباره حالتِ مبهم برگرداند، مسیر به تصمیمِ انسانی می‌رود نه به
  // یک تأییدِ ناخواسته.
  if (basis === 'ambiguous') return out('review', { reason_code: 'amount_ambiguous', basis });

  let v = verdict.verdict;
  if (hasPaid && exp > 0) {
    // مدل اشتباه رد کرده در حالی که پول کافی رسیده → تأیید (پرداختِ بیشتر همیشه قبول است)
    if (paid >= exp && v === 'reject' && rc === 'amount_too_low') v = 'approve';
    // مدل اشتباه تأیید کرده در حالی که پول کافی نرسیده → رد (گاردِ باگِ ریال)
    if (paid < exp && v === 'approve') v = 'reject';
  }

  // اختلافی که دقیقاً امضای «اشتباهِ واحد» است: عددِ چاپ‌شده **برابرِ خودِ فاکتور** است.
  // یعنی یا کاربر مبلغِ تومانی را در اپِ ریالی زده (پس یک‌دهم پرداخت کرده)، یا رسید واقعاً
  // تومانی است و پرداخت درست بوده. این دو را نمی‌شود از روی عدد تفکیک کرد و اصلاحِ خودکارِ
  // فاکتور در حالتِ دوم یعنی یک‌دهم کردنِ اعتبارِ کاربری که درست پرداخت کرده → تصمیمِ انسانی.
  if (hasPaid && exp > 0 && paid < exp && raw === exp) {
    return out('review', { reason_code: 'amount_unit_suspect', paid, basis });
  }

  const overpaid = (v === 'approve' && hasPaid && exp > 0 && paid >= exp * 1.1) ? paid : 0;
  // «کمتر پرداخت شده» یک نتیجه‌ی جداست، نه رد: رسید واقعی است و پول واقعاً رسیده، فقط کمتر
  // از فاکتور. تصمیمِ اینکه با آن چه کنیم بالادست گرفته می‌شود (index.js)، نه این‌جا.
  const underpaid = (v === 'reject' && hasPaid && exp > 0 && paid < exp
                     && (rc === 'amount_too_low' || rc === 'ok'));
  return out(underpaid ? 'underpaid' : v, { paid: hasPaid ? paid : null, overpaid, basis });
}

// analyzeReceipt: یکی از imageBuffer یا text را بده.
// deps: fetchImpl (پیش‌فرض global fetch) تا قابلِ‌تست باشد.
async function analyzeReceipt({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', model,
                               expected = {}, imageBuffer = null, imageMime = 'image/jpeg',
                               text = null, timeoutMs = 60000, fetchImpl = null }) {
  const doFetch = fetchImpl || fetch;
  let userContent;
  if (imageBuffer) {
    const b64 = Buffer.from(imageBuffer).toString('base64');
    userContent = [
      { type: 'text', text: 'این رسیدِ پرداخت را طبق قرارداد داوری کن و فقط JSON بده.' },
      { type: 'image_url', image_url: { url: `data:${imageMime};base64,${b64}` } },
    ];
  } else {
    userContent = 'کاربر این متن را به‌عنوانِ رسیدِ پرداخت فرستاده. طبق قرارداد داوری کن و فقط JSON بده.\n\nمتنِ کاربر:\n'
      + String(text || '').slice(0, 4000);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt(expected) },
          { role: 'user', content: userContent },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    return parse(raw);
  } catch (e) {
    // هرگز در خطا auto approve/reject نکن — به انسان بسپار.
    return normalize({ verdict: 'review', reason_code: 'uncertain',
      reason_fa: 'بررسیِ خودکارِ رسید ممکن نشد؛ به ادمین ارجاع شد.', risk_flags: ['agent_error'] });
  } finally {
    clearTimeout(timer);
  }
}

export { analyzeReceipt, decideReceipt, resolvePaidToman, VERDICTS };
