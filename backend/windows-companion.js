import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { validStep } from './companion.js';

export async function performStep(root, step) {
  if (!validStep(step)) throw Error('خطوة غير مدعومة');
  if (step.type === 'steam') {
    if (process.platform !== 'win32') throw Error('يتطلب فتح Steam جهاز ويندوز');
    const exe = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steam.exe');
    await fs.access(exe);
    const processHandle = spawn(exe, [], { detached: true, stdio: 'ignore', shell: false });
    await new Promise((resolve, reject) => { processHandle.once('spawn', resolve); processHandle.once('error', reject); });
    processHandle.unref();
    return 'بدأ تشغيل Steam';
  }
  const parts = step.path.split('/');
  const filename = step.type === 'note' ? parts.pop() : null;
  let dir = root;
  for (const part of parts) {
    dir = path.join(dir, part);
    if (step.type !== 'inspect') {
      try { await fs.mkdir(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    const info = await fs.lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink() || path.relative(root, await fs.realpath(dir)).split(path.sep).includes('..')) throw Error('المسار خارج مجلد العمل');
  }
  if (step.type === 'inspect') {
    const entries = await listEntries(dir);
    return { entries, message: 'تم فحص أسماء العناصر داخل ' + step.path };
  }
  if (filename) {
    await fs.writeFile(path.join(dir, filename), step.content, { flag: 'wx', encoding: 'utf8' });
    return 'تم إنشاء الملف ' + step.path;
  }
  return 'المجلد جاهز ' + step.path;
}

async function listEntries(dir) {
  return (await fs.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.') && (e.isDirectory() || /\.(txt|md)$/i.test(e.name))).slice(0, 80).map(e => e.name);
}

async function main() {
  const base = (process.env.AQL_COMPANION_API || 'https://aql-os.onrender.com') + '/api/device/companion';
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const root = path.join(process.env.USERPROFILE || process.cwd(), 'AQL-Workspace');
  await fs.mkdir(root, { recursive: true });
  const workspace = await fs.realpath(root);
  console.log('مجلد عمل جارفس:', workspace, '\nتُشارك أسماء العناصر في هذا المجلد مع حساب عقل لتخطيط طلباتك. Ctrl+C لإيقاف الاتصال.');
  let code;
  try { code = (await terminal.question('ألصق رمز الربط من خدمات الجهاز في عقل: ')).trim(); }
  finally { terminal.close(); }
  async function post(route, body, token) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(Error('الاتصال: ' + response.status), { status: response.status });
    return response.json();
  }
  const { token } = await post('/claim', { code });
  console.log('تم الربط. تقدر تقفل صفحة عقل وتترك هذه النافذة مفتوحة.');
  let report;
  for (;;) {
    try {
      const entries = await listEntries(workspace);
      const task = await post('/tick', { entries, report }, token);
      report = undefined;
      if (task.step) {
        report = { id: task.id, index: task.index };
        try {
          const result = await performStep(workspace, task.step);
          if (typeof result === 'string') report.message = result;
          else Object.assign(report, result);
          report.ok = true;
        }
        catch (e) { report.ok = false; report.message = e.code === 'EEXIST' ? 'الملف موجود بالفعل: ' + task.step.path : 'تعذّر التنفيذ: ' + (e.code || e.message); }
        console.log(report.message);
        continue;
      }
    } catch (e) { if (e.status === 403) throw Error('انتهى الربط. اربط الجهاز مجددًا.'); }
    await delay(2500);
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(e => { console.error(e.message); process.exitCode = 1; });
