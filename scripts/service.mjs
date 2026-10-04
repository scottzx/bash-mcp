import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BashBridge } from '../src/bridge.mjs';

const run = promisify(execFile);
const label = 'work.dreammate.bash-mcp';
const unit = 'bash-mcp.service';
const script = fileURLToPath(new URL('../bin/bash-mcp.mjs', import.meta.url));
const dataDir = path.join(os.homedir(), '.1agents', 'bash-mcp');
const configFile = path.join(dataDir, 'service.json');
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', unit);
const xml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const shellQuote = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
const systemdQuote = (s) => '"' + String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => '$$') + '"';

export function renderPlist(argv, cwd, logDir, searchPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${argv.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(cwd)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>${xml(path.join(logDir, 'stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logDir, 'stderr.log'))}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(searchPath)}</string></dict>
</dict></plist>\n`;
}
export function renderUnit(argv, cwd, searchPath) {
  return `[Unit]\nDescription=DreamMate Bash MCP\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart=${argv.map(systemdQuote).join(' ')}\nWorkingDirectory=${systemdQuote(cwd)}\nEnvironment=${systemdQuote('PATH=' + searchPath)}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
}

export async function installService(options) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Only macOS launchd and Linux systemd user services are supported.');
  const bridge = new BashBridge(options);
  await bridge.start(); await bridge.close();
  const cwd = path.resolve(options.cwd);
  if (/\r|\n/.test(cwd)) throw new Error('Service cwd cannot contain line breaks.');
  if (process.platform === 'linux') await run('systemctl', ['--user', 'show-environment'], { timeout: 3000 });
  const searchPath = process.env.PATH ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
  const baseArgv = [process.execPath, script, 'serve', '--cwd', cwd, '--port', String(options.port), '--agent', options.agent,
    '--shell', options.shell, '--rg', options.rg, '--id', options.id, '--max-concurrent', String(options.maxConcurrent)];
  const startCommand = baseArgv.map(shellQuote).join(' ');
  const argv = [...baseArgv, '--start-command', startCommand];
  const logDir = path.join(dataDir, 'logs');
  await fs.mkdir(logDir, { recursive: true, mode: 0o700 });
  if (process.platform === 'darwin') {
    await fs.mkdir(path.dirname(plist), { recursive: true });
    await run('launchctl', ['bootout', `gui/${process.getuid()}/${label}`]).catch(() => {});
    await fs.writeFile(plist, renderPlist(argv, cwd, logDir, searchPath), { mode: 0o600 });
    await run('launchctl', ['enable', `gui/${process.getuid()}/${label}`]);
    await run('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  } else {
    await fs.mkdir(path.dirname(unitPath), { recursive: true });
    await fs.writeFile(unitPath, renderUnit(argv, cwd, searchPath), { mode: 0o600 });
    await run('systemctl', ['--user', 'daemon-reload']);
    await run('systemctl', ['--user', 'enable', unit]);
    await run('systemctl', ['--user', 'restart', unit]);
  }
  await fs.writeFile(configFile, JSON.stringify({ ...options, cwd, script, installed_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  // Health + registration are verified, not inferred from launchctl/systemctl success.
  let health;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${options.port}/health`, { signal: AbortSignal.timeout(1000) });
      health = await response.json();
      if (response.ok && health.service === options.id && health.registered) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!health?.registered || health.service !== options.id) throw new Error(`Service installed but registration is not verified. Check ${logDir}.`);
  return { success: true, installed: true, platform: process.platform, file: process.platform === 'darwin' ? plist : unitPath, health };
}

export async function uninstallService() {
  if (process.platform === 'darwin') {
    await run('launchctl', ['bootout', `gui/${process.getuid()}/${label}`]).catch(() => {});
    await fs.rm(plist, { force: true });
  } else if (process.platform === 'linux') {
    await run('systemctl', ['--user', 'disable', '--now', unit]).catch(() => {});
    await fs.rm(unitPath, { force: true });
    await run('systemctl', ['--user', 'daemon-reload']);
  } else throw new Error('Unsupported platform.');
  await fs.rm(configFile, { force: true });
  return { success: true, uninstalled: true };
}
