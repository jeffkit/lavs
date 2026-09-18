"""Tests for EndpointRunner, LavsHost and LavsClient (issue #16)."""

from __future__ import annotations

import json
import pathlib
import threading

import pytest

from lavs_client import LavsClient
from lavs_runtime import EndpointRunner, LavsHost
from lavs_types import LAVSError


def read_body(body):
    """Consume a handle() body (bytes or iterator) into bytes."""
    return body if isinstance(body, bytes) else b"".join(body)


def make_bundle(root: pathlib.Path, name: str = "demo") -> pathlib.Path:
    """A bundle at <root>/project/<name> with a staticRoot pointing at <root>/shared."""
    bundle = root / "project" / name
    (bundle / "view").mkdir(parents=True, exist_ok=True)
    (bundle / "scripts").mkdir(parents=True, exist_ok=True)
    (root / "shared").mkdir(parents=True, exist_ok=True)
    (root / "secret.txt").write_text("top-secret")
    (bundle / "lavs.json").write_text(json.dumps({
        "lavs": "1.0", "name": name, "contentType": f"local/{name}", "version": "0.0.1",
        "view": {
            "component": {"type": "local", "path": "./view/index.html"},
            "staticRoots": [{"mount": "shared", "path": str(root / "shared")}],
        },
        "endpoints": [
            {"id": "getItems", "method": "query", "description": "list",
             "handler": {"type": "script", "command": "node", "args": [
                 "-e", "console.log(JSON.stringify(['a','b']))"]}},
            {"id": "addItem", "method": "mutation", "description": "add",
             "handler": {"type": "script", "command": "node", "args": [
                 "-e", "let i='';process.stdin.on('data',c=>i+=c);process.stdin.on('end',()=>{"
                       "const t=JSON.parse(i||'{}').text||'';"
                       "console.log(JSON.stringify({ok:true,text:t}))})"],
                 "input": "stdin"},
             "schema": {"input": {"type": "object", "required": ["text"],
                                  "properties": {"text": {"type": "string"}}}}},
            {"id": "setTheme", "method": "notify", "description": "ui",
             "schema": {"input": {
                 "type": "object", "required": ["theme"],
                 "properties": {"theme": {"type": "string", "enum": ["dark", "light"]}}},
             }},
        ],
    }))
    (bundle / "view" / "index.html").write_text("<html>view</html>")
    (bundle / "view" / "clip.mp4").write_bytes(b"x" * 600)
    (root / "shared" / "note.txt").write_text("shared-note-16")
    return bundle


# ── EndpointRunner ──────────────────────────────────────────────────────────


class TestEndpointRunner:
    def test_query_mutation_notify(self, tmp_path: pathlib.Path):
        bundle = make_bundle(tmp_path)
        runner = EndpointRunner.from_dir(bundle)
        assert runner.call("getItems") == ["a", "b"]
        assert runner.call("addItem", {"text": "hi"}) == {"ok": True, "text": "hi"}
        # handler-less notify: broadcast is the whole effect
        assert runner.call("setTheme", {"theme": "light"}) == {"ok": True}

    def test_input_validation(self, tmp_path: pathlib.Path):
        runner = EndpointRunner.from_dir(make_bundle(tmp_path))
        with pytest.raises(LAVSError):  # missing required
            runner.call("addItem", {})
        with pytest.raises(LAVSError):  # enum violation on notify
            runner.call("setTheme", {"theme": "blue"})
        with pytest.raises(LAVSError):  # unknown endpoint
            runner.call("nope")

    def test_unknown_handler_type_rejected(self, tmp_path: pathlib.Path):
        bundle = make_bundle(tmp_path)
        manifest = json.loads((bundle / "lavs.json").read_text())
        manifest["endpoints"].append({
            "id": "proxy", "method": "query", "description": "http",
            "handler": {"type": "http", "url": "http://example.com", "method": "GET"},
        })
        (bundle / "lavs.json").write_text(json.dumps(manifest))
        runner = EndpointRunner.from_dir(bundle)
        with pytest.raises(LAVSError, match="not supported by the Python runtime"):
            runner.call("proxy")


# ── LavsHost.handle() ────────────────────────────────────────────────────────


class TestLavsHostHandle:
    def test_discover_and_call(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])

        status, _, body = host.handle("GET", "/api/discover")
        assert status == 200
        bundles = json.loads(body)
        assert bundles[0]["name"] == "demo"
        assert bundles[0]["hasView"] is True

        status, _, body = host.handle("POST", "/api/call/demo/getItems", body=b"")
        assert json.loads(body)["result"] == ["a", "b"]

        status, _, body = host.handle("POST", "/api/call/demo/addItem",
                                      body=json.dumps({"text": "hey"}).encode())
        assert json.loads(body)["result"] == {"ok": True, "text": "hey"}

    def test_mutation_broadcasts_sse_to_subscriber(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])
        sub = host.subscribe()
        try:
            host.handle("POST", "/api/call/demo/addItem", body=json.dumps({"text": "go"}).encode())
            payload = sub.q.get(timeout=2)
            assert "tool_executed" in payload
            assert '"contentType":"local/demo"' in payload.replace(" ", "")
        finally:
            host.unsubscribe(sub)

    def test_notify_ui_command_broadcast(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])
        sub = host.subscribe()
        try:
            host.handle("POST", "/api/notify/demo/setTheme",
                        body=json.dumps({"result": {"ok": True}, "kind": "ui_command",
                                         "input": {"theme": "dark"}}).encode())
            payload = sub.q.get(timeout=2)
            assert "ui_command" in payload and '"command":"setTheme"' in payload.replace(" ", "")
        finally:
            host.unsubscribe(sub)

    def test_view_range_and_mime(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])

        status, headers, body = host.handle("GET", "/view/demo/view/clip.mp4")
        assert status == 200
        assert headers["Accept-Ranges"] == "bytes"
        assert headers["Content-Type"] == "video/mp4"
        assert len(read_body(body)) == 600

        status, headers, body = host.handle("GET", "/view/demo/view/clip.mp4",
                                            headers={"Range": "bytes=0-9"})
        assert status == 206
        assert headers["Content-Range"] == "bytes 0-9/600"
        assert len(read_body(body)) == 10

        status, headers, body = host.handle("HEAD", "/view/demo/view/clip.mp4")
        assert status == 200 and body == b"" and headers["Content-Length"] == "600"

    def test_static_root_outside_bundle(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])

        status, _, body = host.handle("GET", "/view/demo/shared/note.txt")
        assert status == 200 and read_body(body) == b"shared-note-16"

        # `..` cannot escape the declared root
        status, _, body = host.handle("GET", "/view/demo/shared/../secret.txt")
        assert status in (403, 404)
        assert b"top-secret" not in read_body(body)

        # undeclared paths stay bounded by the bundle dir
        status, _, body = host.handle("GET", "/view/demo/../secret.txt")
        assert status in (403, 404)

    def test_registries_crud(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])
        extra = tmp_path / "extra"
        extra.mkdir()
        host.handle("POST", "/api/registries", body=json.dumps({"dir": str(extra)}).encode())
        assert str(extra.resolve()) in host.get_registry_dirs()
        host.handle("DELETE", "/api/registries", body=json.dumps({"dir": str(extra)}).encode())
        assert str(extra.resolve()) not in host.get_registry_dirs()

    def test_host_page_and_view_sdk(self, tmp_path: pathlib.Path):
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])
        status, headers, body = host.handle("GET", "/")
        assert status == 200 and b"lavs-view.iife.js" in read_body(body)
        status, headers, body = host.handle("GET", "/lavs-view.iife.js")
        assert status == 200 and b"LAVSView" in read_body(body)

    def test_asgi_app(self, tmp_path: pathlib.Path):
        """Drive the ASGI app manually (no server needed)."""
        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])
        app = host.asgi()
        sent: list[dict] = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(msg: dict) -> None:
            sent.append(msg)

        import asyncio

        asyncio.run(app({"type": "http", "method": "GET", "path": "/api/discover",
                         "headers": []}, receive, send))
        body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
        assert json.loads(body)[0]["name"] == "demo"


# ── LavsClient ───────────────────────────────────────────────────────────────


class TestLavsClient:
    def test_call_against_python_host(self, tmp_path: pathlib.Path):
        """End-to-end: LavsClient drives a LavsHost over a real socket."""
        import socketserver
        from wsgiref.simple_server import WSGIRequestHandler, make_server

        make_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path / "project")])
        app = host.wsgi()

        class QuietHandler(WSGIRequestHandler):
            def log_message(self, *args):  # noqa: ANN002
                pass

        with socketserver.TCPServer(("127.0.0.1", 0), None) as s:
            port = s.server_address[1]
        with make_server("127.0.0.1", port, app, handler_class=QuietHandler) as httpd:
            t = threading.Thread(target=httpd.serve_forever, daemon=True)
            t.start()
            try:
                client = LavsClient(f"http://127.0.0.1:{port}")
                bundles = client.discover()
                assert bundles[0]["name"] == "demo"
                assert client.call("demo", "getItems") == ["a", "b"]
                assert client.call("demo", "addItem", {"text": "n1"}) == {"ok": True, "text": "n1"}
            finally:
                httpd.shutdown()
