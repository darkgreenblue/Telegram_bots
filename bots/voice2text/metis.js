// تبدیلِ محدودِ قرارداد داخلی voice2text به Gemini REST wrapper متیس.
export function metisModelId(openRouterModel) {
  const model = String(openRouterModel || '');
  if (!/^google\/gemini-[a-z0-9.-]+$/i.test(model)) throw new Error(`METIS_UNSUPPORTED_MODEL:${model || 'empty'}`);
  return model.slice('google/'.length);
}
export function buildMetisRequest(audioBuffer, mimeType, prompt) {
  return { contents: [{ role: 'user', parts: [
    { text: String(prompt) },
    { inlineData: { mimeType: String(mimeType || 'audio/ogg'), data: Buffer.from(audioBuffer).toString('base64') } },
  ] }], generationConfig: {} };
}
export function readMetisText(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((part) => part?.text || '').join('').trim() : '';
  if (!text) throw new Error('METIS_EMPTY_RESPONSE');
  return text;
}
