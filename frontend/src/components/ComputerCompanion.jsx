import { useEffect, useState } from 'react';
import { companionCall } from '../lib/companion';
import { supabase } from '../lib/supabase';

export function ComputerControls() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(!!sessionStorage.getItem('aql-companion-mode'));
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus('تم نسخ رمز الربط كاملًا.');
    } catch {
      setStatus('تعذّر النسخ التلقائي. اضغط مطوّلًا على الرمز واختر «نسخ».');
    }
  }
  async function action(kind) {
    setBusy(true);
    try {
      if (kind === 'pair') {
        const result = await companionCall('/pair', 'POST', {});
        setCode(result.code); setStatus('');
      } else if (kind === 'disconnect') {
        await companionCall('/pair', 'DELETE');
        sessionStorage.removeItem('aql-companion-mode'); setEnabled(false); setCode(''); setStatus('تم فصل الكمبيوتر.');
      } else if (enabled) {
        sessionStorage.removeItem('aql-companion-mode'); setEnabled(false); setStatus('');
      } else {
        const result = await companionCall('/status');
        if (!result.online) throw Error('في انتظار اتصال مساعد ويندوز.');
        const { data } = await supabase.auth.getSession();
        sessionStorage.setItem('aql-companion-mode', data.session.user.id);
        setEnabled(true); setCode(''); setStatus('تقدر الآن تطلب من جارفس بالصوت أو الكتابة.');
      }
    } catch (e) { setStatus(e.message); } finally { setBusy(false); }
  }
  return <section className="device-preview" dir="rtl"><h4>جارفس على الكمبيوتر</h4>
    <p>افتح <code dir="ltr">start-companion.cmd</code> من مجلد backend على الكمبيوتر. أنشئ رمزًا هنا والصقه في نافذة ويندوز خلال دقيقتين، ثم فعّل توجيه المحادثة.</p>
    <p>عند التفعيل، تُوجّه طلباتك إلى مجلد عمل الكمبيوتر. يقدر جارفس يجهّز مجلدات وملاحظات ويفتح Steam.</p>
    <div className="studio-actions"><button disabled={busy} onClick={() => action('pair')}>إنشاء رمز ربط جديد</button><button disabled={busy} onClick={() => action('mode')}>{enabled ? 'ارجع للمحادثة العادية' : 'وجّه المحادثة للكمبيوتر'}</button><button disabled={busy} onClick={() => action('disconnect')}>فصل الكمبيوتر</button></div>
    {code && <div className="studio-actions">
      <span>رمز الربط <code dir="ltr" style={{ userSelect: 'all', overflowWrap: 'anywhere' }}>{code}</code></span>
      <button type="button" disabled={busy} onClick={copyCode}>نسخ الرمز</button>
    </div>}
    {status && <p role="status">{status}</p>}
  </section>;
}

export function ComputerResult() {
  const [view, setView] = useState(null);
  useEffect(() => {
    const show = event => setView(event.detail);
    window.addEventListener('aql-companion-result', show);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setView(previous => previous?.owner === session?.user.id ? previous : null);
    });
    return () => { window.removeEventListener('aql-companion-result', show); data.subscription.unsubscribe(); };
  }, []);
  const id = view?.job?.done ? null : view?.job?.id;
  const captureAfter = view?.showResult && view.job?.succeeded ? view.job.id : null;
  useEffect(() => {
    if (!captureAfter) return;
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('aql-screen-compose', { detail: 'خذ لقطة من شاشة الكمبيوتر' }));
    }, 1500);
    return () => clearTimeout(timer);
  }, [captureAfter]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer;
    async function check() {
      try {
        const { job, online } = await companionCall('/status', 'GET', undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (job?.id !== id || !online) throw Error('انقطع الاتصال بالكمبيوتر. تحقّق من نتيجة المهمة في نافذة ويندوز.');
        setView(previous => previous?.job?.id === id ? { ...previous, job } : previous);
        if (!job.done) timer = setTimeout(check, 2000);
      } catch (e) { if (!controller.signal.aborted) setView(previous => ({ owner: previous?.owner, error: e.message })); }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);
  if (!view) return null;
  return <aside className="completion-notice" dir="rtl" role="status"><div><strong>جارفس على الكمبيوتر</strong>
    {view.job?.results?.map((line, i) => <p key={i}>{line}</p>)}<p>{view.error || view.job?.note || (view.job?.done ? 'انتهت المهمة.' : 'بانتظار نتيجة الكمبيوتر…')}</p></div>
    {id && <button onClick={async () => { try { await companionCall('/stop', 'POST', {}); } catch (e) { setView({ error: e.message }); } }}>وقف</button>}
    <button aria-label="إغلاق" onClick={() => setView(null)}>×</button></aside>;
}
