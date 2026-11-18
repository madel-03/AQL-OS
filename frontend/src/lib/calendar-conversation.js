import { voiceIntent } from './voice-commands.js';
import { describeCalendarPlan } from './voice-calendar.js';
import { normalizeVoice } from './wake-listener.js';
export function pendingCalendarReply(text, actions, en = false) {
  if (!actions.plan) return null;
  const value = normalizeVoice(text);
  if (/(?:كرر|اقرا|تفاصيل)|\b(?:repeat|read|details)\b/.test(value)) return describeCalendarPlan(actions.plan, en, 'جارفس');
  if (/(?:غير|عدل|بدل|خلي|اجعل|بعد|بكر|غدا|اليوم|الساع|دقيق|نص|نصف|ربع|صباح|مساء|[0-9٠-٩])|\b(?:change|instead|tomorrow|today|minutes?|hours?|am|pm)\b/.test(value)) return null;
  return en ? 'The appointment is ready for review. To save it, say “confirm appointment” or use the confirmation button. To change it, state the change explicitly.' : 'الموعد جاهز للمراجعة. لحفظه قل «أكّد الموعد» أو اضغط زر التأكيد. وإذا تبي تعديله، اذكر التغيير بوضوح.';
}
export async function calendarConversation(text, actions, en = false, signal) {
  const intent = voiceIntent(text, { calendarPending: actions.pending });
  if (intent.type === 'confirmation-unclear') return en ? 'Please say “confirm appointment” clearly, or use the confirmation button. Nothing has been saved.' : 'قل «أكّد الموعد» بوضوح أو استخدم زر التأكيد. ما حفظت شيئًا.';
  if (intent.type === 'calendar-confirm') return actions.confirm(signal);
  if (intent.type === 'calendar-cancel') {
    const uncertain = actions.uncertain; const pending = actions.pending;
    if (!actions.cancel()) return en ? 'A save is running. Please wait for its result.' : 'الحفظ جارٍ؛ انتظر نتيجته.';
    return uncertain ? (en ? 'Cancelled the retry. Check Google Calendar: the earlier save was uncertain. No event was deleted.' : 'ألغيت إعادة المحاولة. راجع تقويم Google لأن الحفظ السابق غير مؤكد. ما حذفت أي موعد.') : pending ? (en ? 'Cancelled the unsaved appointment request.' : 'ألغيت طلب الموعد غير المحفوظ.') : (en ? 'No appointment is awaiting confirmation.' : 'ما فيه موعد ينتظر التأكيد.');
  }
  if (intent.type !== 'calendar-prepare' && !(actions.pending && intent.type === 'chat')) return null;
  if (intent.type === 'chat') { const reply = pendingCalendarReply(text, actions, en); if (reply !== null) return reply; }
  const proposal = await actions.prepare(text, signal, { followUp: intent.type === 'chat' });
  if (proposal.kind === 'event') return `${describeCalendarPlan(proposal, en, 'جارفس')} ${en ? 'You can also type “confirm appointment” or use the confirmation button.' : 'تقدر أيضًا تكتب «أكّد الموعد» أو تستخدم زر التأكيد.'}`;
  return proposal.question || proposal.message || (en ? 'Please clarify the appointment.' : 'وضّح تفاصيل الموعد.');
}
