/**
 * LAVS Host Server
 *
 * A lightweight HTTP server that:
 * 1. Serves the LAVS host UI (left sidebar bundle list + right iframe renderer)
 * 2. Provides REST API for calling LAVS endpoints
 * 3. Serves bundle view static files
 * 4. Broadcasts agent-action events via SSE
 *
 * This is the "standalone host" mode: any agent can call
 * `lavs call <endpoint>` via CLI, the host server is notified,
 * and the view auto-refreshes via SSE.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { ManifestLoader } from './loader';
import { LAVSToolGenerator } from './tool-generator';
import { LAVSManifest, Endpoint } from './types';
import { buildHostUI } from './host-ui';
export { buildHostUI } from './host-ui';

export interface BundleInfo {
  name: string;
  contentType: string;
  version: string;
  description?: string;
  dir: string;
  /** The registry directory this bundle was discovered from. */
  registryDir: string;
  hasView: boolean;
  viewEntry?: string; // relative path within bundle dir, e.g. "view/index.html"
  /** Declared static roots (mount → absolute base dir), from manifest.view.staticRoots. */
  staticRoots: Array<{ mount: string; base: string }>;
  endpoints: Array<{ id: string; method: string; description?: string }>;
}

export interface LAVSHostOptions {
  /** One or more directories to scan for LAVS bundles. */
  registryDirs: string[];
  port: number;
  /** Render the view full-bleed with no host chrome (see HostUIOptions.bare). */
  bare?: boolean;
  /** Bundle to auto-open in bare mode (bundle name or contentType). */
  bareBundle?: string | null;
}

/**
 * Scan a directory for lavs.json manifests and return bundle infos.
 * Looks for:
 *  1. registryDir/lavs.json            (single-bundle mode)
 *  2. registryDir/<bundle>/lavs.json   (multi-bundle registry mode)
 */
export async function discoverBundles(registryDir: string): Promise<BundleInfo[]> {
  const loader = new ManifestLoader();
  const bundles: BundleInfo[] = [];

  async function tryLoad(dir: string): Promise<void> {
    const manifestPath = path.join(dir, 'lavs.json');
    if (!fs.existsSync(manifestPath)) return;

    try {
      const manifest = await loader.load(manifestPath);
      const viewEntry = resolveViewEntry(manifest, dir);
      const staticRoots = resolveStaticRoots(manifest, dir);
      bundles.push({
        name: manifest.name,
        contentType: manifest.contentType ?? manifest.name,
        version: manifest.version,
        description: manifest.description,
        dir,
        registryDir,
        staticRoots,
        hasView: !!viewEntry,
        viewEntry,
        endpoints: manifest.endpoints.map((e: Endpoint) => ({
          id: e.id,
          method: e.method,
          description: e.description,
        })),
      });
    } catch {
      // skip invalid manifests silently
    }
  }

  // 1. Try the registry dir itself (single-bundle mode)
  await tryLoad(registryDir);

  // 2. Try immediate sub-directories (multi-bundle registry mode)
  if (fs.existsSync(registryDir)) {
    const entries = fs.readdirSync(registryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await tryLoad(path.join(registryDir, entry.name));
      }
    }
  }

  return bundles;
}

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

/**
 * Serve one static file with full media semantics (issue #4): Content-Length,
 * Accept-Ranges, single-part Range → 206/416 (RFC 7233), HEAD. Caller has
 * already done existence + containment checks.
 */
function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse, absPath: string): void {
  const ext = path.extname(absPath).toLowerCase();
  const type = STATIC_MIME[ext] || 'application/octet-stream';
  const size = fs.statSync(absPath).size;
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  const m = typeof range === 'string' && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

  if (m && (m[1] !== '' || m[2] !== '')) {
    let start: number, end: number;
    if (m[1] === '') {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Length': '0' });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(absPath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(size) });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(absPath).pipe(res);
}

/**
 * Resolve the view entry file for a manifest.
 * Returns a relative path within the bundle dir (e.g. "view/index.html"),
 * or undefined if no view. The loader resolves manifest paths to absolute
 * form for internal use; here we convert back to a bundle-relative path so
 * /api/discover does not leak absolute server filesystem paths to clients.
 */
function resolveViewEntry(manifest: LAVSManifest, bundleDir: string): string | undefined {
  if (!manifest.view?.component) return undefined;
  const comp = manifest.view.component as any;
  if (comp.type === 'local' && comp.path) {
    const abs = path.resolve(bundleDir, comp.path);
    if (fs.existsSync(abs)) {
      return path.relative(bundleDir, abs);
    }
  }
  return undefined;
}

/**
 * Resolve manifest.view.staticRoots to absolute bases. Mount names must be a
 * single path segment (no separators, no dot segments) so the URL namespace
 * stays unambiguous; invalid entries are rejected loudly at discovery time.
 * A mount that shadows an existing top-level path inside the bundle dir wins
 * over the bundle dir entry (explicit declaration beats implicit layout).
 */
function resolveStaticRoots(manifest: LAVSManifest, bundleDir: string): Array<{ mount: string; base: string }> {
  const roots = (manifest.view as any)?.staticRoots;
  if (!Array.isArray(roots) || !roots.length) return [];
  const seen = new Set<string>();
  return roots.map((r: any) => {
    const mount = String(r?.mount ?? '');
    if (!/^[A-Za-z0-9_-]+$/.test(mount) || mount === '.' || mount === '..') {
      throw new Error(`Invalid staticRoot mount "${mount}": must be a single URL segment (letters, digits, _, -)`);
    }
    if (seen.has(mount)) {
      throw new Error(`Duplicate staticRoot mount "${mount}"`);
    }
    seen.add(mount);
    if (typeof r?.path !== 'string' || !r.path) {
      throw new Error(`staticRoot "${mount}" is missing "path"`);
    }
    return { mount, base: path.resolve(bundleDir, r.path) };
  });
}

// SSE client registry: agentId -> list of SSEResponse
type SseClient = {
  res: http.ServerResponse;
  bundleName?: string; // if undefined, receives all events
};

/** Running host server state */
export interface LAVSHostServer {
  server: http.Server;
  port: number;
  /** Notify connected view clients that an agent action occurred */
  notifyAgentAction(bundleName: string, endpointId: string, result?: unknown, contentType?: string): void;
  /** Add a registry directory at runtime */
  addRegistryDir(dir: string): void;
  /** Remove a registry directory at runtime */
  removeRegistryDir(dir: string): void;
  /** Get current registry directories */
  getRegistryDirs(): string[];
  /** Close the server */
  close(): Promise<void>;
}

/**
 * Discover bundles from multiple registry directories.
 * Deduplicates by bundle name (first occurrence wins).
 */
export async function discoverBundlesFromDirs(registryDirs: string[]): Promise<BundleInfo[]> {
  const seen = new Set<string>();
  const result: BundleInfo[] = [];
  for (const dir of registryDirs) {
    const bundles = await discoverBundles(dir);
    for (const b of bundles) {
      if (!seen.has(b.name)) {
        seen.add(b.name);
        result.push(b);
      }
    }
  }
  return result;
}

/**
 * Shared host state + request handler, used by both createHostServer
 * (listens on its own port) and createHostHandler (mountable, issue #14).
 */
interface HostContext {
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
  broadcastAgentAction(bundleName: string, endpointId: string, result?: unknown, contentType?: string, command?: { args?: unknown }): void;
  getRegistryDirs(): string[];
  addRegistryDir(dir: string): void;
  removeRegistryDir(dir: string): void;
}

function createHostContext(options: {
  registryDirs: string[];
  /** Port used only for the URL base of routing/UI (never bound). */
  port?: number;
  bare?: boolean;
  bareBundle?: string | null;
}): HostContext {
  const { port = 0, bare, bareBundle } = options;

  // Mutable registry dirs — managed via /api/registries at runtime
  let currentRegistryDirs: string[] = [...options.registryDirs];

  // SSE clients connected to /api/events
  const sseClients = new Set<SseClient>();

  const toolGen = new LAVSToolGenerator();

  function sendSSE(client: SseClient, event: string, data: unknown): void {
    if (!client.res.writableEnded) {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  function broadcastAgentAction(bundleName: string, endpointId: string, result?: unknown, contentType?: string, command?: { args?: unknown }): void {
    const payload = {
      type: 'lavs-agent-action',
      action: {
        // `tool_executed` = data changed, view should refresh.
        // `ui_command` = pure view-layer command from a `notify` endpoint:
        // no data changed; views handle known commands and MUST fall back
        // to refresh for unknown ones (forward compatibility).
        type: command ? 'ui_command' : 'tool_executed',
        tool: `lavs_${endpointId}`,
        command: command ? endpointId : undefined,
        args: command?.args,
        // contentType is the routing key clients use to direct events to the
        // correct view iframe. MUST be the bundle's declared contentType
        // (manifest.contentType ?? name), NOT the bundle name. Callers that
        // have already discovered the bundle should pass it explicitly;
        // falls back to bundleName if unknown (e.g. CLI notify path).
        contentType: contentType ?? bundleName,
        timestamp: Date.now(),
        result,
      },
    };
    for (const client of sseClients) {
      if (!client.bundleName || client.bundleName === bundleName) {
        sendSSE(client, 'agent-action', payload);
      }
    }
  }

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── GET / → serve host UI ──
    if (pathname === '/' && req.method === 'GET') {
      const html = buildHostUI({ port, bare, bundle: bareBundle ?? null });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ── GET /api/registries → list current registry dirs ──
    if (pathname === '/api/registries' && req.method === 'GET') {
      respondJson(res, 200, { dirs: currentRegistryDirs });
      return;
    }

    // ── POST /api/registries → add a registry dir at runtime ──
    if (pathname === '/api/registries' && req.method === 'POST') {
      const body = await readBody(req);
      let dir: string;
      try { dir = JSON.parse(body).dir; } catch { respondJson(res, 400, { error: 'Invalid JSON' }); return; }
      if (!dir) { respondJson(res, 400, { error: '"dir" is required' }); return; }
      const absDir = path.resolve(dir);
      if (!currentRegistryDirs.includes(absDir)) currentRegistryDirs.push(absDir);
      respondJson(res, 200, { dirs: currentRegistryDirs });
      return;
    }

    // ── DELETE /api/registries → remove a registry dir ──
    if (pathname === '/api/registries' && req.method === 'DELETE') {
      const body = await readBody(req);
      let dir: string;
      try { dir = JSON.parse(body).dir; } catch { respondJson(res, 400, { error: 'Invalid JSON' }); return; }
      const absDir = path.resolve(dir);
      currentRegistryDirs = currentRegistryDirs.filter((d) => d !== absDir);
      respondJson(res, 200, { dirs: currentRegistryDirs });
      return;
    }

    // ── GET /api/discover → list bundles (dynamic, uses currentRegistryDirs) ──
    if (pathname === '/api/discover' && req.method === 'GET') {
      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      respondJson(res, 200, bundles);
      return;
    }

    // ── GET /api/manifest/:bundle → get manifest ──
    const manifestMatch = pathname.match(/^\/api\/manifest\/([^/]+)$/);
    if (manifestMatch && req.method === 'GET') {
      const bundleName = decodeURIComponent(manifestMatch[1]);
      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      const bundle = bundles.find((b) => b.name === bundleName);
      if (!bundle) { respondJson(res, 404, { error: `Bundle '${bundleName}' not found` }); return; }
      const loader = new ManifestLoader();
      const manifest = await loader.load(path.join(bundle.dir, 'lavs.json'));
      respondJson(res, 200, manifest);
      return;
    }

    // ── POST /api/call/:bundle/:endpoint → call endpoint ──
    const callMatch = pathname.match(/^\/api\/call\/([^/]+)\/([^/]+)$/);
    if (callMatch && req.method === 'POST') {
      const bundleName = decodeURIComponent(callMatch[1]);
      const endpointId = decodeURIComponent(callMatch[2]);

      const body = await readBody(req);
      let input: unknown = {};
      if (body) {
        try { input = JSON.parse(body); } catch { /* ignore */ }
      }

      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      const bundle = bundles.find((b) => b.name === bundleName);
      if (!bundle) { respondJson(res, 404, { error: `Bundle '${bundleName}' not found` }); return; }

      try {
        // Load manifest to determine endpoint method
        const loader = new ManifestLoader();
        const manifest = await loader.load(path.join(bundle.dir, 'lavs.json'));
        const endpoint = manifest.endpoints.find((e: Endpoint) => e.id === endpointId);

        const tools = await toolGen.generateTools(bundleName, bundle.dir);
        const tool = tools.find((t) => t.tool.name === `lavs_${endpointId}`);
        if (!tool) { respondJson(res, 404, { error: `Endpoint '${endpointId}' not found` }); return; }

        // Set flag so tool-generator's notifyGlobalHost skips the extra POST
        // (the host itself will broadcast directly below)
        process.env.LAVS_HOST_CALLER = '1';
        const result = await tool.execute(input);
        delete process.env.LAVS_HOST_CALLER;

        // Only broadcast for mutations and notify endpoints to avoid loops:
        // queries are typically view-initiated and the view already has the
        // result. Mutations change data (view refreshes); notify endpoints
        // are pure UI commands (view handles the command).
        if (endpoint?.method === 'mutation') {
          broadcastAgentAction(bundleName, endpointId, result, bundle.contentType);
        } else if (endpoint?.method === 'notify') {
          broadcastAgentAction(bundleName, endpointId, result, bundle.contentType, { args: input });
        }

        respondJson(res, 200, { result });
      } catch (err: any) {
        respondJson(res, 500, { error: err.message || String(err) });
      }
      return;
    }

    // ── POST /api/notify/:bundle/:endpoint → agent-driven notification ──
    // Called by `lavs call` CLI after executing an endpoint directly.
    // `kind: 'ui_command'` + `input` mark a `notify` endpoint: broadcast the
    // command arguments so the view can react, not just refresh.
    const notifyMatch = pathname.match(/^\/api\/notify\/([^/]+)\/([^/]+)$/);
    if (notifyMatch && req.method === 'POST') {
      const bundleName = decodeURIComponent(notifyMatch[1]);
      const endpointId = decodeURIComponent(notifyMatch[2]);
      const body = await readBody(req);
      let result: unknown;
      let input: unknown;
      let isUiCommand = false;
      if (body) {
        try {
          const parsed = JSON.parse(body);
          result = parsed.result ?? parsed.data;
          if (parsed.kind === 'ui_command') { isUiCommand = true; input = parsed.input; }
        } catch { /* ignore */ }
      }
      // Resolve contentType so the SSE payload carries the correct routing key.
      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      const bundle = bundles.find((b) => b.name === bundleName);
      broadcastAgentAction(
        bundleName,
        endpointId,
        result,
        bundle?.contentType,
        isUiCommand ? { args: input } : undefined
      );
      respondJson(res, 200, { ok: true });
      return;
    }

    // ── GET /api/events → SSE stream ──
    if (pathname === '/api/events' && req.method === 'GET') {
      const bundleName = url.searchParams.get('bundle') ?? undefined;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ bundleName })}\n\n`);

      const client: SseClient = { res, bundleName };
      sseClients.add(client);

      // Heartbeat every 30s
      const hb = setInterval(() => {
        if (res.writableEnded) { clearInterval(hb); return; }
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      }, 30_000);

      req.on('close', () => {
        clearInterval(hb);
        sseClients.delete(client);
      });
      return;
    }

    // ── GET/HEAD /view/:bundle/* → serve bundle view static files ──
    // Media semantics (SPEC: host implementation detail): Content-Length,
    // Accept-Ranges, single-part Range → 206/416 per RFC 7233, so <video>
    // can seek and report duration.
    // Security note: the containment check below is LEXICAL (path.resolve).
    // Symlinks inside the bundle pointing OUTSIDE bundle.dir intentionally
    // keep working — bundles link media that lives outside the bundle dir.
    // Do NOT tighten this to a realpath check.
    const viewMatch = pathname.match(/^\/view\/([^/]+)\/(.*)/);
    if (viewMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const bundleName = decodeURIComponent(viewMatch[1]);
      const filePath = viewMatch[2] || 'index.html';
      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      const bundle = bundles.find((b) => b.name === bundleName);
      if (!bundle) { respondJson(res, 404, { error: 'Bundle not found' }); return; }

      // ── Declared static roots (issue #12) ──
      // /view/:bundle/<mount>/<rel> where <mount> is declared in
      // manifest.view.staticRoots. The file is resolved against that root's
      // base and lexically bounded BY THAT ROOT — `..` cannot escape it, and
      // different roots cannot reach each other. An explicit mount shadows a
      // same-named top-level path inside the bundle dir.
      const firstSeg = filePath.split(/[\\/]/)[0];
      const root = bundle.staticRoots?.find((r) => r.mount === firstSeg);
      if (root) {
        const rel = filePath.slice(firstSeg.length).replace(/^[\\/]/, '') || 'index.html';
        const target = path.resolve(root.base, rel);
        if (!target.startsWith(root.base + path.sep) && target !== root.base) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          res.writeHead(404); res.end('Not Found'); return;
        }
        serveStaticFile(req, res, target);
        return;
      }

      const absPath = path.resolve(bundle.dir, filePath);
      // Security: ensure the file is within the bundle dir (lexical — see above)
      if (!absPath.startsWith(bundle.dir + path.sep) && absPath !== bundle.dir) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.writeHead(404); res.end('Not Found'); return;
      }

      serveStaticFile(req, res, absPath);
      return;
    }

    res.writeHead(404); res.end('Not Found');
  }

  return {
    handleRequest,
    broadcastAgentAction,
    getRegistryDirs: () => [...currentRegistryDirs],
    addRegistryDir: (dir: string) => {
      const absDir = path.resolve(dir);
      if (!currentRegistryDirs.includes(absDir)) currentRegistryDirs.push(absDir);
    },
    removeRegistryDir: (dir: string) => {
      const absDir = path.resolve(dir);
      currentRegistryDirs = currentRegistryDirs.filter((d) => d !== absDir);
    },
  };
}

/**
 * Create and start the LAVS host HTTP server.
 */
export async function createHostServer(options: LAVSHostOptions): Promise<LAVSHostServer> {
  const { port, bare, bareBundle } = options;
  const ctx = createHostContext({ registryDirs: options.registryDirs, port, bare, bareBundle });
  const { handleRequest } = ctx;

  const server = http.createServer(async (req, res) => {
    await handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  // When port 0 is passed, the OS assigns an ephemeral port — read the actual one.
  const actualPort = (server.address() as any)?.port ?? port;

  return {
    server,
    port: actualPort,
    notifyAgentAction: ctx.broadcastAgentAction,
    addRegistryDir: ctx.addRegistryDir,
    removeRegistryDir: ctx.removeRegistryDir,
    getRegistryDirs: ctx.getRegistryDirs,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A mountable LAVS host WITHOUT binding a port (issue #14): embedders attach
 * `handler` to their own http.Server for one-process / one-port deployments.
 */
export interface LAVSHostHandler {
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  notifyAgentAction(bundleName: string, endpointId: string, result?: unknown, contentType?: string, command?: { args?: unknown }): void;
  addRegistryDir(dir: string): void;
  removeRegistryDir(dir: string): void;
  getRegistryDirs(): string[];
}

/**
 * Create a mountable LAVS host handler. `prefix` (e.g. '/lavs') is stripped
 * from incoming URLs before routing; without a prefix routes mount at '/'.
 */
export async function createHostHandler(options: {
  registryDirs: string[];
  prefix?: string;
  /** Serve the full host UI (auto-opening `bundle`) at the prefix root. */
  bare?: boolean;
  /** Bundle (name or contentType) to auto-open in the host UI. */
  bundle?: string | null;
}): Promise<LAVSHostHandler> {
  const rawPrefix = options.prefix && options.prefix !== '/' ? options.prefix.replace(/\/+$/, '') : '';
  const ctx = createHostContext({
    registryDirs: options.registryDirs,
    bare: options.bare,
    bareBundle: options.bundle ?? null,
  });
  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (rawPrefix) {
      const url = req.url || '/';
      if (url === rawPrefix) {
        req.url = '/';
      } else if (url.startsWith(rawPrefix + '/')) {
        req.url = url.slice(rawPrefix.length);
      }
      // URLs outside the prefix still reach the router and get 404'd —
      // embedders are expected to dispatch only matching requests here.
    }
    void ctx.handleRequest(req, res);
  };
  return {
    handler,
    notifyAgentAction: ctx.broadcastAgentAction,
    addRegistryDir: ctx.addRegistryDir,
    removeRegistryDir: ctx.removeRegistryDir,
    getRegistryDirs: ctx.getRegistryDirs,
  };
}

// ── Helpers ──

function respondJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', () => resolve(''));
  });
}
