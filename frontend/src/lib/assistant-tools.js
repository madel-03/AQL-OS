import { requestDocument } from './assistant-documents.js';
import { normalizeVoice, wakeMatch } from './wake-listener.js';
import { companionCommand } from './companion';

export function requestAssistantTool(text, en, signal) {
  const command = normalizeVoice(wakeMatch(text, 'جارفس') ?? text);
  const capture = /^(?:(?:يا عقل|عقل|ممكن|لو سمحت|طيب|please|can you|could you) )*(?:صور(?:لي)?|خذ(?:لي)?|خد(?:لي)?|التقط|لقط|ارسل|اعرض|وريني|ورني|ابي|ابغي|ابغا|جيب|take|capture|send|show|get|screenshot)(?: |$)/u;
  if (capture.test(command) && /(?:شاش[ةه]|سكرين شوت|\bscreen(?:shot)?\b)/u.test(command)) {
    if (signal?.aborted) return null;
    window.dispatchEvent(new CustomEvent('aql-screen-compose', { detail: text }));
    return en ? 'Press Send request. Approve the screenshot on your computer.' : 'اضغط «أرسل الطلب»، ثم وافق على اللقطة من الكمبيوتر.';
  }
  return sessionStorage.getItem('aql-companion-mode')
    ? companionCommand(text, signal).then(reply => reply ?? requestDocument(text, en, signal))
    : requestDocument(text, en, signal);
}
