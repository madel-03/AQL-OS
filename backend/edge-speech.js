import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// msedge-tts 2.0.7 still connects to the retired synthesis endpoint.
// Keep this compatibility shim here until the dependency updates its URL.
const legacySynthUrl = MsEdgeTTS.getSynthUrl.bind(MsEdgeTTS);
MsEdgeTTS.getSynthUrl = async () => (await legacySynthUrl()).replace(
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=',
  'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=',
);

async function synthesizeOnce(text, voice) {
  const tts = new MsEdgeTTS();
  let timer;
  const escaped = text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
  try {
    return await Promise.race([
      (async () => {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(escaped);
        const chunks = [];
        for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
        const audio = Buffer.concat(chunks);
        if (!audio.length) throw new Error('No audio received');
        return audio;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Speech synthesis timed out')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    tts.close();
  }
}

let queue = Promise.resolve();
let lastStarted = 0;
const cache = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function synthesizeSpeech(text, voice) {
  const key = JSON.stringify([voice, text]);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const job = queue.then(async () => {
    if (cache.has(key)) return cache.get(key);
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, 4000 - (Date.now() - lastStarted)));
      lastStarted = Date.now();
      try {
        const audio = await synthesizeOnce(text, voice);
        cache.set(key, audio);
        if (cache.size > 32) cache.delete(cache.keys().next().value);
        return audio;
      } catch (error) {
        if (attempt >= 2 || !/429/.test(error.message)) throw error;
        await sleep(4000 * (attempt + 1));
      }
    }
  });
  queue = job.catch(() => {});
  return job;
}
