import express from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateDevicePlan } from './device-plan.js';

const executeFile = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const TEXT = new Set(['.txt', '.md', '.json', '.html', '.css', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.csv', '.svg', '.yml', '.yaml']);
const BLOCKED = /^(node_modules|dist|build|vendor|coverage|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|desktop\.ini|thumbs\.db)$/i;

export async function createDeviceBridge({ workspace, token = randomBytes(32).toString('hex'), origins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5175', 'https://aql-os-orcin.vercel.app'] }) {
  const root = await fs.realpath(workspace);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Workspace must be a directory');
  const app = express(); const plans = new Map(); const history = [];
  const addLog = entry => { history.unshift({ at: new Date().toISOString(), ...entry }); history.splice(100); };
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  function partsFor(relative, allowRoot = false) {
    if (typeof relative !== 'string' || relative.length > 240 || /[\\:\x00-\x1f]/.test(relative) || path.isAbsolute(relative)) throw fail('Use a relative path with / separators');
    if (!relative && allowRoot) return [];
    const parts = relative.split('/');
    if (parts.some(part => !part || part.startsWith('.') || /[<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) || BLOCKED.test(part))) throw fail('This path is outside the allowed workspace files');
    return parts;
  }
  async function resolve(relative, { allowRoot = false, missing = false } = {}) {
    const parts = partsFor(relative, allowRoot);
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      try {
        const info = await fs.lstat(current);
        if (info.isSymbolicLink() || (!info.isDirectory() && info.nlink > 1)) throw fail('Linked files and folders are not allowed');
        const real = await fs.realpath(current);
        const rel = path.relative(root, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail('Path escaped the workspace');
        if (index < parts.length - 1 && !info.isDirectory()) throw fail('A parent path is not a folder');
      } catch (error) { if (!(missing && error.code === 'ENOENT')) throw error; }
    }
    return current;
  }
  async function snapshot(relative) {
    const filename = await resolve(relative, { missing: true });
    try {
      const info = await fs.stat(filename);
      if (!info.isFile() || info.size > 180000 || !TEXT.has(path.extname(filename).toLowerCase())) throw fail('Only text files up to 180 KB can be changed');
      const bytes = await fs.readFile(filename);
      if (bytes.includes(0)) throw fail('Binary files are not supported');
      return { before: bytes.toString('utf8'), version: hash(bytes), exists: true };
    } catch (error) { if (error.code === 'ENOENT') return { before: '', version: null, exists: false }; throw error; }
  }
  app.use((req, res, next) => {
    // Host check blocks DNS rebinding even when the client omits Origin.
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) return res.status(403).json({ error: 'Loopback host required' });
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: 'Website origin is not allowed' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    const provided = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return res.status(401).json({ error: 'Invalid device key' });
    next();
  });
  app.use(express.json({ limit: '400kb' }));
  app.get('/status', (req, res) => res.json({ name: 'AQL Device Bridge', version: 1, workspace: root, capabilities: ['list', 'read', 'write_file', 'make_directory', 'check_javascript'], history }));
  app.post('/list', async (req, res, next) => {
    try {
      const relative = req.body.path || '';
      const folder = await resolve(relative, { allowRoot: true });
      const entries = [];
      for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        try { await resolve(name); } catch { continue; }
        if (entry.isDirectory() || (entry.isFile() && TEXT.has(path.extname(entry.name).toLowerCase()))) entries.push({ name: entry.name, path: name, kind: entry.isDirectory() ? 'directory' : 'file' });
        if (entries.length >= 150) break;
      }
      res.json({ path: relative, entries });
    } catch (error) { next(error); }
  });
  app.post('/read', async (req, res, next) => {
    try {
      const value = await snapshot(req.body.path);
      if (!value.exists) throw fail('File does not exist', 404);
      addLog({ type: 'read', path: req.body.path, status: 'completed' });
      res.json({ path: req.body.path, content: value.before });
    } catch (error) { next(error); }
  });
  app.post('/preview', async (req, res, next) => {
    try {
      const plan = validateDevicePlan(req.body);
      const seen = new Set(); const operations = [];
      for (const operation of plan.operations) {
        await resolve(operation.path, { missing: true });
        if (operation.type === 'write_file') {
          if (!TEXT.has(path.extname(operation.path).toLowerCase())) throw fail('Unsupported file extension');
          if (seen.has(operation.path.toLowerCase())) throw fail('A file can only be written once in a plan');
          seen.add(operation.path.toLowerCase());
          operations.push({ ...operation, ...await snapshot(operation.path) });
        } else {
          if (operation.type === 'check_javascript' && !/\.(mjs|cjs|js)$/i.test(operation.path)) throw fail('Syntax checks support .js, .mjs and .cjs');
          operations.push(operation);
        }
      }
      const id = randomBytes(24).toString('hex'); const expires = Date.now() + 10 * 60000;
      for (const [key, saved] of plans) if (saved.expires < Date.now()) plans.delete(key);
      if (plans.size >= 20) plans.delete(plans.keys().next().value);
      plans.set(id, { summary: plan.summary, operations, expires });
      res.json({ id, summary: plan.summary, operations, expires });
    } catch (error) { next(error); }
  });
  // Serialize writes; preview IDs are single-use even if a request is retried.
  let busy = false;
  app.post('/execute', async (req, res, next) => {
    if (busy) return res.status(409).json({ error: 'Another device task is running' });
    const plan = plans.get(req.body.id);
    if (!plan || plan.expires < Date.now()) return res.status(409).json({ error: 'Plan expired or already used. Preview it again.' });
    plans.delete(req.body.id); busy = true;
    const results = [];
    try {
      // Verify all overwrite versions before the first operation.
      for (const operation of plan.operations.filter(item => item.type === 'write_file')) {
        if ((await snapshot(operation.path)).version !== operation.version) throw fail(`File changed since preview: ${operation.path}`, 409);
      }
      for (const operation of plan.operations) {
        try {
          const filename = await resolve(operation.path, { missing: operation.type !== 'check_javascript' });
          if (operation.type === 'make_directory') await fs.mkdir(filename, { recursive: true });
          if (operation.type === 'write_file') {
            await fs.mkdir(path.dirname(filename), { recursive: true });
            await resolve(operation.path, { missing: true });
            if ((await snapshot(operation.path)).version !== operation.version) throw fail('File changed during execution');
            // Create exclusively; updates keep a local backup under the private bridge directory.
            if (operation.exists) {
              const backupFolder = path.join(root, '.aql-backups');
              try { if ((await fs.lstat(backupFolder)).isSymbolicLink()) throw fail('Invalid backup folder'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
              await fs.mkdir(backupFolder, { recursive: true });
              await fs.writeFile(path.join(backupFolder, `${Date.now()}-${randomBytes(6).toString('hex')}.json`), JSON.stringify({ path: operation.path, content: operation.before }), { flag: 'wx' });
            }
            await fs.writeFile(filename, operation.content, { encoding: 'utf8', flag: operation.exists ? 'w' : 'wx' });
          }
          let output = 'Completed';
          if (operation.type === 'check_javascript') {
            await snapshot(operation.path);
            const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
            const checked = await executeFile(process.execPath, ['--check', filename], { cwd: root, env, timeout: 10000, maxBuffer: 32000, windowsHide: true, shell: false });
            output = checked.stdout || checked.stderr || 'JavaScript syntax is valid (code was not executed)';
          }
          const result = { type: operation.type, path: operation.path, status: 'completed', output };
          results.push(result); addLog(result);
        } catch (error) {
          const result = { type: operation.type, path: operation.path, status: 'failed', output: String(error.stderr || error.message).slice(0, 4000) };
          results.push(result); addLog(result); break;
        }
      }
      res.json({ summary: plan.summary, results, completed: results.length === plan.operations.length && results.every(result => result.status === 'completed') });
    } catch (error) { next(error); } finally { busy = false; }
  });
  app.use((error, req, res, next) => { void next; res.status(error.status || 400).json({ error: error.code === 'ENOENT' ? 'Path does not exist' : error.message }); });
  return { app, token, workspace: root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = key => args[args.indexOf(key) + 1];
  if (!args.includes('--workspace') || !option('--workspace')) {
    console.error('Usage: npm run device -- --workspace "C:\\path\\to\\work-folder" [--origin https://your-site.example]');
    process.exitCode = 1;
  } else {
    try {
      const extra = args.includes('--origin') ? [new URL(option('--origin')).origin] : [];
      const bridge = await createDeviceBridge({ workspace: option('--workspace'), ...(extra.length ? { origins: extra } : {}) });
      const port = 47831;
      const server = bridge.app.listen(port, '127.0.0.1', () => {
        console.log(`AQL device bridge: http://127.0.0.1:${port}\nWorkspace: ${bridge.workspace}\nDevice key (paste into AQL, never share):\n${bridge.token}\nStop with Ctrl+C. Key expires when the bridge stops.`);
      });
      server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
