import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
export const PROCESS_TYPES = new Set(['run_node', 'npm_install', 'npm_script']);

// Do not forward backend keys, user Node options or npm credentials into generated programs.
export function deviceEnvironment() {
  const allowed = /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|lang|lc_all|systemdrive)$/i;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || env.Path || ''}`;
  // Windows environment names are case-insensitive; pass only a single PATH spelling.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path' && key !== 'PATH') delete env[key];
  env.NO_COLOR = '1'; env.FORCE_COLOR = '0'; env.CI = '1';
  return env;
}

export async function findNpmCli() {
  const nodeDirectory = path.dirname(await fs.realpath(process.execPath));
  const candidates = [path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'), path.resolve(nodeDirectory, '../share/nodejs/npm/bin/npm-cli.js')];
  for (const filename of candidates) { try { if ((await fs.stat(filename)).isFile()) return filename; } catch { /* next trusted installation path */ } }
  throw new Error('npm CLI was not found beside Node. Install Node with npm, then restart the bridge.');
}

export function createProcessJobs({ maxJobs = 2, timeoutMs = 15 * 60000, outputLimit = 100000, onFinish = () => {} } = {}) {
  const jobs = new Map();
  const publicJob = job => ({ id: job.id, summary: job.summary, status: job.status, startedAt: job.startedAt, endedAt: job.endedAt, output: job.output, truncated: job.truncated, steps: job.steps, exitCode: job.exitCode });
  const append = (job, chunk) => {
    job.output += String(chunk).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
    if (job.output.length > outputLimit) { job.output = job.output.slice(-outputLimit); job.truncated = true; }
  };
  async function kill(job) {
    const child = job.child;
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      try { await executeFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }); }
      catch { child.kill(); }
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  }
  function start(summary, tasks) {
    if ([...jobs.values()].filter(job => job.status === 'running' || job.status === 'stopping').length >= maxJobs) throw new Error('Stop a running job before starting another (maximum 2).');
    if (jobs.size >= 30) { const old = [...jobs.values()].find(job => !['running', 'stopping'].includes(job.status)); if (old) jobs.delete(old.id); }
    const job = { id: randomBytes(16).toString('hex'), summary, startedAt: new Date().toISOString(), status: 'running', output: '', truncated: false, steps: tasks.map(task => ({ type: task.type, path: task.path, command: task.command, status: 'queued' })), child: null, cancelled: false, timedOut: false, exitCode: null };
    jobs.set(job.id, job);
    const timer = setTimeout(() => { job.timedOut = true; job.cancelled = true; job.status = 'stopping'; void kill(job); }, timeoutMs);
    job.done = (async () => {
      try {
        for (let index = 0; index < tasks.length; index++) {
          if (job.cancelled) break;
          const task = tasks[index]; const step = job.steps[index];
          step.status = 'running'; append(job, `\n> ${task.command}\n`);
          let spec;
          try {
            spec = await task.prepare();
            if (job.cancelled) { step.status = 'cancelled'; break; }
            const exit = await new Promise((resolve, reject) => {
              const child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: deviceEnvironment(), shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
              job.child = child;
              child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
              child.stdout.on('data', chunk => append(job, chunk)); child.stderr.on('data', chunk => append(job, chunk));
              child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
            });
            job.child = null; job.exitCode = exit.code;
            if (job.cancelled) { step.status = 'cancelled'; break; }
            if (exit.code !== 0) throw new Error(`Process exited with code ${exit.code ?? exit.signal}`);
            step.status = 'completed';
          } catch (error) { step.status = job.cancelled ? 'cancelled' : 'failed'; append(job, `\n${error.message}\n`); if (!job.cancelled) throw error; break; }
          finally { try { await spec?.cleanup?.(); } catch { /* temporary npm config may be locked by Windows */ } }
        }
        job.status = job.timedOut ? 'timed_out' : job.cancelled ? 'stopped' : 'completed';
      } catch { job.status = 'failed'; }
      finally {
        clearTimeout(timer); job.child = null;
        for (const step of job.steps) if (step.status === 'queued') step.status = 'skipped';
        job.endedAt = new Date().toISOString(); onFinish(publicJob(job));
      }
    })();
    return publicJob(job);
  }
  return {
    start,
    list: () => [...jobs.values()].reverse().map(publicJob),
    async stop(id) { const job = jobs.get(id); if (!job) throw new Error('Job not found'); if (['running', 'stopping'].includes(job.status)) { job.cancelled = true; job.status = 'stopping'; await kill(job); } return publicJob(job); },
    async close() { for (const job of jobs.values()) if (['running', 'stopping'].includes(job.status)) { job.cancelled = true; job.status = 'stopping'; await kill(job); } await Promise.all([...jobs.values()].map(job => job.done)); },
  };
}

export async function npmInvocation(type, cwd, script) {
  const cli = await findNpmCli();
  // Empty user/global config prevents forwarding npm authentication from the bridge account.
  const configFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'aql-npm-config-'));
  const config = path.join(configFolder, 'user.npmrc'); const globalConfig = path.join(configFolder, 'global.npmrc');
  await fs.writeFile(config, ''); await fs.writeFile(globalConfig, '');
  const args = [cli, ...(type === 'npm_install' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'] : ['run', script, '--ignore-scripts']), `--userconfig=${config}`, `--globalconfig=${globalConfig}`, '--workspaces=false'];
  return { file: process.execPath, args, cwd, cleanup: () => fs.rm(configFolder, { recursive: true, force: true }) };
}
