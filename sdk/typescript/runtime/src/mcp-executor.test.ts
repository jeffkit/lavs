import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { McpExecutor } from './mcp-executor';
import { ExecutionContext, LAVSErrorCode } from './types';

// Fixture MCP server run as a stdio child process by McpExecutor.
const FIXTURE = path.resolve(process.cwd(), 'src/__fixtures__/echo-mcp-server.mjs');

let tmpDir: string;

async function writeMcpConfig(obj: any): Promise<void> {
  await fs.writeFile(path.join(tmpDir, 'mcp-config.json'), JSON.stringify(obj, null, 2));
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    endpointId: 'ep',
    agentId: 'agent-1',
    workdir: tmpDir,
    permissions: {},
    ...overrides,
  };
}

describe('McpExecutor', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-mcp-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls an MCP tool via stdio transport', async () => {
    await writeMcpConfig({
      mcpServers: { echo: { transport: 'stdio', command: 'node', args: [FIXTURE] } },
    });
    const executor = new McpExecutor();
    const result = await executor.execute(
      { type: 'mcp', server: 'echo', tool: 'echo' },
      { msg: 'hello' },
      makeContext()
    );
    expect(result).toEqual({ echo: 'hello' });
  });

  it('throws HandlerError when the MCP tool returns isError', async () => {
    await writeMcpConfig({
      mcpServers: { echo: { transport: 'stdio', command: 'node', args: [FIXTURE] } },
    });
    const executor = new McpExecutor();
    await expect(
      executor.execute({ type: 'mcp', server: 'echo', tool: 'boom' }, {}, makeContext())
    ).rejects.toMatchObject({ code: LAVSErrorCode.HandlerError });
  });

  it('throws HandlerError when server is missing from mcp-config.json', async () => {
    await writeMcpConfig({
      mcpServers: { echo: { transport: 'stdio', command: 'node', args: [FIXTURE] } },
    });
    const executor = new McpExecutor();
    await expect(
      executor.execute({ type: 'mcp', server: 'nope', tool: 'echo' }, {}, makeContext())
    ).rejects.toMatchObject({ code: LAVSErrorCode.HandlerError });
  });

  it('throws HandlerError when mcp-config.json is missing', async () => {
    const executor = new McpExecutor();
    await expect(
      executor.execute({ type: 'mcp', server: 'echo', tool: 'echo' }, {}, makeContext())
    ).rejects.toMatchObject({ code: LAVSErrorCode.HandlerError });
  });

  it('times out when the tool is too slow', async () => {
    await writeMcpConfig({
      mcpServers: { echo: { transport: 'stdio', command: 'node', args: [FIXTURE] } },
    });
    const executor = new McpExecutor();
    await expect(
      executor.execute(
        { type: 'mcp', server: 'echo', tool: 'slow' },
        { ms: 3000 },
        makeContext({ timeout: 250 })
      )
    ).rejects.toMatchObject({ code: LAVSErrorCode.Timeout });
  });
});
