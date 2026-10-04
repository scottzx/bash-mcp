import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BashBridge } from '../src/bridge.mjs';

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bash-mcp-test-'));
  const bridge = new BashBridge({ cwd: dir, ...options });
  t.after(async () => { await bridge.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { bridge, dir };
}
async function done(bridge, response) {
  let data = response.structuredContent;
  for (let i = 0; data.status === 'running' && i < 8; i++) {
    data = (await bridge.invoke('bash.job_get', { job_id: data.job_id, wait_ms: 1000 })).structuredContent;
  }
  assert.notEqual(data.status, 'running');
  return data;
}

test('Bash syntax, stdout/stderr, independent cwd, failure exit status', async (t) => {
  const { bridge, dir } = await fixture(t);
  await fs.mkdir(path.join(dir, 'child'));
  const first = await done(bridge, await bridge.invoke('bash.exec', { command: 'cd child; printf "%s" "$BASH_VERSION"; printf error >&2; exit 7', wait_ms: 1000 }));
  assert.equal(first.exit_code, 7); assert.equal(first.success, false); assert.equal(first.stderr, 'error'); assert.match(first.stdout, /^\d+\./);
  const second = await done(bridge, await bridge.invoke('bash.exec', { command: 'pwd', wait_ms: 1000 }));
  assert.equal(await fs.realpath(second.stdout.trim()), await fs.realpath(dir));
});

test('literal argv, stdin, JSON and JSONL, explicit parsing errors', async (t) => {
  const { bridge, dir } = await fixture(t);
  const text = `$(touch ${path.join(dir, 'injected')})`;
  const literal = await done(bridge, await bridge.invoke('bash.exec', { argv: ['/usr/bin/printf', '%s', text], wait_ms: 1000 }));
  assert.equal(literal.stdout, text); await assert.rejects(fs.stat(path.join(dir, 'injected')));
  const document = await done(bridge, await bridge.invoke('bash.exec', { argv: ['/bin/cat'], stdin: '{"items":[1,2]}', output_format: 'json', wait_ms: 1000 }));
  assert.deepEqual(document.data, { items: [1, 2] });
  const lines = await done(bridge, await bridge.invoke('bash.exec', { argv: ['/bin/cat'], stdin: '{"a":1}\n{"a":2}\n', output_format: 'jsonl', wait_ms: 1000 }));
  assert.deepEqual(lines.data, [{ a: 1 }, { a: 2 }]);
  const invalid = await bridge.invoke('bash.exec', { command: 'printf not-json', output_format: 'json', wait_ms: 1000 });
  assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent.exit_code, 0); assert.equal(invalid.structuredContent.code, 'INVALID_OUTPUT');
});

test('long job returns promptly, polling never replays the command', async (t) => {
  const { bridge, dir } = await fixture(t);
  const start = Date.now();
  const initial = await bridge.invoke('bash.exec', { command: `printf x >> count; sleep 0.15; printf '%s' '{"done":true}'`, wait_ms: 0, output_format: 'json' });
  assert.ok(Date.now() - start < 500); assert.equal(initial.structuredContent.status, 'running');
  const final = await done(bridge, initial); assert.deepEqual(final.data, { done: true });
  await bridge.invoke('bash.job_get', { job_id: final.job_id });
  assert.equal(await fs.readFile(path.join(dir, 'count'), 'utf8'), 'x');
});

test('deadline kills descendants that ignore TERM and preserves partial output', async (t) => {
  const { bridge } = await fixture(t);
  const data = await done(bridge, await bridge.invoke('bash.exec', {
    command: `trap 'exit 0' TERM; bash -c 'trap "" TERM; echo $$; sleep 20' & wait`, timeout_ms: 150, wait_ms: 1000,
  }));
  assert.equal(data.timed_out, true); assert.equal(data.success, false); assert.equal(data.code, 'COMMAND_TIMEOUT');
  const descendant = Number(data.stdout.trim()); assert.ok(descendant > 1);
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
});

test('cancellation and shutdown stop running process groups', async (t) => {
  const { bridge } = await fixture(t);
  const initial = await bridge.invoke('bash.exec', { command: 'sleep 20', wait_ms: 0 });
  const cancelled = await done(bridge, await bridge.invoke('bash.job_cancel', { job_id: initial.structuredContent.job_id }));
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.success, false);
  const another = await bridge.invoke('bash.exec', { command: 'sleep 20', wait_ms: 100 });
  const pid = another.structuredContent.pid;
  await bridge.close();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal((await bridge.invoke('bash.info')).structuredContent.code, 'SERVICE_CLOSED');
});

test('bounded UTF-8 output and truncated JSON is never returned as complete data', async (t) => {
  const { bridge } = await fixture(t);
  const clipped = await done(bridge, await bridge.invoke('bash.exec', { argv: [process.execPath, '-e', 'process.stdout.write("你".repeat(2000))'], max_output_bytes: 1024, wait_ms: 1000 }));
  assert.equal(clipped.success, true); assert.equal(clipped.truncated, true); assert.equal(clipped.stdout_bytes, 6000);
  assert.ok(Buffer.byteLength(clipped.stdout) <= 1024); assert.ok(!clipped.stdout.includes('\ufffd'));
  const json = await done(bridge, await bridge.invoke('bash.exec', { argv: [process.execPath, '-e', 'console.log(JSON.stringify({a:"x".repeat(4000)}))'], output_format: 'json', max_output_bytes: 1024, wait_ms: 1000 }));
  assert.equal(json.success, false); assert.ok(json.parse_error); assert.equal(json.data, undefined);
});

test('structured search handles literal patterns, glob, no matches and invalid regex', async (t) => {
  const { bridge, dir } = await fixture(t);
  await fs.writeFile(path.join(dir, "file with 'quotes'.ts"), 'before\nTODO [a]\nTODO other\n');
  await fs.writeFile(path.join(dir, 'skip.txt'), 'TODO [a]\n');
  const found = await done(bridge, await bridge.invoke('bash.search', { pattern: 'TODO [a]', glob: ['*.ts'], wait_ms: 1000 }));
  assert.equal(found.success, true); assert.equal(found.count, 1); assert.equal(found.matches[0].line_number, 2);
  assert.equal(found.matches[0].submatches[0].text, 'TODO [a]');
  const empty = await done(bridge, await bridge.invoke('bash.search', { pattern: 'NOT_PRESENT', wait_ms: 1000 }));
  assert.equal(empty.success, true); assert.equal(empty.exit_code, 1); assert.deepEqual(empty.matches, []);
  const bad = await done(bridge, await bridge.invoke('bash.search', { pattern: '[', regex: true, wait_ms: 1000 }));
  assert.equal(bad.success, false); assert.equal(bad.exit_code, 2);
  const limited = await done(bridge, await bridge.invoke('bash.search', { pattern: 'TODO', max_matches: 1, wait_ms: 1000 }));
  assert.equal(limited.count, 1); assert.equal(limited.truncated, true);
});

test('missing executable, invalid arguments, concurrency and retention limits', async (t) => {
  const { bridge } = await fixture(t, { maxConcurrent: 1, maxJobs: 2, retentionMs: 50 });
  for (const p of [{ command: 'pwd', argv: ['pwd'] }, { command: 'pwd', timeout_ms: 0 }, { argv: [] }, { command: 'pwd', unknown: true }]) {
    assert.equal((await bridge.invoke('bash.exec', p)).isError, true);
  }
  const missing = await done(bridge, await bridge.invoke('bash.exec', { argv: ['bash-mcp-no-such-executable'], wait_ms: 1000 }));
  assert.equal(missing.success, false); assert.match(missing.error, /ENOENT/);
  const initial = await bridge.invoke('bash.exec', { command: 'sleep 20', wait_ms: 0 });
  assert.equal((await bridge.invoke('bash.exec', { command: 'pwd' })).structuredContent.code, 'BUSY');
  await bridge.invoke('bash.job_cancel', { job_id: initial.structuredContent.job_id });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal((await bridge.invoke('bash.job_get', { job_id: initial.structuredContent.job_id })).structuredContent.code, 'JOB_NOT_FOUND');
});

test('worker output exhaustion returns an error while service stays usable', async (t) => {
  const { bridge } = await fixture(t);
  const overflow = await done(bridge, await bridge.invoke('bash.exec', {
    argv: [process.execPath, '-e', 'let i=0;function out(){if(i++<2048){process.stdout.write("x".repeat(65536));setImmediate(out)}}out()'], wait_ms: 1000, timeout_ms: 5000,
  }));
  assert.equal(overflow.success, false); assert.equal(overflow.code, 'OUTPUT_RESOURCE_LIMIT');
  assert.equal((await bridge.invoke('bash.info')).structuredContent.success, true);
});
