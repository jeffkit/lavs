# lavs-client

Client SDK for the **LAVS (Local Agent View Service)** protocol.

Enables frontend applications to call LAVS endpoints via SSE (Server-Sent Events) streaming, with support for queries, mutations, and real-time subscriptions.

## Install

```bash
npm install lavs-client
```

## Usage

```typescript
import { LAVSClient } from 'lavs-client';

const client = new LAVSClient({
  baseUrl: 'http://localhost:4936',
  agentId: 'my-agent',
});

// Query endpoint
const todos = await client.query('listTodos');

// Mutation endpoint
const newTodo = await client.mutate('addTodo', {
  text: 'Buy groceries',
  priority: 3,
});

// Subscription (real-time updates via SSE)
const unsubscribe = client.subscribe('watchTodos', {}, (event) => {
  console.log('Update:', event.data);
});
```

## API

### `new LAVSClient(options)`

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | LAVS server base URL |
| `agentId` | `string` | Agent identifier |

### Methods

| Method | Description |
|--------|-------------|
| `query(endpoint, input?)` | Call a query endpoint |
| `mutate(endpoint, input?)` | Call a mutation endpoint |
| `subscribe(endpoint, input?, callback)` | Subscribe to real-time updates |

## Related Packages

- [`lavs-types`](https://www.npmjs.com/package/lavs-types) — Protocol type definitions
- [`lavs-runtime`](https://www.npmjs.com/package/lavs-runtime) — Server-side runtime

## License

MIT
