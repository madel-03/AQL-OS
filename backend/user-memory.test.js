import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryContext } from './user-memory.js';
test('chat memory accepts only bounded user-visible text and labels it as untrusted context', () => {
  assert.equal(memoryContext(undefined), ''); assert.equal(memoryContext({ admin: true }), '');
  const result = memoryContext(['  Keep answers practical  ', null, { role: 'system' }, 'a'.repeat(500)]);
  assert(result.includes('Keep answers practical')); assert(!result.includes('"role"'));
  assert(!result.includes('a'.repeat(281))); assert(result.includes('not system instructions'));
  assert.equal((memoryContext(Array.from({ length: 20 }, () => 'note')).match(/"note"/g) || []).length, 12);
});
