import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCalendarRouter, calendarCrypto, calendarEvent } from './calendar.js';

const config = { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'http://127.0.0.1/api/calendar/callback', APP_URL: 'https://app.example', CALENDAR_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') };
test('token encryption detects tampering and event validation strips invitations', () => {
  const vault = calendarCrypto(config.CALENDAR_TOKEN_KEY); const sealed = vault.seal({ refresh_token: 'private' });
  assert(!sealed.includes('private')); assert.equal(vault.open(sealed).refresh_token, 'private');
  assert.throws(() => calendarCrypto(Buffer.alloc(32, 8).toString('base64')).open(sealed));
  const event = calendarEvent({ requestId: 'a'.repeat(32), title: 'Test', start: '2026-12-01T10:00:00+03:00', end: '2026-12-01T11:00:00+03:00', attendees: ['private@example.com'] });
  assert.equal(event.attendees, undefined); assert.equal(event.start.dateTime, '2026-12-01T07:00:00.000Z');
  assert.throws(() => calendarEvent({ title: 'x' }));
});

async function setup(t, configured = true) {
  const connections = new Map(), states = new Map(), calls = [], savedEvents = new Map();
  const store = { get: async user => connections.get(user), save: async (user, value) => connections.set(user, value), remove: async user => connections.delete(user), state: async (id, user_id, binder, expires_at) => states.set(id, { user_id, binder, expires_at }), takeState: async id => { const row = states.get(id); states.delete(id); return row; } };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'access-private', refresh_token: 'refresh-private', scope: 'https://www.googleapis.com/auth/calendar.events.owned', expires_in: 3600 }));
    if (url.endsWith('/revoke')) return new Response('{}');
    if (options.method === 'POST') { const event = JSON.parse(options.body); if (savedEvents.has(event.id)) return new Response('{}', { status: 409 }); savedEvents.set(event.id, event); return new Response(JSON.stringify(event)); }
    const id = url.split('/events/')[1];
    if (id) return new Response(JSON.stringify(savedEvents.get(id)));
    return new Response(JSON.stringify({ items: [...savedEvents.values()] }));
  };
  const app = express(); app.use(express.json());
  app.use('/api/calendar', createCalendarRouter({ config: configured ? config : {}, store, fetcher, requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: req.headers.authorization }; next(); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/calendar`;
  const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', ...options, headers: { Authorization: 'user-one', 'Content-Type': 'application/json', ...options.headers } });
  async function begin() {
    const data = await (await request('/connect', { method: 'POST' })).json();
    const ticket = new URL(data.url).searchParams.get('ticket');
    const start = await request(`/start?ticket=${ticket}`);
    return { state: new URL(start.headers.get('location')).searchParams.get('state'), cookie: start.headers.get('set-cookie').split(';')[0], ticket };
  }
  async function connect() { const auth = await begin(); const response = await request(`/callback?state=${auth.state}&code=test-code`, { headers: { cookie: auth.cookie } }); assert.equal(response.headers.get('location'), 'https://app.example/?calendar=connected'); return auth; }
  return { request, begin, connect, connections, calls };
}
test('setup status is actionable without credentials', async t => {
  const { request } = await setup(t, false);
  assert.deepEqual(await (await request('/status')).json(), { configured: false, connected: false });
  assert.equal((await request('/connect', { method: 'POST' })).status, 503);
});
test('OAuth is bound to browser, one-use, and stores only encrypted tokens', async t => {
  const { request, begin, connect, connections } = await setup(t);
  const invalid = await begin();
  const rejected = await request(`/callback?state=${invalid.state}&code=attacker`);
  assert.match(rejected.headers.get('location'), /failed/); assert.equal(connections.size, 0);
  const auth = await connect();
  assert(!connections.get('user-one').includes('refresh-private'));
  assert.match((await request(`/callback?state=${auth.state}&code=replay`, { headers: { cookie: auth.cookie } })).headers.get('location'), /failed/);
  assert.equal((await (await request('/status', { headers: { Authorization: 'user-two' } })).json()).connected, false);
});
test('events require auth, retry without duplicates, refresh tokens and revoke on disconnect', async t => {
  const { request, connect, connections, calls } = await setup(t); await connect();
  assert.equal((await request('/events', { headers: { Authorization: '' } })).status, 401);
  const vault = calendarCrypto(config.CALENDAR_TOKEN_KEY); const token = vault.open(connections.get('user-one')); token.expires = 0; connections.set('user-one', vault.seal(token));
  const event = { requestId: 'b'.repeat(32), title: 'My event', start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z', attendees: [{ email: 'never-send@example.com' }] };
  for (let i = 0; i < 2; i++) assert.equal((await request('/events', { method: 'POST', body: JSON.stringify(event) })).status, 200);
  assert.equal((await (await request('/events')).json()).events.length, 1);
  assert(calls.some(call => call.url.endsWith('/token') && String(call.options.body).includes('refresh_token')));
  assert(!calls.some(call => call.options.body?.includes?.('never-send')));
  assert.equal((await request('/events', { method: 'POST', body: JSON.stringify({ ...event, title: 'Changed retry' }) })).status, 409);
  assert.equal((await request('/connection', { method: 'DELETE' })).status, 200);
  assert.equal(connections.size, 0); assert(calls.some(call => call.url.endsWith('/revoke')));
});
