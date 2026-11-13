import test from 'node:test';
import assert from 'node:assert/strict';
import { executeToolCalls } from './agent-execution.js';
import { runAgentTool } from './agent-tools.js';

test('executes all calls sequentially with matching responses', async () => {
  const actions = [], seen = [];
  const calls = [1, 2].map(n => ({ id: String(n), function: { name: 'write', arguments: JSON.stringify({ n }) } }));
  const results = await executeToolCalls(calls, async (name, args) => { seen.push(args.n); return `saved ${args.n}`; }, actions);
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(results.map(r => r.call.id), ['1', '2']);
  assert.deepEqual(actions.map(a => a.status), ['completed', 'completed']);
});
test('malformed arguments never reach a write tool', async () => {
  let invoked = false;
  const results = await executeToolCalls([{ function: { name: 'write', arguments: '{broken' } }], () => { invoked = true; }, []);
  assert.equal(invoked, false);
  assert.match(results[0].result, /no operation/);
});
test('records uncertain attempts before a remote response fails', async () => {
  const actions = [];
  await executeToolCalls([{ name: 'write', args: {} }], async () => {
    assert.equal(actions[0].status, 'running');
    throw new Error('connection lost');
  }, actions);
  assert.equal(actions[0].status, 'uncertain');
  assert.equal(actions.length, 1);
});
test('tool failures are not marked completed and Gemini calls are supported', async () => {
  const actions = [];
  await executeToolCalls([{ name: 'write', args: { title: 'task' } }], async () => 'tool write failed: offline', actions);
  assert.equal(actions[0].status, 'failed');
});
test('missing required fields cannot create default database records', async () => {
  const result = await runAgentTool('user', 'add_expense', {}, { supabase: { from() { throw new Error('database touched'); } } });
  assert.match(result, /missing required argument amount/);
});
