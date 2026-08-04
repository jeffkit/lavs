"""
LAVS Tool Generator.

Generates Claude SDK / MCP tool definitions from LAVS manifests and
dispatches calls to the appropriate handler executor.

Mirrors the TypeScript LAVSToolGenerator class; currently supports
``script`` handler type end-to-end. ``http`` and ``mcp`` handler types
are declared but raise NotImplementedError until their executors are added.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from lavs_runtime.loader import ManifestLoader
from lavs_runtime.permission_checker import PermissionChecker
from lavs_runtime.script_executor import ScriptExecutor
from lavs_runtime.validator import LAVSValidator
from lavs_types import (
    Endpoint,
    ExecutionContext,
    LAVSError,
    LAVSErrorCode,
    LAVSManifest,
)

logger = logging.getLogger(__name__)

_DEFAULT_HOST_PORT = 7842


def _get_host_port() -> int:
    env = os.environ.get("LAVS_HOST_PORT", "")
    try:
        n = int(env)
        if n > 0:
            return n
    except ValueError:
        pass
    return _DEFAULT_HOST_PORT


def _notify_host(bundle_name: str, endpoint_id: str, data: Any) -> None:
    """Fire-and-forget POST to the running LAVS host after a mutation."""
    try:
        port = _get_host_port()
        body = json.dumps({"data": data}).encode()
        url = (
            f"http://127.0.0.1:{port}/api/notify/"
            f"{urllib.parse.quote(bundle_name, safe='')}"
            f"/{urllib.parse.quote(endpoint_id, safe='')}"
        )
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=0.5):
            pass
    except Exception:
        pass  # host not running — silently ignore


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass
class ClaudeTool:
    """Claude SDK / MCP tool definition."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(
        default_factory=lambda: {"type": "object", "properties": {}},
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


ToolExecutor = Callable[[Any], Any]


@dataclass
class GeneratedTool:
    """A tool definition paired with its executor callable."""

    tool: ClaudeTool
    execute: ToolExecutor
    method: Literal["query", "mutation"]


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------


class LAVSToolGenerator:
    """
    Generate tool definitions from a LAVS manifest and dispatch calls.

    Usage::

        gen = LAVSToolGenerator()
        tools = gen.generate_tools(agent_id="myagent", agent_dir="/path/to/bundle")
        for gt in tools:
            result = gt.execute({"key": "value"})
    """

    def generate_tools(
        self,
        agent_id: str,
        agent_dir: str,
        project_path: str | None = None,
    ) -> list[GeneratedTool]:
        """
        Load the manifest in *agent_dir* and return one :class:`GeneratedTool`
        per non-subscription endpoint.

        Args:
            agent_id: Logical identifier for this agent instance.
            agent_dir: Directory containing ``lavs.json``.
            project_path: Optional data-isolation path forwarded as
                ``LAVS_PROJECT_PATH`` to script handlers.

        Returns:
            List of generated tools (empty if no ``lavs.json`` found).

        Raises:
            :class:`lavs_types.LAVSError`: On manifest parse / validation errors.
        """
        manifest_path = str(Path(agent_dir) / "lavs.json")
        loader = ManifestLoader()
        try:
            manifest = loader.load(manifest_path)
        except LAVSError as exc:
            if "not found" in str(exc).lower():
                return []
            raise

        tools: list[GeneratedTool] = []
        for endpoint in manifest.endpoints:
            if endpoint.method == "subscription":
                continue
            gt = self._build_tool(endpoint, manifest, agent_id, agent_dir, project_path)
            tools.append(gt)

        logger.debug("[LAVS] Generated %d tools for agent %s", len(tools), agent_id)
        return tools

    def has_lavs(self, agent_dir: str) -> bool:
        """Return True if *agent_dir* contains a valid ``lavs.json``."""
        try:
            manifest_path = str(Path(agent_dir) / "lavs.json")
            ManifestLoader().load(manifest_path)
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_tool(
        self,
        endpoint: Endpoint,
        manifest: LAVSManifest,
        agent_id: str,
        agent_dir: str,
        project_path: str | None,
    ) -> GeneratedTool:
        tool_name = f"lavs_{endpoint.id}"
        description = endpoint.description or f"Call {endpoint.id} from {manifest.name}"

        raw_schema = {}
        if endpoint.endpoint_schema and endpoint.endpoint_schema.input:
            raw_schema = endpoint.endpoint_schema.input
            if isinstance(raw_schema, dict):
                pass
            else:
                raw_schema = raw_schema.model_dump(exclude_none=True)

        input_schema: dict[str, Any] = {
            "type": "object",
            "properties": raw_schema.get("properties", {}),
        }
        if "required" in raw_schema:
            input_schema["required"] = raw_schema["required"]

        claude_tool = ClaudeTool(
            name=tool_name,
            description=description,
            input_schema=input_schema,
        )

        validator = LAVSValidator()
        perm_checker = PermissionChecker()
        manifest_types = manifest.types

        def execute(params: Any) -> Any:
            # 1. Validate input
            validator.assert_valid_input(endpoint, params, manifest_types)

            # 2. Merge permissions
            merged = perm_checker.merge_permissions(manifest.permissions, endpoint.permissions)

            # 3. Build execution context
            context_env: dict[str, str] | None = (
                {"LAVS_PROJECT_PATH": project_path} if project_path else None
            )
            context = ExecutionContext(
                endpoint_id=endpoint.id,
                agent_id=agent_id,
                workdir=agent_dir,
                permissions=merged,
                env=context_env,
            )

            # 4. Execute handler
            handler = endpoint.handler

            result: Any
            if getattr(handler, "type", None) == "script":
                # Permission check for script handlers
                perm_checker.assert_allowed(handler, merged, agent_dir)  # type: ignore[arg-type]
                executor = ScriptExecutor()
                result = executor.execute(handler, params, context)  # type: ignore[arg-type]
            elif getattr(handler, "type", None) in ("http", "mcp", "function"):
                raise NotImplementedError(
                    f"Handler type '{handler.type}' is not yet supported "  # type: ignore[union-attr]
                    "in the Python runtime tool generator. "
                    "Use the TypeScript runtime for http/mcp/function handlers."
                )
            else:
                raise LAVSError(
                    LAVSErrorCode.HandlerError,
                    f"Unknown handler type: {getattr(handler, 'type', 'unknown')}",
                )

            # 5. Notify host after mutations (fire-and-forget)
            if endpoint.method == "mutation" and not os.environ.get("LAVS_HOST_CALLER"):
                _notify_host(manifest.name, endpoint.id, result)

            # 6. Validate output (advisory: warn, don't raise)
            try:
                validator.assert_valid_output(endpoint, result, manifest_types)
            except LAVSError as warn_exc:
                logger.warning("[LAVS] Output validation warning for %s: %s", tool_name, warn_exc)

            return result

        return GeneratedTool(
            tool=claude_tool,
            execute=execute,
            method=endpoint.method,  # type: ignore[arg-type]
        )
