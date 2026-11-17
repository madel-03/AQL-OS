import { useEffect, useRef, useState } from 'react';
import { useProductivity } from '../lib/productivity-context';
import { dailyDocument } from '../lib/assistant-documents';
import { supabase } from '../lib/supabase';
import { ReportContent } from './WorkHub';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function AssistantDocuments() {
  const productivity = useProductivity(); const latest = useRef(productivity); const dialog = useRef(null); const generation = useRef(0); const exportRun = useRef(null);
  const pending = useRef(null);
  const [document, setDocument] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [en, setEn] = useState(false); const [format, setFormat] = useState('pdf'); const [exporting, setExporting] = useState(false);
  useEffect(() => { latest.current = productivity; }, [productivity]);
  const close = () => { pending.current?.finish(pending.current.en ? 'Document preview cancelled.' : 'ألغيت عرض المستند.'); pending.current = null; generation.current++; exportRun.current?.abort(); setLoading(false); setExporting(false); };
  useEffect(() => {
    let mounted = true;
    const show = async event => {
      const { kind, en: english, signal, finish } = event.detail || {}; if (!['today','tasks','latest-report'].includes(kind)) return;
      pending.current?.finish(english ? 'Opening the newer request.' : 'أعرض الطلب الأحدث.'); pending.current = { finish, en: english };
      const turn = ++generation.current; exportRun.current?.abort(); setExporting(false); setEn(english); setDocument(null); setLoading(true); setError('');
      if (!dialog.current.open) dialog.current.showModal();
      const cancelled = () => { if (turn === generation.current) { dialog.current.close(); close(); } };
      signal?.addEventListener('abort', cancelled, { once: true });
      try {
        let value;
        if (kind === 'latest-report') {
          const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error(english ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
          const get = async path => { const response = await fetch(`${API}/api/research${path}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) }); if (!response.ok) throw new Error(english ? 'Could not load reports.' : 'تعذّرت قراءة التقارير.'); return response.json(); };
          const list = await get(''); const task = (list.tasks || []).filter(x => x.status === 'completed').sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          if (!task) throw new Error(english ? 'You have no completed research reports yet.' : 'ما عندك تقرير بحث مكتمل إلى الآن.');
          const full = await get(`/${encodeURIComponent(task.id)}`); value = { title: full.topic, report: full.report, lang: full.lang, sources: full.sources || [] };
        } else value = dailyDocument(await latest.current.refresh(), english, kind);
        if (!mounted || turn !== generation.current || signal?.aborted) { finish(english ? 'Document preview cancelled.' : 'ألغيت عرض المستند.'); return; }
        setDocument(value); finish(english ? 'Your document is open in front of you.' : 'المستند قدامك الآن، وتقدر تنزّله من المعاينة.');
      } catch (failure) { if (mounted && turn === generation.current && !signal?.aborted) { setError(failure.message); finish(failure.message); } else finish(null); }
      finally { if (mounted && turn === generation.current) { pending.current = null; setLoading(false); } signal?.removeEventListener('abort', cancelled); }
    };
    window.addEventListener('aql-document-request', show); return () => { mounted = false; exportRun.current?.abort(); window.removeEventListener('aql-document-request', show); };
  }, []);
  const download = async () => {
    if (!document || exporting) return;
    const run = new AbortController(); exportRun.current = run; setExporting(true); setError('');
    try {
      const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error(en ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
      const response = await fetch(`${API}/api/documents/export`, { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...document, format }), signal: run.signal });
      if (!response.ok) throw new Error(en ? 'Download failed. Try again.' : 'تعذّر تنزيل المستند. جرّب مجددًا.');
      const blob = await response.blob(); if (run.signal.aborted) return; const url = URL.createObjectURL(blob); const a = window.document.createElement('a'); a.href = url; a.download = `aql-document.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (!run.signal.aborted) setError(failure.message); }
    finally { if (exportRun.current === run) { exportRun.current = null; setExporting(false); } }
  };
  return <dialog ref={dialog} className="task-preview assistant-document" data-skip-i18n="1" onClose={close} aria-labelledby="assistant-document-title"><header className="preview-heading"><div><small>{en ? 'AQL DOCUMENT' : 'مستند عقل'}</small><h2 id="assistant-document-title">{document?.title || (en ? 'Preparing your document' : 'أجهّز مستندك')}</h2></div><button className="icon-button" aria-label={en ? 'Close document' : 'إغلاق المستند'} onClick={() => dialog.current.close()}>×</button></header>{loading && <p role="status">{en ? 'Reading your latest account data…' : 'أقرأ أحدث بيانات حسابك…'}</p>}{error && <p role="alert" className="studio-warning">{error}</p>}{document && <><div className="preview-actions"><label>{en ? 'Format' : 'الصيغة'} <select aria-label={en ? 'Document format' : 'صيغة المستند'} value={format} disabled={exporting} onChange={e => setFormat(e.target.value)}><option value="pdf">PDF</option><option value="docx">Word</option><option value="md">Markdown</option></select></label><button className="primary-action" disabled={exporting} onClick={download}>{exporting ? (en ? 'Preparing…' : 'أجهّز الملف…') : (en ? 'Download document' : 'نزّل المستند')}</button></div><div className="assistant-paper" dir={document.lang === 'en' ? 'ltr' : 'rtl'}><ReportContent report={document.report} sources={document.sources} /></div></>}</dialog>;
}
