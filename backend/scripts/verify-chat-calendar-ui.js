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
 const page=await browser.newPage();await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.emulateTimezone('Asia/Riyadh');await page.setViewport({width:1440,height:1100});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{
  localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');globalThis.__recognizers=[];globalThis.__audioChecks=[];
  class Recognition {constructor(){this.results=[];this.active=false;globalThis.__recognizers.push(this);}start(){this.active=true;queueMicrotask(()=>{if(this.active)this.onstart?.();});}abort(){this.active=false;this.onend?.();}emit(text){const item=[{transcript:text}];item.isFinal=true;this.results.push(item);this.onresult?.({resultIndex:this.results.length-1,results:this.results});}}
  globalThis.SpeechRecognition=Recognition;globalThis.webkitSpeechRecognition=Recognition;
  globalThis.__say=text=>{const rec=globalThis.__recognizers.findLast(item=>item.active);if(!rec)throw new Error('No active recognition session');rec.emit(text);};
  globalThis.Audio=class {play(){globalThis.__audioChecks.push(!globalThis.__recognizers.some(item=>item.active));this.onplay?.();this.timer=setTimeout(()=>this.onended?.(),80);return Promise.resolve();}pause(){clearTimeout(this.timer);}};
 },`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});
 if(url.pathname.startsWith('/api/')){if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/tasks')return reply({tasks:[{id:'11111111-1111-4111-8111-111111111110',title:'تسليم التقرير',due_date:day,completed:false}]});if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});if(url.pathname==='/api/calendar/plan'){const body=JSON.parse(request.postData());plans.push(body);if(body.message.includes('غير واضح'))return reply({kind:'clarify',question:'أي يوم وأي ساعة؟'});return reply({kind:'event',timeZone:'Asia/Riyadh',expiresAt:Date.now()+600000,event:{requestId:String(plans.length).padStart(32,'c'),title:'مراجعة المشروع',start:`${day}T14:00:00.000Z`,end:`${day}T15:00:00.000Z`,description:'مراجعة خطة العمل'}});}if(url.pathname==='/api/calendar/events'&&request.method()==='POST'){const body=JSON.parse(request.postData());saves.push(body);if(uncertain){uncertain=false;return request.abort('failed');}return reply({event:{id:`a${body.requestId}`}});}if(url.pathname==='/api/calendar/events')return reply({events:[{id:'meeting',title:'اجتماع الفريق',start:{dateTime:`${day}T09:00:00+03:00`},end:{dateTime:`${day}T10:00:00+03:00`}}]});if(url.pathname==='/api/tts'){speech.push(JSON.parse(request.postData()));return reply({audio:'bW9jaw==',mime:'audio/mpeg'});}if(url.pathname==='/api/chat'){if(request.method()==='POST'){chats.push(JSON.parse(request.postData()));return reply({reply:'أنا مساعدك الشخصي.'});}return reply({messages:[]});}if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});}
 if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 const ready=()=>page.waitForFunction(()=>globalThis.__recognizers.some(item=>item.active));
 const say=text=>page.evaluate(value=>globalThis.__say(value),text);
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});assert.equal(await page.evaluate(()=>globalThis.__recognizers.length),0,'No microphone before consent');

 await page.evaluate(()=>dispatchEvent(new CustomEvent('aql-navigate',{detail:{id:'chat'}})));await page.waitForSelector('#chat-compose');
 await page.type('#chat-compose','Can you schedule a gym session starting five minutes from now?');await page.click('.chat-shell button[type=submit]');
 await page.waitForSelector('.chat-shell .voice-calendar-card .voice-main-toggle');assert.equal(plans.length,1);assert.equal(chats.length,0);assert.equal(saves.length,0,'No write before confirmation');
 await page.type('#chat-compose','confirm appointment');await page.click('.chat-shell button[type=submit]');await page.waitForFunction(()=>document.querySelector('.chat-shell .voice-calendar-card')?.textContent.includes('حفظت موعد'));
 assert.equal(saves.length,1);assert.equal(chats.length,0);assert.deepEqual(errors,[]);console.log('PASS: direct chat gym request plans an event and saves only after explicit confirmation; no chat fallback or false refusal.');
}finally{await browser.close();}
