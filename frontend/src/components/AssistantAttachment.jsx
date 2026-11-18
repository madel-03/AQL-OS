import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';
import './assistant-attachment.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const ACCEPT = '.jpg,.jpeg,.png,.webp,.mp3,.m4a,.wav,.ogg,.mp4,.webm,.pdf,.pptx,.txt,.md,.csv,.json';

export default function AssistantAttachment({ draft = '' }) {
  const { lang } = useLang();
  const en = lang === 'en';
  const dialog = useRef(null);
  const controller = useRef(null);
  const [file, setFile] = useState(null);
  const [question, setQuestion] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!file || !consent || controller.current) return;
    setError('');
    setReply('');
    setPartial(false);
    if (!ACCEPT.split(',').some(extension => file.name.toLowerCase().endsWith(extension)) || file.size > 12 * 1024 * 1024 || !file.size) {
      setError(en ? 'Choose a supported file up to 12 MB.' : 'اختر ملفًا بصيغة مدعومة وبحجم حتى 12 ميغابايت.');
      return;
    }
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('session');
      const response = await fetch(`${API}/api/attachments?lang=${en ? 'en' : 'ar'}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/octet-stream',
          'X-Aql-File': encodeURIComponent(file.name),
          'X-Aql-Question': encodeURIComponent(question.trim()),
        },
        body: file,
        signal: run.signal,
      });
      if (response.status === 401) throw new Error('session');
      if (response.status === 404) throw new Error('route_missing');
      if (response.status === 413) throw new Error('invalid_file');
      const result = await response.json();
      if (!response.ok || !result.reply) throw new Error(result.error);
      setReply(result.reply);
      setPartial(result.partial === true);
    } catch (failure) {
      if (!run.signal.aborted) {
        const messages = {
          session: en ? 'Sign in again to send a file.' : 'سجّل الدخول مرة ثانية لإرسال الملف.',
          invalid_file: en ? 'Check the file format and size. Text files must be UTF-8 and up to 120 KB.' : 'راجع صيغة الملف وحجمه. الملفات النصية لازم تكون UTF-8 وبحجم حتى 120 كيلوبايت.',
          busy: en ? 'File analysis is busy. Try again shortly.' : 'تحليل الملفات مشغول. جرّب بعد شوي.',
          route_missing: en ? 'File analysis is unavailable on this server version.' : 'خدمة تحليل الملفات غير متاحة في نسخة الخادم الحالية.',
          provider_limit: en ? 'Gemini has reached its request limit. Try again later.' : 'Gemini وصل لحد الطلبات. جرّب لاحقًا.',
          provider_busy: en ? 'Gemini is temporarily unavailable. Try again shortly.' : 'خدمة Gemini غير متاحة مؤقتًا. جرّب بعد شوي.',
          provider_rejected: en ? 'Gemini rejected the file or request. Try a PDF containing only the pages you need.' : 'Gemini رفض الملف أو الطلب. جرّب نسخة PDF فيها الصفحات المطلوبة فقط.',
          provider_unavailable: en ? 'Gemini could not process this request. Try again later.' : 'تعذّر على Gemini معالجة الطلب. جرّب لاحقًا.',
          output_limit: en ? 'The result exceeded the response limit. Ask for a smaller page range.' : 'النتيجة تجاوزت حد الرد. حدّد نطاق صفحات أصغر.',
          empty_reply: en ? 'Gemini returned no answer. Try a narrower request.' : 'Gemini ما رجّع إجابة. جرّب طلبًا أكثر تحديدًا.',
        };
        setError(Object.hasOwn(messages, failure.message) ? messages[failure.message] : en ? 'Analysis failed. Try again.' : 'تعذّر تحليل الملف. جرّب مرة ثانية.');
      }
    } finally {
      if (controller.current === run) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return <>
    <button className="secondary-action attachment-trigger" type="button" onClick={() => {
      if (!file) setQuestion(draft.slice(0, 600));
      dialog.current.showModal();
    }}>{en ? 'Attach a file' : 'أرفق ملف'}</button>
    {createPortal(<dialog ref={dialog} dir={en ? 'ltr' : 'rtl'} className="assistant-attachment" aria-label={en ? 'Ask about a file' : 'اسأل عن ملف'}>
      <form onSubmit={submit}>
        <div className="assistant-attachment-heading">
          <h2>{en ? 'Ask about a file' : 'اسأل عن ملف'}</h2>
          <button type="button" className="secondary-action" onClick={() => dialog.current.close()}>{en ? 'Close' : 'إغلاق'}</button>
        </div>
        <label>{en ? 'Choose a file' : 'اختر ملفًا'}<input type="file" accept={ACCEPT} required disabled={busy} onChange={event => {
          setFile(event.target.files[0] ?? null);
          setConsent(false);
          setReply('');
          setError('');
        }} /></label>
        <small>{en ? 'Images, recordings, video, PDF, PPTX and text. One file up to 12 MB.' : 'صور، تسجيلات، فيديو، PDF، PPTX وملفات نصية. ملف واحد حتى 12 ميغابايت.'}</small>
        <label>{en ? 'What should AQL do with it?' : 'وش تبغى عقل يسوي بالملف؟'}
          <textarea dir="auto" value={question} disabled={busy} maxLength={600} onChange={event => setQuestion(event.target.value)} placeholder={en ? 'For example, transcribe this recording' : 'مثلاً فرّغ هذا التسجيل أو اشرح اللي في الصورة'} />
        </label>
        <label className="assistant-attachment-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
          {en ? 'I agree to send the file content and question to Gemini for analysis.' : 'أوافق على إرسال محتوى الملف والسؤال إلى Gemini للتحليل.'}
        </label>
        <div className="assistant-attachment-heading">
          <button className="primary-action" disabled={busy || !file || !consent}>{busy ? (en ? 'Analyzing…' : 'جاري التحليل…') : (en ? 'Send to AQL' : 'أرسل لعقل')}</button>
          {busy && <button type="button" className="secondary-action" onClick={() => controller.current?.abort()}>{en ? 'Cancel analysis' : 'ألغِ التحليل'}</button>}
        </div>
        {error && <p role="alert">{error}</p>}
        {reply && <div className="assistant-attachment-reply" dir="auto" role="status">{reply}</div>}
        {reply && partial && <p role="status">{en ? 'This is a partial answer. Ask for a smaller page range to continue.' : 'الرد جزئي. حدّد نطاق صفحات أصغر لإكمال الطلب.'}</p>}
      </form>
    </dialog>, document.body)}
  </>;
}
