const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const array = (value) => Array.isArray(value) ? value : [];
const number = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const id = (value) => text(value, 160);
export const studioKey = (userId) => `aql-studio-v1:${userId}`;
export const defaultStudio = () => ({ tab: 'focus', notes: [], pins: [], projects: [], memories: [], hiddenMemories: [], sessions: [], focus: null, dismissed: {}, ambient: { kind: 'rain', volume: 20, autoLight: false } });
export const tabs = ['focus', 'desk', 'ideas', 'projects', 'memory', 'ambience'];

export function normalizeStudio(input, now = Date.now()) {
  const value = input && typeof input === 'object' ? input : {};
  const result = defaultStudio();
  result.tab = tabs.includes(value.tab) ? value.tab : 'focus';
  result.notes = array(value.notes).slice(0, 75).filter((note) => note && id(note.id)).map((note) => ({ id: id(note.id), title: text(note.title, 100), body: text(note.body, 2000) }));
  result.pins = [...new Set(array(value.pins).filter((pin) => typeof pin === 'string' && /^(note|report|project):/.test(pin)))].slice(0, 60);
  result.projects = array(value.projects).slice(0, 30).filter((project) => project && id(project.id)).map((project) => ({
    id: id(project.id), title: text(project.title, 120), updatedAt: number(project.updatedAt, now, 0, now),
    steps: array(project.steps).slice(0, 30).filter((step) => step && id(step.id)).map((step) => ({ id: id(step.id), text: text(step.text, 220), done: step.done === true })),
    links: array(project.links).slice(0, 12).filter((link) => link && ['research', 'goal', 'project'].includes(link.type)).map((link) => ({ id: id(link.id), type: link.type, title: text(link.title, 500) })),
  }));
  result.memories = array(value.memories).slice(0, 40).filter((entry) => entry && id(entry.id) && text(entry.text, 280)).map((entry) => ({ id: id(entry.id), text: text(entry.text, 280) }));
  result.hiddenMemories = [...new Set(array(value.hiddenMemories).map(id).filter(Boolean))].slice(0, 100);
  result.sessions = array(value.sessions).slice(0, 100).filter((session) => session && id(session.id)).map((session) => ({ id: id(session.id), label: text(session.label, 200), summary: text(session.summary, 1000), activeSeconds: number(session.activeSeconds, 0, 0, 7200), completedAt: number(session.completedAt, now, 0, now), projectId: id(session.projectId) }));
  if (value.focus && id(value.focus.id) && ['running', 'paused', 'review'].includes(value.focus.phase)) {
    const f = value.focus;
    const duration = number(f.duration, 1500, 300, 7200);
    const deadline = number(f.deadline, now, 0, now + 7200000);
    const phase = f.phase === 'running' && deadline <= now ? 'review' : f.phase;
    result.focus = { id: id(f.id), label: text(f.label, 200), duration, remaining: phase === 'review' ? 0 : number(f.remaining, duration, 0, duration), deadline, phase, activeSeconds: phase === 'review' && f.phase === 'running' ? duration : number(f.activeSeconds, 0, 0, duration), projectId: id(f.projectId) };
  }
  const ambient = value.ambient || {};
  result.ambient = { kind: ['rain', 'cafe'].includes(ambient.kind) ? ambient.kind : 'rain', volume: number(ambient.volume, 20, 0, 70), autoLight: ambient.autoLight === true };
  result.dismissed = Object.fromEntries(Object.entries(value.dismissed && typeof value.dismissed === 'object' ? value.dismissed : {}).filter(([key, until]) => key.length <= 180 && Number.isFinite(until) && (until === -1 || until > now)).slice(0, 200));
  return result;
}

export function remainingSeconds(focus, now = Date.now()) {
  if (!focus || focus.phase === 'review') return 0;
  return focus.phase === 'running' ? Math.max(0, Math.min(focus.duration, Math.ceil((focus.deadline - now) / 1000))) : focus.remaining;
}
export function finishSession(focus, now = Date.now()) {
  return { ...focus, phase: 'review', activeSeconds: Math.max(0, focus.duration - remainingSeconds(focus, now)), remaining: 0 };
}
export function projectProgress(project) {
  const total = project.steps.length; const done = project.steps.filter((step) => step.done).length;
  const ratio = total ? done / total : 0;
  return { total, done, ratio, stage: ratio === 1 ? 'bloom' : ratio >= .65 ? 'bud' : ratio >= .3 ? 'grow' : ratio > 0 ? 'sprout' : 'seed' };
}
const stopWords = new Set('the a an and or of to in for is can how really someone into with from what your this عن على إلى في من هل كيف هذا هذه التي الذي مع أو و أن شخص فعلا'.split(' '));
export function topicWords(title) {
  return [...new Set(String(title).toLowerCase().replace(/[\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((word) => !stopWords.has(word));
}
export function ideaEdges(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]; const b = nodes[j];
    const shared = topicWords(a.title).filter((word) => topicWords(b.title).includes(word));
    const linked = a.links?.some((link) => `${link.type}:${link.id}` === b.key) || b.links?.some((link) => `${link.type}:${link.id}` === a.key);
    if (linked || shared.length >= 2) edges.push({ a: a.key, b: b.key, shared, linked: !!linked });
  }
  return edges.slice(0, 60);
}
export function researchGroups(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = String(task.topic).toLowerCase().replace(/[\s?!؟.]+/g, ' ').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return [...groups.entries()].filter(([, group]) => group.length >= 2);
}
export function visibleMemories(state, tasks, en) {
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const derived = [
    ...(completed ? [{ id: 'derived:reports', text: en ? `You have ${completed} completed research reports in your library.` : `عندك ${completed} تقارير بحث مكتملة في المكتبة.` }] : []),
    ...(state.sessions.length ? [{ id: 'derived:focus', text: en ? `You recorded ${state.sessions.length} focus sessions here.` : `سجّلت ${state.sessions.length} جلسات تركيز هنا.` }] : []),
    ...researchGroups(tasks).slice(0, 8).map(([key, group]) => ({ id: `topic:${key}`.slice(0, 160), text: en ? `You started ${group.length} research tasks about “${group[0].topic}”.` : `بدأت ${group.length} مهام بحث عن «${group[0].topic}».` })),
  ];
  const overridden = new Set(state.memories.map((entry) => entry.id));
  return [...state.memories.map((entry) => ({ ...entry, automatic: false })), ...derived.filter((entry) => !overridden.has(entry.id)).map((entry) => ({ ...entry, automatic: true }))].filter((entry) => !state.hiddenMemories.includes(entry.id)).slice(0, 40);
}
export function suggestionsFor(state, tasks, now = Date.now()) {
  const candidates = [];
  const failed = tasks.find((task) => task.status === 'failed');
  if (failed) candidates.push({ id: `retry:${failed.id}`, type: 'retry', task: failed });
  for (const [key, group] of researchGroups(tasks)) if (group.length >= 3) candidates.push({ id: `combine:${key}`.slice(0, 180), type: 'combine', tasks: group.slice(0, 2) });
  const stale = state.projects.find((project) => projectProgress(project).ratio < 1 && now - project.updatedAt > 7 * 86400000);
  if (stale) candidates.push({ id: `project:${stale.id}`, type: 'project', project: stale });
  const old = tasks.find((task) => task.status === 'completed' && now - Date.parse(task.created_at) >= 30 * 86400000);
  if (old) candidates.push({ id: `refresh:${old.id}`, type: 'refresh', task: old });
  return candidates.filter((entry) => state.dismissed[entry.id] !== -1 && !(state.dismissed[entry.id] > now)).slice(0, 2);
}
export function reorderPins(pins, source, target) {
  if (source === target || !pins.includes(source) || !pins.includes(target)) return pins;
  const result = pins.filter((pin) => pin !== source); result.splice(pins.indexOf(target), 0, source); return result;
}
