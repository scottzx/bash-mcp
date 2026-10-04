import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { methods } from './contracts.mjs';
import { result, errorResult, parseOutput } from './result.mjs';

export const VERSION = createRequire(import.meta.url)('../package.json').version;
export const UPSTREAM_VERSION = '0.8.2';
export { methods, errorResult };

function integer(value, fallback, min, max, name) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}
function str(value, name, { empty = false } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || (!empty && !value.trim())) throw new Error(`${name} must be a ${empty ? '' : 'non-empty '}string without NUL bytes.`);
  return value;
}
function killGroup(pid, signal = 'SIGKILL') {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try { process.kill(-pid, signal); return null; }
  catch (error) { return error.code === 'ESRCH' ? null : `${error.code}: ${error.message}`; }
}
function valueOf(field) { return field?.text ?? (field?.bytes ? `[base64:${field.bytes}]` : ''); }

export class BashBridge {
  constructor({ cwd = process.cwd(), shell = '/bin/bash', rg = 'rg', maxConcurrent = 4, maxJobs = 100, retentionMs = 600000 } = {}) {
    this.cwd = path.resolve(cwd);
    this.shell = shell;
    this.rg = rg;
    this.maxConcurrent = integer(maxConcurrent, 4, 1, 32, 'maxConcurrent');
    this.maxJobs = integer(maxJobs, 100, this.maxConcurrent, 1000, 'maxJobs');
    this.retentionMs = integer(retentionMs, 600000, 1, 86400000, 'retentionMs');
    this.jobs = new Map();
    this.closed = false;
    this.ready = false;
  }
  get methods() { return methods; }
  async start() {
    if (this.closed) throw new Error('Bash bridge is closed.');
    if (process.platform === 'win32') throw new Error('This release requires macOS/Linux and Bash. Use WSL on Windows.');
    if (!(await fs.stat(this.cwd)).isDirectory()) throw new Error(`Not a directory: ${this.cwd}`);
    await fs.access(this.shell, fs.constants.X_OK);
    this.ready = true;
  }
  reap() {
    const now = Date.now();
    for (const [id, job] of this.jobs) if (job.finishedAt && now - job.finishedAt >= this.retentionMs) this.jobs.delete(id);
  }
  async directory(value) {
    const cwd = value === undefined ? this.cwd : path.resolve(this.cwd, str(value, 'cwd'));
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
    return cwd;
  }
  validate(params, method) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be an object.');
    for (const key of Object.keys(params)) if (!Object.hasOwn(methods[method].parameters.properties, key)) throw new Error(`Unknown parameter: ${key}`);
    for (const key of methods[method].parameters.required) if (!(key in params)) throw new Error(`Missing parameter: ${key}`);
  }
  async invoke(method, params = {}) {
    try {
      if (!Object.hasOwn(methods, method)) return errorResult(`Unknown method: ${method}`, 'UNKNOWN_METHOD');
      this.validate(params, method);
      if (this.closed) return errorResult('Service is shutting down.', 'SERVICE_CLOSED');
      this.reap();
      if (!this.ready) await this.start();
      switch (method) {
        case 'bash.exec': return await this.execute(params);
        case 'bash.search': return await this.search(params);
        case 'bash.job_get': return await this.getJob(params);
        case 'bash.job_cancel': return await this.cancel(params.job_id);
        case 'bash.jobs': return result({ success: true, jobs: [...this.jobs.values()].map((job) => this.summary(job)) });
        case 'bash.info': return result({ success: true, version: VERSION, upstream: 'mcp-server-commands', upstream_version: UPSTREAM_VERSION,
          platform: os.platform(), arch: os.arch(), cwd: this.cwd, shell: this.shell,
          search: { executable: this.rg, available: await this.hasRg() },
          limits: { max_concurrent: this.maxConcurrent, max_jobs: this.maxJobs, retention_ms: this.retentionMs, max_timeout_ms: 300000 },
          execution_isolation: 'host permissions; worker heap limits are resource protection, not an OS sandbox',
        });
      }
    } catch (error) { return errorResult(error); }
  }
  async hasRg() {
    const dirs = path.isAbsolute(this.rg) ? [''] : (process.env.PATH ?? '').split(path.delimiter);
    for (const dir of dirs) {
      try { await fs.access(path.isAbsolute(this.rg) ? this.rg : path.join(dir, this.rg), fs.constants.X_OK); return true; } catch {}
    }
    return false;
  }
  async execute(p) {
    if ((p.command !== undefined) === (p.argv !== undefined)) throw new Error('Supply exactly one of command or argv.');
    let argv;
    if (p.command !== undefined) argv = [this.shell, '--noprofile', '--norc', '-c', str(p.command, 'command')];
    else {
      if (!Array.isArray(p.argv) || p.argv.length < 1 || p.argv.length > 256) throw new Error('argv must contain 1–256 strings.');
      argv = p.argv.map((item, i) => str(item, `argv[${i}]`, { empty: i > 0 }));
    }
    const format = p.output_format ?? 'auto';
    if (!['auto', 'text', 'json', 'jsonl'].includes(format)) throw new Error('Invalid output_format.');
    return this.launch({ argv, cwd: await this.directory(p.cwd), stdin: p.stdin === undefined ? undefined : str(p.stdin, 'stdin', { empty: true }),
      timeout_ms: integer(p.timeout_ms, 30000, 1, 300000, 'timeout_ms'),
      max_output_bytes: integer(p.max_output_bytes, 65536, 1024, 1048576, 'max_output_bytes'),
    }, { kind: 'exec', command: p.command, argv: p.argv, output_format: format }, integer(p.wait_ms, 800, 0, 1000, 'wait_ms'));
  }
  async search(p) {
    str(p.pattern, 'pattern');
    for (const flag of ['regex', 'ignore_case', 'hidden']) if (p[flag] !== undefined && typeof p[flag] !== 'boolean') throw new Error(`${flag} must be boolean.`);
    const maxMatches = integer(p.max_matches, 100, 1, 1000, 'max_matches');
    const target = path.resolve(this.cwd, p.path === undefined ? '.' : str(p.path, 'path'));
    await fs.stat(target);
    const argv = [this.rg, '--json', '--color', 'never', '--max-count', String(maxMatches)];
    if (!p.regex) argv.push('--fixed-strings');
    if (p.ignore_case) argv.push('--ignore-case');
    if (p.hidden) argv.push('--hidden');
    if (p.glob !== undefined) {
      if (!Array.isArray(p.glob) || p.glob.length > 32) throw new Error('glob must be an array of at most 32 strings.');
      for (const glob of p.glob) argv.push('--glob', str(glob, 'glob'));
    }
    argv.push('--', p.pattern, target);
    return this.launch({ argv, cwd: this.cwd, timeout_ms: integer(p.timeout_ms, 10000, 1, 300000, 'timeout_ms'), max_output_bytes: 1048576 },
      { kind: 'search', pattern: p.pattern, path: target, max_matches: maxMatches }, integer(p.wait_ms, 800, 0, 1000, 'wait_ms'));
  }
  async launch(input, details, waitMs) {
    // No await between admission and insertion: concurrent requests cannot exceed limits.
    const running = [...this.jobs.values()].filter((job) => !job.finishedAt).length;
    if (running >= this.maxConcurrent) return errorResult('Concurrent execution limit reached; poll existing jobs first.', 'BUSY');
    if (this.jobs.size >= this.maxJobs) return errorResult('Job retention capacity reached; retry after completed jobs expire.', 'JOB_CAPACITY');
    const job = { id: randomUUID(), state: 'running', startedAt: Date.now(), cwd: input.cwd, details, pid: null, worker: null, finishedAt: null, output: null, reason: null };
    job.done = new Promise((resolve) => { job.resolve = resolve; });
    job.started = new Promise((resolve) => { job.resolveStarted = resolve; });
    this.jobs.set(job.id, job);
    const env = { ...process.env };
    for (const key of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'JEST_WORKER_ID']) delete env[key];
    const worker = new Worker(new URL('./runner-worker.mjs', import.meta.url), {
      workerData: input, env, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
    });
    job.worker = worker;
    worker.on('message', (message) => {
      if (message.type === 'started') {
        job.pid = message.pid;
        job.resolveStarted();
        if (job.finishedAt) { killGroup(job.pid); return; }
        if (job.reason) this.terminate(job, job.reason);
        else job.timer = setTimeout(() => this.terminate(job, 'timed_out'), input.timeout_ms);
      } else if (message.type === 'result') this.finish(job, message.data);
      else if (message.type === 'error') this.finish(job, { success: false, error: message.error, code: 'RUNNER_ERROR' });
    });
    worker.on('error', (error) => {
      job.cleanupError = killGroup(job.pid);
      this.finish(job, { success: false, code: error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'OUTPUT_RESOURCE_LIMIT' : 'RUNNER_ERROR', error: error.message });
    });
    worker.on('exit', (code) => {
      if (!job.finishedAt) { job.cleanupError = killGroup(job.pid); this.finish(job, { success: false, code: 'RUNNER_EXIT', error: `Runner exited with code ${code}.` }); }
    });
    // Bound worker startup and pipe-close failure as well as actual command time.
    job.watchdog = setTimeout(() => {
      this.terminate(job, job.reason ?? 'timed_out');
      void worker.terminate();
      this.finish(job, { success: false, code: 'RUNNER_DEADLINE', error: 'Runner deadline exceeded.' });
    }, input.timeout_ms + 4000);
    return this.wait(job, waitMs);
  }
  terminate(job, reason) {
    if (job.finishedAt) return;
    job.reason = reason;
    if (job.pid) {
      job.cleanupError = killGroup(job.pid, 'SIGTERM');
      // Do not cancel escalation merely because the group leader exits: its
      // descendants may keep running or keep stdout/stderr open.
      if (!job.killTimer) job.killTimer = setTimeout(() => {
        job.killTimer = null;
        job.cleanupError = killGroup(job.pid);
        if (job.output && job.cleanupError) job.output.cleanup_error = job.cleanupError;
      }, 300);
    }
  }
  finish(job, data) {
    if (job.finishedAt) return;
    clearTimeout(job.timer);
    clearTimeout(job.watchdog);
    job.finishedAt = Date.now();
    job.state = job.reason ?? 'completed';
    let output = { ...data, success: Boolean(data.success) && !job.reason, timed_out: job.reason === 'timed_out', cancelled: job.reason === 'cancelled',
      ...(job.cleanupError ? { cleanup_error: job.cleanupError } : {}),
    };
    if (job.reason) output.code = job.reason === 'timed_out' ? 'COMMAND_TIMEOUT' : 'CANCELLED';
    if (job.details.kind === 'exec' && typeof output.stdout === 'string') {
      output = { ...output, ...parseOutput(output.stdout, job.details.output_format, output.stdout_truncated) };
      if (output.parse_error) { output.success = false; output.code ??= 'INVALID_OUTPUT'; }
    }
    if (job.details.kind === 'search') output = this.searchOutput(job, output);
    job.output = output;
    job.resolveStarted();
    job.resolve();
  }
  searchOutput(job, output) {
    const matches = [];
    let incomplete = false;
    const lines = (output.stdout ?? '').split('\n');
    if (output.stdout_truncated && lines.at(-1)) { lines.pop(); incomplete = true; }
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { incomplete = true; continue; }
      if (event.type !== 'match') continue;
      if (matches.length >= job.details.max_matches) { incomplete = true; continue; }
      matches.push({ path: valueOf(event.data.path), path_data: event.data.path,
        line_number: event.data.line_number, text: valueOf(event.data.lines), text_data: event.data.lines,
        submatches: event.data.submatches.map((match) => ({ start: match.start, end: match.end, text: valueOf(match.match), match_data: match.match })) });
    }
    // rg exit 1 means no matches; exit 2 is a search error, never an empty success.
    const success = !output.timed_out && !output.cancelled && [0, 1].includes(output.exit_code);
    const { stdout, ...rest } = output;
    return { ...rest, success, matches, count: matches.length,
      truncated: Boolean(output.truncated || incomplete || matches.length === job.details.max_matches),
      ...(output.error?.includes('ENOENT') ? { code: 'RIPGREP_NOT_FOUND' } : {}),
    };
  }
  summary(job) {
    return { job_id: job.id, status: job.state, pid: job.pid, cwd: job.cwd, kind: job.details.kind,
      started_at: new Date(job.startedAt).toISOString(), finished_at: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      duration_ms: (job.finishedAt ?? Date.now()) - job.startedAt };
  }
  async wait(job, waitMs) {
    if (!job.finishedAt && waitMs > 0) {
      let timer;
      try { await Promise.race([job.done, new Promise((resolve) => { timer = setTimeout(resolve, waitMs); })]); }
      finally { clearTimeout(timer); }
    }
    return result({ success: job.output?.success ?? true, ...this.summary(job), ...(job.output ?? {}),
      ...(job.finishedAt ? {} : { next_method: 'bash.job_get', next_params: { job_id: job.id, wait_ms: 1000 } }),
    });
  }
  async getJob(p) {
    const job = this.jobs.get(str(p.job_id, 'job_id'));
    if (!job) return errorResult('Job not found or expired; service restart clears jobs.', 'JOB_NOT_FOUND');
    return this.wait(job, integer(p.wait_ms, 0, 0, 1000, 'wait_ms'));
  }
  async cancel(id) {
    const job = this.jobs.get(str(id, 'job_id'));
    if (!job) return errorResult('Job not found or expired.', 'JOB_NOT_FOUND');
    this.terminate(job, 'cancelled');
    return this.wait(job, 1000);
  }
  async close() {
    this.closed = true;
    this.ready = false;
    // Allow a starting worker to report its child PID before termination. Its
    // message handler observes cancellation and immediately kills that group.
    const pending = [];
    for (const job of this.jobs.values()) {
      if (!job.finishedAt) { job.reason = 'cancelled'; pending.push(job.started); }
    }
    let startupTimer;
    try { await Promise.race([Promise.allSettled(pending), new Promise((resolve) => { startupTimer = setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(startupTimer); }
    const draining = [];
    for (const job of this.jobs.values()) {
      const escalating = Boolean(job.killTimer);
      clearTimeout(job.timer); clearTimeout(job.watchdog); clearTimeout(job.killTimer);
      job.killTimer = null;
      if (!job.finishedAt) {
        job.reason = 'cancelled'; job.cleanupError = killGroup(job.pid);
        draining.push(job.done);
      } else if (escalating) killGroup(job.pid);
    }
    let drainTimer;
    try { await Promise.race([Promise.allSettled(draining), new Promise((resolve) => { drainTimer = setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(drainTimer); }
    const workers = [];
    for (const job of this.jobs.values()) {
      if (!job.finishedAt) {
        job.cleanupError = killGroup(job.pid);
        this.finish(job, { success: false, code: 'CANCELLED', error: 'Service stopped.' });
      }
      if (job.worker) workers.push(job.worker.terminate());
    }
    await Promise.allSettled(workers);
  }
}
