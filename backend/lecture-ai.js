import { setTimeout as delay } from 'node:timers/promises';
export function createLectureGemini({ config, request, onRetry = () => {}, sleep = (ms, signal) => delay(ms, undefined, { signal }) }) {
  const primary = config.LECTURE_GEMINI_MODEL || 'gemini-3.5-flash';
  const alternatives = [...new Set(String(config.LECTURE_GEMINI_FALLBACKS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map(x => x.trim()).filter(x => x && x !== primary))].slice(0, 2);
  const usedModels = new Set();
  const generate = async (parts, signal) => {
    const attempts = [primary, primary, ...alternatives]; let lastError; let calls = 0;
    for (let index = 0; index < attempts.length; index++) {
      signal.throwIfAborted();
      if (index) {
        onRetry({ attempt: calls + 1, model: attempts[index] });
        if (lastError?.providerStatus !== 404) await sleep(Math.min(1000 * 2 ** (index - 1), 4000), signal);
      }
      try {
        calls++;
        const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(attempts[index])}:generateContent`, { 'x-goog-api-key': config.GEMINI_API_KEY }, { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 16000 } }, signal);
        if (data.candidates?.[0]?.finishReason !== 'STOP') throw new Error('النتيجة غير مكتملة. قسّم المحاضرة إلى أجزاء أصغر.');
        const value = JSON.parse(data.candidates[0].content.parts.map(p => p.text || '').join('').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
        usedModels.add(attempts[index]); return value;
      } catch (error) {
        if (signal.aborted) throw error;
        const transient = [408,500,502,503,504].includes(error.providerStatus) || error instanceof TypeError || error.name === 'TimeoutError';
        if (!transient && error.providerStatus !== 404) throw error;
        lastError = error;
        // A missing model cannot recover by immediately calling it again.
        if (error.providerStatus === 404 && index === 0) index = 1;
      }
    }
    throw new Error(lastError?.providerStatus === 404 ? 'نماذج Gemini المحددة غير متاحة. راجع إعدادات نماذج المحاضرات في Render.' : 'خدمة Gemini غير متاحة مؤقتًا حتى بعد إعادة المحاولة وتجربة النماذج البديلة. أعد المحاولة لاحقًا؛ هذا الخطأ لا يعني أن ملفك كبير أو تالف.');
  };
  return { generate, usedModels };
}
