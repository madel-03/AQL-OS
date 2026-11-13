// Locally synthesized textures. No recordings, microphone access or network calls.
export async function createAmbience(kind, volume) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('Audio is not supported');
  const context = new AudioContext();
  try {
    await context.resume();
    const output = context.createGain(); output.gain.value = Math.max(0, Math.min(70, volume)) / 100; output.connect(context.destination);
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const channel = buffer.getChannelData(0); let brown = 0;
    for (let i = 0; i < channel.length; i++) { const noise = Math.random() * 2 - 1; brown = (brown + .02 * noise) / 1.02; channel[i] = kind === 'cafe' ? brown * 4 : noise * .25; }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = kind === 'cafe' ? 'bandpass' : 'lowpass'; filter.frequency.value = kind === 'cafe' ? 850 : 4500; filter.Q.value = .55;
    const gain = context.createGain(); gain.gain.value = kind === 'cafe' ? .45 : .35;
    source.connect(filter); filter.connect(gain); gain.connect(output); source.start();
    const lfo = context.createOscillator(); const lfoGain = context.createGain(); lfo.frequency.value = kind === 'cafe' ? .23 : .08; lfoGain.gain.value = .035; lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
    const timer = kind === 'cafe' ? setInterval(() => {
      if (context.state === 'closed') return;
      const tone = context.createOscillator(); const envelope = context.createGain();
      tone.type = 'sine'; tone.frequency.value = 1800 + Math.random() * 1400;
      envelope.gain.setValueAtTime(0, context.currentTime); envelope.gain.linearRampToValueAtTime(.008, context.currentTime + .01); envelope.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .5);
      tone.connect(envelope); envelope.connect(output); tone.start(); tone.stop(context.currentTime + .6);
      tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
    }, 7300) : null;
    return {
      setVolume: (next) => { if (context.state !== 'closed') output.gain.setTargetAtTime(Math.max(0, Math.min(70, next)) / 100, context.currentTime, .12); },
      stop: () => { clearInterval(timer); source.stop(); lfo.stop(); void context.close(); },
    };
  } catch (error) { await context.close(); throw error; }
}
