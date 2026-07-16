/**
 * LAVS MCP Executor (forward bridge)
 *
 * Executes `mcp` handlers by connecting to an EXTERNAL MCP server
 * (configured in the agent's `mcp-config.json`) and calling the named tool.
 *
 * This is the *forward* bridge: LAVS endpoint -> external MCP server tool.
 * (The *reverse* bridge — exposing LAVS endpoints AS MCP tools — lives in
 * `mcp-server.ts`.)
 *
 * Connection config is intentionally NOT stored in `lavs.json`: the manifest
 * only references a server by name (`handler.server`), while `mcp-config.json`
 * holds the real transport details (command/args or url/headers). This keeps
 * secrets and environment-specific settings out of the portable manifest and
 * lets multiple endpoints share one server definition.
 */
import fs from 'fs/promises';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  MCPHandler,
  McpServerConfig,
  McpConfigFile,
  ExecutionContext,
  LAVSError,
  LAVSErrorCode,
} from './types';

const DEFAULT_MCP_TIMEOUT = 30000;

export class McpExecutor {
  /**
   * Execute an `mcp` handler by calling the referenced MCP server's tool.
   */
  async execute(
    handler: MCPHandler,
    params: any,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!handler.server || !handler.tool) {
      throw new LAVSError(
        LAVSErrorCode.InvalidParams,
        `MCP handler requires 'server' and 'tool' fields`
      );
    }

    const config = await this.loadConfig(context.workdir);
    const serverCfg = config.mcpServers[handler.server];
    if (!serverCfg) {
      throw new LAVSError(
        LAVSErrorCode.HandlerError,
        `MCP server '${handler.server}' is not defined in mcp-config.json`
      );
    }

    const transport = this.buildTransport(serverCfg);
    const client = new Client(
      { name: 'lavs-runtime', version: '1.0.0' },
      { capabilities: {} }
    );

    const timeout = context.timeout ?? serverCfg.timeout ?? DEFAULT_MCP_TIMEOUT;

    try {
      await this.withTimeout(
        client.connect(transport),
        timeout,
        `connect to MCP server '${handler.server}'`
      );

      const result = await this.withTimeout(
        client.callTool({ name: handler.tool, arguments: params ?? {} }),
        timeout,
        `call MCP tool '${handler.tool}'`
      );

      if (result.isError) {
        const text = ((result as any).content ?? [])
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
        throw new LAVSError(
          LAVSErrorCode.HandlerError,
          `MCP tool '${handler.tool}' failed: ${text || 'unknown error'}`
        );
      }

      // Prefer structured content when the server provides it.
      if (result.structuredContent !== undefined) {
        return result.structuredContent;
      }

      // Otherwise join text parts and try to parse as JSON.
      const text = ((result as any).content ?? [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } finally {
      await client.close().catch(() => {});
    }
  }

  /**
   * Load and minimally validate mcp-config.json from the agent directory.
   */
  private async loadConfig(workdir: string): Promise<McpConfigFile> {
    const cfgPath = path.join(workdir, 'mcp-config.json');
    let raw: string;
    try {
      raw = await fs.readFile(cfgPath, 'utf-8');
    } catch {
      throw new LAVSError(
        LAVSErrorCode.HandlerError,
        `mcp-config.json not found in ${workdir}; mcp handlers require it`
      );
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers) {
        throw new Error('missing "mcpServers" object');
      }
      return parsed as McpConfigFile;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new LAVSError(
        LAVSErrorCode.InvalidParams,
        `Invalid mcp-config.json: ${message}`
      );
    }
  }

  /**
   * Build an MCP client transport from a server config entry.
   */
  private buildTransport(cfg: McpServerConfig): Transport {
    if (cfg.transport === 'stdio') {
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
      });
    }
    if (cfg.transport === 'http') {
      return new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
      });
    }
    throw new LAVSError(
      LAVSErrorCode.HandlerError,
      `Unsupported MCP transport: '${(cfg as any).transport}' (expected 'stdio' or 'http')`
    );
  }

  /**
   * Race a promise against a timeout, mapping expiry to LAVSError Timeout.
   * The underlying promise is not aborted (MCP SDK has no abort hook), but the
   * caller's `finally` block closes the client, which tears down the transport
   * (e.g. kills the stdio child process).
   */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new LAVSError(LAVSErrorCode.Timeout, `${label} timed out after ${ms}ms`)
        );
      }, ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
}
