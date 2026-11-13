import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { localCalendarTime, prepareCalendarDraft, planCalendarRequest } from './calendar-planning.js';
import { createCalendarRouter } from './calendar.js';

test('wall-clock conversion respects Riyadh, DST gaps/folds and invalid dates', () => {
  assert.equal(localCalendarTime('2026-11-14', '17:00', 'Asia/Riyadh'), '2026-11-14T14:00:00.000Z');
  assert.equal(localCalendarTime('2026-07-14', '17:00', 'America/New_York'), '2026-07-14T21:00:00.000Z');
  assert.throws(() => localCalendarTime('2026-03-08', '02:30', 'America/New_York'));
  assert.throws(() => localCalendarTime('2026-11-01', '01:30', 'America/New_York'));
  assert.throws(() => localCalendarTime('2026-02-29', '17:00', 'Asia/Riyadh'));
});
test('drafts have stable request IDs, expiration and proposed duration; unsupported fields never enter events', () => {
  const value = prepareCalendarDraft({ kind: 'event', title: 'Review', date: '2026-11-14', time: '17:00', attendees: [{ email: 'not-supported@example.com' }] }, 'Asia/Riyadh', 1000);
  assert.match(value.event.requestId, /^[a-f0-9]{32}$/); assert.equal(value.expiresAt, 601000);
  assert.equal(Date.parse(value.event.end) - Date.parse(value.event.start), 3600000);
  assert.equal(value.event.attendees, undefined);
  assert.throws(() => prepareCalendarDraft({ kind: 'event', title: 'x', date: '2026-11-14', time: '17:00', durationMinutes: -1 }, 'Asia/Riyadh'));
  assert.deepEqual(prepareCalendarDraft({ kind: 'clarify', question: 'أي وقت؟', execute: true }, 'Asia/Riyadh'), { kind: 'clarify', question: 'أي وقت؟' });
});
test('planner uses bounded prior requests, authoritative local clock, and never executes tools', async () => {
  let prompt, input;
  const result = await planCalendarRequest({ message: 'بكرة الساعة الخامسة مساءً', context: ['أضف موعد مراجعة المشروع'], timeZone: 'Asia/Riyadh', lang: 'ar', now: Date.parse('2026-11-13T21:30:00Z'), generate: async (system, user) => { prompt = system; input = JSON.parse(user); return { kind: 'event', title: 'مراجعة المشروع', date: '2026-11-15', time: '17:00' }; } });
  assert(prompt.includes('2026-11-14T00:30:00')); assert.deepEqual(input.previousUserMessages, ['أضف موعد مراجعة المشروع']);
  assert.equal(result.kind, 'event'); assert.equal(result.event.start, '2026-11-15T14:00:00.000Z');
});
test('authenticated plan endpoint requires a connection and cannot write Google events', async t => {
  let calls = 0, generations = 0;
  const app = express(); app.use(express.json());
  app.use('/api/calendar', createCalendarRouter({ config: { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'https://api.example/api/calendar/callback', APP_URL: 'https://app.example', CALENDAR_TOKEN_KEY: Buffer.alloc(32, 1).toString('base64') }, store: { get: async user => user === 'one' ? 'encrypted-connection' : null }, requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: req.headers.authorization }; next(); }, fetcher: async () => { calls++; throw new Error('Google must not be called during planning'); }, generate: async () => { generations++; return { kind: 'clarify', question: 'الساعة الخامسة صباحًا أم مساءً؟' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = async user => fetch(`http://127.0.0.1:${server.address().port}/api/calendar/plan`, { method: 'POST', headers: { Authorization: user, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'أضف موعد بكرة الخامسة', timeZone: 'Asia/Riyadh', user_id: 'one' }) });
  assert.equal((await send('')).status, 401); assert.equal((await send('two')).status, 409);
  const response = await send('one'); assert.equal(response.status, 200); assert.equal((await response.json()).kind, 'clarify'); assert.equal(generations, 1); assert.equal(calls, 0);
});
