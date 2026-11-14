import { useLang } from '../lib/lang';
import { describeTaskPlan } from '../lib/voice-task';
export default function VoiceTaskCard({ actions, name }) {
  const { lang } = useLang(); const en = lang === 'en';
  if (!actions.plan && !actions.question && !actions.error && !actions.result && !actions.busy) return null;
  return <section className="voice-calendar-card" aria-label={en ? 'Task action' : 'تنفيذ مهمة'}><strong>{en ? 'Task action' : 'تنفيذ مهمة'}</strong>
    {actions.busy && <p role="status">{en ? 'Working…' : 'جارٍ التنفيذ…'}</p>}
    {actions.question && <p>{actions.question}</p>}
    {actions.plan && <><p>{actions.uncertain ? (en ? `Previous save is uncertain. Review your tasks or confirm the same request again: ${actions.plan.task.title}.` : `الحفظ السابق غير مؤكد. راجع مهامك أو أكّد نفس الطلب مرة ثانية: ${actions.plan.task.title}.`) : describeTaskPlan(actions.plan, en, name)}</p><button className="voice-main-toggle" disabled={actions.busy} onClick={() => actions.confirm()}>{en ? 'Confirm task' : 'أكّد المهمة'}</button></>}
    {actions.error && <p role="alert">{actions.error}</p>}{actions.result && <p role="status">{actions.result}</p>}
    {(actions.pending || actions.uncertain) && <button className="voice-settings-link" disabled={actions.busy} onClick={actions.cancel}>{en ? 'Cancel request / retry' : 'إلغاء الطلب / إعادة المحاولة'}</button>}
  </section>;
}
