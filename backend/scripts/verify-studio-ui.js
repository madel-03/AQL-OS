// All account and API data below are synthetic and isolated in a new browser.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

const env = dotenv.parse(await fs.readFile('../frontend/.env', 'utf8'));
const project = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const key = `aql-studio-v1:${userId}`;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (id) => `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
const session = { access_token: token(userId), refresh_token: 'qa-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: userId, email: 'noura@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'نورة' } } };
const tasks = [1, 2, 3, 4].map((number) => ({ id: `00000000-0000-4000-8000-00000000000${number}`, topic: number === 4 ? 'A stopped research task' : 'Home strength training', status: number === 4 ? 'failed' : 'completed', lang: 'en', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), sources: [], report_available: number !== 4, report: '# Research fixture\n\nA synthetic report.', error: number === 4 ? 'Sources unreadable' : undefined }));
const browser = await puppeteer.launch({ headless: true }); const failures = []; const chats = [];
await fs.mkdir('data/studio-qa', { recursive: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => failures.push(error.message));
  await page.evaluateOnNewDocument((authKey, value) => {
    if (!localStorage.getItem(authKey)) localStorage.setItem(authKey, JSON.stringify(value));
    localStorage.setItem('tawazun-lang', 'ar');
    window.__qaAudioContexts = [];
    const Native = window.AudioContext;
    if (Native) window.AudioContext = class extends Native {
      constructor(...args) { super(...args); this.qaGains = []; window.__qaAudioContexts.push(this); }
      createGain() { const gain = super.createGain(); this.qaGains.push(gain); return gain; }
    };
  }, `sb-${project}-auth-token`, session);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const reply = (body, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'OPTIONS') return reply({});
      const auth = request.headers().authorization || '';
      let owner; try { owner = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString()).sub; } catch { return reply({}, 401); }
      if (url.pathname === '/api/research') return reply({ tasks: owner === userId ? tasks.map(({ report: _report, ...entry }) => entry) : [] });
      if (url.pathname.startsWith('/api/research/')) return reply(owner === userId ? tasks.find((entry) => url.pathname.endsWith(entry.id)) || {} : {}, owner === userId ? 200 : 404);
      if (url.pathname === '/api/goals') return reply({ goals: owner === userId ? [{ id: 'goal-1', title: 'Home strength goal' }, { id: 'goal-2', title: 'Learn Spanish' }] : [] });
      if (url.pathname === '/api/chat') { if (request.method() === 'POST') { chats.push(JSON.parse(request.postData())); return reply({ reply: 'Let’s make it practical.' }); } return reply({ messages: [] }); }
      if (url.pathname === '/api/commitments') return reply({ commitments: [] });
      return reply({});
    }
    if (url.hostname.endsWith('supabase.co')) return reply({ user: session.user });
    return request.continue();
  });
  const data = () => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  const tab = async (name) => { await page.click(`#studio-tab-${name}`); await page.waitForSelector(`#studio-panel-${name}`); };
  const shot = async (name, selector = '.living-space') => { await page.$eval(selector, (element) => element.scrollIntoView({ block: 'start' })); await page.screenshot({ path: `data/studio-qa/${name}.png` }); };
  await page.goto('http://127.0.0.1:5175', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.living-space');
  await page.click('.aql-suggestions > summary');
  assert.equal(await page.$$eval('.suggestion-grid article', (items) => items.length), 2);
  await page.click('.suggestion-grid article:first-child button:nth-child(2)');
  assert.equal(await page.$$eval('.suggestion-grid article', (items) => items.length), 1);
  await page.click('.suggestion-grid article:first-child button:last-child');
  assert.equal(await page.$$eval('.suggestion-grid article', (items) => items.length), 0);
  await page.click('.aql-suggestions > button');

  await tab('projects');
  await page.type('[name="project-title"]', 'Learn Spanish');
  await page.type('[name="project-steps"]', 'Read references\nDraft outline');
  await page.click('.project-create .primary-action');
  await page.waitForSelector('.project-card');
  await page.click('.project-steps input');
  assert.equal((await data()).projects[0].steps.filter((step) => step.done).length, 1);
  await page.click('.project-steps li:nth-child(2) input');
  await page.waitForSelector('.project-bloom');
  await page.click('.project-card > .studio-actions button:first-child');
  await shot('projects');

  await tab('desk');
  for (const [title, body] of [['First thought', 'Keep the next step small.'], ['Second thought', 'Review the evidence.']]) {
    await page.type('[name="note-title"]', title); await page.type('[name="note-body"]', body); await page.click('.note-editor .primary-action');
  }
  assert.equal((await data()).notes.length, 2);
  const previousOrder = (await data()).pins;
  await page.click('.desk-note:last-child [aria-label="قدّم العنصر"]');
  assert.notDeepEqual((await data()).pins, previousOrder);
  const keyboardOrder = (await data()).pins;
  await page.evaluate(() => { const cards = [...document.querySelectorAll('.desk-card')]; const transfer = new DataTransfer(); cards.at(-1).querySelector('.desk-grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer })); cards[0].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); });
  assert.notDeepEqual((await data()).pins, keyboardOrder, 'Dragging should change desk order');
  await page.select('#desk-pin', `report:${tasks[0].id}`); await page.click('.desk-pin-form button');
  await page.click('.desk-report .studio-actions button:first-child');
  await page.waitForSelector('dialog[open] .report-reading');
  await page.click('dialog[open] .icon-button');
  await shot('desk');

  await tab('memory');
  await page.type('[name="memory-text"]', 'I prefer short actionable answers.'); await page.click('#studio-panel-memory .primary-action');
  await page.click('.memory-card:first-child .studio-actions button:first-child');
  await page.$eval('[name="memory-text"]', (input) => { input.focus(); input.select(); }); await page.keyboard.press('Backspace');
  await page.type('[name="memory-text"]', 'Use concise practical replies.'); await page.click('#studio-panel-memory .primary-action');
  await page.$$eval('.memory-card', (items) => items.find((item) => item.textContent.includes('تقارير بحث مكتملة')).querySelector('.studio-actions button:last-child').click());
  assert((await data()).hiddenMemories.includes('derived:reports'));
  await shot('memory');
  await page.$$eval('.nav-btn', (items) => items.find((item) => item.title.includes('اتصال')).click());
  await page.waitForSelector('#chat-compose');
  await page.$$eval('.chat-shell button', (buttons) => buttons.find((button) => button.textContent.includes('الصوت:'))?.click());
  await page.type('#chat-compose', 'Help me choose my next step.'); await page.click('.chat-shell form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.chat-shell')?.textContent.includes('Let’s make it practical.'));
  assert(chats[0].memory.includes('Use concise practical replies.'));
  assert(!chats[0].memory.some((entry) => entry.includes('تقارير بحث مكتملة')));
  await page.click('.nav-btn:first-of-type'); await page.waitForSelector('.living-space');

  await tab('ideas'); await page.waitForSelector('.node-goal');
  assert((await page.$$('.idea-line')).length > 0);
  await page.click('.node-research circle'); await page.click('.node-goal circle');
  await page.type('.idea-inspector input', 'A linked strength project'); await page.click('.idea-inspector .primary-action');
  assert.equal((await data()).projects[0].links.length, 2);
  await tab('ideas'); await page.waitForSelector('.node-goal'); await shot('ideas');

  await tab('focus'); await page.type('[name="focus-label"]', 'Read one useful paper');
  const linkedProjectId = (await data()).projects[0].id;
  await page.select('[name="focus-project"]', linkedProjectId);
  await page.click('.focus-start .primary-action'); await page.waitForSelector('.focus-active');
  await page.click('.focus-active .studio-actions .primary-action');
  const paused = (await data()).focus.remaining;
  await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('.phase-paused');
  assert.equal((await data()).focus.remaining, paused);
  await page.click('.focus-active .studio-actions .primary-action');
  await shot('focus');
  await page.click('.focus-active .studio-actions .secondary-action'); await page.waitForSelector('[name="focus-outcome"]');
  await page.type('[name="focus-outcome"]', 'Read two pages and wrote one question.'); await page.click('.focus-active .studio-form .primary-action');
  assert.equal((await data()).sessions.length, 1); assert((await data()).sessions[0].activeSeconds < 1500);
  assert.equal((await data()).sessions[0].projectId, linkedProjectId);
  // Simulate a closed tab returning after its timer expired, without waiting 25 minutes.
  await page.evaluate((storageKey) => { const saved = JSON.parse(localStorage.getItem(storageKey)); saved.focus = { id: 'expired-test', label: 'Expired session', duration: 300, remaining: 300, phase: 'running', deadline: Date.now() - 1 }; localStorage.setItem(storageKey, JSON.stringify(saved)); }, key);
  await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('.phase-review');
  await page.click('.focus-active > .studio-text-button');

  await tab('ambience');
  assert.equal(await page.evaluate(() => window.__qaAudioContexts.length), 0, 'Audio must not autoplay');
  await page.click('.ambient-options button:first-child'); await page.waitForSelector('.ambient-active');
  assert.equal(await page.evaluate(() => window.__qaAudioContexts[0].state), 'running');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aql-voice-state', { detail: 'speaking' })));
  await page.waitForFunction(() => window.__qaAudioContexts[0].qaGains[0].gain.value < .06);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aql-voice-state', { detail: 'listening' })));
  await page.waitForFunction(() => window.__qaAudioContexts[0].qaGains[0].gain.value < .001);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aql-voice-state', { detail: 'idle' })));
  await page.click('.ambient-options button:nth-child(2)'); await page.waitForFunction(() => window.__qaAudioContexts.length === 2);
  assert.equal(await page.evaluate(() => window.__qaAudioContexts[0].state), 'closed');
  await page.click('.studio-light-toggle input');
  assert.notEqual(await page.$eval('.studio-scope', (element) => element.dataset.light), 'off');
  await shot('ambience');
  await page.click('.ambient-controls button');
  await page.waitForFunction(() => window.__qaAudioContexts.at(-1).state === 'closed');
  assert.equal(await page.$('.ambient-active'), null);
  await page.click('.ambient-options button:nth-child(2)'); await page.waitForSelector('.ambient-active');
  await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('#studio-panel-ambience');
  assert.equal(await page.evaluate(() => window.__qaAudioContexts.length), 0, 'Saved audio preference must not autoplay on reload');
  assert.equal((await data()).notes.length, 2); assert.equal((await data()).projects.length, 2);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await tab('desk'); await shot('mobile-desk');
  const mobile = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('.living-space, .studio-panel, .desk-grid, .studio-tabs, .app-content, .work-hub')].map((element) => ({ class: element.className, width: element.getBoundingClientRect().width, left: element.getBoundingClientRect().left, overflow: getComputedStyle(element).overflowX })) }));
  if (mobile.width > mobile.viewport + 1) console.log('MOBILE OVERFLOW', JSON.stringify(mobile));
  assert(mobile.width <= mobile.viewport + 1);
  await page.click('[data-language-switch]'); await page.waitForFunction(() => document.documentElement.lang === 'en');
  await tab('projects'); await shot('mobile-projects-en');
  await page.evaluate((authKey, newUser, newToken) => { const value = JSON.parse(localStorage.getItem(authKey)); value.user.id = newUser; value.access_token = newToken; localStorage.setItem(authKey, JSON.stringify(value)); }, `sb-${project}-auth-token`, otherId, token(otherId));
  await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('.living-space'); await tab('desk');
  assert.equal(await page.$$eval('.desk-card', (items) => items.length), 0, 'Another account must not see notes or pins');
  assert.deepEqual(failures, [], 'Browser runtime errors');
  console.log('PASS: suggestions, growing projects, notes and pins, accessible reorder, report links, editable/deletable memory passed to chat, goal/research map, linked project, focus pause/reload/outcome/expiry, audio gesture/cleanup/ducking/no-autoplay, time lighting, account isolation, mobile and English');
} finally { await browser.close(); }
