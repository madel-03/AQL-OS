import { useEffect, useRef, useState } from 'react';
import { accentColors, APPEARANCE_KEY, AppearanceContext, defaultAppearance, normalizeAppearance, prepareWallpaper, readCustomWallpaper, writeCustomWallpaper } from '../lib/appearance-settings';

export default function AppearanceProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY))); } catch { return { ...defaultAppearance }; }
  });
  const [imageUrl, setImageUrl] = useState(null);
  const urlRef = useRef(null);
  const settingsRef = useRef(settings);
  const [uploading, setUploading] = useState(false);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    let stopped = false;
    readCustomWallpaper().then((blob) => {
      if (!stopped && blob instanceof Blob) { const url = URL.createObjectURL(blob); urlRef.current = url; setImageUrl(url); }
    }).catch(() => { if (!stopped) setStorageError('WALLPAPER_STORAGE'); });
    return () => { stopped = true; if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; };
  }, []);
  const change = (patch) => {
    const next = normalizeAppearance({ ...settingsRef.current, ...patch });
    settingsRef.current = next; setSettings(next);
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); } catch { setStorageError('SETTINGS_STORAGE'); }
  };
  const upload = async (file) => {
    if (uploading) return;
    setUploading(true); setStorageError('');
    try {
      const blob = await prepareWallpaper(file); await writeCustomWallpaper(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob); urlRef.current = url; setImageUrl(url); change({ wallpaper: 'custom' });
    }
    catch (error) { setStorageError(['FILE_SIZE', 'FILE_TYPE'].includes(error.message) ? error.message : 'WALLPAPER_STORAGE'); }
    finally { setUploading(false); }
  };
  const removeImage = async () => {
    try { await writeCustomWallpaper(null); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setImageUrl(null); if (settingsRef.current.wallpaper === 'custom') change({ wallpaper: 'room' }); }
    catch { setStorageError('WALLPAPER_STORAGE'); }
  };
  const accent = accentColors[settings.accent];
  const customActive = settings.wallpaper === 'custom' && imageUrl;
  return <AppearanceContext.Provider value={{ settings, change, customUrl: imageUrl, uploading, upload, removeImage, storageError, reset: () => { setStorageError(''); change({ ...defaultAppearance }); } }}>
    <div className="appearance-root" data-surface={settings.surface} data-wallpaper={customActive ? 'custom' : settings.wallpaper === 'custom' ? 'room' : settings.wallpaper} data-density={settings.density} data-motion={settings.motion ? 'on' : 'off'} data-companion={settings.companion ? 'on' : 'off'} style={{ '--appearance-accent': accent, '--appearance-opacity': settings.opacity / 100, '--appearance-blur': `${settings.blur}px`, '--appearance-darkness': settings.darkness / 100, '--appearance-radius': `${settings.radius}px`, '--custom-wallpaper': customActive ? `url("${imageUrl}")` : 'none' }}>
      <div className="app-wallpaper" aria-hidden="true" />
      {children}
    </div>
  </AppearanceContext.Provider>;
}
