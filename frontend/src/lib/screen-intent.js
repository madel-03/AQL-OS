import { normalizeVoice } from './wake-listener.js';

export function screenIntent(text) {
  const show = /^(?:ورني|وريني|ارني|show me)(?: (?:الشاش[ةه]|شاش[ةه] الكمبيوتر|النتيج[ةه]|the screen|the result))?$/u;
  if (show.test(normalizeVoice(text))) return { standalone: true };
  // Split only the trailing visual request. Keep the original app/file name.
  for (const suffix of text.matchAll(/[\s،,]+(?:و\s*|ثم\s+|بعدين\s+|and\s+)/giu)) {
    if (!show.test(normalizeVoice(text.slice(suffix.index + suffix[0].length)))) continue;
    const action = text.slice(0, suffix.index).trim();
    if (action) return { action };
  }
  return null;
}
