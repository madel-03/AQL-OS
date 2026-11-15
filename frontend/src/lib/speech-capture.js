import { claimMicrophone } from './microphone-owner.js';
export function createSpeechCapture({ getUserMedia, Recorder, onState, onLimit, onError, maxDuration = 90000, maxBytes = 8 * 1024 * 1024 }) {
  let stream = null, recorder = null, release = null, timer = null, run = 0, chunks = [], bytes = 0, result = null, state = 'idle';
  const setState = value => { state = value; onState?.(value); };
  const free = () => { clearTimeout(timer); timer = null; stream?.getTracks().forEach(track => track.stop()); stream = null; release?.(); release = null; };
  const cancel = () => { run++; const rec = recorder; recorder = null; if (rec) { rec.ondataavailable = rec.onerror = rec.onstop = null; try { if (rec.state !== 'inactive') rec.stop(); } catch { /* closing */ } } free(); result?.resolve(null); result = null; chunks = []; setState('idle'); };
  return {
    async start() {
      if (state !== 'idle') return;
      const token = ++run; release = claimMicrophone(cancel); setState('requesting');
      try {
        const opened = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (token !== run) { opened.getTracks().forEach(track => track.stop()); return; }
        stream = opened; chunks = []; bytes = 0;
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => Recorder.isTypeSupported?.(type));
        recorder = new Recorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64000 });
        const rec = recorder;
        const promise = new Promise((resolve, reject) => { result = { resolve, reject, promise: null }; }); result.promise = promise;
        // A cancellation/error may happen before the user presses finish.
        void promise.catch(() => {});
        rec.ondataavailable = event => { if (token !== run || !event.data?.size) return; bytes += event.data.size; if (bytes > maxBytes) { cancel(); onError?.('recording-too-large'); return; } chunks.push(event.data); };
        rec.onerror = () => { if (token !== run) return; const pending = result; result = null; free(); recorder = null; setState('idle'); pending?.reject(new Error('Recording failed')); onError?.('recording-failed'); };
        rec.onstop = () => { if (token !== run) return; const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }); const pending = result; result = null; recorder = null; chunks = []; free(); setState('idle'); pending?.resolve(blob.size ? blob : null); };
        rec.start(1000); setState('recording');
        timer = setTimeout(() => { cancel(); onLimit?.(); }, maxDuration);
      } catch { if (token === run) { cancel(); onError?.('microphone-denied'); } }
    },
    finish() { if (!recorder || state !== 'recording' || !result) return Promise.resolve(null); const pending = result.promise; setState('finishing'); try { recorder.stop(); } catch { cancel(); } return pending; },
    cancel,
    get state() { return state; },
  };
}
