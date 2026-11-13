import AppIcon from './AppIcon';
import TasksSpace from './TasksSpace';
import CalendarSpace from './CalendarSpace';
import DeviceSpace from './DeviceSpace';
import { useLang } from '../lib/lang';
import { useResearch } from '../lib/research-context';
import { useStudio } from '../lib/studio-context';
import { AmbienceSpace, DeskSpace, FocusSpace, IdeasSpace, MemorySpace, ProjectsSpace } from './StudioSpaces';

function Suggestions({ onCompose }) {
  const { lang } = useLang(); const en = lang === 'en'; const studio = useStudio(); const research = useResearch();
  const describe = (entry) => {
    if (entry.type === 'retry') return en ? `“${entry.task.topic}” stopped. Shall we review why?` : `«${entry.task.topic}» توقفت. نشوف وش اللي عطّلها؟`;
    if (entry.type === 'combine') return en ? `You revisited “${entry.tasks[0].topic}” at least three times. Turn it into a project?` : `رجعنا لـ«${entry.tasks[0].topic}» ثلاث مرات على الأقل. نحوّلها لمشروع؟`;
    if (entry.type === 'project') return en ? `“${entry.project.title}” hasn’t changed for a week. Pick one small next step?` : `«${entry.project.title}» ما تغيّر من أسبوع. نختار خطوة صغيرة؟`;
    return en ? `“${entry.task.topic}” is over a month old. Worth a fresh look?` : `«${entry.task.topic}» عمرها أكثر من شهر. نراجع الجديد؟`;
  };
  const act = (entry) => {
    if (entry.type === 'retry') research.openTask(entry.task.id);
    else if (entry.type === 'project') studio.setTab('projects');
    else if (entry.type === 'combine') onCompose(`${en ? 'Help me turn these research tasks into a project with practical steps:' : 'ساعدني أحوّل هذه البحوث لمشروع بخطوات عملية:'}\n${entry.tasks.map((task) => task.topic).join('\n')}`);
    else research.startTask(entry.task.topic, lang);
  };
  return <details className="aql-suggestions"><summary>✦ {en ? 'A thought from AQL' : 'عقل يقترح'} <span>{studio.suggestions.length}</span></summary><p className="studio-muted">{en ? 'Based only on your visible tasks and projects. Suggestions never execute on their own.' : 'من مهامك ومشاريعك الظاهرة فقط. الاقتراحات لا تنفّذ شيئًا تلقائيًا.'}</p><div className="suggestion-grid">{studio.suggestions.map((entry) => <article key={entry.id}><p>{describe(entry)}</p><div className="studio-actions"><button className="studio-text-button" disabled={entry.type === 'refresh' && (research.creating || !!research.active.length)} onClick={() => act(entry)}>{en ? 'Let’s look ↗' : 'خلّنا نشوف ↗'}</button><button className="studio-text-button" onClick={() => studio.dismissSuggestion(entry.id, true)}>{en ? 'In 24 hours' : 'بعد يوم'}</button><button className="studio-text-button" onClick={() => studio.dismissSuggestion(entry.id, false)}>{en ? 'Don’t suggest this' : 'لا تقترحها'}</button></div></article>)}</div>{!studio.suggestions.length && <p className="studio-empty">{en ? 'Nothing to nudge you about. Suggestions grow from your activity here.' : 'ما فيه شيء أقترحه الآن. الاقتراحات تتكوّن مع شغلك هنا.'}</p>}{!!Object.keys(studio.state.dismissed).length && <button className="studio-text-button" onClick={studio.resetSuggestions}>{en ? 'Restore snoozed and dismissed suggestions' : 'أظهر الاقتراحات المؤجلة والمرفوضة من جديد'}</button>}</details>;
}

export default function LivingSpace({ onCompose, onNavigate }) {
  const { lang } = useLang(); const en = lang === 'en'; const studio = useStudio();
  const options = en ? [['focus', '◷', 'Focus'], ['desk', '▤', 'My desk'], ['ideas', '⌘', 'Ideas'], ['projects', '✿', 'Projects'], ['memory', '◈', 'Memory'], ['ambience', '♫', 'Atmosphere'], ['device', '▧', 'My device'], ['calendar', '▦', 'My calendar'], ['tasks', '✓', 'Tasks']] : [['focus', '◷', 'نركّز'], ['desk', '▤', 'مكتبي'], ['ideas', '⌘', 'خريطة الأفكار'], ['projects', '✿', 'مشاريعي'], ['memory', '◈', 'الذاكرة'], ['ambience', '♫', 'الأجواء'], ['device', '▧', 'جهازي'], ['calendar', '▦', 'تقويمي'], ['tasks', '✓', 'مهامي']];
  const groups = [
    { id: 'day', label: en ? 'My day' : 'يومي', tools: ['tasks', 'calendar', 'focus'] },
    { id: 'space', label: en ? 'My space' : 'مساحتي', tools: ['desk', 'projects', 'ideas'] },
    { id: 'tools', label: en ? 'My tools' : 'أدواتي', tools: ['device', 'memory', 'ambience'] },
  ];
  const group = groups.find(item => item.tools.includes(studio.state.tab)) || groups[0];
  const visibleOptions = group.tools.map(key => options.find(option => option[0] === key));
  return <section className="living-space" data-skip-i18n="1" aria-labelledby="living-space-title"><div className="section-heading"><div><span className="section-kicker">{en ? 'YOUR PERSONAL SPACE' : 'كل شيء في مكانه'}</span><h2 id="living-space-title">{en ? 'Your day. Your ideas. Your tools.' : 'يومك، أفكارك، وأدواتك.'}</h2></div><small className="studio-local-note">{en ? 'Tasks and calendar sync to your account. Other tools stay on this browser.' : 'المهام والتقويم بحسابك. باقي أدوات المساحة تُحفظ في هذا المتصفح.'}</small></div>
    <Suggestions onCompose={onCompose} />
    <div className="tool-groups" aria-label={en ? 'Tool collections' : 'مجموعات الأدوات'}>{groups.map(item => <button key={item.id} aria-pressed={group.id === item.id} onClick={() => studio.setTab(item.tools[0])}>{item.label}</button>)}</div>
    <div className="studio-tabs" role="tablist" aria-label={en ? 'Personal tools' : 'أدواتك الشخصية'}>{visibleOptions.map(([key, , label]) => <button key={key} type="button" id={`studio-tab-${key}`} aria-controls={`studio-panel-${key}`} role="tab" aria-selected={studio.state.tab === key} tabIndex={studio.state.tab === key ? 0 : -1} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = visibleOptions.findIndex(([id]) => id === key); const delta = event.key === 'ArrowRight' ? (en ? 1 : -1) : (en ? -1 : 1); const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleOptions.length - 1 : (index + delta + visibleOptions.length) % visibleOptions.length; studio.setTab(visibleOptions[next][0]); requestAnimationFrame(() => document.getElementById(`studio-tab-${visibleOptions[next][0]}`)?.focus()); } }} onClick={() => studio.setTab(key)}><AppIcon name={key} />{label}{key === 'focus' && studio.state.focus && <i />}{key === 'ambience' && studio.audioOn && <i />}</button>)}</div>
    {studio.error && <div className="studio-warning" role="alert"><span>{studio.error === 'STORAGE' ? (en ? 'Browser storage is unavailable. Your latest changes may not survive a reload.' : 'تخزين المتصفح غير متاح. قد لا تبقى التغييرات الأخيرة بعد تحديث الصفحة.') : (en ? 'Audio could not start. Try pressing play again or check browser permissions.' : 'تعذّر تشغيل الصوت. اضغط تشغيل مجددًا أو راجع صلاحيات الصوت في المتصفح.')}</span><button className="studio-text-button" onClick={studio.clearError}>×</button></div>}
    <div className="studio-panel" id={`studio-panel-${studio.state.tab}`} role="tabpanel" aria-labelledby={`studio-tab-${studio.state.tab}`} tabIndex={0}>
      {studio.state.tab === 'focus' && <FocusSpace />}{studio.state.tab === 'desk' && <DeskSpace />}{studio.state.tab === 'ideas' && <IdeasSpace onCompose={onCompose} onNavigate={onNavigate} />}{studio.state.tab === 'projects' && <ProjectsSpace onCompose={onCompose} />}{studio.state.tab === 'memory' && <MemorySpace />}{studio.state.tab === 'ambience' && <AmbienceSpace />}{studio.state.tab === 'device' && <DeviceSpace />}{studio.state.tab === 'calendar' && <CalendarSpace />}{studio.state.tab === 'tasks' && <TasksSpace />}
    </div>
  </section>;
}

export function StudioDock({ onReturn }) {
  const { lang } = useLang(); const en = lang === 'en'; const studio = useStudio();
  if (!studio.state.focus && !studio.audioOn && !studio.notice) return null;
  const focus = studio.state.focus;
  const time = `${Math.floor(studio.remaining / 60).toString().padStart(2, '0')}:${Math.floor(studio.remaining % 60).toString().padStart(2, '0')}`;
  return <aside className={`studio-dock ${focus?.phase === 'review' ? 'dock-review' : ''}`} data-skip-i18n="1" aria-label={en ? 'Focus and sound controls' : 'التحكم بالتركيز والصوت'}>
    {focus && <><button className="dock-open" onClick={() => { studio.setTab('focus'); onReturn(); }}><span>{focus.phase === 'review' ? (en ? 'What did you finish?' : 'وش أنجزت؟') : `${focus.phase === 'paused' ? 'Ⅱ' : '◷'} ${time}`}</span><small>{focus.label}</small></button>{focus.phase !== 'review' && <button className="studio-text-button" onClick={focus.phase === 'running' ? studio.pauseFocus : studio.resumeFocus} aria-label={en ? (focus.phase === 'running' ? 'Pause focus session' : 'Resume focus session') : (focus.phase === 'running' ? 'إيقاف جلسة التركيز مؤقتًا' : 'استئناف جلسة التركيز')}>{focus.phase === 'running' ? 'Ⅱ' : '▶'}</button>}</>}
    {studio.audioOn && <button className="studio-text-button" onClick={studio.stopAudio}>{en ? 'Sound off ■' : 'إيقاف الصوت ■'}</button>}
    {studio.notice && <p role="status">{studio.notice}</p>}
  </aside>;
}
