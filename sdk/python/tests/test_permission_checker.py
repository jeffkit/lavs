"""Tests for PermissionChecker."""

import tempfile
from pathlib import Path

import pytest

from lavs_runtime import PermissionChecker
from lavs_types import Permissions, ScriptHandler, LAVSError, LAVSErrorCode


def test_merge_permissions() -> None:
    """Test merging manifest and endpoint permissions."""
    checker = PermissionChecker()

    manifest_perms = Permissions(
        file_access=["./data/**"],
        max_execution_time=30000,
    )
    endpoint_perms = Permissions(max_execution_time=5000)

    merged = checker.merge_permissions(manifest_perms, endpoint_perms)
    assert merged.file_access == ["./data/**"]
    assert merged.max_execution_time == 5000  # Endpoint overrides


def test_check_path_traversal_allowed() -> None:
    """Test path within base is allowed."""
    with tempfile.TemporaryDirectory() as tmpdir:
        checker = PermissionChecker()
        checker.check_path_traversal("scripts/handler.py", tmpdir)
        checker.check_path_traversal("./data/foo.json", tmpdir)


def test_check_path_traversal_denied() -> None:
    """Test path outside base raises LAVSError."""
    with tempfile.TemporaryDirectory() as tmpdir:
        checker = PermissionChecker()
        with pytest.raises(LAVSError) as exc_info:
            checker.check_path_traversal("../../../etc/passwd", tmpdir)
        assert exc_info.value.code == LAVSErrorCode.PermissionDenied


def test_check_file_access_allowed() -> None:
    """Test file access pattern allows matching path."""
    checker = PermissionChecker()
    perms = Permissions(file_access=["./data/**/*.json"])
    assert checker.check_file_access("./data/foo/bar.json", perms) is True


def test_check_file_access_denied() -> None:
    """Test file access pattern denies non-matching path."""
    checker = PermissionChecker()
    perms = Permissions(file_access=["./data/**/*.json"])
    assert checker.check_file_access("./other/file.txt", perms) is False


def test_check_file_access_deny_pattern() -> None:
    """Test deny pattern (!) takes precedence."""
    checker = PermissionChecker()
    perms = Permissions(file_access=["./data/**/*.json", "!./data/secrets.json"])
    assert checker.check_file_access("./data/foo.json", perms) is True
    assert checker.check_file_access("./data/secrets.json", perms) is False


def test_get_effective_timeout() -> None:
    """Test effective timeout calculation."""
    checker = PermissionChecker()
    handler = ScriptHandler(command="echo", timeout=10000)
    perms = Permissions(max_execution_time=30000)

    timeout = checker.get_effective_timeout(handler, perms)
    assert timeout == 10000  # Handler takes precedence

    handler_no_timeout = ScriptHandler(command="echo")
    timeout = checker.get_effective_timeout(handler_no_timeout, perms)
    assert timeout == 30000  # Permissions used
