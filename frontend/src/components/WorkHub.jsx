import { TodayCard } from './ProductivityTools';
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/lang';
import { arabicResearchErrors, stageLabels, taskFinished, taskStages, useResearch } from '../lib/research-context';
import AssistantCompanion from './AssistantCompanion';
import LivingSpace from './LivingSpace';

function TaskCard({ task, en }) {
  const { openTask, opening } = useResearch();
  const labels = stageLabels(en);
  const status = task.status === 'completed' ? 'done' : task.status === 'failed' ? 'attention' : 'working';
  const index = taskStages.indexOf(task.status);
  return <article className={`work-card tone-${status}`} data-skip-i18n="1">
    <div className="work-card-top"><span className="file-glyph" aria-hidden="true">{status === 'done' ? '▤' : status === 'attention' ? '↻' : '✧'}</span><span className="status-pill"><i />{labels[task.status]}</span></div>
    <h3 dir="auto">{task.topic}</h3>
    <p>{task.status === 'completed' ? (en ? 'Research report · PDF / Word' : 'تقرير بحث · PDF / Word') : task.status === 'failed' ? (en ? 'Review the details and try again.' : 'راجع التفاصيل ونكمّل من جديد.') : (en ? `${task.sources?.length || 0} sources read so far` : `${task.sources?.length || 0} مصادر مقروءة حتى الآن`)}</p>
    {!taskFinished(task.status) && <ol className="task-step-track" aria-label={en ? 'Execution stages' : 'مراحل التنفيذ'}>{taskStages.slice(1, -1).map((stage, position) => <li key={stage} className={position + 1 <= index ? 'step-reached' : ''} aria-current={stage === task.status ? 'step' : undefined} title={labels[stage]}><span className="sr-only">{labels[stage]}</span></li>)}</ol>}
    <div className="work-card-footer"><time dateTime={task.created_at}>{new Intl.DateTimeFormat(en ? 'en' : 'ar', { month: 'short', day: 'numeric' }).format(new Date(task.created_at))}</time><button type="button" disabled={opening} onClick={() => openTask(task.id)}>{en ? (status === 'done' ? 'Open report' : 'View task') : (status === 'done' ? 'افتح التقرير' : 'شوف المهمة')} <span aria-hidden="true">↗</span></button></div>
  </article>;
}

export function ReportContent({ report, sources = [] }) {
  const inline = (text) => String(text).split(/(\[\d+\])/g).map((part, index) => {
    const source = sources.find((item) => `[${item.id}]` === part);
    return source ? <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{part}</a> : part;
  });
  const lines = String(report || '').split(/\r?\n/); const content = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    if (line.includes('|') && /^\|?\s*:?-{3,}/.test(lines[i + 1]?.trim() || '')) {
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const head = cells(line); const rows = []; i++;
      while (lines[i + 1]?.includes('|')) rows.push(cells(lines[++i].trim()));
      content.push(<div className="report-table-scroll" key={i}><table><thead><tr>{head.map((cell, j) => <th key={j}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (line.startsWith('# ')) content.push(<h2 key={i}>{inline(line.slice(2))}</h2>);
    else if (line.startsWith('## ')) content.push(<h3 key={i}>{inline(line.slice(3))}</h3>);
    else if (line.startsWith('### ')) content.push(<h4 key={i}>{inline(line.slice(4))}</h4>);
    else if (/^https?:\/\/\S+$/.test(line)) content.push(<p key={i}><a href={line} target="_blank" rel="noopener noreferrer">{line}</a></p>);
    else content.push(<p key={i} className={line.startsWith('- ') ? 'report-finding' : ''}>{inline(line.replace(/^- /, '• '))}</p>);
  }
  return <div className="report-reading" data-skip-i18n="1">{content}</div>;
}

export function TaskPreview({ onContinue }) {
  const { lang } = useLang(); const en = lang === 'en';
  const { selected, closeTask, download, exporting, startTask, active, creating, error } = useResearch();
  const dialog = useRef(null); const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId && !dialog.current.open) dialog.current.showModal();
    if (!selectedId && dialog.current.open) dialog.current.close();
  }, [selectedId]);
  const labels = stageLabels(en);
  return <dialog ref={dialog} className="task-preview" onCancel={closeTask} onClose={closeTask} aria-labelledby="preview-title" data-skip-i18n="1">
    {selected && <>
      <header className="preview-heading"><div><span className={`status-pill ${selected.status === 'completed' ? 'status-ready' : ''}`}>{labels[selected.status]}</span><h2 id="preview-title">{selected.topic}</h2></div><button className="icon-button" onClick={closeTask} aria-label={en ? 'Close preview' : 'إغلاق المعاينة'}>×</button></header>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {selected.status === 'completed' ? <>
        <div className="preview-actions">{['pdf', 'docx', 'md'].map((format) => <button key={format} className={format === 'pdf' ? 'primary-action' : 'secondary-action'} disabled={!!exporting} onClick={() => download(selected.id, format)}>{exporting === `${selected.id}:${format}` ? (en ? 'Preparing…' : 'أجهّز الملف…') : `${format === 'docx' ? 'Word' : format === 'md' ? 'Markdown' : 'PDF'} ↓`}</button>)}<button className="continue-action" onClick={() => { const draft = `${en ? 'Continue working on this report. Help me turn its findings into practical next steps.' : 'أكمل العمل على هذا التقرير وساعدني أحوّل نتائجه إلى خطوات عملية.'}\n\n${selected.report.slice(0, 8000)}`; closeTask(); onContinue(draft); }}>{en ? 'Continue with AQL ↗' : 'كمّل مع عقل ↗'}</button></div>
        <div dir={selected.lang === 'en' ? 'ltr' : 'rtl'}><ReportContent report={selected.report} sources={selected.sources} /></div>
      </> : <div className="preview-progress">
        <AssistantCompanion />
        <h3>{labels[selected.status]}</h3>
        {selected.status === 'failed' ? <><p>{en ? selected.error : arabicResearchErrors[selected.error_code] || 'لم تكتمل هذه المهمة. راجع الموضوع وحاول من جديد.'}</p><button className="primary-action" disabled={creating || !!active.length} onClick={() => startTask(selected.topic, selected.lang)}>{en ? 'Try this topic again' : 'أعد المحاولة بنفس الموضوع'} ↻</button></> : <p>{en ? 'You can leave this page. AQL will keep working while the server is running.' : 'تقدر تكمل شغلك هنا. عقل يتابع المهمة ما دام الخادم يعمل.'}</p>}
        {!!selected.sources?.length && <ul className="source-list">{selected.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a></li>)}</ul>}
        {!!selected.queries?.length && <details><summary>{en ? 'Search queries' : 'عبارات البحث'}</summary><ul>{selected.queries.map((query, i) => <li key={i}>{query}</li>)}</ul></details>}
      </div>}
    </>}
  </dialog>;
}

export function CompletionNotice() {
  const { lang } = useLang(); const en = lang === 'en';
  const { celebration, dismissCelebration, openTask } = useResearch();
  if (!celebration) return null;
  return <div className="completion-notice" role="status" data-skip-i18n="1"><span className="completion-check">✓</span><div><strong>{en ? 'Your next step is ready.' : 'جاهزة، وباقي خطوتك.'}</strong><button onClick={() => { openTask(celebration.id); dismissCelebration(); }}>{celebration.topic} ↗</button></div><button className="icon-button" onClick={dismissCelebration} aria-label={en ? 'Dismiss notification' : 'إغلاق الإشعار'}>×</button></div>;
}

export default function WorkHub({ displayName, onCompose, onNavigate, compact = false }) {
  const { lang } = useLang(); const en = lang === 'en';
  const { tasks, active, loading, error, creating, startTask, refresh } = useResearch();
  const [draft, setDraft] = useState(''); const [mode, setMode] = useState('research');
  const [filter, setFilter] = useState('all'); const [search, setSearch] = useState('');
  const completed = tasks.filter((task) => task.status === 'completed');
  const attention = tasks.filter((task) => task.status === 'failed');
  const library = tasks.filter((task) => taskFinished(task.status) && (filter === 'all' || (filter === 'ready' ? task.status === 'completed' : task.status === 'failed')) && task.topic.toLowerCase().includes(search.toLowerCase()));
  const submit = async (event) => {
    event.preventDefault(); if (draft.trim().length < 3) return;
    if (mode === 'plan') { onCompose(`${en ? 'Help me build an actionable plan for this goal. Ask about missing constraints before making assumptions:' : 'ساعدني أبني خطة عملية لهذا الهدف، واسألني عن القيود الناقصة قبل الافتراض:'}\n${draft.trim()}`); return; }
    const id = await startTask(draft, lang); if (id) setDraft('');
  };
  const quickModes = en ? [['research', '⌕', 'Research'], ['plan', '↗', 'Plan a goal'], ['file', '▤', 'Create a report']] : [['research', '⌕', 'ابحث'], ['plan', '↗', 'خطّط'], ['file', '▤', 'أنشئ تقريرًا']];
  return <main className={`work-hub ${compact ? 'hub-compact' : ''}`} data-skip-i18n="1">
    <section className="workspace-hero">
      <div className="hero-copy"><div className="workspace-eyebrow"><span />{en ? 'A LITTLE LESS BUSY. A LITTLE MORE DONE.' : 'زحمة أقل. إنجاز أكثر.'}</div>
        {!compact && <p className="personal-greeting">{en ? 'Hey' : 'أهلًا'} <bdi>{displayName?.split('@')[0]}</bdi> ✧</p>}
        <h1>{en ? 'What shall we' : 'وش ننجز'} <em>{en ? 'make happen?' : 'اليوم؟'}</em></h1>
        <p className="hero-subtitle">{en ? 'Bring the idea. I’ll help with the next step.' : 'هات الفكرة، ونرتّب الخطوة اللي بعدها سوا.'}</p>
        <form className="task-launcher" onSubmit={submit}><label htmlFor={compact ? 'chat-task-prompt' : 'home-task-prompt'} className="sr-only">{en ? 'What would you like to accomplish?' : 'ماذا تريد إنجازه؟'}</label><textarea id={compact ? 'chat-task-prompt' : 'home-task-prompt'} maxLength={500} minLength={3} required value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mode === 'plan' ? (en ? 'A goal you want to turn into a real plan…' : 'هدف تبغى تحوّله لخطة واضحة…') : mode === 'file' ? (en ? 'What should your PDF or Word report cover?' : 'وش موضوع تقرير PDF أو Word اللي تحتاجه؟') : (en ? 'A question to research, a comparison to explore…' : 'سؤال نبحثه، أو خيارات محتار بينها…')} /><div className="launcher-bottom"><span>{mode === 'plan' ? (en ? 'We’ll plan together in chat' : 'نرتّب الخطة سوا في المحادثة') : (en ? 'Web research → cited PDF & Word' : 'بحث ومصادر ← تقرير PDF وWord')}</span><button className="launch-button" disabled={creating || (mode !== 'plan' && !!active.length) || draft.trim().length < 3}>{creating ? (en ? 'Starting…' : 'أبدأ…') : (en ? 'Let’s do it' : 'يلا نبدأ')} <span aria-hidden="true">↗</span></button></div></form>
        <div className="quick-modes" role="group" aria-label={en ? 'Task type' : 'نوع المهمة'}>{quickModes.map(([id, icon, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? 'mode-active' : ''} onClick={() => setMode(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}</div>
        {!!active.length && <p className="launcher-hint">{en ? 'AQL is already researching. You can view progress below or plan something in chat.' : 'عقل يبحث الآن. تابع التقدم تحت، أو خطّط لشيء ثاني في المحادثة.'}</p>}
      </div>
      <div className="hero-companion"><span className="companion-sticker">{en ? 'BIG IDEAS WELCOME' : 'الأفكار الكبيرة مرحّب بها'}</span><AssistantCompanion /><span className="handwritten-note">{en ? 'Your brain’s +1' : 'عقل إضافي لليوم'}</span></div>
    </section>
    {!compact && <TodayCard onNavigate={(id, taskId) => window.dispatchEvent(new CustomEvent('aql-navigate', { detail: { id, taskId } }))} />}
    {!compact && <LivingSpace onCompose={onCompose} onNavigate={onNavigate} />}
    {error && <div className="workspace-error" role="alert"><span>{error}</span><button onClick={refresh}>{en ? 'Retry' : 'حاول مجددًا'} ↻</button></div>}
    <section className="workspace-section" aria-labelledby={compact ? 'chat-progress-title' : 'progress-title'}><div className="section-heading"><div><span className="section-kicker">{en ? 'IN MOTION' : 'في الطريق'}</span><h2 id={compact ? 'chat-progress-title' : 'progress-title'}>{en ? 'AQL is on it' : 'عقل ماسكها'} <span className="count-badge">{active.length}</span></h2></div><span className="quiet-text">{en ? 'Real progress, as it happens' : 'خطوة بخطوة، قدّامك'}</span></div>
      {loading ? <div className="workspace-empty" role="status">{en ? 'Loading your workspace…' : 'أجهّز مساحة إنجازك…'}</div> : active.length ? <div className="work-grid">{active.map((task) => <TaskCard key={task.id} task={task} en={en} />)}</div> : <div className="workspace-empty"><span aria-hidden="true">✧</span><div><strong>{en ? 'Room for your next idea.' : 'المساحة جاهزة لفكرتك.'}</strong><p>{en ? 'Start a research task above. Its progress will appear here.' : 'ابدأ بحثك من فوق، ومراحل تنفيذه بتظهر هنا.'}</p></div></div>}
    </section>
    <section className="workspace-section" aria-labelledby={compact ? 'chat-library-title' : 'library-title'}><div className="section-heading"><div><span className="section-kicker">{en ? 'MADE WITH AQL' : 'طلعنا فيها سوا'}</span><h2 id={compact ? 'chat-library-title' : 'library-title'}>{en ? 'Your library' : 'مكتبة إنجازاتك'}</h2></div><span className="library-total">{completed.length} {en ? 'ready' : 'جاهزة'} <span>·</span> {attention.length} {en ? 'to revisit' : 'تحتاج متابعة'}</span></div>
      <div className="library-controls"><div className="library-filters" role="group" aria-label={en ? 'Filter library' : 'تصفية المكتبة'}>{(en ? [['all', 'All'], ['ready', 'Ready'], ['attention', 'To revisit']] : [['all', 'الكل'], ['ready', 'جاهزة'], ['attention', 'نرجع لها']]).map(([id, text]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'filter-active' : ''} onClick={() => setFilter(id)}>{text}</button>)}</div><input className="library-search" type="search" aria-label={en ? 'Search your library' : 'ابحث في المكتبة'} placeholder={en ? 'Find something you made…' : 'دور على شيء أنجزته…'} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {!!library.length && <div className="work-grid">{library.map((task) => <TaskCard key={task.id} task={task} en={en} />)}</div>}
      {!loading && !library.length && <div className="workspace-empty"><span aria-hidden="true">▤</span><div><strong>{tasks.some((task) => taskFinished(task.status)) ? (en ? 'Nothing matches this view.' : 'ما فيه نتائج تطابق بحثك.') : (en ? 'Good things will live here.' : 'هنا مكان الأشياء اللي بننجزها.')}</strong><p>{en ? 'Your finished reports stay here, ready to read, download or continue.' : 'تقاريرك تبقى هنا: تقرأها، تنزّلها أو تكمّل عليها مع عقل.'}</p></div></div>}
    </section>
  </main>;
}
