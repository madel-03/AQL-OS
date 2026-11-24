import { useState } from 'react';
import { connectLocalDevice, disconnectLocalDevice, hasLocalDevice, localDeviceAction } from '../lib/local-device';

export default function LocalDevicePanel({ en }) {
  const [key, setKey] = useState('');
  const [paired, setPaired] = useState(hasLocalDevice);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function connect(event) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      await connectLocalDevice(key);
      setPaired(true);
      setKey('');
    } catch (error) {
      setStatus(error.message === 'invalid_key'
        ? (en ? 'Copy a new key from the Windows app.' : 'انسخ مفتاحًا جديدًا من تطبيق ويندوز.')
        : (en ? 'Check the Windows app and your browser’s local network permission.' : 'تأكد أن تطبيق ويندوز شغّال وأن المتصفح يسمح بالاتصال بالشبكة المحلية.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFolder(folder) {
    setBusy(true);
    setStatus('');
    try {
      await localDeviceAction({ action: 'open_folder', folder });
      setStatus(en ? 'Folder opened.' : 'تم فتح المجلد.');
    } catch {
      setStatus(en ? 'Could not open the folder. Check the local connection.' : 'تعذّر فتح المجلد. تحقق من الربط المحلي.');
    } finally { setBusy(false); }
  }

  return <section className="device-preview">
    <h4>{en ? 'Local connection · Windows' : 'ربط محلي · ويندوز'}</h4>
    {paired ? <div className="studio-actions">
      {Object.entries(en ? { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads' } : { desktop: 'سطح المكتب', documents: 'المستندات', downloads: 'التنزيلات' }).map(([folder, title]) =>
        <button key={folder} type="button" className="studio-text-button" disabled={busy} onClick={() => void openFolder(folder)}>{title}</button>)}
      <button type="button" className="studio-text-button" disabled={busy} onClick={() => { disconnectLocalDevice(); setPaired(false); setStatus(''); }}>{en ? 'Disconnect this tab' : 'افصل هذا التبويب'}</button>
    </div> : <>
      <p className="studio-muted">{en ? 'On the same computer, copy the local key from the AQL icon next to the clock.' : 'على نفس الكمبيوتر، انسخ مفتاح الربط المحلي من أيقونة عقل جنب الساعة.'}</p>
      <form className="studio-actions" onSubmit={connect}>
        <label>{en ? 'Local connection key' : 'مفتاح الربط المحلي'}<input className="studio-input" autoComplete="off" type="password" value={key} onChange={event => setKey(event.target.value)} required /></label>
        <button className="studio-primary" disabled={busy || !key.trim()}>{en ? 'Connect locally' : 'اربط محليًا'}</button>
      </form>
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
