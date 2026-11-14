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

const errors=[], chats=[], speech=[], plans=[], saves=[]; let uncertain=true;
let extraEvent=false; const eventAt=Date.now()+5*60000;
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
await fs.mkdir('data/wake-qa',{recursive:true});
try{
 const page=await browser.newPage();await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.emulateTimezone('Asia/Riyadh');await page.setViewport({width:1440,height:1100});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{
  localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');globalThis.__recognizers=[];globalThis.__audioChecks=[];
  class Recognition {constructor(){this.results=[];this.active=false;globalThis.__recognizers.push(this);}start(){this.active=true;queueMicrotask(()=>{if(this.active)this.onstart?.();});}abort(){this.active=false;this.onend?.();}emit(text){const item=[{transcript:text}];item.isFinal=true;this.results.push(item);this.onresult?.({resultIndex:this.results.length-1,results:this.results});}}
  globalThis.__notifications=[];globalThis.__permissionCalls=0;globalThis.__permissionChoice='denied';globalThis.Notification=class{static permission='default';static async requestPermission(){globalThis.__permissionCalls++;return this.permission=globalThis.__permissionChoice;}constructor(title,options){globalThis.__notifications.push({title,options});}close(){}};globalThis.SpeechRecognition=Recognition;globalThis.webkitSpeechRecognition=Recognition;
  globalThis.__say=text=>{const rec=globalThis.__recognizers.findLast(item=>item.active);if(!rec)throw new Error('No active recognition session');rec.emit(text);};
  globalThis.Audio=class {play(){globalThis.__audioChecks.push(!globalThis.__recognizers.some(item=>item.active));this.onplay?.();this.timer=setTimeout(()=>this.onended?.(),80);return Promise.resolve();}pause(){clearTimeout(this.timer);}};
 },`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});
 if(url.pathname.startsWith('/api/')){if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/tasks')return reply({tasks:[{id:'11111111-1111-4111-8111-111111111110',title:'تسليم التقرير',due_date:day,completed:false}]});if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});if(url.pathname==='/api/calendar/plan'){const body=JSON.parse(request.postData());plans.push(body);if(body.message.includes('غير واضح'))return reply({kind:'clarify',question:'أي يوم وأي ساعة؟'});return reply({kind:'event',timeZone:'Asia/Riyadh',expiresAt:Date.now()+600000,event:{requestId:String(plans.length).padStart(32,'c'),title:'مراجعة المشروع',start:`${day}T14:00:00.000Z`,end:`${day}T15:00:00.000Z`,description:'مراجعة خطة العمل'}});}if(url.pathname==='/api/calendar/events'&&request.method()==='POST'){const body=JSON.parse(request.postData());saves.push(body);if(uncertain){uncertain=false;return request.abort('failed');}return reply({event:{id:`a${body.requestId}`}});}if(url.pathname==='/api/calendar/events')return reply({events:[...(extraEvent?[{id:'extra',title:'موعد إضافي',start:{dateTime:new Date(eventAt).toISOString()},end:{dateTime:new Date(eventAt+60*60000).toISOString()}}]:[]),{id:'meeting',title:'اجتماع الفريق',start:{dateTime:new Date(eventAt).toISOString()},end:{dateTime:new Date(eventAt+60*60000).toISOString()}}]});if(url.pathname==='/api/tts'){speech.push(JSON.parse(request.postData()));return reply({audio:'bW9jaw==',mime:'audio/mpeg'});}if(url.pathname==='/api/chat'){if(request.method()==='POST'){chats.push(JSON.parse(request.postData()));return reply({reply:'أنا مساعدك الشخصي.'});}return reply({messages:[]});}if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});}
 if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 const ready=()=>page.waitForFunction(()=>globalThis.__recognizers.some(item=>item.active));
 const say=text=>page.evaluate(value=>globalThis.__say(value),text);
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});assert.equal(await page.evaluate(()=>globalThis.__recognizers.length),0,'No microphone before consent');

 assert.equal(await page.evaluate(()=>globalThis.__permissionCalls),0);
 await page.click('.reminder-trigger');await page.waitForSelector('.reminder-dialog[open]');
 await page.$eval('.reminder-dialog input[type=time]',el=>{el.value='00:01';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>{const input=document.querySelector('.reminder-dialog>label input');input.click();});
 await page.waitForFunction(()=>document.querySelector('.reminder-inbox')?.textContent.includes('اجتماع الفريق'));
 assert.equal(await page.evaluate(()=>globalThis.__notifications.length),0,'No permission requested and no system notifications by default');
 await page.click('.reminder-dialog .studio-primary');await page.waitForFunction(()=>globalThis.__permissionCalls===1);assert.equal(await page.evaluate(()=>Notification.permission),'denied');
 await page.evaluate(()=>{globalThis.__permissionChoice='granted';});await page.click('.reminder-dialog .studio-primary');await page.waitForFunction(()=>Notification.permission==='granted');
 extraEvent=true;await page.evaluate(()=>window.dispatchEvent(new Event('aql-data-changed')));await page.waitForFunction(()=>globalThis.__notifications.length===1);
 const before=await page.$$eval('.reminder-inbox li',els=>els.length);assert(before>=1);
 await page.reload({waitUntil:'networkidle2'});await page.click('.reminder-trigger');await page.waitForSelector('.reminder-dialog[open]');
 await new Promise(resolve=>setTimeout(resolve,600));assert.equal(await page.$$eval('.reminder-inbox li',els=>els.length),before,'Reload must not duplicate a delivered reminder');
 await page.setViewport({width:390,height:844});await page.screenshot({path:'data/wake-qa/reminders-mobile.png'});assert(await page.$eval('.reminder-dialog',el=>el.getBoundingClientRect().width<390));
 assert.deepEqual(errors,[]);console.log('Reminders UI passed: opt-in, in-app delivery, denied/granted permission, persisted deduplication, mobile layout.');
}finally{await browser.close();}
