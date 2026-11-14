import { useRef, useState } from 'react';
import { supabase } from './supabase';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function useTaskActions(lang) {
  const [awaiting, setAwaiting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [plan, setPlan] = useState(null); const [question, setQuestion] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState('');
  const current = useRef(null); const history = useRef([]); const lock = useRef(false);
  const call = async (path, body, signal, method = 'POST') => {
    const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error(lang === 'en' ? 'Please sign in again.' : 'سجّل الدخول مجددًا.');
    const response = await fetch(`${API}/api/tasks/${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'تعذّر إكمال طلب المهام.'); return value;
  };
  const prepare = async (message, signal) => {
    if (uncertain) return { kind: 'error', message: lang === 'en' ? 'The previous save is uncertain. Confirm the same task again or check your task list before changing it.' : 'حالة الحفظ السابقة غير مؤكدة. أكّد نفس المهمة مرة ثانية أو راجع قائمة المهام قبل تغييره.' };
    if (lock.current) return { kind: 'error', message: lang === 'en' ? 'A request is already running.' : 'فيه طلب قيد التنفيذ الآن.' };
    lock.current = true; setBusy(true); setError(''); setResult(''); setUncertain(false); current.current = null; setPlan(null); setQuestion(''); setAwaiting(false);
    try {
      const value = await call('plan', { message, context: history.current, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, lang }, signal);
      if (signal?.aborted) return { kind: 'cancelled' };
      history.current = [...history.current, message].slice(-6);
      if (value.kind === 'task') { current.current = value; setPlan(value); setQuestion(''); }
      else { current.current = null; setPlan(null); setQuestion(value.question); setAwaiting(value.kind === 'clarify'); if (value.kind === 'unsupported') history.current = []; }
      return value;
    } catch (failure) { if (failure.name === 'AbortError') return { kind: 'cancelled' }; setError(failure.message); return { kind: 'error', message: failure.message }; }
    finally { lock.current = false; setBusy(false); }
  };
  const confirm = async signal => {
    if (lock.current) return lang === 'en' ? 'A request is already running.' : 'فيه طلب قيد التنفيذ الآن.';
    const draft = current.current;
    if (!draft) return lang === 'en' ? 'There is no task awaiting confirmation.' : 'ما فيه مهمة تنتظر التأكيد.';
    if (draft.expiresAt < Date.now()) { current.current = null; setPlan(null); history.current = []; const message = uncertain ? (lang === 'en' ? 'Review expired. Check your task list before creating another task because the earlier save was uncertain.' : 'انتهت المراجعة. راجع قائمة المهام قبل إنشاء مهمة أخرى لأن الحفظ السابق غير مؤكد.') : (lang === 'en' ? 'The review expired. Please request the task again.' : 'انتهت مدة مراجعة المهمة. اطلب تجهيزها مرة ثانية.'); setError(message); return message; }
    lock.current = true; setBusy(true); setError('');
    try {
      const value = await call(draft.action === 'create' ? '' : draft.task.id, draft.action === 'create' ? draft.task : { completed: true, expected_title: draft.task.title }, signal, draft.action === 'create' ? 'POST' : 'PATCH');
      if (!value.task?.id) throw new Error('لم يصل تأكيد حفظ المهمة.');
      current.current = null; setPlan(null); history.current = []; setQuestion(''); setAwaiting(false); setUncertain(false);
      const message = lang === 'en' ? `Task “${draft.task.title}” ${draft.action === 'complete' ? 'completed' : 'saved'}.` : `${draft.action === 'complete' ? 'أنجزت' : 'حفظت'} المهمة «${draft.task.title}».`;
      setResult(message); window.dispatchEvent(new Event('aql-data-changed')); return message;
    } catch {
      setUncertain(true);
      // Keep the same task ID: retry resolves an already-created task without duplication.
      const message = lang === 'en' ? 'I could not confirm the save. The same task is kept for retry; confirm it again or check your task list.' : 'ما قدرت أتأكد من الحفظ. احتفظت بنفس المهمة لإعادة المحاولة؛ أكّدها مرة ثانية أو راجع قائمة المهام.';
      setError(message); return message;
    } finally { lock.current = false; setBusy(false); }
  };
  const cancel = () => { if (lock.current) return false; current.current = null; history.current = []; setPlan(null); setQuestion(''); setAwaiting(false); setError(''); setResult(''); setUncertain(false); return true; };
  return { plan, question, busy, error, result, uncertain, prepare, confirm, cancel, pending: !!plan || awaiting };
}
