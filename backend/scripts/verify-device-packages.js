// Network smoke test: install a small public package in a separate QA workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createDeviceBridge } from '../device-bridge.js';

await fs.mkdir('data/device-qa', { recursive: true });
const root = await fs.mkdtemp(path.resolve('data/device-qa/npm-'));
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'aql-package-smoke', version: '1.0.0', private: true, dependencies: { 'is-number': '7.0.0' }, scripts: { verify: 'node -e "if (!require(\'is-number\')(42)) process.exit(1); console.log(\'installed-package-ok\')"' } }));
const bridge = await createDeviceBridge({ workspace: root, allowRun: true, jobOptions: { timeoutMs: 60000 } });
const server = bridge.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const request = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
};
try {
  const preview = await request('preview', { summary: 'Install and verify is-number 7.0.0', operations: [{ type: 'npm_install', path: '' }, { type: 'npm_script', path: '', script: 'verify' }] });
  const outcome = await request('execute', { id: preview.id, allowCodeExecution: true });
  let job;
  for (let attempt = 0; attempt < 350; attempt++) {
    job = (await request('jobs')).jobs[0];
    if (!['running', 'stopping'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(job.status, 'completed', job.output); assert.match(job.output, /installed-package-ok/);
  const installed = JSON.parse(await fs.readFile(path.join(root, 'node_modules/is-number/package.json'), 'utf8'));
  assert.equal(installed.version, '7.0.0');
  assert.equal(outcome.accepted, true);
  console.log(`PASS: downloaded is-number@7.0.0 from the public npm registry and ran the project verification script in ${root}`);
} finally { await bridge.close(); await new Promise(resolve => server.close(resolve)); }
