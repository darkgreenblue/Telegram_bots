import assert from 'node:assert/strict';
import { loadTarotPaymentConfig } from '../shared/payment-config.js';
import { loadSinglePaymentCard } from '../bots/voice2text/payment-config.js';
import { TEST_PAYMENT_CARDS } from './fixtures/payment-config.mjs';
const config = JSON.stringify(TEST_PAYMENT_CARDS);
assert.equal(loadTarotPaymentConfig(config).seed2.length, 2);
const single = { number: '0000000000001234', owner: 'Test owner', recipient: 'Test recipient', dest_last4: '1234' };
assert.equal(loadSinglePaymentCard(JSON.stringify(single)).number, single.number);
for (const raw of ['', '{private-input', 'null', '[]']) {
  for (const loader of [loadTarotPaymentConfig, loadSinglePaymentCard]) {
    assert.throws(() => loader(raw), error => !error.message.includes('private-input'));
  }
}
const invalid = structuredClone(TEST_PAYMENT_CARDS);
invalid.seed2[0].number = invalid.legacy.number;
assert.throws(() => loadTarotPaymentConfig(JSON.stringify(invalid)), /inconsistent/);
assert.throws(() => loadSinglePaymentCard(JSON.stringify({ ...single, dest_last4: '9999' })), /invalid/);
assert.throws(() => loadSinglePaymentCard(JSON.stringify({ ...single, number: 1234 })), /invalid/);
console.log('Private payment configuration: valid destinations accepted; missing, malformed and inconsistent data rejected without logging values.');
