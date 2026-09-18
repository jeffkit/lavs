import { describe, expect, it } from 'vitest';
import { buildHostUI } from './host-ui';

describe('buildHostUI', () => {
  it('renders the host chrome by default', () => {
    const html = buildHostUI({ port: 7842 });
    expect(html).toContain('<body>');
    expect(html).toContain('<aside>');
    expect(html).toContain('const BARE = false;');
    expect(html).toContain('const BARE_BUNDLE = null;');
  });

  it('bare mode hides the chrome and pins the requested bundle', () => {
    const html = buildHostUI({ port: 7842, bare: true, bundle: 'film-workbench' });
    expect(html).toContain('<body class="bare">');
    expect(html).toContain('.bare header, .bare aside, .bare .view-toolbar');
    expect(html).toContain('const BARE = true;');
    expect(html).toContain('const BARE_BUNDLE = "film-workbench";');
  });

  it('keeps the bridge and SSE wiring in bare mode', () => {
    const html = buildHostUI({ port: 7842, bare: true, bundle: 'x' });
    expect(html).toContain("event.data.type !== 'lavs-call'");
    expect(html).toContain('/api/call/');
    expect(html).toContain("new EventSource('/api/events')");
  });
});
