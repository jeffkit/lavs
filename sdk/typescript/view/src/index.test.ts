import { describe, it, expect } from 'vitest';
import { handleAgentAction, LAVSView } from './index';

const HOST_ORIGIN = 'http://localhost:7842';

interface Posted {
  msg: any;
  targetOrigin?: string;
}

function fakeEnv() {
  const listeners: Array<(e: any) => void> = [];
  const posted: Posted[] = [];
  const fakeWin = {
    location: { origin: HOST_ORIGIN },
    addEventListener: (_: string, fn: any) => listeners.push(fn),
    removeEventListener: () => {},
  } as unknown as Window;
  const fakeParent = {
    postMessage: (msg: any, targetOrigin?: string) => posted.push({ msg, targetOrigin }),
  } as unknown as Window;
  /** A same-origin sibling iframe in the host's pool (the attacker in issue #18). */
  const siblingFrame = { postMessage: () => {} } as unknown as Window;
  return { listeners, posted, fakeWin, fakeParent, siblingFrame };
}

function dispatch(listeners: Array<(e: any) => void>, event: any) {
  listeners.forEach((fn) => fn(event));
}

const fromHost = (data: any, source: any) => ({ data, origin: HOST_ORIGIN, source });

describe('handleAgentAction', () => {
  const base = { contentType: 'lavs/todo-list', timestamp: 1, tool: 'lavs_x' };

  it('refreshes on tool_executed', () => {
    let refreshed = 0;
    const r = handleAgentAction({ ...base, type: 'tool_executed' }, {
      refresh: () => refreshed++,
    });
    expect(r).toBe('refresh');
    expect(refreshed).toBe(1);
  });

  it('dispatches a known ui_command locally without refresh', () => {
    let refreshed = 0;
    let got: unknown;
    const r = handleAgentAction({ ...base, type: 'ui_command', command: 'setCompact', args: { on: true } }, {
      refresh: () => refreshed++,
      commands: { setCompact: (args) => { got = args; } },
    });
    expect(r).toBe('command');
    expect(got).toEqual({ on: true });
    expect(refreshed).toBe(0);
  });

  it('falls back to refresh for an unknown ui_command (SPEC §12.5)', () => {
    let detail: any;
    const r = handleAgentAction({ ...base, type: 'ui_command', command: 'mystery', args: { x: 1 } }, {
      refresh: (d) => { detail = d; },
    });
    expect(r).toBe('refresh');
    expect(detail).toEqual({ command: 'mystery', args: { x: 1 } });
  });

  it('ignores malformed actions', () => {
    const r = handleAgentAction(undefined, { refresh: () => { throw new Error('should not'); } });
    expect(r).toBe('ignored');
  });

  it('calls onAction for every action (observability)', () => {
    const seen: string[] = [];
    handleAgentAction({ ...base, type: 'tool_executed' }, {
      refresh: () => {}, onAction: (a) => seen.push(a.type),
    });
    expect(seen).toEqual(['tool_executed']);
  });
});

describe('LAVSView (fake DOM)', () => {
  it('call() posts lavs-call and resolves on lavs-result', async () => {
    const { listeners, posted, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    const p = view.call('listTodos', { done: false });
    expect(posted[0].msg).toEqual({
      type: 'lavs-call',
      id: expect.any(String),
      endpoint: 'listTodos',
      input: { done: false },
    });
    dispatch(listeners, fromHost({ type: 'lavs-result', id: posted[0].msg.id, result: [1, 2] }, fakeParent));
    await expect(p).resolves.toEqual([1, 2]);
  });

  it('call() rejects on lavs-error', async () => {
    const { listeners, posted, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    const p = view.call('boom');
    dispatch(listeners, fromHost({ type: 'lavs-error', id: posted[0].msg.id, error: 'nope' }, fakeParent));
    await expect(p).rejects.toThrow('nope');
  });

  it('routes agent-action through handleAgentAction', async () => {
    const { listeners, fakeWin, fakeParent } = fakeEnv();
    let compacted = false;
    let refreshed = 0;
    new LAVSView(fakeWin, fakeParent, {
      refresh: () => refreshed++,
      commands: { setCompact: () => { compacted = true; } },
    });
    dispatch(listeners, fromHost({ type: 'lavs-agent-action', action: { type: 'ui_command', command: 'setCompact', args: {}, contentType: 'x', timestamp: 1, tool: 't' } }, fakeParent));
    dispatch(listeners, fromHost({ type: 'lavs-agent-action', action: { type: 'tool_executed', tool: 't', contentType: 'x', timestamp: 2 } }, fakeParent));
    expect(compacted).toBe(true);
    expect(refreshed).toBe(1);
  });
});

describe('LAVSView — postMessage security (issue #18)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('sends lavs-call with the host origin, not "*"', () => {
    const { posted, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    view.call('listTodos');
    expect(posted[0].targetOrigin).toBe(HOST_ORIGIN);
  });

  it('does not settle a pending call on a result from a foreign origin', async () => {
    const { listeners, posted, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    let settled = false;
    const p = view.call('listTodos');
    p.then(() => (settled = true), () => (settled = true));

    dispatch(listeners, {
      data: { type: 'lavs-result', id: posted[0].msg.id, result: 'forged' },
      origin: 'http://evil.example',
      source: fakeParent,
    });
    await flush();
    expect(settled).toBe(false);

    // The genuine host reply still resolves.
    dispatch(listeners, fromHost({ type: 'lavs-result', id: posted[0].msg.id, result: [1, 2] }, fakeParent));
    await expect(p).resolves.toEqual([1, 2]);
  });

  it('ignores agent-actions whose source is not the parent (same-origin sibling iframe)', () => {
    const { listeners, fakeWin, fakeParent, siblingFrame } = fakeEnv();
    let commandRuns = 0;
    let refreshes = 0;
    new LAVSView(fakeWin, fakeParent, {
      refresh: () => refreshes++,
      commands: { setCompact: () => commandRuns++ },
    });

    dispatch(listeners, fromHost({
      type: 'lavs-agent-action',
      action: { type: 'ui_command', command: 'setCompact', tool: 't', contentType: 'x', timestamp: 1 },
    }, siblingFrame));
    expect(commandRuns).toBe(0);
    expect(refreshes).toBe(0);

    // The real host (parent) still drives the view.
    dispatch(listeners, fromHost({
      type: 'lavs-agent-action',
      action: { type: 'ui_command', command: 'setCompact', tool: 't', contentType: 'x', timestamp: 1 },
    }, fakeParent));
    expect(commandRuns).toBe(1);
  });

  it('uses unguessable call ids', () => {
    const { posted, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      view.call('listTodos');
      ids.push(posted[i].msg.id);
    }
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThanOrEqual(8);
    }
    expect(ids).not.toContain('1');
    expect(ids).not.toContain('2');
  });
});
