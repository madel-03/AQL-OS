import { normalizeVoice } from './wake-listener.js';

export function screenIntent(text) {
  const command = normalizeVoice(text);
  const downloads = '(?:(?:قائمة|صفحة) )?(?:ال)?(?:تحديثات|تنزيلات|تحميلات)';
  const steam = '(?:ستيم|steam)';
  const showDownloads = new RegExp('^(?:(?:يا جارفس|ممكن|لو سمحت) )?(?:افتح ' + steam + ' (?:و ?|ثم ))?(?:وريني|ورني|ارني|اعرض) ' + downloads + '(?: (?:في |علي )?' + steam + ')?$');
  if ((showDownloads.test(command) && /ستيم|steam/.test(command)) || /^(?:open steam and show me (?:the )?(?:updates|downloads)|show me (?:the )?steam (?:updates|downloads))$/.test(command)) {
    // Keep the downloads destination when the visual request includes an object.
    return { action: text, steamView: 'downloads' };
  }
  const show = /^(?:و\s*)?(?:(?:ورني|وريني|ارني|show me)(?: (?:الشاش[ةه]|شاش[ةه] الكمبيوتر|النتيج[ةه]|the screen|the result))?|صور(?:لي| لي)? (?:الشاش[ةه]|شاش[ةه] الكمبيوتر)|take a screenshot)$/u;
  if (show.test(command)) return { standalone: true };
  // Split only the trailing visual request. Keep the original app/file name.
  for (const suffix of text.matchAll(/[\s،,]+(?:و\s*|ثم\s+|بعدين\s+|and\s+)/giu)) {
    if (!show.test(normalizeVoice(text.slice(suffix.index + suffix[0].length)))) continue;
    const action = text.slice(0, suffix.index).trim();
    if (action) {
      const preceding = screenIntent(action);
      return preceding?.steamView ? preceding : { action };
    }
  }
  return null;
}
