"""
LAVS protocol type definitions (Pydantic v2 models).

Mirrors the TypeScript types in sdk/typescript/types/src/index.ts.
See docs/SPEC.md for full specification.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, Field


# --- Handler variants ---


class ScriptHandler(BaseModel):
    """Script handler - executes a script/command."""

    type: Literal["script"] = "script"
    command: str = Field(..., description="Command to execute (e.g., 'node', 'python3')")
    args: list[str] | None = Field(default=None, description="Static arguments")
    input: Literal["args", "stdin", "env"] | None = Field(
        default=None, description="How to pass input parameters to the script"
    )
    cwd: str | None = Field(default=None, description="Working directory")
    timeout: int | None = Field(default=None, ge=0, description="Max execution time (ms)")
    env: dict[str, str] | None = Field(default=None, description="Environment variables")


class FunctionHandler(BaseModel):
    """Function handler - calls a JavaScript/TypeScript function."""

    type: Literal["function"] = "function"
    module: str = Field(..., description="Path to JS/TS module")
    function: str = Field(..., description="Function name to call")


class HTTPHandler(BaseModel):
    """HTTP handler - proxies to HTTP endpoint."""

    type: Literal["http"] = "http"
    url: str = Field(..., description="HTTP endpoint URL")
    method: str = Field(..., description="HTTP method")
    headers: dict[str, str] | None = Field(default=None, description="HTTP headers")


class MCPHandler(BaseModel):
    """MCP handler - bridges to MCP server tool."""

    type: Literal["mcp"] = "mcp"
    server: str = Field(..., description="MCP server name")
    tool: str = Field(..., description="MCP tool name")


Handler = Union[ScriptHandler, FunctionHandler, HTTPHandler, MCPHandler]


# --- Schema ---

JSONSchema = dict[str, Any]


class Schema(BaseModel):
    """JSON Schema for input/output validation."""

    input: JSONSchema | None = Field(default=None, description="Input parameters schema")
    output: JSONSchema | None = Field(default=None, description="Output data schema")


TypeDefinitions = dict[str, JSONSchema]


# --- Component source variants ---


class CDNComponentSource(BaseModel):
    """Component loaded from CDN."""

    type: Literal["cdn"] = "cdn"
    url: str = Field(..., description="CDN URL")
    export_name: str | None = Field(default=None, alias="exportName", description="Export name")

    model_config = {"populate_by_name": True}


class NPMComponentSource(BaseModel):
    """Component loaded from npm package."""

    type: Literal["npm"] = "npm"
    package: str = Field(..., description="npm package name")
    version: str | None = Field(default=None, description="Package version")


class LocalComponentSource(BaseModel):
    """Component loaded from local path."""

    type: Literal["local"] = "local"
    path: str = Field(..., description="Local file path")


class InlineComponentSource(BaseModel):
    """Component with inline code."""

    type: Literal["inline"] = "inline"
    code: str = Field(..., description="Inline code")


ComponentSource = Union[
    CDNComponentSource,
    NPMComponentSource,
    LocalComponentSource,
    InlineComponentSource,
]


# --- View config ---


class ViewConfig(BaseModel):
    """UI component configuration."""

    component: ComponentSource
    fallback: Literal["list", "table", "json"] | None = Field(
        default=None, description="Fallback display mode when component fails"
    )
    icon: str | None = Field(default=None, description="Icon identifier")
    theme: dict[str, str] | None = Field(default=None, description="Theme CSS variables")


# --- Permissions ---


class Permissions(BaseModel):
    """
    Security constraints.

    Enforcement levels:
    - ENFORCED: Runtime actively prevents violations (path traversal, maxExecutionTime)
    - ADVISORY: Declared for documentation/auditing, not enforced at OS level
      (fileAccess, networkAccess, maxMemory)
    """

    file_access: list[str] | None = Field(
        default=None,
        alias="fileAccess",
        description="[ADVISORY] Allowed file path patterns (glob). Use '!' prefix for deny.",
    )
    network_access: bool | list[str] | None = Field(
        default=None,
        alias="networkAccess",
        description="[ADVISORY] Network access control. false=no, true=all, array=whitelist.",
    )
    max_execution_time: int | None = Field(
        default=None,
        alias="maxExecutionTime",
        ge=0,
        description="[ENFORCED] Max handler execution time in milliseconds.",
    )
    max_memory: int | None = Field(
        default=None,
        alias="maxMemory",
        ge=0,
        description="[ADVISORY] Max memory usage in bytes.",
    )

    model_config = {"populate_by_name": True}


# --- Endpoint ---


class Endpoint(BaseModel):
    """A callable operation exposed by the service."""

    id: str = Field(..., description="Unique endpoint identifier")
    method: Literal["query", "mutation", "subscription"] = Field(
        ..., description="Operation type"
    )
    description: str | None = Field(default=None, description="Human-readable description")
    handler: Handler = Field(..., description="How to execute this endpoint")
    endpoint_schema: Schema | None = Field(
        default=None,
        description="Input/output schema",
        alias="schema",
    )
    permissions: Permissions | None = Field(
        default=None, description="Endpoint-specific permissions"
    )


# --- Manifest ---


class LAVSManifest(BaseModel):
    """LAVS manifest - defines agent's data interface and view configuration."""

    lavs: str = Field(..., description="Protocol version (e.g., '1.0')")
    name: str = Field(..., description="Service name (unique identifier)")
    version: str = Field(..., description="Service version (semver)")
    description: str | None = Field(default=None, description="Human-readable description")
    endpoints: list[Endpoint] = Field(..., description="Exposed operations")
    view: ViewConfig | None = Field(default=None, description="Optional UI component")
    types: TypeDefinitions | None = Field(
        default=None, description="Reusable type definitions (JSON Schema)"
    )
    permissions: Permissions | None = Field(
        default=None, description="Service-level security constraints"
    )


# --- Execution context ---


class ExecutionContext(BaseModel):
    """Runtime context for handler execution."""

    endpoint_id: str = Field(..., alias="endpointId", description="Endpoint being executed")
    agent_id: str = Field(..., alias="agentId", description="Agent ID")
    workdir: str = Field(..., description="Working directory")
    permissions: Permissions = Field(..., description="Permissions to enforce")
    timeout: int | None = Field(default=None, description="Timeout override (ms)")
    env: dict[str, str] | None = Field(default=None, description="Additional env vars")

    model_config = {"populate_by_name": True}
