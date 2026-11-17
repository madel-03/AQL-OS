export function speechVoice(lang, explicit, storage = globalThis.localStorage) {
  const prefix = lang === 'ar' ? 'ar-' : 'en-';
  if (explicit?.startsWith(prefix)) return explicit;
  try {
    const saved = storage?.getItem(`aql-voice-${lang === 'ar' ? 'ar' : 'en'}`);
    if (saved?.startsWith(prefix)) return saved;
    const legacy = storage?.getItem('aql-voice');
    // Old automatic Hamed selection moves to Zariyah; explicit new selections remain respected.
    if (legacy?.startsWith(prefix) && legacy !== 'ar-SA-HamedNeural') return legacy;
  } catch { /* optional preference */ }
  return lang === 'ar' ? 'ar-SA-ZariyahNeural' : 'en-GB-RyanNeural';
}
