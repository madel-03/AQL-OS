import test from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders, reminderRecord, reminderSettings } from '../src/lib/reminders.js';
const now = new Date(2026, 10, 14, 9, 0).getTime();
const settings = reminderSettings({ enabled: true });
test('reminders default off and validate scheduling preferences', () => {
  assert.equal(reminderSettings().enabled, false);
  assert.deepEqual(dueReminders({ settings: reminderSettings(), now }), []);
  assert.equal(reminderSettings({ lead: 900, taskTime: '25:00' }).lead, 10);
  assert.equal(reminderSettings({ taskTime: '25:00' }).taskTime, '09:00');
});
test('task reminders only concern incomplete tasks due today and use local wall time', () => {
  const tasks = [{ id: 'yes', title: 'Due', due_date: '2026-11-14' }, { id: 'done', due_date: '2026-11-14', completed: true }, { id: 'old', due_date: '2026-11-13' }, { id: 'future', due_date: '2026-11-15' }, { id: 'none' }];
  assert.equal(dueReminders({ tasks, settings, now: now - 1 }).length, 0);
  assert.deepEqual(dueReminders({ tasks, settings, now }).map(item => item.target), ['yes']);
  assert.equal(dueReminders({ tasks, settings: { ...settings, tasks: false }, now }).length, 0);
});
test('appointment lead time crosses midnight and handles cancelled, all-day and stale events', () => {
  const start = new Date(2026, 10, 15, 0, 5).getTime();
  const event = { id: 'e', title: 'Meeting', start: { dateTime: new Date(start).toISOString() } };
  assert.equal(dueReminders({ events: [event], settings, now: start - 10 * 60000 - 1 }).length, 0);
  assert.equal(dueReminders({ events: [event, event], settings, now: start - 10 * 60000 }).length, 1);
  assert.equal(dueReminders({ events: [event], settings, now: start + 11 * 60000 }).length, 0);
  assert.equal(dueReminders({ events: [{ ...event, status: 'cancelled' }, { id: 'day', start: { date: '2026-11-15' } }], settings, now: start }).length, 0);
});
test('event identity survives lead changes; rescheduled events have a new identity', () => {
  const event = { id: 'e', title: 'Meeting', start: { dateTime: new Date(now + 5 * 60000).toISOString() } };
  const first = dueReminders({ events: [event], settings, now })[0];
  assert.equal(first.key, dueReminders({ events: [event], settings: { ...settings, lead: 30 }, now })[0].key);
  const moved = { ...event, start: { dateTime: new Date(now + 6 * 60000).toISOString() } };
  assert.notEqual(first.key, dueReminders({ events: [moved], settings, now })[0].key);
});
test('stored history expires, rejects malformed entries and bounds inbox', () => {
  const item = { key: 'x', type: 'task', target: 'id', title: 'Task', when: now, deliveredAt: now, read: false };
  const value = reminderRecord({ inbox: [null, { ...item, when: 'bad' }, ...Array(70).fill(item)], seen: { old: now - 8 * 86400000, keep: now } }, now);
  assert.equal(value.inbox.length, 50); assert.deepEqual(value.seen, { keep: now });
});
