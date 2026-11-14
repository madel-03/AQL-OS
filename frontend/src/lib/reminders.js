export const reminderDefaults = { enabled: false, calendar: true, tasks: true, lead: 10, taskTime: '09:00', desktop: false };
export function reminderSettings(value = {}) {
  return { enabled: value.enabled === true, calendar: value.calendar !== false, tasks: value.tasks !== false, lead: [0, 5, 10, 15, 30, 60].includes(value.lead) ? value.lead : 10, taskTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.taskTime || '') ? value.taskTime : '09:00', desktop: value.desktop === true };
}
const day = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function dueReminders({ tasks = [], events = [], settings, now = Date.now() }) {
  if (!settings.enabled) return [];
  const output = []; const today = day(new Date(now));
  if (settings.tasks) for (const task of tasks) {
    if (task.completed || task.due_date !== today) continue;
    const at = new Date(`${task.due_date}T${settings.taskTime}:00`).getTime();
    if (Number.isFinite(at) && now >= at) output.push({ key: `task:${task.id}:${task.due_date}`, type: 'task', target: task.id, title: task.title, at, when: at });
  }
  if (settings.calendar) for (const event of events) {
    if (event.status === 'cancelled' || !event.start?.dateTime) continue;
    const when = Date.parse(event.start.dateTime); const at = when - settings.lead * 60000;
    // Catch a delayed timer on return, but never alert about old appointments.
    if (Number.isFinite(at) && now >= at && now <= when + 10 * 60000) output.push({ key: `event:${event.id}:${when}`, type: 'event', target: event.id, title: event.title || event.summary || 'موعد', at, when });
  }
  return [...new Map(output.map(item => [item.key, item])).values()].sort((a, b) => a.at - b.at);
}
export function reminderRecord(value, now = Date.now()) {
  const cutoff = now - 7 * 86400000;
  const valid = item => item && typeof item.key === 'string' && ['task', 'event'].includes(item.type) && typeof item.title === 'string' && typeof item.target === 'string' && Number.isFinite(item.when) && Number.isFinite(item.deliveredAt) && item.deliveredAt >= cutoff;
  return { settings: reminderSettings(value?.settings), inbox: Array.isArray(value?.inbox) ? value.inbox.filter(valid).slice(0, 50) : [], seen: Object.fromEntries(Object.entries(value?.seen || {}).filter(([, time]) => Number.isFinite(time) && time >= cutoff)) };
}
