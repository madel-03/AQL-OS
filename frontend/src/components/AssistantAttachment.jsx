import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';
import { pastedImage, productSearchReply, searchProducts, shoppingLink, wantsProduct } from '../lib/composer-image';
import { speechLanguage } from '../lib/speech-voice';
import { downloadAttachmentPdf } from '../lib/lecture-pdf';
import LectureReading from './LectureReading';
import StudyDiscussion from './StudyDiscussion';
import './assistant-attachment.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const ACCEPT = '.jpg,.jpeg,.png,.webp,.mp3,.m4a,.wav,.ogg,.mp4,.webm,.pdf,.pptx,.txt,.md,.csv,.json';

const IMAGES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

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
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState([]);
  const preview = useRef(null);
  const questionField = useRef(null);
  const picker = useRef(null);
  const [partial, setPartial] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!file || !preview.current) return;
    const image = preview.current;
    const url = URL.createObjectURL(file);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(next) {
    setFile(next);
    setConsent(false);
    setReply('');
    setProductQuery('');
    setProducts([]);
    setError('');
  }

  function pasteImage(event) {
    if (controller.current) return;
    const image = pastedImage(event);
    if (!image) return;
    event.stopPropagation();
    if (!dialog.current.open) dialog.current.showModal();
    if (!image.size || image.size > 12 * 1024 * 1024) {
      setError(en ? 'Paste an image up to 12 MB.' : 'الصق صورة حجمها حتى 12 ميغابايت.');
      return;
    }
    picker.current.value = '';
    selectFile(image);
    questionField.current.focus();
  }



  async function savePdf() {
    setSaving(true);
    setError('');
    try {
      const title = file.name.replace(/\.[^.]+$/, '');
      await downloadAttachmentPdf({ title, text: reply, en: speechLanguage(reply, lang) === 'en', partial });
    } catch {
      setError(en ? 'Could not save the PDF. Try again.' : 'تعذّر حفظ PDF. جرّب مرة ثانية.');
    } finally {
      setSaving(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!file || !consent || controller.current) return;
    setError('');
    setReply('');
    setPartial(false);
    setProductQuery('');
    setProducts([]);
    const productSearch = Object.hasOwn(IMAGES, file.type) && (event.nativeEvent.submitter?.value === 'product' || wantsProduct(question));
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
      const auth = { Authorization: `Bearer ${data.session.access_token}` };
      const response = await fetch(`${API}/api/attachments?lang=${en ? 'en' : 'ar'}${productSearch ? '&mode=product' : ''}`, {
        method: 'POST',
        headers: {
          ...auth,
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
      const query = typeof result.productQuery === 'string' ? result.productQuery : '';
      const search = query ? await searchProducts(API, query, lang, auth, run.signal) : null;
      if (run.signal.aborted) return;
      setReply(query ? `${result.reply}\n\n${productSearchReply(search, en)}` : result.reply);
      setProductQuery(query);
      setProducts(search?.results || []);
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
      <form onSubmit={submit} onPaste={pasteImage}>
        <div className="assistant-attachment-heading">
          <h2>{en ? 'Ask about a file' : 'اسأل عن ملف'}</h2>
          <button type="button" className="secondary-action" onClick={() => dialog.current.close()}>{en ? 'Close' : 'إغلاق'}</button>
        </div>
        <label>{en ? 'Choose a file' : 'اختر ملفًا'}<input ref={picker} type="file" accept={ACCEPT} disabled={busy} onChange={event => selectFile(event.target.files[0] ?? null)} /></label>
        {file && Object.hasOwn(IMAGES, file.type) && <div className="assistant-attachment-preview">
          <img ref={preview} alt={en ? 'Attached image' : 'الصورة المرفقة'} />
          <button type="button" className="secondary-action" disabled={busy} onClick={() => { picker.current.value = ''; selectFile(null); }}>{en ? 'Remove image' : 'أزل الصورة'}</button>
        </div>}
        <small>{en ? 'Images, recordings, video, PDF, PPTX and text. One file up to 12 MB.' : 'صور، تسجيلات، فيديو، PDF، PPTX وملفات نصية. ملف واحد حتى 12 ميغابايت.'}</small>
        <label>{en ? 'What should AQL do with it?' : 'وش تبغى عقل يسوي بالملف؟'}
          <textarea ref={questionField} dir="auto" value={question} disabled={busy} maxLength={600} onChange={event => setQuestion(event.target.value)} placeholder={en ? 'For example, transcribe this recording' : 'مثلاً فرّغ هذا التسجيل أو اشرح اللي في الصورة'} />
        </label>
        <label className="assistant-attachment-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
          {en ? 'I agree to send the file content and question to Gemini for analysis.' : 'أوافق على إرسال محتوى الملف والسؤال إلى Gemini للتحليل.'}
        </label>
        <div className="assistant-attachment-heading">
          <button className="primary-action" disabled={busy || !file || !consent}>{busy ? (en ? 'Analyzing…' : 'جاري التحليل…') : (en ? 'Send to AQL' : 'أرسل لعقل')}</button>
          {!busy && file && Object.hasOwn(IMAGES, file.type) && <button value="product" className="secondary-action" disabled={!consent}>{en ? 'Find this product' : 'ابحث عن هذا المنتج'}</button>}
          {busy && <button type="button" className="secondary-action" onClick={() => controller.current?.abort()}>{en ? 'Cancel analysis' : 'ألغِ التحليل'}</button>}
        </div>
        {products.length > 0 && <ul className="chat-product-results">{products.map(item => <li key={item.url}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || item.url}</a>
        </li>)}</ul>}
        {productQuery && <a href={shoppingLink(productQuery)} target="_blank" rel="noopener noreferrer">{en ? 'Compare stores for' : 'قارن المتاجر لمنتج'} {productQuery}</a>}
        {error && <p role="alert">{error}</p>}
        {reply && <div className="assistant-attachment-reply">
          <button className="secondary-action" type="button" disabled={saving} onClick={savePdf}>
            {saving ? (en ? 'Preparing PDF…' : 'جاري تجهيز PDF…') : (en ? 'Save result as PDF' : 'احفظ النتيجة PDF')}
          </button>
          <div dir="auto"><LectureReading text={reply} /></div>
          <StudyDiscussion key={reply} source={reply} en={en} />
        </div>}
        {reply && partial && <p role="status">{en ? 'This is a partial answer. Ask for a smaller page range to continue.' : 'الرد جزئي. حدّد نطاق صفحات أصغر لإكمال الطلب.'}</p>}
      </form>
    </dialog>, document.body)}
  </>;
}
