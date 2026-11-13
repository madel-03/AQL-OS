import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';
import { useResearch } from '../lib/research-context';
import { StudioContext } from '../lib/studio-context';
import { createAmbience } from '../lib/ambient-audio';
import { defaultStudio, finishSession, normalizeStudio, projectProgress, remainingSeconds, reorderPins, studioKey, suggestionsFor, visibleMemories } from '../lib/studio-model';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const uuid = () => crypto.randomUUID();
export default function StudioProvider({ userId, children }) {
  const { lang } = useLang(); const en = lang === 'en';
  const { tasks } = useResearch();
  const key = studioKey(userId);
  const [state, setState] = useState(() => { try { return normalizeStudio(JSON.parse(localStorage.getItem(key))); } catch { return defaultStudio(); } });
  const current = useRef(state); const audio = useRef(null); const audioVersion = useRef(0); const voice = useRef('idle');
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [audioOn, setAudioOn] = useState(false); const [audioLoading, setAudioLoading] = useState(false);
  const [playingKind, setPlayingKind] = useState(null);
  const [goals, setGoals] = useState([]); const [goalsError, setGoalsError] = useState(false);
  const releaseAudio = useCallback(() => { audioVersion.current++; audio.current?.stop(); audio.current = null; }, []);
  const commit = useCallback((change) => {
    const next = normalizeStudio(typeof change === 'function' ? change(current.current) : change);
    current.current = next; setState(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { setError('STORAGE'); }
    return next;
  }, [key]);
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== key) return;
      try { const next = normalizeStudio(JSON.parse(event.newValue)); current.current = next; setState(next); } catch { setError('STORAGE'); }
    };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, [key]);
  useEffect(() => {
    if (state.focus?.phase !== 'running') return;
    const tick = () => {
      const time = Date.now(); setNow(time);
      const focus = current.current.focus;
      if (focus?.phase === 'running' && time >= focus.deadline) commit((previous) => ({ ...previous, focus: finishSession(focus, time), tab: 'focus' }));
    };
    const timer = setInterval(tick, 1000); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [state.focus?.id, state.focus?.phase, state.focus?.deadline, commit]);
  useEffect(() => {
    if (!state.ambient.autoLight) return;
    const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer);
  }, [state.ambient.autoLight]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const updateVoice = (event) => {
      voice.current = event.detail;
      audio.current?.setVolume(current.current.ambient.volume * (event.detail === 'listening' ? 0 : event.detail === 'speaking' ? .15 : 1));
    };
    window.addEventListener('aql-voice-state', updateVoice);
    return () => { window.removeEventListener('aql-voice-state', updateVoice); releaseAudio(); };
  }, [releaseAudio]);
  useEffect(() => {
    audio.current?.setVolume(state.ambient.volume * (voice.current === 'listening' ? 0 : voice.current === 'speaking' ? .15 : 1));
  }, [state.ambient.volume]);
  const refreshGoals = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`${API}/api/goals`, { headers: { Authorization: `Bearer ${data.session?.access_token || ''}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Goals unavailable');
      const result = await response.json(); setGoals(result.goals || []); setGoalsError(false);
    } catch { setGoalsError(true); }
  }, []);
  const memories = useMemo(() => visibleMemories(state, tasks, en), [state, tasks, en]);
  const suggestions = useMemo(() => suggestionsFor(state, tasks, now), [state, tasks, now]);
  const setTab = (tab) => commit((previous) => ({ ...previous, tab }));
  const startFocus = (label, minutes, projectId) => {
    if (current.current.focus || !label.trim()) return;
    const duration = Math.min(120, Math.max(5, Number(minutes) || 25)) * 60; const time = Date.now(); setNow(time);
    commit((previous) => ({ ...previous, tab: 'focus', focus: { id: uuid(), label, duration, remaining: duration, phase: 'running', deadline: time + duration * 1000, activeSeconds: 0, projectId } }));
  };
  const pauseFocus = () => {
    const focus = current.current.focus; if (!focus || focus.phase !== 'running') return;
    const time = Date.now(); setNow(time);
    commit((previous) => ({ ...previous, focus: { ...focus, phase: 'paused', remaining: remainingSeconds(focus, time) } }));
  };
  const resumeFocus = () => {
    const focus = current.current.focus; if (!focus || focus.phase !== 'paused') return;
    const time = Date.now(); setNow(time);
    commit((previous) => ({ ...previous, focus: { ...focus, phase: 'running', deadline: time + focus.remaining * 1000 } }));
  };
  const finishFocus = () => {
    const focus = current.current.focus; if (!focus || focus.phase === 'review') return;
    commit((previous) => ({ ...previous, tab: 'focus', focus: finishSession(focus) }));
  };
  const saveOutcome = (summary) => {
    const focus = current.current.focus; if (!focus || focus.phase !== 'review' || !summary.trim()) return;
    commit((previous) => ({ ...previous, focus: null, sessions: [{ id: focus.id, label: focus.label, summary, activeSeconds: focus.activeSeconds, completedAt: Date.now(), projectId: focus.projectId }, ...previous.sessions.filter((session) => session.id !== focus.id)] }));
    setNotice(en ? 'Session saved. A small step still counts.' : 'حفظنا الجلسة. خطوة صغيرة، لكنها تحسب.');
  };
  const saveNote = (noteId, title, body) => {
    const note = { id: noteId || uuid(), title, body }; if (!title.trim() && !body.trim()) return;
    commit((previous) => ({ ...previous, notes: [note, ...previous.notes.filter((entry) => entry.id !== note.id)], pins: previous.pins.includes(`note:${note.id}`) ? previous.pins : [...previous.pins, `note:${note.id}`] }));
  };
  const deleteNote = (noteId) => commit((previous) => ({ ...previous, notes: previous.notes.filter((note) => note.id !== noteId), pins: previous.pins.filter((pin) => pin !== `note:${noteId}`) }));
  const pin = (pinId) => commit((previous) => ({ ...previous, pins: [...new Set([...previous.pins, pinId])] }));
  const unpin = (pinId) => commit((previous) => ({ ...previous, pins: previous.pins.filter((entry) => entry !== pinId) }));
  const movePin = (source, target) => commit((previous) => ({ ...previous, pins: reorderPins(previous.pins, source, target) }));
  const createProject = (title, lines = '', links = []) => {
    if (!title.trim()) return null;
    const project = { id: uuid(), title, updatedAt: Date.now(), links, steps: lines.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 30).map((line) => ({ id: uuid(), text: line, done: false })) };
    commit((previous) => ({ ...previous, tab: 'projects', projects: [project, ...previous.projects] })); return project.id;
  };
  const updateProject = (projectId, change) => commit((previous) => ({ ...previous, projects: previous.projects.map((project) => {
    if (project.id !== projectId) return project;
    const next = { ...change(project), updatedAt: Date.now() };
    if (projectProgress(project).ratio < 1 && projectProgress(next).ratio === 1) setNotice(en ? 'Your project is in bloom. You did that.' : 'مشروعك أزهر. هذا إنجازك أنت.');
    return next;
  }) }));
  const deleteProject = (projectId) => commit((previous) => ({ ...previous, projects: previous.projects.filter((project) => project.id !== projectId), pins: previous.pins.filter((pinId) => pinId !== `project:${projectId}`) }));
  const saveMemory = (memoryId, value) => {
    if (!value.trim()) return;
    const entry = { id: memoryId || uuid(), text: value };
    commit((previous) => ({ ...previous, memories: [entry, ...previous.memories.filter((memory) => memory.id !== entry.id)], hiddenMemories: previous.hiddenMemories.filter((hidden) => hidden !== entry.id) }));
  };
  const deleteMemory = (memoryId) => commit((previous) => ({ ...previous, memories: previous.memories.filter((entry) => entry.id !== memoryId), hiddenMemories: [...new Set([...previous.hiddenMemories, memoryId])] }));
  const stopAudio = () => { releaseAudio(); setAudioOn(false); setPlayingKind(null); setAudioLoading(false); };
  const playAudio = async (kind) => {
    const revision = ++audioVersion.current; audio.current?.stop(); audio.current = null; setAudioOn(false); setPlayingKind(null); setAudioLoading(true); setError('');
    commit((previous) => ({ ...previous, ambient: { ...previous.ambient, kind } }));
    try {
      const engine = await createAmbience(kind, current.current.ambient.volume);
      if (audioVersion.current !== revision) { engine.stop(); return; }
      audio.current = engine; engine.setVolume(current.current.ambient.volume * (voice.current === 'listening' ? 0 : voice.current === 'speaking' ? .15 : 1)); setPlayingKind(kind); setAudioOn(true);
    } catch { setError('AUDIO'); } finally { if (audioVersion.current === revision) setAudioLoading(false); }
  };
  const hour = new Date(now).getHours();
  const light = !state.ambient.autoLight ? 'off' : hour >= 7 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night';
  return <StudioContext.Provider value={{ state, commit, setTab, error, clearError: () => setError(''), notice, now, remaining: remainingSeconds(state.focus, now), startFocus, pauseFocus, resumeFocus, finishFocus, saveOutcome, cancelFocus: () => commit((previous) => ({ ...previous, focus: null })), saveNote, deleteNote, pin, unpin, movePin, createProject, updateProject, deleteProject, saveMemory, deleteMemory, memories, memoryForChat: memories.slice(0, 12).map((entry) => entry.text), suggestions, dismissSuggestion: (suggestionId, snooze) => commit((previous) => ({ ...previous, dismissed: { ...previous.dismissed, [suggestionId]: snooze ? Date.now() + 86400000 : -1 } })), resetSuggestions: () => commit((previous) => ({ ...previous, dismissed: {} })), goals, goalsError, refreshGoals, audioOn, audioLoading, playingKind, playAudio, stopAudio }}>
    <div className="studio-scope" data-focus={state.focus?.phase || 'off'} data-light={light}>{children}</div>
  </StudioContext.Provider>;
}
