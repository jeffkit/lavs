"""Tests for lavs_types models and validation."""

import pytest

from lavs_types import (
    LAVSManifest,
    Endpoint,
    ScriptHandler,
    FunctionHandler,
    HTTPHandler,
    MCPHandler,
    Schema,
    ViewConfig,
    CDNComponentSource,
    Permissions,
    ExecutionContext,
    LAVSError,
    LAVSErrorCode,
)


def test_script_handler_creation() -> None:
    """Test ScriptHandler model creation."""
    handler = ScriptHandler(
        type="script",
        command="python3",
        args=["script.py", "run"],
        input="stdin",
        timeout=5000,
    )
    assert handler.type == "script"
    assert handler.command == "python3"
    assert handler.args == ["script.py", "run"]
    assert handler.input == "stdin"
    assert handler.timeout == 5000


def test_handler_union_discriminator() -> None:
    """Test Handler union with type discriminator."""
    script = ScriptHandler(command="node", args=["app.js"])
    assert script.type == "script"

    http = HTTPHandler(url="https://api.example.com", method="POST")
    assert http.type == "http"

    mcp = MCPHandler(server="github", tool="list_issues")
    assert mcp.type == "mcp"


def test_lavs_manifest_creation() -> None:
    """Test LAVSManifest model creation."""
    manifest = LAVSManifest(
        lavs="1.0",
        name="todo-manager",
        version="1.0.0",
        description="Todo service",
        endpoints=[
            Endpoint(
                id="listTodos",
                method="query",
                handler=ScriptHandler(command="node", args=["list.js"]),
            ),
        ],
    )
    assert manifest.lavs == "1.0"
    assert manifest.name == "todo-manager"
    assert len(manifest.endpoints) == 1
    assert manifest.endpoints[0].id == "listTodos"


def test_manifest_from_json_camel_case() -> None:
    """Test manifest parses camelCase from JSON."""
    data = {
        "lavs": "1.0",
        "name": "test",
        "version": "1.0.0",
        "endpoints": [
            {
                "id": "getData",
                "method": "query",
                "handler": {"type": "script", "command": "cat", "args": ["data.json"]},
            },
        ],
        "permissions": {
            "fileAccess": ["./data/**/*.json"],
            "maxExecutionTime": 30000,
        },
    }
    manifest = LAVSManifest.model_validate(data)
    assert manifest.permissions is not None
    assert manifest.permissions.file_access == ["./data/**/*.json"]
    assert manifest.permissions.max_execution_time == 30000


def test_execution_context() -> None:
    """Test ExecutionContext model."""
    ctx = ExecutionContext(
        endpoint_id="addTodo",
        agent_id="jarvis",
        workdir="/tmp/agent",
        permissions=Permissions(),
    )
    assert ctx.endpoint_id == "addTodo"
    assert ctx.agent_id == "jarvis"
    assert ctx.workdir == "/tmp/agent"


def test_lavs_error() -> None:
    """Test LAVSError exception."""
    err = LAVSError(LAVSErrorCode.InvalidParams, "Missing field: text", {"field": "text"})
    assert err.code == LAVSErrorCode.InvalidParams
    assert "text" in err.message
    assert err.data == {"field": "text"}
    assert err.name == "LAVSError"


def test_lavs_error_to_dict() -> None:
    """Test LAVSError to_dict for JSON-RPC."""
    err = LAVSError(-32602, "Invalid params")
    d = err.to_dict()
    assert d["code"] == -32602
    assert d["message"] == "Invalid params"
