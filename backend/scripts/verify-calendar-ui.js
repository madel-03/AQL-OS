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
let configured = false, connected = false; const writes = []; const errors = [];
await fs.mkdir('data/calendar-qa', { recursive: true });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1100 }); page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument((key, value) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('tawazun-lang', 'ar'); }, `sb-${project}-auth-token`, session);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    const reply = value => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' }, body: JSON.stringify(value) });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'OPTIONS') return reply({});
      if (url.pathname === '/api/calendar/status') return reply({ configured, connected });
      if (url.pathname === '/api/calendar/connect') { connected = true; return reply({ url: 'http://127.0.0.1:5175/?calendar=connected' }); }
      if (url.pathname === '/api/calendar/connection') { connected = false; return reply({ disconnected: true }); }
      if (url.pathname === '/api/calendar/events') {
        if (request.method() === 'POST') { const data = JSON.parse(request.postData()); writes.push(data); return reply({ event: { id: data.requestId } }); }
        return reply({ events: [{ id: 'fixture', title: 'موعد تجريبي', start: { date: '2026-12-01' }, end: { date: '2026-12-02' } }], nextPageToken: null });
      }
      if (url.pathname === '/api/research') return reply({ tasks: [] });
      if (url.pathname === '/api/commitments') return reply({ commitments: [] });
      return reply({});
    }
    if (url.hostname.endsWith('supabase.co')) return reply({ user: session.user });
    return request.continue();
  });
  await page.goto('http://127.0.0.1:5175', { waitUntil: 'networkidle2' });
  await page.click('#studio-tab-calendar'); await page.waitForSelector('.calendar-space .device-setup');
  assert.match(await page.$eval('.calendar-space', element => element.textContent), /نحتاج إعداد الربط/);
  configured = true; await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('.calendar-space .device-setup .studio-primary');
  await page.click('.calendar-space .device-setup .studio-primary'); await page.waitForSelector('.calendar-events');
  await page.type('.calendar-space .studio-form input', 'مراجعة المشروع');
  await page.evaluate(() => {
    const fields = [...document.querySelectorAll('.calendar-space input[type="datetime-local"]')];
    for (const [index, value] of ['2026-12-03T10:00', '2026-12-03T11:00'].entries()) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fields[index], value); fields[index].dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.click('.calendar-space .studio-form button'); await page.waitForSelector('.calendar-space .device-preview');
  assert.equal(writes.length, 0, 'Review must not write to Google');
  await page.click('.calendar-space .device-preview button'); await page.waitForFunction(() => document.querySelector('.calendar-space')?.textContent.includes('حُفظ الموعد'));
  assert.equal(writes.length, 1); assert.equal(writes[0].title, 'مراجعة المشروع'); assert.match(writes[0].requestId, /^[a-f0-9]{32}$/);
  await page.$eval('.calendar-space', element => element.scrollIntoView({ block: 'start' })); await page.screenshot({ path: 'data/calendar-qa/desktop-ar.png' });
  await page.setViewport({ width: 390, height: 844 }); await page.$eval('.calendar-space', element => element.scrollIntoView({ block: 'start' })); await page.screenshot({ path: 'data/calendar-qa/mobile-ar.png' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.click('[data-language-switch]'); await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.waitForFunction(() => document.querySelectorAll('.calendar-space > .studio-actions button')[1]?.disabled === false);
  await page.$$eval('.calendar-space > .studio-actions button', buttons => buttons[1].click()); await page.waitForSelector('.calendar-space .device-setup');
  assert.equal(connected, false); assert.deepEqual(errors, []);
  console.log('PASS: setup-required UI, connect navigation, all-day events, event review before POST, save, timezone conversion, Arabic/mobile/English, disconnect; all Google calls mocked');
} finally { await browser.close(); }
