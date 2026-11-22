export async function localAnswer(messages, signal, json = false) {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3:0.6b', messages, stream: false, think: false, ...(json && { format: 'json' }) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
  });
  if (!response.ok) throw Error('model');
  const answer = (await response.json()).message?.content?.trim();
  if (!answer) throw Error('empty');
  return answer;
}

export function sharesTopic(a, b) {
  const tokens = value => value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu)?.map(t => t.replace(/^ال/, '')).filter(t => t.length >= 3 && !['with','the','for','محاضرة','موعد','اجتماع','meeting','lecture'].includes(t)) || [];
  const terms = new Set(tokens(a));
  return tokens(b).some(t => terms.has(t));
}

export function nearPlace(place, coords) {
  if (!place || !coords || coords.accuracy > 250) return false;
  const rad = degrees => degrees * Math.PI / 180;
  const h = Math.sin(rad(coords.latitude - place.lat) / 2) ** 2 + Math.cos(rad(place.lat)) * Math.cos(rad(coords.latitude)) * Math.sin(rad(coords.longitude - place.lon) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h))) <= 250;
}
