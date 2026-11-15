// Prime one HTML audio element during the user's enable/test click, then reuse it
// for delayed TTS playback. No microphone capture or network requests here.
let shared = null;
let primed = false;
export function speechAudioElement() { return shared; }
export async function unlockSpeechAudio() {
  try {
    if (primed) return true;
    if (!shared) shared = new Audio();
    const audio = shared;
    const bytes = new Uint8Array(364); const view = new DataView(bytes.buffer);
    const write = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
    write(0, 'RIFF'); view.setUint32(4, 356, true); write(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, 320, true);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio.src = url;
    try { await audio.play(); if (audio.src === url) audio.pause(); primed = true; return true; }
    finally { URL.revokeObjectURL(url); }
  } catch { return false; }
}
