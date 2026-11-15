// Synthetic test recording only: no user's microphone, messages or calendar writes.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { synthesizeSpeech } from '../edge-speech.js';
const key = process.env.GROQ_API_KEY?.trim();
if (!key) throw new Error('GROQ_API_KEY is missing');
const bytes = await readFile('data/speech-qa/synthetic-request.wav');
const form = new FormData(); form.set('file', new Blob([bytes], { type: 'audio/wav' }), 'synthetic-request.wav'); form.set('model', 'whisper-large-v3-turbo'); form.set('language', 'en'); form.set('response_format', 'json'); form.set('temperature', '0');
const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60000) });
assert.equal(response.status, 200, `Transcription HTTP ${response.status}`);
const value = await response.json(); assert.match(value.text, /gym/i); assert.match(value.text, /fifteen|15/i);
console.log(`PASS: real Whisper transcription of synthetic WAV: ${value.text.slice(0, 200)}`);
const arabicAudio = await synthesizeSpeech('أضف موعدًا للنادي بعد ربع ساعة لمدة نصف ساعة.', 'ar-SA-HamedNeural');
const arabicForm = new FormData(); arabicForm.set('file', new Blob([arabicAudio], { type: 'audio/mpeg' }), 'synthetic-arabic.mp3'); arabicForm.set('model', 'whisper-large-v3-turbo'); arabicForm.set('language', 'ar'); arabicForm.set('response_format', 'json');
const arabicResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: arabicForm, signal: AbortSignal.timeout(60000) });
assert.equal(arabicResponse.status, 200, `Arabic transcription HTTP ${arabicResponse.status}`);
const arabic = await arabicResponse.json(); assert.match(arabic.text, /موعد/); assert.match(arabic.text, /ربع|15|١٥/);
console.log(`PASS: real Whisper transcription of synthetic Arabic: ${arabic.text.slice(0, 200)}`);
