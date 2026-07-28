/**
 * LAVS Host UI Template
 *
 * Generates the HTML for the standalone LAVS host:
 * - Left sidebar with bundle list
 * - Right area with sandboxed iframe for the active bundle's view
 * - postMessage bridge: intercepts lavs-call from iframe → calls /api/call → sends back lavs-result
 * - SSE connection to /api/events → forwards lavs-agent-action into the active iframe
 */

import type { BundleInfo } from './host-server';

export interface HostUIOptions {
  bundles: BundleInfo[];
  port: number;
}

export function buildHostUI({ bundles, port }: HostUIOptions): string {
  const bundleData = JSON.stringify(bundles);

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
      --border: #2a2d3a;
      --accent: #6366f1;
      --accent-light: #818cf8;
      --text: #e2e8f0;
      --text-muted: #64748b;
      --sidebar-w: 220px;
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
    header .logo {
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.3px;
      color: var(--accent-light);
    }
    header .badge {
      background: var(--accent);
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 999px;
    }
    header .status {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
      font-size: 12px;
    }
    header .status .dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #22c55e;
    }
    header .status .dot.idle { background: var(--text-muted); }

    /* ── Main layout ── */
    .layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

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
    .sidebar-title {
      padding: 12px 14px 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    .bundle-list {
      flex: 1;
      overflow-y: auto;
      padding: 0 8px 8px;
    }
    .bundle-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 7px;
      cursor: pointer;
      transition: background 0.12s;
      user-select: none;
    }
    .bundle-item:hover { background: rgba(99,102,241,0.1); }
    .bundle-item.active { background: rgba(99,102,241,0.2); color: var(--accent-light); }
    .bundle-item .icon {
      width: 28px; height: 28px;
      border-radius: 6px;
      background: var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
    }
    .bundle-item .info { min-width: 0; }
    .bundle-item .info .name {
      font-weight: 500;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bundle-item .info .ct {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .no-bundles {
      padding: 20px 14px;
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.6;
    }

    /* ── View area ── */
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .view-toolbar {
      height: 38px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .view-toolbar .bundle-name {
      font-weight: 600;
      font-size: 13px;
    }
    .view-toolbar .endpoint-count {
      font-size: 11px;
      color: var(--text-muted);
    }
    .view-toolbar .refresh-btn {
      margin-left: auto;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 3px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      transition: color 0.12s, border-color 0.12s;
    }
    .view-toolbar .refresh-btn:hover {
      color: var(--text);
      border-color: var(--accent);
    }

    .view-frame-wrap {
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    #viewFrame {
      width: 100%;
      height: 100%;
      border: none;
      background: #fff;
    }
    .empty-state {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-muted);
    }
    .empty-state .big-icon { font-size: 40px; }
    .empty-state p { font-size: 13px; }
    .empty-state code {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--accent-light);
    }
  </style>
</head>
<body>
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
      <div class="sidebar-title">View Bundles</div>
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
          <p>Or run <code>lavs view &lt;contentType&gt;</code> to jump directly.</p>
        </div>
        <iframe id="viewFrame" style="display:none" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
      </div>
    </main>
  </div>

  <script>
    const BUNDLES = ${bundleData};
    const PORT = ${port};
    let activeBundle = null;
    let pendingCalls = new Map();
    let callIdCounter = 0;

    // ── Render sidebar ──
    function renderSidebar() {
      const list = document.getElementById('bundleList');
      if (!BUNDLES.length) {
        list.innerHTML = '<div class="no-bundles">No bundles found in this directory.<br><br>Run <b>lavs init</b> to create one.</div>';
        return;
      }
      list.innerHTML = BUNDLES.map(b => \`
        <div class="bundle-item" onclick="selectBundle('\${escHtml(b.name)}')" data-name="\${escHtml(b.name)}">
          <div class="icon">\${b.hasView ? '🖼' : '📊'}</div>
          <div class="info">
            <div class="name">\${escHtml(b.name)}</div>
            <div class="ct">\${escHtml(b.contentType)}</div>
          </div>
        </div>
      \`).join('');
    }

    // ── Select bundle ──
    function selectBundle(name) {
      activeBundle = BUNDLES.find(b => b.name === name);
      if (!activeBundle) return;

      // Sidebar highlight
      document.querySelectorAll('.bundle-item').forEach(el => el.classList.remove('active'));
      const item = document.querySelector(\`.bundle-item[data-name="\${name}"]\`);
      if (item) item.classList.add('active');

      // Toolbar
      document.getElementById('viewToolbar').style.display = 'flex';
      document.getElementById('activeBundleName').textContent = activeBundle.name;
      document.getElementById('activeEndpointCount').textContent =
        \`\${activeBundle.endpoints.length} endpoint\${activeBundle.endpoints.length !== 1 ? 's' : ''}\`;

      // Frame
      const frame = document.getElementById('viewFrame');
      const emptyState = document.getElementById('emptyState');

      if (activeBundle.hasView) {
        emptyState.style.display = 'none';
        frame.style.display = 'block';
        frame.src = \`/view/\${encodeURIComponent(name)}/\${activeBundle.viewEntry || 'view/index.html'}\`;
      } else {
        // No view component — show JSON endpoint list
        emptyState.style.display = 'flex';
        emptyState.innerHTML = \`
          <div class="big-icon">📋</div>
          <p><b>\${escHtml(name)}</b> has no view component.</p>
          <p>Endpoints: \${activeBundle.endpoints.map(e => '<code>' + escHtml(e.id) + '</code>').join(', ')}</p>
        \`;
        frame.style.display = 'none';
      }
    }

    function refreshView() {
      const frame = document.getElementById('viewFrame');
      if (frame.src) { const s = frame.src; frame.src = ''; frame.src = s; }
    }

    // ── postMessage bridge ──
    window.addEventListener('message', async (event) => {
      if (!event.data || event.data.type !== 'lavs-call') return;
      const { id, endpoint, input } = event.data;
      if (!activeBundle) return;

      try {
        const resp = await fetch(
          \`/api/call/\${encodeURIComponent(activeBundle.name)}/\${encodeURIComponent(endpoint)}\`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input ?? {}) }
        );
        const data = await resp.json();
        const frame = document.getElementById('viewFrame');
        if (frame.contentWindow) {
          frame.contentWindow.postMessage(
            resp.ok ? { type: 'lavs-result', id, result: data.result }
                    : { type: 'lavs-error', id, error: data.error },
            '*'
          );
        }
      } catch (err) {
        const frame = document.getElementById('viewFrame');
        if (frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'lavs-error', id, error: String(err) }, '*');
        }
      }
    });

    // ── SSE: receive agent-action events ──
    function connectSSE() {
      const es = new EventSource('/api/events');
      const dot = document.getElementById('sseStatus');
      const label = document.getElementById('sseLabel');

      es.addEventListener('connected', () => {
        dot.classList.remove('idle');
        label.textContent = 'live';
      });

      es.addEventListener('agent-action', (e) => {
        let payload;
        try { payload = JSON.parse(e.data); } catch { return; }
        // Forward to active iframe if content-type matches
        const frame = document.getElementById('viewFrame');
        if (frame.style.display !== 'none' && frame.contentWindow) {
          frame.contentWindow.postMessage(payload, '*');
        }
      });

      es.addEventListener('heartbeat', () => {});

      es.onerror = () => {
        dot.classList.add('idle');
        label.textContent = 'reconnecting…';
      };
    }

    // ── Auto-select from URL hash ──
    function applyHash() {
      const hash = location.hash.replace('#', '');
      if (hash && BUNDLES.find(b => b.name === hash || b.contentType === hash)) {
        selectBundle(BUNDLES.find(b => b.name === hash || b.contentType === hash).name);
      } else if (BUNDLES.length === 1) {
        selectBundle(BUNDLES[0].name);
      }
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Init ──
    renderSidebar();
    applyHash();
    connectSSE();
  </script>
</body>
</html>`;
}
