import { useEffect, useRef, useState } from 'react';

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let pendingScript;

function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (!pendingScript) {
    pendingScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error('Turnstile unavailable'));
      };
      const timeout = setTimeout(fail, 12000);
      script.src = scriptUrl;
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        if (!window.turnstile?.ready) return fail();
        window.turnstile.ready(() => {
          clearTimeout(timeout);
          resolve(window.turnstile);
        });
      };
      document.head.append(script);
    }).catch(error => {
      pendingScript = undefined;
      throw error;
    });
  }
  return pendingScript;
}

export default function AuthChallenge({ siteKey, lang, onToken, onRetry }) {
  const container = useRef(null);
  const [status, setStatus] = useState('loading');
  const en = lang === 'en';

  useEffect(() => {
    let disposed = false;
    let turnstile;
    let widget;
    const clear = () => { if (!disposed) onToken(''); };
    const fail = () => { if (!disposed) { onToken(''); setStatus('error'); } };
    loadTurnstile().then(api => {
      if (disposed) return;
      turnstile = api;
      setStatus('ready');
      widget = api.render(container.current, {
        sitekey: siteKey,
        language: lang,
        size: 'flexible',
        appearance: 'always',
        'response-field': false,
        callback: token => { if (!disposed) { setStatus('ready'); onToken(token); } },
        'expired-callback': clear,
        'timeout-callback': fail,
        'error-callback': fail,
      });
    }).catch(fail);
    return () => {
      disposed = true;
      if (widget != null) turnstile.remove(widget);
    };
  }, [lang, onToken, siteKey]);

  return <div data-skip-i18n="1">
    <div ref={container} />
    {status === 'loading' && <small role="status">{en ? 'Preparing verification…' : 'جارٍ تجهيز التحقق…'}</small>}
    {status === 'error' && <div role="alert">
      <small>{en ? 'Verification could not load.' : 'تعذّر تشغيل التحقق.'}</small>{' '}
      <button type="button" className="studio-text-button" onClick={onRetry}>{en ? 'Retry' : 'أعد المحاولة'}</button>
    </div>}
  </div>;
}
