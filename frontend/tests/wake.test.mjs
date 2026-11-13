import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeListener, wakeMatch, validWakeName } from '../src/lib/wake-listener.js';
import { spokenToday, voiceIntent } from '../src/lib/voice-commands.js';
const tick = (ms = 12) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(onCommand = async () => {}, options = {}) {
  const instances = [], phases = [], errors = [];
  const engine = createWakeListener({ name: 'جارفس', lang: 'ar-SA', restartDelay: 2, commandWindow: 40, onCommand, onStatus: value => phases.push(value), onError: value => errors.push(value), createRecognition: () => {
    const rec = { aborted: false, results: [], start() { this.onstart?.(); }, abort() { this.aborted = true; }, result(text, final = true) { const result = [{ transcript: text }]; result.isFinal = final; const index = this.results.length && !this.results.at(-1).isFinal ? this.results.length - 1 : this.results.length; this.results[index] = result; this.onresult?.({ resultIndex: index, results: this.results }); } }; instances.push(rec); return rec;
  }, ...options });
  return { engine, instances, phases, errors };
}
test('wake matching is anchored and word bounded, with Jarvis spellings and custom names', () => {
  assert.equal(wakeMatch('يا جارفيس، وش عندي اليوم؟', 'جارفس'), 'وش عندي اليوم');
  assert.equal(wakeMatch('Hey Jarvis what is on today', 'يا جارفس'), 'what is on today');
  assert.equal(wakeMatch('يا عقلان', 'عقل'), null);
  assert.equal(wakeMatch('أنا كنت أتكلم عن جارفس', 'جارفس'), null);
  assert.equal(wakeMatch('يا مساعدي افتح المهام', 'مساعدي'), 'افتح المهام');
  assert.equal(validWakeName(''), false); assert.equal(validWakeName('a'.repeat(31)), false);
});
test('no autostart and ambient/interim speech never becomes a command; stop cleans up', async () => {
  const calls = []; const { engine, instances } = fixture(async command => calls.push(command));
  assert.equal(instances.length, 0); engine.start();
  instances[0].result('random conversation'); instances[0].result('يا جارفس افتح المهام', false); assert.equal(calls.length, 0);
  instances[0].result('يا جارفس افتح المهام'); await tick(); assert.deepEqual(calls, ['افتح المهام']); assert.equal(instances[0].aborted, true);
  engine.stop(); const count = instances.length; await tick(); assert.equal(instances.length, count);
});
test('wake-only allows one follow-up after acknowledgement, then requires wake again', async () => {
  const calls = []; const { engine, instances } = fixture(async command => calls.push(command)); engine.start();
  instances[0].result('يا جارفس'); await tick(); instances.at(-1).result('وش عندي اليوم'); await tick();
  instances.at(-1).result('هذه محادثة جانبية'); assert.deepEqual(calls, ['', 'وش عندي اليوم']); engine.stop();
});
test('follow-up window expires instead of treating later speech as commands', async () => {
  const calls = []; const { engine, instances } = fixture(async command => calls.push(command), { commandWindow: 10 }); engine.start();
  instances[0].result('جارفس'); await tick(30); instances.at(-1).result('ambient words'); assert.deepEqual(calls, ['']); engine.stop();
});
test('busy command does not listen to speaker output; hide aborts and prevents late restart', async () => {
  let release, signal;
  const { engine, instances } = fixture((command, context) => { signal = context.signal; return new Promise(resolve => { release = resolve; }); }); engine.start();
  instances[0].result('جارفس وش عندي اليوم'); assert.equal(instances[0].aborted, true);
  await tick(); assert.equal(instances.length, 1); engine.hide(); assert.equal(signal.aborted, true); release(); await tick(); assert.equal(instances.length, 1); assert.equal(engine.enabled, false);
});
test('other microphone/speech pauses recognition, idle resumes, denied permission stops permanently', async () => {
  const { engine, instances, errors } = fixture(); engine.start(); engine.externalVoice('speaking'); assert.equal(instances[0].aborted, true);
  await tick(); assert.equal(instances.length, 1); engine.externalVoice('idle'); await tick(); assert.equal(instances.length, 2);
  instances[1].onerror({ error: 'not-allowed' }); await tick(); assert.equal(engine.enabled, false); assert.deepEqual(errors, ['not-allowed']); assert.equal(instances.length, 2);
});
test('normal recognition ends can reconnect, but network failure never loops', async () => {
  const { engine, instances, errors } = fixture(); engine.start(); instances[0].onend(); await tick(); assert.equal(instances.length, 2);
  instances[1].onerror({ error: 'network' }); await tick(); assert.deepEqual(errors, ['network']); assert.equal(instances.length, 2);
});
test('enabling during existing speech waits without opening the microphone', async () => {
  const { engine, instances } = fixture(async () => {}, { initiallyPaused: true }); engine.start();
  assert.equal(instances.length, 0); engine.externalVoice('idle'); await tick(); assert.equal(instances.length, 1); engine.stop();
});
test('voice intents remain read-only and today summary excludes completed/future tasks', () => {
  assert.equal(voiceIntent('وش عندي اليوم؟').type, 'today'); assert.equal(voiceIntent('أضف مهمة جديدة').type, 'review-required'); assert.equal(voiceIntent('افتح التقويم').id, 'calendar'); assert.equal(voiceIntent('وقف الاستماع').type, 'stop');
  const snapshot = { day: '2026-11-13', tasks: [{ title: 'Due', due_date: '2026-11-13', completed: false }, { title: 'Done', due_date: '2026-11-13', completed: true }, { title: 'Future', due_date: '2026-11-14' }], events: [], calendar: { connected: true } };
  const text = spokenToday(snapshot, true); assert.match(text, /Due/); assert(!text.includes('Done')); assert(!text.includes('Future'));
  const failed = spokenToday({ ...snapshot, errors: { calendar: 'offline', tasks: 'offline' } }, true); assert.match(failed, /could not be read/); assert(!failed.includes('0 appointments')); assert(!failed.includes('0 tasks'));
});
test('calendar action and explicit confirmation are distinguished from conversation', () => {
  assert.equal(voiceIntent('أضف موعد بكرة الخامسة مساءً لمراجعة المشروع').type, 'calendar-prepare');
  assert.equal(voiceIntent('أبغاك تضيف لي موعد اجتماع').type, 'calendar-prepare');
  assert.equal(voiceIntent('أكد الموعد').type, 'calendar-confirm');
  assert.equal(voiceIntent('confirm the appointment').type, 'calendar-confirm');
  assert.equal(voiceIntent('إلغي طلب الموعد').type, 'calendar-cancel');
  assert.equal(voiceIntent('نعم').type, 'chat');
  assert.equal(voiceIntent('متى أؤكد الموعد').type, 'chat');
  assert.equal(voiceIntent('احذف موعد اليوم').type, 'review-required');
});
test('clarification outcomes allow one bounded conversational follow-up', async () => {
  const calls = []; const { engine, instances } = fixture(async command => { calls.push(command); return { followUp: calls.length === 1 }; });
  engine.start(); instances[0].result('يا جارفس أضف موعد'); await tick(); instances.at(-1).result('بكرة الخامسة مساء'); await tick(); instances.at(-1).result('محادثة جانبية');
  assert.deepEqual(calls, ['اضف موعد', 'بكرة الخامسة مساء']); engine.stop();
});
