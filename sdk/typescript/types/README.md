# lavs-types

TypeScript type definitions for the **LAVS (Local Agent View Service)** protocol.

LAVS is a protocol that bridges AI Agents and Visual UIs, enabling local AI agents to expose structured data interfaces rendered as interactive visual components.

## Install

```bash
npm install lavs-types
```

## Usage

```typescript
import type {
  LAVSManifest,
  Endpoint,
  Handler,
  ViewConfig,
  Permissions,
} from 'lavs-types';

const manifest: LAVSManifest = {
  lavs: '1.0',
  name: 'my-service',
  version: '1.0.0',
  endpoints: [
    {
      id: 'getData',
      method: 'query',
      handler: { type: 'script', command: 'node', args: ['get-data.js'] },
    },
  ],
};
```

## Exported Types

| Type | Description |
|------|-------------|
| `LAVSManifest` | Root manifest definition |
| `Endpoint` | Callable operation (query / mutation / subscription) |
| `Handler` | Union of ScriptHandler, FunctionHandler, HTTPHandler, MCPHandler |
| `Schema` | JSON Schema for input/output validation |
| `ViewConfig` | UI component configuration |
| `Permissions` | Security constraints |
| `ExecutionContext` | Runtime context for handler execution |
| `LAVSError` | Standard error class |
| `LAVSErrorCode` | JSON-RPC 2.0 compatible error codes |

## Related Packages

- [`lavs-runtime`](https://www.npmjs.com/package/lavs-runtime) — Server-side runtime (manifest loading, validation, handler execution)
- [`lavs-client`](https://www.npmjs.com/package/lavs-client) — Client SDK for frontend applications

## License

MIT
