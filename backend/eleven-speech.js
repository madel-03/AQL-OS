export const DEFAULT_ARABIC_VOICE = 'XgwA88S7GusfDYlhZ3jt';
export function createElevenSpeech({ config = process.env, fetcher = fetch } = {}) {
  const cache = new Map();
  return async (text, signal) => {
    const key = String(config.ELEVENLABS_API_KEY || '').trim();
    if (!key) throw new Error('أضف ELEVENLABS_API_KEY في Render لتفعيل الصوت المختار.');
    const voice = String(config.ELEVENLABS_VOICE_ID || DEFAULT_ARABIC_VOICE).trim();
    if (!/^[a-zA-Z0-9]{10,80}$/.test(voice)) throw new Error('راجع ELEVENLABS_VOICE_ID في Render.');
    const model = config.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
    const value = JSON.stringify([voice, model, text]); if (cache.has(value)) return cache.get(value);
    const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, language_code: 'ar', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.03, use_speaker_boost: true } }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
    });
    if (!response.ok) throw new Error(response.status === 402 ? 'الصوت المختار يحتاج خطة مدفوعة أو رصيد ElevenLabs.' : response.status === 401 || response.status === 403 ? 'راجع مفتاح ElevenLabs وصلاحية تحويل النص إلى صوت والوصول للصوت.' : response.status === 429 ? 'وصلت خدمة ElevenLabs إلى حد الطلبات أو الرصيد؛ جرّب لاحقًا.' : 'تعذّر توليد الصوت من ElevenLabs. تأكد من إضافة الصوت إلى حسابك.');
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('خدمة الصوت لم تُرجع ملفًا صوتيًا.');
    const audio = Buffer.from(await response.arrayBuffer()); if (!audio.length || audio.length > 8 * 1024 * 1024) throw new Error('الصوت المستلم فارغ أو كبير جدًا.');
    cache.set(value, audio); if (cache.size > 24) cache.delete(cache.keys().next().value); return audio;
  };
}
