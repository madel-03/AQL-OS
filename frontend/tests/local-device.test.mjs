import test from 'node:test';
import assert from 'node:assert/strict';
import { connectLocalDevice, disconnectLocalDevice, hasLocalDevice } from '../src/lib/local-device.js';

test('disconnect during pairing keeps the local device unpaired', async t => {
  let respond;
  const response = new Promise(resolve => { respond = resolve; });
  t.mock.method(globalThis, 'fetch', () => response);
  t.after(disconnectLocalDevice);
  const connecting = connectLocalDevice('A'.repeat(43));
  disconnectLocalDevice();
  respond(Response.json({ ok: true }));
  await assert.rejects(connecting, { name: 'AbortError' });
  assert.equal(hasLocalDevice(), false);
});
