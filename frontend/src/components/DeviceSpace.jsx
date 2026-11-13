import { useState } from 'react';
import { useLang } from '../lib/lang';
import { supabase } from '../lib/supabase';
import '../device.css';

const BRIDGE = 'http://127.0.0.1:47831';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function DeviceSpace() {
  const { lang } = useLang(); const en = lang === 'en';
  const [key, setKey] = useState(''); const [device, setDevice] = useState(null);
  const [folder, setFolder] = useState(''); const [entries, setEntries] = useState([]); const [file, setFile] = useState(null);
  const [attach, setAttach] = useState(false); const [message, setMessage] = useState(''); const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const local = async (route, body) => {
    let response;
    try {
      response = await fetch(`${BRIDGE}/${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key.trim()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(route === 'execute' ? 150000 : 30000) });
    } catch { throw new Error(en ? 'Cannot reach your device. Start the bridge and allow local network access in your browser.' : 'تعذّر الاتصال بالجهاز. شغّل الجسر واسمح بالوصول للشبكة المحلية في المتصفح.'); }
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
  };
  const perform = async (label, action) => { setBusy(label); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const browse = async path => { const data = await local('list', { path }); setFolder(data.path); setEntries(data.entries); };
  const disconnect = () => { setKey(''); setDevice(null); setEntries([]); setFile(null); setPreview(null); setResult(null); setAttach(false); setError(''); };
  const connect = () => perform('connect', async () => { const status = await local('status'); await browse(''); setDevice(status); });
  const plan = () => perform('plan', async () => {
    setPreview(null); setResult(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error(en ? 'Sign in again.' : 'سجّل الدخول مجددًا.');
    const response = await fetch(`${API}/api/device/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ message, lang, entries: entries.slice(0, 100).map(entry => entry.path), ...(attach && file ? { attachment: { path: file.path, content: file.content.slice(0, 45000) } } : {}) }), signal: AbortSignal.timeout(150000) });
    const proposal = await response.json(); if (!response.ok) throw new Error(proposal.error || 'Planning failed');
    setPreview(await local('preview', proposal));
  });
  const execute = () => perform('execute', async () => {
    const id = preview.id; setPreview(null);
    const outcome = await local('execute', { id }); setResult(outcome); setFile(null); setAttach(false);
    const status = await local('status'); setDevice(status); await browse(folder);
  });
  const label = type => ({ write_file: en ? 'Write file' : 'كتابة ملف', make_directory: en ? 'Create folder' : 'إنشاء مجلد', check_javascript: en ? 'Check JavaScript syntax' : 'فحص صياغة JavaScript' })[type] || type;
  return <section className="device-space">
    <div className="section-heading"><div><span className="section-kicker">{en ? 'LOCAL DEVICE SERVICE' : 'خدمات جهازك'}</span><h3>{en ? 'AQL, with a workspace on your device.' : 'عقل صار له مساحة على جهازك.'}</h3></div><span className="status-pill">{device ? (en ? 'Connected' : 'متصل') : (en ? 'Disconnected' : 'غير متصل')}</span></div>
    <p className="studio-muted">{en ? 'Browse text files, build projects and review changes before applying them. The bridge only accesses the folder you select when starting it.' : 'تصفّح ملفاتك النصية وابنِ مشاريع وراجع التغييرات قبل تطبيقها. الجسر يصل فقط إلى المجلد الذي تختاره عند تشغيله.'}</p>
    {!device ? <div className="device-setup"><ol><li>{en ? 'Create a separate work folder, then run this from the backend folder (replace the example path):' : 'أنشئ مجلد عمل مستقل، ثم شغّل هذا الأمر من مجلد backend مع استبدال المسار:'}<pre dir="ltr">npm.cmd run device -- --workspace "C:\Users\YOUR_NAME\Desktop\AQL-Workspace"</pre></li><li>{en ? 'Paste the device key printed in that terminal. Keep the bridge running.' : 'الصق مفتاح الجهاز الذي يظهر في الطرفية واترك الجسر يعمل.'}</li></ol><form onSubmit={e => { e.preventDefault(); connect(); }} className="studio-actions"><label>{en ? 'Device key' : 'مفتاح الجهاز'}<input className="studio-input" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} required /></label><button className="studio-primary" disabled={!!busy || !key.trim()}>{busy ? '…' : en ? 'Connect device' : 'اربط الجهاز'}</button></form><p className="studio-muted">{en ? 'The key is kept in this panel’s memory only. Closing the bridge revokes it. The website may ask permission to connect to your local network.' : 'المفتاح يبقى في ذاكرة هذه اللوحة فقط؛ إغلاق الجسر يلغيه. قد يطلب المتصفح إذن الاتصال بالشبكة المحلية.'}</p></div> : <>
      <div className="device-connected"><code dir="ltr">{device.workspace}</code><button className="studio-text-button" disabled={!!busy} onClick={disconnect}>{en ? 'Disconnect' : 'قطع الاتصال'}</button></div>
      <div className="device-grid"><section className="device-files"><div className="studio-actions"><strong>{en ? 'Workspace files' : 'ملفات العمل'}</strong><button className="studio-text-button" disabled={!!busy} onClick={() => perform('browse', () => browse(folder))}>↻</button>{folder && <button className="studio-text-button" disabled={!!busy} onClick={() => perform('browse', () => browse(folder.split('/').slice(0, -1).join('/')))}>{en ? 'Up ↑' : 'للأعلى ↑'}</button>}</div><code dir="ltr">/{folder}</code><ul>{entries.map(entry => <li key={entry.path}><button disabled={!!busy} onClick={() => perform('browse', async () => { if (entry.kind === 'directory') await browse(entry.path); else { setFile(await local('read', { path: entry.path })); setAttach(false); } })}><span aria-hidden="true">{entry.kind === 'directory' ? '▣' : '▤'}</span> <span dir="auto">{entry.name}</span></button></li>)}</ul>{!entries.length && <p className="studio-muted">{en ? 'No supported files here yet.' : 'ما فيه ملفات مدعومة هنا حاليًا.'}</p>}
      </section><section><form onSubmit={e => { e.preventDefault(); plan(); }}><label>{en ? 'What should AQL build or change?' : 'وش تبي عقل يبني أو يعدّل؟'}<textarea className="studio-input" rows={4} maxLength={4000} required value={message} onChange={e => setMessage(e.target.value)} placeholder={en ? 'Build an Arabic landing page for my coffee shop in a new folder.' : 'ابنِ صفحة عربية لمقهى داخل مجلد جديد مع تصميم وألوان جميلة.'} /></label>{file && <label className="device-consent"><input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />{en ? 'Send this selected file to the AI for this request:' : 'أرسل محتوى هذا الملف المختار للذكاء الاصطناعي مع هذا الطلب:'} <code>{file.path}</code></label>}<p className="studio-muted">{en ? 'Your request and the currently listed filenames go to the AI. Up to 45,000 characters of file content are shared only when you tick the box. The device key and full workspace path stay local.' : 'طلبك وأسماء الملفات الظاهرة تُرسل للذكاء الاصطناعي. حتى ٤٥ ألف حرف من محتوى الملف تُرسل فقط عند تحديد الخيار. مفتاح الجهاز ومسار المجلد الكامل يبقيان محليًا.'}</p><button className="studio-primary" disabled={!!busy || !message.trim()}>{busy === 'plan' ? (en ? 'Preparing…' : 'أجهّز الخطة…') : (en ? 'Prepare a reviewable plan' : 'جهّز خطة أراجعها')}</button></form>
      {file && <details className="device-code"><summary>{en ? 'Selected file' : 'الملف المختار'}: {file.path}</summary><pre dir="auto">{file.content}</pre></details>}</section></div>
      {preview && <section className="device-preview"><h4>{en ? 'Review before execution' : 'راجع قبل التنفيذ'}</h4><p>{preview.summary}</p><p className="studio-muted">{en ? 'Review expires after 10 minutes. Existing files get a local backup. Operations stop on the first failure; earlier changes remain.' : 'المراجعة صالحة ١٠ دقائق. الملفات الموجودة تُنسخ احتياطيًا محليًا. التنفيذ يتوقف عند أول فشل؛ التغييرات السابقة تبقى.'}</p>{preview.operations.map((operation, index) => <details key={index} open={preview.operations.length < 4} className="device-code"><summary>{label(operation.type)} · <code>{operation.path}</code>{operation.type === 'write_file' && (operation.exists ? (en ? ' · Replace existing' : ' · استبدال موجود') : (en ? ' · New' : ' · جديد'))}</summary>{operation.type === 'write_file' && <>{operation.exists && <><h5>{en ? 'Before' : 'قبل'}</h5><pre dir="auto">{operation.before}</pre></>}<h5>{en ? 'After' : 'بعد'}</h5><pre dir="auto">{operation.content}</pre></>}</details>)}<div className="studio-actions"><button className="studio-primary" disabled={!!busy} onClick={execute}>{en ? 'Approve and execute this plan' : 'وافق ونفّذ هذه الخطة'}</button><button className="studio-text-button" disabled={!!busy} onClick={() => setPreview(null)}>{en ? 'Discard' : 'إلغاء'}</button></div></section>}
      {result && <section className="device-results" role="status"><h4>{result.completed ? (en ? 'Task completed' : 'اكتملت المهمة') : (en ? 'Task stopped — review results' : 'توقفت المهمة — راجع النتائج')}</h4>{result.results.map((entry, index) => <div key={index}><strong>{entry.status === 'completed' ? '✓' : '⚠'} {label(entry.type)} · <code>{entry.path}</code></strong><pre dir="auto">{entry.output}</pre></div>)}</section>}
      {!!device.history.length && <details><summary>{en ? 'Device activity · current bridge session' : 'سجل الجهاز · جلسة الجسر الحالية'}</summary><ul>{device.history.slice(0, 20).map((entry, index) => <li key={index}><time>{new Date(entry.at).toLocaleTimeString(en ? 'en' : 'ar')}</time> · {label(entry.type)} · <code>{entry.path}</code> · {entry.status}</li>)}</ul></details>}
    </>}
    {busy && busy !== 'plan' && <p role="status">{en ? 'Working…' : 'جارٍ العمل…'}</p>}{error && <p className="studio-warning" role="alert">{error}</p>}
    <p className="studio-muted">{en ? 'First version: text files and JavaScript syntax checks. Running generated programs, installing packages and deleting files are not available yet. Nothing runs while the bridge is closed.' : 'النسخة الأولى: ملفات نصية وفحص صياغة JavaScript. تشغيل البرامج المُنشأة وتثبيت الحزم وحذف الملفات غير متاحة بعد. لا يُنفّذ شيء عندما يكون الجسر مغلقًا.'}</p>
  </section>;
}
