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

const errors=[];await fs.mkdir('data/navigation-qa',{recursive:true});
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:1100});page.on('pageerror',error=>errors.push(error.message));
 await page.evaluateOnNewDocument((key,value)=>{localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('tawazun-lang','ar');},`sb-${project}-auth-token`,session);
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());const reply=value=>request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});if(url.pathname.startsWith('/api/')){if(url.pathname==='/api/calendar/status')return reply({configured:false,connected:false});if(url.pathname==='/api/research')return reply({tasks:[]});if(url.pathname==='/api/tasks')return reply({tasks:[]});if(url.pathname==='/api/commitments')return reply({commitments:[]});if(url.pathname==='/api/goals')return reply({goals:[]});if(url.pathname==='/api/chat')return reply({messages:[]});return reply({});}if(url.hostname.endsWith('supabase.co'))return reply({user:session.user});return request.continue();});
 await page.goto('http://127.0.0.1:5175',{waitUntil:'networkidle2'});await page.waitForSelector('.aql-navigation');
 assert.equal(await page.$$eval('.studio-tabs button',items=>items.length),3);
 for(const [target,selector] of [['tasks','.tasks-space'],['calendar','.calendar-space'],['projects','.projects-space'],['desk','.desk-space'],['device','.device-space'],['focus','.focus-space']]) {
  await page.click(`[data-destination="${target}"]`);await page.waitForSelector(`#studio-panel-${target}`);assert.equal(await page.$eval(`#studio-tab-${target}`, el => el.getAttribute('aria-selected')), 'true', target);
 }
 await page.click('.tool-groups button:nth-child(2)');await page.click('#studio-tab-ideas');await page.waitForSelector('#studio-panel-ideas');
 await page.click('.tool-groups button:nth-child(3)');await page.click('#studio-tab-memory');await page.waitForSelector('#studio-panel-memory');
 await page.click('#studio-tab-ambience');await page.waitForSelector('#studio-panel-ambience');
 await page.click('[data-destination="tasks"]');await page.focus('#studio-tab-tasks');await page.keyboard.press('End');await page.waitForSelector('#studio-panel-focus');await page.waitForFunction(()=>document.activeElement.id==='studio-tab-focus');
 await page.click('[data-destination="chat"]');await page.waitForSelector('#chat-compose');
 await page.click('[data-destination="dashboard"]');await page.waitForSelector('.living-space');await page.click('.navigation-more summary');
 await page.click('[data-destination="goals"]');await page.waitForFunction(()=>document.querySelector('.page-heading h2')?.textContent.includes('أهدافي'));
 await page.click('[data-destination="tasks"]');await page.$eval('.living-space',el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'data/navigation-qa/desktop-ar.png'});
 await page.click('[data-language-switch]');await page.waitForFunction(()=>document.documentElement.lang==='en');await page.screenshot({path:'data/navigation-qa/desktop-en.png'});
 assert(await page.$$eval('.navigation-link',items=>items.every(el=>el.scrollWidth<=el.clientWidth+1)),'Labels must fit');
 await page.setViewport({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
 assert.equal(await page.$eval('.aql-navigation',el=>getComputedStyle(el).display),'none');
 await page.click('.navigation-mobile button');await page.waitForSelector('.aql-navigation.is-open');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
 await page.keyboard.press('Escape');assert.equal(await page.$eval('.navigation-mobile button',el=>el===document.activeElement),true);
 await page.click('.navigation-mobile button');await page.screenshot({path:'data/navigation-qa/mobile-menu-en.png'});await page.click('[data-destination="calendar"]');await page.waitForSelector('#studio-panel-calendar');assert.equal(await page.$('.navigation-backdrop'),null);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.click('[data-language-switch]');await page.waitForFunction(()=>document.documentElement.lang==='ar');await page.$eval('.living-space',el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'data/navigation-qa/mobile-ar.png'});
 await page.setViewport({width:820,height:1100});assert.equal(await page.$eval('.app-layout',el=>getComputedStyle(el).flexDirection),'row');
 assert.deepEqual(errors,[]);console.log('PASS: grouped sidebar and all nine tool destinations, chat and legacy goal route, tab keyboard navigation, Arabic/English labels, responsive tablet layout, mobile menu/focus/Escape/backdrop and no overflow');
}finally{await browser.close();}
