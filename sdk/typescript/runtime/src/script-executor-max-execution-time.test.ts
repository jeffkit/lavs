/**
 * issue #20 — `permissions.maxExecutionTime` caps `handler.timeout`.
 *
 * `permissions.maxExecutionTime` is documented as ENFORCED (docs/SPEC.md:586,
 * sdk/typescript/types/src/index.ts:195) and must constrain script handlers:
 * `sdk/typescript/runtime/src/script-executor.ts` resolves the timeout via
 * `PermissionChecker.getEffectiveTimeout` (min of handler.timeout and
 * permissions.maxExecutionTime), so a manifest with `maxExecutionTime: 1000` +
 * `handler.timeout: 60000` kills the child at ~1s instead of letting it run 60s.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ScriptExecutor } from './script-executor';
import { LAVSToolGenerator } from './tool-generator';
import {
  ExecutionContext,
  LAVSError,
  LAVSErrorCode,
  ScriptHandler,
} from './types';

/** Writes a sentinel file from a SIGTERM handler, then keeps running for 60s. */
function sigtermProbeScript(sentinelPath: string): string {
  return [
    "process.on('SIGTERM', () => {",
    `  require('fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'sigterm');`,
    '  process.exit(0);',
    '});',
    'setTimeout(() => {}, 60000);',
  ].join(' ');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fileExists(filePath);
}

describe('issue #20 - permissions.maxExecutionTime caps handler.timeout', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-issue-20-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ScriptExecutor kills the child at maxExecutionTime despite a longer handler.timeout', async () => {
    const sentinel = path.join(tmpDir, 'sigterm.txt');
    const handler: ScriptHandler = {
      type: 'script',
      command: 'node',
      args: ['-e', sigtermProbeScript(sentinel)],
      timeout: 60000,
    };
    const context: ExecutionContext = {
      endpointId: 'slow',
      agentId: 'agent-1',
      workdir: tmpDir,
      permissions: { maxExecutionTime: 1000 },
    };

    const startedAt = Date.now();
    let thrown: unknown;
    try {
      await new ScriptExecutor().execute(handler, null, context);
    } catch (err) {
      thrown = err;
    }
    const elapsed = Date.now() - startedAt;

    expect(thrown).toBeInstanceOf(LAVSError);
    expect((thrown as LAVSError).code).toBe(LAVSErrorCode.Timeout);
    expect(elapsed).toBeLessThan(5000);
    expect(await waitForFile(sentinel, 2000)).toBe(true);
  }, 10000);

  it('LAVSToolGenerator end-to-end: manifest maxExecutionTime=1000 wins over handler.timeout=60000', async () => {
    const sentinel = path.join(tmpDir, 'sigterm-e2e.txt');
    await fs.writeFile(
      path.join(tmpDir, 'lavs.json'),
      JSON.stringify(
        {
          lavs: '1.0',
          name: 'slow-bundle',
          version: '1.0.0',
          permissions: { maxExecutionTime: 1000 },
          endpoints: [
            {
              id: 'slow',
              method: 'query',
              handler: {
                type: 'script',
                command: 'node',
                args: ['-e', sigtermProbeScript(sentinel)],
                timeout: 60000,
              },
            },
          ],
        },
        null,
        2
      )
    );

    const tools = await new LAVSToolGenerator().generateTools('agent-1', tmpDir);
    expect(tools).toHaveLength(1);

    const startedAt = Date.now();
    let thrown: unknown;
    try {
      await tools[0].execute({});
    } catch (err) {
      thrown = err;
    }
    const elapsed = Date.now() - startedAt;

    expect(thrown).toBeInstanceOf(LAVSError);
    expect((thrown as LAVSError).code).toBe(LAVSErrorCode.Timeout);
    expect(elapsed).toBeLessThan(5000);
    expect(await waitForFile(sentinel, 2000)).toBe(true);
  }, 10000);

  it('treats context.timeout=0 as unset, same as the Python runtime', async () => {
    // Python: `context.timeout or 30000` (script_executor.py) — 0 must fall back
    // to the 30000ms default, not become an immediate timeout.
    const handler: ScriptHandler = {
      type: 'script',
      command: 'node',
      args: ['-e', 'console.log(JSON.stringify({ ok: true }))'],
    };
    const context: ExecutionContext = {
      endpointId: 'fast',
      agentId: 'agent-1',
      workdir: tmpDir,
      timeout: 0,
      permissions: {},
    };

    await expect(
      new ScriptExecutor().execute(handler, null, context)
    ).resolves.toEqual({ ok: true });
  }, 10000);
});
