"""
LAVS Manifest Loader.

Loads and validates lavs.json configuration files.
"""

from __future__ import annotations

import json
from pathlib import Path

from lavs_types import LAVSManifest, LAVSError, LAVSErrorCode


class ManifestLoader:
    """
    Load LAVS manifests from lavs.json files.

    Validates structure, resolves relative paths, and returns typed LAVSManifest.
    """

    # Script file extensions for relative path detection
    _SCRIPT_EXTENSIONS = (".js", ".ts", ".py", ".sh", ".rb", ".php")

    def load(self, manifest_path: str) -> LAVSManifest:
        """
        Load LAVS manifest from file.

        Args:
            manifest_path: Path to lavs.json file.

        Returns:
            Parsed and validated manifest with resolved paths.

        Raises:
            LAVSError: If file not found, invalid JSON, or validation fails.
        """
        try:
            path = Path(manifest_path)

            if not path.exists():
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"Manifest file not found: {manifest_path}",
                )

            content = path.read_text(encoding="utf-8")

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as e:
                raise LAVSError(
                    LAVSErrorCode.ParseError,
                    f"Invalid JSON in manifest: {e}",
                    {"cause": str(e)},
                ) from e

            self._validate_manifest(parsed)
            resolved = self._resolve_paths(parsed, str(path.parent))

            return LAVSManifest.model_validate(resolved)

        except LAVSError:
            raise
        except Exception as e:
            raise LAVSError(
                LAVSErrorCode.InternalError,
                f"Failed to load manifest: {e}",
                {"cause": str(e)},
            ) from e

    def _validate_manifest(self, manifest: dict) -> None:
        """Validate manifest structure and required fields."""
        if not manifest.get("lavs"):
            raise LAVSError(LAVSErrorCode.InvalidRequest, "Missing required field: lavs")

        if not manifest.get("name"):
            raise LAVSError(LAVSErrorCode.InvalidRequest, "Missing required field: name")

        if not manifest.get("version"):
            raise LAVSError(
                LAVSErrorCode.InvalidRequest, "Missing required field: version"
            )

        endpoints = manifest.get("endpoints")
        if not isinstance(endpoints, list):
            raise LAVSError(
                LAVSErrorCode.InvalidRequest,
                "Missing or invalid field: endpoints (must be array)",
            )

        seen_ids: set[str] = set()
        for endpoint in endpoints:
            self._validate_endpoint(endpoint)
            eid = endpoint.get("id")
            if eid in seen_ids:
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"Duplicate endpoint ID: '{eid}'. Endpoint IDs must be unique.",
                )
            seen_ids.add(eid)

    def _validate_endpoint(self, endpoint: dict) -> None:
        """Validate individual endpoint definition."""
        if not endpoint.get("id"):
            raise LAVSError(
                LAVSErrorCode.InvalidRequest, "Endpoint missing required field: id"
            )

        method = endpoint.get("method")
        if method not in ("query", "mutation", "subscription"):
            raise LAVSError(
                LAVSErrorCode.InvalidRequest,
                f"Invalid endpoint method: {method} (must be query, mutation, or subscription)",
            )

        if not endpoint.get("handler"):
            raise LAVSError(
                LAVSErrorCode.InvalidRequest,
                f"Endpoint {endpoint['id']} missing required field: handler",
            )

        self._validate_handler(endpoint["handler"], endpoint["id"])

    def _validate_handler(self, handler: dict, endpoint_id: str) -> None:
        """Validate handler configuration."""
        if not handler.get("type"):
            raise LAVSError(
                LAVSErrorCode.InvalidRequest,
                f"Handler for {endpoint_id} missing required field: type",
            )

        valid_types = ("script", "function", "http", "mcp")
        if handler["type"] not in valid_types:
            raise LAVSError(
                LAVSErrorCode.InvalidRequest,
                f"Invalid handler type: {handler['type']} (must be one of: {', '.join(valid_types)})",
            )

        if handler["type"] == "script":
            if not handler.get("command"):
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"Script handler for {endpoint_id} missing required field: command",
                )
            if handler.get("input") and handler["input"] not in ("args", "stdin", "env"):
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"Invalid script input mode: {handler['input']} (must be args, stdin, or env)",
                )

        if handler["type"] == "function":
            if not handler.get("module") or not handler.get("function"):
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"Function handler for {endpoint_id} missing required fields: module, function",
                )

        if handler["type"] == "http":
            if not handler.get("url") or not handler.get("method"):
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"HTTP handler for {endpoint_id} missing required fields: url, method",
                )

        if handler["type"] == "mcp":
            if not handler.get("server") or not handler.get("tool"):
                raise LAVSError(
                    LAVSErrorCode.InvalidRequest,
                    f"MCP handler for {endpoint_id} missing required fields: server, tool",
                )

    def _resolve_paths(self, manifest: dict, basedir: str) -> dict:
        """Resolve relative paths in manifest to absolute paths."""
        import copy

        resolved = copy.deepcopy(manifest)
        base = Path(basedir)

        for endpoint in resolved.get("endpoints", []):
            handler = endpoint.get("handler", {})

            if handler.get("type") == "script":
                cmd = handler.get("command", "")
                if self._is_relative_script_path(cmd):
                    handler["command"] = str((base / cmd).resolve())

                # Resolve relative script paths in args
                for i, arg in enumerate(handler.get("args", [])):
                    if isinstance(arg, str) and self._is_relative_script_path(arg):
                        handler["args"][i] = str((base / arg).resolve())

                cwd = handler.get("cwd")
                if cwd and not Path(cwd).is_absolute():
                    handler["cwd"] = str((base / cwd).resolve())

            if handler.get("type") == "function":
                module = handler.get("module")
                if module and not Path(module).is_absolute():
                    handler["module"] = str((base / module).resolve())

        view = resolved.get("view", {})
        component = view.get("component", {})
        if component.get("type") == "local":
            path = component.get("path")
            if path and not Path(path).is_absolute():
                component["path"] = str((base / path).resolve())

        return resolved

    def _is_relative_script_path(self, cmd: str) -> bool:
        """Check if command looks like a relative script path."""
        if cmd.startswith("./") or cmd.startswith("../"):
            return True
        has_extension = any(cmd.endswith(ext) for ext in self._SCRIPT_EXTENSIONS)
        has_path_sep = "/" in cmd or "\\" in cmd
        return bool(has_extension and has_path_sep)
