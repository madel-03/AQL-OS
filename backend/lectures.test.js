import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import express from 'express';
import { analyzeLecture, createLecturesRouter, lectureType, pptxUnits, sourceUnits } from './lectures.js';
const pptx = () => Buffer.from(zipSync({ 'ppt/slides/slide2.xml': strToU8('<a:t>Second &amp; example</a:t>'), 'ppt/slides/slide1.xml': strToU8('<a:t>Energy is conserved.</a:t>') }));
test('validates types and bounded source extraction, keeps PowerPoint references ordered', () => {
  assert.throws(() => lectureType('bad.pdf', Buffer.alloc(20)));
  assert.throws(() => lectureType('x.exe', Buffer.alloc(20)));
  assert.throws(() => sourceUnits({ complete: false, units: [{ ref: 'page 1', text: 'partial' }] }));
  assert.throws(() => sourceUnits({ complete: true, units: [{ ref: 'page 1', text: 'x'.repeat(60001) }] }));
  const units = pptxUnits(pptx()); assert.equal(units[0].ref, 'شريحة 1'); assert.equal(units[1].text, 'Second & example');
  const bomb = Buffer.from(zipSync({ 'ppt/slides/slide1.xml': strToU8('x'.repeat(1100000)) })); assert.throws(() => pptxUnits(bomb));
});
test('PDF and media go through Gemini extraction, Groq explanation, Gemini correction, preserving references', async () => {
  for (const name of ['lecture.pdf', 'lecture.mp3', 'lecture.mp4']) {
    const calls = [], phases = []; const units = [{ ref: name.endsWith('pdf') ? 'page 1' : '00:00–00:10 (approximate)', text: 'Energy is conserved.' }];
    const result = await analyzeLecture({ name, bytes: Buffer.from(name.endsWith('pdf') ? '%PDF-1.4 synthetic source' : 'synthetic media content'), signal: new AbortController().signal,
      progress: value => phases.push(value),
      gemini: async parts => { calls.push('gemini'); assert.ok(parts[0].text.includes('untrusted')); return calls.length === 1 ? { complete: true, units, warnings: ['approximate'] } : { summary: 'Correct summary', explanation: 'Correct explanation', questions: 'Q and answer', reviewNotes: 'Checked extracted notes' }; },
      groq: async prompt => { calls.push('groq'); assert.ok(prompt.includes(units[0].ref)); return { summary: 'draft' }; } });
    assert.deepEqual(calls, ['gemini', 'groq', 'gemini']); assert.deepEqual(phases, ['extracting', 'explaining', 'reviewing']); assert.deepEqual(result.sources, units); assert.equal(result.summary, 'Correct summary');
  }
});
test('PPTX sends text only and a failed second provider never claims reviewed success', async () => {
  let reviewed = false;
  await assert.rejects(analyzeLecture({ name: 'x.pptx', bytes: pptx(), signal: new AbortController().signal, gemini: async () => { reviewed = true; }, groq: async () => { throw new Error('provider unavailable'); } }), /provider unavailable/);
  assert.equal(reviewed, false);
});
test('authenticated streamed route returns stages, handles failures and rejects unauthorized uploads', async t => {
  const app = express(); app.use('/api/lectures', createLecturesRouter({ requireAuth: (req, res, next) => req.get('Authorization') === 'Bearer test' ? (req.user = { id: 'test' }, next()) : res.sendStatus(401), config: { GEMINI_API_KEY: 'private', GROQ_API_KEY: 'private' }, analyer: async ({ progress, name }) => { progress('extracting'); if (name === 'bad.pdf') throw new Error('Unreadable source'); return { summary: 'ok' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close()); const url = `http://127.0.0.1:${server.address().port}/api/lectures/analyze`;
  const options = { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/octet-stream', 'X-Lecture-Name': 'x.pdf' }, body: Buffer.from('%PDF-1.4 fixture') };
  assert.equal((await fetch(url, { ...options, headers: {} })).status, 401);
  const response = await fetch(url, options); const lines = (await response.text()).trim().split('\n').map(JSON.parse); assert.equal(lines[0].phase, 'extracting'); assert.equal(lines[1].result.summary, 'ok'); assert.ok(!JSON.stringify(lines).includes('private'));
  const failed = await fetch(url, { ...options, headers: { ...options.headers, 'X-Lecture-Name': 'bad.pdf' } }); assert.ok((await failed.text()).includes('Unreadable source'));
});

test('a complete draft surfaces before a failed review without claiming verification', async () => {
  const drafts = [];
  await assert.rejects(analyzeLecture({
    name: 'notes.pptx',
    bytes: pptx(),
    signal: new AbortController().signal,
    groq: async () => ({ summary: 'Summary', explanation: 'Explanation', questions: 'Practice and answers' }),
    preview: draft => drafts.push(draft),
    gemini: async () => {
      assert.equal(drafts.length, 1);
      throw new Error('review unavailable');
    },
  }), /review unavailable/);
  assert.equal(drafts[0].explanation, 'Explanation');
  assert.match(drafts[0].reviewNotes, /لم يراجعها/);
  assert.ok(drafts[0].sources.length);
});
