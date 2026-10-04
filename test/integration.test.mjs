import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BashBridge } from '../src/bridge.mjs';
import { startServer, localAgentUrl } from '../src/server.mjs';
import { renderPlist, renderUnit } from '../scripts/service.mjs';

test('registration, contracts, JSON HTTP invocation, unregister and local HTTP guards', async (t) => {
  let entry;
  let requests = 0;
  const gateway = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      requests++;
      let body = ''; for await (const chunk of req) body += chunk;
      entry = JSON.parse(body);
      if (requests === 1) { res.writeHead(503); res.end('{}'); return; }
    } else if (req.method === 'DELETE') entry = null;
    res.end(JSON.stringify(req.method === 'GET' ? { services: entry ? [entry] : [] } : { ok: true }));
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const service = await startServer(new BashBridge(), { port: 0, id: 'test-bash', agent: `http://127.0.0.1:${gateway.address().port}`, log: () => {} });
  t.after(() => service.stop());
  const url = `http://127.0.0.1:${service.port}`;
  assert.equal((await (await fetch(url + '/health')).json()).registered, false);
  await service.register();
  assert.equal((await (await fetch(url + '/health')).json()).registered, true);
  assert.equal(entry.execution, 'http'); assert.equal(entry.reachability, 'localhost');
  assert.ok(entry.methods['bash.exec'].parameters.properties.command); assert.ok(entry.skills['bash-mcp'].sop);
  const invoke = await fetch(url + '/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'bash.exec', params: { command: `printf '%s' '{"network":true}'`, output_format: 'json', wait_ms: 1000 } }) });
  assert.deepEqual((await invoke.json()).structuredContent.data, { network: true });
  assert.equal((await fetch(url + '/health', { headers: { origin: 'https://example.com' } })).status, 403);
  const blockedHost = await new Promise((resolve, reject) => {
    http.get(url + '/health', { headers: { host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(blockedHost, 403);
  assert.equal((await fetch(url + '/invoke', { method: 'POST', body: '{broken' })).status, 400);
  const nullParams = await (await fetch(url + '/invoke', { method: 'POST', body: JSON.stringify({ method: 'bash.exec', params: null }) })).json();
  assert.equal(nullParams.isError, true);
  await service.stop(); assert.equal(entry, null);
});

test('stdio MCP advertises tools and preserves native structuredContent', async (t) => {
  const client = new Client({ name: 'bash-mcp-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../bin/bash-mcp.mjs', import.meta.url)), 'mcp'], stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  const listed = await client.listTools(); assert.equal(listed.tools.length, 6);
  const response = await client.callTool({ name: 'bash.exec', arguments: { argv: [process.execPath, '-e', 'console.log(JSON.stringify({mcp:true}))'], output_format: 'json', wait_ms: 1000 } });
  assert.deepEqual(response.structuredContent.data, { mcp: true }); assert.equal(response.isError, undefined);
  const error = await client.callTool({ name: 'bash.exec', arguments: { command: 'exit 9', wait_ms: 1000 } });
  assert.equal(error.isError, true); assert.equal(error.structuredContent.exit_code, 9);
});

test('deployment quoting and local gateway validation', () => {
  const args = ['/node path', '/repo/目录/script.mjs', 'serve', '--cwd', '/a&b'];
  const plist = renderPlist(args, '/a&b', '/logs', '/bin'); assert.ok(plist.includes('/a&amp;b')); assert.ok(plist.includes('<string>/node path</string>'));
  const unit = renderUnit(['/node path', '/a%repo', '$literal'], '/dir', '/bin'); assert.ok(unit.includes('"/node path"')); assert.ok(unit.includes('/a%%repo')); assert.ok(unit.includes('$$literal'));
  assert.equal(localAgentUrl('http://127.0.0.1:36908'), 'http://127.0.0.1:36908');
  for (const url of ['http://example.com:36908', 'https://localhost:36908', 'http://localhost:36908/path', 'http://user:pass@localhost:36908']) assert.throws(() => localAgentUrl(url));
});
