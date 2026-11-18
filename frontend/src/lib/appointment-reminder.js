export function appointmentReminderHint(status, event, zone, en, now = Date.now()) {
  const prefs = status?.preferences;
  if (!status?.configured || !prefs?.enabled || !prefs.calendar) return '';
  if (!status.schedulerFresh || status.error) return en
    ? 'Telegram reminders are enabled, but delivery timing is currently uncertain.'
    : 'تذكيرات Telegram مفعّلة، لكن وقت وصول التذكير غير مؤكد حاليًا.';
  const start = Date.parse(event.start);
  if (!Number.isFinite(start) || ![0, 5, 10, 15, 30, 60].includes(prefs.lead) || start <= now) return '';
  const expected = Math.max(now, start - prefs.lead * 60000);
  const formatter = new Intl.DateTimeFormat(en ? 'en' : 'ar-SA', {
    timeZone: zone, calendar: 'gregory', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const time = formatter.format(expected);
  return en ? `Your Telegram reminder is expected around ${time}.` : `تذكير Telegram متوقع حوالي ${time}.`;
}
