import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSpeechRouter } from './speech.js';
test('authenticated audio transcription validates recordings, keeps credentials server-side and returns only text', async t => {
  const requests = []; let providerStatus = 200;
  const app = express(); app.use(express.json()); app.use('/speech', createSpeechRouter({ config: { GROQ_API_KEY: 'private-key' }, requireAuth: (req, res, next) => req.headers.authorization === 'Bearer user' ? next() : res.sendStatus(401), fetcher: async (url, options) => { requests.push({ url, options }); return { ok: providerStatus === 200, status: providerStatus, json: async () => providerStatus === 200 ? { text: '  أضف موعد النادي بعد ربع ساعة  ' } : { error: 'do not expose private-key' } }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (body, type = 'audio/webm;codecs=opus', auth = 'Bearer user') => { const res = await fetch(`http://127.0.0.1:${server.address().port}/speech/transcribe?language=ar`, { method: 'POST', headers: { 'Content-Type': type, Authorization: auth }, body }); return { status: res.status, text: await res.text() }; };
  assert.equal((await call(Buffer.alloc(256), undefined, '')).status, 401); assert.equal(requests.length, 0);
  assert.equal((await call(Buffer.alloc(3))).status, 400); assert.equal((await call(Buffer.alloc(256), 'text/plain')).status, 400); assert.equal(requests.length, 0);
  const result = await call(Buffer.alloc(256)); assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.text), { text: 'أضف موعد النادي بعد ربع ساعة' });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-key'); assert.equal(requests[0].options.body.get('model'), 'whisper-large-v3-turbo'); assert.equal(requests[0].options.body.get('language'), 'ar'); assert.equal(requests[0].options.body.get('file').size, 256); assert(!result.text.includes('private-key'));
  providerStatus = 429; const failed = await call(Buffer.alloc(256)); assert.equal(failed.status, 429); assert(!failed.text.includes('private-key'));
  const large = await call(Buffer.alloc(8 * 1024 * 1024 + 1)); assert.equal(large.status, 413);
});
