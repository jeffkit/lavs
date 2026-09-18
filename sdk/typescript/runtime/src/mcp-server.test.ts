import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { jsonSchemaToZod, createLAVSMcpServer } from './mcp-server';

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('jsonSchemaToZod', () => {
  it('maps primitives, arrays and unknown types', () => {
    expect(jsonSchemaToZod({ type: 'string' }).parse('x')).toBe('x');
    expect(jsonSchemaToZod({ type: 'integer' }).parse(3)).toBe(3);
    expect(jsonSchemaToZod({ type: 'boolean' }).parse(true)).toBe(true);
    expect(jsonSchemaToZod({ type: 'array', items: { type: 'string' } }).parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(jsonSchemaToZod({ type: 'mystery' }).safeParse({ anything: 1 }).success).toBe(true);
  });

  it('handles enums', () => {
    expect(jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] }).safeParse('a').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] }).safeParse('c').success).toBe(false);
  });

  it('honours required inside nested objects', () => {
    const nested = jsonSchemaToZod({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });
    expect(nested.safeParse({ a: 'x' }).success).toBe(true);
    expect(nested.safeParse({ a: 'x', b: 1 }).success).toBe(true);
    expect(nested.safeParse({ b: 1 }).success).toBe(false);
  });
});

describe('createLAVSMcpServer', () => {
  it('starts when an endpoint declares an input schema', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-mcpsrv-'));
    await fs.mkdir(path.join(tmpDir, 'handlers'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'handlers', 'ping.py'),
      'import json,sys\nsys.stdin.read()\nprint(json.dumps({"ok":True}))\n');
    await fs.writeFile(path.join(tmpDir, 'lavs.json'), JSON.stringify({
      lavs: '1.0', name: 'probe', contentType: 'local/probe', version: '0.0.1',
      endpoints: [{
        id: 'ping',
        method: 'query',
        description: 'ping',
        handler: { type: 'script', command: 'python3', args: ['handlers/ping.py'], input: 'stdin', cwd: './' },
        schema: {
          input: {
            type: 'object',
            required: ['text'],
            properties: { text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
          },
        },
      }],
    }));

    await expect(createLAVSMcpServer({ agentId: 'probe', agentDir: tmpDir })).resolves.toBeDefined();
  });
});
