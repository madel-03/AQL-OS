import { useLang } from '../lib/lang';
import { useResearch } from '../lib/research-context';
import { useStudio } from '../lib/studio-context';

export default function AssistantCompanion({ compact = false }) {
  const { lang } = useLang(); const en = lang === 'en';
  const { assistantState: researchState } = useResearch();
  const studio = useStudio();
  const assistantState = ['ready', 'attention'].includes(researchState) && studio?.state.focus ? (studio.state.focus.phase === 'review' ? 'celebrating' : 'focusing') : researchState;
  const labels = en
    ? { ready: 'Ready for your next idea', thinking: 'Connecting the dots…', listening: 'I’m listening', speaking: 'Talking it through', celebrating: 'One more thing, done!', attention: 'Let’s get this unstuck', focusing: 'Right here. One thing at a time.' }
    : { ready: 'جاهز لفكرتك الجاية', thinking: 'أرتّب الأفكار…', listening: 'أسمعك', speaking: 'أسولف معك', celebrating: 'وحدة أقل من قائمة بالك!', attention: 'نحلّها ونكمّل', focusing: 'معك. نركّز على شيء واحد.' };
  return <div className={`assistant-presence state-${assistantState} ${compact ? 'presence-compact' : ''}`} data-skip-i18n="1">
    <div className="assistant-art" aria-hidden="true">
      <span className="assistant-ring" /><span className="assistant-star star-a">✦</span><span className="assistant-star star-b">✧</span>
      <div className="assistant-orb"><div className="assistant-eyes"><i /><i /></div><span className="assistant-mouth" /></div>
      <span className="assistant-shadow" />
    </div>
    <span className="assistant-caption"><i />{labels[assistantState] || labels.ready}</span>
  </div>;
}
