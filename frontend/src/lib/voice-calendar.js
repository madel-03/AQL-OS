export function describeCalendarPlan(plan, en = false, name = 'جارفس') {
  const format = value => new Intl.DateTimeFormat(en ? 'en' : 'ar', { dateStyle: 'full', timeStyle: 'short', timeZone: plan.timeZone }).format(new Date(value));
  const minutes = Math.round((Date.parse(plan.event.end) - Date.parse(plan.event.start)) / 60000);
  return en ? `I prepared “${plan.event.title}”, ${format(plan.event.start)}, for ${minutes} minutes, in ${plan.timeZone}. It has not been saved. Say: Hey ${name}, confirm the appointment.` : `جهّزت موعد «${plan.event.title}»، ${format(plan.event.start)}، لمدة ${minutes} دقيقة، حسب ${plan.timeZone}. لم أحفظه بعد. قل: يا ${name}، أكّد الموعد.`;
}
