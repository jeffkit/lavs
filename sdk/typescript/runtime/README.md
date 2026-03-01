# lavs-runtime

Server-side runtime for the **LAVS (Local Agent View Service)** protocol.

Provides manifest loading, JSON Schema validation, handler execution (script & function), permission checking, rate limiting, subscription management, and AI tool generation.

## Install

```bash
npm install lavs-runtime
```

## Usage

```typescript
import {
  ManifestLoader,
  LAVSValidator,
  ScriptExecutor,
  PermissionChecker,
  LAVSToolGenerator,
} from 'lavs-runtime';

// Load and validate a LAVS manifest
const loader = new ManifestLoader();
const manifest = await loader.load('./lavs.json');

const validator = new LAVSValidator();
const result = validator.validateManifest(manifest);

if (result.valid) {
  // Execute a script handler
  const executor = new ScriptExecutor();
  const output = await executor.execute(manifest.endpoints[0].handler, {
    endpointId: 'getData',
    agentId: 'my-agent',
    workdir: process.cwd(),
    permissions: manifest.permissions ?? {},
  });
}
```

### Generate AI Tools from Manifest

```typescript
const generator = new LAVSToolGenerator();
const tools = generator.generate(manifest);

// tools can be passed to Claude or other LLM APIs
for (const tool of tools) {
  console.log(tool.name, tool.description);
}
```

## Core Modules

| Module | Description |
|--------|-------------|
| `ManifestLoader` | Load and parse `lavs.json` manifests |
| `LAVSValidator` | Validate manifests and endpoint I/O against JSON Schema |
| `ScriptExecutor` | Execute script handlers (node, python, etc.) |
| `FunctionExecutor` | Execute JS/TS function handlers |
| `PermissionChecker` | Enforce file access and execution permissions |
| `LAVSRateLimiter` | Rate limiting for endpoint calls |
| `SubscriptionManager` | SSE-based real-time subscriptions |
| `LAVSToolGenerator` | Generate Claude-compatible tool definitions |

## Related Packages

- [`lavs-types`](https://www.npmjs.com/package/lavs-types) — Protocol type definitions
- [`lavs-client`](https://www.npmjs.com/package/lavs-client) — Client SDK for frontend applications

## License

MIT
