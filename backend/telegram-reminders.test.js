import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { reminderPreferences, telegramReminderCandidates, runTelegramReminders, createTelegramReminderRouter, reminderErrorResponse } from './telegram-reminders.js';
import { reminderStorageError, telegramReminderStore } from './telegram-reminder-store.js';
const start = Date.parse('2026-11-14T06:00:00Z'); // Riyadh 09:00
const account = { user_id: 'one', chat_id: '100', reminder_chat_id: '100', time_zone: 'Asia/Riyadh', reminders_enabled: true, reminders_tasks: true, reminders_calendar: true, reminder_lead: 10, reminder_task_time: '09:00', reminders_updated_at: 'v1' };
const tasks = [{ id: 't', title: 'Private task', due_date: '2026-11-14', completed: false }];
const events = [{ id: 'e', title: 'Meeting', start: { dateTime: new Date(start + 5 * 60000).toISOString() } }];
test('database diagnostics distinguish setup failures without disclosing SQL arguments or secrets', async () => {
  const cases = [['42P01', 'table missing', 'REMINDER_SCHEMA'], ['PGRST202', 'function missing', 'REMINDER_RPC_CACHE'], ['42501', 'permission denied', 'REMINDER_PERMISSIONS'], ['42883', 'vault.create_secret missing', 'REMINDER_VAULT'], ['3F000', 'cron schema missing', 'REMINDER_CRON']];
  for (const [code, message, expected] of cases) {
    const result = reminderErrorResponse(reminderStorageError({ code, message: `${message} secret=DO_NOT_DISCLOSE` }, 'install_cron'));
    assert.equal(result.code, expected); assert.equal(result.databaseCode, code); assert.equal(result.stage, 'install_cron'); assert(!JSON.stringify(result).includes('DO_NOT_DISCLOSE'));
  }
  const store = telegramReminderStore({ rpc: async () => ({ error: { code: 'PGRST202', message: 'private URL and secret must stay private' } }) });
  await assert.rejects(store.install('https://private.example', 'private-token'), error => { const result = reminderErrorResponse(error); assert.equal(result.code, 'REMINDER_RPC_CACHE'); assert(!JSON.stringify(result).includes('private')); return true; });
  assert(!JSON.stringify(reminderErrorResponse(new Error('https://secret-token.example'))).includes('secret-token'));
});
function fixture() {
  let time = start; let locked = false; const rows = new Map(); const sent = []; const owners = [];
  const connection = { ...account };
  const store = {
    async lease() { if (locked) return false; locked = true; return true; }, async release() { locked = false; }, async cleanup() {},
    async accounts() { return [{ ...connection }]; }, async connection(user) { return user === 'one' ? connection : null; }, async checked(_user, error) { connection.reminders_error = error; },
    async tasks(user) { owners.push(user); return tasks; }, async claim(user, chat, item) { const key = `${user}:${item.key}`; const old = rows.get(key); if (old && (old.status !== 'failed' || old.retry_at > time || old.attempts >= 3)) return null; const row = { user, chat, item, status: 'sending', attempts: (old?.attempts || 0) + 1 }; rows.set(key, row); return row; },
    async finish(user, key, fields) { const row = rows.get(`${user}:${key}`); Object.assign(row, fields); if (fields.retry_at) row.retry_at = Date.parse(fields.retry_at); },
    async settings(user, fields) { assert.equal(user, 'one'); Object.assign(connection, fields); return connection; },
  };
  const options = { store, readCalendar: async user => { owners.push(user); return { connected: true, events }; }, now: () => time, send: async (chat, text) => { sent.push({ chat, text }); return { message_id: 123 }; } };
  return { store, options, connection, rows, sent, owners, advance: ms => { time += ms; } };
}
test('preferences validate dates and limits, strip ownership, and reminders stay off for a changed chat', () => {
  assert.deepEqual(reminderPreferences({ enabled: true, tasks: true, calendar: false, lead: 10, taskTime: '09:30', user_id: 'evil' }), { enabled: true, tasks: true, calendar: false, lead: 10, taskTime: '09:30' });
  for (const patch of [{ lead: 999 }, { taskTime: '25:00' }, { enabled: 'yes' }]) assert.throws(() => reminderPreferences({ enabled: true, tasks: true, calendar: true, lead: 10, taskTime: '09:00', ...patch }));
  assert.equal(telegramReminderCandidates({ ...account, chat_id: '200' }, tasks, events, start).length, 0);
});
test('due calculations respect local dates, completion, all-day events and bounded late catch-up', () => {
  assert.equal(telegramReminderCandidates(account, tasks, [], start - 1).length, 0);
  assert.equal(telegramReminderCandidates(account, [...tasks, { ...tasks[0], id: 'done', completed: true }, { ...tasks[0], id: 'old', due_date: '2026-11-13' }], [{ id: 'all', start: { date: '2026-11-14' } }, ...events], start).length, 2);
  assert.equal(telegramReminderCandidates(account, [], events, start + 16 * 60000).length, 0);
  const first = telegramReminderCandidates(account, [], events, start)[0];
  assert.equal(first.key, telegramReminderCandidates({ ...account, reminder_lead: 30 }, [], events, start)[0].key);
  const midnightEvent = [{ id: 'night', title: 'Night', start: { dateTime: '2026-11-14T21:03:00Z' } }];
  assert.equal(telegramReminderCandidates(account, [], midnightEvent, Date.parse('2026-11-14T20:58:00Z')).length, 1);
});
test('scheduled delivery persists identity, bundles reminders, reads the correct user and never repeats after a new run', async () => {
  const f = fixture(); const result = await runTelegramReminders(f.options);
  assert.equal(result.delivered, 2); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].chat, '100'); assert.match(f.sent[0].text, /Private task/); assert.deepEqual(f.owners, ['one', 'one']);
  await runTelegramReminders(f.options); assert.equal(f.sent.length, 1); assert([...f.rows.values()].every(row => row.status === 'delivered'));
});
test('unknown delivery is not retried; explicit rejection retries with the same identity after retry time', async () => {
  const f = fixture(); f.options.send = async () => { throw new Error('timeout after possible acceptance'); };
  assert.equal((await runTelegramReminders(f.options)).uncertain, 2); f.advance(61000);
  let calls = 0; f.options.send = async () => { calls++; return { message_id: 1 }; }; await runTelegramReminders(f.options); assert.equal(calls, 0);
  const retry = fixture(); retry.options.send = async () => { throw Object.assign(new Error('rate limit'), { definitive: true, telegramCode: 429, retryAfter: 90 }); };
  await runTelegramReminders(retry.options); const keys = [...retry.rows.keys()];
  retry.options.send = async () => { calls++; return { message_id: 9 }; }; retry.advance(60000); await runTelegramReminders(retry.options); assert.equal(calls, 0);
  retry.advance(31000); await runTelegramReminders(retry.options); assert.equal(calls, 1); assert.deepEqual([...retry.rows.keys()], keys);
});
test('disabled, disconnected and changed preferences stop queued messages; failed sources do not fabricate reminders', async () => {
  const f = fixture(); f.store.connection = async () => ({ ...account, reminders_enabled: false }); await runTelegramReminders(f.options); assert.equal(f.sent.length, 0); assert([...f.rows.values()].every(row => row.status === 'cancelled'));
  const broken = fixture(); broken.options.readCalendar = async () => { throw new Error('unavailable'); }; const result = await runTelegramReminders(broken.options); assert.equal(result.delivered, 1); assert(!broken.sent[0].text.includes('Meeting')); assert.match(broken.connection.reminders_error, /التقويم/);
});
test('large batches progress beyond already-delivered items and concurrent runners cannot duplicate', async () => {
  const f = fixture(); f.store.tasks = async () => Array.from({ length: 15 }, (_, id) => ({ ...tasks[0], id: String(id) })); f.options.readCalendar = async () => ({ connected: false, events: [] });
  assert.equal((await runTelegramReminders(f.options)).delivered, 10); assert.equal((await runTelegramReminders(f.options)).delivered, 5);
  const concurrent = fixture(); let release; concurrent.options.send = () => new Promise(resolve => { release = resolve; });
  const first = runTelegramReminders(concurrent.options); while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(await runTelegramReminders(concurrent.options), { busy: true }); release({ message_id: 2 }); await first;
});
test('reminder API separates scheduler credentials from user sessions and installs only its fixed server URL', async t => {
  const f = fixture(); let installed; const config = { TELEGRAM_BOT_TOKEN: `123456:${'t'.repeat(35)}`, TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(64), TELEGRAM_BOT_USERNAME: 'aql_jarvis_assistant_bot', TELEGRAM_WEBHOOK_URL: 'https://api.example/api/telegram/webhook', APP_URL: 'https://app.example', TELEGRAM_REMINDER_SECRET: 'r'.repeat(64) };
  f.store.install = async (...args) => { installed = args; }; f.store.heartbeat = async () => new Date(start).toISOString(); f.store.recent = async () => [];
  const fetcher = async (_url, options) => { const body = JSON.parse(options.body); assert.equal(body.chat_id, '100'); return { ok: true, json: async () => ({ ok: true, result: { message_id: 5 } }) }; };
  const app = express(); app.use(express.json()); app.use('/reminders', createTelegramReminderRouter({ config, store: f.store, readCalendar: f.options.readCalendar, fetcher, requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: req.headers.authorization }; next(); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (path, method = 'GET', body, user = 'one') => { const res = await fetch(`http://127.0.0.1:${server.address().port}/reminders${path}`, { method, headers: { Authorization: user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await res.text(); return { status: res.status, data: text.startsWith('{') ? JSON.parse(text) : null }; };
  assert.equal((await call('', 'GET', null, '')).status, 401); assert.equal((await call('/run', 'POST')).status, 403); assert.equal((await call('', 'GET', null, 'two')).status, 409);
  const value = await call('', 'PUT', { enabled: true, tasks: true, calendar: true, lead: 15, taskTime: '10:30', endpoint: 'https://evil.example', user_id: 'two' }); assert.equal(value.status, 200);
  assert.deepEqual(installed, ['https://api.example/api/telegram/reminders/run', config.TELEGRAM_REMINDER_SECRET]); assert.equal(f.connection.reminder_lead, 15);
  assert(!JSON.stringify((await call('')).data).includes(config.TELEGRAM_REMINDER_SECRET)); assert.equal((await call('/test', 'POST')).data.accepted, true);
  f.store.install = async () => { throw reminderStorageError({ code: '42883', message: `vault.create_secret failed with ${config.TELEGRAM_REMINDER_SECRET}` }, 'install_cron'); };
  const failure = await call('', 'PUT', { enabled: true, tasks: true, calendar: true, lead: 15, taskTime: '10:30' });
  assert.equal(failure.status, 503); assert.equal(failure.data.code, 'REMINDER_VAULT'); assert.equal(failure.data.stage, 'install_cron'); assert(!JSON.stringify(failure).includes(config.TELEGRAM_REMINDER_SECRET));
});
