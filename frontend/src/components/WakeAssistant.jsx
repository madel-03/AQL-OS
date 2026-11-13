import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/lang';
import { useProductivity } from '../lib/productivity-context';
import { useStudio } from '../lib/studio-context';
import { supabase } from '../lib/supabase';
import { createWakeListener, validWakeName } from '../lib/wake-listener';
import { spokenToday, voiceIntent } from '../lib/voice-commands';
import AppIcon from './AppIcon';
import '../wake.css';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function WakeAssistant({ speak, stopSpeech }) {
  const { lang } = useLang(); const en = lang === 'en'; const data = useProductivity(); const studio = useStudio();
  const [name, setName] = useState('جارفس'); const [phase, setPhase] = useState('off'); const [error, setError] = useState(''); const [heard, setHeard] = useState(''); const [reply, setReply] = useState(''); const [ready, setReady] = useState(false);
  const dialog = useRef(null); const listener = useRef(null); const callbacks = useRef(null); const storage = useRef(''); const speaking = useRef(false);
  const otherVoice = useRef('idle');
  const enabled = !['off', 'hidden', 'error'].includes(phase);
  const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  useEffect(() => { callbacks.current = { speak, stopSpeech, data, studio, lang }; }, [speak, stopSpeech, data, studio, lang]);
  useEffect(() => { let active = true; supabase.auth.getSession().then(({ data: auth }) => { if (!active) return; storage.current = `aql-wake-name:${auth.session?.user.id || 'local'}`; try { const saved = localStorage.getItem(storage.current); if (saved && validWakeName(saved)) setName(saved); } catch { /* optional preference */ } setReady(true); }); return () => { active = false; }; }, []);
  const emit = state => { if (state === 'idle' && otherVoice.current !== 'idle' && !speaking.current) return; const event = new CustomEvent('aql-voice-state', { detail: state }); event.aqlWake = true; window.dispatchEvent(event); };
  const stop = () => { listener.current?.stop(); listener.current = null; if (speaking.current) callbacks.current?.stopSpeech(); speaking.current = false; emit('idle'); };
  useEffect(() => {
    const voice = event => { if (!event.aqlWake) { otherVoice.current = event.detail; listener.current?.externalVoice(event.detail); } };
    const claim = () => { otherVoice.current = 'listening'; listener.current?.externalVoice('listening'); };
    const hidden = event => { if (event.type === 'pagehide' || document.visibilityState === 'hidden') { listener.current?.hide(); if (speaking.current) callbacks.current?.stopSpeech(); speaking.current = false; emit('idle'); } };
    window.addEventListener('aql-voice-state', voice); window.addEventListener('aql-mic-claim', claim); document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', hidden);
    return () => { listener.current?.stop(); listener.current = null; if (speaking.current) callbacks.current?.stopSpeech(); window.removeEventListener('aql-voice-state', voice); window.removeEventListener('aql-mic-claim', claim); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hidden); emit('idle'); };
  }, []);
  useEffect(() => { listener.current?.stop(); if (speaking.current) callbacks.current?.stopSpeech(); speaking.current = false; }, [lang]);
  const say = (text, signal) => new Promise(resolve => {
    if (signal.aborted) return resolve();
    setReply(text); setPhase('speaking'); speaking.current = true;
    let finished = false; let timer;
    const done = () => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); speaking.current = false; resolve(); };
    const abort = () => { if (speaking.current) callbacks.current.stopSpeech(); done(); };
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { setError(callbacks.current.lang === 'en' ? 'Speech took too long. The reply remains available as text.' : 'استغرق الصوت وقتًا طويلًا. الرد متاح أمامك مكتوبًا.'); abort(); }, 120000);
    try { callbacks.current.speak(text, done); }
    catch { setError(callbacks.current.lang === 'en' ? 'Audio could not start. Read the reply below.' : 'تعذّر بدء الصوت. تقدر تقرأ الرد أدناه.'); done(); }
  });
  const start = () => {
    if (!supported) return setError(en ? 'Speech recognition is unavailable in this browser. Use a supported browser or the chat microphone.' : 'التعرف على الصوت غير متاح في هذا المتصفح. جرّب متصفحًا داعمًا أو مايك المحادثة.');
    if (!validWakeName(name)) return setError(en ? 'Use a name of 2–30 characters, up to three words.' : 'اكتب اسمًا من حرفين إلى ٣٠ حرفًا، بحد أقصى ثلاث كلمات.');
    stop(); setError(''); setHeard(''); setReply('');
    try { localStorage.setItem(storage.current, name.trim()); } catch { /* preference only */ }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    listener.current = createWakeListener({ name: name.trim(), lang: en ? 'en-US' : 'ar-SA', initiallyPaused: otherVoice.current !== 'idle', createRecognition: () => new SR(),
      onStatus: next => { setPhase(next); if (['waiting', 'command', 'starting'].includes(next)) emit('listening'); else if (next === 'processing') emit('thinking'); else if (['off', 'hidden', 'error'].includes(next)) emit('idle'); },
      onError: (code, context) => {
        const messages = { 'not-allowed': en ? 'Microphone permission was denied. Allow it in site settings, then enable listening again.' : 'لم يُسمح بالمايك. اسمح له من إعدادات الموقع ثم فعّل الاستماع مجددًا.', 'service-not-allowed': en ? 'Your browser speech service is unavailable or blocked.' : 'خدمة التعرف الصوتي في المتصفح غير متاحة أو محجوبة.', network: en ? 'The speech service could not connect. Check the browser and network, then try again.' : 'تعذّر اتصال خدمة التعرف الصوتي. تحقق من المتصفح والشبكة ثم جرّب مجددًا.', 'audio-capture': en ? 'No usable microphone was found.' : 'لم يُعثر على مايك متاح.' };
        setError(messages[code] || (en ? 'The voice request could not complete. Try again.' : 'تعذّر إكمال الطلب الصوتي. جرّب مجددًا.'));
        if (code === 'command-failed' && context?.signal && !context.signal.aborted) return say(en ? 'I could not complete that request. Please try again.' : 'ما قدرت أكمل طلبك. جرّب مرة ثانية.', context.signal);
      },
      onCommand: async (command, { signal, wakeOnly }) => {
        const current = callbacks.current; const english = current.lang === 'en';
        if (wakeOnly) return say(english ? 'Yes? What can I help you with?' : 'تفضّل، وش تحتاج؟', signal);
        setHeard(command); setError('');
        const intent = voiceIntent(command);
        if (intent.type === 'stop') { stop(); return; }
        if (intent.type === 'today') { const snapshot = await current.data.refresh(); if (!signal.aborted) await say(spokenToday(snapshot, english), signal); return; }
        if (intent.type === 'navigate') { window.dispatchEvent(new CustomEvent('aql-navigate', { detail: { id: intent.id } })); await say(english ? 'Opened it for you.' : 'فتحتها لك.', signal); return; }
        if (intent.type === 'review-required') return say(english ? 'Changes and execution need review in their tool. No action has been performed.' : 'الإضافة والتعديل والتنفيذ تحتاج مراجعتك داخل الأداة. ما نفّذت أي تغيير.', signal);
        if (command.length > 1500) return say(english ? 'Please ask a shorter question.' : 'اختصر سؤالك شوي لو سمحت.', signal);
        const { data: auth } = await supabase.auth.getSession(); if (signal.aborted) return;
        if (!auth.session) throw new Error('Signed out');
        const response = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.session.access_token}` }, body: JSON.stringify({ message: command, lang: current.lang, memory: current.studio?.memoryForChat || [], voice_mode: true }), signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
        const value = await response.json(); if (!response.ok || !value.reply) throw new Error('Voice answer unavailable');
        if (!signal.aborted) await say(value.reply, signal);
      },
    }); listener.current.start();
  };
  const labels = { off: en ? 'Call Jarvis' : 'نادِ جارفس', starting: en ? 'Starting microphone…' : 'أفتح المايك…', waiting: en ? `Listening for ${name}` : `أنتظر نداء «${name}»`, command: en ? 'Go ahead, I’m listening' : 'تفضّل، أسمع سؤالك', processing: en ? 'Preparing your answer…' : 'أجهّز إجابتك…', speaking: en ? 'Speaking…' : 'أتحدث…', 'paused-audio': en ? 'Paused for other audio' : 'متوقف أثناء الصوت الآخر', hidden: en ? 'Stopped in background' : 'توقّف في الخلفية', error: en ? 'Microphone stopped' : 'المايك متوقف' };
  return <div className="wake-assistant" data-skip-i18n="1"><button className={`wake-trigger ${enabled ? 'wake-on' : ''}`} onClick={() => dialog.current.showModal()} aria-label={en ? 'Voice wake settings' : 'إعدادات النداء الصوتي'}><AppIcon name="mic" /><span>{labels[phase]}</span></button>{enabled && <button className="wake-stop" aria-label={en ? 'Stop wake listening' : 'إيقاف الاستماع للنداء'} onClick={stop}>■</button>}
    <dialog ref={dialog} className="wake-dialog" aria-labelledby="wake-title"><header><h2 id="wake-title">{en ? 'Say my name. I’m here.' : 'نادني، وأنا معك.'}</h2><button className="studio-text-button" aria-label={en ? 'Close' : 'إغلاق'} onClick={() => dialog.current.close()}>×</button></header><p className="studio-muted">{en ? 'Enable listening for this session, then say the name and your question. No automatic microphone activation on reload.' : 'فعّل الاستماع لهذه الجلسة، ثم قل الاسم وسؤالك. المايك لا يعمل تلقائيًا بعد تحديث الصفحة.'}</p><label>{en ? 'Wake name' : 'اسم النداء'}<input name="wake-name" value={name} maxLength={30} disabled={enabled} onChange={event => setName(event.target.value)} /></label><p className="wake-example">{en ? `“Hey ${name}, what is on my schedule today?”` : `«يا ${name}، وش عندي اليوم؟»`}</p><p className="studio-muted">{en ? 'Also: open tasks, open calendar, or ask a question. Writes and execution still require review.' : 'وتقدر تقول: افتح المهام، افتح التقويم، أو تسأل سؤالًا. التغييرات والتنفيذ تبقى بعد المراجعة.'}</p><p className="wake-privacy">{en ? 'While enabled, the browser continuously uses your microphone to detect the name. Its recognition service may receive audio even before the name. AQL sends only the question after the wake name to chat; your day summary uses calendar/tasks directly. Reply text also goes through the existing speech synthesis service. Recognition pauses during replies, and stops when this page is hidden or closed.' : 'أثناء التفعيل يستخدم المتصفح المايك باستمرار لالتقاط النداء. خدمة التعرف في المتصفح قد تستقبل الصوت حتى قبل الاسم. عقل يرسل للمحادثة السؤال الذي يأتي بعد النداء فقط؛ ملخص اليوم يُقرأ من التقويم والمهام مباشرة. نص الرد يمر أيضًا عبر خدمة توليد الصوت المستخدمة في عقل. يتوقف الالتقاط أثناء الرد، ويُغلق عند إخفاء الصفحة أو إغلاقها.'}</p><div className="studio-actions"><button className="studio-primary" disabled={!ready || (!supported && !enabled)} onClick={enabled ? stop : start}>{enabled ? (en ? 'Stop listening' : 'أوقف الاستماع') : (en ? 'Enable microphone and listening' : 'فعّل المايك والاستماع')}</button><span className="wake-phase" role="status">{labels[phase]}</span></div>{!supported && <p className="studio-warning">{en ? 'Speech recognition is not supported in this browser.' : 'متصفحك لا يدعم التعرف على الصوت.'}</p>}{phase === 'hidden' && <p className="studio-muted">{en ? 'Enable listening again after returning to the page.' : 'فعّل الاستماع مجددًا بعد العودة للصفحة.'}</p>}{error && <p role="alert" className="studio-warning">{error}</p>}{heard && <section><small>{en ? 'Your request' : 'طلبك'}</small><p dir="auto">{heard}</p></section>}{reply && <section className="wake-reply" aria-live="polite"><small>{en ? 'AQL’s reply' : 'رد عقل'}</small><p dir="auto">{reply}</p></section>}</dialog>
  </div>;
}
