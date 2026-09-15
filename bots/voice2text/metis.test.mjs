import assert from 'node:assert/strict';
import { buildMetisRequest, metisModelId, readMetisText } from './metis.js';
assert.equal(metisModelId('google/gemini-2.5-flash'), 'gemini-2.5-flash');
assert.equal(metisModelId('google/gemini-2.5-pro'), 'gemini-2.5-pro');
assert.throws(() => metisModelId('openai/gpt-audio-mini'), /METIS_UNSUPPORTED_MODEL/);
assert.deepEqual(buildMetisRequest(Buffer.from('voice'), 'audio/ogg', 'transcribe exactly'), { contents: [{ role: 'user', parts: [{ text: 'transcribe exactly' }, { inlineData: { mimeType: 'audio/ogg', data: 'dm9pY2U=' } }] }], generationConfig: {} });
assert.equal(readMetisText({ candidates: [{ content: { parts: [{ text: 'سلام' }, { text: ' دنیا' }] } }] }), 'سلام دنیا');
assert.throws(() => readMetisText({ candidates: [] }), /METIS_EMPTY_RESPONSE/);
console.log('✅ Metis Gemini request contract is valid.');
