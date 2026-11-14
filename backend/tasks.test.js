import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTasksRouter, taskFields } from './tasks.js';
test('task validation bounds dates and fields and excludes ownership injection', () => {
  assert.deepEqual(taskFields({ title: ' task ', user_id: 'other', completed: false, due_date: null }), { title: 'task', completed: false, due_date: null });
  for (const body of [{ title: '' }, { title: 'x', due_date: '2026-02-31' }, { title: 'x', completed: 'yes' }, { title: 'x', notes: 'x'.repeat(4001) }]) assert.throws(() => taskFields(body));
  assert.deepEqual(taskFields({ user_id: 'other' }, true), {});
});
test('authenticated task CRUD isolates accounts and handles retried creation', async t => {
  const rows = new Map();
  const supabase = { from(name) {
    assert.equal(name, 'personal_tasks'); let mode = 'select', record, conditions = [];
    const query = {
      select() { return query; }, eq(key, value) { conditions.push([key, value]); return query; }, order() { return query; }, limit() { return query; },
      insert(value) { mode = 'insert'; record = value; return query; }, update(value) { mode = 'update'; record = value; return query; },
      single() { return query.execute(true); }, maybeSingle() { return query.execute(true); }, then(resolve, reject) { return query.execute(false).then(resolve, reject); },
      async execute(single) {
        if (mode === 'insert') { if (rows.has(record.id)) return { data: null, error: { code: '23505' } }; const data = { ...record, notes: record.notes || '', completed: record.completed || false, created_at: new Date().toISOString() }; rows.set(data.id, data); return { data }; }
        const found = [...rows.values()].filter(row => conditions.every(([key, value]) => row[key] === value));
        if (mode === 'update') for (const row of found) Object.assign(row, record);
        return { data: single ? found[0] || null : found };
      },
    }; return query;
  } };
  let proposal = { kind: 'create', title: 'Read', due_date: null };
  const generate = async () => proposal;
  const app = express(); app.use(express.json()); app.use('/api/tasks', createTasksRouter({ supabase, generate, requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: req.headers.authorization }; next(); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (method, route = '', body, user = 'one') => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tasks${route}`, { method, headers: { Authorization: user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await response.text(); return { status: response.status, data: text.startsWith('{') ? JSON.parse(text) : null }; };
  assert.equal((await call('GET', '', null, '')).status, 401);
  const id = '11111111-1111-4111-8111-111111111111'; const body = { id, title: 'Review', due_date: '2026-12-01', user_id: 'two' };
  assert.equal((await call('POST', '', body)).status, 201);
  assert.equal((await call('POST', '', body)).status, 200); assert.equal(rows.size, 1);
  assert.equal((await call('GET')).data.tasks[0].user_id, 'one');
  assert.equal((await call('GET', '', null, 'two')).data.tasks.length, 0);
  assert.equal((await call('PATCH', `/${id}`, { completed: true }, 'two')).status, 404);
  assert.equal((await call('PATCH', `/${id}`, { completed: true })).data.task.completed, true);
  assert.equal((await call('PATCH', `/${id}`, { completed: false, title: 'Edited' })).data.task.title, 'Edited');
  assert.equal((await call('PATCH', `/${id}`, { user_id: 'two' })).status, 400);
  const draft = await call('POST', '/plan', { message: 'add task', timeZone: 'Asia/Riyadh' });
  assert.equal(draft.data.kind, 'task'); assert.equal(draft.data.action, 'create'); assert.equal(rows.size, 1, 'planning does not write');
  proposal = { kind: 'complete', id };
  assert.equal((await call('POST', '/plan', { message: 'finish Edited' }, 'two')).status, 422, 'cannot select another user task');
  assert.equal((await call('POST', '/plan', { message: 'finish Edited' })).data.action, 'complete');
  assert.equal((await call('PATCH', `/${id}`, { completed: true, expected_title: 'old title' })).status, 404);
  assert.equal(rows.get(id).completed, false, 'stale review does not complete renamed task');
  const duplicate = '22222222-2222-4222-8222-222222222222';
  await call('POST', '', { id: duplicate, title: 'Edited' });
  assert.equal((await call('POST', '/plan', { message: 'finish Edited' })).data.kind, 'clarify');
  proposal = { kind: 'create', title: 'Bad date', due_date: '2026-02-31' };
  assert.equal((await call('POST', '/plan', { message: 'add task' })).status, 422);

});
