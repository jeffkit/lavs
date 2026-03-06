#!/usr/bin/env node
/**
 * LAVS Runtime CLI
 *
 * Starts a standard MCP server for a LAVS-enabled agent directory.
 *
 * Usage:
 *   npx lavs-runtime serve --agent-dir ./agents/jarvis [--agent-id jarvis] [--project-path /path/to/project]
 *
 * This allows any MCP-compatible client to connect via stdio:
 *   - Claude Code: configure in .claude/mcp.json
 *   - Cursor: configure in .cursor/mcp.json
 *   - Any MCP client supporting stdio transport
 */

import path from 'path';
import { createLAVSMcpServer, connectStdio } from './mcp-server';

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

  if (command !== 'serve') {
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
    console.error('Error: --agent-dir is required');
    printUsage();
    process.exit(1);
  }

  agentDir = path.resolve(agentDir);

  if (!agentId) {
    agentId = path.basename(agentDir);
  }

  return { command, agentDir, agentId, projectPath };
}

function printUsage(): void {
  console.error(`
LAVS Runtime — Standard MCP Server for LAVS-enabled agents

Usage:
  lavs-runtime serve --agent-dir <path> [options]

Options:
  --agent-dir <path>      Path to agent directory containing lavs.json (required)
  --agent-id <id>         Agent identifier (defaults to directory name)
  --project-path <path>   Project path for data isolation

Examples:
  # Start MCP server for an agent
  npx lavs-runtime serve --agent-dir ./agents/jarvis

  # Configure in Claude Code (.claude/mcp.json)
  {
    "lavs-jarvis": {
      "command": "npx",
      "args": ["lavs-runtime", "serve", "--agent-dir", "./agents/jarvis"]
    }
  }

  # Configure in Cursor (.cursor/mcp.json)
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

main();
