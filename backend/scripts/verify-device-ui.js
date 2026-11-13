// Isolated auth/AI fixtures with a REAL local bridge and real files in a QA directory.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createDeviceBridge } from '../device-bridge.js';

const env = dotenv.parse(await fs.readFile('../frontend/.env', 'utf8'));
const project = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
const id = '11111111-1111-4111-8111-111111111111';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = { access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.qa`, refresh_token: 'qa-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id, email: 'device-qa@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {} } };
await fs.mkdir('data/device-qa', { recursive: true });
const root = await fs.mkdtemp(path.resolve('data/device-qa/workspace-'));
await fs.writeFile(path.join(root, 'note.md'), 'Original local note');
const bridge = await createDeviceBridge({ workspace: root, token: 'isolated-qa-device-key', origins: ['http://127.0.0.1:5175'] });
const server = bridge.app.listen(47831, '127.0.0.1'); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage(); const errors = []; const plans = [];
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument((key, value) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('tawazun-lang', 'ar'); }, `sb-${project}-auth-token`, session);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    const reply = body => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'OPTIONS') return reply({});
      if (url.pathname === '/api/device/plan') {
        const body = JSON.parse(request.postData()); plans.push(body);
        if (body.attachment) return reply({ summary: 'Update the selected note', operations: [{ type: 'write_file', path: body.attachment.path, content: 'Updated after review' }] });
        return reply({ summary: 'Build a new local project', operations: [{ type: 'write_file', path: 'demo/index.html', content: '<!doctype html><html lang="ar"><h1>مشروعي الأول</h1></html>' }, { type: 'write_file', path: 'demo/app.js', content: 'const hello = "AQL";\nconsole.log(hello);' }, { type: 'check_javascript', path: 'demo/app.js' }] });
      }
      if (url.pathname === '/api/research') return reply({ tasks: [] });
      if (url.pathname === '/api/commitments') return reply({ commitments: [] });
      return reply({});
    }
    if (url.hostname.endsWith('supabase.co')) return reply({ user: session.user });
    return request.continue();
  });
  await page.goto('http://127.0.0.1:5175', { waitUntil: 'networkidle2' });
  await page.click('#studio-tab-device'); await page.waitForSelector('.device-setup');
  await page.type('.device-setup input', 'isolated-qa-device-key'); await page.click('.device-setup button');
  await page.waitForSelector('.device-connected');
  await page.type('.device-grid textarea', 'Build a local landing page'); await page.click('.device-grid form button');
  await page.waitForSelector('.device-preview');
  await assert.rejects(fs.access(path.join(root, 'demo/index.html')), 'Preparing a plan must never execute it');
  assert.equal(JSON.stringify(plans[0]).includes('isolated-qa-device-key'), false);
  assert.equal(JSON.stringify(plans[0]).includes(root), false);
  assert.equal(plans[0].attachment, undefined);
  await page.$eval('.device-preview', element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'data/device-qa/review-ar.png' });
  await page.click('.device-preview .studio-primary'); await page.waitForSelector('.device-results');
  assert.match(await fs.readFile(path.join(root, 'demo/index.html'), 'utf8'), /مشروعي الأول/);
  assert.equal(await page.$$eval('.device-results strong', elements => elements.length), 3);
  await page.$$eval('.device-files button', buttons => buttons.find(button => button.textContent.includes('note.md')).click());
  await page.waitForSelector('.device-consent');
  assert.match(await page.$eval('.device-grid .device-code pre', element => element.textContent), /Original local note/);
  await page.click('.device-consent input');
  await page.$eval('.device-grid textarea', element => { element.focus(); element.select(); }); await page.keyboard.type('Update this note');
  await page.click('.device-grid form button'); await page.waitForSelector('.device-preview');
  assert.equal(plans[1].attachment.content, 'Original local note');
  assert.match(await page.$eval('.device-preview', element => element.textContent), /Original local note/);
  await page.click('.device-preview .studio-primary');
  await page.waitForFunction(() => document.querySelector('.device-results')?.textContent.includes('اكتملت المهمة'));
  assert.equal(await fs.readFile(path.join(root, 'note.md'), 'utf8'), 'Updated after review');
  await page.setViewport({ width: 390, height: 844 });
  await page.$eval('.device-space', element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'data/device-qa/mobile-ar.png' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile should not overflow');
  await page.click('[data-language-switch]'); await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.$eval('.device-space', element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'data/device-qa/mobile-en.png' });
  await page.click('.device-connected button'); await page.waitForSelector('.device-setup');
  assert.equal(await page.$eval('.device-setup input', element => element.value), '');
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('isolated-qa-device-key')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: real device connection, review without writes, actual project creation and syntax check, explicit selected-file sharing, overwrite review and backup, no cloud key/root leakage, disconnect, Arabic/English mobile layout');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  // Keep isolated QA outputs and screenshots under ignored data/device-qa for review.
}
