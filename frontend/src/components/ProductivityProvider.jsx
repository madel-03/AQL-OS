import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ProductivityContext, localDay } from '../lib/productivity-context';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function ProductivityProvider({ children }) {
  const version = useRef(0);
  const [taskTarget, setTaskTarget] = useState(null);
  const [tasks, setTasks] = useState([]); const [events, setEvents] = useState([]); const [calendar, setCalendar] = useState(null);
  const [errors, setErrors] = useState({}); const [loading, setLoading] = useState(true); const [day, setDay] = useState(localDay); const [activity, setActivity] = useState(null);
  const refresh = useCallback(async () => {
    const run = ++version.current;
    const { data } = await supabase.auth.getSession(); if (!data.session) return;
    const get = async path => { const response = await fetch(`${API}/api/${path}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: AbortSignal.timeout(25000) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'تعذّر تحميل البيانات'); return value; };
    await Promise.allSettled([
      (async () => { try { const value = await get('tasks'); if (run !== version.current) return; if (!Array.isArray(value.tasks)) throw new Error('تعذّر تحميل المهام'); setTasks(value.tasks); setErrors(previous => ({ ...previous, tasks: '' })); } catch (error) { if (run === version.current) setErrors(previous => ({ ...previous, tasks: error.message })); } })(),
      (async () => { try { const status = await get('calendar/status'); if (run !== version.current) return; setCalendar(status); if (status.connected) { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); const query = new URLSearchParams({ from: start.toISOString(), until: end.toISOString() }); let all = [], page;
        for (let count = 0; count < 5; count++) { const value = await get(`calendar/events?${query}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`); all = [...all, ...value.events]; page = value.nextPageToken; if (!page) break; }
        if (page) throw new Error('عدد مواعيد اليوم كبير؛ افتح التقويم لعرض القائمة الكاملة.'); if (run !== version.current) return; setEvents(all);
      } else setEvents([]); setErrors(previous => ({ ...previous, calendar: '' })); } catch (error) { if (run === version.current) setErrors(previous => ({ ...previous, calendar: error.message })); } })(),
    ]); if (run === version.current) { setLoading(false); setDay(localDay()); }
  }, []);
  const invalidate = useCallback(() => { version.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); const update = () => { if (document.visibilityState === 'visible') void refresh(); }; const changed = () => { void refresh(); }; const onActivity = event => setActivity(event.detail);
    window.addEventListener('aql-data-changed', changed); window.addEventListener('aql-device-activity', onActivity); document.addEventListener('visibilitychange', update); const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    return () => { invalidate(); clearTimeout(timer); clearInterval(interval); window.removeEventListener('aql-data-changed', changed); window.removeEventListener('aql-device-activity', onActivity); document.removeEventListener('visibilitychange', update); };
  }, [refresh, invalidate]);
  return <ProductivityContext.Provider value={{ taskTarget, setTaskTarget, tasks, events, calendar, errors, loading, day, refresh, activity }}>{children}</ProductivityContext.Provider>;
}
