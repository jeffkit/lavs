#!/usr/bin/env node
/**
 * LAVS Runtime CLI
 *
 * Commands:
 *   serve     Start a standard MCP server for a LAVS-enabled agent directory.
 *   init      Scaffold a minimal lavs.json in a target directory.
 *   validate  Load and validate a lavs.json manifest.
 *
 * Usage:
 *   npx lavs-runtime serve --agent-dir ./agents/jarvis [--agent-id jarvis] [--project-path /path]
 *   npx lavs-runtime init   --agent-dir ./agents/jarvis
 *   npx lavs-runtime validate --agent-dir ./agents/jarvis
 *
 * `serve` lets any MCP-compatible client connect via stdio:
 *   - Claude Code: configure in .claude/mcp.json
 *   - Cursor: configure in .cursor/mcp.json
 *   - Any MCP client supporting stdio transport
 */

import fs from 'fs';
import path from 'path';
import { createLAVSMcpServer, connectStdio } from './mcp-server';
import { ManifestLoader } from './loader';

interface CLIOptions {
  command: string;
  agentDir: string;
  agentId: string;
  projectPath?: string;
}

function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const SUPPORTED = ['serve', 'init', 'validate'];
  if (!SUPPORTED.includes(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  let agentDir = '';
  let agentId = '';
  let projectPath: string | undefined;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--agent-dir':
        agentDir = args[++i];
        break;
      case '--agent-id':
        agentId = args[++i];
        break;
      case '--project-path':
        projectPath = args[++i];
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!agentDir) {
    // init defaults to the current directory; serve/validate require an explicit dir
    if (command !== 'init') {
      console.error('Error: --agent-dir is required');
      printUsage();
      process.exit(1);
    }
    agentDir = '.';
  }

  agentDir = path.resolve(agentDir);

  if (!agentId) {
    agentId = path.basename(agentDir);
  }

  return { command, agentDir, agentId, projectPath };
}

function printUsage(): void {
  console.error(`
LAVS Runtime — CLI for LAVS-enabled agents

Usage:
  lavs-runtime <command> [options]

Commands:
  serve     Start a standard MCP server (stdio) exposing LAVS endpoints as tools
  init      Scaffold a minimal lavs.json in --agent-dir
  validate  Load and validate the lavs.json in --agent-dir

Options:
  --agent-dir <path>      Path to agent directory (required for serve/validate, default '.' for init)
  --agent-id <id>          Agent identifier (defaults to directory name)
  --project-path <path>     Project path for data isolation (serve only)

Examples:
  # Start an MCP server for an agent
  npx lavs-runtime serve --agent-dir ./agents/jarvis

  # Scaffold a new manifest
  npx lavs-runtime init --agent-dir ./agents/jarvis

  # Validate a manifest
  npx lavs-runtime validate --agent-dir ./agents/jarvis

  # Configure in Claude Code (.claude/mcp.json)
  {
    "lavs-jarvis": {
      "command": "npx",
      "args": ["lavs-runtime", "serve", "--agent-dir", "./agents/jarvis"]
    }
  }
`.trim());
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  switch (options.command) {
    case 'serve':
      await runServe(options);
      break;
    case 'init':
      await runInit(options);
      break;
    case 'validate':
      await runValidate(options);
      break;
  }
}

async function runServe(options: CLIOptions): Promise<void> {
  console.error(`[LAVS] Starting MCP server for agent "${options.agentId}"`);
  console.error(`[LAVS] Agent directory: ${options.agentDir}`);
  if (options.projectPath) {
    console.error(`[LAVS] Project path: ${options.projectPath}`);
  }

  try {
    const server = await createLAVSMcpServer({
      agentId: options.agentId,
      agentDir: options.agentDir,
      projectPath: options.projectPath,
    });

    await connectStdio(server);
    console.error('[LAVS] MCP server running on stdio');
  } catch (error: any) {
    console.error(`[LAVS] Failed to start: ${error.message}`);
    process.exit(1);
  }
}

async function runInit(options: CLIOptions): Promise<void> {
  const manifestPath = path.join(options.agentDir, 'lavs.json');

  if (fs.existsSync(manifestPath)) {
    console.error(`[LAVS] Refusing to overwrite existing lavs.json at ${manifestPath}`);
    process.exit(1);
  }

  fs.mkdirSync(options.agentDir, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(SAMPLE_MANIFEST(options.agentId), null, 2),
    'utf-8'
  );

  console.error(`[LAVS] Created ${manifestPath}`);
  console.error(`[LAVS] Next steps:`);
  console.error(`  - Edit endpoints/handlers to fit your agent`);
  console.error(`  - Run \`lavs-runtime validate --agent-dir ${options.agentDir}\` to check it`);
}

async function runValidate(options: CLIOptions): Promise<void> {
  const manifestPath = path.join(options.agentDir, 'lavs.json');
  console.error(`[LAVS] Validating ${manifestPath}`);

  try {
    const loader = new ManifestLoader();
    const manifest = await loader.load(manifestPath);
    console.error(`[LAVS] OK — service "${manifest.name}" v${manifest.version}`);

    // If mcp-config.json exists, validate its structure too, so `validate`
    // is a single source of truth for an agent's LAVS + MCP wiring.
    const cfgPath = path.join(options.agentDir, 'mcp-config.json');
    if (fs.existsSync(cfgPath)) {
      validateMcpConfig(cfgPath);
      console.error(`[LAVS] mcp-config.json OK`);
    }

    console.error(
      `[LAVS] ${manifest.endpoints.length} endpoint(s): ${manifest.endpoints
        .map((e) => e.id)
        .join(', ')}`
    );
  } catch (error: any) {
    console.error(`[LAVS] Validation failed: ${error.message}`);
    if (error.data) {
      console.error(JSON.stringify(error.data, null, 2));
    }
    process.exit(1);
  }
}

/**
 * Lightweight structural validation for mcp-config.json (when present).
 * Lets `validate` be a single source of truth for an agent's LAVS wiring:
 * a malformed mcp-config fails the command with a clear message instead
 * of surfacing the error only at handler-execution time.
 */
function validateMcpConfig(cfgPath: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(cfgPath, 'utf-8');
  } catch (e: any) {
    console.error(`[LAVS] Validation failed: cannot read mcp-config.json: ${e.message}`);
    process.exit(1);
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    console.error(`[LAVS] Validation failed: invalid JSON in mcp-config.json: ${e.message}`);
    process.exit(1);
    return;
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers) {
    console.error('[LAVS] Validation failed: mcp-config.json must have a "mcpServers" object');
    process.exit(1);
    return;
  }

  for (const [name, cfg] of Object.entries(parsed.mcpServers) as [string, any][]) {
    if (!cfg || typeof cfg !== 'object' || !cfg.transport) {
      console.error(`[LAVS] Validation failed: mcpServers."${name}" missing "transport"`);
      process.exit(1);
      return;
    }
    if (!['stdio', 'http'].includes(cfg.transport)) {
      console.error(
        `[LAVS] Validation failed: mcpServers."${name}".transport must be "stdio" or "http"`
      );
      process.exit(1);
      return;
    }
    if (cfg.transport === 'stdio' && (!cfg.command || typeof cfg.command !== 'string')) {
      console.error(`[LAVS] Validation failed: mcpServers."${name}" (stdio) requires a "command" string`);
      process.exit(1);
      return;
    }
    if (cfg.transport === 'http' && (!cfg.url || typeof cfg.url !== 'string')) {
      console.error(`[LAVS] Validation failed: mcpServers."${name}" (http) requires a "url" string`);
      process.exit(1);
      return;
    }
  }
}

/**
 * Minimal scaffold manifest for `lavs-runtime init`.
 * Handlers point at example scripts the user is expected to provide.
 */
function SAMPLE_MANIFEST(agentId: string): Record<string, unknown> {
  return {
    lavs: '1.0',
    name: agentId || 'my-lavs-service',
    version: '1.0.0',
    description: 'A LAVS service scaffolded by `lavs-runtime init`',
    endpoints: [
      {
        id: 'listItems',
        method: 'query',
        description: 'List all items',
        handler: { type: 'script', command: 'node', args: ['scripts/list.js'] },
        schema: {
          output: { type: 'array', items: { type: 'object' } },
        },
      },
      {
        id: 'addItem',
        method: 'mutation',
        description: 'Add a new item',
        handler: { type: 'script', command: 'node', args: ['scripts/add.js'], input: 'stdin' },
        schema: {
          input: {
            type: 'object',
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
          output: { type: 'object' },
        },
      },
    ],
    permissions: {
      fileAccess: ['./data/**/*.json'],
      maxExecutionTime: 5000,
    },
  };
}

main();
