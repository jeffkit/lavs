/**
 * @lavs/view — view-side SDK for LAVS bundles (SPEC §12).
 *
 * A LAVS bundle view runs in an iframe inside the LAVS host. This SDK wires
 * the two postMessage directions so bundle authors write no glue code:
 *
 *   view → host: `lavs-call`        (call a manifest endpoint, promise-based)
 *   host → view: `lavs-agent-action` (tool_executed → refresh;
 *                                     ui_command   → command registry,
 *                                                   unknown → refresh fallback)
 *
 * Usage (no-build bundles): copy `dist/lavs-view.iife.js` next to the view
 * HTML, then:
 *
 *   <script src="lavs-view.iife.js"></script>
 *   <script>
 *     const view = LAVSView.connect({
 *       refresh: loadTodos,
 *       commands: {
 *         setCompact(args) { document.body.classList.toggle('compact', args.on !== false); },
 *       },
 *     });
 *     const todos = await view.call('listTodos');
 *   </script>
 *
 * One-way control invariant: this SDK only ever *calls* the host and *reacts*
 * to host notifications. It exposes no channel for the view to address the
 * agent.
 */

/** Agent-action payload forwarded by the host (SPEC §5 / §12). */
export interface AgentAction {
  type: 'tool_executed' | 'ui_command';
  tool: string;
  /** Present on `ui_command` only: the notify endpoint id. */
  command?: string;
  /** Present on `ui_command` only: the agent's input to the command. */
  args?: unknown;
  contentType: string;
  timestamp: number;
  result?: unknown;
}

export interface LAVSViewOptions {
  /**
   * Called when data changed (`tool_executed`) or an unknown `ui_command`
   * arrived. The refresh fallback keeps views correct across protocol and
   * bundle versions — do not omit it for data-backed views.
   */
  refresh?: (detail?: { command?: string; args?: unknown }) => void;
  /** UI commands (notify endpoints) this view handles locally. */
  commands?: Record<string, (args: any) => void>;
  /**
   * Observability escape hatch: called for every agent-action after the
   * built-in handling. Must not be used to address the agent.
   */
  onAction?: (action: AgentAction) => void;
}

/**
 * Pure agent-action dispatcher — exported for tests and custom bridges.
 * Returns a short description of what was done.
 */
export function handleAgentAction(
  action: Partial<AgentAction> | undefined,
  handlers: Required<Pick<LAVSViewOptions, 'refresh'>> &
    Pick<LAVSViewOptions, 'commands' | 'onAction'>
): 'command' | 'refresh' | 'ignored' {
  if (!action || !action.type) return 'ignored';
  handlers.onAction?.(action as AgentAction);
  if (action.type === 'ui_command' && action.command) {
    const cmd = handlers.commands?.[action.command];
    if (cmd) {
      cmd((action.args as any) ?? {});
      return 'command';
    }
    // Unknown command — fall back to refresh (SPEC §12.5 MUST).
    handlers.refresh({ command: action.command, args: action.args });
    return 'refresh';
  }
  // tool_executed — data changed.
  handlers.refresh();
  return 'refresh';
}

export class LAVSView {
  private callId = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private commands: Record<string, (args: any) => void> = {};
  private refreshFn: (detail?: { command?: string; args?: unknown }) => void;
  private onAction?: (action: AgentAction) => void;
  private listener: ((e: MessageEvent) => void) | null = null;

  constructor(
    private win: Window = window,
    private parent: Window | null = window.parent,
    options: LAVSViewOptions = {}
  ) {
    this.refreshFn = options.refresh ?? (() => {});
    this.commands = { ...options.commands };
    this.onAction = options.onAction;
    this.listen();
  }

  private listen(): void {
    if (!this.parent) return;
    this.listener = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'lavs-result' && this.pending.has(d.id)) {
        this.pending.get(d.id)!.resolve(d.result);
        this.pending.delete(d.id);
      } else if (d.type === 'lavs-error' && this.pending.has(d.id)) {
        this.pending.get(d.id)!.reject(new Error(d.error || 'Unknown error'));
        this.pending.delete(d.id);
      } else if (d.type === 'lavs-agent-action') {
        handleAgentAction(d.action, {
          refresh: (detail) => this.refreshFn(detail),
          commands: this.commands,
          onAction: this.onAction,
        });
      }
    };
    this.win.addEventListener('message', this.listener);
  }

  /** Register (or replace) a UI command handler. */
  registerCommand(name: string, fn: (args: any) => void): this {
    this.commands[name] = fn;
    return this;
  }

  /** Replace the refresh handler. */
  onRefresh(fn: (detail?: { command?: string; args?: unknown }) => void): this {
    this.refreshFn = fn;
    return this;
  }

  /** Call a manifest endpoint through the host bridge. */
  call(endpoint: string, input: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.parent) {
        reject(new Error('LAVSView: no parent host (not running inside the LAVS host iframe?)'));
        return;
      }
      const id = String(++this.callId);
      this.pending.set(id, { resolve, reject });
      this.parent.postMessage({ type: 'lavs-call', id, endpoint, input }, '*');
    });
  }

  /** Stop listening (cleanup in SPA hosts). */
  destroy(): void {
    if (this.listener) this.win.removeEventListener('message', this.listener);
    this.listener = null;
    for (const { reject } of this.pending.values()) reject(new Error('LAVSView destroyed'));
    this.pending.clear();
  }
}

/** Connect this view to the surrounding LAVS host. */
export function connect(options: LAVSViewOptions = {}): LAVSView {
  return new LAVSView(window, window.parent, options);
}
