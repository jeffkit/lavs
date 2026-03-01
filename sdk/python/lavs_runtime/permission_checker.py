"""
LAVS Permission Checker.

Enforces permission constraints declared in LAVS manifests.

Enforcement Model:
- Path traversal: ENFORCED - handler cwd and command paths validated
- fileAccess: ADVISORY - glob pattern matching at dispatch time
- networkAccess: ADVISORY - declared for auditing
- maxExecutionTime: ENFORCED - handler killed on timeout
- maxMemory: ADVISORY - not enforced in current runtime
"""

from __future__ import annotations

from pathlib import Path

from pathspec import PathSpec

from lavs_types import LAVSError, LAVSErrorCode, Permissions, ScriptHandler


class PermissionChecker:
    """
    LAVS Permission Checker - enforces manifest-declared security constraints.
    """

    def merge_permissions(
        self,
        manifest_permissions: Permissions | None,
        endpoint_permissions: Permissions | None,
    ) -> Permissions:
        """
        Merge manifest-level and endpoint-level permissions.

        Endpoint-level permissions take precedence over manifest-level.

        Args:
            manifest_permissions: Manifest-level permissions (defaults).
            endpoint_permissions: Endpoint-level permissions (overrides).

        Returns:
            Merged permissions object.
        """
        if not manifest_permissions and not endpoint_permissions:
            return Permissions()

        mp = manifest_permissions or Permissions()
        ep = endpoint_permissions or Permissions()

        return Permissions(
            file_access=ep.file_access if ep.file_access is not None else mp.file_access,
            network_access=(
                ep.network_access if ep.network_access is not None else mp.network_access
            ),
            max_execution_time=(
                ep.max_execution_time
                if ep.max_execution_time is not None
                else mp.max_execution_time
            ),
            max_memory=(
                ep.max_memory if ep.max_memory is not None else mp.max_memory
            ),
        )

    def check_path_traversal(self, target_path: str, allowed_base: str) -> None:
        """
        Check if target path is within allowed base directory.

        Prevents path traversal attacks (e.g., ../../etc/passwd).

        Args:
            target_path: The path to check (absolute or relative).
            allowed_base: The allowed base directory (absolute).

        Raises:
            LAVSError: With code PermissionDenied if path is outside allowed base.
        """
        resolved_target = (Path(allowed_base).resolve() / target_path).resolve()
        normalized_base = Path(allowed_base).resolve()

        try:
            resolved_target.relative_to(normalized_base)
        except ValueError:
            raise LAVSError(
                LAVSErrorCode.PermissionDenied,
                f"Path traversal detected: '{target_path}' resolves outside allowed directory '{allowed_base}'",
                {"resolved_path": str(resolved_target), "allowed_base": str(normalized_base)},
            )

    def check_handler_cwd(self, handler: ScriptHandler, agent_dir: str) -> None:
        """
        Check if handler's working directory is within allowed base.

        Args:
            handler: Script handler with optional cwd.
            agent_dir: Agent directory (the allowed base).

        Raises:
            LAVSError: If cwd is outside agent directory.
        """
        if not handler.cwd:
            return

        self.check_path_traversal(handler.cwd, agent_dir)

    def check_file_access(self, file_path: str, permissions: Permissions) -> bool:
        """
        Check if file access patterns allow a given path.

        Uses glob matching against permissions.file_access patterns.

        Args:
            file_path: The file path to check (relative to agent dir).
            permissions: Permission constraints including file_access patterns.

        Returns:
            True if access is allowed, False otherwise.
        """
        if not permissions.file_access or len(permissions.file_access) == 0:
            return True

        # PathSpec gitignore expects paths without leading ./
        match_path = file_path.lstrip("./") if file_path.startswith("./") else file_path

        # Check deny patterns first (negative patterns take precedence)
        for pattern in permissions.file_access:
            if pattern.startswith("!"):
                pat = pattern[1:].lstrip("./")
                spec = PathSpec.from_lines("gitignore", [pat])
                if spec.match_file(match_path):
                    return False

        # Check allow patterns
        for pattern in permissions.file_access:
            if not pattern.startswith("!"):
                pat = pattern.lstrip("./")
                spec = PathSpec.from_lines("gitignore", [pat])
                if spec.match_file(match_path):
                    return True

        return False

    def get_effective_timeout(
        self,
        handler: ScriptHandler,
        permissions: Permissions,
        default_timeout: int = 30000,
    ) -> int:
        """
        Get effective execution timeout for a handler.

        Priority: handler.timeout > permissions.max_execution_time > default.

        Args:
            handler: Script handler with optional timeout.
            permissions: Permission constraints.
            default_timeout: Default timeout in milliseconds.

        Returns:
            Effective timeout in milliseconds.
        """
        if handler.timeout is not None and handler.timeout > 0:
            if (
                permissions.max_execution_time is not None
                and permissions.max_execution_time > 0
            ):
                return min(handler.timeout, permissions.max_execution_time)
            return handler.timeout

        if (
            permissions.max_execution_time is not None
            and permissions.max_execution_time > 0
        ):
            return permissions.max_execution_time

        return default_timeout

    def assert_allowed(
        self,
        handler: ScriptHandler,
        permissions: Permissions,
        agent_dir: str,
    ) -> None:
        """
        Run all permission checks for script handler execution.

        Args:
            handler: Script handler configuration.
            permissions: Merged permissions.
            agent_dir: Agent base directory.

        Raises:
            LAVSError: If any permission check fails.
        """
        self.check_handler_cwd(handler, agent_dir)

        if handler.command and ("/" in handler.command or "\\" in handler.command):
            if not Path(handler.command).is_absolute():
                self.check_path_traversal(handler.command, agent_dir)
