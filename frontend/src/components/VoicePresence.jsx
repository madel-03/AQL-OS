import { useLang } from '../lib/lang';
import AppIcon from './AppIcon';
import '../voice-presence.css';

export default function VoicePresence({ phase, name, enabled, ready, supported, label, error, heard, reply, onToggle, onSettings }) {
  const { lang } = useLang(); const en = lang === 'en';
  return <section className={`voice-presence voice-${phase}`} data-phase={phase} data-skip-i18n="1" aria-label={en ? 'Your voice companion' : 'مساعدك الصوتي'}>
    <div className="voice-presence-heading"><span className="voice-presence-tag"><i />{en ? 'YOUR VOICE COMPANION' : 'صوتك يوصلني'}</span><button className="voice-settings" onClick={onSettings} aria-label={en ? 'Voice settings' : 'إعدادات الصوت'}><AppIcon name="more" /></button></div>
    <div className="voice-creature" aria-hidden="true"><div className="voice-halo halo-outer" /><div className="voice-halo halo-inner" /><div className="voice-orbit orbit-one" /><div className="voice-orbit orbit-two" /><div className="voice-liquid"><span className="voice-shine" /><div className="voice-face"><i /><i /><span /></div></div><div className="voice-ground" /></div>
    <div className="voice-wave" aria-hidden="true">{Array.from({ length: 23 }, (_, index) => <i key={index} style={{ '--bar-height': `${9 + (1 - Math.abs(index - 11) / 12) * 26}px`, '--bar-delay': `${(index % 7) * -.14}s` }} />)}</div>
    <h2>{phase === 'off' ? (en ? `Hey ${name}.` : `يا ${name}.`) : label}</h2>
    <p className="voice-presence-hint">{phase === 'off' ? (en ? 'One call. A little help with your day.' : 'نادني، وخلّنا نشوف وش عندك اليوم.') : phase === 'waiting' ? (en ? `Say “Hey ${name}, what is on today?”` : `قل: «يا ${name}، وش عندي اليوم؟»`) : phase === 'speaking' ? (en ? 'I’m talking. The microphone is paused.' : 'أتحدث معك. المايك متوقف أثناء الرد.') : phase === 'processing' ? (en ? 'A moment, I’m getting your answer.' : 'لحظة، أرتّب لك الإجابة.') : phase === 'command' ? (en ? 'Go ahead with your question.' : 'قل سؤالك، أنا معك.') : (en ? 'You control when the microphone is on.' : 'أنت تتحكم بتشغيل المايك وإيقافه.')}</p>
    <div className="voice-presence-actions"><button className={`voice-main-toggle ${enabled ? 'is-enabled' : ''}`} disabled={!ready || (!supported && !enabled)} onClick={onToggle}><AppIcon name={enabled ? 'close' : 'mic'} />{enabled ? (en ? 'Stop listening' : 'أوقف الاستماع') : (en ? 'Talk to me' : 'كلّمني')}</button><button className="voice-settings-link" onClick={onSettings}>{en ? 'Settings' : 'الإعدادات'}</button></div>
    {error && <p className="voice-inline-error" role="alert">{error}</p>}{!supported && <p className="voice-inline-error">{en ? 'Speech recognition is unavailable in this browser.' : 'التعرف على الصوت غير متاح في هذا المتصفح.'}</p>}
    {heard && <p className="voice-last-request" dir="auto">“{heard}”</p>}
    {reply && <details className="voice-inline-reply"><summary>{en ? 'Read the last reply' : 'اقرأ آخر رد'}</summary><p dir="auto">{reply}</p></details>}
    <small className="voice-brief-privacy">{en ? 'Mic starts only when you enable it. Browser recognition may process audio online. Hiding the page stops listening.' : 'المايك يعمل بتفعيلك فقط. التعرف في المتصفح قد يعالج الصوت عبر الإنترنت. إخفاء الصفحة يوقف الاستماع.'}</small>
  </section>;
}
