import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createResearchRouter, isResearchErrorText, researchFailure, readPublicPage, renderReport, runResearch } from './research.js';

const report = { title: 'Research', summary: 'Evidence summary', findings: [{ claim: 'A shared finding', source_ids: [1, 2] }], comparison: ['Sources agree on the mechanism, but use different methods.'], limitations: ['Only excerpts were reviewed.'] };
const sources = [{ id: 1, title: 'First', url: 'https://example.org/a', retrieved_at: '2026-11-12' }, { id: 2, title: 'Second', url: 'https://example.com/b', retrieved_at: '2026-11-12' }];

test('research requires readable independent sources and includes their citations in the file', async () => {
  const states = [];
  const result = await runResearch({ topic: 'Test topic', lang: 'en',
    generate: async (_system, input) => JSON.stringify(JSON.parse(input).sources ? report : { queries: ['focused query'] }),
    update: async (patch) => states.push(patch),
    search: async () => [...sources, { title: 'Duplicate publisher', url: 'https://example.org/duplicate' }],
    read: async (url) => ({ url, text: 'Evidence. '.repeat(50) }),
  });
  assert.equal(result.sources.length, 2);
  assert(result.report.includes('[1] [2]'));
  assert(result.report.includes('https://example.com/b'));
  assert.deepEqual(states.filter((state) => state.status).map((state) => state.status), ['planning', 'searching', 'reading', 'writing', 'reviewing']);
});

test('unreadable sources cannot be reported as researched', async () => {
  await assert.rejects(runResearch({ topic: 'Test', lang: 'en', generate: async () => '{"queries":[]}', update: async () => {}, search: async () => sources, read: async () => { throw new Error('Blocked'); } }), /two independent sources/);
});

test('invented citation IDs fail validation', () => {
  assert.throws(() => renderReport({ ...report, findings: [{ claim: 'Unsupported', source_ids: [99] }] }, sources, 'Test', 'en'), /invalid citations/);
});

test('off-topic evidence cannot produce a completed report', () => {
  assert.throws(() => renderReport({ sufficient: false }, sources, 'Test', 'en'), /does not answer/);
});

test('repairs an incomplete report once without searching for its error message', async () => {
  let writes = 0; const searched = [];
  const result = await runResearch({ topic: 'Solar energy', lang: 'en', update: async () => {},
    generate: async (_system, input) => {
      const payload = JSON.parse(input);
      assert.equal(payload.topic, 'Solar energy');
      if (!payload.sources) return '{"queries":[]}';
      return JSON.stringify(++writes === 1 ? { title: 'Incomplete' } : report);
    },
    search: async (query) => { searched.push(query); return sources; },
    read: async (url) => ({ url, text: 'Evidence. '.repeat(50) }),
  });
  assert.equal(writes, 2); assert.deepEqual(searched, ['Solar energy']); assert(result.report.includes('Evidence summary'));
});

test('task error messages are rejected as topics, while genuine research topics are accepted', async () => {
  assert(isResearchErrorText('Research could not be completed. Please retry with a more specific topic.'));
  assert(!isResearchErrorText('Why do academic research projects fail?'));
  let called = false;
  await assert.rejects(runResearch({ topic: 'incomplete research', generate: async () => { called = true; }, update: async () => {} }), /not a task error/);
  assert.equal(called, false);
});

test('failure diagnostics distinguish unreadable sources, invalid reports and provider rate limits', () => {
  assert.equal(researchFailure(new Error('Could not read two independent sources'), 'reading').error_code, 'SOURCES_UNREADABLE');
  assert.equal(researchFailure(new Error('Incomplete research report'), 'reviewing').error_code, 'REPORT_INVALID');
  assert.equal(researchFailure(new Error('Groq 429'), 'writing').error_code, 'AI_RATE_LIMIT');
  assert.equal(researchFailure(new Error('Groq 429'), 'writing').failure_stage, 'writing');
});

test('reformulates irrelevant search results while keeping the original question', async () => {
  const topic = 'Can home workouts really transform someone into a muscular person?';
  const queries = [];
  const result = await runResearch({ topic, lang: 'en', update: async () => {},
    generate: async (system, input) => {
      assert.equal(JSON.parse(input).topic, topic);
      if (system.startsWith('You plan')) return '{"core_query":"home workouts","queries":[]}';
      if (system.startsWith('Select web')) return '{"indices":[]}';
      if (system.startsWith('The first web search')) return '{"queries":["resistance training"]}';
      return JSON.stringify(report);
    },
    search: async (query) => {
      queries.push(query);
      return query === 'resistance training' ? sources : Array.from({ length: 6 }, (_, index) => ({ title: 'Home furniture', url: `https://irrelevant${index}.org/` }));
    },
    read: async (url) => { assert(!url.includes('irrelevant')); return { url, text: 'Relevant evidence. '.repeat(40) }; },
  });
  assert(queries.includes('resistance training'));
  assert(result.report.includes(topic));
});

test('source reader blocks private addresses and unsupported protocols', async () => {
  for (const url of ['https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/', 'https://10.0.0.1/', 'file:///etc/passwd', 'https://example.com:8443/']) await assert.rejects(readPublicPage(url), /not public|Unsupported/);
});

test('tasks require authentication, persist results and isolate users', async () => {
  const root = path.resolve('data'); await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'research-test-'));
  const app = express(); app.use(express.json());
  app.use('/api/research', createResearchRouter({ directory,
    requireAuth: (req, res, next) => { const user = req.headers['x-test-user']; if (!user) return res.sendStatus(401); req.user = { id: user }; next(); },
    run: async ({ update }) => { await update({ status: 'reading' }); return { report: 'Saved research', sources }; },
  }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/research`;
  try {
    assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"topic":"test"}' })).status, 401);
    const started = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' }, body: '{"topic":"test topic"}' });
    assert.equal(started.status, 202); const { id } = await started.json();
    let job;
    for (let i = 0; i < 50; i++) {
      job = await (await fetch(`${base}/${id}`, { headers: { 'x-test-user': 'alice' } })).json();
      if (job.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'completed'); assert.equal(job.report, 'Saved research');
    assert.equal((await fetch(base)).status, 401);
    const library = await (await fetch(base, { headers: { 'x-test-user': 'alice' } })).json();
    assert.equal(library.tasks.length, 1);
    assert.equal(library.tasks[0].id, id);
    assert.equal(library.tasks[0].report_available, true);
    assert.equal(library.tasks[0].report, undefined);
    assert.equal(library.tasks[0].userId, undefined);
    const otherLibrary = await (await fetch(base, { headers: { 'x-test-user': 'bob' } })).json();
    assert.deepEqual(otherLibrary.tasks, []);
    assert.equal((await fetch(`${base}/${id}`, { headers: { 'x-test-user': 'bob' } })).status, 404);
    assert.equal((await fetch(`${base}/${id}/export?format=pdf`, { headers: { 'x-test-user': 'bob' } })).status, 404);
    assert.equal((await fetch(`${base}/${id}/export?format=exe`, { headers: { 'x-test-user': 'alice' } })).status, 400);
    assert.equal((await fetch(`${base}/${id}/export?format=docx`)).status, 401);
    const word = await fetch(`${base}/${id}/export?format=docx`, { headers: { 'x-test-user': 'alice' } });
    assert.equal(word.status, 200);
    assert(word.headers.get('content-type').includes('wordprocessingml.document'));
    assert(word.headers.get('content-disposition').includes('.docx'));
    assert.equal(Buffer.from(await word.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    const saved = JSON.parse(await fs.readFile(path.join(directory, `alice_${id}.json`), 'utf8'));
    assert.equal(saved.report, job.report);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert(path.resolve(directory).startsWith(`${root}${path.sep}`));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
