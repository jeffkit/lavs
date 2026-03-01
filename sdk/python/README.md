# LAVS Python SDK

Python SDK for the **LAVS (Local Agent View Service)** protocol. Provides type definitions, server-side runtime components, and a client for calling LAVS endpoints.

## Structure

```
python/
├── lavs_types/      # Protocol type definitions (Pydantic v2)
├── lavs_runtime/    # Server-side runtime
├── lavs_client/     # Client SDK
├── tests/
└── pyproject.toml
```

## Installation

```bash
cd platform/lavs/sdk/python
uv sync
```

## Packages

### lavs_types

Pydantic v2 models for all protocol types:

```python
from lavs_types import (
    LAVSManifest,
    Endpoint,
    Handler,
    ScriptHandler,
    Permissions,
    ExecutionContext,
    LAVSError,
    LAVSErrorCode,
)
```

### lavs_runtime

Server-side components for loading manifests, validating inputs/outputs, checking permissions, executing scripts, and rate limiting:

```python
from lavs_runtime import (
    ManifestLoader,
    LAVSValidator,
    PermissionChecker,
    ScriptExecutor,
    LAVSRateLimiter,
)

# Load manifest
loader = ManifestLoader()
manifest = loader.load("/path/to/lavs.json")

# Validate input
validator = LAVSValidator()
validator.assert_valid_input(endpoint, input_data, manifest.types)

# Check permissions
checker = PermissionChecker()
perms = checker.merge_permissions(manifest.permissions, endpoint.permissions)
checker.assert_allowed(handler, perms, agent_dir)

# Execute script handler
executor = ScriptExecutor()
result = executor.execute(handler, input_data, context)

# Rate limiting
limiter = LAVSRateLimiter()
if limiter.check(f"{agent_id}:{endpoint_id}").allowed:
    # proceed
```

### lavs_client

Client for calling LAVS endpoints:

```python
from lavs_client import LAVSClient

client = LAVSClient(
    agent_id="jarvis",
    base_url="http://localhost:3000",
    project_path="/path/to/project",
    auth_token="optional-token",
)

# Get manifest
manifest = client.get_manifest()

# Call endpoint
result = client.call("listTodos")
result = client.call("addTodo", {"text": "Buy milk", "priority": 1})

# Subscribe to updates (SSE)
unsubscribe = client.subscribe(
    "todoUpdates",
    callback=lambda data: print("Update:", data),
    on_connected=lambda info: print("Connected:", info),
)
# ... later ...
unsubscribe()
```

## Development

```bash
# Install with dev dependencies
uv sync --all-extras

# Run tests
uv run pytest

# Lint
uv run ruff check .
```

## Conventions

- **PEP 8** naming (snake_case)
- **Type hints** everywhere
- **Google-style** docstrings
- **uv** as package manager
- **ruff** for linting

## Protocol Reference

See [docs/SPEC.md](../../docs/SPEC.md) for the full LAVS protocol specification.
