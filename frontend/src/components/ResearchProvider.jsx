import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ResearchContext, taskFinished } from '../lib/research-context';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
async function request(route, options = {}) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${API}/api/research${route}`, {
    ...options, signal: options.signal || AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
  });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Request failed'); }
  return response;
}

export default function ResearchProvider({ userId, children }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [selected, setSelected] = useState(null);
  const [opening, setOpening] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [voice, setVoice] = useState('idle');
  const previous = useRef(null);
  const alive = useRef(true);
  const creatingRef = useRef(false);
  const detailRequest = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const result = await (await request('')).json();
      if (!alive.current) return;
      const justCompleted = result.tasks.find((task) => task.status === 'completed' && previous.current?.has(task.id) && previous.current.get(task.id) !== 'completed');
      if (justCompleted) setCelebration(justCompleted);
      previous.current = new Map(result.tasks.map((task) => [task.id, task.status]));
      setTasks(result.tasks); setError('');
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false; let timer;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, document.hidden ? 12000 : 4000); };
    void poll();
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; alive.current = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, userId]);
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), 5000);
    return () => clearTimeout(timer);
  }, [celebration]);
  useEffect(() => {
    const listener = (event) => setVoice(event.detail);
    window.addEventListener('aql-voice-state', listener);
    return () => window.removeEventListener('aql-voice-state', listener);
  }, []);
  const openTask = useCallback(async (id) => {
    const revision = ++detailRequest.current;
    setOpening(true); setError('');
    try {
      const task = await (await request(`/${id}`)).json();
      if (alive.current && revision === detailRequest.current) setSelected(task);
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current && revision === detailRequest.current) setOpening(false); }
  }, []);
  const closeTask = useCallback(() => { detailRequest.current++; setSelected(null); setOpening(false); }, []);
  // Keep an open progress preview current as its task advances.
  useEffect(() => {
    if (!selected || taskFinished(selected.status)) return;
    const summary = tasks.find((task) => task.id === selected.id);
    if (!summary || (summary.updated_at === selected.updated_at && summary.status === selected.status)) return;
    const controller = new AbortController();
    const revision = detailRequest.current;
    request(`/${selected.id}`, { signal: controller.signal }).then((response) => response.json()).then((task) => {
      if (!controller.signal.aborted && revision === detailRequest.current) setSelected(task);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [tasks, selected]);
  const startTask = async (topic, lang) => {
    if (creatingRef.current) return null;
    creatingRef.current = true; setCreating(true); setError('');
    try {
      const result = await (await request('', { method: 'POST', body: JSON.stringify({ topic: topic.trim(), lang }) })).json();
      localStorage.setItem(`aql-research-${userId}`, result.id);
      previous.current ||= new Map(); previous.current.set(result.id, 'queued');
      await refresh(); await openTask(result.id); return result.id;
    } catch (err) { setError(err.message); return null; }
    finally { creatingRef.current = false; setCreating(false); }
  };
  const download = async (id, format) => {
    if (exporting) return;
    setExporting(`${id}:${format}`); setError('');
    try {
      let file;
      if (format === 'md') {
        const task = await (await request(`/${id}`)).json();
        file = new Blob(['\uFEFF', task.report], { type: 'text/markdown;charset=utf-8' });
      } else file = await (await request(`/${id}/export?format=${format}`, { signal: AbortSignal.timeout(90000) })).blob();
      const url = URL.createObjectURL(file); const link = document.createElement('a');
      link.href = url; link.download = `aql-research-${id}.${format}`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setExporting(null); }
  };
  const active = tasks.filter((task) => !taskFinished(task.status));
  const assistantState = voice !== 'idle' ? voice : active.length || creating ? 'thinking' : celebration ? 'celebrating' : tasks[0]?.status === 'failed' ? 'attention' : 'ready';
  return <ResearchContext.Provider value={{ tasks, active, loading, error, creating, exporting, selected, opening, celebration, assistantState, refresh, startTask, openTask, closeTask, download, dismissCelebration: () => setCelebration(null) }}>{children}</ResearchContext.Provider>;
}
