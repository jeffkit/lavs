"""
LAVS Endpoint Runner (issue #16, layer 1).

Synchronous endpoint dispatch for a single bundle: validate input against the
manifest's JSON Schema, execute the handler (``script`` handlers run via
:class:`~lavs_runtime.script_executor.ScriptExecutor`; ``notify`` endpoints
without a handler short-circuit to ``{"ok": True}``), and report
``query``/``mutation``/``notify`` method so callers can decide whether to
broadcast an agent-action.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from lavs_runtime.loader import ManifestLoader
from lavs_runtime.permission_checker import PermissionChecker
from lavs_runtime.script_executor import ScriptExecutor
from lavs_runtime.validator import LAVSValidator
from lavs_types import Endpoint, ExecutionContext, LAVSError, LAVSErrorCode, LAVSManifest


@dataclass
class EndpointResult:
    """Result of one endpoint call."""

    endpoint: str
    method: Literal["query", "mutation", "notify", "subscription"]
    result: Any


class EndpointRunner:
    """
    Load a bundle's manifest once, then call its endpoints in-process.

    Usage::

        runner = EndpointRunner(manifest, agent_dir="./bundles/demo")
        result = runner.call("getItems", {})
        runner.call("setTheme", {"theme": "dark"})   # notify → broadcasts, no data
    """

    def __init__(
        self,
        manifest: LAVSManifest,
        agent_dir: str | os.PathLike[str],
        agent_id: str | None = None,
        project_path: str | None = None,
    ) -> None:
        self.manifest = manifest
        self.agent_dir = str(agent_dir)
        self.agent_id = agent_id or Path(self.agent_dir).name
        self.project_path = project_path
        self._validator = LAVSValidator()
        self._perm_checker = PermissionChecker()
        self._script_executor = ScriptExecutor()

    @classmethod
    def from_dir(cls, agent_dir: str | os.PathLike[str], **kwargs: Any) -> EndpointRunner:
        """Load ``<agent_dir>/lavs.json`` and return a runner for it."""
        manifest = ManifestLoader().load(str(Path(agent_dir) / "lavs.json"))
        return cls(manifest, agent_dir, **kwargs)

    def list_endpoints(self) -> list[dict[str, str]]:
        """Endpoint id/method/description triples declared by the manifest."""
        return [
            {"id": e.id, "method": e.method, "description": e.description or ""}
            for e in self.manifest.endpoints
        ]

    def _endpoint(self, endpoint_id: str) -> Endpoint:
        for e in self.manifest.endpoints:
            if e.id == endpoint_id:
                return e
        available = ", ".join(e.id for e in self.manifest.endpoints)
        raise LAVSError(
            LAVSErrorCode.MethodNotFound,
            f"Endpoint '{endpoint_id}' not found in bundle "
            f"'{self.manifest.name}' (available: {available})",
        )

    def call(self, endpoint_id: str, input: dict | None = None) -> Any:
        """
        Validate *input* and execute *endpoint_id*.

        Returns the handler result (or ``{"ok": True}`` for handler-less
        notify endpoints). Raises :class:`lavs_types.LAVSError` on unknown
        endpoints, schema violations, permission denials and handler failures.
        """
        return self.call_detail(endpoint_id, input).result

    def call_detail(self, endpoint_id: str, input: dict | None = None) -> EndpointResult:
        endpoint = self._endpoint(endpoint_id)
        params = input if input is not None else {}

        # 1. Input validation (same rules as the Node runtime)
        self._validator.assert_valid_input(endpoint, params, self.manifest.types)

        # 2. Handler-less notify: the broadcast is the whole effect
        handler = endpoint.handler
        if handler is None:
            if endpoint.method != "notify":
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"Endpoint '{endpoint_id}' ({endpoint.method}) is missing its handler",
                )
            return EndpointResult(endpoint_id, "notify", {"ok": True})

        # 3. Permissions for script handlers
        permissions = self._perm_checker.merge_permissions(
            self.manifest.permissions, endpoint.permissions
        )
        if getattr(handler, "type", None) == "script":
            self._perm_checker.assert_allowed(handler, permissions, self.agent_dir)  # type: ignore[arg-type]

        # 4. Execute (script handlers; other handler types are Node-side TODO)
        htype = getattr(handler, "type", None)
        if htype == "script":
            context = ExecutionContext(
                endpoint_id=endpoint.id,
                agent_id=self.agent_id,
                workdir=self.agent_dir,
                permissions=permissions,
                env={"LAVS_PROJECT_PATH": self.project_path} if self.project_path else None,
            )
            result = self._script_executor.execute(handler, params, context)  # type: ignore[arg-type]
        else:
            raise LAVSError(
                LAVSErrorCode.InvalidRequest,
                f"Handler type '{htype}' is not supported by the Python runtime "
                f"(endpoint '{endpoint_id}'); use the Node runtime for it",
            )

        return EndpointResult(endpoint_id, endpoint.method, result)  # type: ignore[arg-type]
