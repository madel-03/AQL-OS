import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createResearchRouter, readPublicPage, renderReport, runResearch } from './research.js';

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
    assert.equal((await fetch(`${base}/${id}`, { headers: { 'x-test-user': 'bob' } })).status, 404);
    const saved = JSON.parse(await fs.readFile(path.join(directory, `alice_${id}.json`), 'utf8'));
    assert.equal(saved.report, job.report);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert(path.resolve(directory).startsWith(`${root}${path.sep}`));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
