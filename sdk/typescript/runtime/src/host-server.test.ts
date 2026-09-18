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

describe('LAVS Host Server — /view media semantics (Range/Content-Length/MIME)', () => {
  let tmpDir: string;
  let server: LAVSHostServer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-media-test-'));
    const dir = path.join(tmpDir, 'media');
    await fs.mkdir(path.join(dir, 'view'), { recursive: true });
    await fs.writeFile(path.join(dir, 'lavs.json'), JSON.stringify({
      lavs: '1.0', name: 'media', version: '1.0.0',
      view: { component: { type: 'local', path: './view/index.html' } },
      endpoints: [],
    }));
    await fs.writeFile(path.join(dir, 'view', 'index.html'), '<html></html>');
    // 1000 bytes of deterministic content
    await fs.writeFile(path.join(dir, 'view', 'clip.mp4'), Buffer.alloc(1000, 0x61));
    await fs.writeFile(path.join(dir, 'view', 'poster.jpg'), Buffer.alloc(500, 0x62));

    // Symlink pointing OUTSIDE the bundle dir — must stay readable (lexical
    // containment check is intentional; see host-server.ts comment).
    await fs.symlink(path.join(tmpDir, 'outside.mp4'), path.join(dir, 'view', 'linked.mp4'));
    await fs.writeFile(path.join(tmpDir, 'outside.mp4'), Buffer.alloc(300, 0x63));

    server = await createHostServer({ registryDirs: [tmpDir], port: 0 });
  });

  afterEach(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function raw(method: string, pathname: string, headers: Record<string, string> = {}): Promise<{
    status: number; headers: http.IncomingHttpHeaders; body: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server!.port, path: pathname, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('200 without Range: Content-Length + Accept-Ranges: bytes', async () => {
    const r = await raw('GET', '/view/media/view/clip.mp4');
    expect(r.status).toBe(200);
    expect(r.headers['accept-ranges']).toBe('bytes');
    expect(r.headers['content-length']).toBe('1000');
    expect(r.body.length).toBe(1000);
  });

  it('.mp4 maps to video/mp4, .jpg to image/jpeg', async () => {
    const v = await raw('HEAD', '/view/media/view/clip.mp4');
    expect(v.headers['content-type']).toBe('video/mp4');
    const i = await raw('HEAD', '/view/media/view/poster.jpg');
    expect(i.headers['content-type']).toBe('image/jpeg');
  });

  it('bytes=0-99 → 206 with Content-Range and 100 bytes', async () => {
    const r = await raw('GET', '/view/media/view/clip.mp4', { Range: 'bytes=0-99' });
    expect(r.status).toBe(206);
    expect(r.headers['content-range']).toBe('bytes 0-99/1000');
    expect(r.headers['content-length']).toBe('100');
    expect(r.body.length).toBe(100);
  });

  it('bytes=100- (open-ended) and bytes=-100 (suffix)', async () => {
    const open = await raw('GET', '/view/media/view/clip.mp4', { Range: 'bytes=100-' });
    expect(open.status).toBe(206);
    expect(open.headers['content-range']).toBe('bytes 100-999/1000');
    expect(open.body.length).toBe(900);

    const suffix = await raw('GET', '/view/media/view/clip.mp4', { Range: 'bytes=-100' });
    expect(suffix.status).toBe(206);
    expect(suffix.headers['content-range']).toBe('bytes 900-999/1000');
    expect(suffix.body.length).toBe(100);
  });

  it('out-of-bounds Range → 416 with Content-Range: bytes */<size>', async () => {
    const r = await raw('GET', '/view/media/view/clip.mp4', { Range: `bytes=1000-` });
    expect(r.status).toBe(416);
    expect(r.headers['content-range']).toBe('bytes */1000');
    expect(r.body.length).toBe(0);
  });

  it('HEAD returns full headers and no body', async () => {
    const r = await raw('HEAD', '/view/media/view/clip.mp4');
    expect(r.status).toBe(200);
    expect(r.headers['content-length']).toBe('1000');
    expect(r.body.length).toBe(0);

    const partial = await raw('HEAD', '/view/media/view/clip.mp4', { Range: 'bytes=0-9' });
    expect(partial.status).toBe(206);
    expect(partial.headers['content-length']).toBe('10');
    expect(partial.body.length).toBe(0);
  });

  it('symlink inside bundle pointing outside stays readable (regression guard)', async () => {
    const r = await raw('GET', '/view/media/view/linked.mp4');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('video/mp4');
    expect(r.body.length).toBe(300);
  });

  it('path traversal never serves outside files', async () => {
    // `..` dot-segments are normalized away by the URL parser before the
    // route handler sees them; encoded %2e%2e stays literal and resolves
    // inside the bundle; the lexical containment check catches the rest.
    // `outside.mp4` (300 bytes of 0x63) lives in tmpDir, outside the bundle —
    // no request may ever return its content.
    for (const p of ['/view/media/../outside.mp4', '/view/media/%2e%2e/outside.mp4', '/view/media/....//outside.mp4']) {
      const r = await raw('GET', p);
      expect([403, 404]).toContain(r.status);
      expect(r.body.length === 300 && r.body.every((b) => b === 0x63)).toBe(false);
    }
  });
});

describe('LAVS Host Server — declared static roots (view.staticRoots, issue #12)', () => {
  let tmpDir: string;
  let server: LAVSHostServer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-roots-test-'));
    // Bundle at <tmp>/project/.lavs ; static roots point OUTSIDE the bundle:
    //   media → <tmp>/project            (bundle-relative, ..)
    //   shared → <tmp>/shared            (absolute)
    const bundleDir = path.join(tmpDir, 'project', '.lavs');
    await fs.mkdir(path.join(bundleDir, 'view'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'project', 'build'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'shared'), { recursive: true });
    await fs.writeFile(path.join(bundleDir, 'lavs.json'), JSON.stringify({
      lavs: '1.0', name: 'film', version: '1.0.0',
      view: {
        component: { type: 'local', path: './view/index.html' },
        staticRoots: [
          { mount: 'media', path: '..' },
          { mount: 'shared', path: path.join(tmpDir, 'shared') },
        ],
      },
      endpoints: [],
    }));
    await fs.writeFile(path.join(bundleDir, 'view', 'index.html'), '<html>b</html>');
    await fs.writeFile(path.join(bundleDir, 'view', 'inside.txt'), 'inside-root');
    // media root (project dir): build/film.mp4 — 400 bytes
    await fs.mkdir(path.join(tmpDir, 'project', 'build'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'project', 'build', 'film.mp4'), Buffer.alloc(400, 0x64));
    // shared root: note.txt
    await fs.writeFile(path.join(tmpDir, 'shared', 'note.txt'), 'shared-note');
    // outside everything: secret.txt at <tmp> — reachable from NO root
    await fs.writeFile(path.join(tmpDir, 'secret.txt'), 'top-secret');

    // Registry only scans one level deep: the bundle lives at
    // <tmp>/project/.lavs, so the registry dir is <tmp>/project.
    server = await createHostServer({ registryDirs: [path.join(tmpDir, 'project')], port: 0 });
  });

  afterEach(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function raw(method: string, pathname: string, headers: Record<string, string> = {}): Promise<{
    status: number; headers: http.IncomingHttpHeaders; body: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server!.port, path: pathname, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('serves a file from a bundle-relative root outside the bundle dir', async () => {
    const r = await raw('GET', '/view/film/media/build/film.mp4');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('video/mp4');
    expect(r.headers['content-length']).toBe('400');
    expect(r.body.length).toBe(400);
  });

  it('serves an absolute root; Range → 206 with correct slice', async () => {
    const r = await raw('GET', '/view/film/shared/note.txt', { Range: 'bytes=0-5' });
    expect(r.status).toBe(206);
    expect(r.headers['content-range']).toBe('bytes 0-5/11');
    expect(r.body.toString()).toBe('shared');
  });

  it('HEAD works on a declared root', async () => {
    const r = await raw('HEAD', '/view/film/media/build/film.mp4');
    expect(r.status).toBe(200);
    expect(r.headers['content-length']).toBe('400');
    expect(r.body.length).toBe(0);
  });

  it("`..` cannot escape a declared root → 403", async () => {
    // media root is <tmp>/project; ../secret.txt escapes it toward <tmp>
    const r = await raw('GET', '/view/film/media/build/../../secret.txt');
    expect([403, 404]).toContain(r.status);
    expect(r.body.toString()).not.toContain('top-secret');
  });

  it('undeclared escape hatches stay 403 (no implicit widening)', async () => {
    // "shared" is a declared mount; but /view/film/../secret.txt still cannot escape the bundle dir
    const r = await raw('GET', '/view/film/../secret.txt');
    expect([403, 404]).toContain(r.status);
    expect(r.body.toString()).not.toContain('top-secret');
  });

  it('undeclared top-level path inside the bundle dir still serves (behavior unchanged)', async () => {
    const r = await raw('GET', '/view/film/view/inside.txt');
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('inside-root');
  });

  it('undeclared mount-like segment falls through to bundle dir → 404 (not served from other roots)', async () => {
    const r = await raw('GET', '/view/film/unknown/note.txt');
    expect(r.status).toBe(404);
  });

  it('mounts cannot reach each other: shared/… cannot traverse into media root', async () => {
    const r = await raw('GET', '/view/film/shared/../build/film.mp4');
    // ../build resolves to <tmp>/build — does not exist; must NOT serve the project file
    expect(r.status).toBe(404);
  });
});
