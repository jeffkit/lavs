"""Tests for LAVSToolGenerator."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

from lavs_runtime import LAVSToolGenerator, GeneratedTool
from lavs_types import LAVSError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

LIST_SCRIPT = """\
import json, sys
items = [{"id": 1, "text": "Hello"}]
print(json.dumps(items))
"""

ADD_SCRIPT = """\
import json, sys
data = json.loads(sys.stdin.read())
item = {"id": 2, "text": data.get("text", "")}
print(json.dumps(item))
"""

MANIFEST_TEMPLATE = {
    "lavs": "1.0",
    "name": "test-bundle",
    "contentType": "test/bundle",
    "version": "1.0.0",
    "description": "Test bundle",
    "endpoints": [
        {
            "id": "list",
            "method": "query",
            "description": "List items",
            "handler": {
                "type": "script",
                "command": "python3",
                "args": ["scripts/list.py"],
            },
            "schema": {
                "output": {"type": "array", "items": {"type": "object"}},
            },
        },
        {
            "id": "add",
            "method": "mutation",
            "description": "Add an item",
            "handler": {
                "type": "script",
                "command": "python3",
                "args": ["scripts/add.py"],
                "input": "stdin",
            },
            "schema": {
                "input": {
                    "type": "object",
                    "required": ["text"],
                    "properties": {"text": {"type": "string"}},
                },
                "output": {"type": "object"},
            },
        },
        {
            "id": "updates",
            "method": "subscription",
            "description": "Subscribe to updates",
            "handler": {
                "type": "script",
                "command": "python3",
                "args": ["scripts/list.py"],
            },
        },
    ],
    "permissions": {
        "maxExecutionTime": 10000,
    },
}


@pytest.fixture
def bundle_dir():
    """Create a temporary bundle directory with scripts and lavs.json."""
    with tempfile.TemporaryDirectory() as tmpdir:
        manifest_path = Path(tmpdir) / "lavs.json"
        manifest_path.write_text(json.dumps(MANIFEST_TEMPLATE))

        scripts_dir = Path(tmpdir) / "scripts"
        scripts_dir.mkdir()
        (scripts_dir / "list.py").write_text(LIST_SCRIPT)
        (scripts_dir / "add.py").write_text(ADD_SCRIPT)

        yield tmpdir


# ---------------------------------------------------------------------------
# generate_tools
# ---------------------------------------------------------------------------

def test_generate_tools_returns_non_subscription_endpoints(bundle_dir):
    """Subscription endpoints are excluded; query + mutation are included."""
    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)

    assert len(tools) == 2
    names = {t.tool.name for t in tools}
    assert "lavs_list" in names
    assert "lavs_add" in names
    assert "lavs_updates" not in names


def test_generated_tool_has_correct_method(bundle_dir):
    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)
    by_name = {t.tool.name: t for t in tools}

    assert by_name["lavs_list"].method == "query"
    assert by_name["lavs_add"].method == "mutation"


def test_generated_tool_schema(bundle_dir):
    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)
    add_tool = next(t for t in tools if t.tool.name == "lavs_add")

    schema = add_tool.tool.input_schema
    assert schema["type"] == "object"
    assert "text" in schema["properties"]
    assert "text" in schema.get("required", [])


def test_generate_tools_returns_empty_if_no_lavs_json(tmp_path):
    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", str(tmp_path))
    assert tools == []


def test_has_lavs_true(bundle_dir):
    gen = LAVSToolGenerator()
    assert gen.has_lavs(bundle_dir) is True


def test_has_lavs_false(tmp_path):
    gen = LAVSToolGenerator()
    assert gen.has_lavs(str(tmp_path)) is False


# ---------------------------------------------------------------------------
# execute — query
# ---------------------------------------------------------------------------

def test_execute_query_endpoint(bundle_dir):
    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)
    list_tool = next(t for t in tools if t.tool.name == "lavs_list")

    result = list_tool.execute({})
    assert isinstance(result, list)
    assert result[0]["text"] == "Hello"


# ---------------------------------------------------------------------------
# execute — mutation
# ---------------------------------------------------------------------------

def test_execute_mutation_endpoint(bundle_dir, monkeypatch):
    """Mutation calls the script and fires host notification (mocked)."""
    notified = []

    monkeypatch.delenv("LAVS_HOST_CALLER", raising=False)

    import lavs_runtime.tool_generator as tg_mod
    original_notify = tg_mod._notify_host

    def fake_notify(bundle_name, endpoint_id, data):
        notified.append((bundle_name, endpoint_id, data))

    monkeypatch.setattr(tg_mod, "_notify_host", fake_notify)

    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)
    add_tool = next(t for t in tools if t.tool.name == "lavs_add")

    result = add_tool.execute({"text": "World"})
    assert result["text"] == "World"
    assert len(notified) == 1
    assert notified[0][0] == "test-bundle"
    assert notified[0][1] == "add"


def test_execute_mutation_skips_notify_when_host_caller(bundle_dir, monkeypatch):
    """When LAVS_HOST_CALLER is set, host notification is suppressed."""
    monkeypatch.setenv("LAVS_HOST_CALLER", "1")
    notified = []

    import lavs_runtime.tool_generator as tg_mod

    monkeypatch.setattr(tg_mod, "_notify_host", lambda *a: notified.append(a))

    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)
    add_tool = next(t for t in tools if t.tool.name == "lavs_add")

    add_tool.execute({"text": "suppressed"})
    assert len(notified) == 0


# ---------------------------------------------------------------------------
# execute — validation
# ---------------------------------------------------------------------------

def test_execute_raises_on_invalid_input(bundle_dir):
    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", bundle_dir)
    add_tool = next(t for t in tools if t.tool.name == "lavs_add")

    with pytest.raises(LAVSError):
        add_tool.execute({"wrong_key": 123})


# ---------------------------------------------------------------------------
# Unsupported handler types
# ---------------------------------------------------------------------------

def test_execute_raises_not_implemented_for_http_handler(tmp_path, monkeypatch):
    """http handler type raises NotImplementedError in Python runtime."""
    manifest = {
        "lavs": "1.0",
        "name": "http-bundle",
        "version": "1.0.0",
        "endpoints": [
            {
                "id": "fetch",
                "method": "query",
                "handler": {
                    "type": "http",
                    "url": "http://example.com/api",
                    "method": "GET",
                },
            }
        ],
    }
    (tmp_path / "lavs.json").write_text(json.dumps(manifest))

    gen = LAVSToolGenerator()
    tools = gen.generate_tools("agent1", str(tmp_path))
    assert len(tools) == 1

    with pytest.raises(NotImplementedError, match="http"):
        tools[0].execute({})
