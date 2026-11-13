import { useRef, useState } from 'react';
import { supabase } from './supabase';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function useCalendarActions(lang) {
  const [awaiting, setAwaiting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [plan, setPlan] = useState(null); const [question, setQuestion] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState('');
  const current = useRef(null); const history = useRef([]); const lock = useRef(false);
  const call = async (path, body, signal) => {
    const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error(lang === 'en' ? 'Please sign in again.' : 'سجّل الدخول مجددًا.');
    const response = await fetch(`${API}/api/calendar/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'تعذّر إكمال طلب التقويم.'); return value;
  };
  const prepare = async (message, signal) => {
    if (uncertain) return { kind: 'error', message: lang === 'en' ? 'The previous save is uncertain. Confirm the same appointment again or check Google Calendar before changing it.' : 'حالة الحفظ السابقة غير مؤكدة. أكّد نفس الموعد مرة ثانية أو راجع Google قبل تغييره.' };
    if (lock.current) return { kind: 'error', message: lang === 'en' ? 'A request is already running.' : 'فيه طلب قيد التنفيذ الآن.' };
    lock.current = true; setBusy(true); setError(''); setResult(''); setUncertain(false); current.current = null; setPlan(null); setQuestion(''); setAwaiting(false);
    try {
      const value = await call('plan', { message, context: history.current, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, lang }, signal);
      if (signal?.aborted) return { kind: 'cancelled' };
      history.current = [...history.current, message].slice(-6);
      if (value.kind === 'event') { current.current = value; setPlan(value); setQuestion(''); }
      else { current.current = null; setPlan(null); setQuestion(value.question); setAwaiting(value.kind === 'clarify'); if (value.kind === 'unsupported') history.current = []; }
      return value;
    } catch (failure) { if (failure.name === 'AbortError') return { kind: 'cancelled' }; setError(failure.message); return { kind: 'error', message: failure.message }; }
    finally { lock.current = false; setBusy(false); }
  };
  const confirm = async signal => {
    if (lock.current) return lang === 'en' ? 'A request is already running.' : 'فيه طلب قيد التنفيذ الآن.';
    const draft = current.current;
    if (!draft) return lang === 'en' ? 'There is no appointment awaiting confirmation.' : 'ما فيه موعد ينتظر التأكيد.';
    if (draft.expiresAt < Date.now()) { current.current = null; setPlan(null); history.current = []; const message = uncertain ? (lang === 'en' ? 'Review expired. Check Google Calendar before creating another appointment because the earlier save was uncertain.' : 'انتهت المراجعة. راجع تقويم Google قبل إنشاء موعد آخر لأن الحفظ السابق غير مؤكد.') : (lang === 'en' ? 'The review expired. Please request the appointment again.' : 'انتهت مدة مراجعة الموعد. اطلب تجهيزه مرة ثانية.'); setError(message); return message; }
    lock.current = true; setBusy(true); setError('');
    try {
      const value = await call('events', draft.event, signal);
      if (!value.event?.id) throw new Error('لم يصل تأكيد حفظ الموعد.');
      current.current = null; setPlan(null); history.current = []; setQuestion(''); setAwaiting(false); setUncertain(false);
      const message = lang === 'en' ? `Saved “${draft.event.title}” in Google Calendar.` : `حفظت موعد «${draft.event.title}» في تقويم Google.`;
      setResult(message); window.dispatchEvent(new Event('aql-data-changed')); return message;
    } catch {
      setUncertain(true);
      // Keep the same event request ID: retry resolves an already-created event without duplication.
      const message = lang === 'en' ? 'I could not confirm the save. The same appointment is kept for retry; confirm it again or check Google Calendar.' : 'ما قدرت أتأكد من الحفظ. احتفظت بنفس الموعد لإعادة المحاولة؛ أكّده مرة ثانية أو راجع تقويم Google.';
      setError(message); return message;
    } finally { lock.current = false; setBusy(false); }
  };
  const cancel = () => { if (lock.current) return false; current.current = null; history.current = []; setPlan(null); setQuestion(''); setAwaiting(false); setError(''); setResult(''); setUncertain(false); return true; };
  return { plan, question, busy, error, result, uncertain, prepare, confirm, cancel, pending: !!plan || awaiting };
}
