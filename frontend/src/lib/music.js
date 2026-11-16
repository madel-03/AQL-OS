import { normalizeVoice, wakeMatch } from './wake-listener.js';
export function spotifySearchUrl(query) {
  const text = String(query || '').trim().slice(0, 200);
  return text ? `https://open.spotify.com/search/${encodeURIComponent(text)}` : 'https://open.spotify.com/';
}
export function musicRequest(text) {
  const raw = String(text || '').trim();
  const matched = wakeMatch(raw, 'جارفس');
  const request = matched === null ? raw : matched;
  const value = normalizeVoice(request);
  const subject = /(?:اغني|اغان|موسيقي|موسيقى|قائمه|قائمة|سبوتيفاي|سبوتفاي)|\b(?:spotify|song|music|playlist|track)\b/.test(value);
  const action = /^(?:(?:ممكن|لو سمحت|please|can you)\s+)?(?:ابحث|دور|شغل|افتح|search|find|play|open)(?:\s|$)/.test(value);
  if (!subject || !action) return null;
  const query = request.replace(/^(?:(?:يا جارفس|ممكن|لو سمحت|please|can you)\s+)*/i, '').replace(/^(?:ابحث|دور|شغل|افتح|search|find|play|open)\s*/i, '').replace(/^(?:(?:لي|عن|على|عن أغنية|اغنية|أغنية|أغنيه|اغنيه|a|for|song|track)\s+)*/i, '').replace(/\s+(?:في|على|on)\s+(?:سبوتيفاي|سبوتفاي|spotify)$/i, '').trim();
  return { query: /^(?:سبوتيفاي|سبوتفاي|spotify)$/i.test(query) ? '' : query.slice(0, 200) };
}
export function openMusicRequest(text, en = false) {
  const request = musicRequest(text); if (!request) return null;
  window.dispatchEvent(new CustomEvent('aql-music-search', { detail: request }));
  return en ? 'Your Spotify search is ready. Tap Open in Spotify to view the results and choose what to play.' : 'جهزت بحث Spotify. اضغط «افتح في Spotify» وشغّل اللي يناسبك من النتائج.';
}
