import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
const env = dotenv.parse(await fs.readFile('../frontend/.env', 'utf8'));
const project = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
const id = '11111111-1111-4111-8111-111111111111';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = { access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.qa`, refresh_token: 'qa-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id, email: 'calendar-qa@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {} } };
const browser = await puppeteer.launch({ headless: true });

const errors=[], chats=[], speech=[];
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
await fs.mkdir('data/wake-qa',{recursive:true});
try{
 const page=await browser.newPage();await page.emulateTimezone('Asia/Riyadh');await page.setViewport({width:1440,height:1100});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{
  localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');globalThis.__recognizers=[];globalThis.__audioChecks=[];
  class Recognition {constructor(){this.results=[];this.active=false;globalThis.__recognizers.push(this);}start(){this.active=true;queueMicrotask(()=>{if(this.active)this.onstart?.();});}abort(){this.active=false;this.onend?.();}emit(text){const item=[{transcript:text}];item.isFinal=true;this.results.push(item);this.onresult?.({resultIndex:this.results.length-1,results:this.results});}}
  globalThis.SpeechRecognition=Recognition;globalThis.webkitSpeechRecognition=Recognition;
  globalThis.__say=text=>{const rec=globalThis.__recognizers.findLast(item=>item.active);if(!rec)throw new Error('No active recognition session');rec.emit(text);};
  globalThis.Audio=class {play(){globalThis.__audioChecks.push(!globalThis.__recognizers.some(item=>item.active));this.onplay?.();this.timer=setTimeout(()=>this.onended?.(),80);return Promise.resolve();}pause(){clearTimeout(this.timer);}};
 },`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});
 if(url.pathname.startsWith('/api/')){if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/tasks')return reply({tasks:[{id:'11111111-1111-4111-8111-111111111110',title:'تسليم التقرير',due_date:day,completed:false}]});if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});if(url.pathname==='/api/calendar/events')return reply({events:[{id:'meeting',title:'اجتماع الفريق',start:{dateTime:`${day}T09:00:00+03:00`},end:{dateTime:`${day}T10:00:00+03:00`}}]});if(url.pathname==='/api/tts'){speech.push(JSON.parse(request.postData()));return reply({audio:'bW9jaw==',mime:'audio/mpeg'});}if(url.pathname==='/api/chat'){if(request.method()==='POST'){chats.push(JSON.parse(request.postData()));return reply({reply:'أنا مساعدك الشخصي.'});}return reply({messages:[]});}if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});}
 if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 const ready=()=>page.waitForFunction(()=>globalThis.__recognizers.some(item=>item.active));
 const say=text=>page.evaluate(value=>globalThis.__say(value),text);
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});assert.equal(await page.evaluate(()=>globalThis.__recognizers.length),0,'No microphone before consent');
 await page.click('.wake-trigger');await page.waitForSelector('.wake-dialog[open] .studio-primary:not(:disabled)');assert.equal(await page.$eval('[name="wake-name"]',el=>el.value),'جارفس');
 await page.click('.wake-dialog .studio-primary');await ready();await say('أنا أتكلم في محادثة جانبية');assert.equal(chats.length,0);assert.equal(speech.length,0);
 await say('يا جارفس وش عندي اليوم');await page.waitForFunction(()=>document.querySelector('.wake-reply')?.textContent.includes('اجتماع الفريق'));await ready();
 assert.equal(chats.length,0,'Today must not send calendar/tasks to AI chat');assert(speech.some(value=>value.text.includes('تسليم التقرير')));assert(speech.every(value=>value.voice==='ar-SA-HamedNeural'));
 await say('يا جارفيس');await page.waitForFunction(()=>document.querySelector('.wake-reply')?.textContent.includes('تفضّل'));await ready();await say('وش عندي اليوم');await page.waitForFunction(()=>document.querySelector('.wake-reply')?.textContent.includes('اجتماع الفريق'));await ready();
 await say('يا جارفس من أنت');await page.waitForFunction(()=>document.querySelector('.wake-reply')?.textContent.includes('أنا مساعدك'));await ready();assert.equal(chats.length,1);assert.equal(chats[0].voice_mode,true);assert(!JSON.stringify(chats).includes('اجتماع الفريق'));assert(!JSON.stringify(chats).includes('محادثة جانبية'));
 await say('يا جارفس أضف مهمة جديدة');await page.waitForFunction(()=>document.querySelector('.wake-reply')?.textContent.includes('ما نفّذت أي تغيير'));await ready();assert.equal(chats.length,1);
 await page.evaluate(()=>dispatchEvent(new Event('aql-mic-claim')));assert.equal(await page.evaluate(()=>globalThis.__recognizers.some(item=>item.active)),false);await page.evaluate(()=>dispatchEvent(new CustomEvent('aql-voice-state',{detail:'idle'})));await ready();
 await page.setViewport({width:390,height:844});await page.screenshot({path:'data/wake-qa/mobile-ar.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.$eval('.wake-dialog',el=>el.scrollTop=0);await page.screenshot({path:'data/wake-qa/settings-ar.png'});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('.wake-phase')?.textContent.includes('توقّف'));assert.equal(await page.evaluate(()=>globalThis.__recognizers.some(item=>item.active)),false);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>globalThis.__recognizers.some(item=>item.active)),false);
 await page.click('.wake-dialog .studio-primary');await ready();await page.evaluate(()=>globalThis.__recognizers.findLast(item=>item.active).onerror({error:'not-allowed'}));await page.waitForFunction(()=>document.querySelector('.wake-dialog [role="alert"]')?.textContent.includes('لم يُسمح'));assert.equal(await page.evaluate(()=>globalThis.__recognizers.some(item=>item.active)),false);
 await page.reload({waitUntil:'networkidle2'});assert.equal(await page.evaluate(()=>globalThis.__recognizers.length),0,'Reload never auto-enables mic');
 await page.click('.wake-trigger');await page.waitForSelector('.wake-dialog .studio-primary:not(:disabled)');await page.$eval('[name="wake-name"]',el=>{el.focus();el.select();});await page.keyboard.type('رفيق');await page.click('.wake-dialog .studio-primary');await ready();
 await say('يا جارفس وش عندي اليوم');assert.equal(chats.length,1);await say('يا رفيق افتح التقويم');await page.waitForSelector('#studio-panel-calendar');await ready();
 await page.click('.wake-dialog header button');await page.click('.wake-stop');assert.equal(await page.evaluate(()=>globalThis.__recognizers.some(item=>item.active)),false);
 assert((await page.evaluate(()=>globalThis.__audioChecks)).every(Boolean),'No recognition active while audio plays');assert.deepEqual(errors,[]);
 console.log('PASS: no mic autostart; Jarvis/custom names; ambient speech ignored; direct and follow-up commands; real day data without AI disclosure; generic read-only chat; writes denied; no self-echo during simulated speech; other mic arbitration; visibility, permission, reload and explicit stop cleanup; mobile UI. Recognition/audio are simulated, not a real-microphone accuracy test.');
}finally{await browser.close();}
