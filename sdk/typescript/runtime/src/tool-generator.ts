/**
 * LAVS Tool Generator
 *
 * Automatically generates Claude SDK tool definitions from LAVS manifests.
 * This allows AI agents to call LAVS endpoints as tools.
 */

import { LAVSManifest, Endpoint } from './types';
import { ManifestLoader } from './loader';
import { ScriptExecutor } from './script-executor';
import { FunctionExecutor } from './function-executor';
import { LAVSValidator } from './validator';
import { PermissionChecker } from './permission-checker';
import { ScriptHandler, FunctionHandler, HTTPHandler, MCPHandler, ExecutionContext } from './types';
import { HttpExecutor } from './http-executor';
import { McpExecutor } from './mcp-executor';
import { debug } from './logger';
import path from 'path';
import http from 'http';

/**
 * The default port the LAVS host listens on. Can be overridden via the
 * LAVS_HOST_PORT environment variable — this lets `lavs call` notify a host
 * running on a non-default port (e.g. when `lavs view --port 9000` is used,
 * or when the daemon plist configures a custom port).
 */
function getGlobalHostPort(): number {
  const env = process.env.LAVS_HOST_PORT;
  if (env) {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 7842;
}

/**
 * Fire-and-forget: notify the global LAVS host that a mutation or UI
 * command happened so connected view iframes can react via SSE.
 * `input` is only set for `notify` endpoints (the command arguments).
 */
function notifyGlobalHost(bundleName: string, endpointId: string, data: unknown, input?: unknown): void {
  try {
    const body = JSON.stringify(input !== undefined ? { data, input, kind: 'ui_command' } : { data });
    const req = http.request({
      hostname: '127.0.0.1',
      port: getGlobalHostPort(),
      path: `/api/notify/${encodeURIComponent(bundleName)}/${encodeURIComponent(endpointId)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.on('error', () => { /* host not running — silently ignore */ });
    req.write(body);
    req.end();
  } catch {
    // Ignore errors — host notification is best-effort
  }
}

/**
 * Claude SDK tool definition
 */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool execution function
 */
export type ToolExecutor = (params: any) => Promise<any>;

/**
 * Generated tool with executor
 */
export interface GeneratedTool {
  tool: ClaudeTool;
  execute: ToolExecutor;
  /** Endpoint method type — used by MCP server to format output and decide view refresh */
  method: 'query' | 'mutation' | 'notify';
}

/**
 * Generate tools from LAVS manifest
 */
export class LAVSToolGenerator {
  /**
   * Generate tools for an agent
   * @param agentId - Agent ID
   * @param agentDir - Agent directory path
   * @param projectPath - Optional project path for data isolation
   * @returns Array of generated tools
   */
  async generateTools(
    agentId: string,
    agentDir: string,
    projectPath?: string
  ): Promise<GeneratedTool[]> {
    try {
      // Load manifest
      const lavsPath = path.join(agentDir, 'lavs.json');
      const loader = new ManifestLoader();
      const manifest = await loader.load(lavsPath);

      // Generate tool for each endpoint
      const tools: GeneratedTool[] = [];

      for (const endpoint of manifest.endpoints) {
        // Only generate tools for query and mutation endpoints
        // Subscriptions don't make sense as tools
        if (endpoint.method === 'subscription') {
          continue;
        }

        const tool = this.generateToolForEndpoint(endpoint, manifest, agentId, agentDir, projectPath);
        tools.push(tool);
      }

      debug(`[LAVS] Generated ${tools.length} tools for agent ${agentId}`);
      return tools;
    } catch (error: unknown) {
      // If no lavs.json, that's OK - just return empty array
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Generate tool definition and executor for an endpoint
   */
  private generateToolForEndpoint(
    endpoint: Endpoint,
    manifest: LAVSManifest,
    agentId: string,
    agentDir: string,
    projectPath?: string
  ): GeneratedTool {
    // Generate tool name (prefix with lavs_ to avoid conflicts)
    const toolName = `lavs_${endpoint.id}`;

    // Generate tool description
    const description = endpoint.description || `Call ${endpoint.id} endpoint from ${manifest.name}`;

    // Generate input schema from endpoint schema
    const inputSchema = endpoint.schema?.input || {
      type: 'object',
      properties: {},
    };

    // Ensure it's an object schema
    if (inputSchema.type !== 'object') {
      throw new Error(`Endpoint ${endpoint.id} must have object input schema`);
    }

    const tool: ClaudeTool = {
      name: toolName,
      description,
      input_schema: {
        type: 'object',
        properties: inputSchema.properties || {},
        required: inputSchema.required || [],
      },
    };

    // Create shared instances for validation and permission checking
    const validator = new LAVSValidator();
    const permChecker = new PermissionChecker();
    const manifestTypes = manifest.types;

    // Create executor function
    const execute: ToolExecutor = async (params: any) => {
      debug(`[LAVS] Executing tool ${toolName} with params:`, params);

      // 1. Validate input against schema (pass manifest types for $ref resolution)
      validator.assertValidInput(endpoint, params, manifestTypes);

      // 2. Merge permissions
      const mergedPermissions = permChecker.mergePermissions(
        manifest.permissions,
        endpoint.permissions
      );

      // 3. Check permissions for script handlers
      if (endpoint.handler?.type === 'script') {
        permChecker.assertAllowed(
          endpoint.handler as ScriptHandler,
          mergedPermissions,
          agentDir
        );
      }

      // 4. Build execution context
      const context: ExecutionContext = {
        endpointId: endpoint.id,
        agentId,
        workdir: agentDir,
        permissions: mergedPermissions,
        env: projectPath ? {
          LAVS_PROJECT_PATH: projectPath,
        } : undefined,
      };

      // 5. Execute the handler. `notify` endpoints may omit the handler
      // entirely — a pure UI command has nothing to run server-side; the
      // broadcast below is the whole effect.
      let result: unknown;
      if (!endpoint.handler) {
        result = { ok: true };
      } else switch (endpoint.handler.type) {
        case 'script': {
          const executor = new ScriptExecutor();
          result = await executor.execute(
            endpoint.handler as ScriptHandler,
            params,
            context
          );
          break;
        }
        case 'function': {
          const funcExecutor = new FunctionExecutor();
          result = await funcExecutor.execute(
            endpoint.handler as FunctionHandler,
            params,
            context
          );
          break;
        }
        case 'http': {
          const httpExecutor = new HttpExecutor();
          result = await httpExecutor.execute(
            endpoint.handler as HTTPHandler,
            params,
            context
          );
          break;
        }
        case 'mcp': {
          const mcpExecutor = new McpExecutor();
          result = await mcpExecutor.execute(
            endpoint.handler as MCPHandler,
            params,
            context
          );
          break;
        }
        default: {
          const htype = (endpoint.handler as any).type ?? 'unknown';
          throw new Error(`Handler type '${htype}' is not yet supported in tool generation`);
        }
      }

      // 6. Notify global host after mutations / UI commands so views react
      // (fire-and-forget). Skip when called from within the host itself
      // (LAVS_HOST_CALLER=1) to avoid double-broadcasting — the host's
      // /api/call handler broadcasts directly.
      if ((endpoint.method === 'mutation' || endpoint.method === 'notify') && !process.env.LAVS_HOST_CALLER) {
        notifyGlobalHost(
          manifest.name,
          endpoint.id,
          result,
          endpoint.method === 'notify' ? params : undefined
        );
      }

      // 7. Validate output against schema (non-blocking: warn on mismatch, still return data)
      try {
        validator.assertValidOutput(endpoint, result, manifestTypes);
      } catch (validationError: any) {
        console.warn(`[LAVS] Output validation warning for ${toolName}: ${validationError.message}`);
      }

      return result;
    };

    return { tool, execute, method: endpoint.method as 'query' | 'mutation' | 'notify' };
  }

  /**
   * Check if agent has LAVS
   */
  async hasLAVS(agentDir: string): Promise<boolean> {
    try {
      const lavsPath = path.join(agentDir, 'lavs.json');
      const loader = new ManifestLoader();
      await loader.load(lavsPath);
      return true;
    } catch {
      return false;
    }
  }
}
