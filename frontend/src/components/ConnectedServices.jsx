import SpotifySearch from './SpotifySearch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/lang';
import AppIcon from './AppIcon';
import TelegramReminderSettings from './TelegramReminderSettings';
import '../connected-services.css';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export default function ConnectedServices() {
  const { lang } = useLang(); const en = lang === 'en'; const dialog = useRef(null);
  const [status, setStatus] = useState(null); const [link, setLink] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [open, setOpen] = useState(false);
  const call = useCallback(async (path, method = 'GET', body) => {
    const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error(en ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
    const response = await fetch(`${API}/api/telegram/${path}`, { method, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Telegram unavailable'); return value;
  }, [en]);
  const refresh = useCallback(async () => { const value = await call('status'); setStatus(value); return value; }, [call]);
  const perform = async action => { setBusy(true); setError(''); try { await action(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  useEffect(() => {
    if (!open) return;
    let active = true;
    const update = async () => { try { const value = await call('status'); if (active) setStatus(value); } catch (failure) { if (active) setError(failure.message); } };
    void update(); const timer = setInterval(update, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [open, call]);
  const show = () => { dialog.current.showModal(); setOpen(true); };
  return <><button className="services-trigger" onClick={show} aria-label={en ? 'Connected services' : 'الخدمات المرتبطة'} data-skip-i18n="1"><AppIcon name="services" /><span>{en ? 'Services' : 'الخدمات'}</span></button>
    <dialog ref={dialog} className="services-dialog" data-skip-i18n="1" onClose={() => setOpen(false)} aria-labelledby="services-title"><header><h2 id="services-title">{en ? 'Connected services' : 'الخدمات المرتبطة'}</h2><button className="studio-text-button" onClick={() => { dialog.current.close(); setOpen(false); }} aria-label={en ? 'Close' : 'إغلاق'}>×</button></header>
      <SpotifySearch /><section><div className="services-heading"><AppIcon name="services" /><div><h3>Telegram</h3><p>@{status?.username || 'aql_jarvis_assistant_bot'}</p></div><strong>{status?.connected ? (en ? 'Connected' : 'متصل') : (en ? 'Not connected' : 'غير متصل')}</strong></div>
      <p>{en ? 'Read your day and tasks from your private bot chat, and optionally receive scheduled reminders. Requested details and enabled reminders are shared with Telegram. Editing still happens on the website.' : 'شوف يومك ومهامك من محادثتك الخاصة مع البوت، وفعّل التذكيرات إذا رغبت. البيانات المطلوبة والتذكيرات المفعّلة تُرسل إلى Telegram. التعديل يبقى من الموقع.'}</p>
      {!status && !error && <p role="status">{en ? 'Checking…' : 'أتحقق من الربط…'}</p>}
      {status && !status.configured && <p className="studio-warning">{en ? 'Server setup needed: add the Telegram environment variables in Render and run backend/migrations/telegram.sql in Supabase. Never paste the bot token here.' : 'نحتاج إعداد الخادم: أضف متغيرات Telegram في Render وشغّل backend/migrations/telegram.sql في Supabase. لا تضع مفتاح البوت في هذه الصفحة.'}</p>}
      {status?.configured && !status.connected && <><ol><li>{en ? 'Create your private connection link below.' : 'أنشئ رابط الربط الخاص بك من الزر أدناه.'}</li><li>{en ? 'Open Telegram using the link, then press Start.' : 'افتح Telegram من الرابط واضغط Start.'}</li><li>{en ? 'Return here, verify the Telegram account name, then confirm.' : 'ارجع هنا وتحقق من اسم حساب Telegram، ثم أكّد الربط.'}</li></ol><button className="services-primary" disabled={busy} onClick={() => perform(async () => { const value = await call('link', 'POST', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setLink(value.url); await refresh(); })}>{en ? 'Create a connection link' : 'أنشئ رابط الربط'}</button></>}
      {link && !status?.connected && <p><a className="services-open" href={link} target="_blank" rel="noopener noreferrer">{en ? 'Open bot and press Start ↗' : 'افتح البوت واضغط Start ↗'}</a><small>{en ? 'Private link, expires in 10 minutes. Do not share it.' : 'رابط خاص صالح ١٠ دقائق. لا تشاركه.'}</small></p>}
      {status?.pending && <div className="services-pending"><p>{status.pending.claimed ? (en ? 'Verify this Telegram account:' : 'تأكد أن هذا حسابك في Telegram:') : (en ? 'Waiting for Start in Telegram…' : 'أنتظر ضغط Start في Telegram…')}</p>{status.pending.claimed && <><strong dir="auto">{status.pending.displayName} {status.pending.username ? `(@${status.pending.username})` : ''}</strong><button className="services-primary" disabled={busy} onClick={() => perform(async () => { await call('confirm', 'POST'); setLink(''); await refresh(); })}>{en ? 'This is my account — confirm' : 'هذا حسابي — أكّد الربط'}</button></>}<button className="studio-text-button" disabled={busy} onClick={() => perform(async () => { await call('pending', 'DELETE'); setLink(''); await refresh(); })}>{en ? 'Cancel connection request' : 'ألغِ طلب الربط'}</button></div>}
      {status?.connected && <><p dir="auto">{status.connection.displayName} {status.connection.username ? `(@${status.connection.username})` : ''}</p><p><code>/today</code> — {en ? 'Your appointments and due tasks' : 'مواعيدك ومهامك المستحقة'}<br /><code>/tasks</code> — {en ? 'Remaining tasks' : 'المهام المتبقية'}<br /><code>/unlink</code> — {en ? 'Disconnect AQL' : 'فصل الربط'}</p><a className="services-open" href={`https://t.me/${status.username}`} target="_blank" rel="noopener noreferrer">{en ? 'Open Telegram ↗' : 'افتح Telegram ↗'}</a><button className="studio-text-button" disabled={busy} onClick={() => perform(async () => { await call('connection', 'DELETE'); setLink(''); await refresh(); })}>{en ? 'Disconnect' : 'افصل الحساب'}</button></>}
      {status?.connected && <TelegramReminderSettings call={call} />}
      {error && <p className="studio-warning" role="alert">{error}</p>}<button className="studio-text-button" disabled={busy} onClick={() => perform(refresh)}>{en ? 'Refresh status' : 'حدّث الحالة'}</button>
      </section>
    </dialog></>;
}
