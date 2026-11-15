import { Router, raw } from 'express';
export function createSpeechRouter({ requireAuth, config = process.env, fetcher = fetch }) {
  const router = Router(); const key = String(config.GROQ_API_KEY || '').trim();
  router.post('/transcribe', requireAuth, raw({ type: ['audio/*', 'video/webm'], limit: '8mb' }), async (req, res) => {
    if (!key) return res.status(503).json({ error: 'تحويل التسجيل يحتاج GROQ_API_KEY في الخادم.' });
    const mime = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const ext = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }[mime];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'التسجيل فارغ أو صيغته غير مدعومة. جرّب مجددًا.' });
    const language = req.query.language === 'en' ? 'en' : 'ar';
    const body = new FormData(); body.set('file', new Blob([req.body], { type: mime }), `request.${ext}`); body.set('model', 'whisper-large-v3-turbo'); body.set('language', language); body.set('response_format', 'json'); body.set('temperature', '0');
    const controller = new AbortController(); const aborted = () => controller.abort(); req.on('aborted', aborted); res.on('close', aborted);
    try {
      const response = await fetcher('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: response.status === 429 ? 'خدمة تحويل الصوت مشغولة. جرّب بعد قليل.' : 'تعذّر تحويل التسجيل إلى نص. جرّب مجددًا أو اكتب الطلب.' });
      if (typeof value.text !== 'string' || !value.text.trim()) return res.status(422).json({ error: 'ما سمعت كلامًا واضحًا في التسجيل. أعد التسجيل قرب المايك.' });
      res.json({ text: value.text.trim().slice(0, 2000) });
    } catch { if (!res.destroyed) res.status(502).json({ error: 'انقطع الاتصال بخدمة تحويل الصوت. أعد المحاولة.' }); }
    finally { req.off('aborted', aborted); res.off('close', aborted); }
  });
  router.use((error, req, res, next) => { void next; res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'التسجيل كبير أو غير صالح. سجّل طلبًا أقصر من ٩٠ ثانية.' }); });
  return router;
}
