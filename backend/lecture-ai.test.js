import test from 'node:test';
import assert from 'node:assert/strict';
import { createLectureGemini } from './lecture-ai.js';
const ok = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"complete":true}' }] } }] };
const unavailable = () => Object.assign(new Error('temporary'), { providerStatus: 503 });
test('503 retries primary once then uses alternate; model attribution reflects actual success', async () => {
 const calls=[],notices=[],delays=[];const ai=createLectureGemini({config:{LECTURE_GEMINI_MODEL:'primary',LECTURE_GEMINI_FALLBACKS:'alternate,backup'},sleep:async ms=>delays.push(ms),onRetry:x=>notices.push(x),request:async url=>{calls.push(url);if(calls.length<3)throw unavailable();return ok;}});
 assert.equal((await ai.generate([],new AbortController().signal)).complete,true);assert.equal(calls.length,3);assert.ok(calls[0].includes('/primary:'));assert.ok(calls[1].includes('/primary:'));assert.ok(calls[2].includes('/alternate:'));assert.deepEqual([...ai.usedModels],['alternate']);assert.deepEqual(delays,[1000,2000]);assert.equal(notices[1].attempt,3);
});
test('exhaustion is bounded and does not blame file size; auth and quota errors are not retried',async()=>{
 let calls=0;const ai=createLectureGemini({config:{},sleep:async()=>{},request:async()=>{calls++;throw unavailable();}});await assert.rejects(ai.generate([],new AbortController().signal),/لا يعني أن ملفك/);assert.equal(calls,4);
 for(const status of [400,401,403,429]){let count=0;const service=createLectureGemini({config:{},request:async()=>{count++;throw Object.assign(new Error('safe error'),{providerStatus:status});}});await assert.rejects(service.generate([],new AbortController().signal),/safe error/);assert.equal(count,1);}
});
test('missing model skips duplicate attempt, and cancellation stops during backoff',async()=>{
 let calls=0;const ai=createLectureGemini({config:{},sleep:async()=>{},request:async()=>{calls++;if(calls===1)throw Object.assign(new Error('missing'),{providerStatus:404});return ok;}});await ai.generate([],new AbortController().signal);assert.equal(calls,2);
 const controller=new AbortController();let requested=0;const cancel=createLectureGemini({config:{},request:async()=>{requested++;throw unavailable();},sleep:async()=>{controller.abort();controller.signal.throwIfAborted();}});await assert.rejects(cancel.generate([],controller.signal),{name:'AbortError'});assert.equal(requested,1);
});
