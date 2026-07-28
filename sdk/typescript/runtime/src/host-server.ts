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
  endpoints: Array<{ id: string; method: string; description?: string }>;
}

export interface LAVSHostOptions {
  /** One or more directories to scan for LAVS bundles. */
  registryDirs: string[];
  port: number;
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
      bundles.push({
        name: manifest.name,
        contentType: manifest.contentType ?? manifest.name,
        version: manifest.version,
        description: manifest.description,
        dir,
        registryDir,
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
 * Create and start the LAVS host HTTP server.
 */
export async function createHostServer(options: LAVSHostOptions): Promise<LAVSHostServer> {
  const { port } = options;

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

  function broadcastAgentAction(bundleName: string, endpointId: string, result?: unknown, contentType?: string): void {
    const payload = {
      type: 'lavs-agent-action',
      action: {
        type: 'tool_executed',
        tool: `lavs_${endpointId}`,
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

  const server = http.createServer(async (req, res) => {
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
      const html = buildHostUI({ port });
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

        // Only broadcast for mutations (not queries) to avoid loops:
        // queries are typically view-initiated and the view already has the result.
        if (endpoint?.method === 'mutation') {
          broadcastAgentAction(bundleName, endpointId, result, bundle.contentType);
        }

        respondJson(res, 200, { result });
      } catch (err: any) {
        respondJson(res, 500, { error: err.message || String(err) });
      }
      return;
    }

    // ── POST /api/notify/:bundle/:endpoint → agent-driven notification ──
    // Called by `lavs call` CLI after executing an endpoint directly.
    const notifyMatch = pathname.match(/^\/api\/notify\/([^/]+)\/([^/]+)$/);
    if (notifyMatch && req.method === 'POST') {
      const bundleName = decodeURIComponent(notifyMatch[1]);
      const endpointId = decodeURIComponent(notifyMatch[2]);
      const body = await readBody(req);
      let result: unknown;
      if (body) { try { result = JSON.parse(body).result; } catch { /* ignore */ } }
      // Resolve contentType so the SSE payload carries the correct routing key.
      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      const bundle = bundles.find((b) => b.name === bundleName);
      broadcastAgentAction(bundleName, endpointId, result, bundle?.contentType);
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

    // ── GET /view/:bundle/* → serve bundle view static files ──
    const viewMatch = pathname.match(/^\/view\/([^/]+)\/(.*)/);
    if (viewMatch && req.method === 'GET') {
      const bundleName = decodeURIComponent(viewMatch[1]);
      const filePath = viewMatch[2] || 'index.html';
      const bundles = await discoverBundlesFromDirs(currentRegistryDirs);
      const bundle = bundles.find((b) => b.name === bundleName);
      if (!bundle) { respondJson(res, 404, { error: 'Bundle not found' }); return; }

      const absPath = path.resolve(bundle.dir, filePath);
      // Security: ensure the file is within the bundle dir
      if (!absPath.startsWith(bundle.dir + path.sep) && absPath !== bundle.dir) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      if (!fs.existsSync(absPath)) {
        res.writeHead(404); res.end('Not Found'); return;
      }

      const ext = path.extname(absPath).toLowerCase();
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      fs.createReadStream(absPath).pipe(res);
      return;
    }

    res.writeHead(404); res.end('Not Found');
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
    notifyAgentAction: broadcastAgentAction,
    addRegistryDir: (dir: string) => {
      const absDir = path.resolve(dir);
      if (!currentRegistryDirs.includes(absDir)) currentRegistryDirs.push(absDir);
    },
    removeRegistryDir: (dir: string) => {
      const absDir = path.resolve(dir);
      currentRegistryDirs = currentRegistryDirs.filter((d) => d !== absDir);
    },
    getRegistryDirs: () => [...currentRegistryDirs],
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
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
