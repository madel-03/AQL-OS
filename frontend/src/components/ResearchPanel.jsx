import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const terminal = (status) => ['completed', 'failed'].includes(status);
async function headers() {
  const { data } = await supabase.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` };
}

export default function ResearchPanel() {
  const { lang } = useLang();
  const en = lang === 'en';
  const [topic, setTopic] = useState('');
  const [taskId, setTaskId] = useState(null);
  const [storageKey, setStorageKey] = useState(null);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const running = starting || (taskId && (!job || !terminal(job.status)));
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      const key = `aql-research-${data.session.user.id}`;
      setStorageKey(key);
      setTaskId(localStorage.getItem(key));
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false; let timer;
    const controller = new AbortController();
    const poll = async () => {
      let keepPolling = true;
      try {
        const res = await fetch(`${API_URL}/api/research/${taskId}`, { headers: await headers(), signal: controller.signal });
        const result = await res.json();
        if (!res.ok) { keepPolling = false; throw new Error(result.error || 'Task unavailable'); }
        if (!cancelled) { setJob(result); setError(''); }
        keepPolling = !terminal(result.status);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled && keepPolling) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [taskId]);
  const start = async (event) => {
    event.preventDefault();
    if (running || !storageKey) return;
    setStarting(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/research`, { method: 'POST', headers: await headers(), body: JSON.stringify({ topic: topic.trim(), lang }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not start research');
      localStorage.setItem(storageKey, result.id);
      setJob(null); setTaskId(result.id);
    } catch (err) { setError(err.message); } finally { setStarting(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', job.report], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `aql-research-${job.id}.md`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const steps = en ? { queued: 'Queued', planning: 'Planning the research', searching: 'Searching for sources', reading: 'Reading and checking sources', writing: 'Comparing evidence and drafting', reviewing: 'Checking citations', completed: 'Report ready', failed: 'Research stopped' }
    : { queued: 'في الانتظار', planning: 'أخطط للبحث', searching: 'أبحث عن المصادر', reading: 'أقرأ المصادر وأفحصها', writing: 'أقارن الأدلة وأكتب التقرير', reviewing: 'أراجع المراجع', completed: 'التقرير جاهز', failed: 'توقف البحث' };
  return (
    <details className="research-panel glass-panel" open>
      <summary>{en ? '✦ Research & downloadable report' : '✦ بحث وتقرير قابل للتنزيل'}</summary>
      <p>{en ? 'Give AQL a topic. It searches, reads sources, compares evidence and creates a cited Markdown report.' : 'أعطِ عقل موضوعًا: يبحث، يقرأ المصادر، يقارن الأدلة ويجهّز تقرير Markdown موثّقًا.'}</p>
      <form onSubmit={start} className="research-form">
        <input aria-label={en ? 'Research topic' : 'موضوع البحث'} value={topic} onChange={(event) => setTopic(event.target.value)} minLength={3} maxLength={500} required placeholder={en ? 'e.g. Compare home solar energy storage options' : 'مثل: مقارنة خيارات تخزين الطاقة الشمسية للمنازل'} />
        <button className="primary-action" disabled={!!running || !storageKey || topic.trim().length < 3}>{running ? (en ? 'Working…' : 'أعمل على البحث…') : (en ? 'Start research ↗' : 'ابدأ البحث ↗')}</button>
      </form>
      {error && <p role="alert">{error} <button type="button" onClick={() => { setTaskId(null); setJob(null); if (storageKey) localStorage.removeItem(storageKey); setError(''); }}>{en ? 'Dismiss task' : 'إخفاء المهمة'}</button></p>}
      {job && <div className="research-progress" aria-live="polite">
        <strong>{steps[job.status]}</strong><span data-skip-i18n="1">{job.topic}</span>
        {job.queries && <small data-skip-i18n="1">{job.queries.join(' · ')}</small>}
        {!!job.sources?.length && <ul>{job.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" data-skip-i18n="1">[{source.id}] {source.title}</a></li>)}</ul>}
        {job.error && <p role="alert">{en ? job.error : 'لم يكتمل البحث. قد تكون المصادر غير متاحة أو خدمة الذكاء الاصطناعي متوقفة. جرّب موضوعًا أدق؛ وإذا أُعيد تشغيل الخادم، ابدأ البحث مجددًا.'}</p>}
        {job.status === 'completed' && <>
          <button type="button" className="primary-action" onClick={download}>{en ? 'Download report (.md) ↓' : 'تنزيل التقرير (.md) ↓'}</button>
          <details><summary>{en ? 'Read the report' : 'اقرأ التقرير'}</summary><pre className="research-report" data-skip-i18n="1" dir={job.lang === 'en' ? 'ltr' : 'rtl'}>{job.report}</pre></details>
        </>}
      </div>}
    </details>
  );
}
