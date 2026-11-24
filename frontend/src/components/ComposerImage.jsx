import { useEffect, useRef } from 'react';

export function ComposerImage({ file, en, onRemove, disabled }) {
  const preview = useRef(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file) return null;
  return <div className="composer-image">
    <img ref={preview} alt={en ? 'Attached image' : 'الصورة المرفقة'} />
    {onRemove && <button type="button" className="secondary-action" disabled={disabled} onClick={onRemove}>{en ? 'Remove image' : 'أزل الصورة'}</button>}
  </div>;
}

export function ImageConsent({ checked, onChange, disabled, en }) {
  return <label className="composer-image-consent">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    {en ? 'Allow Gemini to analyze this image and question.' : 'أوافق على إرسال الصورة والسؤال إلى Gemini للتحليل.'}
  </label>;
}
