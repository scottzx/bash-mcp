#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { BashBridge, VERSION } from '../src/bridge.mjs';
import { startServer, DEFAULT_PORT, DEFAULT_AGENT, localAgentUrl } from '../src/server.mjs';
import { errorResult } from '../src/result.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const help = `bash-mcp ${VERSION}
  serve [--cwd PATH] [--port 7785] [--agent URL] [--no-report]
  mcp [--cwd PATH]                       stdio MCP (no HTTP registration)
  invoke --method bash.exec --params '{"command":"pwd"}'
  invoke --params -                     read {method,params} from stdin
  manifest [--port 7785]
  status [--port 7785]
  install [--cwd PATH] [--port 7785]      launchd / systemd user service
  uninstall

Options: --shell /bin/bash, --rg rg, --max-concurrent 4, --id bash.
Environment: BASH_MCP_CWD, BASH_MCP_PORT, DREAMMATE_AGENT_URL.
Long commands return job_id; poll bash.job_get. JSON goes to stdout.
The service executes with the host account’s permissions (no OS sandbox).`;

async function main() {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    cwd: { type: 'string' }, port: { type: 'string' }, agent: { type: 'string' },
    shell: { type: 'string' }, rg: { type: 'string' }, id: { type: 'string' },
    'max-concurrent': { type: 'string' }, 'no-report': { type: 'boolean' },
    method: { type: 'string' }, params: { type: 'string' },
    'start-command': { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (v.help) { process.stdout.write(help + '\n'); return; }
  if (v.version) { process.stdout.write(VERSION + '\n'); return; }
  if (positionals.length > 1) throw new Error('Only one command is allowed.');
  const command = positionals[0] ?? 'serve';
  const port = Number(v.port ?? process.env.BASH_MCP_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1–65535.');
  const agent = localAgentUrl(v.agent ?? process.env.DREAMMATE_AGENT_URL ?? DEFAULT_AGENT);
  const options = { cwd: v.cwd ?? process.env.BASH_MCP_CWD ?? process.cwd(), shell: v.shell ?? '/bin/bash', rg: v.rg ?? 'rg', maxConcurrent: Number(v['max-concurrent'] ?? 4) };
  const serviceOptions = { port, agent, id: v.id ?? 'bash', report: !v['no-report'], startCommand: v['start-command'] };
  if (command === 'serve' && !serviceOptions.startCommand) {
    const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
    serviceOptions.startCommand = [process.execPath, fileURLToPath(import.meta.url), 'serve', '--cwd', path.resolve(options.cwd),
      '--port', String(port), '--agent', agent, '--shell', options.shell, '--rg', options.rg,
      '--id', serviceOptions.id, '--max-concurrent', String(options.maxConcurrent), ...(serviceOptions.report ? [] : ['--no-report'])].map(quote).join(' ');
  }
  if (command === 'serve' || command === 'mcp') {
    const bridge = new BashBridge(options);
    const service = command === 'serve' ? await startServer(bridge, serviceOptions) : await (await import('../src/mcp.mjs')).startMcp(bridge);
    if (command === 'serve') process.stderr.write(`[bash-mcp] listening on 127.0.0.1:${service.port}, cwd=${bridge.cwd}\n`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await service.stop(); };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    return;
  }
  if (command === 'install' || command === 'uninstall') {
    if (command === 'install' && v['no-report']) throw new Error('install requires DreamMate registration; use serve --no-report for a standalone service.');
    const { installService, uninstallService } = await import('../scripts/service.mjs');
    const data = command === 'install' ? await installService({ ...options, ...serviceOptions }) : await uninstallService();
    process.stdout.write(JSON.stringify(data) + '\n');
    return;
  }
  if (!['invoke', 'manifest', 'status'].includes(command)) throw new Error(`Unknown command: ${command}`);
  let payload;
  if (command === 'invoke') {
    let params;
    if (v.params === '-') {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('stdin exceeds 2 MiB.'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      payload = v.method ? { method: v.method, params: body } : body;
    } else { params = JSON.parse(v.params ?? '{}'); payload = { method: v.method, params }; }
    if (!payload || typeof payload.method !== 'string') throw new Error('--method is required, or stdin must contain {method,params}.');
  }
  const response = await fetch(`http://127.0.0.1:${port}/${command === 'status' ? 'health' : command}`, {
    signal: AbortSignal.timeout(5000),
    ...(payload ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json();
  process.stdout.write(JSON.stringify(data) + '\n');
  if (!response.ok || data.isError) process.exitCode = 1;
}

main().catch((error) => { process.stdout.write(JSON.stringify(errorResult(error, 'CLI_ERROR')) + '\n'); process.exitCode = 1; });
