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

let uploads=0; const formats=[];
const errors=[], chats=[], speech=[], plans=[], saves=[]; let uncertain=false;
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
await fs.mkdir('data/wake-qa',{recursive:true});
try{
 const page=await browser.newPage();await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.emulateTimezone('Asia/Riyadh');await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{
  localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');globalThis.__recognizers=[];globalThis.__audioChecks=[];
  class Recognition {constructor(){this.results=[];this.active=false;globalThis.__recognizers.push(this);}start(){this.active=true;queueMicrotask(()=>{if(this.active)this.onstart?.();});}abort(){this.active=false;this.onend?.();}stop(){const last=this.results.at(-1);if(last)this.emit(last[0].transcript,true);this.active=false;this.onend?.();}emit(text,final=true){const item=[{transcript:text}];item.isFinal=final;this.results.push(item);this.onresult?.({resultIndex:this.results.length-1,results:this.results});}}
  globalThis.SpeechRecognition=Recognition;globalThis.webkitSpeechRecognition=Recognition;
  globalThis.__say=text=>{const rec=globalThis.__recognizers.findLast(item=>item.active);if(!rec)throw new Error('No active recognition session');rec.emit(text);};
  globalThis.__sayInterim=text=>globalThis.__recognizers.findLast(item=>item.active).emit(text,false);globalThis.__streams=0;globalThis.__trackStops=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{globalThis.__streams++;return {getTracks:()=>[{stop(){globalThis.__trackStops++;}}]};}}});globalThis.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(256)],{type:'audio/webm'})});this.onstop?.();}};globalThis.Audio=class {play(){if(globalThis.__blockAudio)return Promise.reject(new DOMException('blocked','NotAllowedError'));globalThis.__audioChecks.push(!globalThis.__recognizers.some(item=>item.active));this.onplay?.();this.timer=setTimeout(()=>this.onended?.(),80);return Promise.resolve();}pause(){clearTimeout(this.timer);}};
 },`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});
 if(url.pathname.startsWith('/api/')){if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/lectures/export'){const body=JSON.parse(request.postData());formats.push(body.format);return request.respond({status:200,contentType:body.format==='pdf'?'application/pdf':'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'},body:'synthetic download'});}if(url.pathname==='/api/lectures/analyze'){uploads++;return request.respond({status:200,contentType:'application/x-ndjson',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({phase:'extracting'})+'\n'+JSON.stringify({result:{summary:'ملخص المحاضرة [صفحة 1]',explanation:'شرح المفهوم [صفحة 1]',questions:'سؤال وإجابة',reviewNotes:'مراجعة النص المستخرج',warnings:[],sources:[{ref:'صفحة 1',text:'الطاقة محفوظة'}],models:['Gemini','Groq']}})+'\n'});}if(url.pathname==='/api/speech/transcribe'){uploads++;return reply({text:'سوي لي موعد تجربة التنبيه بعد ربع ساعة لمدة نصف ساعة'});}if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/tasks')return reply({tasks:[{id:'11111111-1111-4111-8111-111111111110',title:'تسليم التقرير',due_date:day,completed:false}]});if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});if(url.pathname==='/api/calendar/plan'){const body=JSON.parse(request.postData());plans.push(body);if(body.message.includes('غير واضح'))return reply({kind:'clarify',question:'أي يوم وأي ساعة؟'});return reply({kind:'event',timeZone:'Asia/Riyadh',expiresAt:Date.now()+600000,event:{requestId:String(plans.length).padStart(32,'c'),title:'مراجعة المشروع',start:`${day}T14:00:00.000Z`,end:`${day}T15:00:00.000Z`,description:'مراجعة خطة العمل'}});}if(url.pathname==='/api/calendar/events'&&request.method()==='POST'){const body=JSON.parse(request.postData());saves.push(body);if(uncertain){uncertain=false;return request.abort('failed');}return reply({event:{id:`a${body.requestId}`}});}if(url.pathname==='/api/calendar/events')return reply({events:[{id:'meeting',title:'اجتماع الفريق',start:{dateTime:`${day}T09:00:00+03:00`},end:{dateTime:`${day}T10:00:00+03:00`}}]});if(url.pathname==='/api/tts'){speech.push(JSON.parse(request.postData()));return reply({audio:'bW9jaw==',mime:'audio/mpeg'});}if(url.pathname==='/api/chat'){if(request.method()==='POST'){chats.push(JSON.parse(request.postData()));return reply({reply:'أنا مساعدك الشخصي.'});}return reply({messages:[]});}if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});}
 if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});
 await page.click('[aria-label="مساحة المحاضرات"]');
 await page.waitForSelector('.lecture-dialog[open]');
 assert.equal(await page.$eval('.lecture-dialog .services-primary',b=>b.disabled),true);
 await page.evaluate(()=>{const input=document.querySelector('.lecture-dialog input[type=file]');const files=new DataTransfer();files.items.add(new File(['%PDF-1.4 synthetic'], 'lecture.pdf',{type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(uploads,0);assert.equal(await page.$eval('.lecture-dialog .services-primary',b=>b.disabled),true);
 await page.click('.lecture-consent input');await page.click('.lecture-dialog .services-primary');
 await page.waitForSelector('.lecture-output');assert.equal(uploads,1);
 assert.ok((await page.$eval('.lecture-output',e=>e.textContent)).includes('ملخص'));
 await page.$$eval('.lecture-tabs button',buttons=>buttons.find(b=>b.textContent==='الشرح').click());assert.ok((await page.$eval('.lecture-output',e=>e.textContent)).includes('شرح'));
 assert.equal(await page.$eval('.lecture-download select',s=>s.value),'pdf');
 for(const format of ['pdf','docx','md']){await page.select('.lecture-download select',format);await page.click('.lecture-download button');await page.waitForFunction(()=>!document.querySelector('.lecture-download button').disabled);}
 assert.deepEqual(formats,['pdf','docx','md']);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.querySelector('.lecture-dialog').scrollWidth>document.querySelector('.lecture-dialog').clientWidth),false);
 await page.screenshot({path:'data/wake-qa/lecture-mobile.png',fullPage:true});console.log('PASS mobile lecture upload, consent gate, streamed result, tabs, no page errors or dialog overflow. Providers mocked.');
}finally{await browser.close();}
