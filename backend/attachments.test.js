import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import express from 'express';
import { createAttachmentsRouter } from './attachments.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64');
const candidate = reply => ({ candidates: [{ content: { parts: [{ text: reply }] } }] });

async function start(t, generate) {
  const app = express();
  app.use(createAttachmentsRouter({
    generate,
    requireAuth(req, res, next) {
      const id = req.get('X-Test-User');
      if (!id) return res.sendStatus(401);
      req.user = { id };
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  return ({ user = 'one', body = png, name = 'capture.png', query = '', signal } = {}) => fetch(`http://127.0.0.1:${server.address().port}/${query}`, {
    method: 'POST', body, signal,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Aql-File': name, 'X-Test-User': user },
  });
}

test('valid images reach product analysis while mismatched files are rejected before a provider call', async t => {
  let analyzed = 0;
  const upload = await start(t, async payload => {
    analyzed++;
    assert.equal(payload.contents[0].parts.at(-1).inlineData.mimeType, 'image/png');
    assert.equal(payload.generationConfig.responseMimeType, 'application/json');
    return candidate('{"productQuery":"monitor stand"}');
  });
  assert.equal((await upload({ user: '' })).status, 401);
  assert.equal((await upload({ body: Buffer.from('a text file') })).status, 400);
  assert.equal((await upload({ name: 'capture.jpg' })).status, 400);
  assert.equal(analyzed, 0);
  const response = await upload({ name: 'capture.PNG', query: '?mode=product' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).productQuery, 'monitor stand');
  assert.equal(analyzed, 1);
});

test('cancelled uploads abort analysis and free the account slot', async t => {
  const progress = new EventEmitter();
  const deadline = AbortSignal.timeout(4000);
  const entered = once(progress, 'entered', { signal: deadline });
  let calls = 0;
  const upload = await start(t, async (_payload, signal) => {
    if (++calls !== 1) return candidate('OK');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { progress.emit('aborted'); reject(signal.reason); }, { once: true });
      progress.emit('entered');
    });
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const first = upload({ signal: controller.signal }).catch(error => error);
  await entered;
  assert.equal((await upload()).status, 429);
  assert.equal((await upload({ user: 'two' })).status, 200);
  const aborted = once(progress, 'aborted', { signal: deadline });
  controller.abort();
  assert.equal((await first).name, 'AbortError');
  await aborted;
  assert.equal((await upload()).status, 200);
});
