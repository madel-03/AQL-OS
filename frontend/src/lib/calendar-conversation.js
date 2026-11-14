import { voiceIntent } from './voice-commands.js';
import { describeCalendarPlan } from './voice-calendar.js';
export async function calendarConversation(text, actions, en = false) {
  const intent = voiceIntent(text);
  if (intent.type === 'calendar-confirm') return actions.confirm();
  if (intent.type === 'calendar-cancel') {
    const uncertain = actions.uncertain; const pending = actions.pending;
    if (!actions.cancel()) return en ? 'A save is running. Please wait for its result.' : 'الحفظ جارٍ؛ انتظر نتيجته.';
    return uncertain ? (en ? 'Cancelled the retry. Check Google Calendar: the earlier save was uncertain. No event was deleted.' : 'ألغيت إعادة المحاولة. راجع تقويم Google لأن الحفظ السابق غير مؤكد. ما حذفت أي موعد.') : pending ? (en ? 'Cancelled the unsaved appointment request.' : 'ألغيت طلب الموعد غير المحفوظ.') : (en ? 'No appointment is awaiting confirmation.' : 'ما فيه موعد ينتظر التأكيد.');
  }
  if (intent.type !== 'calendar-prepare' && !(actions.pending && intent.type === 'chat')) return null;
  const proposal = await actions.prepare(text);
  if (proposal.kind === 'event') return `${describeCalendarPlan(proposal, en, 'جارفس')} ${en ? 'You can also type “confirm appointment” or use the confirmation button.' : 'تقدر أيضًا تكتب «أكّد الموعد» أو تستخدم زر التأكيد.'}`;
  return proposal.question || proposal.message || (en ? 'Please clarify the appointment.' : 'وضّح تفاصيل الموعد.');
}
