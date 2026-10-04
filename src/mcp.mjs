import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from './bridge.mjs';

export async function startMcp(bridge) {
  await bridge.start();
  const server = new Server({ name: '@1agents/bash-mcp', version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(bridge.methods).map(([name, method]) => ({
    name, description: method.description, inputSchema: method.parameters,
    annotations: { readOnlyHint: ['bash.info', 'bash.jobs', 'bash.job_get', 'bash.search'].includes(name), openWorldHint: true },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => bridge.invoke(request.params.name, request.params.arguments ?? {}));
  server.onclose = () => { void bridge.close(); };
  await server.connect(new StdioServerTransport());
  return { stop: async () => { await bridge.close(); await server.close(); } };
}
