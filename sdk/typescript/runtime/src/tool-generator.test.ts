/**
 * Tests for LAVSToolGenerator
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { LAVSToolGenerator } from './tool-generator';

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

    it('should throw for unsupported handler type', async () => {
      await writeManifest({
        lavs: '1.0',
        name: 'http-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'fetch',
            method: 'query',
            handler: { type: 'http', url: 'https://example.com', method: 'GET' },
          },
        ],
      });

      try {
        const tools = await generator.generateTools('agent-1', tmpDir);
        // Only query/mutation are processed; http would be attempted
        await tools[0].execute({});
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('not yet supported');
      }
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
