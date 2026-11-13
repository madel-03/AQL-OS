// Isolated browser QA. API responses are intercepted; no real tasks are created.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

const env = dotenv.parse(await fs.readFile('../frontend/.env', 'utf8'));
const project = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
const userId = '11111111-1111-4111-8111-111111111111';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
const session = { access_token: accessToken, refresh_token: 'qa-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: userId, email: 'noura@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'نورة' } } };
const baseTask = { lang: 'ar', created_at: '2026-11-13T09:00:00Z', updated_at: '2026-11-13T09:02:00Z', sources: [{ id: 1, title: 'دراسة عن تمارين المقاومة', url: 'https://example.org/research' }], queries: ['resistance training'] };
let tasks = [
  { ...baseTask, id: '00000000-0000-4000-8000-000000000001', topic: 'هل تمارين المنزل تبني عضلات فعلًا؟', status: 'reading' },
  { ...baseTask, id: '00000000-0000-4000-8000-000000000002', topic: 'مقارنة خيارات الطاقة الشمسية للمنازل', status: 'completed', report_available: true, report: '# مقارنة خيارات الطاقة الشمسية\n\n## الخلاصة\n\nهذا تقرير تجريبي لفحص الواجهة. [1]\n\n## مقارنة الخيارات\n\n| الخيار | الميزة |\n| --- | --- |\n| الألواح | توليد الكهرباء |\n\n## المصادر\n\n[1] مصدر تجريبي\nhttps://example.org/research' },
  { ...baseTask, id: '00000000-0000-4000-8000-000000000003', topic: 'مراجعة مصادر خطة تعلّم جديدة', status: 'failed', error_code: 'SOURCES_UNREADABLE', error: 'Fewer than two sources could be read.' },
];
const browser = await puppeteer.launch({ headless: true });
await fs.mkdir('data/workspace-qa', { recursive: true });
const failures = []; const posts = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewport({ width: 1440, height: 1150, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((key, value) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('tawazun-lang', 'ar'); }, `sb-${project}-auth-token`, session);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const reply = (body, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'OPTIONS') return reply({});
      if (url.pathname === '/api/research') {
        if (request.method() === 'POST') {
          const body = JSON.parse(request.postData()); posts.push(body);
          const task = { ...baseTask, id: '00000000-0000-4000-8000-000000000004', topic: body.topic, lang: body.lang, status: 'planning', created_at: new Date().toISOString() };
          tasks.unshift(task); return reply({ id: task.id }, 202);
        }
        return reply({ tasks: tasks.map(({ report: _report, ...metadata }) => metadata) });
      }
      if (url.pathname.startsWith('/api/research/')) return reply(tasks.find((task) => url.pathname.endsWith(task.id)) || {});
      if (url.pathname === '/api/chat') return reply({ messages: [] });
      if (url.pathname === '/api/commitments') return reply({ commitments: [] });
      return reply({});
    }
    if (url.hostname.endsWith('supabase.co')) return reply({ user: session.user });
    return request.continue();
  });
  await page.goto('http://127.0.0.1:5175', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.work-card');
  assert.equal(await page.$$eval('.work-card', (cards) => cards.length), 3);
  await page.screenshot({ path: 'data/workspace-qa/desktop-ar.png', fullPage: true });
  await page.click('.tone-done .work-card-footer button');
  await page.waitForSelector('dialog[open] .report-reading');
  assert.equal(await page.$$eval('dialog[open] table', (items) => items.length), 1);
  await page.screenshot({ path: 'data/workspace-qa/preview-ar.png', fullPage: true });
  await page.click('dialog[open] .icon-button');
  await page.click('.library-filters button[aria-pressed="false"]');
  assert.equal(await page.$$eval('.workspace-section:last-child .work-card', (cards) => cards.length), 1);
  await page.click('.library-filters button');
  await page.click('.tone-working .work-card-footer button');
  await page.waitForSelector('dialog[open] .preview-progress');
  // Complete a real-looking active task and verify the live completion feedback.
  tasks[0] = { ...tasks[0], status: 'completed', report_available: true, report: '# تقرير تجريبي\n\nاكتملت المهمة.', updated_at: new Date().toISOString() };
  await page.waitForSelector('.completion-notice', { timeout: 10000 });
  await page.waitForSelector('dialog[open] .report-reading', { timeout: 10000 });
  await page.click('dialog[open] .icon-button');
  await page.screenshot({ path: 'data/workspace-qa/completed-ar.png', fullPage: true });
  await page.click('.completion-notice > .icon-button');
  // The planning shortcut transfers the actual goal into the existing chat composer.
  await page.click('.quick-modes button:nth-child(2)');
  await page.type('#home-task-prompt', 'Learn Spanish in three months');
  await page.click('.launch-button');
  await page.waitForSelector('#chat-compose');
  assert((await page.$eval('#chat-compose', (input) => input.value)).includes('Learn Spanish'));
  await page.click('.nav-btn:first-of-type');
  await page.waitForSelector('#home-task-prompt');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.screenshot({ path: 'data/workspace-qa/mobile-ar.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile layout overflows');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aql-voice-state', { detail: 'listening' })));
  await page.waitForSelector('.state-listening');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aql-voice-state', { detail: 'idle' })));
  const languageButton = await page.$('.page-heading button');
  await languageButton.click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.setViewport({ width: 1440, height: 1150, deviceScaleFactor: 1 });
  await page.screenshot({ path: 'data/workspace-qa/desktop-en.png', fullPage: true });
  await page.type('#home-task-prompt', 'Compare home workouts and gym workouts');
  await page.click('.launch-button');
  await page.waitForFunction(() => !!document.querySelector('dialog[open]'));
  assert.equal(posts.length, 1); assert.equal(posts[0].lang, 'en');
  await page.click('dialog[open] .icon-button');
  // Returning to the app restores its library without replaying old completion notices.
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.work-card');
  assert.equal(await page.$('.completion-notice'), null);
  assert.equal(await page.$$eval('.work-card', (cards) => cards.length), 4);
  tasks = [];
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 0);
  await page.screenshot({ path: 'data/workspace-qa/empty-ar.png', fullPage: true });
  assert.deepEqual(failures, [], 'Browser runtime errors');
  console.log('PASS: library, report preview, filters, live progress to report, completion, planning handoff, mobile RTL, English, voice states, submission, reload, empty states');
} finally { await browser.close(); }
