export const normalizeVoice = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export function wakeMatch(transcript, name) {
  const normalized = normalizeVoice(transcript).replace(/^يا(?=جار)/, 'يا ');
  const words = normalized.split(' '); const targetName = normalizeVoice(name).replace(/^(يا|hey|hi|okay)\s+/, '');
  const aliases = ['جارفس', 'جارفيس', 'جارفيز', 'جارفز', 'جارڤيس', 'jarvis'];
  if (['يا', 'hey', 'hi', 'okay'].includes(words[0])) words.shift();
  if (aliases.includes(targetName) && aliases.includes(words[0])) return words.slice(1).join(' ');
  const target = targetName.split(' ');
  if (!target[0] || !target.every((word, index) => words[index] === word)) return null;
  return words.slice(target.length).join(' ');
}
export function validWakeName(name) { const value = normalizeVoice(name); return value.length >= 2 && value.length <= 30 && value.split(' ').length <= 3; }

// Session-only recognition. No audio/transcript storage, no automatic activation.
export function createWakeListener({ createRecognition, name, lang, onCommand, onStatus, onError, onHeard, now = Date.now, commandWindow = 10000, restartDelay = 250, silenceDelay = 1800, initiallyPaused = false, requireWake = true }) {
  let enabled = false, busy = false, external = initiallyPaused, recognizer = null, restart = null, deadlineTimer = null, deadline = 0, transaction = null, generation = 0;
  let pending = null, phraseTimer = null, phraseLimit = null, interimActive = false, speechActive = false;
  const clearPhrase = () => { clearTimeout(phraseTimer); clearTimeout(phraseLimit); phraseTimer = phraseLimit = null; pending = null; interimActive = false; };
  const status = phase => onStatus?.(phase);
  const clearRestart = () => { clearTimeout(restart); restart = null; };
  const detach = () => { const previous = recognizer; recognizer = null; speechActive = false; if (previous) { previous.onresult = previous.onstart = previous.onend = previous.onerror = previous.onspeechstart = previous.onspeechend = null; try { previous.abort(); } catch { /* already closed */ } } };
  const stop = (phase = 'off') => { enabled = false; generation++; clearRestart(); clearPhrase(); clearTimeout(deadlineTimer); deadline = 0; transaction?.abort(); transaction = null; detach(); busy = false; status(phase); };
  const fatal = code => { stop('error'); onError?.(code); };
  const schedule = () => { clearRestart(); if (enabled && !busy && !external) restart = setTimeout(listen, restartDelay); };
  async function handle(command, wakeOnly) {
    if (!enabled || busy || external) return;
    busy = true; clearRestart(); clearPhrase(); detach(); clearTimeout(deadlineTimer); deadline = 0;
    const token = generation; transaction = new AbortController(); status('processing');
    let followUpWindow = commandWindow;
    try { const outcome = await onCommand(command, { signal: transaction.signal, wakeOnly }); if (outcome?.followUp) { wakeOnly = true; followUpWindow = Math.max(commandWindow, Math.min(30000, outcome.followUpMs || commandWindow)); } }
    catch (error) { if (enabled && token === generation && error.name !== 'AbortError') await onError?.('command-failed', { signal: transaction.signal }); }
    finally {
      if (enabled && token === generation) {
        busy = false; transaction = null;
        if (!requireWake) stop();
        else {
          if (wakeOnly) { deadline = now() + followUpWindow; deadlineTimer = setTimeout(() => { deadline = 0; if (enabled && !busy && !external && !pending) status('waiting'); }, followUpWindow); }
          status(external ? 'paused-audio' : deadline > now() ? 'command' : 'waiting'); schedule();
        }
      }
    }
  }
  function flushPhrase() {
    if (!pending || !enabled || busy || external || interimActive || speechActive) return;
    const text = pending.parts.join(' ').trim(); clearPhrase(); void handle(text, !text);
  }
  function addPart(text) {
    if (!pending) {
      pending = { parts: [] }; clearTimeout(deadlineTimer); deadline = 0;
      phraseLimit = setTimeout(() => { clearPhrase(); status('waiting'); onError?.('speech-incomplete'); }, 30000);
    }
    interimActive = false;
    if (text && pending.parts.at(-1) !== text) pending.parts.push(text);
    status('command'); onHeard?.(pending.parts.join(' ').slice(0, 240));
    clearTimeout(phraseTimer);
    if (silenceDelay === 0) flushPhrase(); else if (!speechActive) phraseTimer = setTimeout(flushPhrase, silenceDelay);
  }
  function listen() {
    restart = null;
    if (!enabled || busy || external || recognizer) return;
    const rec = createRecognition(); recognizer = rec; const consumed = new Set();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
    rec.onstart = () => { if (rec === recognizer && enabled) status(deadline > now() ? 'command' : 'waiting'); };
    rec.onspeechstart = () => { if (rec !== recognizer) return; speechActive = true; clearTimeout(phraseTimer); };
    rec.onspeechend = () => { if (rec !== recognizer) return; speechActive = false; if (pending && !interimActive) { clearTimeout(phraseTimer); phraseTimer = setTimeout(flushPhrase, silenceDelay); } };
    rec.onresult = event => {
      if (rec !== recognizer || !enabled || busy || external) return;
      for (let index = event.resultIndex || 0; index < event.results.length; index++) {
        const result = event.results[index];
        onHeard?.(String(result[0]?.transcript || '').trim().slice(0, 240));
        if (!result.isFinal) { if (pending) { interimActive = true; clearTimeout(phraseTimer); } continue; }
        if (consumed.has(index)) continue; consumed.add(index);
        const text = String(result[0]?.transcript || '').trim(); if (!text) continue;
        const alternatives = Array.from(result).slice(0, 3).map(item => wakeMatch(item.transcript || '', name));
        const command = alternatives.find(value => value !== null) ?? null;
        if (command !== null) addPart(command);
        else if (pending || deadline > now() || !requireWake) addPart(text);
        if (busy) break;
      }
    };
    rec.onerror = event => { if (rec !== recognizer || !enabled) return; if (['no-speech', 'aborted'].includes(event.error)) return; fatal(event.error || 'recognition-error'); };
    rec.onend = () => { if (rec !== recognizer) return; recognizer = null; speechActive = false; if (pending && !interimActive) { clearTimeout(phraseTimer); phraseTimer = setTimeout(flushPhrase, silenceDelay); } schedule(); };
    try { rec.start(); } catch { fatal('start-failed'); }
  }
  return {
    start() { if (enabled) return; if (!validWakeName(name)) return fatal('invalid-name'); enabled = true; generation++; status(external ? 'paused-audio' : 'starting'); listen(); },
    stop,
    externalVoice(phase) {
      if (!enabled || busy) return;
      external = phase !== 'idle';
      if (external) { clearRestart(); clearPhrase(); detach(); deadline = 0; clearTimeout(deadlineTimer); status('paused-audio'); }
      else { status('waiting'); schedule(); }
    },
    hide() { if (enabled) stop('hidden'); },
    get enabled() { return enabled; },
  };
}
