/**
 * LAVS MCP Server
 *
 * Creates a standard MCP server (using @modelcontextprotocol/sdk) that exposes
 * LAVS endpoints as MCP tools. This is agent-agnostic — any MCP-compatible
 * client (Claude Code, Cursor, OpenAI, custom agents, etc.) can connect.
 *
 * @example Programmatic usage
 * ```typescript
 * import { createLAVSMcpServer, connectStdio } from 'lavs-runtime';
 *
 * const server = await createLAVSMcpServer({
 *   agentId: 'jarvis',
 *   agentDir: './agents/jarvis',
 * });
 * await connectStdio(server);
 * ```
 *
 * @example CLI usage
 * ```bash
 * npx lavs-runtime serve --agent-dir ./agents/jarvis
 * ```
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LAVSToolGenerator } from './tool-generator';
import type { GeneratedTool } from './tool-generator';
import { discoverBundlesFromDirs } from './host-server';
import { ManifestLoader } from './loader';
import { z } from 'zod';
import path from 'path';

export interface LAVSMcpServerOptions {
  agentId: string;
  agentDir: string;
  projectPath?: string;
}

/**
 * Create a standard MCP server backed by LAVS endpoints.
 *
 * Reads the agent's `lavs.json` manifest, generates tools for each endpoint,
 * and registers them on an `McpServer` instance from @modelcontextprotocol/sdk.
 *
 * @returns The McpServer instance (call `connectStdio()` or attach your own transport)
 */
export async function createLAVSMcpServer(
  options: LAVSMcpServerOptions
): Promise<McpServer> {
  const { agentId, agentDir, projectPath } = options;

  const generator = new LAVSToolGenerator();
  const generatedTools = await generator.generateTools(agentId, agentDir, projectPath);

  const server = new McpServer(
    { name: `lavs-${agentId}`, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  for (const genTool of generatedTools) {
    registerGeneratedTool(server, genTool);
  }

  console.error(
    `[LAVS MCP] Registered ${generatedTools.length} tools for agent "${agentId}"`
  );

  return server;
}

/**
 * Connect an McpServer to stdio transport (stdin/stdout).
 *
 * This is the standard way MCP servers communicate with clients.
 * After calling this, the process will read JSON-RPC messages from stdin
 * and write responses to stdout.
 */
export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface LAVSRegistryMcpServerOptions {
  /**
   * One or more registry directories to scan for LAVS bundles.
   * If empty, the server enters "dynamic mode": it exposes two generic tools
   * (`lavs_discover` and `lavs_call`) that accept a `registryDir` parameter
   * at call-time, so the agent provides the path dynamically.
   */
  registryDirs: string[];
  /** Optional project path forwarded to all tool executors. */
  projectPath?: string;
}

/**
 * Create a single unified MCP server that exposes ALL bundles found in
 * one or more registry directories.
 *
 * **Static mode** (registryDirs provided):
 *   Tool naming: `lavs_<bundle>_<endpoint>`
 *   e.g.  lavs_todo_list_addTodo, lavs_notes_addNote
 *   Bundle authors only write scripts + lavs.json; no per-bundle MCP config.
 *
 * **Dynamic mode** (registryDirs empty):
 *   Exposes two generic tools:
 *   - `lavs_discover(registryDir)` → lists available bundles & endpoints
 *   - `lavs_call(registryDir, bundle, endpoint, params?)` → calls any endpoint
 *   The agent supplies the registry dir at call-time.
 *   Ideal for a global ~/.cursor/mcp.json that works across all projects.
 */
export async function createLAVSRegistryMcpServer(
  options: LAVSRegistryMcpServerOptions
): Promise<McpServer> {
  const { registryDirs, projectPath } = options;

  const generator = new LAVSToolGenerator();

  const server = new McpServer(
    { name: 'lavs-registry', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // ── Dynamic mode (no registry dir configured) ───────────────────────────
  if (!registryDirs.length) {
    console.error('[LAVS Registry MCP] Dynamic mode — tools accept registryDir at call-time.');

    server.registerTool(
      'lavs_discover',
      {
        description:
          'List all LAVS bundles and their endpoint schemas from a registry directory. ' +
          'Use this first to find what bundles and endpoints are available before calling lavs_call.',
        inputSchema: {
          registryDir: z.string().describe('Absolute path to the directory containing LAVS bundles (e.g. /path/to/project/bundles)'),
        } as any,
      },
      async ({ registryDir }: { registryDir: string }) => {
        try {
          const absDir = path.resolve(registryDir);
          const bundles = await discoverBundlesFromDirs([absDir]);
          if (!bundles.length) {
            return { content: [{ type: 'text' as const, text: 'No LAVS bundles found in the specified directory.' }] };
          }

          const loader = new ManifestLoader();

          const lines: string[] = [
            '⚠️  IMPORTANT: Always use lavs_call to invoke endpoints — NOT raw scripts.',
            '   Running scripts directly bypasses the host notification and the view will NOT refresh.',
            '',
            `Found ${bundles.length} bundle(s) in ${absDir}:`,
            '',
          ];

          for (const bundle of bundles) {
            lines.push(`📦 ${bundle.name}  (contentType: ${bundle.contentType})`);
            if (bundle.description) lines.push(`   ${bundle.description}`);
            lines.push(`   dir: ${bundle.dir}`);
            lines.push('');

            try {
              const manifest = await loader.load(path.join(bundle.dir, 'lavs.json'));
              for (const ep of manifest.endpoints) {
                lines.push(`   • ${ep.id} [${ep.method}]`);
                if (ep.description) lines.push(`     ${ep.description}`);
                const props = ep.schema?.input?.properties || {};
                const required = ep.schema?.input?.required || [];
                const paramEntries = Object.entries(props);
                if (paramEntries.length) {
                  lines.push(`     Params:`);
                  for (const [name, schema] of paramEntries) {
                    const s = schema as any;
                    const req = required.includes(name) ? ' (required)' : ' (optional)';
                    const typeStr = s.enum ? s.enum.map((v: any) => `"${v}"`).join('|') : (s.type || 'any');
                    lines.push(`       ${name}: ${typeStr}${req}${s.description ? ' — ' + s.description : ''}`);
                  }
                } else {
                  lines.push(`     Params: (none)`);
                }
                lines.push('');
              }
            } catch {
              lines.push('   (could not load manifest details)');
            }

            lines.push(`   ─── To call an endpoint: lavs_call({ registryDir: "${absDir}", bundle: "${bundle.name}", endpoint: "<id>", params: {...} })`);
            lines.push('');
          }

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    server.registerTool(
      'lavs_call',
      {
        description:
          'Call any LAVS endpoint in any bundle. ' +
          'ALWAYS use this tool instead of running bundle scripts directly — scripts bypass the LAVS host ' +
          'notification and the view will NOT auto-refresh. ' +
          'First call lavs_discover to find available bundles and their full endpoint schemas. ' +
          'Mutations automatically notify the LAVS host view to refresh in real-time.',
        inputSchema: {
          registryDir: z.string().describe('Absolute path to the directory containing LAVS bundles'),
          bundle:      z.string().describe('Bundle name (from lavs_discover output, e.g. "todo-list")'),
          endpoint:    z.string().describe('Endpoint ID to call (e.g. "addTodo", "listNotes")'),
          params:      z.record(z.string(), z.unknown()).optional().describe('Input parameters for the endpoint (check lavs_discover output for schema)'),
        } as any,
      },
      async ({ registryDir, bundle, endpoint, params }: {
        registryDir: string; bundle: string; endpoint: string; params?: Record<string, unknown>;
      }) => {
        try {
          const absDir = path.resolve(registryDir);
          const bundles = await discoverBundlesFromDirs([absDir]);
          const found = bundles.find((b) => b.name === bundle);
          if (!found) {
            const names = bundles.map((b) => b.name).join(', ');
            return {
              content: [{ type: 'text' as const, text: `Bundle "${bundle}" not found. Available: ${names || 'none'}` }],
              isError: true,
            };
          }
          const tools = await generator.generateTools(found.name, found.dir, projectPath);
          const tool = tools.find((t) => t.tool.name === `lavs_${endpoint}`);
          if (!tool) {
            const available = tools.map((t) => t.tool.name.replace('lavs_', '')).join(', ');
            return {
              content: [{ type: 'text' as const, text: `Endpoint "${endpoint}" not found. Available: ${available}` }],
              isError: true,
            };
          }
          const result = await tool.execute(params || {});
          return formatToolResult(tool.method, endpoint, result);
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    return server;
  }

  // ── Static mode (registry dirs provided) ───────────────────────────────
  const bundles = await discoverBundlesFromDirs(registryDirs);
  let totalTools = 0;

  for (const bundle of bundles) {
    const generatedTools = await generator.generateTools(bundle.name, bundle.dir, projectPath);
    const prefix = bundle.name.replace(/-/g, '_');

    for (const genTool of generatedTools) {
      // Rename: lavs_endpointId → lavs_bundlePrefix_endpointId
      const endpointId = genTool.tool.name.replace(/^lavs_/, '');
      const renamedTool: GeneratedTool = {
        tool: { ...genTool.tool, name: `lavs_${prefix}_${endpointId}` },
        execute: genTool.execute,
        method: genTool.method,
      };
      registerGeneratedTool(server, renamedTool);
      totalTools++;
    }
  }

  console.error(
    `[LAVS Registry MCP] Static mode — ${bundles.length} bundle(s), ${totalTools} tool(s) registered.`
  );
  if (bundles.length) {
    console.error(`  Bundles: ${bundles.map((b) => b.name).join(', ')}`);
  }

  return server;
}

/**
 * Format a tool result for MCP response.
 *
 * Mutations get a confirmation header ("✅ … completed — view will auto-refresh").
 * Queries that return arrays get an item-count summary.
 * Other results are returned as-is (JSON).
 */
function formatToolResult(
  method: 'query' | 'mutation' | 'notify',
  endpointId: string,
  result: unknown
): { content: Array<{ type: 'text'; text: string }> } {
  const data = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  if (method === 'mutation') {
    return {
      content: [{
        type: 'text' as const,
        text: `✅ ${endpointId} completed — LAVS view will auto-refresh.\n\n${data}`,
      }],
    };
  }

  if (method === 'notify') {
    return {
      content: [{
        type: 'text' as const,
        text: `✅ ${endpointId} command sent — LAVS view has been notified.\n\n${data}`,
      }],
    };
  }

  if (Array.isArray(result)) {
    return {
      content: [{
        type: 'text' as const,
        text: `📋 ${result.length} item(s) returned.\n\n${data}`,
      }],
    };
  }

  return { content: [{ type: 'text' as const, text: data }] };
}

/**
 * Register a single LAVS GeneratedTool on the McpServer.
 */
function registerGeneratedTool(server: McpServer, genTool: GeneratedTool): void {
  const { tool: toolDef, execute, method } = genTool;

  const required: string[] = (toolDef.input_schema as any).required || [];
  const inputSchema: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(toolDef.input_schema.properties || {})) {
    let schema = jsonSchemaToZod(prop as any);
    const description = (prop as any)?.description;
    if (description) schema = schema.describe(description);
    inputSchema[key] = required.includes(key) ? schema : schema.optional();
  }

  const endpointId = toolDef.name.replace(/^lavs_(?:[^_]+_)?/, '');

  server.registerTool(
    toolDef.name,
    {
      description: toolDef.description,
      inputSchema: inputSchema as any,
    },
    async (args: any) => {
      try {
        const result = await execute(args);
        return formatToolResult(method, endpointId, result);
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${error.message || String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Convert a JSON Schema fragment to a Zod type.
 *
 * The MCP SDK's `registerTool` requires Zod (a raw shape of Zod types); handing
 * it plain JSON Schema objects throws
 * "inputSchema must be a Zod schema or raw shape, received an unrecognized object".
 * Covers the subset LAVS manifests use; unknown shapes fall back to `z.any()`.
 */
export function jsonSchemaToZod(prop: any): z.ZodTypeAny {
  if (!prop || typeof prop !== 'object') return z.any();

  if (Array.isArray(prop.enum) && prop.enum.length) {
    if (prop.enum.every((v: unknown) => typeof v === 'string')) {
      return prop.enum.length === 1
        ? z.literal(prop.enum[0])
        : z.enum(prop.enum as [string, ...string[]]);
    }
    return z.union(prop.enum.map((v: unknown) => z.literal(v as any)) as any);
  }

  const union = prop.anyOf || prop.oneOf;
  if (Array.isArray(union) && union.length) {
    const variants = union.map((p: any) => jsonSchemaToZod(p));
    return variants.length === 1 ? variants[0] : z.union(variants as any);
  }

  switch (prop.type) {
    case 'string':  return z.string();
    case 'number':  return z.number();
    case 'integer': return z.number().int();
    case 'boolean': return z.boolean();
    case 'null':    return z.null();
    case 'array':   return z.array(prop.items ? jsonSchemaToZod(prop.items) : z.any());
    case 'object': {
      const required: string[] = prop.required || [];
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(prop.properties || {})) {
        const sub = jsonSchemaToZod(value as any);
        shape[key] = required.includes(key) ? sub : sub.optional();
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

/**
 * Get the conventional LAVS tool name prefix for MCP tool naming.
 *
 * When an MCP client connects to a LAVS server named `lavs-{agentId}`,
 * the full tool names visible to the agent will be:
 *   `mcp__lavs-{agentId}__{toolName}`
 *
 * This utility generates those full names for use in allowedTools lists.
 */
export function getLAVSToolNames(agentId: string, toolNames: string[]): string[] {
  return toolNames.map((name) => `mcp__lavs-${agentId}__${name}`);
}
