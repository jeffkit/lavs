"""Tests for ManifestLoader."""

import json
import tempfile
from pathlib import Path

import pytest

from lavs_runtime import ManifestLoader
from lavs_types import LAVSError, LAVSErrorCode


@pytest.fixture
def valid_manifest_content() -> str:
    """Valid lavs.json content."""
    return json.dumps({
        "lavs": "1.0",
        "name": "test-agent",
        "version": "1.0.0",
        "description": "Test agent",
        "endpoints": [
            {
                "id": "listItems",
                "method": "query",
                "handler": {
                    "type": "script",
                    "command": "python3",
                    "args": ["scripts/list.py"],
                    "input": "stdin",
                },
            },
        ],
        "permissions": {
            "fileAccess": ["./data/**/*.json"],
            "maxExecutionTime": 5000,
        },
    })


def test_load_valid_manifest(valid_manifest_content: str) -> None:
    """Test loading a valid manifest."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as f:
        f.write(valid_manifest_content)
        path = f.name

    try:
        loader = ManifestLoader()
        manifest = loader.load(path)

        assert manifest.lavs == "1.0"
        assert manifest.name == "test-agent"
        assert manifest.version == "1.0.0"
        assert len(manifest.endpoints) == 1
        assert manifest.endpoints[0].id == "listItems"
        assert manifest.endpoints[0].handler.type == "script"
        assert manifest.permissions is not None
        assert manifest.permissions.max_execution_time == 5000
    finally:
        Path(path).unlink(missing_ok=True)


def test_load_resolves_relative_paths(valid_manifest_content: str) -> None:
    """Test that relative paths are resolved to absolute."""
    with tempfile.TemporaryDirectory() as tmpdir:
        manifest_path = Path(tmpdir) / "lavs.json"
        manifest_path.write_text(valid_manifest_content)

        scripts_dir = Path(tmpdir) / "scripts"
        scripts_dir.mkdir()
        (scripts_dir / "list.py").write_text("print('[]')")

        loader = ManifestLoader()
        manifest = loader.load(str(manifest_path))

        handler = manifest.endpoints[0].handler
        assert handler.type == "script"
        assert str(handler.args[0]).endswith("list.py")
        assert Path(handler.args[0]).is_absolute()


def test_load_missing_file() -> None:
    """Test loading non-existent file raises LAVSError."""
    loader = ManifestLoader()
    with pytest.raises(LAVSError) as exc_info:
        loader.load("/nonexistent/path/lavs.json")
    assert exc_info.value.code == LAVSErrorCode.InvalidRequest
    assert "not found" in exc_info.value.message.lower()


def test_load_invalid_json() -> None:
    """Test loading invalid JSON raises LAVSError."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as f:
        f.write("{ invalid json }")
        path = f.name

    try:
        loader = ManifestLoader()
        with pytest.raises(LAVSError) as exc_info:
            loader.load(path)
        assert exc_info.value.code == LAVSErrorCode.ParseError
    finally:
        Path(path).unlink(missing_ok=True)


def test_load_missing_required_fields() -> None:
    """Test loading manifest with missing required fields."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as f:
        f.write('{"lavs": "1.0"}')  # Missing name, version, endpoints
        path = f.name

    try:
        loader = ManifestLoader()
        with pytest.raises(LAVSError) as exc_info:
            loader.load(path)
        assert exc_info.value.code == LAVSErrorCode.InvalidRequest
    finally:
        Path(path).unlink(missing_ok=True)


def test_load_duplicate_endpoint_ids() -> None:
    """Test loading manifest with duplicate endpoint IDs."""
    content = json.dumps({
        "lavs": "1.0",
        "name": "test",
        "version": "1.0.0",
        "endpoints": [
            {"id": "dup", "method": "query", "handler": {"type": "script", "command": "echo"}},
            {"id": "dup", "method": "mutation", "handler": {"type": "script", "command": "echo"}},
        ],
    })
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write(content)
        path = f.name

    try:
        loader = ManifestLoader()
        with pytest.raises(LAVSError) as exc_info:
            loader.load(path)
        assert exc_info.value.code == LAVSErrorCode.InvalidRequest
        assert "Duplicate" in exc_info.value.message
    finally:
        Path(path).unlink(missing_ok=True)
