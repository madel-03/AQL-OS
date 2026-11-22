import StudyDiscussion from './StudyDiscussion';
import { downloadLecturePdf } from '../lib/lecture-pdf';
import { studyMap } from '../lib/lecture-study';
import LectureReading from './LectureReading';
import { printLecture } from '../lib/lecture-print';
import LectureNotebook from './LectureNotebook';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const ACCEPT = '.pdf,.pptx,.mp3,.m4a,.wav,.ogg,.mp4,.webm';
export default function LectureStudio() {
  const { lang } = useLang(); const en = lang === 'en'; const dialog = useRef(null); const controller = useRef(null);
  const [file, setFile] = useState(null); const [phase, setPhase] = useState(''); const [error, setError] = useState(''); const [result, setResult] = useState(null); const [consent, setConsent] = useState(false); const [tab, setTab] = useState('summary');
  const [extracted, setExtracted] = useState([]);
  const [retry, setRetry] = useState(null);
  const [format, setFormat] = useState('pdf'); const [exporting, setExporting] = useState(false);
  const busy = !!phase || exporting; const cancel = () => { controller.current?.abort(); controller.current = null; setPhase(''); setExporting(false); };
  useEffect(() => () => controller.current?.abort(), []);
  const analyze = async () => {
    if (!file || !consent || busy) return;
    if (file.size > 12 * 1024 * 1024 || !/\.(pdf|pptx|mp3|m4a|wav|ogg|mp4|webm)$/i.test(file.name)) { setError(en ? 'Choose a supported file up to 12MB.' : 'اختر ملفًا مدعومًا بحجم حتى 12MB.'); return; }
    const run = new AbortController(); controller.current = run; setPhase('uploading'); setTab('summary'); setRetry(null); setError(''); setResult(null); setExtracted([]);
    try {
      const { data } = await supabase.auth.getSession(); if (run.signal.aborted) return;
      if (!data.session) throw new Error(en ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
      const response = await fetch(`${API}/api/lectures/analyze?language=${en ? 'en' : 'ar'}`, { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/octet-stream', 'X-Lecture-Name': encodeURIComponent(file.name) }, body: file, signal: run.signal });
      if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error || (en ? 'Upload failed.' : 'تعذّر رفع الملف.')); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '', completed = false;
      const receive = line => { if (run.signal.aborted) throw new DOMException('Aborted', 'AbortError'); if (!line.trim()) return; const value = JSON.parse(line); if (value.error) throw new Error(value.error); if (value.phase) { setPhase(value.phase); setRetry(null); } if (value.retry) setRetry(value.retry); if (Array.isArray(value.sources)) setExtracted(value.sources); if (value.draft) setResult({ ...value.draft, isDraft: true }); if (value.result) { setResult(value.result); completed = true; } };
      while (true) { const { value, done } = await reader.read(); pending += decoder.decode(value, { stream: !done }); const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) receive(line); if (done) break; }
      if (pending.trim()) receive(pending); if (!completed) throw new Error(en ? 'Analysis ended without a result. Try a shorter file.' : 'انتهى الاتصال دون نتيجة. جرّب جزءًا أصغر.');
    } catch (failure) { if (!run.signal.aborted) setError(failure.message); }
    finally { if (controller.current === run) { controller.current = null; setPhase(''); } }
  };
  const saveFromBrowser = () => {
    if (!result) return;
    const opened = printLecture(result, file?.name || (en ? 'Lecture notes' : 'مذكرة المحاضرة'), en);
    setError(opened ? '' : (en ? 'Allow pop-ups for this site and try again.' : 'اسمح بفتح النوافذ لهذا الموقع ثم جرّب مجددًا.'));
  };
  const download = async () => {
    if (!result || busy) return;
    const run = new AbortController(); controller.current = run; setExporting(true); setError('');
    try {
      if (format === 'pdf') {
        await downloadLecturePdf(result, (file?.name || 'aql-lecture').replace(/\.[^.]+$/, ''), en);
        return;
      }
      const { data } = await supabase.auth.getSession(); if (run.signal.aborted) return;
      if (!data.session) throw new Error(en ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
      const response = await fetch(`${API}/api/lectures/export`, { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ result, title: (file?.name || 'Lecture').slice(0, 200), lang: en ? 'en' : 'ar', format }), signal: run.signal });
      if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error || (en ? 'Download failed.' : 'تعذّر التنزيل.')); }
      const blob = await response.blob(); if (run.signal.aborted) return;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `aql-lecture.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (!run.signal.aborted) setError(format === 'pdf' ? (en ? 'PDF download failed. Use Save PDF from browser below.' : 'تعذّر تنزيل PDF. استخدم زر «احفظ PDF من المتصفح» أدناه.') : failure.message); }
    finally { if (controller.current === run) { controller.current = null; setExporting(false); } }
  };
  const phases = en ? { uploading: 'Uploading…', extracting: 'Reading source · Gemini…', explaining: 'Explaining and summarizing · Groq…', reviewing: 'Reviewing against extracted source · Gemini…' } : { uploading: 'أرفع المحاضرة…', extracting: 'قراءة المحتوى · Gemini…', explaining: 'الشرح والتلخيص والأسئلة · Groq…', reviewing: 'مراجعة مقابل النص المستخرج · Gemini…' };
  const tabs = en ? { summary: 'Summary', explanation: 'Explanation', questions: 'Practice & answers', reviewNotes: 'Review notes', sources: 'Extracted source' } : { summary: 'الملخص', explanation: 'الشرح', questions: 'أسئلة وإجابات', reviewNotes: 'ملاحظات المراجع', sources: 'النص المستخرج' };
  const concepts = result ? studyMap(result, en) : [];
  return <><button className="services-trigger lecture-trigger" data-skip-i18n="1" onClick={() => dialog.current.showModal()} aria-label={en ? 'Lecture studio' : 'مساحة المحاضرات'}>▤ <span>{en ? 'Lectures' : 'المحاضرات'}</span></button><dialog ref={dialog} className="services-dialog lecture-dialog" data-skip-i18n="1" aria-labelledby="lecture-title" onClose={cancel}><header><h2 id="lecture-title">{en ? 'Understand your lecture' : 'افهم محاضرتك'}</h2><button className="studio-text-button" aria-label={en ? 'Close' : 'إغلاق'} onClick={() => dialog.current.close()}>×</button></header><p>{en ? 'One lecture, two AI models: source reading, explanation, then review.' : 'محاضرة واحدة، ونموذجان: قراءة المحتوى، ثم الشرح والتلخيص، ثم المراجعة.'}</p><label>{en ? 'Lecture file' : 'ملف المحاضرة'}<input className="music-search-input" type="file" accept={ACCEPT} disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setResult(null); setExtracted([]); setError(''); setConsent(false); }} /></label><small>{en ? 'PDF, PPTX, MP3, M4A, WAV, OGG, MP4, WebM · up to 12MB. Split larger recordings. PPTX reads slide text only; export to PDF for diagrams. References may be approximate.' : 'PDF، PPTX، MP3، M4A، WAV، OGG، MP4، WebM · حتى 12MB. قسّم التسجيلات الأكبر. PPTX للنص فقط؛ صدّره PDF للرسومات. بعض المراجع قد تكون تقريبية.'}</small><label className="lecture-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />{en ? 'I agree to send the file to Gemini (PPTX: extracted text only), and its extracted content to Groq for analysis. AQL does not store the upload.' : 'أوافق على إرسال الملف إلى Gemini (في PPTX يُرسل النص المستخرج فقط)، ومحتواه المستخرج إلى Groq للتحليل. عقل لا يخزّن الملف المرفوع.'}</label><button className="services-primary" disabled={!file || !consent || busy} onClick={analyze}>{en ? 'Explain & summarize' : 'اشرح ولخّص المحاضرة'}</button>{!!phase && <div role="status"><p>{phases[phase] || phase}</p>{retry && <p>{en ? `Service is busy. Attempt ${retry.attempt} · ${retry.model}` : `الخدمة مشغولة، أحاول مجددًا · المحاولة ${retry.attempt} · ${retry.model}`}</p>}<button className="studio-text-button" onClick={cancel}>{en ? 'Cancel' : 'إلغاء'}</button><small>{en ? 'Analysis can take several minutes.' : 'قد يستغرق التحليل عدة دقائق.'}</small></div>}{error && <p role="alert" className="studio-warning">{error}</p>}<LectureNotebook key={file?.name} en={en} result={result || { sources: extracted }} title={file?.name} />{!result && !!extracted.length && <section><details><summary>{en ? 'Read extracted notes' : 'اقرأ النص المستخرج'}</summary><div className="lecture-output">{extracted.map((unit, i) => <article key={i}><strong>{unit.ref}</strong><LectureReading text={unit.text} /></article>)}</div></details></section>}{result && !busy && <StudyDiscussion key={file?.name} source={[result.summary, result.explanation, ...(result.sources || []).map(unit => unit.ref + " " + unit.text)].join("\n")} en={en} />}{result && <section><p className="lecture-models">{result.models.join(' · ')}</p>{result.warnings.map((x, i) => <p className="studio-warning" key={i}>{x}</p>)}<div className="lecture-download"><label>{en ? 'Download format' : 'صيغة التنزيل'}<select aria-label={en ? 'Download format' : 'صيغة التنزيل'} value={format} disabled={busy} onChange={event => setFormat(event.target.value)}><option value="pdf">PDF</option><option value="docx">Word (.docx)</option><option value="md">Markdown (.md)</option></select></label><button className="services-primary" disabled={busy} onClick={download}>{exporting ? (en ? 'Preparing file…' : 'أجهّز الملف…') : (en ? `Download ${format === 'docx' ? 'Word' : format.toUpperCase()}` : `نزّل ${format === 'docx' ? 'Word' : format.toUpperCase()}`)}</button><button type="button" className="studio-text-button" onClick={saveFromBrowser}>{en ? 'Save PDF from browser' : 'احفظ PDF من المتصفح'}</button>{exporting && <span role="status">{en ? 'Exporting your study notes…' : 'أصدّر مذكرة المحاضرة…'}</span>}</div><div className="lecture-tabs" role="tablist" aria-label={en ? 'Lecture results' : 'نتائج المحاضرة'}>{Object.entries(tabs).map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{title}</button>)}</div><div className="lecture-output" role="tabpanel" dir="auto">{tab === 'summary' && concepts.length > 1 && <div className="lecture-map"><h3>{en ? 'Concept map' : 'خريطة المفاهيم'}</h3><ol>{concepts.map((label, index) => <li key={index}>{label}</li>)}</ol></div>}{tab === 'sources' ? result.sources.map((unit, i) => <article key={i}><strong>{unit.ref}</strong><LectureReading text={unit.text} /></article>) : <LectureReading text={result[tab]} />}</div><small>{en ? 'AI can make mistakes. Verify formulas and references against your original lecture. Results disappear on reload; download to keep them.' : 'قد تخطئ النماذج. راجع المعادلات والمراجع مع المحاضرة الأصلية. النتائج تزول عند تحديث الصفحة؛ نزّلها للاحتفاظ بها.'}</small></section>}</dialog></>;
}


