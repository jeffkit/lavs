/**
 * Tests for LAVSToolGenerator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { LAVSToolGenerator } from './tool-generator';

// Minimal MCP stdio server used to exercise the `mcp` handler end-to-end.
const MCP_FIXTURE = path.resolve(process.cwd(), 'src/__fixtures__/echo-mcp-server.mjs');

describe('LAVSToolGenerator', () => {
  let generator: LAVSToolGenerator;
  let tmpDir: string;

  beforeEach(async () => {
    generator = new LAVSToolGenerator();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-toolgen-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a manifest file
   */
  async function writeManifest(manifest: Record<string, unknown>) {
    const filePath = path.join(tmpDir, 'lavs.json');
    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2));
    return filePath;
  }

  // ─── generateTools (happy path) ───────────────────────────

  describe('generateTools', () => {
    it('should generate tools for query and mutation endpoints', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'test-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'list',
            method: 'query',
            handler: { type: 'script', command: 'echo', args: ['[]'] },
          },
          {
            id: 'add',
            method: 'mutation',
            handler: {
              type: 'script',
              command: 'echo',
              args: ['{"ok":true}'],
              input: 'args',
            },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.tool.name)).toEqual(['lavs_list', 'lavs_add']);
    });

    it('should skip subscription endpoints', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'test-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'list',
            method: 'query',
            handler: { type: 'script', command: 'echo', args: ['[]'] },
          },
          {
            id: 'watch',
            method: 'subscription',
            handler: { type: 'script', command: 'node', args: ['watch.js'] },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);

      expect(tools).toHaveLength(1);
      expect(tools[0].tool.name).toBe('lavs_list');
    });

    it('should generate tool with correct schema from endpoint', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'todo-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'add',
            method: 'mutation',
            description: 'Add a todo item',
            handler: {
              type: 'script',
              command: 'echo',
              args: ['{"id":1}'],
              input: 'args',
            },
            schema: {
              input: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  priority: { type: 'number' },
                },
                required: ['text'],
              },
            },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);

      expect(tools[0].tool.name).toBe('lavs_add');
      expect(tools[0].tool.description).toBe('Add a todo item');
      expect(tools[0].tool.input_schema.properties).toHaveProperty('text');
      expect(tools[0].tool.input_schema.properties).toHaveProperty('priority');
      expect(tools[0].tool.input_schema.required).toEqual(['text']);
    });

    it('should use default description when endpoint has none', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'my-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'doSomething',
            method: 'query',
            handler: { type: 'script', command: 'echo', args: ['{}'] },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);

      expect(tools[0].tool.description).toBe(
        'Call doSomething endpoint from my-service'
      );
    });

    it('should execute tool and return result', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'test-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'echo',
            method: 'query',
            handler: {
              type: 'script',
              command: 'echo',
              args: ['{"result":"hello"}'],
              input: 'args',
            },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);
      const result = await tools[0].execute({});

      expect(result).toEqual({ result: 'hello' });
    });

    it('should pass projectPath to execution context', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'test-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'getProject',
            method: 'query',
            handler: {
              type: 'script',
              command: 'node',
              args: [
                '-e',
                'console.log(JSON.stringify({path:process.env.LAVS_PROJECT_PATH}))',
              ],
            },
          },
        ],
      });

      const tools = await generator.generateTools(
        'agent-1',
        tmpDir,
        '/my/project'
      );
      const result = await tools[0].execute({});

      expect(result).toEqual({ path: '/my/project' });
    });

    it('should validate input before execution', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'test-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'add',
            method: 'mutation',
            handler: {
              type: 'script',
              command: 'echo',
              args: ['{}'],
              input: 'args',
            },
            schema: {
              input: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);

      try {
        await tools[0].execute({});
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeDefined();
        expect((err as Error).message).toContain('text');
      }
    });

    it('should return empty array when lavs.json not found', async () => {
      const tools = await generator.generateTools('agent-1', tmpDir);

      expect(tools).toEqual([]);
    });
  });

  // ─── generateTools (error cases) ───────────────────────────

  describe('generateTools error cases', () => {
    it('should throw for endpoint with non-object input schema', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'bad-schema',
        version: '1.0.0',
        endpoints: [
          {
            id: 'bad',
            method: 'query',
            handler: { type: 'script', command: 'echo', args: ['[]'] },
            schema: {
              input: { type: 'array', items: { type: 'string' } },
            },
          },
        ],
      });

      try {
        await generator.generateTools('agent-1', tmpDir);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('must have object input schema');
        expect((err as Error).message).toContain('bad');
      }
    });

    it('should support mcp handler type (end-to-end via generator)', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'mcp-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'fetch',
            method: 'query',
            handler: { type: 'mcp', server: 'echo', tool: 'echo' },
          },
        ],
      });
      // Colocate an mcp-config.json referencing the fixture server.
      await fs.writeFile(
        path.join(tmpDir, 'mcp-config.json'),
        JSON.stringify({
          mcpServers: {
            echo: { transport: 'stdio', command: 'node', args: [MCP_FIXTURE] },
          },
        })
      );

      const tools = await generator.generateTools('agent-1', tmpDir);
      expect(tools).toHaveLength(1);
      const result = await tools[0].execute({ msg: 'hi' });
      expect(result).toEqual({ echo: 'hi' });
    });

    it('should reject unknown handler type at manifest load', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'bad',
        version: '1.0.0',
        endpoints: [
          { id: 'x', method: 'query', handler: { type: 'graphql' } } as any,
        ],
      });

      await expect(generator.generateTools('agent-1', tmpDir)).rejects.toThrow(
        /Invalid handler type/
      );
    });

    it('should support http handler type', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'http-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'fetch',
            method: 'query',
            handler: { type: 'http', url: 'https://example.com/api', method: 'GET' },
          },
        ],
      });

      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ items: [1, 2, 3] }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const tools = await generator.generateTools('agent-1', tmpDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].tool.name).toBe('lavs_fetch');

      const result = await tools[0].execute({});
      expect(result).toEqual({ items: [1, 2, 3] });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({ method: 'GET' })
      );

      vi.unstubAllGlobals();
    });
  });

  // ─── hasLAVS ──────────────────────────────────────────────

  describe('hasLAVS', () => {
    it('should return true when lavs.json exists and is valid', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'test',
        version: '1.0.0',
        endpoints: [],
      });

      const result = await generator.hasLAVS(tmpDir);
      expect(result).toBe(true);
    });

    it('should return false when lavs.json does not exist', async () => {
      const result = await generator.hasLAVS(tmpDir);
      expect(result).toBe(false);
    });

    it('should return false when lavs.json is invalid', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'lavs.json'),
        '{ invalid json }'
      );

      const result = await generator.hasLAVS(tmpDir);
      expect(result).toBe(false);
    });
  });

  // ─── stdin input mode ────────────────────────────────────

  describe('stdin input mode', () => {
    it('should pass params via stdin for stdin input mode', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'stdin-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'echo',
            method: 'mutation',
            handler: {
              type: 'script',
              command: 'node',
              args: [
                '-e',
                `let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify({received:JSON.parse(d)})))`,
              ],
              input: 'stdin',
            },
          },
        ],
      });

      const tools = await generator.generateTools('agent-1', tmpDir);
      const result = await tools[0].execute({ name: 'Alice', count: 3 });

      expect(result).toEqual({
        received: { name: 'Alice', count: 3 },
      });
    });
  });
});

describe('LAVSToolGenerator — notify endpoints (UI commands)', () => {
  let generator: LAVSToolGenerator;
  let tmpDir: string;

  beforeEach(async () => {
    generator = new LAVSToolGenerator();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-notify-tg-test-'));
    process.env.LAVS_HOST_CALLER = '1'; // suppress fire-and-forget host POSTs
  });

  afterEach(async () => {
    delete process.env.LAVS_HOST_CALLER;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeManifest(manifest: Record<string, unknown>) {
    const filePath = path.join(tmpDir, 'lavs.json');
    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2));
    return filePath;
  }

  it('should generate a tool for a handler-less notify endpoint', async () => {
    await writeManifest({
      lavs: '1.0',
      name: 'ui-cmds',
      version: '1.0.0',
      endpoints: [
        {
          id: 'setCompact',
          method: 'notify',
          description: 'Toggle compact layout',
          schema: { input: { type: 'object', properties: { on: { type: 'boolean' } } } },
        },
      ],
    });

    const tools = await generator.generateTools('agent-1', tmpDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].tool.name).toBe('lavs_setCompact');
    expect(tools[0].method).toBe('notify');
  });

  it('should execute a handler-less notify endpoint without running anything, returning ok', async () => {
    await writeManifest({
      lavs: '1.0',
      name: 'ui-cmds',
      version: '1.0.0',
      endpoints: [{ id: 'setCompact', method: 'notify' }],
    });

    const tools = await generator.generateTools('agent-1', tmpDir);
    const result = await tools[0].execute({ on: true });
    expect(result).toEqual({ ok: true });
  });

  it('should execute a notify endpoint with a handler and return its result', async () => {
    await writeManifest({
      lavs: '1.0',
      name: 'ui-cmds',
      version: '1.0.0',
      endpoints: [
        {
          id: 'ping',
          method: 'notify',
          handler: { type: 'script', command: 'echo', args: ['"pong"'], input: 'args' },
        },
      ],
    });

    const tools = await generator.generateTools('agent-1', tmpDir);
    const result = await tools[0].execute({});
    expect(result).toBe('pong');
  });

  it('should validate input schema for notify endpoints', async () => {
    await writeManifest({
      lavs: '1.0',
      name: 'ui-cmds',
      version: '1.0.0',
      endpoints: [
        {
          id: 'setFilter',
          method: 'notify',
          schema: {
            input: {
              type: 'object',
              required: ['filter'],
              properties: { filter: { type: 'string', enum: ['all', 'active', 'done'] } },
            },
          },
        },
      ],
    });

    const tools = await generator.generateTools('agent-1', tmpDir);
    await expect(tools[0].execute({ filter: 'bogus' })).rejects.toThrow();
  });
});
