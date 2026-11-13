// Explicit smoke test: real AI planning + actual bridge writes in an isolated QA folder.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import assert from 'node:assert/strict';
import { createDevicePlanRouter } from '../device-plan.js';
import { createDeviceBridge } from '../device-bridge.js';

const app = express(); app.use(express.json());
app.use('/api/device', createDevicePlanRouter({ requireAuth: (req, res, next) => next(), generate: async (system, input) => {
  if (!process.env.GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: .2, messages: [{ role: 'system', content: system }, { role: 'user', content: input }] }), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
} }));
const planner = app.listen(0, '127.0.0.1'); await new Promise(resolve => planner.once('listening', resolve));
await fs.mkdir('data/device-qa', { recursive: true });
const root = await fs.mkdtemp(path.resolve('data/device-qa/live-'));
const bridge = await createDeviceBridge({ workspace: root });
const server = bridge.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
try {
  const response = await fetch(`http://127.0.0.1:${planner.address().port}/api/device/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'ar', message: 'أنشئ صفحة عربية بسيطة لمقهى اسمه قهوة عقل، ملف HTML واحد بتنسيق CSS مضمّن، داخل مجلد coffee-demo. لا تضف روابط خارجية أو مكتبات. اكتب قائمة مشروبات وأسعارًا افتراضية مع توضيح أنها مثال.' }) });
  const plan = await response.json(); assert.equal(response.status, 200, JSON.stringify(plan));
  const request = async (route, body) => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await result.json(); assert.equal(result.status, 200, JSON.stringify(value)); return value;
  };
  const preview = await request('preview', plan);
  assert(preview.operations.some(operation => operation.type === 'write_file' && operation.path.endsWith('.html')));
  const outcome = await request('execute', { id: preview.id }); assert.equal(outcome.completed, true);
  await fs.writeFile(path.join(root, 'qa-result.json'), JSON.stringify({ plan, outcome }, null, 2));
  console.log(`PASS: real AI produced ${plan.operations.length} validated operations; preview and local execution completed in ${root}`);
} finally {
  await new Promise(resolve => planner.close(resolve)); await new Promise(resolve => server.close(resolve));
}
