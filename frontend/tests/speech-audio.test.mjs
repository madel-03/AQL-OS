import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockSpeechAudio, speechAudioElement } from '../src/lib/speech-audio.js';
test('audio unlock retries a denied attempt, primes a valid silent WAV once and reuses the same element', async t => {
  const original = globalThis.Audio; const create = URL.createObjectURL; const revoke = URL.revokeObjectURL;
  let instances = 0, plays = 0, pauses = 0; const blobs = [], revoked = [];
  globalThis.Audio = class { constructor() { instances++; } async play() { plays++; if (plays === 1) throw new Error('blocked'); } pause() { pauses++; } };
  URL.createObjectURL = blob => { blobs.push(blob); return `blob:test-${blobs.length}`; }; URL.revokeObjectURL = url => revoked.push(url);
  t.after(() => { globalThis.Audio = original; URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
  assert.equal(await unlockSpeechAudio(), false); const audio = speechAudioElement();
  assert.equal(await unlockSpeechAudio(), true); assert.equal(await unlockSpeechAudio(), true);
  assert.equal(speechAudioElement(), audio); assert.equal(instances, 1); assert.equal(plays, 2); assert.equal(pauses, 1); assert.equal(revoked.length, 2);
  const bytes = new Uint8Array(await blobs[1].arrayBuffer()); const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF'); assert.equal(view.getUint32(4, true), bytes.length - 8); assert.equal(view.getUint32(40, true), bytes.length - 44); assert(bytes.slice(44).every(value => value === 0));
});
