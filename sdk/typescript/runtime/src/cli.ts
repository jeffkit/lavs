#!/usr/bin/env node
/**
 * LAVS Runtime CLI
 *
 * Commands:
 *   serve            Start MCP server for a single agent directory (one bundle).
 *   serve-registry   Start ONE unified MCP server for ALL bundles in registry dirs.
 *   init             Scaffold a minimal lavs.json in a target directory.
 *   validate         Load and validate a lavs.json manifest.
 *   discover         List all LAVS bundles in one or more directories.
 *   call             Call a LAVS endpoint directly from the CLI.
 *   view             Start the LAVS host for a single registry dir and open a bundle.
 *   host             Start the global LAVS Host (multi-dir, global singleton on port 7842).
 *
 * Usage:
 *   npx lavs-runtime serve-registry  --registry-dir ./bundles [--registry-dir ./more]
 *   npx lavs-runtime serve           --agent-dir ./agents/jarvis [--agent-id jarvis]
 *   npx lavs-runtime init            --agent-dir ./agents/jarvis
 *   npx lavs-runtime validate        --agent-dir ./agents/jarvis
 *   npx lavs-runtime discover        [--registry-dir .] [--registry-dir ./other]
 *   npx lavs-runtime call            <endpoint> [--agent-dir .] [--input '{"key":"val"}']
 *   npx lavs-runtime view            [contentType] [--registry-dir .] [--port 7842] [--no-open]
 *   npx lavs-runtime host            [--registry-dir dir1] [--registry-dir dir2] [--port 7842]
 *
 * Global host:
 *   `lavs host` is a long-running process that aggregates bundles from multiple
 *   registry dirs. MCP servers and `lavs call` automatically notify it after
 *   mutations so views refresh without any additional configuration.
 */

import fs from 'fs';
import path from 'path';
import { createLAVSMcpServer, createLAVSRegistryMcpServer, connectStdio } from './mcp-server';
import { ManifestLoader } from './loader';
import { LAVSToolGenerator } from './tool-generator';
import { discoverBundles, discoverBundlesFromDirs, createHostServer } from './host-server';

const DEFAULT_HOST_PORT = 7842;

type Command = 'serve' | 'serve-registry' | 'init' | 'validate' | 'discover' | 'call' | 'view' | 'host' | 'daemon';
type DaemonAction = 'install' | 'uninstall' | 'status';

interface CLIOptions {
  command: Command;
  // serve / init / validate
  agentDir: string;
  agentId: string;
  projectPath?: string;
  // discover / view / host (can repeat --registry-dir)
  registryDirs: string[];
  // call
  endpoint: string;
  input?: string;
  // view
  contentType?: string;
  port: number;
  noOpen: boolean;
  /** view --bare: full-bleed view, no host chrome. */
  bare?: boolean;
  // daemon
  daemonAction?: DaemonAction;
}

const SUPPORTED: Command[] = ['serve', 'serve-registry', 'init', 'validate', 'discover', 'call', 'view', 'host', 'daemon'];

function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  if (!SUPPORTED.includes(command as Command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  let agentDir = '';
  let agentId = '';
  let projectPath: string | undefined;
  const registryDirsRaw: string[] = [];
  let endpoint = '';
  let input: string | undefined;
  let contentType: string | undefined;
  let port = DEFAULT_HOST_PORT;
  let noOpen = false;
  let bare = false;

  // For `call` and `view`, the first positional arg after command is optional
  let positionalIndex = 1; // args[positionalIndex] is first positional after command
  const cmd = command as Command;

  let daemonAction: DaemonAction | undefined;

  if (cmd === 'call') {
    if (args[1] && !args[1].startsWith('-')) {
      endpoint = args[1];
      positionalIndex = 2;
    }
  } else if (cmd === 'view') {
    if (args[1] && !args[1].startsWith('-')) {
      contentType = args[1];
      positionalIndex = 2;
    }
  } else if (cmd === 'daemon') {
    const action = args[1];
    if (!action || !['install', 'uninstall', 'status'].includes(action)) {
      console.error('Usage: lavs-runtime daemon <install|uninstall|status> [--registry-dir <path>] [--port <n>]');
      process.exit(1);
    }
    daemonAction = action as DaemonAction;
    positionalIndex = 2;
  }

  for (let i = positionalIndex; i < args.length; i++) {
    switch (args[i]) {
      case '--agent-dir':    agentDir    = args[++i]; break;
      case '--agent-id':     agentId     = args[++i]; break;
      case '--project-path': projectPath = args[++i]; break;
      case '--registry-dir': registryDirsRaw.push(args[++i]); break;
      case '--input':        input       = args[++i]; break;
      case '--port':         port        = parseInt(args[++i], 10) || DEFAULT_HOST_PORT; break;
      case '--no-open':      noOpen      = true; break;
      case '--bare':         bare        = true; break;
      case '--quiet':        process.env.LAVS_QUIET = '1'; break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  // Resolve directories
  const cwd = process.cwd();

  if (!agentDir) {
    agentDir = cmd === 'init' ? '.' : cwd;
  }
  agentDir = path.resolve(agentDir);

  // Resolve registry dirs.
  // For discover/view/host: default to cwd if none given.
  // For serve-registry: pass as-is (empty = dynamic mode).
  const registryDirs = registryDirsRaw.length
    ? registryDirsRaw.map((d) => path.resolve(d))
    : (command === 'serve-registry' ? [] : [cwd]);

  if (!agentId) agentId = path.basename(agentDir);

  // For `serve` / `validate`, require --agent-dir to be explicit OR a lavs.json exists in cwd
  if (cmd === 'serve' || cmd === 'validate') {
    if (!fs.existsSync(path.join(agentDir, 'lavs.json'))) {
      console.error(`Error: no lavs.json found in ${agentDir}`);
      console.error('Use --agent-dir <path> to point to an agent directory.');
      process.exit(1);
    }
  }

  // `call` requires endpoint
  if (cmd === 'call' && !endpoint) {
    console.error('Error: `lavs call` requires an endpoint name.\nUsage: lavs-runtime call <endpoint> [--agent-dir .] [--input \'{"k":"v"}\']');
    process.exit(1);
  }

  return { command: cmd, agentDir, agentId, projectPath, registryDirs, endpoint, input, contentType, port, noOpen, bare, daemonAction };
}

function printUsage(): void {
  console.error(`
LAVS Runtime — CLI for structured Agent views

Usage:
  lavs-runtime <command> [options]

Commands:
  serve       Start an MCP server (stdio) exposing LAVS endpoints as tools
  init        Scaffold a minimal lavs.json in --agent-dir
  validate    Load and validate the lavs.json in --agent-dir
  discover    List all LAVS bundles in a directory
  call        Call a LAVS endpoint directly (notifies running host if present)
  view        Open the LAVS standalone host in a browser tab
  daemon      Manage LAVS host as a background daemon (macOS: launchd; Linux: systemd)

Options (serve / init / validate):
  --agent-dir <path>       Agent directory with lavs.json (default: cwd)
  --agent-id  <id>         Agent ID (default: directory name)
  --project-path <path>    Data isolation path (serve only)

Options (discover / view):
  --registry-dir <path>    Directory to scan for bundles (default: cwd)
  --port <n>               Host server port (default: ${DEFAULT_HOST_PORT})
  --no-open                Don't auto-open browser (view only)
  --bare                   Hide host chrome; full-bleed view (view only)

Options (call):
  --agent-dir <path>       Agent directory with lavs.json (default: cwd)
  --input <json>           Input parameters as JSON string (default: {})
  --quiet                  Suppress diagnostic logging (stderr) — use when piping output

Global options:
  --quiet                  Applies to any command; silences [LAVS] tracing on stderr

Examples:
  # Open the standalone host for all bundles in ./agents/
  lavs-runtime view --registry-dir ./agents

  # Open a specific bundle's view directly
  lavs-runtime view todo-list --registry-dir ./agents

  # Call an endpoint (view refreshes automatically if host is running)
  lavs-runtime call addTodo --input '{"text":"buy milk"}'

  # List available bundles
  lavs-runtime discover --registry-dir ./agents

  # Start MCP server (for MCP-compatible clients)
  lavs-runtime serve --agent-dir ./agents/jarvis
`.trim());
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  switch (options.command) {
    case 'serve':          await runServe(options);         break;
    case 'serve-registry': await runServeRegistry(options); break;
    case 'init':           await runInit(options);          break;
    case 'validate': await runValidate(options); break;
    case 'discover': await runDiscover(options); break;
    case 'call':     await runCall(options);     break;
    case 'view':     await runView(options);     break;
    case 'host':     await runHost(options);     break;
    case 'daemon':   await runDaemon(options);   break;
  }
}

// ── serve ──────────────────────────────────────────────────────────────────

async function runServe(options: CLIOptions): Promise<void> {
  console.error(`[LAVS] Starting MCP server for agent "${options.agentId}"`);
  console.error(`[LAVS] Agent directory: ${options.agentDir}`);
  if (options.projectPath) console.error(`[LAVS] Project path: ${options.projectPath}`);

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

// ── serve-registry ─────────────────────────────────────────────────────────

/**
 * Start a single unified MCP server that serves ALL bundles in one or more
 * registry directories. Tool names: lavs_<bundle>_<endpoint>.
 *
 * Bundle authors only need to write scripts + lavs.json.
 * No per-bundle MCP server configuration is required.
 */
async function runServeRegistry(options: CLIOptions): Promise<void> {
  console.error(`[LAVS Registry MCP] Starting unified MCP server (stdio)...`);
  if (options.registryDirs.length) {
    console.error(`[LAVS Registry MCP] Registries: ${options.registryDirs.join(', ')}`);
  } else {
    console.error(`[LAVS Registry MCP] Dynamic mode — no --registry-dir set; tools accept registryDir at call-time.`);
  }

  try {
    const server = await createLAVSRegistryMcpServer({
      registryDirs: options.registryDirs,
      projectPath: options.projectPath,
    });
    await connectStdio(server);
  } catch (error: any) {
    console.error(`[LAVS Registry MCP] Failed to start: ${error.message}`);
    process.exit(1);
  }
}

// ── init ───────────────────────────────────────────────────────────────────

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
  console.error('[LAVS] Next steps:');
  console.error(`  - Edit endpoints/handlers to fit your agent`);
  console.error(`  - Run \`lavs-runtime validate --agent-dir ${options.agentDir}\` to check it`);
  console.error(`  - Run \`lavs-runtime view --registry-dir ${path.dirname(options.agentDir)}\` to open the host`);
}

// ── validate ───────────────────────────────────────────────────────────────

async function runValidate(options: CLIOptions): Promise<void> {
  const manifestPath = path.join(options.agentDir, 'lavs.json');
  console.error(`[LAVS] Validating ${manifestPath}`);

  try {
    const loader = new ManifestLoader();
    const manifest = await loader.load(manifestPath);
    console.error(`[LAVS] OK — service "${manifest.name}" v${manifest.version}`);

    const cfgPath = path.join(options.agentDir, 'mcp-config.json');
    if (fs.existsSync(cfgPath)) {
      validateMcpConfig(cfgPath);
      console.error('[LAVS] mcp-config.json OK');
    }

    console.error(
      `[LAVS] ${manifest.endpoints.length} endpoint(s): ${manifest.endpoints.map((e) => e.id).join(', ')}`
    );
  } catch (error: any) {
    console.error(`[LAVS] Validation failed: ${error.message}`);
    if (error.data) console.error(JSON.stringify(error.data, null, 2));
    process.exit(1);
  }
}

// ── discover ───────────────────────────────────────────────────────────────

async function runDiscover(options: CLIOptions): Promise<void> {
  console.error(`[LAVS] Scanning ${options.registryDirs.join(', ')}`);

  const bundles = await discoverBundlesFromDirs(options.registryDirs);

  if (!bundles.length) {
    console.error('[LAVS] No LAVS bundles found.');
    console.error('  Create one with: lavs-runtime init --agent-dir ./my-bundle');
    return;
  }

  console.log(`Found ${bundles.length} bundle(s):\n`);
  for (const b of bundles) {
    console.log(`  📦 ${b.name}  (${b.contentType})`);
    if (b.description) console.log(`     ${b.description}`);
    console.log(`     dir: ${b.dir}`);
    console.log(`     view: ${b.hasView ? b.viewEntry : '(none)'}`);
    console.log(`     endpoints: ${b.endpoints.map((e) => e.id).join(', ')}`);
    console.log('');
  }
}

// ── call ───────────────────────────────────────────────────────────────────

async function runCall(options: CLIOptions): Promise<void> {
  const { endpoint, agentDir, agentId, input: inputStr } = options;

  let input: unknown = {};
  if (inputStr) {
    try { input = JSON.parse(inputStr); }
    catch { console.error(`[LAVS] Invalid --input JSON: ${inputStr}`); process.exit(1); }
  }

  if (process.env.LAVS_QUIET !== '1') {
    console.error(`[LAVS] Calling endpoint "${endpoint}" in ${agentDir}`);
  }

  try {
    const gen = new LAVSToolGenerator();
    const tools = await gen.generateTools(agentId, agentDir);
    const tool = tools.find((t) => t.tool.name === `lavs_${endpoint}`);

    if (!tool) {
      const available = tools.map((t) => t.tool.name.replace('lavs_', '')).join(', ');
      console.error(`[LAVS] Endpoint "${endpoint}" not found.`);
      if (available) console.error(`  Available: ${available}`);
      process.exit(1);
    }

    const result = await tool.execute(input);

    // Print result to stdout (for piping / script use).
    // Host notification is handled inside tool-generator's execute (notifyGlobalHost),
    // which covers CLI / MCP / host paths uniformly — no need to notify again here.
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));

  } catch (error: any) {
    console.error(`[LAVS] Call failed: ${error.message}`);
    process.exit(1);
  }
}

// ── view ───────────────────────────────────────────────────────────────────

async function runView(options: CLIOptions): Promise<void> {
  const { registryDirs, port, noOpen, contentType, bare } = options;

  console.error(`[LAVS] Starting host server on port ${port}${bare ? ' (bare)' : ''}...`);
  console.error(`[LAVS] Registries: ${registryDirs.join(', ')}`);

  const bundles = await discoverBundlesFromDirs(registryDirs);
  if (!bundles.length) {
    console.error('[LAVS] No LAVS bundles found.');
    console.error(`  Run \`lavs-runtime init --agent-dir ${registryDirs[0]}/my-bundle\` to create one.`);
    process.exit(1);
  }

  const host = await createHostServer({ registryDirs, port, bare, bareBundle: contentType ?? null });

  const hash = contentType ? `#${encodeURIComponent(contentType)}` : '';
  const url = `http://localhost:${port}/${hash}`;

  console.error(`[LAVS] Host running at ${url}`);
  console.error(`[LAVS] ${bundles.length} bundle(s): ${bundles.map((b) => b.name).join(', ')}`);
  console.error('[LAVS] Press Ctrl+C to stop.\n');

  if (!noOpen) {
    await openBrowser(url);
  }

  process.on('SIGINT',  async () => { await host.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await host.close(); process.exit(0); });
  await new Promise<void>(() => {});
}

// ── host ───────────────────────────────────────────────────────────────────

/**
 * Global singleton LAVS Host — aggregates bundles from multiple registry dirs.
 * Designed to be started once per machine/session; all agent MCP servers and
 * `lavs call` invocations notify it automatically.
 */
async function runHost(options: CLIOptions): Promise<void> {
  const { registryDirs, port, noOpen } = options;

  console.error(`[LAVS] ✦ Global LAVS Host — port ${port}`);
  console.error(`[LAVS] Registries:`);
  for (const d of registryDirs) console.error(`  • ${d}`);

  const bundles = await discoverBundlesFromDirs(registryDirs);

  const host = await createHostServer({ registryDirs, port });

  const url = `http://localhost:${port}/`;
  console.error(`\n[LAVS] Host running at ${url}`);
  if (bundles.length) {
    console.error(`[LAVS] ${bundles.length} bundle(s): ${bundles.map((b) => b.name).join(', ')}`);
  } else {
    console.error('[LAVS] No bundles found yet — add --registry-dir or drop lavs.json bundles in the scanned directories.');
  }
  console.error('[LAVS] Press Ctrl+C to stop.\n');

  if (!noOpen) {
    await openBrowser(url);
  }

  process.on('SIGINT',  async () => { await host.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await host.close(); process.exit(0); });
  await new Promise<void>(() => {});
}

// ── daemon ──────────────────────────────────────────────────────────────────

const DAEMON_LABEL = 'com.lavs.host';
const DAEMON_PLIST_PATH = `${process.env.HOME}/Library/LaunchAgents/${DAEMON_LABEL}.plist`;

/**
 * Manage the LAVS host as a background daemon.
 *
 * macOS:  Generates a launchd plist in ~/Library/LaunchAgents/ and loads it.
 * Linux:  Generates a systemd user service in ~/.config/systemd/user/ and enables it.
 *
 * Usage:
 *   lavs-runtime daemon install [--registry-dir <path>] [--port <n>]
 *   lavs-runtime daemon uninstall
 *   lavs-runtime daemon status
 */
async function runDaemon(options: CLIOptions): Promise<void> {
  const { daemonAction, registryDirs, port } = options;
  const platform = process.platform;

  if (platform === 'win32') {
    console.error('[LAVS daemon] Windows is not yet supported. Use pm2 or NSSM instead:');
    console.error('  pm2 start "node /path/to/lavs-runtime/dist/cli.js -- host --no-open" --name lavs-host');
    process.exit(1);
  }

  if (platform === 'darwin') {
    await runDaemonMac(daemonAction!, registryDirs, port);
  } else {
    await runDaemonLinux(daemonAction!, registryDirs, port);
  }
}

/** Generate the launchd ProgramArguments array for the lavs host command. */
function buildHostArgs(registryDirs: string[], port: number): string[] {
  const cliJs = path.resolve(__filename, '../../dist/cli.js');
  const args: string[] = [process.execPath, cliJs, 'host', '--no-open', '--port', String(port)];
  for (const d of registryDirs) {
    args.push('--registry-dir', d);
  }
  return args;
}

async function runDaemonMac(action: DaemonAction, registryDirs: string[], port: number): Promise<void> {
  const { execSync } = await import('child_process');
  const plistPath = DAEMON_PLIST_PATH;

  if (action === 'install') {
    const progArgs = buildHostArgs(registryDirs, port);
    const argXml = progArgs.map((a) => `        <string>${a}</string>`).join('\n');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${DAEMON_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>LAVS_HOST_PORT</key>
        <string>${port}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/lavs-host.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/lavs-host.err</string>
</dict>
</plist>`;

    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plist, 'utf-8');

    // Unload existing instance if present (ignore errors)
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'ignore' }); } catch { /* ok */ }
    execSync(`launchctl load "${plistPath}"`);

    console.error(`[LAVS daemon] ✅ Installed and started.`);
    console.error(`  plist: ${plistPath}`);
    console.error(`  port:  ${port}`);
    if (registryDirs.length) console.error(`  dirs:  ${registryDirs.join(', ')}`);
    console.error(`  logs:  /tmp/lavs-host.log  (err: /tmp/lavs-host.err)`);
    console.error(`  url:   http://localhost:${port}/`);
    console.error(`\n  To stop:      lavs-runtime daemon uninstall`);
    console.error(`  To view logs: tail -f /tmp/lavs-host.log`);

  } else if (action === 'uninstall') {
    if (!fs.existsSync(plistPath)) {
      console.error(`[LAVS daemon] Not installed (no plist at ${plistPath}).`);
      return;
    }
    try { execSync(`launchctl unload "${plistPath}"`); } catch { /* already unloaded */ }
    fs.unlinkSync(plistPath);
    console.error(`[LAVS daemon] ✅ Uninstalled.`);

  } else if (action === 'status') {
    try {
      const out = execSync(`launchctl list "${DAEMON_LABEL}" 2>&1`).toString();
      const running = out.includes('"PID"') || out.includes(DAEMON_LABEL);
      console.error(`[LAVS daemon] ${running ? '✅ Running' : '⚠️  Loaded but not running'}`);
      console.error(out.trim());
    } catch {
      console.error(`[LAVS daemon] ❌ Not running (service not loaded or not installed).`);
      if (fs.existsSync(plistPath)) {
        console.error(`  plist exists at ${plistPath} but is not loaded — try: lavs-runtime daemon install`);
      }
    }
    // Show quick connectivity check
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/discover`, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) {
        const bundles = await resp.json() as any[];
        console.error(`  Host at port ${port}: responding — ${bundles.length} bundle(s)`);
      }
    } catch { /* host not running */ }
  }
}

async function runDaemonLinux(action: DaemonAction, registryDirs: string[], port: number): Promise<void> {
  const { execSync } = await import('child_process');
  const serviceDir = `${process.env.HOME}/.config/systemd/user`;
  const serviceFile = `${serviceDir}/lavs-host.service`;

  if (action === 'install') {
    const progArgs = buildHostArgs(registryDirs, port);
    const execStart = progArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    const service = `[Unit]
Description=LAVS Global Host
After=network.target

[Service]
ExecStart=${execStart}
Environment="LAVS_HOST_PORT=${port}"
Restart=on-failure
RestartSec=5
StandardOutput=append:/tmp/lavs-host.log
StandardError=append:/tmp/lavs-host.err

[Install]
WantedBy=default.target
`;
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(serviceFile, service, 'utf-8');
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now lavs-host');
    console.error(`[LAVS daemon] ✅ Installed and started via systemd user service.`);
    console.error(`  service: ${serviceFile}`);
    console.error(`  logs:    journalctl --user -u lavs-host -f`);
    console.error(`  url:     http://localhost:${port}/`);

  } else if (action === 'uninstall') {
    try { execSync('systemctl --user disable --now lavs-host'); } catch { /* ok */ }
    if (fs.existsSync(serviceFile)) fs.unlinkSync(serviceFile);
    try { execSync('systemctl --user daemon-reload'); } catch { /* ok */ }
    console.error('[LAVS daemon] ✅ Uninstalled.');

  } else if (action === 'status') {
    try {
      const out = execSync('systemctl --user status lavs-host 2>&1').toString();
      console.error(out.trim());
    } catch (e: any) {
      console.error(`[LAVS daemon] Not running:\n${e.stdout?.toString() || ''}`);
    }
  }
}

/**
 * Open a URL in the default browser (cross-platform).
 */
async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('child_process');
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function validateMcpConfig(cfgPath: string): void {
  let raw: string;
  try { raw = fs.readFileSync(cfgPath, 'utf-8'); }
  catch (e: any) {
    console.error(`[LAVS] Validation failed: cannot read mcp-config.json: ${e.message}`);
    process.exit(1);
    return;
  }

  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch (e: any) {
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
      console.error(`[LAVS] Validation failed: mcpServers."${name}".transport must be "stdio" or "http"`);
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

function SAMPLE_MANIFEST(agentId: string): Record<string, unknown> {
  return {
    lavs: '1.0',
    name: agentId || 'my-lavs-service',
    contentType: `lavs/${agentId || 'my-lavs-service'}`,
    version: '1.0.0',
    description: 'A LAVS service scaffolded by `lavs-runtime init`',
    endpoints: [
      {
        id: 'listItems',
        method: 'query',
        description: 'List all items',
        handler: { type: 'script', command: 'node', args: ['scripts/list.js'] },
        schema: { output: { type: 'array', items: { type: 'object' } } },
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
