import { useLang } from '../lib/lang';
export default function VoiceCalendarCard({ actions, name = 'جارفس' }) {
  const { lang } = useLang(); const en = lang === 'en';
  if (!actions.plan && !actions.question && !actions.error && !actions.result && !actions.busy) return null;
  const plan = actions.plan;
  const format = value => new Intl.DateTimeFormat(en ? 'en' : 'ar', { dateStyle: 'full', timeStyle: 'short', timeZone: plan.timeZone }).format(new Date(value));
  return <section className="voice-calendar-card" aria-label={en ? 'Appointment task' : 'مهمة إضافة موعد'}>
    <strong>{actions.result ? (en ? 'Appointment saved' : 'الموعد محفوظ') : (en ? 'Appointment task' : 'مهمة إضافة موعد')}</strong>
    {actions.busy && <p role="status">{en ? 'Working…' : 'جارٍ التنفيذ…'}</p>}{actions.question && <p>{actions.question}</p>}
    {plan && <><h3 dir="auto">{plan.event.title}</h3><p>{format(plan.event.start)}<br />{format(plan.event.end)}</p><small>{plan.timeZone} · {Math.round((Date.parse(plan.event.end) - Date.parse(plan.event.start)) / 60000)} {en ? 'minutes' : 'دقيقة'}</small>{plan.event.description && <p dir="auto">{plan.event.description}</p>}<p>{actions.uncertain ? (en ? 'Save status is uncertain. Confirming again retries the same appointment without changing its ID.' : 'حالة الحفظ غير مؤكدة. التأكيد مرة أخرى يعيد نفس الطلب بمعرّفه نفسه.') : en ? `Not saved yet. Say “Hey ${name}, confirm the appointment” or confirm below.` : `لم يُحفظ بعد. قل «يا ${name}، أكّد الموعد» أو أكّده من الزر.`}</p><button className="voice-main-toggle" disabled={actions.busy} onClick={() => actions.confirm()}>{en ? 'Confirm and save' : 'أكّد واحفظ'}</button></>}
    {actions.error && <p className="voice-inline-error" role="alert">{actions.error}</p>}{actions.result && <p role="status">{actions.result}</p>}
    {(actions.plan || actions.question || actions.uncertain) && <button className="voice-settings-link" disabled={actions.busy} onClick={actions.cancel}>{actions.uncertain ? (en ? 'Cancel retry' : 'إلغاء إعادة المحاولة') : (en ? 'Cancel appointment request' : 'إلغاء طلب الموعد')}</button>}
  </section>;
}
