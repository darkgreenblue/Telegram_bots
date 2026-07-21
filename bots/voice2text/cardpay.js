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

Iranian receipts usually contain (recognize in Persian): مبلغ (amount, often ریال = Toman×10), کد رهگیری/پیگیری (tracking code), شماره مرجع/RRN, تاریخ و ساعت, شماره کارت مقصد (masked, last 4 visible), وضعیت: موفق (successful), and sometimes نام گیرنده (recipient name) and شماره کارت مبدأ.

EXPECTED:
- amount_toman: ${toman}  (equivalently amount_rial: ${rial}; receipts often show Rial = Toman × 10)
- recipient_name: ${expected.recipient || '(unknown)'}
- dest_card_last4: ${expected.dest_last4 || '(unknown)'}

DECISION RULES (in order):
1. If the input is NOT a payment receipt at all (random text, unrelated photo, a sentence, a greeting) → verdict "reject", reason_code "not_a_receipt".
2. If it IS a receipt and you can read the amount and the PAID amount is clearly LESS than the expected amount → verdict "reject", reason_code "amount_too_low".
3. If it IS a genuine-looking SUCCESSFUL receipt AND paid amount ≥ expected AND (recipient_name matches OR dest_card_last4 matches) AND no strong forgery signal → verdict "approve", reason_code "ok".
4. Otherwise (receipt but unreadable/low quality, amount ambiguous, missing key fields, status not clearly successful, recipient/last4 mismatch but still plausibly real, or unsure for ANY reason) → verdict "review", reason_code one of "low_quality","missing_fields","mismatch","uncertain".

Notes: paying MORE is fine (approve on amount). A round amount (exact multiple of 100,000) is a mild fraud signal, note in risk_flags, not a reason alone to reject. When in doubt choose "review", never "approve". Normalize Rial/Toman (1 Toman = 10 Rial).

Return ONLY a JSON object, no markdown, EXACTLY these keys:
{"verdict":"approve|reject|review","reason_code":"ok|not_a_receipt|amount_too_low|low_quality|missing_fields|mismatch|uncertain","reason_fa":"<one short Persian sentence, no em dash>","extracted":{"amount_toman":<number|null>,"recipient_name":"<string|null>","dest_card_last4":"<string|null>","tracking_code":"<string|null>","status_successful":<true|false|null>},"risk_flags":["<tags: round_amount, name_mismatch, last4_mismatch, no_recipient, edited_look>"]}`;
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

export { analyzeReceipt, VERDICTS };
