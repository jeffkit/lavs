"""
LAVS Script Executor.

Executes script handlers with proper input/output handling and security.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from lavs_types import ExecutionContext, LAVSError, LAVSErrorCode, ScriptHandler


class ScriptExecutor:
    """
    LAVS Script Executor - executes script handlers via subprocess.
    """

    # Sensitive environment variable patterns (case-insensitive)
    _SENSITIVE_PATTERNS = (
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PASSWD",
        "CREDENTIAL",
        "PRIVATE_KEY",
        "API_KEY",
        "APIKEY",
        "ACCESS_KEY",
        "AUTH",
    )

    _SAFE_OVERRIDES = frozenset(
        {"LAVS_AGENT_ID", "LAVS_ENDPOINT_ID", "LAVS_PROJECT_PATH", "NODE_ENV"}
    )

    _SAFE_ENV_VARS = (
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "TZ",
        "NODE_ENV",
        "SHELL",
        "TMPDIR",
        "TERM",
    )

    def execute(
        self,
        handler: ScriptHandler,
        input_data: Any,
        context: ExecutionContext,
    ) -> Any:
        """
        Execute a script handler.

        Args:
            handler: Script handler configuration.
            input_data: Input data to pass to script.
            context: Execution context with permissions.

        Returns:
            Script output (parsed as JSON).

        Raises:
            LAVSError: On execution failure, timeout, or invalid output.
        """
        args = handler.args or []
        resolved_args = self._resolve_args(args, input_data)
        env = self._build_environment(handler, input_data, context)
        cwd = handler.cwd or context.workdir
        timeout_ms = (
            handler.timeout
            or context.timeout
            or (context.permissions.max_execution_time or 30000)
        )
        timeout_sec = timeout_ms / 1000.0

        try:
            proc = subprocess.run(
                [handler.command] + resolved_args,
                input=json.dumps(input_data) if handler.input == "stdin" and input_data else None,
                capture_output=True,
                text=True,
                cwd=cwd,
                env=env,
                timeout=timeout_sec,
            )

            if proc.returncode != 0:
                raise LAVSError(
                    LAVSErrorCode.HandlerError,
                    f"Script exited with code {proc.returncode}",
                    {
                        "exit_code": proc.returncode,
                        "stderr": proc.stderr,
                        "stdout": proc.stdout,
                    },
                )

            return self._parse_output(proc.stdout, proc.stderr)

        except subprocess.TimeoutExpired as e:
            raise LAVSError(
                LAVSErrorCode.Timeout,
                f"Script execution timeout after {timeout_ms}ms",
                {"timeout_ms": timeout_ms},
            ) from e
        except FileNotFoundError as e:
            raise LAVSError(
                LAVSErrorCode.HandlerError,
                f"Script execution failed: {e}",
                {"cause": str(e)},
            ) from e
        except LAVSError:
            raise
        except Exception as e:
            raise LAVSError(
                LAVSErrorCode.HandlerError,
                f"Script execution failed: {e}",
                {"cause": str(e)},
            ) from e

    def _resolve_args(self, args: list[str], input_data: Any) -> list[str]:
        """Resolve argument templates with input values. Replaces {{path.to.value}}."""
        import re

        if not input_data:
            return args

        result = []
        for arg in args:
            def repl(match: re.Match) -> str:
                path = match.group(1).strip()
                value = self._get_value_by_path(input_data, path)
                return str(value) if value is not None else ""

            new_arg = re.sub(r"\{\{([^}]+)\}\}", repl, arg)
            result.append(new_arg)
        return result

    def _get_value_by_path(self, obj: Any, path: str) -> Any:
        """Get value from nested object by dot path."""
        blocked = {"__proto__", "constructor", "prototype"}
        keys = path.split(".")
        current = obj
        for key in keys:
            if current is None:
                return None
            if key in blocked:
                return None
            if not isinstance(current, dict):
                return None
            current = current.get(key)
        return current

    def _build_environment(
        self,
        handler: ScriptHandler,
        input_data: Any,
        context: ExecutionContext,
    ) -> dict[str, str]:
        """Build environment variables for script execution."""
        env: dict[str, str] = {}

        for key in self._SAFE_ENV_VARS:
            if key in os.environ:
                env[key] = os.environ[key]

        env["LAVS_AGENT_ID"] = context.agent_id
        env["LAVS_ENDPOINT_ID"] = context.endpoint_id

        if handler.env:
            env.update(handler.env)

        if context.env:
            env.update(context.env)

        if handler.input == "env" and input_data and isinstance(input_data, dict):
            env.update(self._input_to_env(input_data))

        return self._filter_sensitive_vars(env)

    def _input_to_env(self, input_data: dict, prefix: str = "") -> dict[str, str]:
        """Convert input object to environment variables."""
        result: dict[str, str] = {}
        for key, value in input_data.items():
            env_key = f"{prefix}_{key}".upper() if prefix else key.upper()
            if value is None:
                continue
            if isinstance(value, dict) and not isinstance(value, (list, str)):
                result.update(self._input_to_env(value, env_key))
            else:
                result[env_key] = str(value)
        return result

    def _filter_sensitive_vars(self, env: dict[str, str]) -> dict[str, str]:
        """Filter out sensitive environment variables."""
        filtered: dict[str, str] = {}
        for key, value in env.items():
            if key in self._SAFE_OVERRIDES:
                filtered[key] = value
                continue
            upper_key = key.upper()
            if any(pattern in upper_key for pattern in self._SENSITIVE_PATTERNS):
                continue
            filtered[key] = value
        return filtered

    def _parse_output(self, stdout: str, stderr: str) -> Any:
        """Parse script output as JSON."""
        trimmed = (stdout or "").strip()

        if not trimmed:
            return None

        try:
            return json.loads(trimmed)
        except json.JSONDecodeError as e:
            import re
            match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", trimmed)
            if match:
                try:
                    return json.loads(match.group(1))
                except json.JSONDecodeError:
                    pass

            raise LAVSError(
                LAVSErrorCode.HandlerError,
                "Script output is not valid JSON",
                {"stdout": trimmed, "stderr": stderr, "parse_error": str(e)},
            ) from e
