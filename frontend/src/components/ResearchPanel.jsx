import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const terminal = (status) => ['completed', 'failed'].includes(status);
const arabicErrors = {
  SEARCH_UNAVAILABLE: 'لم تُرجع خدمة البحث نتائج قابلة للاستخدام. حاول بعد قليل أو بسّط الموضوع.',
  INSUFFICIENT_EVIDENCE: 'المصادر المسترجعة لا تجيب عن الموضوع بما يكفي. حدّد سؤالك أو اختر موضوعًا أوسع.',
  SOURCES_UNREADABLE: 'تعذّرت قراءة مصدرين مختلفين. بعض المواقع تمنع القراءة الآلية أو تتطلب تسجيل الدخول.',
  REPORT_INVALID: 'ردّ النموذج بتقرير ناقص أو مراجع غير صحيحة، حتى بعد محاولة إصلاحه. أعد المحاولة بالموضوع الأصلي.',
  AI_RATE_LIMIT: 'وصلت خدمة الذكاء الاصطناعي إلى حد الطلبات. انتظر قليلًا ثم أعد المحاولة.',
  AI_CONFIGURATION: 'رفض مزوّد الذكاء الاصطناعي الطلب. يلزم فحص المفتاح والرصيد والموديلات المفعّلة في الخادم.',
  TIMEOUT: 'انتهت مهلة أحد طلبات البحث أو الذكاء الاصطناعي. أعد المحاولة بالموضوع الأصلي.',
  AI_UNAVAILABLE: 'تعذّر إكمال الطلب لدى مزوّد الذكاء الاصطناعي. حاول بعد قليل.',
  SERVER_RESTARTED: 'أُعيد تشغيل الخادم أثناء المهمة. أعد المحاولة بالموضوع الأصلي.',
  RESEARCH_FAILED: 'توقفت المهمة. أعد المحاولة بالموضوع الأصلي؛ راجع سجل الخادم إذا تكرر الفشل.',
};
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
  const [exporting, setExporting] = useState(null);
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
        if (!cancelled) { setJob(result); setError(''); setTopic((previous) => previous || result.topic || ''); }
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
  const startResearch = async (researchTopic) => {
    if (running || !storageKey) return;
    setStarting(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/research`, { method: 'POST', headers: await headers(), body: JSON.stringify({ topic: researchTopic.trim(), lang }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not start research');
      localStorage.setItem(storageKey, result.id);
      setJob(null); setTaskId(result.id);
    } catch (err) { setError(err.message); } finally { setStarting(false); }
  };
  const start = (event) => { event.preventDefault(); void startResearch(topic); };
  const download = async (format) => {
    if (exporting) return;
    setExporting(format); setError('');
    try {
      let file;
      if (format === 'md') file = new Blob(['\uFEFF', job.report], { type: 'text/markdown;charset=utf-8' });
      else {
        const response = await fetch(`${API_URL}/api/research/${job.id}/export?format=${format}`, { headers: await headers() });
        if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Export failed'); }
        file = await response.blob();
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = `aql-research-${job.id}.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); } finally { setExporting(null); }
  };
  const steps = en ? { queued: 'Queued', planning: 'Planning the research', searching: 'Searching for sources', reading: 'Reading and checking sources', writing: 'Comparing evidence and drafting', reviewing: 'Checking citations', completed: 'Report ready', failed: 'Research stopped' }
    : { queued: 'في الانتظار', planning: 'أخطط للبحث', searching: 'أبحث عن المصادر', reading: 'أقرأ المصادر وأفحصها', writing: 'أقارن الأدلة وأكتب التقرير', reviewing: 'أراجع المراجع', completed: 'التقرير جاهز', failed: 'توقف البحث' };
  return (
    <details className="research-panel glass-panel" open>
      <summary>{en ? '✦ Research & downloadable report' : '✦ بحث وتقرير قابل للتنزيل'}</summary>
      <p>{en ? 'Give AQL a topic. It searches, compares sources and creates a cited report you can download as PDF or Word.' : 'أعطِ عقل موضوعًا: يبحث، يقارن المصادر ويجهّز تقريرًا موثّقًا للتنزيل بصيغة PDF أو Word.'}</p>
      <form onSubmit={start} className="research-form">
        <input aria-label={en ? 'Research topic' : 'موضوع البحث'} value={topic} onChange={(event) => setTopic(event.target.value)} minLength={3} maxLength={500} required placeholder={en ? 'e.g. Compare home solar energy storage options' : 'مثل: مقارنة خيارات تخزين الطاقة الشمسية للمنازل'} />
        <button className="primary-action" disabled={!!running || !storageKey || topic.trim().length < 3}>{running ? (en ? 'Working…' : 'أعمل على البحث…') : (en ? 'Start research ↗' : 'ابدأ البحث ↗')}</button>
      </form>
      {error && <p role="alert">{error} <button type="button" onClick={() => { setTaskId(null); setJob(null); if (storageKey) localStorage.removeItem(storageKey); setError(''); }}>{en ? 'Dismiss task' : 'إخفاء المهمة'}</button></p>}
      {job && <div className="research-progress" aria-live="polite">
        <strong>{steps[job.status]}</strong><span data-skip-i18n="1">{job.topic}</span>
        {job.queries && <details><summary>{en ? 'Search queries' : 'عبارات البحث'}</summary><ul data-skip-i18n="1">{job.queries.map((query, index) => <li key={index}>{query}</li>)}</ul></details>}
        {!!job.sources?.length && <ul>{job.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" data-skip-i18n="1">[{source.id}] {source.title}</a></li>)}</ul>}
        {job.error && <div data-skip-i18n="1">
          <p role="alert">{en ? job.error : (arabicErrors[job.error_code] || 'هذه مهمة قديمة فشلت دون حفظ السبب التفصيلي. أعدها بالموضوع الأصلي، وليس برسالة الخطأ.')}</p>
          {job.failure_stage && <small>{en ? 'Stopped at: ' : 'توقفت عند: '}{steps[job.failure_stage] || job.failure_stage}</small>}
          <div><button type="button" className="secondary-action" disabled={!!running || !storageKey} onClick={() => { setTopic(job.topic); void startResearch(job.topic); }}>{en ? 'Retry original topic' : 'إعادة البحث بالموضوع الأصلي'}</button></div>
        </div>}
        {job.status === 'completed' && <>
          <div className="research-downloads">
            <button type="button" className="primary-action" disabled={!!exporting} onClick={() => download('pdf')}>{exporting === 'pdf' ? (en ? 'Preparing PDF…' : 'أجهّز PDF…') : (en ? 'Download PDF ↓' : 'تنزيل PDF ↓')}</button>
            <button type="button" className="secondary-action" disabled={!!exporting} onClick={() => download('docx')}>{exporting === 'docx' ? (en ? 'Preparing Word…' : 'أجهّز Word…') : (en ? 'Editable Word ↓' : 'Word قابل للتعديل ↓')}</button>
            <button type="button" className="secondary-action" disabled={!!exporting} onClick={() => download('md')}>Markdown ↓</button>
          </div>
          <details><summary>{en ? 'Read the report' : 'اقرأ التقرير'}</summary><pre className="research-report" data-skip-i18n="1" dir={job.lang === 'en' ? 'ltr' : 'rtl'}>{job.report}</pre></details>
        </>}
      </div>}
    </details>
  );
}
