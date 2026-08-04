/**
 * Tests for FunctionExecutor
 *
 * Covers execute(handler, input, context) with an empty-array input ([]):
 * the handler must be invoked with [] as its first argument (not omitted or
 * replaced with undefined), the return value must pass through unchanged, the
 * success path must not throw and must reach the "Function completed" log
 * branch, and the error paths (module import failure / target function
 * missing) must keep throwing LAVSError(HandlerError).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { FunctionExecutor } from './function-executor';
import {
  FunctionHandler,
  ExecutionContext,
  LAVSError,
  LAVSErrorCode,
} from './types';

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    endpointId: 'test-endpoint',
    agentId: 'test-agent',
    workdir: process.cwd(),
    permissions: {},
    ...overrides,
  };
}

// Fixture modules are written to a per-test temp dir so they can be dynamically
// imported by FunctionExecutor (absolute path), mirroring how mcp-executor.test.ts
// stages mcp-config.json in a temp dir.
const ECHO_FIXTURE = `
globalThis.__lavsFnCaptured = [];
export async function echo(input, context) {
  globalThis.__lavsFnCaptured = [input, context];
  return { ok: true, received: input, endpointId: context.endpointId };
}
`;

const SENTINEL_FIXTURE = `
export function echo(input, context) {
  return 'sentinel-value';
}
`;

const MISSING_FN_FIXTURE = `
export function unrelated() {
  return 'unrelated';
}
`;

const NON_FUNCTION_FIXTURE = `
export const notAFunction = { some: 'data' };
`;

describe('FunctionExecutor', () => {
  let executor: FunctionExecutor;
  let tmpDir: string;

  beforeEach(async () => {
    executor = new FunctionExecutor();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-fn-'));
    (globalThis as any).__lavsFnCaptured = null;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete (globalThis as any).__lavsFnCaptured;
  });

  async function writeModule(code: string): Promise<string> {
    const file = path.join(tmpDir, 'handler.mjs');
    await fs.writeFile(file, code);
    return file;
  }

  // ─── Success path with empty-array input ──────────────────

  describe('success path with empty-array input', () => {
    it('calls the handler with [] as the first argument and context as the second', async () => {
      const modulePath = await writeModule(ECHO_FIXTURE);
      const handler: FunctionHandler = { type: 'function', module: modulePath, function: 'echo' };
      const ctx = makeContext();

      const result = await executor.execute(handler, [], ctx);

      const captured = (globalThis as any).__lavsFnCaptured as [unknown, unknown];
      const [arg1, arg2] = captured;
      // The empty array must be passed through, not omitted or replaced by undefined.
      expect(arg1).toEqual([]);
      expect(arg1).not.toBeUndefined();
      // Context is passed as the second argument.
      expect(arg2).toBeDefined();
      expect((arg2 as ExecutionContext).endpointId).toBe('test-endpoint');
      // Round-trip proof: the handler echoes back exactly what it received.
      expect(result).toEqual({ ok: true, received: [], endpointId: 'test-endpoint' });
    });

    it('returns the handler return value unchanged', async () => {
      const modulePath = await writeModule(SENTINEL_FIXTURE);
      const handler: FunctionHandler = { type: 'function', module: modulePath, function: 'echo' };

      const result = await executor.execute(handler, [], makeContext());

      expect(result).toBe('sentinel-value');
    });

    it('resolves with the handler result without throwing', async () => {
      const modulePath = await writeModule(ECHO_FIXTURE);
      const handler: FunctionHandler = { type: 'function', module: modulePath, function: 'echo' };

      await expect(executor.execute(handler, [], makeContext())).resolves.toEqual({
        ok: true,
        received: [],
        endpointId: 'test-endpoint',
      });
    });

    it('logs "Function completed" and reaches the completion branch', async () => {
      const modulePath = await writeModule(ECHO_FIXTURE);
      const handler: FunctionHandler = { type: 'function', module: modulePath, function: 'echo' };

      const logSpy = vi.spyOn(console, 'log');
      const result = await executor.execute(handler, [], makeContext());

      expect(
        logSpy.mock.calls.some((call) => String(call[0]).includes('Function completed'))
      ).toBe(true);
      // Still returns the result without throwing.
      expect(result).toEqual({ ok: true, received: [], endpointId: 'test-endpoint' });
    });
  });

  // ─── Error paths with empty-array input ───────────────────

  describe('error paths with empty-array input', () => {
    it('throws HandlerError when the module cannot be imported', async () => {
      const handler: FunctionHandler = {
        type: 'function',
        module: path.join(tmpDir, 'does-not-exist.mjs'),
        function: 'echo',
      };

      const promise = executor.execute(handler, [], makeContext());
      await expect(promise).rejects.toMatchObject({ code: -32003 });

      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LAVSError);
      expect((err as LAVSError).code).toBe(LAVSErrorCode.HandlerError);
      expect((err as LAVSError).message).toMatch(/Failed to import module/);
    });

    it('throws HandlerError when the target function is missing from the module', async () => {
      const modulePath = await writeModule(MISSING_FN_FIXTURE);
      const handler: FunctionHandler = {
        type: 'function',
        module: modulePath,
        function: 'missingFn',
      };

      const promise = executor.execute(handler, [], makeContext());
      await expect(promise).rejects.toMatchObject({ code: -32003 });

      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LAVSError);
      expect((err as LAVSError).code).toBe(LAVSErrorCode.HandlerError);
      expect((err as LAVSError).message).toMatch(/not found or not a function/);
    });

    it('throws HandlerError when the exported value is not a function', async () => {
      const modulePath = await writeModule(NON_FUNCTION_FIXTURE);
      const handler: FunctionHandler = {
        type: 'function',
        module: modulePath,
        function: 'notAFunction',
      };

      const promise = executor.execute(handler, [], makeContext());
      await expect(promise).rejects.toMatchObject({ code: -32003 });

      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LAVSError);
      expect((err as LAVSError).code).toBe(LAVSErrorCode.HandlerError);
      expect((err as LAVSError).message).toMatch(/not found or not a function/);
    });
  });
});
