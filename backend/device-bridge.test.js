import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeviceBridge } from './device-bridge.js';
import { createDevicePlanRouter, validateDevicePlan } from './device-plan.js';
import express from 'express';
import http from 'node:http';

async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aql-device-test-'));
  const root = path.join(base, 'workspace'); await fs.mkdir(root);
  const bridge = await createDeviceBridge({ workspace: root, token: 'test-device-key', origins: ['https://allowed.example'], ...options });
  const server = bridge.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await bridge.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, headers = {}) => {
    if (headers.Host) return new Promise((resolve, reject) => {
      const req = http.get(`${url}/${route}`, { headers: { Authorization: 'Bearer test-device-key', ...headers } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) }));
      });
      req.on('error', reject);
    });
    const response = await fetch(`${url}/${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer test-device-key', 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  return { root, base, request };
}

test('device key, exact origin and loopback host are enforced', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('status', null, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request('status', null, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('status', null, { Host: 'evil.example' })).status, 403);
  assert.equal((await request('status', null, { Origin: 'https://allowed.example' })).status, 200);
});

async function waitJob(request, id, predicate = job => !['running', 'stopping'].includes(job.status)) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const job = (await request('jobs')).data.jobs.find(item => item.id === id);
    if (job && predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for local test job');
}

test('programs require bridge opt-in and explicit preview approval', async t => {
  const locked = await fixture(t);
  await fs.writeFile(path.join(locked.root, 'app.js'), 'console.log("ok")');
  assert.notEqual((await locked.request('preview', { summary: 'Run', operations: [{ type: 'run_node', path: 'app.js' }] })).status, 200);
  const enabled = await fixture(t, { allowRun: true });
  const plan = { summary: 'Write and run', operations: [{ type: 'write_file', path: 'app.js', content: 'console.log("local-success")' }, { type: 'run_node', path: 'app.js' }] };
  const preview = (await enabled.request('preview', plan)).data;
  assert.match(preview.operations[1].source, /local-success/);
  assert.equal((await enabled.request('execute', { id: preview.id })).status, 400);
  await assert.rejects(fs.access(path.join(enabled.root, 'app.js')));
  const outcome = (await enabled.request('execute', { id: preview.id, allowCodeExecution: true })).data;
  assert.equal(outcome.accepted, true);
  const job = await waitJob(enabled.request, outcome.jobId);
  assert.equal(job.status, 'completed'); assert.match(job.output, /local-success/);
  assert.equal((await enabled.request('execute', { id: preview.id, allowCodeExecution: true })).status, 409);
});

test('local job failure skips later commands and cannot silently turn into success', async t => {
  const { root, request } = await fixture(t, { allowRun: true });
  await fs.writeFile(path.join(root, 'bad.js'), 'process.exit(7)');
  await fs.writeFile(path.join(root, 'later.js'), 'console.log("must-not-run")');
  const preview = (await request('preview', { summary: 'Failure', operations: [{ type: 'run_node', path: 'bad.js' }, { type: 'run_node', path: 'later.js' }] })).data;
  const outcome = (await request('execute', { id: preview.id, allowCodeExecution: true })).data;
  const job = await waitJob(request, outcome.jobId);
  assert.equal(job.status, 'failed'); assert.equal(job.exitCode, 7);
  assert.deepEqual(job.steps.map(step => step.status), ['failed', 'skipped']);
  assert.equal(job.output.includes('must-not-run'), false);
});

test('running processes can be stopped and output is bounded', async t => {
  const { root, request } = await fixture(t, { allowRun: true, jobOptions: { outputLimit: 1000 } });
  await fs.writeFile(path.join(root, 'server.js'), 'console.log("x".repeat(3000)); setInterval(() => console.log("heartbeat"), 20);');
  const preview = (await request('preview', { summary: 'Server', operations: [{ type: 'run_node', path: 'server.js' }] })).data;
  const outcome = (await request('execute', { id: preview.id, allowCodeExecution: true })).data;
  const running = await waitJob(request, outcome.jobId, job => job.output.includes('heartbeat'));
  assert.equal(running.truncated, true); assert(running.output.length <= 1000);
  assert.equal((await request('stop', { id: outcome.jobId })).status, 200);
  assert.equal((await waitJob(request, outcome.jobId)).status, 'stopped');
});

test('timeouts stop programs and stale source versions reject execution', async t => {
  const { root, request } = await fixture(t, { allowRun: true, jobOptions: { timeoutMs: 500 } });
  await fs.writeFile(path.join(root, 'app.js'), 'setInterval(() => {}, 1000)');
  const plan = { summary: 'Timeout', operations: [{ type: 'run_node', path: 'app.js' }] };
  const stale = (await request('preview', plan)).data;
  await fs.writeFile(path.join(root, 'app.js'), 'setInterval(() => {}, 2000)');
  assert.equal((await request('execute', { id: stale.id, allowCodeExecution: true })).status, 409);
  const preview = (await request('preview', plan)).data;
  const outcome = (await request('execute', { id: preview.id, allowCodeExecution: true })).data;
  assert.equal((await waitJob(request, outcome.jobId)).status, 'timed_out');
});

test('npm installation skips lifecycle hooks and selected scripts skip pre/post hooks', async t => {
  const { root, request } = await fixture(t, { allowRun: true });
  const manifest = { name: 'aql-test-project', version: '1.0.0', private: true, scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(\'install-hook.txt\',\'bad\')"', predemo: 'node -e "require(\'fs\').writeFileSync(\'pre-hook.txt\',\'bad\')"', demo: 'node -e "console.log(\'script-success\')"', postdemo: 'node -e "require(\'fs\').writeFileSync(\'post-hook.txt\',\'bad\')"' } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  const preview = (await request('preview', { summary: 'Install and run', operations: [{ type: 'npm_install', path: '' }, { type: 'npm_script', path: '', script: 'demo' }] })).data;
  assert.equal(preview.operations[1].scriptContent, manifest.scripts.demo);
  const outcome = (await request('execute', { id: preview.id, allowCodeExecution: true })).data;
  const job = await waitJob(request, outcome.jobId);
  assert.equal(job.status, 'completed', job.output); assert.match(job.output, /script-success/);
  for (const name of ['install-hook.txt', 'pre-hook.txt', 'post-hook.txt']) await assert.rejects(fs.access(path.join(root, name)));
  await fs.access(path.join(root, 'package-lock.json'));
});

test('process plans reject commands after file phase, missing scripts and external dependency specs', async t => {
  const { root, request } = await fixture(t, { allowRun: true });
  await fs.writeFile(path.join(root, 'app.js'), 'console.log("ok")');
  const invalidOrder = { summary: 'Bad order', operations: [{ type: 'run_node', path: 'app.js' }, { type: 'write_file', path: 'later.txt', content: 'no' }] };
  assert.notEqual((await request('preview', invalidOrder)).status, 200);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { bad: 'file:../private' } }));
  assert.notEqual((await request('preview', { summary: 'Bad dependencies', operations: [{ type: 'npm_install', path: '' }] })).status, 200);
  assert.notEqual((await request('preview', { summary: 'Missing script', operations: [{ type: 'npm_script', path: '', script: 'missing' }] })).status, 200);
});
test('paths, hidden secrets, links, binary and large files are rejected', async t => {
  const { root, base, request } = await fixture(t);
  await fs.writeFile(path.join(root, '.env'), 'secret');
  await fs.writeFile(path.join(root, 'binary.txt'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, 'large.txt'), 'x'.repeat(180001));
  await fs.writeFile(path.join(base, 'outside.txt'), 'private');
  await fs.link(path.join(base, 'outside.txt'), path.join(root, 'linked.txt'));
  await fs.symlink(base, path.join(root, 'junction'), 'junction');
  for (const filename of ['../outside.txt', '/outside.txt', 'C:/outside.txt', '.env', 'binary.txt', 'large.txt', 'linked.txt', 'junction/outside.txt', 'x.txt:stream', 'CON.txt', 'folder/../outside.txt', 'folder\\file.txt']) {
    assert.notEqual((await request('read', { path: filename })).status, 200, filename);
  }
  const list = (await request('list', { path: '' })).data.entries;
  assert.equal(list.some(entry => ['.env', 'linked.txt', 'junction'].includes(entry.name)), false);
});
test('preview does not write; approval creates a project and runs syntax check without executing code', async t => {
  const { root, request } = await fixture(t);
  const plan = { summary: 'Create demo', operations: [
    { type: 'write_file', path: 'demo/index.html', content: '<h1>مرحبا</h1>' },
    { type: 'write_file', path: 'demo/app.js', content: "throw new Error('this must never run');" },
    { type: 'check_javascript', path: 'demo/app.js' },
  ] };
  const preview = await request('preview', plan); assert.equal(preview.status, 200);
  await assert.rejects(fs.access(path.join(root, 'demo')));
  const executed = await request('execute', { id: preview.data.id });
  assert.equal(executed.data.completed, true);
  assert.equal(await fs.readFile(path.join(root, 'demo/index.html'), 'utf8'), '<h1>مرحبا</h1>');
  assert.equal((await request('execute', { id: preview.data.id })).status, 409);
});
test('updates show original, make backups and reject stale previews before any write', async t => {
  const { root, request } = await fixture(t);
  await fs.writeFile(path.join(root, 'note.md'), 'before');
  const plan = { summary: 'Update', operations: [{ type: 'write_file', path: 'note.md', content: 'after' }] };
  const first = (await request('preview', plan)).data;
  assert.equal(first.operations[0].before, 'before');
  await fs.writeFile(path.join(root, 'note.md'), 'concurrent edit');
  assert.equal((await request('execute', { id: first.id })).status, 409);
  assert.equal(await fs.readFile(path.join(root, 'note.md'), 'utf8'), 'concurrent edit');
  const second = (await request('preview', plan)).data;
  assert.equal((await request('execute', { id: second.id })).data.completed, true);
  const backupName = (await fs.readdir(path.join(root, '.aql-backups')))[0];
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.aql-backups', backupName), 'utf8')).content, 'concurrent edit');
});
test('syntax failure stops later writes and keeps accurate partial results', async t => {
  const { root, request } = await fixture(t);
  const preview = (await request('preview', { summary: 'Test failure', operations: [
    { type: 'write_file', path: 'bad.js', content: 'const =' },
    { type: 'check_javascript', path: 'bad.js' },
    { type: 'write_file', path: 'later.txt', content: 'must not appear' },
  ] })).data;
  const outcome = (await request('execute', { id: preview.id })).data;
  assert.equal(outcome.completed, false);
  assert.deepEqual(outcome.results.map(result => result.status), ['completed', 'failed']);
  await assert.rejects(fs.access(path.join(root, 'later.txt')));
});
test('shell commands, duplicate writes and unsupported types cannot be approved', async t => {
  const { request } = await fixture(t);
  assert.throws(() => validateDevicePlan({ summary: 'x', operations: [{ type: 'shell', path: 'anything' }] }));
  const operation = { type: 'write_file', path: 'test.txt', content: 'x' };
  assert.notEqual((await request('preview', { summary: 'x', operations: [operation, operation] })).status, 200);
  assert.notEqual((await request('preview', { summary: 'x', operations: [{ ...operation, path: 'run.exe' }] })).status, 200);
});
test('planning requires authentication and forwards only selected bounded file context', async t => {
  const app = express(); app.use(express.json()); let input;
  app.use('/api/device', createDevicePlanRouter({ requireAuth: (req, res, next) => req.headers.authorization === 'Bearer user' ? next() : res.sendStatus(401), generate: async (system, value) => { input = JSON.parse(value); return JSON.stringify({ summary: 'x', operations: [{ type: 'write_file', path: 'demo.txt', content: 'hello' }] }); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/device/plan`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Make file', token: 'never forward', workspace: 'C:/private', entries: ['demo.txt'], attachment: { path: 'demo.txt', content: 'a'.repeat(50000) } }) });
  assert.equal(response.status, 200); assert.equal(input.selectedFile.content.length, 45000);
  assert.equal(JSON.stringify(input).includes('never forward'), false);
  assert.equal(JSON.stringify(input).includes('C:/private'), false);
});
