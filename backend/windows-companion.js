import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { validStep } from './companion.js';

export async function performStep(root, step, desktop) {
  if (!validStep(step)) throw Error('خطوة غير مدعومة');
  if (step.location === 'desktop') {
    if (!desktop) throw Error('تعذّر تحديد سطح مكتب ويندوز');
    root = desktop;
  }
  const displayPath = step.location === 'desktop' ? 'سطح المكتب/' + step.path : step.path;
  if (step.type === 'steam' || step.type === 'steam_downloads') {
    if (process.platform !== 'win32') throw Error('يتطلب فتح Steam جهاز ويندوز');
    const exe = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steam.exe');
    await fs.access(exe);
    const args = step.type === 'steam_downloads' ? ['steam://open/downloads'] : [];
    const processHandle = spawn(exe, args, { detached: true, stdio: 'ignore', shell: false });
    await new Promise((resolve, reject) => { processHandle.once('spawn', resolve); processHandle.once('error', reject); });
    processHandle.unref();
    return args.length ? 'أُرسل طلب فتح صفحة التنزيلات إلى Steam' : 'بدأ تشغيل Steam';
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
    return 'تم إنشاء الملف ' + displayPath;
  }
  return 'المجلد جاهز ' + displayPath;
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
  let desktop;
  if (process.platform === 'win32') {
    try {
      const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath('DesktopDirectory')"], { windowsHide: true, timeout: 10000 });
      const knownFolder = stdout.trim();
      if (path.isAbsolute(knownFolder) && (await fs.stat(knownFolder)).isDirectory()) desktop = await fs.realpath(knownFolder);
    } catch { /* Workspace tasks remain available. */ }
  }
  if (desktop) console.log('وجهة سطح المكتب:', desktop);
  console.log('مجلد عمل جارفس:', workspace, '\nتُشارك أسماء العناصر في هذا المجلد مع حساب عقل لتخطيط طلباتك. Ctrl+C لإيقاف الاتصال.');
  async function post(route, body, token) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const reason = await response.json().catch(() => ({}));
      throw Object.assign(Error('الاتصال: ' + response.status), { status: response.status, reason: reason.error });
    }
    return response.json();
  }
  let token;
  try {
    while (!token) {
      const pasted = await terminal.question('ألصق رمز الربط من خدمات الجهاز في عقل: ');
      const code = pasted.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
      if (!/^[A-Za-z0-9_-]{32}$/.test(code)) {
        console.log('انسخ الرمز كاملًا من عقل والصقه وحده.');
        continue;
      }
      try { ({ token } = await post('/claim', { code })); }
      catch (e) {
        if (e.reason !== 'invalid_code') throw e;
        console.log('الرمز غير صالح الآن. أنشئ رمز ربط جديدًا من الجوال والصقه هنا خلال دقيقتين.');
      }
    }
  } finally { terminal.close(); }
  console.log('تم الربط. تقدر تقفل صفحة عقل وتترك هذه النافذة مفتوحة.');
  let report;
  for (;;) {
    try {
      const entries = await listEntries(workspace);
      const task = await post('/tick', { entries, report, desktop: !!desktop }, token);
      report = undefined;
      if (task.step) {
        report = { id: task.id, index: task.index };
        try {
          const result = await performStep(workspace, task.step, desktop);
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
