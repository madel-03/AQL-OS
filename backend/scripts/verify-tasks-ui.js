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

const tasks = []; const events = []; const errors = [];
await fs.mkdir('data/tasks-qa', { recursive: true });
try {
 const page = await browser.newPage(); await page.setViewport({width:1440,height:1100}); page.on('pageerror', error => errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{ localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar'); },`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);
 page.on('request', request => {
  const url=new URL(request.url()); const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'},body:JSON.stringify(value)});
  if(url.pathname.startsWith('/api/')) {
   if(request.method()==='OPTIONS') return reply({});
   if(url.pathname.startsWith('/api/tasks')) {
    if(request.method()==='POST') {const body=JSON.parse(request.postData());const task={...body,completed:false,created_at:new Date().toISOString()};tasks.push(task);return reply({task});}
    if(request.method()==='PATCH') {const task=tasks.find(task=>url.pathname.endsWith(task.id));Object.assign(task,JSON.parse(request.postData()));return reply({task});}
    return reply({tasks});
   }
   if(url.pathname==='/api/calendar/status')return reply({configured:true,connected:true});
   if(url.pathname==='/api/calendar/events'){if(request.method()==='POST'){events.push(JSON.parse(request.postData()));return reply({event:{id:events.at(-1).requestId}});}return reply({events:[],nextPageToken:null});}
   if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});return reply({});
  }
  if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();
 });
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});await page.click('#studio-tab-tasks');await page.waitForSelector('.tasks-space form button:not(:disabled)');
 await page.type('[name="task-title"]','Review my project');
 await page.evaluate(()=>{const input=document.querySelector('[name="task-due"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-01-01');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.type('[name="task-notes"]','Prepare the draft');await page.click('.tasks-space form button');await page.waitForSelector('.personal-task');
 assert.equal(tasks.length,1);assert.match(await page.$eval('.personal-task',el=>el.textContent),/متأخرة/);
 await page.click('.task-check input');await page.waitForFunction(()=>!document.querySelector('.personal-task'));
 await page.click('.task-filters button:nth-child(3)');await page.waitForSelector('.personal-task.is-complete');
 await page.click('.task-check input');await page.waitForFunction(()=>!document.querySelector('.personal-task'));
 await page.click('.task-filters button:first-child');await page.waitForSelector('.personal-task');
 await page.click('.personal-task .studio-actions button:first-child');await page.$eval('[name="task-title"]',el=>{el.focus();el.select();});await page.keyboard.type('Edited project');await page.click('.tasks-space form button');
 await page.waitForFunction(()=>document.querySelector('.personal-task strong')?.textContent==='Edited project');
 await page.reload({waitUntil:'networkidle2'});await page.waitForSelector('.personal-task');assert.equal(await page.$eval('.personal-task strong',el=>el.textContent),'Edited project');
 await page.setViewport({width:390,height:844});await page.$eval('.tasks-space',el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'data/tasks-qa/mobile-ar.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.click('.personal-task .studio-actions button:nth-child(2)');await page.waitForSelector('.calendar-space .studio-form');
 assert.equal(await page.$eval('.calendar-space input',el=>el.value),'Edited project');assert.equal(events.length,0);
 await page.click('.calendar-space .studio-form button');await page.waitForSelector('.calendar-space .device-preview');assert.equal(events.length,0);
 await page.click('.calendar-space .device-preview button');await page.waitForFunction(()=>document.querySelector('.calendar-space')?.textContent.includes('حُفظ الموعد'));
 assert.equal(events.length,1);assert.equal(events[0].requestId,tasks[0].id.replaceAll('-',''));assert.equal(events[0].description,'Prepare the draft');
 await page.click('[data-language-switch]');await page.waitForFunction(()=>document.documentElement.lang==='en');
 assert.deepEqual(errors,[]);console.log('PASS: cloud task API flow, due/overdue, complete/reopen, edit, reload, mobile Arabic/English, calendar handoff and explicit event review with stable task event ID; isolated mock accounts only');
}finally{await browser.close();}
