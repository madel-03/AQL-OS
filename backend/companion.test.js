import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { companionRouter } from './companion.js';
import { performStep } from './windows-companion.js';

test('desktop folder and note use the Windows desktop destination', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aql-location-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'redirected-desktop');
  await fs.mkdir(desktop);
  const folder = { type: 'folder', location: 'desktop', path: 'جامعة' };
  await assert.rejects(performStep(root, folder));
  await performStep(root, folder, desktop);
  await performStep(root, { type: 'note', location: 'desktop', path: 'جامعة/واجب.txt', content: 'اختبار' }, desktop);
  assert.equal(await fs.readFile(path.join(desktop, 'جامعة/واجب.txt'), 'utf8'), 'اختبار');
  await assert.rejects(fs.stat(path.join(root, 'جامعة')), { code: 'ENOENT' });
});

test('paired phone creates a note, reports its result and stops remaining steps', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aql-companion-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = express();
  const steps = [{ type: 'folder', path: 'جامعة' }, { type: 'note', path: 'جامعة/واجب.txt', content: 'مراجعة المحاضرة' }];
  app.use(express.json(), companionRouter({
    requireAuth(req, res, next) { req.user = { id: req.get('Authorization') }; next(); },
    generate: async (_system, input) => {
      const { message, observations } = JSON.parse(input);
      if (message !== 'شوف مجلد الجامعة') return { steps };
      if (!observations.length) return { steps: [{ type: 'inspect', path: 'جامعة' }] };
      assert.deepEqual(observations[0].entries, ['واجب.txt']);
      return { steps: [{ type: 'note', path: 'جامعة/مراجعة.md', content: observations[0].entries.join(', ') }] };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function call(route, body, token = 'phone') {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const { code } = await call('/pair', {});
  const { token } = await call('/claim', { code });
  assert.equal((await call('/claim', { code })).status, 403);
  assert.equal((await call('/task', { message: 'جهز لي ملف الجامعة' }, 'other')).status, 409);
  await call('/task', { message: 'جهز لي ملف الجامعة' });
  let task = await call('/tick', {}, token);
  assert.deepEqual(task.step, steps[0]);
  assert.equal((await call('/tick', {}, token)).step, undefined);
  for (const step of steps) {
    assert.deepEqual(task.step, step);
    const message = await performStep(root, task.step);
    task = await call('/tick', { report: { id: task.id, index: task.index, ok: true, message } }, token);
  }
  const { job } = await call('/status');
  assert.equal(job.done, true);
  assert.equal(job.results.length, 2);
  assert.equal(await fs.readFile(path.join(root, steps[1].path), 'utf8'), steps[1].content);
  await assert.rejects(performStep(root, steps[1]), { code: 'EEXIST' });
  await assert.rejects(performStep(root, { ...steps[1], path: '../واجب.txt' }));
  await call('/task', { message: 'جهز لي ملف الجامعة' });
  await call('/stop', {});
  assert.equal((await call('/tick', {}, token)).step, undefined);
  assert.equal((await call('/status')).job.done, true);
  await call('/task', { message: 'شوف مجلد الجامعة' });
  task = await call('/tick', {}, token);
  const observation = await performStep(root, task.step);
  task = await call('/tick', { report: { id: task.id, index: task.index, ok: true, ...observation } }, token);
  if (!task.step) task = await call('/tick', {}, token);
  assert.equal(task.index, 1);
  assert.equal(await performStep(root, task.step), 'تم إنشاء الملف جامعة/مراجعة.md');
  assert.equal(await fs.readFile(path.join(root, 'جامعة/مراجعة.md'), 'utf8'), 'واجب.txt');
  await call('/tick', { report: { id: task.id, index: task.index, ok: true, message: 'تم' } }, token);
  await call('/task', { message: 'يا جارفس شغّل تحديثات ستيم المعلّقة' });
  const updateTask = await call('/tick', {}, token);
  assert.deepEqual(updateTask.step, { type: 'steam_updates' });
  await call('/tick', { report: { id: updateTask.id, index: updateTask.index, ok: false, message: 'تعذّر التحقق' } }, token);
  assert.equal((await call('/status')).job.succeeded, false);
});
