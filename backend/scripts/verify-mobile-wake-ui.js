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

const errors=[], chats=[], speech=[], plans=[], saves=[]; let uncertain=false;
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
await fs.mkdir('data/wake-qa',{recursive:true});
try{
 const page=await browser.newPage();await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.emulateTimezone('Asia/Riyadh');await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{
  localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');globalThis.__recognizers=[];globalThis.__audioChecks=[];
  class Recognition {constructor(){this.results=[];this.active=false;globalThis.__recognizers.push(this);}start(){this.active=true;queueMicrotask(()=>{if(this.active)this.onstart?.();});}abort(){this.active=false;this.onend?.();}emit(text,final=true){const item=[{transcript:text}];item.isFinal=final;this.results.push(item);this.onresult?.({resultIndex:this.results.length-1,results:this.results});}}
  globalThis.SpeechRecognition=Recognition;globalThis.webkitSpeechRecognition=Recognition;
  globalThis.__say=text=>{const rec=globalThis.__recognizers.findLast(item=>item.active);if(!rec)throw new Error('No active recognition session');rec.emit(text);};
  globalThis.__sayInterim=text=>globalThis.__recognizers.findLast(item=>item.active).emit(text,false);globalThis.Audio=class {play(){globalThis.__audioChecks.push(!globalThis.__recognizers.some(item=>item.active));this.onplay?.();this.timer=setTimeout(()=>this.onended?.(),80);return Promise.resolve();}pause(){clearTimeout(this.timer);}};
 },`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});
 if(url.pathname.startsWith('/api/')){if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/tasks')return reply({tasks:[{id:'11111111-1111-4111-8111-111111111110',title:'تسليم التقرير',due_date:day,completed:false}]});if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});if(url.pathname==='/api/calendar/plan'){const body=JSON.parse(request.postData());plans.push(body);if(body.message.includes('غير واضح'))return reply({kind:'clarify',question:'أي يوم وأي ساعة؟'});return reply({kind:'event',timeZone:'Asia/Riyadh',expiresAt:Date.now()+600000,event:{requestId:String(plans.length).padStart(32,'c'),title:'مراجعة المشروع',start:`${day}T14:00:00.000Z`,end:`${day}T15:00:00.000Z`,description:'مراجعة خطة العمل'}});}if(url.pathname==='/api/calendar/events'&&request.method()==='POST'){const body=JSON.parse(request.postData());saves.push(body);if(uncertain){uncertain=false;return request.abort('failed');}return reply({event:{id:`a${body.requestId}`}});}if(url.pathname==='/api/calendar/events')return reply({events:[{id:'meeting',title:'اجتماع الفريق',start:{dateTime:`${day}T09:00:00+03:00`},end:{dateTime:`${day}T10:00:00+03:00`}}]});if(url.pathname==='/api/tts'){speech.push(JSON.parse(request.postData()));return reply({audio:'bW9jaw==',mime:'audio/mpeg'});}if(url.pathname==='/api/chat'){if(request.method()==='POST'){chats.push(JSON.parse(request.postData()));return reply({reply:'أنا مساعدك الشخصي.'});}return reply({messages:[]});}if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});}
 if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 const ready=()=>page.waitForFunction(()=>globalThis.__recognizers.some(item=>item.active));
 const say=text=>page.evaluate(value=>globalThis.__say(value),text);
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});assert.equal(await page.evaluate(()=>globalThis.__recognizers.length),0,'No microphone before consent');
 await page.$$eval('.voice-presence .voice-mode-options button',buttons=>buttons.find(b=>b.textContent.includes('نداء بالاسم')).click());
 await page.click('.wake-trigger');await page.waitForSelector('.wake-dialog[open] .studio-primary:not(:disabled)');assert.equal(await page.$eval('[name="wake-name"]',el=>el.value),'جارفس');
 await page.click('.wake-dialog header button'); await page.waitForSelector('.voice-presence'); await page.click('.voice-main-toggle');await ready(); assert.equal(await page.$eval('.voice-presence',el=>el.dataset.phase),'waiting'); assert.notEqual(await page.$eval('.voice-liquid',el=>getComputedStyle(el).animationName),'none'); await say('أنا أتكلم في محادثة جانبية');assert.equal(chats.length,0);assert.equal(speech.length,0);


 assert.equal(await page.evaluate(()=>globalThis.__recognizers.at(-1).continuous),true,'Native wake uses continuous mode without forced-stop cycling');
 await page.evaluate(()=>globalThis.__recognizers.at(-1).onspeechstart());await say('يا جارفس اضف موعد تجربة التنبيه بعد 15 دقيقة لمدة نصف ساعة');
 await page.waitForFunction(()=>document.querySelector('.voice-calendar-card')?.textContent.includes('مراجعة المشروع'));await ready();assert.equal(plans.length,1);assert.equal(saves.length,0);
 await page.evaluate(()=>globalThis.__sayInterim('يا جارفس سوي لي موعد للنادي بعد خمس دقائق'));await page.waitForSelector('.voice-presence .captured-speech button');
 await new Promise(resolve=>setTimeout(resolve,2100));assert.equal(plans.length,1,'Interim request is not auto-submitted');
 await page.screenshot({path:'data/wake-qa/mobile-captured-review.png',fullPage:true});
 await page.click('.voice-presence .captured-speech button');await page.waitForFunction(()=>document.querySelector('.voice-calendar-card')?.textContent.includes('مراجعة المشروع'));await ready();assert.equal(plans.length,2);assert.equal(saves.length,0);assert.equal(chats.length,0);
 assert.deepEqual(errors,[]);console.log('PASS: mobile single-session recognition, final speech without speechend, interim transcript review and explicit send with no automatic save. ASR/Google simulated.');
}finally{await browser.close();}
