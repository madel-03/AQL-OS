import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:5000') + '/api/device/screens';

async function call(path = '', { method = 'GET', body, signal } = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('session');
  const timeout = AbortSignal.timeout(60000);
  const response = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value.request;
}

async function takeScreenshot() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  let timer;
  try {
    await Promise.race([video.play(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('capture_failed')), 5000);
    })]);
    if (!video.videoWidth || !video.videoHeight) throw new Error('capture_failed');
    const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('capture_failed');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.68);
    if (image.length > 360000) throw new Error('capture_failed');
    return image;
  } finally {
    clearTimeout(timer);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}

export function ScreenRequestDialog() {
  const { lang } = useLang();
  const dialog = useRef(null);
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    const open = event => {
      setDraft(event.detail);
      if (!dialog.current.open) dialog.current.showModal();
    };
    window.addEventListener('aql-screen-compose', open);
    return () => window.removeEventListener('aql-screen-compose', open);
  }, []);
  return <dialog ref={dialog} className="task-preview" aria-label={lang === 'en' ? 'Computer screenshot' : 'لقطة من شاشة الكمبيوتر'} onClose={() => setDraft(null)}>
    <button className="studio-text-button" onClick={() => dialog.current.close()}>{lang === 'en' ? 'Close' : 'إغلاق'}</button>
    {draft !== null && <ScreenRequests key={draft} initialMessage={draft} />}
  </dialog>;
}

export default function ScreenRequests({ initialMessage = '' }) {
  const { lang } = useLang();
  const en = lang === 'en';
  const [receiver, setReceiver] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [outgoing, setOutgoing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState(initialMessage.slice(0, 240));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supportsCapture = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const outgoingId = outgoing?.image ? null : outgoing?.id;

  useEffect(() => {
    if (!receiver && !outgoingId) return;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const result = await call(receiver ? '?receiver=true' : `?id=${outgoingId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (receiver) setIncoming(result);
        else {
          setOutgoing(result);
          if (!result) setError('request_expired');
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [receiver, outgoingId]);

  async function run(action) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure.name === 'NotAllowedError' ? 'capture_cancelled' : failure.message); }
    finally { setBusy(false); }
  }

  const errors = {
    session: en ? 'Sign in on both devices.' : 'سجّل الدخول على الجهازين.',
    request_expired: en ? 'The request expired or was cancelled.' : 'انتهت مهلة الطلب أو تم إلغاؤه.',
    request_exists: en ? 'There is already a request on this account.' : 'فيه طلب قائم على هذا الحساب.',
    unsupported_request: en ? 'Ask specifically for a computer screenshot.' : 'اطلب لقطة شاشة الكمبيوتر بشكل صريح.',
    model_unavailable: en ? 'The request could not be classified. Try again shortly.' : 'تعذّر فهم الطلب حاليًا. جرّب بعد شوي.',
    storage_unavailable: en ? 'The screen relay is unavailable. Check its database setup.' : 'خدمة نقل اللقطات غير جاهزة. تحقّق من إعداد قاعدة البيانات.',
    capture_cancelled: en ? 'Screen sharing was cancelled.' : 'أُلغيت مشاركة الشاشة.',
    capture_failed: en ? 'Could not capture an image. Try a smaller window.' : 'تعذّر أخذ اللقطة. جرّب نافذة أصغر.',
  };
  return <section className="device-preview">
    <h4>{en ? 'Computer screenshot' : 'لقطة من شاشة الكمبيوتر'}</h4>
    <p className="studio-muted">{en ? 'Sign in to the same AQL account on both devices. Keep this panel open on the computer to receive a request.' : 'افتح نفس حساب عقل على الجهازين. خلّ هذي اللوحة مفتوحة على الكمبيوتر لاستقبال الطلب.'}</p>
    {supportsCapture && !initialMessage && !outgoing && <button type="button" className="studio-text-button" disabled={busy} onClick={() => {
      setReceiver(!receiver); setIncoming(null); setPreview(null); setError('');
    }}>{receiver ? (en ? 'Stop receiving requests' : 'أوقف استقبال الطلبات') : (en ? 'Receive requests on this computer' : 'استقبل الطلبات على هذا الكمبيوتر')}</button>}
    {!receiver && !outgoing && <form className="studio-form" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        try { setOutgoing(await call('', { method: 'POST', body: { message: message.trim() } })); }
        catch (failure) {
          if (failure.message !== 'request_exists') throw failure;
          setOutgoing(await call());
        }
      });
    }}>
      <label>{en ? 'Ask AQL for a screenshot' : 'اطلب من عقل لقطة شاشة'}
        <input value={message} onChange={event => setMessage(event.target.value)} maxLength={240} placeholder={en ? 'Take a screenshot of my computer' : 'خذ لقطة من شاشة الكمبيوتر'} required />
      </label>
      <button className="studio-primary" disabled={busy || !message.trim()}>{en ? 'Send request' : 'أرسل الطلب'}</button>
    </form>}
    {receiver && !incoming && <p role="status">{en ? 'Waiting for a request…' : 'بانتظار طلب…'}</p>}
    {receiver && incoming && <div className="studio-actions">
      <button type="button" className="studio-primary" disabled={busy} onClick={() => void run(async () => setPreview({ id: incoming.id, image: await takeScreenshot() }))}>{en ? 'Choose a screen and preview' : 'اختر الشاشة وعاين اللقطة'}</button>
      <button type="button" className="studio-text-button" disabled={busy} onClick={() => void run(async () => {
        await call(`/${incoming.id}`, { method: 'DELETE' }); setIncoming(null); setPreview(null);
      })}>{en ? 'Decline' : 'رفض الطلب'}</button>
    </div>}
    {receiver && preview && preview.id === incoming?.id && <div>
      <img src={preview.image} alt={en ? 'Screenshot preview' : 'معاينة لقطة الشاشة'} style={{ maxWidth: '100%' }} />
      <button type="button" className="studio-primary" disabled={busy} onClick={() => void run(async () => {
        await call(`/${preview.id}`, { method: 'PUT', body: { image: preview.image } }); setPreview(null); setIncoming(null);
      })}>{en ? 'Send this screenshot to my account' : 'أرسل هذه اللقطة لحسابي'}</button>
    </div>}
    {outgoing && <div>
      {outgoing.image ? <img src={outgoing.image} alt={en ? 'Computer screenshot' : 'لقطة شاشة الكمبيوتر'} style={{ maxWidth: '100%' }} />
        : <p role="status">{en ? 'Waiting for approval on your computer…' : 'بانتظار موافقتك من الكمبيوتر…'}</p>}
      <button type="button" className="studio-text-button" disabled={busy} onClick={() => void run(async () => {
        await call(`/${outgoing.id}`, { method: 'DELETE' }); setOutgoing(null);
      })}>{outgoing.image ? (en ? 'Delete screenshot' : 'احذف اللقطة') : (en ? 'Cancel request' : 'ألغِ الطلب')}</button>
    </div>}
    {error && <p role="alert" className="studio-warning">{Object.hasOwn(errors, error) ? errors[error] : (en ? 'Screen sharing failed. Try again.' : 'تعذّرت مشاركة الشاشة. جرّب مجددًا.')}</p>}
  </section>;
}
