import { pageNames } from '../lib/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/lang';
import { useStudio } from '../lib/studio-context';
import AppIcon from './AppIcon';
import '../navigation.css';

export default function Navigation({ page, setPage, displayName }) {
  const { lang } = useLang(); const en = lang === 'en'; const studio = useStudio(); const [open, setOpen] = useState(false);
  const menu = useRef(null); const drawer = useRef(null);
  const close = () => { setOpen(false); menu.current?.focus(); };
  useEffect(() => { if (!open) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; drawer.current?.querySelector('button')?.focus(); return () => { document.body.style.overflow = previous; }; }, [open]);
  const choose = (id, tool = false) => {
    if (tool) studio.setTab(id);
    setPage(tool ? 'dashboard' : id); if (open) close();
    if (tool) requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('.living-space')?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const item = (id, ar, english, tool = false) => {
    const active = tool ? page === 'dashboard' && studio.state.tab === id : page === id;
    return <button key={id} className={`navigation-link nav-btn ${active ? 'active' : ''}`} title={en ? english : ar} aria-current={active ? (tool ? 'location' : 'page') : undefined} data-destination={id} onClick={() => choose(id, tool)}><AppIcon name={id} /><span>{en ? english : ar}</span>{active && <i />}</button>;
  };
  return <>
    <div className="navigation-mobile" data-skip-i18n="1"><strong>AQL<span> / {en ? 'your space' : 'مساحتك'}</span></strong><button ref={menu} aria-label={en ? 'Open navigation' : 'فتح القائمة'} aria-expanded={open} aria-controls="aql-navigation" onClick={() => setOpen(!open)}><AppIcon name={open ? 'close' : 'menu'} /></button></div>
    {open && <button className="navigation-backdrop" aria-label={en ? 'Close navigation' : 'إغلاق القائمة'} onClick={close} />}
    <aside ref={drawer} id="aql-navigation" className={`aql-navigation ${open ? 'is-open' : ''}`} data-skip-i18n="1" onKeyDown={event => { if (event.key === 'Escape') close(); if (open && event.key === 'Tab') { const buttons = [...drawer.current.querySelectorAll('button, summary')].filter(element => element.getClientRects().length); const first = buttons[0]; const last = buttons.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}>
      <div className="navigation-brand"><span className="navigation-monogram">a<span>q</span>l.</span><small>{en ? 'A little more possible.' : 'مساحة لأفكارك.'}</small></div>
      <nav aria-label={en ? 'Main navigation' : 'القائمة الرئيسية'}>
        <div className="navigation-group">{item('dashboard', 'الرئيسية', 'Home')}{item('chat', 'تحدّث مع عقل', 'Talk to AQL')}</div>
        <div className="navigation-group"><h3>{en ? 'YOUR DAY' : 'يومك'}</h3>{item('tasks', 'المهام', 'Tasks', true)}{item('calendar', 'التقويم', 'Calendar', true)}{item('focus', 'التركيز', 'Focus', true)}</div>
        <div className="navigation-group"><h3>{en ? 'YOUR SPACE' : 'مساحتك'}</h3>{item('projects', 'المشاريع', 'Projects', true)}{item('desk', 'الملاحظات والملفات', 'Notes & files', true)}{item('device', 'خدمات الجهاز', 'Device services', true)}</div>
        <details className="navigation-more" open={['investigate', 'commitments', 'history', 'goals', 'reports', 'achievements', 'lifeos'].includes(page) || undefined}><summary><AppIcon name="more" />{en ? 'Life & insights' : 'الحياة والتحليلات'}</summary><div>{['goals', 'commitments', 'lifeos', 'investigate', 'reports', 'history', 'achievements'].map(id => item(id, ...pageNames[id]))}</div></details>
      </nav>
      <div className="navigation-account">{item('profile', 'حسابي', 'My account')}<small>{displayName}</small></div>
    </aside>
  </>;
}
