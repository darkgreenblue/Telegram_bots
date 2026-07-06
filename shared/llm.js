// فراخوانی OpenRouter — نسخه‌ی مشترکِ الگوی جاافتاده‌ی tarot (timeout + retry + مدل فالبک).
// قانون shared/: هیچ import از npm — فقط fetch سراسری Node 20.
//
// استفاده:
//   const or = createOpenRouter({ apiKey: OPENROUTER_API_KEY, defaultModel: FLASH, fallbackModel: DEEPSEEK });
//   const { out, model } = await or.chatResilient(system, user, { maxTokens: 800, validate: (t) => !!parseJsonLoose(t) });

import { log, logErr } from './logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createOpenRouter({ apiKey, defaultModel, fallbackModel = null, timeoutMs = 10 * 60 * 1000 }) {
  if (!apiKey) throw new Error('createOpenRouter: apiKey لازم است');

  async function request(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const errBody = await res.text();
        logErr(`❌ OpenRouter ${res.status} (${body.model}) after ${Date.now() - t0}ms:`, errBody.slice(0, 300));
        throw new Error(`OpenRouter error ${res.status}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim() || '';
      const u = data.usage || {};
      log(`✅ ${body.model} in ${Date.now() - t0}ms | tok(in/out)=${u.prompt_tokens ?? '?'}/${u.completion_tokens ?? '?'}`);
      return text;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function chat(system, user, opts = {}) {
    return request({
      model: opts.model || defaultModel,
      temperature: opts.temperature ?? 0.9,
      max_tokens: opts.maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
  }

  // فراخوانی مقاوم: چند تلاش با مدل اصلی، بعد مدل فالبک؛ validate اختیاری برای ردکردن خروجی خراب.
  async function chatResilient(system, user, opts = {}, plan = null) {
    plan = plan || (fallbackModel
      ? [defaultModel, defaultModel, defaultModel, fallbackModel, fallbackModel]
      : [defaultModel, defaultModel, defaultModel]);
    for (let i = 0; i < plan.length; i++) {
      try {
        const out = await chat(system, user, { ...opts, model: plan[i] });
        if (!opts.validate || opts.validate(out)) return { out, model: plan[i] };
        logErr(`LLM invalid output (attempt ${i + 1}, ${plan[i]})`);
      } catch (e) {
        logErr(`LLM error (attempt ${i + 1}, ${plan[i]}):`, e.message);
      }
      if (i < plan.length - 1) await sleep(1500);
    }
    return null;
  }

  // ویس→متن: بافر صوت به‌صورت base64 با content-part از نوع input_audio.
  function transcribe(audioBuffer, format, opts = {}) {
    return request({
      model: opts.model || defaultModel,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Transcribe this audio verbatim in the same language spoken. Output only the transcript, no commentary.' },
        { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format } },
      ] }],
    });
  }

  return { request, chat, chatResilient, transcribe };
}

// پارس مقاوم JSON از خروجی LLM: حذف code fence و برش از اولین { تا آخرین }.
export function parseJsonLoose(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch (e) { logErr('JSON parse failed:', e.message, '| head:', t.slice(0, 120)); return null; }
}
