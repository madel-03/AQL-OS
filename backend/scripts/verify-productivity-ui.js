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

const errors=[]; const calendarQueries=[];
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const earlier=new Date(`${day}T12:00:00Z`);earlier.setUTCDate(earlier.getUTCDate()-1);const late=earlier.toISOString().slice(0,10);
const future=new Date(`${day}T12:00:00Z`);future.setUTCDate(future.getUTCDate()+1);
const tasks=[{id:'11111111-1111-4111-8111-111111111110',title:'تقرير اليوم',notes:'Draft',due_date:day,completed:false},{id:'11111111-1111-4111-8111-111111111112',title:'مهمة متأخرة',due_date:late,completed:false},{id:'11111111-1111-4111-8111-111111111113',title:'مهمة منجزة',due_date:day,completed:true},{id:'11111111-1111-4111-8111-111111111114',title:'مهمة مستقبلية',due_date:future.toISOString().slice(0,10),completed:false}];
const research={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',topic:'Synthetic research',status:'searching',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),sources:[]};
await fs.mkdir('data/productivity-qa',{recursive:true});
try{
 const page=await browser.newPage();await page.emulateTimezone('Asia/Riyadh');await page.setViewport({width:1440,height:1100});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');},`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'},body:JSON.stringify(value)});
 if(url.pathname.startsWith('/api/')){if(request.method()==='OPTIONS')return reply({});if(url.pathname==='/api/tasks')return reply({tasks});if(url.pathname.startsWith('/api/tasks/')){const task=tasks.find(value=>url.pathname.endsWith(value.id));Object.assign(task,JSON.parse(request.postData()));return reply({task});}if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});if(url.pathname==='/api/calendar/events'){calendarQueries.push(url.search);return reply({events:[{id:'morning',title:'موعد الصباح',start:{dateTime:`${day}T08:00:00+03:00`},end:{dateTime:`${day}T09:00:00+03:00`}}],nextPageToken:null});}if(url.pathname==='/api/research')return reply({tasks:[research]});if(url.pathname.startsWith('/api/research/'))return reply(research);if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});}
 if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('.today-card')?.textContent.includes('تقرير اليوم'));
 const today=await page.$eval('.today-card',el=>el.textContent);assert(today.includes('مهمة متأخرة'));assert(!today.includes('مهمة منجزة'));assert(!today.includes('مهمة مستقبلية'));assert(today.includes('موعد الصباح'));
 const window=new URLSearchParams(calendarQueries.find(query=>query.includes('from=')));assert.equal(window.get('from'),new Date(`${day}T00:00:00+03:00`).toISOString());
 await page.waitForFunction(()=>document.querySelector('.activity-status > button')?.textContent.includes('أبحث'));
 await page.click('.activity-status > button');await page.waitForSelector('#activity-details');assert.match(await page.$eval('#activity-details',el=>el.textContent),/Synthetic research/);await page.click('.activity-status > button');
 await page.keyboard.down('Control');await page.keyboard.press('k');await page.keyboard.up('Control');await page.waitForSelector('.quick-search-dialog[open]');await page.type('.quick-search-dialog input','تقرير اليوم');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement.id==='personal-task-11111111-1111-4111-8111-111111111110');
 await page.click('#personal-task-11111111-1111-4111-8111-111111111110 input');await page.waitForFunction(()=>document.querySelector('#personal-task-11111111-1111-4111-8111-111111111110 input')?.checked);
 await page.click('[data-destination="dashboard"]');await page.waitForFunction(()=>!document.querySelector('.today-card')?.textContent.includes('تقرير اليوم'));
 await page.click('.quick-search-trigger');await page.type('.quick-search-dialog input','nomatchxyz');await page.waitForSelector('.quick-search-dialog .studio-empty');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.quick-search-dialog[open]'));
 await page.click('.quick-search-trigger');await page.$eval('.quick-search-dialog input',el=>{el.focus();el.select();});await page.keyboard.type('مهمة منجزة');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.id==='personal-task-11111111-1111-4111-8111-111111111113').catch(async error=>{console.log(await page.evaluate(()=>({active:document.activeElement.outerHTML,query:document.querySelector('.quick-search-dialog input')?.value,rows:[...document.querySelectorAll('.personal-task')].map(el=>({id:el.id,text:el.textContent})),dialog:!!document.querySelector('.quick-search-dialog[open]')})));throw error;});
 await page.click('[data-destination="dashboard"]');await page.$eval('.today-card',el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'data/productivity-qa/today-ar.png'});
 // Verify activity transitions in the UI without running real device commands or sending logs.
 for(const [status,label] of [['waiting','ينتظر موافقتك'],['running','ينفّذ على جهازك'],['completed','اكتمل التنفيذ'],['failed','تحتاج متابعة']]){await page.evaluate(value=>globalThis.dispatchEvent(new CustomEvent('aql-device-activity',{detail:{status:value,label:'QA device operation'}})),status);await page.waitForFunction(text=>document.querySelector('.activity-status > button')?.textContent.includes(text),{},label);}
 await page.evaluate(()=>globalThis.dispatchEvent(new CustomEvent('aql-device-activity',{detail:null})));
 await page.setViewport({width:390,height:844});await page.$eval('.today-card',el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'data/productivity-qa/mobile-ar.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.click('.quick-search-trigger');await page.screenshot({path:'data/productivity-qa/search-mobile-ar.png'});await page.keyboard.press('Escape');await page.click('[data-language-switch]');await page.waitForFunction(()=>document.documentElement.lang==='en');assert.match(await page.$eval('.today-card',el=>el.textContent),/Your day/);
 assert.deepEqual(errors,[]);console.log('PASS: local-day calendar query includes earlier meetings; due/overdue excludes completed/future tasks; live task refresh; Ctrl+K, search empty/completed results and focused task handoff; real research stage; device approval/run/completion/failure states; mobile RTL/English without overflow');
}finally{await browser.close();}
