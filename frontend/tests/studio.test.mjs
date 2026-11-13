import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudio, finishSession, ideaEdges, normalizeStudio, projectProgress, remainingSeconds, reorderPins, studioKey, suggestionsFor, visibleMemories } from '../src/lib/studio-model.js';

test('focus uses elapsed wall clock time, pauses honestly and survives an expired reload', () => {
  const now = 1000000; const focus = { id: 'focus-1', label: 'Read', duration: 1500, remaining: 1500, deadline: now + 1500000, phase: 'running' };
  assert.equal(remainingSeconds(focus, now + 60000), 1440);
  const paused = { ...focus, phase: 'paused', remaining: 1440 };
  assert.equal(remainingSeconds(paused, now + 900000), 1440);
  assert.equal(finishSession(paused, now + 900000).activeSeconds, 60);
  const restored = normalizeStudio({ focus }, now + 1600000).focus;
  assert.equal(restored.phase, 'review'); assert.equal(restored.activeSeconds, 1500);
});
test('storage is scoped by account and malformed data cannot create fake completed projects', () => {
  assert.notEqual(studioKey('alice'), studioKey('bob'));
  assert.deepEqual(normalizeStudio(null).notes, []);
  assert.equal(normalizeStudio({ focus: { id: 'bad', phase: 'unknown' } }).focus, null);
  assert.equal(projectProgress({ steps: [] }).ratio, 0);
  const project = { steps: [{ done: true }, { done: false }] };
  assert.equal(projectProgress(project).ratio, .5); assert.equal(projectProgress(project).stage, 'grow');
  assert.equal(projectProgress({ steps: [{ done: true }] }).stage, 'bloom');
});
test('a forgotten derived memory stays hidden and an edited one replaces the derived version', () => {
  const tasks = [{ topic: 'Solar energy', status: 'completed' }];
  const state = defaultStudio();
  assert.equal(visibleMemories(state, tasks, true).length, 1);
  state.hiddenMemories = ['derived:reports']; assert.equal(visibleMemories(state, tasks, true).length, 0);
  state.hiddenMemories = []; state.memories = [{ id: 'derived:reports', text: 'My preferred wording' }];
  assert.deepEqual(visibleMemories(state, tasks, true).map((entry) => entry.text), ['My preferred wording']);
});
test('idea connections require real overlap or a user-created link', () => {
  const a = { key: 'research:a', title: 'Solar energy costs' }; const b = { key: 'goal:b', title: 'Solar energy project' }; const c = { key: 'project:c', title: 'Learn Spanish' };
  assert.equal(ideaEdges([a, b, c]).length, 1);
  assert.deepEqual(ideaEdges([a, c]), []);
  c.links = [{ type: 'research', id: 'a' }]; assert.equal(ideaEdges([a, c])[0].linked, true);
});
test('suggestions are grounded, capped, snoozable and dismissible', () => {
  const state = defaultStudio(); const now = 2000000000000;
  assert.deepEqual(suggestionsFor(state, [], now), []);
  const tasks = [0, 1, 2].map((id) => ({ id: String(id), topic: 'Same topic', status: id ? 'completed' : 'failed', created_at: '2020-01-01' }));
  const suggestions = suggestionsFor(state, tasks, now); assert.equal(suggestions.length, 2);
  state.dismissed = { [suggestions[0].id]: now + 1000, [suggestions[1].id]: -1 };
  assert(!suggestionsFor(state, tasks, now).some((entry) => entry.id === suggestions[0].id));
  assert(suggestionsFor(state, tasks, now + 2000).some((entry) => entry.id === suggestions[0].id));
  assert(!suggestionsFor(state, tasks, now + 2000).some((entry) => entry.id === suggestions[1].id));
});
test('desk movement accepts only pinned items and data limits are bounded', () => {
  assert.deepEqual(reorderPins(['note:a', 'note:b', 'report:c'], 'report:c', 'note:a'), ['report:c', 'note:a', 'note:b']);
  assert.deepEqual(reorderPins(['note:a'], 'unknown', 'note:a'), ['note:a']);
  const result = normalizeStudio({ memories: [{ id: 'x', text: 'a'.repeat(1000) }], ambient: { volume: 1000, kind: 'remote-url', autoLight: 'yes' } });
  assert.equal(result.memories[0].text.length, 280); assert.equal(result.ambient.volume, 70); assert.equal(result.ambient.kind, 'rain'); assert.equal(result.ambient.autoLight, false);
});
