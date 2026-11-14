import { useLang } from '../lib/lang';
export default function CapturedSpeech({ text, onSubmit }) {
  const { lang } = useLang(); const en = lang === 'en';
  if (!text) return null;
  return <section className="captured-speech" aria-label={en ? 'Review captured speech' : 'راجع الكلام الملتقط'}><label>{en ? 'Is this your request?' : 'هذا طلبك؟'}<textarea readOnly value={text} dir="auto" rows={3} /></label><p>{en ? 'If the browser keeps waiting, send this text yourself. Appointments still require a separate confirmation after review.' : 'إذا المتصفح ظل ينتظر، أرسل النص بنفسك. إضافة الموعد تبقى بحاجة تأكيد منفصل بعد مراجعته.'}</p><button className="voice-main-toggle" onClick={() => onSubmit(text)}>{en ? 'I finished — send this text' : 'خلصت كلامي — أرسل هذا النص'}</button></section>;
}
