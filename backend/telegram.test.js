import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { createTelegramRouter, telegramClient, registerTelegramWebhook, telegramDay } from './telegram.js';
import { calendarReader } from './calendar-reader.js';
import { calendarCrypto } from './calendar.js';
const config = { TELEGRAM_BOT_TOKEN: `123456:${'t'.repeat(35)}`, TELEGRAM_WEBHOOK_SECRET: 's'.repeat(64), TELEGRAM_BOT_USERNAME: 'aql_jarvis_assistant_bot', TELEGRAM_WEBHOOK_URL: 'https://api.example/api/telegram/webhook', APP_URL: 'https://app.example' };
test('Telegram day uses the linked time zone including Riyadh midnight and DST days', () => {
  const value = telegramDay('Asia/Riyadh', Date.parse('2026-11-14T21:30:00Z'));
  assert.equal(value.day, '2026-11-15'); assert.equal(value.from, '2026-11-14T21:00:00.000Z'); assert.equal(value.until, '2026-11-15T21:00:00.000Z');
  const dst = telegramDay('America/New_York', Date.parse('2026-03-08T16:00:00Z'));
  assert.equal(Date.parse(dst.until) - Date.parse(dst.from), 23 * 3600000);
});
test('webhook registration validates the bot identity and uses the secret header mechanism', async () => {
  const calls = []; const fetcher = async (url, options) => { const method = url.split('/').at(-1); calls.push({ method, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true, result: method === 'getMe' ? { username: config.TELEGRAM_BOT_USERNAME } : true }) }; };
  assert.equal(await registerTelegramWebhook(config, fetcher), true);
  assert.equal(calls[1].method, 'setWebhook'); assert.equal(calls[1].body.secret_token, config.TELEGRAM_WEBHOOK_SECRET); assert.deepEqual(calls[1].body.allowed_updates, ['message']);
  await assert.rejects(registerTelegramWebhook({ ...config, TELEGRAM_BOT_USERNAME: 'another_bot' }, fetcher));
  const client = telegramClient({ token: config.TELEGRAM_BOT_TOKEN }, async url => { throw new Error(url); });
  await assert.rejects(client('sendMessage'), error => !error.message.includes(config.TELEGRAM_BOT_TOKEN));
});
test('private pairing requires website confirmation, isolates accounts, deduplicates updates and supports disconnect', async t => {
  const tickets = new Map(), connections = new Map(), updates = new Set(), sent = [], reads = [];
  const store = {
    async connection(user) { return connections.get(user); }, async byChat(chat) { return [...connections.values()].find(row => row.chat_id === chat); },
    async pending(user) { const row = tickets.get(user); return row && Date.parse(row.expires_at) > Date.now() ? row : null; },
    async link(user, token_hash, expires_at, time_zone) { tickets.set(user, { user_id: user, token_hash, expires_at, time_zone }); },
    async claim(hash, profile) { const row = [...tickets.values()].find(row => row.token_hash === hash && !row.chat_id && Date.parse(row.expires_at) > Date.now()); if (row) Object.assign(row, profile); return row; },
    async confirm(user, hash) { const row = await this.pending(user); if (!row?.chat_id || row.token_hash !== hash) throw new Error('invalid'); if ([...connections.values()].some(other => other.chat_id === row.chat_id && other.user_id !== user)) throw new Error('already linked'); connections.set(user, { ...row }); tickets.delete(user); },
    async cancel(user) { tickets.delete(user); }, async disconnect(user) { connections.delete(user); tickets.delete(user); },
    async claimUpdate(id) { if (updates.has(id)) return false; updates.add(id); return true; },
    async tasks(user) { reads.push(['tasks', user]); return [{ title: `Private task ${user}`, due_date: '2020-01-01' }]; },
  };
  const fetcher = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, result: {} }) }; };
  const app = express(); app.use(express.json()); app.use('/api/telegram', createTelegramRouter({ config, store, fetcher, requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: req.headers.authorization }; next(); }, readCalendar: async user => { reads.push(['calendar', user]); return { connected: true, events: [{ title: `Meeting ${user}`, start: { date: '2026-11-14' } }] }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (path, method = 'GET', body, user = 'one', secret = config.TELEGRAM_WEBHOOK_SECRET) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/telegram/${path}`, { method, headers: { Authorization: user, 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, ...(body ? { body: JSON.stringify(body) } : {}) }); const raw = await response.text(); return { status: response.status, data: raw.startsWith('{') ? JSON.parse(raw) : null }; };
  let updateId = 0; const update = (text, id = 100) => ({ update_id: ++updateId, message: { chat: { id, type: 'private' }, from: { id, first_name: 'Tester', username: 'qa_user' }, text } });
  assert.equal((await call('status', 'GET', null, '')).status, 401);
  assert.equal((await call('webhook', 'POST', update('/tasks'), '', 'bad')).status, 403); assert.equal(sent.length, 0);
  const link = await call('link', 'POST', { timeZone: 'Asia/Riyadh' }); const code = new URL(link.data.url).searchParams.get('start');
  assert.equal(tickets.get('one').token_hash, createHash('sha256').update(code).digest('hex'));
  assert.equal((await call('confirm', 'POST')).status, 409);
  const start = update(`/start ${code}`); await call('webhook', 'POST', start);
  assert.equal(connections.size, 0); assert.equal((await call('status')).data.pending.claimed, true); assert.equal(reads.length, 0);
  assert.equal((await call('confirm', 'POST', {}, 'two')).status, 409); assert.equal((await call('confirm', 'POST')).status, 200);
  assert.equal((await call('status')).data.connected, true); assert(!JSON.stringify((await call('status')).data).includes('token_hash'));
  const today = update('/today'); await call('webhook', 'POST', today); const count = sent.length; await call('webhook', 'POST', today); assert.equal(sent.length, count);
  assert.deepEqual(reads, [['tasks', 'one'], ['calendar', 'one']]); assert.match(sent.at(-1).text, /Private task one/);
  await call('webhook', 'POST', update('/tasks', 200)); assert.equal(reads.length, 2, 'unlinked chat cannot read user data');
  const group = update('/tasks'); group.message.chat.type = 'group'; await call('webhook', 'POST', group); assert.equal(reads.length, 2);
  const spoofed = update('/tasks'); spoofed.message.from.id = 200; await call('webhook', 'POST', spoofed); assert.equal(reads.length, 2);
  await call('webhook', 'POST', update('/unlink')); assert.equal(connections.size, 0);
  await call('webhook', 'POST', update('/today')); assert.equal(reads.length, 2);
  const expiredLink = await call('link', 'POST', {}); tickets.get('one').expires_at = '2020-01-01'; await call('webhook', 'POST', update(`/start ${new URL(expiredLink.data.url).searchParams.get('start')}`)); assert.equal((await call('confirm', 'POST')).status, 409);
});
test('Telegram calendar reader reads only the linked user and refreshes encrypted credentials without exposing tokens', async () => {
  const key = Buffer.alloc(32, 2).toString('base64'); const vault = calendarCrypto(key); const users = [];
  let saved = vault.seal({ access_token: 'expired', refresh_token: 'refresh', expires: 0 });
  const store = { get: async user => { users.push(user); return user === 'one' ? saved : null; }, save: async (user, payload) => { assert.equal(user, 'one'); saved = payload; } };
  const fetcher = async (url, options) => ({ ok: true, json: async () => { if (url.includes('oauth2')) return { access_token: 'fresh', expires_in: 3600 }; assert.equal(options.headers.Authorization, 'Bearer fresh'); return { items: [{ summary: 'Meeting', start: { date: '2026-11-14' } }, { status: 'cancelled' }] }; } });
  const read = calendarReader({ store, config: { CALENDAR_TOKEN_KEY: key }, fetcher });
  assert.deepEqual(await read('two', 'from', 'until'), { connected: false, events: [] });
  const value = await read('one', 'from', 'until'); assert.equal(value.events.length, 1); assert.equal(value.events[0].title, 'Meeting'); assert(!JSON.stringify(value).includes('refresh')); assert(!saved.includes('fresh')); assert.deepEqual(users, ['two', 'one']);
});
