import { supabase } from './supabase';

const base = (import.meta.env.VITE_API_URL || 'http://localhost:5000') + '/api/device/companion';
export async function companionCall(route, method = 'GET', body, signal) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw Error('سجّل الدخول إلى عقل.');
  const timeout = AbortSignal.timeout(120000);
  const res = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  if (res.status === 204) return {};
  if (!res.ok) {
    const value = await res.json().catch(() => ({}));
    throw Error(({ offline: 'الكمبيوتر غير متصل. افتح مساعد ويندوز وتحقق من الربط.', busy: 'فيه مهمة شغالة على الكمبيوتر.' })[value.error] || 'تعذّر الاتصال بمساعد الكمبيوتر.');
  }
  return res.json();
}
export async function companionCommand(text, signal) {
  const owner = sessionStorage.getItem('aql-companion-mode');
  if (!owner) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== owner || signal?.aborted) return null;
  try {
    const stop = /^(?:وقف|توقف|أوقف|اوقف|إيقاف|الغ|ألغ|stop|cancel)(?: المهمة| التنفيذ| task)?[.!؟]?$/i.test(text.trim());
    const { job } = await companionCall(stop ? '/stop' : '/task', 'POST', stop ? {} : { message: text }, signal);
    window.dispatchEvent(new CustomEvent('aql-companion-result', { detail: { job, owner } }));
    if (stop) return job && !job.done ? 'طلبت إيقاف الخطوات المتبقية.' : 'ما فيه مهمة قيد التنفيذ.';
    return job.note || 'أُرسل الطلب للكمبيوتر. بتظهر نتيجة التنفيذ هنا.';
  } catch (e) {
    if (!signal?.aborted) window.dispatchEvent(new CustomEvent('aql-companion-result', { detail: { error: e.message, owner } }));
    return e.message;
  }
}
