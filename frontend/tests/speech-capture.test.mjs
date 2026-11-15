import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechCapture } from '../src/lib/speech-capture.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(options = {}) {
  const states = [], errors = []; let opens = 0, stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(128)], { type: this.mimeType }) }); this.onstop?.(); }
  }
  const capture = createSpeechCapture({ Recorder, getUserMedia: async () => { opens++; return stream; }, onState: value => states.push(value), onError: value => errors.push(value), ...options });
  return { capture, states, errors, stream, Recorder, opens: () => opens, stops: () => stopped };
}
test('recording keeps one stream through pauses and releases it exactly once after user finish', async () => {
  const f = fixture(); await f.capture.start(); await f.capture.start(); await wait(40);
  assert.equal(f.capture.state, 'recording'); assert.equal(f.opens(), 1); assert.equal(f.stops(), 0);
  const audio = await f.capture.finish(); assert.equal(audio.size, 128); assert.match(audio.type, /webm/); assert.equal(f.stops(), 1); await wait(20); assert.equal(f.opens(), 1);
});
test('cancelling permission pending stops the late stream and never begins recording', async () => {
  let resolve; const f = fixture({ getUserMedia: () => new Promise(done => { resolve = done; }) });
  const start = f.capture.start(); f.capture.cancel(); resolve(f.stream); await start;
  assert.equal(f.capture.state, 'idle'); assert.equal(f.stops(), 1); assert.equal(await f.capture.finish(), null);
});
test('recording ownership switches atomically and time limit cancels without automatically uploading', async () => {
  const first = fixture(); await first.capture.start(); let limits = 0;
  const next = fixture({ maxDuration: 10, onLimit: () => limits++ }); await next.capture.start();
  assert.equal(first.stops(), 1); assert.equal(first.capture.state, 'idle'); await wait(30);
  assert.equal(next.stops(), 1); assert.equal(limits, 1); assert.equal(next.capture.state, 'idle'); assert.equal(await next.capture.finish(), null);
});
