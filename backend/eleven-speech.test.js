import test from 'node:test';
import assert from 'node:assert/strict';
import { createElevenSpeech, DEFAULT_ARABIC_VOICE } from './eleven-speech.js';
test('selected voice is server-side, Arabic settings are sent and identical requests reuse audio', async () => {
  let calls = 0;
  const speak = createElevenSpeech({config:{ELEVENLABS_API_KEY:'private-key'},fetcher:async(url, options)=>{calls++;assert.ok(url.includes(DEFAULT_ARABIC_VOICE));assert.equal(options.headers['xi-api-key'],'private-key');const body=JSON.parse(options.body);assert.equal(body.language_code,'ar');assert.equal(body.model_id,'eleven_flash_v2_5');assert.equal(body.voice_settings.speed,1.03);return new Response(Buffer.from('audio'),{headers:{'Content-Type':'audio/mpeg'}});}});
  assert.equal((await speak('هلا')).toString(),'audio');await speak('هلا');assert.equal(calls,1);
});
test('missing key, paid voice restrictions and invalid audio have clear safe errors',async()=>{
 await assert.rejects(createElevenSpeech({config:{}})('هلا'),/ELEVENLABS_API_KEY/);
 await assert.rejects(createElevenSpeech({config:{ELEVENLABS_API_KEY:'private-key'},fetcher:async()=>new Response('private-provider-body',{status:402})})('هلا'),/خطة مدفوعة/);
 await assert.rejects(createElevenSpeech({config:{ELEVENLABS_API_KEY:'private-key'},fetcher:async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})})('هلا'),/ملفًا صوتيًا/);
});
