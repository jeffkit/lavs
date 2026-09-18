/**
 * LAVS Host UI Template
 *
 * Generates the HTML for the standalone LAVS host:
 * - Left sidebar: workspace (registry dir) management + bundle list grouped by dir
 * - Right area: sandboxed iframe for the active bundle's view
 * - postMessage bridge: intercepts lavs-call from iframe → calls /api/call → sends lavs-result
 * - SSE connection to /api/events → forwards lavs-agent-action into the active iframe
 *
 * Supports:
 * - Runtime dir management via /api/registries (add / remove)
 * - URL ?dir= params: auto-add dirs on page load (e.g. http://localhost:7842/?dir=/path/to/bundles)
 * - Bundles grouped by registry dir when multiple dirs are active
 */

export interface HostUIOptions {
  port: number;
  /**
   * Bare mode: hide the host chrome (header, sidebar, view toolbar) and let the
   * single view own the whole page. The postMessage bridge and SSE wiring stay
   * identical, so `lavs call` still drives the view.
   */
  bare?: boolean;
  /** Bundle to auto-open in bare mode (bundle name or contentType). */
  bundle?: string | null;
}

export function buildHostUI({ port, bare = false, bundle = null }: HostUIOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LAVS Host</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface2: #141720;
      --border: #2a2d3a;
      --accent: #6366f1;
      --accent-light: #818cf8;
      --text: #e2e8f0;
      --text-muted: #64748b;
      --danger: #f87171;
      --sidebar-w: 240px;
      --header-h: 48px;
    }

    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      overflow: hidden;
    }

    /* ── Header ── */
    header {
      height: var(--header-h);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    header .logo { font-weight: 700; font-size: 16px; letter-spacing: -0.3px; color: var(--accent-light); }
    header .badge {
      background: var(--accent); color: #fff; font-size: 10px;
      font-weight: 600; padding: 2px 6px; border-radius: 999px;
    }
    header .status {
      margin-left: auto; display: flex; align-items: center;
      gap: 6px; color: var(--text-muted); font-size: 12px;
    }
    header .status .dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
    header .status .dot.idle { background: var(--text-muted); }

    /* ── Main layout ── */
    .layout { display: flex; flex: 1; overflow: hidden; }

    /* ── Sidebar ── */
    aside {
      width: var(--sidebar-w);
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex-shrink: 0;
    }
    .section-header {
      padding: 10px 12px 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-header button {
      background: none; border: none; cursor: pointer;
      color: var(--accent-light); font-size: 14px; line-height: 1;
      padding: 0 2px;
    }
    .section-header button:hover { color: var(--text); }

    /* Workspace list */
    .workspace-list { padding: 0 8px 4px; }
    .workspace-item {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px; border-radius: 5px;
      font-size: 12px; color: var(--text-muted);
    }
    .workspace-item .ws-path {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .workspace-item .ws-remove {
      background: none; border: none; cursor: pointer;
      color: var(--text-muted); font-size: 13px;
      padding: 0; flex-shrink: 0;
      line-height: 1;
    }
    .workspace-item .ws-remove:hover { color: var(--danger); }

    /* Add dir form */
    .add-dir-form {
      padding: 4px 8px 8px;
      display: none;
    }
    .add-dir-form.open { display: flex; flex-direction: column; gap: 4px; }
    .add-dir-form input {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 5px 8px;
      border-radius: 5px;
      font-size: 12px;
      outline: none;
      width: 100%;
    }
    .add-dir-form input:focus { border-color: var(--accent); }
    .add-dir-form .form-btns { display: flex; gap: 4px; }
    .add-dir-form .form-btns button {
      flex: 1; background: var(--accent); color: #fff; border: none;
      padding: 5px; border-radius: 5px; cursor: pointer; font-size: 11px;
    }
    .add-dir-form .form-btns button.cancel {
      background: var(--surface2); color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .add-dir-form .form-btns button:hover { opacity: 0.85; }

    /* Separator */
    .sep { border-top: 1px solid var(--border); margin: 4px 0; }

    /* Bundle list */
    .bundle-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }

    .dir-group { margin-bottom: 4px; }
    .dir-group-label {
      padding: 6px 8px 3px;
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .bundle-item {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 7px;
      cursor: pointer; transition: background 0.12s; user-select: none;
    }
    .bundle-item:hover { background: rgba(99,102,241,0.1); }
    .bundle-item.active { background: rgba(99,102,241,0.2); color: var(--accent-light); }
    .bundle-item .icon {
      width: 26px; height: 26px; border-radius: 6px;
      background: var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; flex-shrink: 0;
    }
    .bundle-item .info { min-width: 0; }
    .bundle-item .info .name {
      font-weight: 500; font-size: 13px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bundle-item .info .ct {
      font-size: 10px; color: var(--text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .no-bundles { padding: 16px 12px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }

    /* ── View area ── */
    main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .view-toolbar {
      height: 38px; display: flex; align-items: center; gap: 8px;
      padding: 0 14px; background: var(--surface); border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .view-toolbar .bundle-name { font-weight: 600; font-size: 13px; }
    .view-toolbar .endpoint-count { font-size: 11px; color: var(--text-muted); }
    .view-toolbar .refresh-btn {
      margin-left: auto; background: transparent; border: 1px solid var(--border);
      color: var(--text-muted); padding: 3px 10px; border-radius: 5px;
      cursor: pointer; font-size: 12px; transition: color 0.12s, border-color 0.12s;
    }
    .view-toolbar .refresh-btn:hover { color: var(--text); border-color: var(--accent); }

    .view-frame-wrap { flex: 1; position: relative; overflow: hidden; }
    .empty-state {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 12px; color: var(--text-muted);
    }
    .empty-state .big-icon { font-size: 40px; }
    .empty-state p { font-size: 13px; }
    .empty-state code {
      background: var(--surface); border: 1px solid var(--border);
      padding: 2px 7px; border-radius: 4px;
      font-size: 12px; color: var(--accent-light);
    }
    .empty-state .add-hint {
      margin-top: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12px;
      text-align: center;
      line-height: 1.7;
      color: var(--text-muted);
      max-width: 380px;
    }
    /* ── Bare mode: full-bleed view, no host chrome ── */
    .bare header, .bare aside, .bare .view-toolbar, .bare .empty-state { display: none !important; }
  </style>
</head>
<body${bare ? ' class="bare"' : ''}>
  <header>
    <span class="logo">LAVS</span>
    <span class="badge">Host</span>
    <div class="status">
      <span class="dot" id="sseStatus"></span>
      <span id="sseLabel">connecting…</span>
    </div>
  </header>

  <div class="layout">
    <aside>
      <!-- Workspaces section -->
      <div class="section-header">
        Workspaces
        <button id="addDirBtn" title="Add registry directory" onclick="toggleAddForm()">＋</button>
      </div>
      <div class="workspace-list" id="workspaceList"></div>
      <div class="add-dir-form" id="addDirForm">
        <input id="dirInput" type="text" placeholder="/absolute/path/to/bundles" />
        <div class="form-btns">
          <button onclick="submitAddDir()">Add</button>
          <button class="cancel" onclick="toggleAddForm()">Cancel</button>
        </div>
      </div>

      <div class="sep"></div>

      <!-- Bundle list -->
      <div class="section-header">View Bundles</div>
      <div class="bundle-list" id="bundleList"></div>
    </aside>

    <main>
      <div class="view-toolbar" id="viewToolbar" style="display:none">
        <span class="bundle-name" id="activeBundleName"></span>
        <span class="endpoint-count" id="activeEndpointCount"></span>
        <button class="refresh-btn" onclick="refreshView()">↺ Refresh</button>
      </div>
      <div class="view-frame-wrap">
        <div class="empty-state" id="emptyState">
          <div class="big-icon">📦</div>
          <p>Select a bundle from the sidebar to open its view.</p>
          <div class="add-hint">
            Tip: you can open this page with a <code>?dir=</code> URL param to auto-add a workspace:<br>
            <code>http://localhost:${port}/?dir=/your/bundles/path</code>
          </div>
        </div>
        <!-- View iframes are created dynamically and pooled here (one per bundle),
             so switching bundles preserves each view's state. -->
        <div id="viewContainer" style="width:100%;height:100%"></div>
      </div>
    </main>
  </div>

  <script>
    const PORT = ${port};
    const BARE = ${bare ? 'true' : 'false'};
    const BARE_BUNDLE = ${JSON.stringify(bundle)};
    let state = { dirs: [], bundles: [] };
    let activeBundleName = null;

    // iframe pool: one persistent iframe per opened bundle, so switching bundles
    // preserves each view's state (scroll, in-flight requests, JS state).
    // bundleFrames: bundleName → <iframe> element (the pooled frames)
    // sourceToBundle: contentWindow → bundleName (reverse lookup for postMessage replies)
    const bundleFrames = new Map();
    const sourceToBundle = new Map();

    // ── Helpers ──
    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function shortPath(p) {
      const parts = p.replace(/\\\\/g, '/').split('/').filter(Boolean);
      return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
    }

    // ── API calls ──
    async function fetchState() {
      const [regsResp, bundlesResp] = await Promise.all([
        fetch('/api/registries'),
        fetch('/api/discover'),
      ]);
      state.dirs = (await regsResp.json()).dirs || [];
      state.bundles = await bundlesResp.json();
    }

    async function addDir(dir) {
      await fetch('/api/registries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      await fetchState();
      renderAll();
    }

    async function removeDir(dir) {
      await fetch('/api/registries', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      await fetchState();
      renderAll();
    }

    // ── Render ──
    function renderWorkspaces() {
      const el = document.getElementById('workspaceList');
      if (!state.dirs.length) {
        el.innerHTML = '<div class="no-bundles" style="padding:6px 8px">No workspaces. Click ＋ to add.</div>';
        return;
      }
      el.innerHTML = state.dirs.map(d => \`
        <div class="workspace-item">
          <span class="ws-path" title="\${escHtml(d)}">\${escHtml(shortPath(d))}</span>
          <button class="ws-remove" title="Remove" onclick="removeDir(\${JSON.stringify(d)})">×</button>
        </div>
      \`).join('');
    }

    function renderBundles() {
      const el = document.getElementById('bundleList');
      if (!state.bundles.length) {
        const hint = state.dirs.length
          ? 'No bundles found. Make sure each bundle has a <b>lavs.json</b>.'
          : 'Add a workspace directory to see bundles.';
        el.innerHTML = \`<div class="no-bundles">\${hint}</div>\`;
        return;
      }

      const multiDir = state.dirs.length > 1;

      // Group bundles by registryDir
      const groups = new Map();
      for (const b of state.bundles) {
        const key = b.registryDir || b.dir;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }

      let html = '';
      for (const [regDir, bundles] of groups) {
        if (multiDir) {
          html += \`<div class="dir-group-label" title="\${escHtml(regDir)}">\${escHtml(shortPath(regDir))}</div>\`;
        }
        html += bundles.map(b => \`
          <div class="bundle-item\${b.name === activeBundleName ? ' active' : ''}"
               onclick="selectBundle('\${escHtml(b.name)}')"
               data-name="\${escHtml(b.name)}">
            <div class="icon">\${b.hasView ? '🖼' : '📊'}</div>
            <div class="info">
              <div class="name">\${escHtml(b.name)}</div>
              <div class="ct">\${escHtml(b.contentType)}</div>
            </div>
          </div>
        \`).join('');
      }
      el.innerHTML = html;
    }

    function renderAll() {
      renderWorkspaces();
      renderBundles();
    }

    // ── Select bundle ──
    // Switches the visible view to the named bundle. Iframes are pooled: once
    // created for a bundle, they are hidden (not destroyed) so the view's state
    // survives switching back and forth.
    function selectBundle(name) {
      const bundle = state.bundles.find(b => b.name === name);
      if (!bundle) return;
      activeBundleName = name;

      if (!BARE) renderBundles(); // update active highlight

      if (!BARE) {
        document.getElementById('viewToolbar').style.display = 'flex';
        document.getElementById('activeBundleName').textContent = bundle.name;
        document.getElementById('activeEndpointCount').textContent =
          \`\${bundle.endpoints.length} endpoint\${bundle.endpoints.length !== 1 ? 's' : ''}\`;
      }

      const emptyState = document.getElementById('emptyState');
      const container = document.getElementById('viewContainer');

      if (bundle.hasView) {
        if (!BARE) emptyState.style.display = 'none';
        // Hide all pooled frames, then show (or create) the selected bundle's frame.
        for (const [bundleName, frame] of bundleFrames) {
          frame.style.display = (bundleName === name) ? 'block' : 'none';
        }
        let frame = bundleFrames.get(name);
        if (!frame) {
          frame = document.createElement('iframe');
          frame.style.cssText = 'width:100%;height:100%;border:none;background:#fff;display:block';
          frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
          frame.setAttribute('data-bundle', name);
          frame.src = \`/view/\${encodeURIComponent(name)}/\${bundle.viewEntry || 'view/index.html'}\`;
          container.appendChild(frame);
          bundleFrames.set(name, frame);
          // Register contentWindow → bundleName IMMEDIATELY: contentWindow is
          // available right after appendChild, while the frame's inline
          // <script> runs before the load event. Registering only on load
          // dropped the view's very first lavs-call (issue #6).
          if (frame.contentWindow) sourceToBundle.set(frame.contentWindow, name);
          // Keep the load-time registration as a backstop in case the
          // contentWindow is re-created (e.g. navigation).
          frame.addEventListener('load', () => {
            if (frame.contentWindow) sourceToBundle.set(frame.contentWindow, name);
          });
        }
        frame.style.display = 'block';
      } else {
        emptyState.style.display = 'flex';
        emptyState.innerHTML = \`
          <div class="big-icon">📋</div>
          <p><b>\${escHtml(name)}</b> has no view component.</p>
          <p>Endpoints: \${bundle.endpoints.map(e => '<code>' + escHtml(e.id) + '</code>').join(', ')}</p>
        \`;
      }
    }

    function refreshView() {
      const frame = bundleFrames.get(activeBundleName);
      if (frame && frame.src) { const s = frame.src; frame.src = ''; frame.src = s; }
    }

    // ── Add dir form ──
    function toggleAddForm() {
      const form = document.getElementById('addDirForm');
      form.classList.toggle('open');
      if (form.classList.contains('open')) {
        document.getElementById('dirInput').focus();
      }
    }

    async function submitAddDir() {
      const dir = document.getElementById('dirInput').value.trim();
      if (!dir) return;
      document.getElementById('dirInput').value = '';
      toggleAddForm();
      await addDir(dir);
    }

    document.getElementById('dirInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAddDir();
      if (e.key === 'Escape') toggleAddForm();
    });

    // ── postMessage bridge ──
    // Routes lavs-call from any pooled iframe to /api/call/:bundle/:endpoint.
    // The bundle name is resolved from event.source (the sending iframe's
    // contentWindow), so each coexisting view calls its own bundle's endpoints.
    window.addEventListener('message', async (event) => {
      if (!event.data || event.data.type !== 'lavs-call') return;
      const { id, endpoint, params, input } = event.data;
      const source = event.source;
      // Resolve the sending iframe: direct map first, then scan pooled frames.
      // Never drop silently — an unanswered call leaves the view's promise
      // pending forever with no visible error (issue #6).
      const bundleName = source
        ? sourceToBundle.get(source)
          ?? [...bundleFrames.entries()].find(([, f]) => f.contentWindow === source)?.[0]
        : null;
      if (!bundleName) {
        if (source) {
          source.postMessage({ type: 'lavs-error', id, error: 'view not registered yet' }, '*');
        }
        return;
      }

      try {
        const resp = await fetch(
          \`/api/call/\${encodeURIComponent(bundleName)}/\${encodeURIComponent(endpoint)}\`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params ?? input ?? {}) }
        );
        const data = await resp.json();
        if (source) {
          source.postMessage(
            resp.ok ? { type: 'lavs-result', id, result: data.result }
                    : { type: 'lavs-error', id, error: data.error },
            '*'
          );
        }
      } catch (err) {
        if (source) {
          source.postMessage({ type: 'lavs-error', id, error: String(err) }, '*');
        }
      }
    });

    // ── SSE ──
    function connectSSE() {
      const es = new EventSource('/api/events');
      const dot = document.getElementById('sseStatus');
      const label = document.getElementById('sseLabel');

      es.addEventListener('connected', () => { dot.classList.remove('idle'); label.textContent = 'live'; });
      es.addEventListener('agent-action', (e) => {
        let payload;
        try { payload = JSON.parse(e.data); } catch { return; }
        // Route the event to the bundle whose contentType matches — NOT to
        // whatever iframe happens to be visible. A mutation in bundle A must
        // only refresh bundle A's view, even if bundle B is currently on top.
        const ct = payload.action && payload.action.contentType;
        if (!ct) return;
        const targetBundle = state.bundles.find(b => b.contentType === ct);
        if (!targetBundle) return;
        const frame = bundleFrames.get(targetBundle.name);
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage(payload, '*');
        }
      });
      es.addEventListener('heartbeat', () => {});
      es.onerror = () => { dot.classList.add('idle'); label.textContent = 'reconnecting…'; };
    }

    // ── URL ?dir= param support ──
    async function addDirsFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const dirs = params.getAll('dir');
      for (const d of dirs) {
        if (d) {
          await fetch('/api/registries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: d }),
          });
        }
      }
    }

    // ── Auto-select from URL hash ──
    function applyHash() {
      // Bare mode: open the requested bundle (or the only one) with no chrome.
      if (BARE_BUNDLE) {
        const b = state.bundles.find(b => b.name === BARE_BUNDLE || b.contentType === BARE_BUNDLE);
        if (b) { selectBundle(b.name); return; }
      }
      const hash = decodeURIComponent(location.hash.replace('#', ''));
      if (hash) {
        const b = state.bundles.find(b => b.name === hash || b.contentType === hash);
        if (b) { selectBundle(b.name); return; }
      }
      if (state.bundles.length === 1) selectBundle(state.bundles[0].name);
    }

    // ── Init ──
    (async () => {
      await addDirsFromUrl();
      await fetchState();
      renderAll();
      applyHash();
      connectSSE();
    })();
  </script>
</body>
</html>`;
}
