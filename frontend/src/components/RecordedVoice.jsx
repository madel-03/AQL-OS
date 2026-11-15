import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';
import { createSpeechCapture } from '../lib/speech-capture';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function RecordedVoice({ language, onBegin, onCommand, unlockAudio }) {
  const { lang } = useLang(); const en = lang === 'en'; const [phase, setPhase] = useState('idle'); const [text, setText] = useState(''); const [error, setError] = useState('');
  const capture = useRef(null), request = useRef(null), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const cancel = () => { capture.current?.cancel(); request.current?.abort(); if (alive.current) setPhase('idle'); };
    const hide = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; cancel(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  const start = () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError(en ? 'Audio recording is unavailable in this browser.' : 'تسجيل الصوت غير متاح في هذا المتصفح.'); return; }
    onBegin(); void unlockAudio?.(); setText(''); setError('');
    capture.current = createSpeechCapture({ getUserMedia: options => navigator.mediaDevices.getUserMedia(options), Recorder: window.MediaRecorder,
      onState: state => { if (alive.current) { setPhase(state); window.dispatchEvent(new CustomEvent('aql-voice-state', { detail: ['recording', 'requesting'].includes(state) ? 'listening' : 'idle' })); } },
      onLimit: () => { if (alive.current) setError(en ? 'Recording cancelled after 90 seconds. Record a shorter request.' : 'ألغيت التسجيل بعد ٩٠ ثانية. سجّل طلبًا أقصر.'); },
      onError: () => { if (alive.current) setError(en ? 'Could not record. Allow microphone access and try again.' : 'تعذّر التسجيل. اسمح بالمايك وجرّب مجددًا.'); },
    }); void capture.current.start();
  };
  const finish = async () => {
    const controller = new AbortController(); request.current = controller;
    try {
      const blob = await capture.current.finish(); if (!blob || !alive.current || controller.signal.aborted) return;
      setPhase('transcribing');
      const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error(en ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
      const response = await fetch(`${API}/api/speech/transcribe?language=${language === 'en-US' ? 'en' : 'ar'}`, { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': blob.type || 'audio/webm' }, body: blob, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70000)]) });
      const value = await response.json(); if (!response.ok || typeof value.text !== 'string' || !value.text.trim()) throw new Error(value.error || 'تعذّر تحويل الصوت.');
      if (!alive.current || controller.signal.aborted) return; setText(value.text); setPhase('review');
    } catch (failure) { if (alive.current && !controller.signal.aborted) { setError(failure.message); setPhase('idle'); } }
  };
  const submit = async () => {
    if (!text.trim()) return; const controller = new AbortController(); request.current = controller; setPhase('processing'); setError('');
    try { await onCommand(text.trim(), controller.signal); if (alive.current && !controller.signal.aborted) { setText(''); setPhase('idle'); } }
    catch (failure) { if (alive.current && !controller.signal.aborted) { setError(failure.message || 'تعذّر تنفيذ الطلب.'); setPhase('review'); } }
  };
  const cancel = () => { request.current?.abort(); capture.current?.cancel(); setPhase('idle'); };
  const locked = ['requesting', 'finishing', 'transcribing', 'processing'].includes(phase);
  return <section className="recorded-voice" aria-label={en ? 'Recorded voice request' : 'طلب صوتي مسجّل'}>
    <p>{en ? 'Tap to record, speak your full request, then finish. Only this recording is sent to Groq for transcription. Review the text before sending; saving changes still needs confirmation.' : 'اضغط وسجّل طلبك كاملًا، ثم أنهِ التسجيل. يُرسل هذا التسجيل فقط إلى Groq لتحويله لنص. راجعه قبل الإرسال؛ حفظ التغييرات يحتاج تأكيدًا.'}</p>
    <button className="voice-main-toggle record-toggle" disabled={locked} onClick={phase === 'recording' ? finish : start}>{phase === 'recording' ? (en ? 'Finish recording' : 'أنهيت كلامي — حوّل التسجيل') : phase === 'requesting' ? (en ? 'Allow microphone…' : 'انتظر إذن المايك…') : phase === 'transcribing' ? (en ? 'Transcribing…' : 'أحوّل التسجيل إلى نص…') : phase === 'processing' ? (en ? 'Processing…' : 'أعالج الطلب…') : (en ? 'Record a request' : 'سجّل طلبك')}</button>
    {phase === 'recording' && <p role="status">{en ? 'Recording — pauses do not end your request.' : 'أسجّل الآن — الوقفات لا تنهي طلبك.'}</p>}
    {phase === 'review' && <><label>{en ? 'Review your words' : 'راجع كلامك'}<textarea value={text} onChange={event => setText(event.target.value)} rows={4} dir="auto" /></label><button className="voice-main-toggle record-send" onClick={submit}>{en ? 'Send reviewed request' : 'أرسل الطلب بعد المراجعة'}</button></>}
    {phase !== 'idle' && <button className="voice-settings-link" onClick={cancel}>{en ? 'Cancel' : 'إلغاء'}</button>}
    {error && <p className="voice-inline-error" role="alert">{error}</p>}
  </section>;
}
