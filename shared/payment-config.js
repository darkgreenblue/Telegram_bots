// Payment destinations are configuration, never source-code fallbacks.
function parsePrivateJson(raw, label) {
  if (!raw) throw new Error(`${label} is missing`);
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`${label} must be valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function validateCard(card) {
  if (!card || typeof card !== 'object' || typeof card.number !== 'string' || !/^\d{16}$/.test(card.number)
      || typeof card.holder !== 'string' || !card.holder.trim()
      || typeof card.bank !== 'string' || !card.bank.trim()
      || !['regular', 'white'].includes(card.kind)
      || !Number.isInteger(card.sort) || card.sort < 1)
    throw new Error('PAYMENT_CARDS_JSON contains an invalid card');
  return Object.freeze({ number: card.number, holder: card.holder, bank: card.bank,
    kind: card.kind, sort: card.sort });
}

export function loadTarotPaymentConfig(raw) {
  const config = parsePrivateJson(raw, 'PAYMENT_CARDS_JSON');
  const legacy = validateCard(config.legacy);
  if (!Array.isArray(config.seed1) || config.seed1.length !== 2
      || !Array.isArray(config.seed2) || config.seed2.length !== 2)
    throw new Error('PAYMENT_CARDS_JSON must contain both two-card migration seeds');
  const seed1 = Object.freeze(config.seed1.map(validateCard));
  const seed2 = Object.freeze(config.seed2.map(validateCard));
  if (seed1[0].number !== legacy.number || seed1[0].holder !== legacy.holder
      || seed1[0].bank !== legacy.bank || legacy.kind !== 'regular'
      || new Set([...seed1, ...seed2].map(c => c.number)).size !== 4
      || config.regularized_number !== seed1[1].number)
    throw new Error('PAYMENT_CARDS_JSON migration configuration is inconsistent');
  return Object.freeze({ legacy, seed1, seed2,
    regularized_number: config.regularized_number });
}

