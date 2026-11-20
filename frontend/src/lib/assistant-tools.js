import { requestDocument } from './assistant-documents.js';
import { normalizeVoice, wakeMatch } from './wake-listener.js';
import { companionCommand } from './companion';
import { screenIntent } from './screen-intent.js';

export function requestAssistantTool(text, en, signal) {
  const command = normalizeVoice(wakeMatch(text, 'جارفس') ?? text);
  const visual = screenIntent(text) || screenIntent(command);
  if (visual?.action && sessionStorage.getItem('aql-companion-mode')) {
    return companionCommand(visual.action, signal, true, visual.steamView);
  }
  if (visual?.action) return en ? 'Enable computer mode in Device services first.' : 'فعّل «وجّه المحادثة للكمبيوتر» من خدمات الجهاز أولًا.';
  const capture = /^(?:(?:يا عقل|عقل|ممكن|لو سمحت|طيب|please|can you|could you) )*(?:صور(?:لي)?|خذ(?:لي)?|خد(?:لي)?|التقط|لقط|ارسل|اعرض|وريني|ورني|ابي|ابغي|ابغا|جيب|take|capture|send|show|get|screenshot)(?: |$)/u;
  if (visual?.standalone || (capture.test(command) && /(?:شاش[ةه]|سكرين شوت|\bscreen(?:shot)?\b)/u.test(command))) {
    if (signal?.aborted) return null;
    window.dispatchEvent(new CustomEvent('aql-screen-compose', { detail: 'خذ لقطة من شاشة الكمبيوتر' }));
    return en ? 'Requesting a screenshot from your computer.' : 'أطلب لك لقطة من الكمبيوتر.';
  }
  return sessionStorage.getItem('aql-companion-mode')
    ? companionCommand(text, signal).then(reply => reply ?? requestDocument(text, en, signal))
    : requestDocument(text, en, signal);
}
