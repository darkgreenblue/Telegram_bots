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

CURRENCY RULE (the most important rule here, read it twice):
Iranian bank receipts print RIAL. The invoice we showed the user is in TOMAN. 1 Toman = 10 Rial.
**Never convert anything yourself.** Report only what is printed:
- extracted.amount_raw = the amount EXACTLY as printed on the receipt (plain digits, no separators, NO conversion)
- extracted.amount_currency = "rial" if the receipt shows ریال/IRR, "toman" if it shows تومان/تومن, null if no unit is printed or you cannot read it
The server does the Rial↔Toman arithmetic and re-checks your verdict. If you convert, you will be wrong.
The exact mistake to avoid: a receipt printed «۱۰۰,۰۰۰ ریال» is only 10,000 Toman. Correct output is amount_raw=100000 with amount_currency="rial". Calling it 100,000 Toman would approve a payment that is TEN TIMES too small.

DECISION RULES (in order). Compare paid vs expected in the SAME unit, using amount_rial when the receipt is in Rial:
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

// resolvePaidToman: عددِ چاپ‌شده‌ی رسید → مبلغِ واقعی به **تومان**.
// basis می‌گوید این عدد از کجا آمد: واحدِ صریحِ رسید، استنتاج، یا اصلاً معلوم نیست.
// وقتی واحد چاپ نشده و عدد آن‌قدر بزرگ نیست که قطعاً ریال باشد → `ambiguous`، چون هر دو
// حدس خطرناک است: حدسِ «تومان» ما را سرِ ۹۰٪ پول می‌گذارد، و حدسِ «ریال» اعتبارِ کاربری
// را که درست پرداخت کرده یک‌دهم می‌کند. مبهم یعنی تصمیمِ انسانی، نه قرعه‌کشی.
function resolvePaidToman(ext, expectedToman) {
  const printed = Number(ext.amount_raw);
  const legacy = Number(ext.amount_toman); // پاسخِ قدیمیِ مدل (قبل از amount_raw)
  const raw = (Number.isFinite(printed) && printed > 0) ? printed
            : ((Number.isFinite(legacy) && legacy > 0) ? legacy : null);
  if (raw === null) return { raw: null, toman: null, basis: 'none' };
  const cur = String(ext.amount_currency ?? '').trim().toLowerCase();
  if (RIAL_WORDS.has(cur)) return { raw, toman: Math.floor(raw / 10), basis: 'rial' };
  if (TOMAN_WORDS.has(cur)) return { raw, toman: raw, basis: 'toman' };
  const exp = Number(expectedToman) || 0;
  // واحد چاپ نشده ولی عدد ≥ ده‌برابرِ فاکتور است: در هر دو خوانش کافی است، پس بی‌خطر
  if (exp > 0 && raw >= exp * 10) return { raw, toman: Math.floor(raw / 10), basis: 'rial_inferred' };
  return { raw, toman: null, basis: 'ambiguous' };
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
  // واحدِ مبلغ مبهم است → هیچ تصمیمِ خودکاری (نه تأیید، نه رد، نه اصلاحِ فاکتور)
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
  // voice2text عمداً اکشنِ «underpaid» ندارد: مسیرِ اصلاحِ فاکتور فقط در tarot پیاده شده و
  // این ربات زنده‌ی درآمدزا تغییرِ رفتاریِ خارج از دامنه نمی‌گیرد (بند ۶ ریشه). پرداختِ کمتر
  // مثل قبل رد می‌شود؛ فقط از این به بعد «کمتر» درست حساب می‌شود، نه با واحدِ اشتباه.
  return out(v, { paid: hasPaid ? paid : null, overpaid, basis });
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
