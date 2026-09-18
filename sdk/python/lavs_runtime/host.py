"""
LAVS embeddable host (issue #16, layers 2+3).

A pure-Python HTTP host for LAVS bundles with routes aligned to the Node
host: ``/api/discover``, ``/api/manifest/:bundle``, ``/api/call/:bundle/:endpoint``,
``/api/notify/:bundle/:endpoint``, ``/api/events`` (SSE), ``/api/registries``
(GET/POST/DELETE) and ``/view/:bundle/*`` (static files incl.
``view.staticRoots`` with Range/MIME/HEAD semantics).

Framework-free: ``LavsHost.handle()`` is a minimal request interface;
``asgi()`` wraps it for uvicorn / FastAPI mounting, ``wsgi()`` for gunicorn.
"""

from __future__ import annotations

import json
import mimetypes
import os
import queue
import re
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from lavs_runtime.loader import ManifestLoader
from lavs_runtime.runner import EndpointRunner
from lavs_types import LAVSError, LAVSManifest

_EXTRA_MIME = {
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_SSE_HEARTBEAT = 15.0


class _Subscriber:
    def __init__(self, bundle: str | None) -> None:
        self.q: queue.Queue[str] = queue.Queue(maxsize=256)
        self.bundle = bundle
        self.closed = False


class LavsHost:
    """
    In-process LAVS bundle host.

    Usage::

        host = LavsHost(registry_dirs=["./bundles"])
        status, headers, body = host.handle("GET", "/api/discover")   # minimal interface
        app = host.asgi()                                             # uvicorn mount
    """

    def __init__(self, registry_dirs: list[str] | tuple[str, ...], runner_ttl: float = 2.0) -> None:
        self._registry_dirs = [str(Path(d).resolve()) for d in registry_dirs]
        self._subs: list[_Subscriber] = []
        self._lock = threading.Lock()
        self._runner_cache: dict[str, tuple[float, EndpointRunner]] = {}
        self._runner_ttl = runner_ttl

    # -- registry management ---------------------------------------------------

    def add_registry_dir(self, path: str) -> None:
        d = str(Path(path).resolve())
        with self._lock:
            if d not in self._registry_dirs:
                self._registry_dirs.append(d)

    def remove_registry_dir(self, path: str) -> None:
        d = str(Path(path).resolve())
        with self._lock:
            self._registry_dirs = [x for x in self._registry_dirs if x != d]

    def get_registry_dirs(self) -> list[str]:
        with self._lock:
            return list(self._registry_dirs)

    # -- discovery ---------------------------------------------------------------

    def _discover(self) -> list[dict[str, Any]]:
        seen: set[str] = set()
        bundles: list[dict[str, Any]] = []
        loader = ManifestLoader()
        for reg in self.get_registry_dirs():
            reg_path = Path(reg)
            if (reg_path / "lavs.json").is_file():
                candidates = [reg_path]
            else:
                candidates = (
                    [d for d in sorted(reg_path.iterdir()) if (d / "lavs.json").is_file()]
                    if reg_path.is_dir()
                    else []
                )
            for bundle_dir in candidates:
                try:
                    manifest = loader.load(str(bundle_dir / "lavs.json"))
                except LAVSError:
                    continue
                if manifest.name in seen:
                    continue
                seen.add(manifest.name)
                bundles.append(self._bundle_info(manifest, str(bundle_dir)))
        return bundles

    def _bundle_info(self, manifest: LAVSManifest, bundle_dir: str) -> dict[str, Any]:
        info: dict[str, Any] = {
            "name": manifest.name,
            "contentType": manifest.content_type or manifest.name,
            "version": manifest.version,
            "description": manifest.description or "",
            "dir": bundle_dir,
            "hasView": False,
            "viewEntry": None,
            "staticRoots": [],
            "endpoints": [
                {"id": e.id, "method": e.method, "description": e.description or ""}
                for e in manifest.endpoints
            ],
        }
        view = manifest.view
        comp = getattr(view, "component", None) if view else None
        comp_path = getattr(comp, "path", None) if comp else None
        if comp_path:
            p = Path(comp_path)
            if not p.is_absolute():
                p = Path(bundle_dir) / p
            if p.is_file():
                info["hasView"] = True
                info["viewEntry"] = Path(os.path.relpath(p, bundle_dir)).as_posix()
        for r in getattr(view, "static_roots", None) or []:
            base = Path(r.path)
            if not base.is_absolute():
                base = Path(bundle_dir) / base
            info["staticRoots"].append({"mount": r.mount, "base": str(base.resolve())})
        return info

    def _runner(self, bundle_dir: str) -> EndpointRunner:
        now = time.monotonic()
        cached = self._runner_cache.get(bundle_dir)
        if cached and now - cached[0] < self._runner_ttl:
            return cached[1]
        manifest = ManifestLoader().load(str(Path(bundle_dir) / "lavs.json"))
        runner = EndpointRunner(manifest, bundle_dir)
        self._runner_cache[bundle_dir] = (now, runner)
        return runner

    # -- SSE -----------------------------------------------------------------------

    def subscribe(self, bundle: str | None = None) -> _Subscriber:
        sub = _Subscriber(bundle)
        with self._lock:
            self._subs.append(sub)
        return sub

    def unsubscribe(self, sub: _Subscriber) -> None:
        sub.closed = True
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)

    def notify_agent_action(
        self,
        bundle: str,
        endpoint: str,
        result: Any = None,
        content_type: str | None = None,
        command: str | None = None,
        args: Any = None,
    ) -> None:
        """Broadcast an agent-action to connected /api/events clients."""
        action = {
            "type": "ui_command" if command else "tool_executed",
            "tool": f"lavs_{endpoint}",
            "command": command,
            "args": args,
            "contentType": content_type or bundle,
            "timestamp": int(time.time() * 1000),
            "result": result,
        }
        payload_data = json.dumps({"type": "lavs-agent-action", "action": action})
        payload = f"event: agent-action\ndata: {payload_data}\n\n"
        with self._lock:
            subs = list(self._subs)
        for sub in subs:
            if sub.closed or (sub.bundle and sub.bundle != bundle):
                continue
            try:
                sub.q.put_nowait(payload)
            except queue.Full:
                sub.closed = True

    # -- minimal request interface -----------------------------------------------

    def handle(
        self,
        method: str,
        path: str,
        headers: dict[str, str] | None = None,
        body: bytes = b"",
    ) -> tuple[int, dict[str, str], bytes | Iterator[bytes]]:
        """
        Minimal embedding interface: returns ``(status, headers, body)``.
        For ``/api/events`` and file bodies the result is a byte iterator —
        fully consume it (or close it) to release resources.
        """
        hdrs = {k.lower(): v for k, v in (headers or {}).items()}
        return self._route(method.upper(), path, hdrs, body)

    # -- routing -----------------------------------------------------------------

    def _route(self, method: str, path: str, headers: dict[str, str], body: bytes):
        if path == "/api/discover":
            return self._json(200, self._discover())

        if (m := re.fullmatch(r"/api/manifest/([^/]+)", path)):
            info = self._find_bundle(m.group(1))
            if not info:
                return self._json(404, {"error": "Bundle not found"})
            manifest = ManifestLoader().load(str(Path(info["dir"]) / "lavs.json"))
            return self._json(200, json.loads(manifest.model_dump_json(by_alias=True)))

        if (m := re.fullmatch(r"/api/call/([^/]+)/([^/]+)", path)) and method == "POST":
            return self._handle_call(m.group(1), m.group(2), body)

        if (m := re.fullmatch(r"/api/notify/([^/]+)/([^/]+)", path)) and method == "POST":
            bundle_name, endpoint_id = m.group(1), m.group(2)
            info = self._find_bundle(bundle_name)
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                payload = {}
            result = payload.get("result", payload.get("data"))
            is_cmd = payload.get("kind") == "ui_command"
            self.notify_agent_action(
                info["name"] if info else bundle_name,
                endpoint_id,
                result,
                info["contentType"] if info else None,
                command=endpoint_id if is_cmd else None,
                args=payload.get("input") if is_cmd else None,
            )
            return self._json(200, {"ok": True})

        if path == "/api/events":
            return self._sse_response()

        if path == "/api/registries" and method == "GET":
            return self._json(200, {"dirs": self.get_registry_dirs()})
        if path == "/api/registries" and method == "POST":
            data = self._parse_json(body)
            if not isinstance(data, dict):
                return self._json(400, {"error": "Invalid JSON"})
            if not data.get("dir"):
                return self._json(400, {"error": '"dir" is required'})
            self.add_registry_dir(data["dir"])
            return self._json(200, {"dirs": self.get_registry_dirs()})
        if path == "/api/registries" and method == "DELETE":
            data = self._parse_json(body)
            if isinstance(data, dict):
                self.remove_registry_dir(data.get("dir", ""))
            return self._json(200, {"dirs": self.get_registry_dirs()})

        if (m := re.fullmatch(r"/view/([^/]+)/(.*)", path)) and method in ("GET", "HEAD"):
            return self._serve_view(method, m.group(1), m.group(2) or "index.html", headers)

        if path == "/lavs-view.iife.js" and method == "GET":
            from lavs_runtime.host_page import view_sdk_js

            return 200, {"Content-Type": "application/javascript"}, view_sdk_js()
        if path == "/" and method == "GET":
            from lavs_runtime.host_page import render_host_page

            html = render_host_page()
            return 200, {"Content-Type": "text/html; charset=utf-8"}, html.encode()

        return self._json(404, {"error": "Not Found"})

    @staticmethod
    def _json(status: int, data: Any):
        body = json.dumps(data).encode()
        return status, {"Content-Type": "application/json", "Content-Length": str(len(body))}, body

    @staticmethod
    def _parse_json(body: bytes) -> Any:
        try:
            return json.loads(body or b"{}")
        except json.JSONDecodeError:
            return None

    def _find_bundle(self, name: str) -> dict[str, Any] | None:
        return next((b for b in self._discover() if b["name"] == name), None)

    def _handle_call(self, bundle_name: str, endpoint_id: str, body: bytes):
        info = self._find_bundle(bundle_name)
        if not info:
            return self._json(404, {"error": f"Bundle '{bundle_name}' not found"})
        input_data = self._parse_json(body)
        if not isinstance(input_data, dict):
            return self._json(400, {"error": "Invalid JSON"})
        try:
            detail = self._runner(info["dir"]).call_detail(endpoint_id, input_data)
        except LAVSError as exc:
            return self._json(500, {"error": str(exc)})
        if detail.method in ("mutation", "notify"):
            self.notify_agent_action(
                info["name"],
                endpoint_id,
                detail.result,
                info["contentType"],
                command=endpoint_id if detail.method == "notify" else None,
                args=input_data if detail.method == "notify" else None,
            )
        return self._json(200, {"result": detail.result})

    # -- static /view/* -------------------------------------------------------------

    def _serve_view(self, method: str, bundle_name: str, file_path: str, headers: dict):
        info = self._find_bundle(bundle_name)
        if not info:
            return self._json(404, {"error": "Bundle not found"})
        bundle_dir = Path(info["dir"])

        # Declared static roots take precedence over bundle-dir layout.
        first_seg = re.split(r"[/\\]", file_path, maxsplit=1)[0]
        root = next((r for r in info["staticRoots"] if r["mount"] == first_seg), None)
        if root:
            rel = re.sub(r"^[/\\]", "", file_path[len(first_seg):]) or "index.html"
            base = Path(root["base"]).resolve()
            target = (base / rel).resolve()
            if not (str(target).startswith(str(base) + os.sep) or target == base):
                return 403, {}, b"Forbidden"
        else:
            target = (bundle_dir / file_path).resolve()
            if not (str(target).startswith(str(bundle_dir) + os.sep) or target == bundle_dir):
                return 403, {}, b"Forbidden"

        if not target.is_file():
            return 404, {}, b"Not Found"

        size = target.stat().st_size
        ctype = _EXTRA_MIME.get(target.suffix.lower())
        if not ctype:
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        range_header = headers.get("range")
        m = _RANGE_RE.match(range_header.strip()) if range_header else None

        start, end, status, extra = 0, size - 1, 200, {}
        if m and (m.group(1) or m.group(2)):
            if m.group(1) == "":
                start = max(0, size - int(m.group(2)))
                end = size - 1
            else:
                start = int(m.group(1))
                end = size - 1 if m.group(2) == "" else min(int(m.group(2)), size - 1)
            if start > end or start >= size:
                return 416, {"Content-Range": f"bytes */{size}", "Content-Length": "0"}, b""
            status = 206
            extra = {
                "Content-Range": f"bytes {start}-{end}/{size}",
                "Content-Length": str(end - start + 1),
            }
        else:
            extra = {"Content-Length": str(size)}

        resp_headers = {"Content-Type": ctype, "Accept-Ranges": "bytes", **extra}
        if method == "HEAD":
            return status, resp_headers, b""

        fh = open(target, "rb")
        fh.seek(start)
        return status, resp_headers, _file_bytes(fh, end - start + 1)

    # -- SSE response -----------------------------------------------------------------

    def _sse_response(self):
        sub = self.subscribe()

        def stream() -> Iterator[bytes]:
            try:
                yield b"event: connected\ndata: {}\n\n"
                while not sub.closed:
                    try:
                        yield sub.q.get(timeout=_SSE_HEARTBEAT).encode()
                    except queue.Empty:
                        yield b": heartbeat\n\n"
            finally:
                self.unsubscribe(sub)

        return 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }, stream()

    # -- ASGI / WSGI --------------------------------------------------------------------

    def asgi(self):
        """Return an ASGI application (mountable in uvicorn / FastAPI)."""
        host = self

        async def app(scope: dict, receive: Any, send: Any) -> None:  # noqa: ANN001
            if scope["type"] != "http":
                return
            body = b""
            while True:
                msg = await receive()
                if msg["type"] == "http.request":
                    body += msg.get("body", b"")
                    if not msg.get("more_body"):
                        break
                elif msg["type"] == "http.disconnect":
                    return
            headers = {
                k.decode("latin-1").lower(): v.decode("latin-1")
                for k, v in scope.get("headers", [])
            }
            status, resp_headers, resp_body = host.handle(
                scope["method"].upper(), scope["path"], headers, body
            )
            header_list = [(k.encode(), v.encode()) for k, v in resp_headers.items()]
            await send({"type": "http.response.start", "status": status, "headers": header_list})

            if isinstance(resp_body, bytes):
                await send({"type": "http.response.body", "body": resp_body})
                return

            # streaming body: SSE or file bytes
            await send({"type": "http.response.body", "body": b"", "more_body": True})

            if scope["path"] == "/api/events":
                sub = host.subscribe()
                try:
                    await send({"type": "http.response.body",
                                "body": b"event: connected\ndata: {}\n\n", "more_body": True})
                    while not sub.closed:
                        item = await _drain(sub.q)
                        if sub.closed:
                            break
                        await send({"type": "http.response.body", "body": item, "more_body": True})
                finally:
                    host.unsubscribe(sub)
                await send({"type": "http.response.body", "body": b""})
            else:
                for chunk in resp_body:
                    await send({"type": "http.response.body", "body": chunk, "more_body": True})
                await send({"type": "http.response.body", "body": b""})

        return app

    def wsgi(self):
        """Return a WSGI application."""

        def app(environ: dict, start_response: Any) -> list[bytes]:  # noqa: ANN001
            length = int(environ.get("CONTENT_LENGTH") or 0)
            body = environ["wsgi.input"].read(length) if length else b""
            headers = {
                k[5:].replace("_", "-").lower(): v
                for k, v in environ.items()
                if k.startswith("HTTP_")
            }
            req_method = environ.get("REQUEST_METHOD", "GET").upper()
            status, resp_headers, resp_body = self.handle(
                req_method, environ.get("PATH_INFO", "/"), headers, body
            )
            start_response(f"{status} OK", list(resp_headers.items()))
            if isinstance(resp_body, bytes):
                return [resp_body]
            return list(resp_body)

        return app


async def _drain(q: queue.Queue[str]) -> bytes:
    """Next SSE payload from *q* without blocking the event loop."""
    import asyncio

    return await asyncio.get_running_loop().run_in_executor(None, lambda: _q_get(q))


def _q_get(q: queue.Queue[str]) -> bytes:
    try:
        return q.get(timeout=_SSE_HEARTBEAT).encode()
    except queue.Empty:
        return b": heartbeat\n\n"


def _file_bytes(fh: Any, count: int) -> Iterator[bytes]:
    """Stream exactly *count* bytes from an already-seeked file handle."""
    try:
        remaining = count
        while remaining > 0:
            chunk = fh.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        fh.close()
