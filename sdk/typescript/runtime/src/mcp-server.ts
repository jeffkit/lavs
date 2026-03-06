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

/**
 * Register a single LAVS GeneratedTool on the McpServer.
 */
function registerGeneratedTool(server: McpServer, genTool: GeneratedTool): void {
  const { tool: toolDef, execute } = genTool;

  const inputSchema: Record<string, any> = {};
  if (toolDef.input_schema.properties) {
    for (const [key, prop] of Object.entries(toolDef.input_schema.properties)) {
      inputSchema[key] = toMcpPropertySchema(prop as any);
    }
  }

  server.registerTool(
    toolDef.name,
    {
      description: toolDef.description,
      inputSchema: inputSchema as any,
    },
    async (args: any) => {
      try {
        const result = await execute(args);
        return {
          content: [
            {
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error.message || String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Convert a JSON Schema property to an MCP-compatible Zod-like schema descriptor.
 *
 * The MCP SDK's registerTool accepts a Zod-compatible shape or raw JSON Schema
 * properties. We pass raw JSON Schema objects through since the SDK supports them.
 */
function toMcpPropertySchema(prop: any): any {
  return prop;
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
