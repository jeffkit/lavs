/**
 * Tests for LAVSHttpExecutor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpExecutor } from './http-executor';
import { ExecutionContext } from './types';

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    endpointId: 'fetch',
    agentId: 'agent-1',
    workdir: '/tmp',
    permissions: {},
    ...overrides,
  };
}

describe('LAVSHttpExecutor', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executes a GET and parses JSON', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ items: [1, 2, 3] }),
    }));

    const executor = new HttpExecutor();
    const result = await executor.execute(
      { type: 'http', url: 'https://example.com/api/items', method: 'GET' },
      undefined,
      makeContext()
    );

    expect(result).toEqual({ items: [1, 2, 3] });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/items',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('sends JSON body for mutation methods', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ id: 42 }),
    }));

    const executor = new HttpExecutor();
    const result = await executor.execute(
      { type: 'http', url: 'https://example.com/api/items', method: 'POST' },
      { text: 'hello' },
      makeContext()
    );

    expect(result).toEqual({ id: 42 });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ text: 'hello' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws HandlerError on non-2xx response', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    }));

    const executor = new HttpExecutor();
    await expect(
      executor.execute(
        { type: 'http', url: 'https://example.com/api', method: 'GET' },
        undefined,
        makeContext()
      )
    ).rejects.toMatchObject({ code: -32003 });
  });

  it('throws Timeout when the request exceeds the timeout', async () => {
    fetchMock.mockImplementation(
      async (_url: string, init?: any) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              text: async () => '{}',
            });
          }, 200);
          // Honor the abort signal, like a real fetch implementation
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        })
    );

    const executor = new HttpExecutor();
    await expect(
      executor.execute(
        {
          type: 'http',
          url: 'https://example.com/api',
          method: 'GET',
          timeout: 50,
        },
        undefined,
        makeContext({ timeout: 50 })
      )
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('falls back to raw text when body is not JSON', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'plain text',
    }));

    const executor = new HttpExecutor();
    const result = await executor.execute(
      { type: 'http', url: 'https://example.com/api', method: 'GET' },
      undefined,
      makeContext()
    );

    expect(result).toBe('plain text');
  });
});
