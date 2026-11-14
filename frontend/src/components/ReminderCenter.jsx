import { useCallback, useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import { supabase } from '../lib/supabase';
import { useProductivity } from '../lib/productivity-context';
import { useLang } from '../lib/lang';
import { dueReminders, reminderRecord } from '../lib/reminders';
import '../reminders.css';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const storageKey = id => `aql-reminders:${id}`;
export default function ReminderCenter() {
  const { lang } = useLang(); const en = lang === 'en'; const data = useProductivity();
  const [account, setAccount] = useState(null); const [record, setRecord] = useState(() => reminderRecord(null));
  const [storageError, setStorageError] = useState(false); const [calendarError, setCalendarError] = useState('');
  const [calendarEvents, setCalendarEvents] = useState([]); const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const [notice, setNotice] = useState(''); const dialog = useRef(null); const current = useRef({ id: null, record: reminderRecord(null) });
  const [toast, setToast] = useState(null); const calendarLoadedAt = useRef(0);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 10000); return () => clearTimeout(timer); }, [toast]);
  const openTarget = useCallback(item => { dialog.current?.close(); window.dispatchEvent(new CustomEvent('aql-navigate', { detail: { id: item.type === 'task' ? 'tasks' : 'calendar', ...(item.type === 'task' ? { taskId: item.target } : {}) } })); }, []);
  const persist = useCallback(next => {
    const id = current.current.id; if (!id) return;
    current.current.record = next; setRecord(next);
    try { localStorage.setItem(storageKey(id), JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }, []);
  useEffect(() => {
    let active = true;
    const select = session => {
      if (!active) return; const id = session?.user.id || null;
      if (id === current.current.id) return;
      let next = reminderRecord(null);
      if (id) try { next = reminderRecord(JSON.parse(localStorage.getItem(storageKey(id)) || 'null')); } catch { setStorageError(true); }
      current.current = { id, record: next }; setAccount(id); setRecord(next); setCalendarEvents([]); setNotice(''); setToast(null); calendarLoadedAt.current = 0;
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => select(session));
    void supabase.auth.getSession().then(({ data: auth }) => select(auth.session));
    const sync = event => { if (current.current.id && event.key === storageKey(current.current.id)) try { const next = reminderRecord(JSON.parse(event.newValue || 'null')); current.current.record = next; setRecord(next); } catch { setStorageError(true); } };
    window.addEventListener('storage', sync);
    return () => { active = false; listener.subscription.unsubscribe(); window.removeEventListener('storage', sync); current.current.id = null; };
  }, []);
  const settings = record.settings;
  useEffect(() => {
    if (!account || !settings.enabled || !settings.calendar || !data.calendar?.connected) return;
    let active = true; let busy = false; const controller = new AbortController();
    const refresh = async () => {
      if (busy) return; busy = true;
      try {
        const { data: auth } = await supabase.auth.getSession(); if (!auth.session || auth.session.user.id !== account) return;
        const now = new Date(); const until = new Date(now.getTime() + 2 * 86400000);
        const query = new URLSearchParams({ from: now.toISOString(), until: until.toISOString() }); let page; let all = [];
        for (let count = 0; count < 5; count++) {
          const response = await fetch(`${API}/api/calendar/events?${query}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { Authorization: `Bearer ${auth.session.access_token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
          const value = await response.json(); if (!response.ok || !Array.isArray(value.events)) throw new Error('calendar');
          all = [...all, ...value.events]; page = value.nextPageToken; if (!page) break;
        }
        if (page) throw new Error('calendar');
        if (active) { calendarLoadedAt.current = Date.now(); setCalendarEvents(all); setCalendarError(''); }
      } catch { if (active) { setCalendarEvents([]); setCalendarError('calendar'); } }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(refresh, 60000); const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('aql-data-changed', refresh);
    return () => { active = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('aql-data-changed', refresh); };
  }, [account, settings.enabled, settings.calendar, data.calendar?.connected]);
  useEffect(() => {
    if (!account || !settings.enabled) return;
    let active = true;
    const tick = async () => {
      const deliver = async () => {
        if (!active || current.current.id !== account) return;
        let next = current.current.record;
        try { const saved = localStorage.getItem(storageKey(account)); if (saved) next = reminderRecord(JSON.parse(saved)); } catch { /* memory still prevents repeats in this tab */ }
        const candidates = dueReminders({ tasks: !data.errors.tasks && Date.now() - data.tasksUpdatedAt < 90000 ? data.tasks : [], events: data.calendar?.connected && !data.errors.calendar && !calendarError && Date.now() - calendarLoadedAt.current < 90000 ? calendarEvents : [], settings: next.settings }).filter(item => !next.seen[item.key]);
        if (!candidates.length) return;
        const now = Date.now(); const delivered = candidates.map(item => ({ ...item, deliveredAt: now, read: false }));
        next = reminderRecord({ ...next, seen: { ...next.seen, ...Object.fromEntries(delivered.map(item => [item.key, now])) }, inbox: [...delivered, ...next.inbox].slice(0, 50) });
        persist(next);
        setToast(delivered[0]);
        for (const item of delivered.slice(0, 3)) {
          if (next.settings.desktop && 'Notification' in window && Notification.permission === 'granted') {
            try { const notification = new Notification(en ? 'AQL reminder' : 'تذكير من عقل', { body: item.title, tag: item.key }); notification.onclick = () => { window.focus(); openTarget(item); notification.close(); }; } catch { setNotice(en ? 'System notifications could not be shown. Reminders are in your inbox.' : 'تعذّر عرض إشعارات النظام. التذكيرات موجودة في المركز.'); }
          }
        }
      };
      // Serialize tabs so one account reminder is delivered once on this browser.
      if (navigator.locks?.request) await navigator.locks.request(`aql-reminders:${account}`, deliver); else await deliver();
    };
    void tick(); const timer = setInterval(() => void tick(), 15000); const visible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [account, settings.enabled, settings.tasks, settings.calendar, settings.lead, settings.taskTime, settings.desktop, data.tasks, data.tasksUpdatedAt, data.errors.tasks, data.errors.calendar, data.calendar?.connected, calendarEvents, calendarError, en, persist, openTarget]);
  const configure = patch => persist({ ...current.current.record, settings: { ...current.current.record.settings, ...patch } });
  const desktop = async () => {
    if (!('Notification' in window) || !window.isSecureContext) { setNotice(en ? 'System notifications require a supported browser and HTTPS.' : 'إشعارات النظام تحتاج متصفحًا داعمًا واتصال HTTPS.'); return; }
    try { const result = await Notification.requestPermission(); setPermission(result); configure({ desktop: result === 'granted' }); if (result !== 'granted') setNotice(en ? 'Allow notifications in site settings. In-app reminders still work.' : 'اسمح بالإشعارات من إعدادات الموقع. التنبيهات داخل عقل تبقى متاحة.'); } catch { setNotice(en ? 'Could not request notification permission.' : 'تعذّر طلب إذن الإشعارات.'); }
  };
  const unread = record.inbox.filter(item => !item.read).length;
  const show = () => { setPermission('Notification' in window ? Notification.permission : 'unsupported'); dialog.current.showModal(); };
  return <><button className="reminder-trigger" onClick={show} aria-label={en ? `Reminders, ${unread} unread` : `التنبيهات، ${unread} غير مقروءة`} data-skip-i18n="1"><AppIcon name="bell" /><span>{en ? 'Reminders' : 'التنبيهات'}</span>{unread > 0 && <b>{unread}</b>}</button>
    <span className="reminder-sr" role="status">{unread ? (en ? `${unread} unread reminders. ${record.inbox[0]?.title || ''}` : `${unread} تنبيهات غير مقروءة. ${record.inbox[0]?.title || ''}`) : ''}</span>
    {toast && <aside className="reminder-toast" data-skip-i18n="1"><button onClick={() => { setToast(null); show(); }}><AppIcon name="bell" /><span><small>{en ? 'AQL reminder' : 'تذكير من عقل'}</small><strong dir="auto">{toast.title}</strong></span></button><button aria-label={en ? 'Dismiss reminder' : 'إخفاء التذكير'} onClick={() => setToast(null)}>×</button></aside>}
    <dialog ref={dialog} className="reminder-dialog" data-skip-i18n="1" aria-labelledby="reminder-title"><header><h2 id="reminder-title">{en ? 'A little nudge, on time.' : 'تذكير صغير، بوقته.'}</h2><button className="studio-text-button" onClick={() => dialog.current.close()} aria-label={en ? 'Close' : 'إغلاق'}>×</button></header>
      <p className="studio-muted">{en ? 'Works while this website stays open. Closed pages, sleeping devices and browser throttling can stop or delay reminders. Settings and history stay on this browser, separately for your account.' : 'تعمل ما دام الموقع مفتوحًا. إغلاق الصفحة أو سكون الجهاز أو تقييد المتصفح قد يوقف التنبيه أو يؤخره. الإعدادات والسجل محفوظة في هذا المتصفح لحسابك.'}</p>
      <label className="reminder-check"><input type="checkbox" checked={settings.enabled} disabled={!account} onChange={e => configure({ enabled: e.target.checked })} />{en ? 'Enable reminders on this browser' : 'فعّل التذكيرات في هذا المتصفح'}</label>
      <fieldset disabled={!account || !settings.enabled}><legend>{en ? 'When should I remind you?' : 'متى أذكّرك؟'}</legend><label className="reminder-check"><input type="checkbox" checked={settings.calendar} onChange={e => configure({ calendar: e.target.checked })} />{en ? 'Google Calendar appointments' : 'مواعيد تقويم Google'}</label><label>{en ? 'Before the appointment' : 'قبل الموعد'}<select aria-label={en ? 'Appointment reminder time' : 'وقت تذكير الموعد'} value={settings.lead} onChange={e => configure({ lead: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map(n => <option key={n} value={n}>{n === 0 ? (en ? 'At start time' : 'عند بداية الموعد') : `${n} ${en ? 'minutes' : 'دقيقة'}`}</option>)}</select></label>
      <label className="reminder-check"><input type="checkbox" checked={settings.tasks} onChange={e => configure({ tasks: e.target.checked })} />{en ? 'Incomplete tasks on their due date' : 'المهام غير المنجزة في يوم استحقاقها'}</label><label>{en ? 'Task reminder time' : 'وقت تذكير المهام'}<input type="time" aria-label={en ? 'Task reminder time' : 'وقت تذكير المهام'} value={settings.taskTime} onChange={e => { if (e.target.value) configure({ taskTime: e.target.value }); }} /></label><small>{Intl.DateTimeFormat().resolvedOptions().timeZone} · {en ? 'All-day appointments and tasks without a due date do not send reminders.' : 'المواعيد طوال اليوم والمهام بلا تاريخ استحقاق لا ترسل تنبيهًا.'}</small>
      <div className="studio-actions"><button type="button" className="studio-primary" onClick={desktop}>{en ? 'Allow system notifications' : 'اسمح بإشعارات النظام'}</button>{settings.desktop && <button type="button" className="studio-text-button" onClick={() => configure({ desktop: false })}>{en ? 'Use in-app reminders only' : 'اكتفِ بالتنبيهات داخل عقل'}</button>}</div><p className="studio-muted">{settings.desktop && permission === 'granted' ? (en ? 'System notifications enabled.' : 'إشعارات النظام مفعّلة.') : (en ? 'Reminders appear in this center; system notifications are off.' : 'التذكيرات تظهر في هذا المركز؛ إشعارات النظام غير مفعّلة.')}</p></fieldset>
      {(notice || storageError || (settings.enabled && (calendarError || data.errors.tasks || data.errors.calendar))) && <p role="status" className="studio-warning">{notice || (storageError ? (en ? 'Browser storage is unavailable; settings may be lost on reload.' : 'تخزين المتصفح غير متاح؛ قد تفقد الإعدادات بعد التحديث.') : (en ? 'Some reminder sources could not refresh. Check your tasks and calendar.' : 'تعذّر تحديث بعض مصادر التنبيه. راجع المهام والتقويم.'))}</p>}
      {settings.enabled && settings.calendar && !data.calendar?.connected && <p className="studio-muted">{en ? 'Connect Google Calendar to enable appointment reminders.' : 'اربط تقويم Google لتفعيل تذكيرات المواعيد.'}</p>}
      <section className="reminder-inbox"><header><h3>{en ? 'Recent reminders' : 'آخر التنبيهات'}</h3><button className="studio-text-button" disabled={!unread} onClick={() => persist({ ...current.current.record, inbox: current.current.record.inbox.map(item => ({ ...item, read: true })) })}>{en ? 'Mark all read' : 'قراءة الكل'}</button></header>{!record.inbox.length && <p className="studio-muted">{en ? 'No reminders yet.' : 'ما فيه تنبيهات إلى الآن.'}</p>}<ul>{record.inbox.map(item => <li key={item.key}><button onClick={() => { persist({ ...current.current.record, inbox: current.current.record.inbox.map(row => row.key === item.key ? { ...row, read: true } : row) }); openTarget(item); }}><small>{item.type === 'task' ? (en ? 'Task due' : 'مهمة مستحقة') : (en ? 'Appointment' : 'موعد')} · {new Intl.DateTimeFormat(en ? 'en' : 'ar', { dateStyle: 'short', timeStyle: 'short' }).format(item.when)}</small><strong dir="auto">{!item.read && '● '}{item.title}</strong></button></li>)}</ul></section>
    </dialog></>;
}
