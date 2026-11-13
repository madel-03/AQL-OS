import { useLang } from '../lib/lang';
import { useResearch } from '../lib/research-context';

export default function AssistantCompanion({ compact = false }) {
  const { lang } = useLang(); const en = lang === 'en';
  const { assistantState } = useResearch();
  const labels = en
    ? { ready: 'Ready for your next idea', thinking: 'Connecting the dots…', listening: 'I’m listening', speaking: 'Talking it through', celebrating: 'One more thing, done!', attention: 'Let’s get this unstuck' }
    : { ready: 'جاهز لفكرتك الجاية', thinking: 'أرتّب الأفكار…', listening: 'أسمعك', speaking: 'أسولف معك', celebrating: 'وحدة أقل من قائمة بالك!', attention: 'نحلّها ونكمّل' };
  return <div className={`assistant-presence state-${assistantState} ${compact ? 'presence-compact' : ''}`} data-skip-i18n="1">
    <div className="assistant-art" aria-hidden="true">
      <span className="assistant-ring" /><span className="assistant-star star-a">✦</span><span className="assistant-star star-b">✧</span>
      <div className="assistant-orb"><div className="assistant-eyes"><i /><i /></div><span className="assistant-mouth" /></div>
      <span className="assistant-shadow" />
    </div>
    <span className="assistant-caption"><i />{labels[assistantState] || labels.ready}</span>
  </div>;
}
