import { describe, it, expect } from 'vitest';
import { handleAgentAction, LAVSView } from './index';

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
  function fakeEnv() {
    const listeners: Array<(e: any) => void> = [];
    const posted: any[] = [];
    const fakeWin = { addEventListener: (_: string, fn: any) => listeners.push(fn) } as unknown as Window;
    const fakeParent = { postMessage: (m: any) => posted.push(m) } as unknown as Window;
    return { listeners, posted, fakeWin, fakeParent };
  }

  it('call() posts lavs-call and resolves on lavs-result', async () => {
    const { listeners, posted, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    const p = view.call('listTodos', { done: false });
    expect(posted[0]).toEqual({ type: 'lavs-call', id: '1', endpoint: 'listTodos', input: { done: false } });
    listeners.forEach((fn) => fn({ data: { type: 'lavs-result', id: '1', result: [1, 2] } }));
    await expect(p).resolves.toEqual([1, 2]);
  });

  it('call() rejects on lavs-error', async () => {
    const { listeners, fakeWin, fakeParent } = fakeEnv();
    const view = new LAVSView(fakeWin, fakeParent);
    const p = view.call('boom');
    listeners.forEach((fn) => fn({ data: { type: 'lavs-error', id: '1', error: 'nope' } }));
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
    listeners.forEach((fn) => fn({ data: { type: 'lavs-agent-action', action: { type: 'ui_command', command: 'setCompact', args: {}, contentType: 'x', timestamp: 1, tool: 't' } } }));
    listeners.forEach((fn) => fn({ data: { type: 'lavs-agent-action', action: { type: 'tool_executed', tool: 't', contentType: 'x', timestamp: 2 } } }));
    expect(compacted).toBe(true);
    expect(refreshed).toBe(1);
  });
});
