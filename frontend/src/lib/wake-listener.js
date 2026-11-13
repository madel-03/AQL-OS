export const normalizeVoice = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export function wakeMatch(transcript, name) {
  const words = normalizeVoice(transcript).split(' '); const targetName = normalizeVoice(name).replace(/^(يا|hey|hi|okay)\s+/, '');
  const aliases = ['جارفس', 'جارفيس', 'جارفيز', 'jarvis'];
  if (['يا', 'hey', 'hi', 'okay'].includes(words[0])) words.shift();
  if (aliases.includes(targetName) && aliases.includes(words[0])) return words.slice(1).join(' ');
  const target = targetName.split(' ');
  if (!target[0] || !target.every((word, index) => words[index] === word)) return null;
  return words.slice(target.length).join(' ');
}
export function validWakeName(name) { const value = normalizeVoice(name); return value.length >= 2 && value.length <= 30 && value.split(' ').length <= 3; }

// Session-only recognition. No audio/transcript storage, no automatic activation.
export function createWakeListener({ createRecognition, name, lang, onCommand, onStatus, onError, now = Date.now, commandWindow = 10000, restartDelay = 600, initiallyPaused = false }) {
  let enabled = false, busy = false, external = initiallyPaused, recognizer = null, restart = null, deadlineTimer = null, deadline = 0, transaction = null, generation = 0;
  const status = phase => onStatus?.(phase);
  const clearRestart = () => { clearTimeout(restart); restart = null; };
  const detach = () => { const previous = recognizer; recognizer = null; if (previous) { previous.onresult = previous.onstart = previous.onend = previous.onerror = null; try { previous.abort(); } catch { /* already closed */ } } };
  const stop = (phase = 'off') => { enabled = false; generation++; clearRestart(); clearTimeout(deadlineTimer); deadline = 0; transaction?.abort(); transaction = null; detach(); busy = false; status(phase); };
  const fatal = code => { stop('error'); onError?.(code); };
  const schedule = () => { clearRestart(); if (enabled && !busy && !external) restart = setTimeout(listen, restartDelay); };
  async function handle(command, wakeOnly) {
    if (!enabled || busy || external) return;
    busy = true; clearRestart(); detach(); clearTimeout(deadlineTimer); deadline = 0;
    const token = generation; transaction = new AbortController(); status('processing');
    try { await onCommand(command, { signal: transaction.signal, wakeOnly }); }
    catch (error) { if (enabled && token === generation && error.name !== 'AbortError') await onError?.('command-failed', { signal: transaction.signal }); }
    finally {
      if (enabled && token === generation) {
        busy = false; transaction = null;
        if (wakeOnly) { deadline = now() + commandWindow; deadlineTimer = setTimeout(() => { deadline = 0; if (enabled && !busy && !external) status('waiting'); }, commandWindow); }
        status(external ? 'paused-audio' : deadline > now() ? 'command' : 'waiting'); schedule();
      }
    }
  }
  function listen() {
    restart = null;
    if (!enabled || busy || external || recognizer) return;
    const rec = createRecognition(); recognizer = rec; const consumed = new Set();
    rec.lang = lang; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => { if (rec === recognizer && enabled) status(deadline > now() ? 'command' : 'waiting'); };
    rec.onresult = event => {
      if (rec !== recognizer || !enabled || busy || external) return;
      for (let index = event.resultIndex || 0; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result.isFinal || consumed.has(index)) continue; consumed.add(index);
        const text = String(result[0]?.transcript || '').trim(); if (!text) continue;
        const command = wakeMatch(text, name);
        if (command !== null) { void handle(command, !command); break; }
        if (deadline > now()) { void handle(text, false); break; }
      }
    };
    rec.onerror = event => { if (rec !== recognizer || !enabled) return; if (['no-speech', 'aborted'].includes(event.error)) return; fatal(event.error || 'recognition-error'); };
    rec.onend = () => { if (rec !== recognizer) return; recognizer = null; schedule(); };
    try { rec.start(); } catch { fatal('start-failed'); }
  }
  return {
    start() { if (enabled) return; if (!validWakeName(name)) return fatal('invalid-name'); enabled = true; generation++; status(external ? 'paused-audio' : 'starting'); listen(); },
    stop,
    externalVoice(phase) {
      if (!enabled || busy) return;
      external = phase !== 'idle';
      if (external) { clearRestart(); detach(); deadline = 0; clearTimeout(deadlineTimer); status('paused-audio'); }
      else { status('waiting'); schedule(); }
    },
    hide() { if (enabled) stop('hidden'); },
    get enabled() { return enabled; },
  };
}
