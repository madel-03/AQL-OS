import { useRef } from 'react';
import { useLang } from '../lib/lang';
import { accentColors, useAppearance } from '../lib/appearance-settings';

export default function AppearancePanel() {
  const { lang } = useLang(); const en = lang === 'en';
  const { settings, change, customUrl, upload, uploading, removeImage, storageError, reset } = useAppearance();
  const dialog = useRef(null); const input = useRef(null);
  const labels = en ? { room: 'Golden hour', aurora: 'Aurora', ocean: 'Deep ocean', dusk: 'Dusk', plain: 'No image', custom: 'Your photo' } : { room: 'ساعة الغروب', aurora: 'الشفق', ocean: 'المحيط', dusk: 'الغسق', plain: 'بدون صورة', custom: 'صورتك' };
  const accents = en ? { ice: 'Ice blue', lavender: 'Lavender', mint: 'Mint', peach: 'Peach', rose: 'Rose' } : { ice: 'أزرق ثلجي', lavender: 'لافندر', mint: 'نعناعي', peach: 'خوخي', rose: 'وردي' };
  const errors = en ? { FILE_SIZE: 'Choose an image smaller than 8 MB.', FILE_TYPE: 'Choose a JPG, PNG or WebP image.', SETTINGS_STORAGE: 'Your browser could not save these settings. Changes may not survive a reload.', WALLPAPER_STORAGE: 'The photo could not be read or saved. Try a smaller JPG or enable browser storage.' } : { FILE_SIZE: 'اختر صورة أصغر من 8 ميجابايت.', FILE_TYPE: 'اختر صورة JPG أو PNG أو WebP.', SETTINGS_STORAGE: 'تعذّر حفظ الإعدادات في المتصفح. قد لا تبقى بعد تحديث الصفحة.', WALLPAPER_STORAGE: 'تعذّرت قراءة الصورة أو حفظها. جرّب JPG أصغر أو فعّل تخزين المتصفح.' };
  const slider = (key, label, min, max, suffix = '') => <label className="appearance-slider" key={key}><span>{label}<output>{settings[key]}{suffix}</output></span><input type="range" min={min} max={max} value={settings[key]} onChange={(event) => change({ [key]: Number(event.target.value) })} /></label>;
  return <>
    <button type="button" className="appearance-trigger" onClick={() => dialog.current.showModal()} aria-haspopup="dialog" aria-controls="appearance-dialog" data-skip-i18n="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></svg><span>{en ? 'Appearance' : 'المظهر'}</span></button>
    <dialog ref={dialog} id="appearance-dialog" className="appearance-panel" aria-labelledby="appearance-title" data-skip-i18n="1">
      <header><div><span className="appearance-kicker">{en ? 'MAKE YOURSELF AT HOME' : 'المكان مكانك'}</span><h2 id="appearance-title">{en ? 'AQL, your way.' : 'عقل، على ذوقك.'}</h2></div><button className="icon-button" onClick={() => dialog.current.close()} aria-label={en ? 'Close appearance settings' : 'إغلاق إعدادات المظهر'}>×</button></header>
      <p className="appearance-intro">{en ? 'Changes appear instantly and stay on this browser.' : 'التغيير يظهر فورًا، ونحفظ اختياراتك في هذا المتصفح.'}</p>
      <fieldset><legend>{en ? 'The look' : 'شكل الواجهة'}</legend><div className="surface-options">{[['glass', en ? 'Glass' : 'زجاجي', '◈'], ['solid', en ? 'Classic' : 'كلاسيكي', '▣']].map(([id, label, icon]) => <button type="button" key={id} aria-pressed={settings.surface === id} onClick={() => change({ surface: id })}><span aria-hidden="true">{icon}</span>{label}</button>)}</div></fieldset>
      <fieldset><legend>{en ? 'Your backdrop' : 'خلفيتك'}</legend><div className="wallpaper-options">{Object.keys(labels).filter((id) => id !== 'custom' || customUrl).map((id) => <button type="button" key={id} className={settings.wallpaper === id ? 'wallpaper-selected' : ''} aria-pressed={settings.wallpaper === id} onClick={() => change({ wallpaper: id })}><span className={`wallpaper-swatch wallpaper-${id}`} style={id === 'custom' ? { backgroundImage: `url("${customUrl}")` } : undefined}>{settings.wallpaper === id && <i>✓</i>}</span><span>{labels[id]}</span></button>)}</div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label={en ? 'Upload a wallpaper' : 'رفع صورة خلفية'} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
        <div className="wallpaper-upload"><button type="button" disabled={uploading} onClick={() => input.current.click()}>{uploading ? (en ? 'Saving your photo…' : 'أحفظ صورتك…') : (en ? '＋ Use your own photo' : '＋ اختر صورة من جهازك')}</button>{customUrl && <button type="button" disabled={uploading} onClick={removeImage}>{en ? 'Remove photo' : 'احذف الصورة'}</button>}</div><small>{en ? 'JPG, PNG or WebP · up to 8 MB. Your photo stays in this browser and is never uploaded to the server.' : 'JPG أو PNG أو WebP · حتى 8 MB. صورتك تبقى في المتصفح ولا تُرفع إلى الخادم.'}</small>
      </fieldset>
      <fieldset><legend>{en ? 'A touch of color' : 'لمسة لون'}</legend><div className="accent-options">{Object.entries(accentColors).map(([id, color]) => <button type="button" key={id} aria-label={accents[id]} title={accents[id]} aria-pressed={settings.accent === id} style={{ background: color }} onClick={() => change({ accent: id })}>{settings.accent === id ? '✓' : ''}</button>)}</div></fieldset>
      <fieldset><legend>{en ? 'Fine-tune the atmosphere' : 'اضبط الإحساس'}</legend>
        {slider('darkness', en ? 'Background dimming' : 'تعتيم الخلفية', 25, 80, '%')}
        {settings.surface === 'glass' && <>{slider('opacity', en ? 'Panel opacity' : 'عتامة البطاقات', 18, 85, '%')}{slider('blur', en ? 'Glass blur' : 'تمويه الزجاج', 0, 36, 'px')}</>}
        {slider('radius', en ? 'Rounded corners' : 'استدارة الحواف', 10, 32, 'px')}
      </fieldset>
      <fieldset><legend>{en ? 'The little things' : 'تفاصيلك الصغيرة'}</legend><label className="appearance-toggle"><span>{en ? 'Compact cards' : 'بطاقات أصغر'}</span><input type="checkbox" checked={settings.density === 'compact'} onChange={(event) => change({ density: event.target.checked ? 'compact' : 'comfortable' })} /></label><label className="appearance-toggle"><span>{en ? 'Gentle animations' : 'الحركة الخفيفة'}</span><input type="checkbox" checked={settings.motion} onChange={(event) => change({ motion: event.target.checked })} /></label><label className="appearance-toggle"><span>{en ? 'Show AQL’s character' : 'إظهار شخصية عقل'}</span><input type="checkbox" checked={settings.companion} onChange={(event) => change({ companion: event.target.checked })} /></label></fieldset>
      {storageError && <p className="appearance-error" role="alert">{errors[storageError]}</p>}
      <footer><button type="button" onClick={reset}>{en ? 'Reset the look' : 'استعادة الافتراضي'}</button><button type="button" className="primary-action" onClick={() => dialog.current.close()}>{en ? 'Looks like me ✓' : 'كذا على ذوقي ✓'}</button></footer>
    </dialog>
  </>;
}
