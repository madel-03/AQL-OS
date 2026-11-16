import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/lang';
import { spotifySearchUrl } from '../lib/music';
export default function SpotifySearch() {
  const { lang } = useLang(); const en = lang === 'en';
  const dialog = useRef(null); const [query, setQuery] = useState('');
  useEffect(() => {
    const show = event => { setQuery(String(event.detail?.query || '').slice(0, 200)); if (!dialog.current.open) dialog.current.showModal(); };
    window.addEventListener('aql-music-search', show);
    return () => window.removeEventListener('aql-music-search', show);
  }, []);
  return <><section><h3>Spotify</h3><p>{en ? 'Find songs and playlists, then choose what to play in Spotify. No account connection needed.' : 'ابحث عن أغاني وقوائم، واختر اللي تبي تشغله داخل Spotify. ما يحتاج ربط حساب.'}</p><button className="services-primary" onClick={() => dialog.current.showModal()}>{en ? 'Search music' : 'ابحث عن موسيقى'}</button></section>
    {createPortal(<dialog ref={dialog} className="services-dialog" data-skip-i18n="1" aria-labelledby="spotify-search-title"><header><h2 id="spotify-search-title">Spotify</h2><button className="studio-text-button" aria-label={en ? 'Close' : 'إغلاق'} onClick={() => dialog.current.close()}>×</button></header><p>{en ? 'Search is ready to open in Spotify. Playback starts there when you select it.' : 'افتح البحث في Spotify، ثم اختر الأغنية أو القائمة وشغّلها هناك.'}</p><label>{en ? 'Song, artist or playlist' : 'أغنية، فنان أو قائمة تشغيل'}<input className="music-search-input" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder={en ? 'Focus music…' : 'موسيقى للتركيز…'} /></label><p><a className="services-open" href={spotifySearchUrl(query)} target="_blank" rel="noopener noreferrer">{en ? 'Open in Spotify ↗' : 'افتح في Spotify ↗'}</a></p><small>{en ? 'Your search goes to Spotify when you open the link. AQL does not start or control playback in this version.' : 'تُرسل عبارة البحث إلى Spotify عند فتح الرابط. التشغيل والتحكم يكونان داخل Spotify في هذه النسخة.'}</small></dialog>, document.body)}</>;
}
