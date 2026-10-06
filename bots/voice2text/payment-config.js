// Private payment destination for the standalone voice bot.
function parsePrivateJson(raw, label) {
  if (!raw) throw new Error(`${label} is missing`);
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`${label} must be valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

export function loadSinglePaymentCard(raw) {
  const card = parsePrivateJson(raw, 'PAYMENT_CARD_JSON');
  if (typeof card.number !== 'string' || !/^\d{16}$/.test(card.number) || typeof card.owner !== 'string' || !card.owner.trim()
      || typeof card.recipient !== 'string' || !card.recipient.trim()
      || card.dest_last4 !== card.number.slice(-4))
    throw new Error('PAYMENT_CARD_JSON contains an invalid payment destination');
  return Object.freeze({ number: card.number, owner: card.owner,
    recipient: card.recipient, dest_last4: card.dest_last4 });
}
