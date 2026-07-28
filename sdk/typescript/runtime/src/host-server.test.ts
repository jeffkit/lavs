/**
 * Tests for LAVS Host Server
 *
 * Covers: multi-bundle discovery, contentType propagation in SSE agent-action
 * payload, mutation-broadcast behavior, and the CLI notify path.
 *
 * These tests spin up a real createHostServer on an ephemeral port against a
 * temp registry dir with fixture bundles, then exercise the HTTP API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import { createHostServer, discoverBundlesFromDirs, LAVSHostServer } from './host-server';

describe('LAVS Host Server', () => {
  let tmpDir: string;
  let server: LAVSHostServer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-host-test-'));
  });

  afterEach(async () => {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Create a fixture bundle with a script handler that echoes a fixed result.
   * The mutation endpoint writes its input to a data file so we can observe
   * side effects.
   */
  async function writeBundle(
    bundleDir: string,
    opts: { name: string; contentType?: string; endpointId?: string; method?: string }
  ): Promise<void> {
    const dir = path.join(tmpDir, bundleDir);
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'data'), { recursive: true });

    const endpointId = opts.endpointId ?? 'list';
    const method = opts.method ?? 'query';

    const manifest: Record<string, unknown> = {
      lavs: '1.0',
      name: opts.name,
      version: '1.0.0',
      endpoints: [
        {
          id: endpointId,
          method,
          description: `${method} endpoint`,
          handler: {
            type: 'script',
            command: 'node',
            args: [method === 'mutation' ? 'scripts/mutate.js' : 'scripts/query.js'],
            input: method === 'mutation' ? 'stdin' : undefined,
          },
        },
      ],
    };
    if (opts.contentType) (manifest as any).contentType = opts.contentType;

    await fs.writeFile(path.join(dir, 'lavs.json'), JSON.stringify(manifest, null, 2));

    // query.js: synchronous, no stdin dependency — prints and exits immediately.
    await fs.writeFile(
      path.join(dir, 'scripts', 'query.js'),
      `console.log(JSON.stringify({ ok: true, name: ${JSON.stringify(opts.name)} }));`
    );

    // mutate.js: reads stdin (mutation input), prints result, exits.
    await fs.writeFile(
      path.join(dir, 'scripts', 'mutate.js'),
      `let input = '';
       process.stdin.on('data', c => input += c);
       process.stdin.on('end', () => {
         console.log(JSON.stringify({ ok: true, name: ${JSON.stringify(opts.name)}, received: input ? JSON.parse(input) : null }));
       });`
    );
  }

  /** Start a host server on a random port. */
  async function startHost(): Promise<LAVSHostServer> {
    server = await createHostServer({ registryDirs: [tmpDir], port: 0 });
    return server;
  }

  /** Make an HTTP request to the running server. */
  function request(method: string, pathname: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const data = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server!.port,
          path: pathname,
          method,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            try { resolve({ status: res.statusCode || 0, body: JSON.parse(chunks) }); }
            catch { resolve({ status: res.statusCode || 0, body: chunks }); }
          });
        }
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // ─── discoverBundlesFromDirs ──────────────────────────────

  describe('discoverBundlesFromDirs', () => {
    it('should discover multiple bundles and index by contentType', async () => {
      await writeBundle('alpha', { name: 'alpha', contentType: 'lavs/alpha' });
      await writeBundle('beta', { name: 'beta', contentType: 'lavs/beta' });

      const bundles = await discoverBundlesFromDirs([tmpDir]);
      expect(bundles).toHaveLength(2);
      const names = bundles.map((b) => b.name).sort();
      expect(names).toEqual(['alpha', 'beta']);

      const alpha = bundles.find((b) => b.name === 'alpha');
      expect(alpha?.contentType).toBe('lavs/alpha');
    });

    it('should default contentType to name when manifest omits it', async () => {
      await writeBundle('gamma', { name: 'gamma' }); // no contentType
      const bundles = await discoverBundlesFromDirs([tmpDir]);
      const gamma = bundles.find((b) => b.name === 'gamma');
      expect(gamma?.contentType).toBe('gamma');
    });

    it('should deduplicate bundles by name across dirs', async () => {
      await writeBundle('alpha', { name: 'alpha' });
      const subdir = path.join(tmpDir, 'sub');
      await fs.mkdir(subdir, { recursive: true });

      const bundles = await discoverBundlesFromDirs([tmpDir, subdir]);
      // alpha appears once even though we scanned two dirs
      const alphas = bundles.filter((b) => b.name === 'alpha');
      expect(alphas).toHaveLength(1);
    });
  });

  // ─── contentType propagation in SSE ──────────────────────

  describe('contentType propagation in agent-action SSE', () => {
    it('should put the bundle contentType (not name) in the mutation broadcast', async () => {
      // bundle name "todo-manager" but contentType "lavs/todo-list"
      await writeBundle('tm', { name: 'todo-manager', contentType: 'lavs/todo-list', endpointId: 'add', method: 'mutation' });
      await startHost();

      // Connect an SSE client and capture events
      const events = await collectSSEEvents(async () => {
        await request('POST', '/api/call/todo-manager/add', { text: 'x' });
      });

      const agentActions = events.filter((e) => e.event === 'agent-action');
      expect(agentActions.length).toBe(1);
      const payload = JSON.parse(agentActions[0].data);
      // THIS IS THE BUG BEING FIXED: contentType must be 'lavs/todo-list', not 'todo-manager'
      expect(payload.action.contentType).toBe('lavs/todo-list');
      expect(payload.action.contentType).not.toBe('todo-manager');
    });

    it('should broadcast on /api/notify (CLI path) with correct contentType', async () => {
      await writeBundle('dn', { name: 'daily-note', contentType: 'lavs/daily-note', endpointId: 'save', method: 'mutation' });
      await startHost();

      const events = await collectSSEEvents(async () => {
        await request('POST', '/api/notify/daily-note/save', { result: { saved: true } });
      });

      const agentActions = events.filter((e) => e.event === 'agent-action');
      expect(agentActions.length).toBe(1);
      const payload = JSON.parse(agentActions[0].data);
      expect(payload.action.contentType).toBe('lavs/daily-note');
    });
  });

  // ─── broadcast behavior ──────────────────────────────────

  describe('broadcast behavior', () => {
    it('should NOT broadcast for query endpoints', async () => {
      await writeBundle('q', { name: 'reader', contentType: 'lavs/reader', endpointId: 'list', method: 'query' });
      await startHost();

      const events = await collectSSEEvents(async () => {
        await request('POST', '/api/call/reader/list', {});
      });

      const agentActions = events.filter((e) => e.event === 'agent-action');
      expect(agentActions.length).toBe(0);
    });

    it('should broadcast for mutation endpoints', async () => {
      await writeBundle('m', { name: 'writer', contentType: 'lavs/writer', endpointId: 'update', method: 'mutation' });
      await startHost();

      const events = await collectSSEEvents(async () => {
        await request('POST', '/api/call/writer/update', { value: 42 });
      });

      const agentActions = events.filter((e) => e.event === 'agent-action');
      expect(agentActions.length).toBe(1);
    });
  });

  // ─── helper: collect SSE events around an action ─────────

  /**
   * Opens an SSE connection, runs `action`, waits briefly for events to flush,
   * then returns collected events. Each event is { event, data }.
   */
  async function collectSSEEvents(action: () => Promise<void>): Promise<Array<{ event: string; data: string }>> {
    return new Promise(async (resolve) => {
      const events: Array<{ event: string; data: string }> = [];
      const req = http.get(
        { hostname: '127.0.0.1', port: server!.port, path: '/api/events' },
        (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            // SSE events separated by \n\n
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const eventMatch = raw.match(/^event: (.+)$/m);
              const dataMatch = raw.match(/^data: (.+)$/m);
              if (eventMatch) {
                events.push({ event: eventMatch[1].trim(), data: dataMatch ? dataMatch[1].trim() : '' });
              }
            }
          });
        }
      );
      req.on('error', () => {});

      // Give the SSE connection a moment to establish, then run the action
      await new Promise((r) => setTimeout(r, 100));
      await action();
      // Wait for events to flush
      await new Promise((r) => setTimeout(r, 300));
      req.destroy();
      resolve(events);
    });
  }
});
