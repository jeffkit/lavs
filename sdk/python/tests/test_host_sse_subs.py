"""SSE subscriber lifecycle in `LavsHost` (issue #21).

`_sse_response()` must not subscribe eagerly: the ASGI branch streams the event
feed itself and drops the iterator, so an eager subscription could never be
released. Every consumer (the ASGI app, the `handle()` iterator, the WSGI
wrapper) must therefore produce exactly one subscribe/unsubscribe pair and
leave `host._subs` empty once the client is gone.
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from collections.abc import Callable, Coroutine
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest

import lavs_runtime.host as host_module
from lavs_runtime import LavsHost


@pytest.fixture(autouse=True)
def fast_heartbeat(monkeypatch: pytest.MonkeyPatch):
    """Keep the SSE heartbeat short so cancelled streams do not block teardown."""
    monkeypatch.setattr(host_module, "_SSE_HEARTBEAT", 0.05)


def _instrument(host: LavsHost) -> dict[str, int]:
    counts = {"sub": 0, "unsub": 0}
    orig_sub, orig_unsub = host.subscribe, host.unsubscribe

    def subscribe(bundle=None):
        counts["sub"] += 1
        return orig_sub(bundle)

    def unsubscribe(sub):
        counts["unsub"] += 1
        return orig_unsub(sub)

    host.subscribe = subscribe
    host.unsubscribe = unsubscribe
    return counts


def _drive_events(
    host: LavsHost,
    on_connected: Callable[[list[bytes]], Coroutine] | None = None,
) -> list[bytes]:
    """GET /api/events through the ASGI app, then drop the connection.

    Returns the `http.response.body` payloads seen on the wire. The ASGI branch
    emits `event: connected` exactly once.
    """
    app = host.asgi()
    bodies: list[bytes] = []
    connected = asyncio.Event()

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(msg):
        if msg["type"] != "http.response.body":
            return
        body = msg.get("body", b"")
        if body:
            bodies.append(body)
        if b"event: connected" in body:
            connected.set()

    async def drive():
        scope = {"type": "http", "method": "GET", "path": "/api/events", "headers": []}
        task = asyncio.create_task(app(scope, receive, send))
        await asyncio.wait_for(connected.wait(), 5)
        if on_connected is not None:
            await on_connected(bodies)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    return bodies


def test_asgi_events_disconnect_leaves_no_subscriber():
    host = LavsHost(registry_dirs=[])
    bodies = _drive_events(host)
    assert sum(b"event: connected" in b for b in bodies) == 1
    assert len(host._subs) == 0, f"leaked subscribers: {host._subs}"


def test_asgi_events_n_connections_subscribe_unsubscribe_one_to_one():
    host = LavsHost(registry_dirs=[])
    counts = _instrument(host)
    for _ in range(5):
        _drive_events(host)
    assert counts == {"sub": 5, "unsub": 5}, f"dangling subscription: {counts}"
    assert len(host._subs) == 0


def test_asgi_events_still_receives_agent_action_and_cleans_up():
    host = LavsHost(registry_dirs=[])

    async def broadcast(bodies: list[bytes]):
        host.notify_agent_action("demo", "getItems", result=["a"])
        for _ in range(50):
            if any(b"event: agent-action" in b for b in bodies):
                return
            await asyncio.sleep(0.02)
        raise AssertionError(f"no agent-action frame received: {bodies}")

    bodies = _drive_events(host, on_connected=broadcast)
    assert any(b"event: agent-action" in b for b in bodies)
    assert len(host._subs) == 0


def test_handle_events_iterator_streams_and_unsubscribes_on_close():
    """Non-ASGI baseline (any consumer of `handle()`): one subscribe, one
    unsubscribe, connected + agent-action payloads on the wire."""
    host = LavsHost(registry_dirs=[])
    status, headers, body = host.handle("GET", "/api/events")
    assert status == 200 and headers["Content-Type"] == "text/event-stream"

    it = iter(body)
    assert next(it).startswith(b"event: connected")
    assert len(host._subs) == 1

    host.notify_agent_action("demo", "getItems", result=["a"])
    assert b"event: agent-action" in next(it)

    it.close()  # client disconnect
    assert len(host._subs) == 0


def test_wsgi_events_streams_heartbeat_and_broadcasts():
    """The WSGI wrapper streams /api/events instead of materialising it."""
    host = LavsHost(registry_dirs=[])

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, *args):  # noqa: ANN002
            pass

    with make_server("127.0.0.1", 0, host.wsgi(), handler_class=QuietHandler) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
                sock.sendall(
                    b"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\n"
                    b"Accept: text/event-stream\r\n\r\n"
                )
                deadline = time.time() + 5
                buf = b""
                while time.time() < deadline and b"event: connected" not in buf:
                    buf += sock.recv(4096)
                assert b" 200 OK" in buf and b"event: connected" in buf, buf

                deadline = time.time() + 2
                while time.time() < deadline and b": heartbeat" not in buf:
                    buf += sock.recv(4096)
                assert b": heartbeat" in buf, buf

                host.notify_agent_action("demo", "getItems", result=["a"])
                deadline = time.time() + 2
                while time.time() < deadline and b"event: agent-action" not in buf:
                    buf += sock.recv(4096)
                assert b"event: agent-action" in buf, buf
        finally:
            httpd.shutdown()

    deadline = time.time() + 2
    while time.time() < deadline and host._subs:
        time.sleep(0.02)
    assert len(host._subs) == 0, f"leaked subscribers: {host._subs}"
