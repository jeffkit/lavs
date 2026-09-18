"""
Host page template for the Python LavsHost (issue #16, layer 3).

Reuses the exact same `lavs-view.iife.js` (@lavs/view build) as the Node host,
so bundle views need zero changes between hosts: bundle list + iframe +
postMessage bridge + SSE agent-action routing.
"""

from __future__ import annotations

from importlib import resources


def render_host_page() -> str:
    return _PAGE


def view_sdk_js() -> bytes:
    """Contents of the bundled @lavs/view IIFE (served at /lavs-view.iife.js)."""
    return resources.files("lavs_runtime").joinpath("assets/lavs-view.iife.js").read_bytes()


_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>LAVS Host (Python)</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #16181d; color: #e8eaed; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 10px 16px; border-bottom: 1px solid #2a2d34; display: flex; align-items: center; gap: 8px; }
  .logo { font-weight: 700; color: #a78bfa; }
  .badge { font-size: 11px; border: 1px solid #4b5563; border-radius: 4px; padding: 1px 6px; color: #9ca3af; }
  #main { flex: 1; display: flex; min-height: 0; }
  aside { width: 220px; border-right: 1px solid #2a2d34; overflow: auto; padding: 8px; }
  .bundle { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .bundle:hover { background: #22252c; }
  .bundle.active { background: #312e81; }
  .bundle .ct { display: block; font-size: 11px; color: #9ca3af; margin-top: 2px; }
  #viewContainer { flex: 1; position: relative; background: #fff; }
  iframe { width: 100%; height: 100%; border: none; display: none; background: #fff; }
  iframe.active { display: block; }
  .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9ca3af; }
</style>
</head>
<body>
  <header><span class="logo">LAVS</span><span class="badge">Host · Python</span></header>
  <div id="main">
    <aside id="bundleList"></aside>
    <div id="viewContainer"><div class="empty">Select a bundle</div><iframe data-bundle=""></iframe></div>
  </div>

  <!-- Same @lavs/view build the Node host flow relies on: bridge + UI commands + refresh fallback -->
  <script src="/lavs-view.iife.js"></script>
  <script>
    const frames = new Map();   // bundle name -> iframe
    const listEl = document.getElementById('bundleList');
    const container = document.getElementById('viewContainer');
    let activeName = null;

    async function api(path, opts) {
      const r = await fetch(path, opts);
      return r.json();
    }

    async function loadBundles() {
      const bundles = await api('/api/discover');
      listEl.innerHTML = '';
      for (const b of bundles) {
        if (!b.hasView) continue;
        const div = document.createElement('div');
        div.className = 'bundle';
        div.dataset.name = b.name;
        div.innerHTML = `<b>${b.name}</b><span class="ct">${b.contentType}</span>`;
        div.onclick = () => openBundle(b);
        listEl.appendChild(div);
      }
      if (!activeName && bundles.length) openBundle(bundles.find(b => b.hasView) || bundles[0]);
    }

    function openBundle(b) {
      activeName = b.name;
      document.querySelectorAll('.bundle').forEach(el =>
        el.classList.toggle('active', el.dataset.name === b.name));
      let frame = frames.get(b.name);
      if (!frame) {
        frame = document.createElement('iframe');
        frame.dataset.bundle = b.name;
        container.appendChild(frame);
        frames.set(b.name, frame);
        // contentWindow is available right after appendChild — register the
        // bridge now, NOT on load (view scripts run during parse).
        if (frame.contentWindow) frames.set('__src__' + b.name, frame.contentWindow);
      }
      frame.src = `/view/${encodeURIComponent(b.name)}/${b.viewEntry || 'view/index.html'}`;
      frame.classList.add('active');
      document.querySelector('.empty').style.display = 'none';
    }

    // ── postMessage bridge: route lavs-call to the right bundle ──
    window.addEventListener('message', async (event) => {
      if (!event.data || event.data.type !== 'lavs-call') return;
      const { id, endpoint, input } = event.data;
      const source = event.source;
      let bundleName = null;
      for (const [name, f] of frames) {
        if (name.startsWith('__src__')) continue;
        if (f.contentWindow === source) { bundleName = f.dataset.bundle; break; }
      }
      if (!bundleName) {
        if (source) source.postMessage({ type: 'lavs-error', id, error: 'view not registered yet' }, '*');
        return;
      }
      try {
        const data = await api(`/api/call/${encodeURIComponent(bundleName)}/${encodeURIComponent(endpoint)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input || {}),
        });
        source.postMessage({ type: 'lavs-result', id, result: data.result }, '*');
      } catch (err) {
        source.postMessage({ type: 'lavs-error', id, error: String(err) }, '*');
      }
    });

    // ── SSE: forward agent-actions into the matching iframe ──
    const es = new EventSource('/api/events');
    es.addEventListener('agent-action', (e) => {
      let payload;
      try { payload = JSON.parse(e.data); } catch { return; }
      const ct = payload.action && payload.action.contentType;
      for (const [name, f] of frames) {
        if (name.startsWith('__src__')) continue;
        if (f.classList.contains('active')) f.contentWindow.postMessage(payload, '*');
      }
    });

    loadBundles();
  </script>
</body>
</html>
"""
