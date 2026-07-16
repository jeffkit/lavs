// Minimal MCP stdio server used as a test fixture for McpExecutor.
// Spawns as a child process; communicates over stdio per the MCP spec.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'echo-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo input back as JSON',
      inputSchema: {
        type: 'object',
        properties: { msg: { type: 'string' } },
        required: ['msg'],
      },
    },
    {
      name: 'boom',
      description: 'Always fails',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'slow',
      description: 'Sleeps then echoes',
      inputSchema: {
        type: 'object',
        properties: { ms: { type: 'number' } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'echo') {
    return {
      content: [{ type: 'text', text: JSON.stringify({ echo: args.msg }) }],
      structuredContent: { echo: args.msg },
    };
  }
  if (name === 'boom') {
    return {
      content: [{ type: 'text', text: 'boom failed' }],
      isError: true,
    };
  }
  if (name === 'slow') {
    const ms = (args && args.ms) || 1000;
    await new Promise((r) => setTimeout(r, ms));
    return { content: [{ type: 'text', text: JSON.stringify({ slept: ms }) }] };
  }
  return { content: [{ type: 'text', text: 'unknown tool' }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
