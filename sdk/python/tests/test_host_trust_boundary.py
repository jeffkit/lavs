"""Issue #28 regression: Python host trust boundary aligned with the TS #17 fix.

Same shapes as ``sdk/typescript/runtime/src/host-server.test.ts``
(``describe('LAVS Host Server — host trust boundary (issue #17)')``).
"""

from __future__ import annotations

import json
import logging
import pathlib
import re

from lavs_runtime import LavsHost

EVIL_ORIGIN = "http://evil.example"
SELF_HOST = "127.0.0.1:7842"
SELF_ORIGIN = f"http://{SELF_HOST}"


def make_sec_bundle(root: pathlib.Path) -> pathlib.Path:
    """bundle at <root>/sec with an absolute staticRoot ('abs') and a relative one ('rel')."""
    bundle = root / "sec"
    (bundle / "view").mkdir(parents=True)
    (bundle / "scripts").mkdir()
    (bundle / "data").mkdir()
    (root / "absroot").mkdir()
    (root / "absroot" / "secret.txt").write_text("abs-root-secret")
    (root / "ok.txt").write_text("relative-root-ok")
    (bundle / "view" / "index.html").write_text("<html>sec</html>")
    (bundle / "scripts" / "touch.js").write_text(
        "const fs=require('fs');"
        "fs.writeFileSync(require('path').join(__dirname,'..','data','hit.txt'),'written');"
        "console.log(JSON.stringify({ok:true}));"
    )
    (bundle / "lavs.json").write_text(json.dumps({
        "lavs": "1.0", "name": "sec", "contentType": "local/sec", "version": "1.0.0",
        "view": {
            "component": {"type": "local", "path": "./view/index.html"},
            "staticRoots": [
                {"mount": "abs", "path": str(root / "absroot")},
                {"mount": "rel", "path": ".."},
            ],
        },
        "endpoints": [
            {"id": "touch", "method": "mutation", "description": "writes a file",
             "handler": {"type": "script", "command": "node",
                         "args": ["scripts/touch.js"], "input": "stdin"}},
            {"id": "setTheme", "method": "notify", "description": "ui",
             "schema": {"input": {"type": "object", "required": ["theme"],
                                  "properties": {"theme": {"type": "string"}}}}},
        ],
    }))
    return bundle


def read_body(body) -> bytes:
    return body if isinstance(body, bytes) else b"".join(body)


def lower(headers: dict[str, str]) -> dict[str, str]:
    return {k.lower(): v for k, v in headers.items()}


def touched(root: pathlib.Path) -> bool:
    return (root / "sec" / "data" / "hit.txt").exists()


# ── 1. CORS 默认关闭：跨源访问 /api/* 与 /view/* ────────────────────────────


class TestCrossOriginRejected:
    def test_discover_with_foreign_origin_is_403_without_acao(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, headers, _ = host.handle("GET", "/api/discover",
                                         headers={"Origin": EVIL_ORIGIN})
        assert status == 403
        assert "access-control-allow-origin" not in lower(headers)

    def test_call_with_foreign_origin_is_403_and_handler_never_runs(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        sub = host.subscribe()
        try:
            status, headers, _ = host.handle(
                "POST", "/api/call/sec/touch",
                # simple request: text/plain → no preflight
                headers={"Origin": EVIL_ORIGIN, "Content-Type": "text/plain"},
                body=b"{}",
            )
            assert status == 403
            assert "access-control-allow-origin" not in lower(headers)
            assert not touched(tmp_path), "handler ran for a blocked cross-origin call"
            assert sub.q.empty(), "notify_agent_action fired for a blocked call"
        finally:
            host.unsubscribe(sub)

    def test_view_with_foreign_origin_is_403(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, body = host.handle("GET", "/view/sec/view/index.html",
                                      headers={"Origin": EVIL_ORIGIN})
        assert status == 403
        assert b"sec" not in read_body(body)

    def test_options_preflight_from_foreign_origin_is_not_answered(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, headers, _ = host.handle(
            "OPTIONS", "/api/call/sec/touch",
            headers={"Origin": EVIL_ORIGIN, "Access-Control-Request-Method": "POST"},
        )
        assert status == 403
        assert "access-control-allow-origin" not in lower(headers)

    def test_empty_origin_still_works(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, _ = host.handle("GET", "/api/discover")
        assert status == 200

    def test_same_origin_still_works(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, _ = host.handle("GET", "/api/discover",
                                  headers={"Origin": SELF_ORIGIN, "Host": SELF_HOST})
        assert status == 200

    def test_forged_host_and_origin_pair_is_not_same_origin(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, _ = host.handle("GET", "/api/discover",
                                  headers={"Host": "evil.example",
                                           "Origin": EVIL_ORIGIN})
        assert status == 403

    def test_asgi_cross_origin_request_is_403(self, tmp_path: pathlib.Path):
        """Embedders (uvicorn/FastAPI) reach the same guard through ASGI headers."""
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        app = host.asgi()
        sent: list[dict] = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(msg: dict) -> None:
            sent.append(msg)

        import asyncio

        asyncio.run(app({"type": "http", "method": "GET", "path": "/api/discover",
                         "headers": [(b"origin", EVIL_ORIGIN.encode()),
                                     (b"host", b"127.0.0.1:7842")]}, receive, send))
        assert sent[0]["status"] == 403


# ── 2. 绝对路径 staticRoots 默认不挂载 ──────────────────────────────────────


class TestAbsoluteStaticRootsRequireOptIn:
    def test_absolute_root_is_not_served_by_default(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, body = host.handle("GET", "/view/sec/abs/secret.txt")
        assert status in (403, 404)
        assert b"abs-root-secret" not in read_body(body)

    def test_relative_root_still_served_by_default(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, body = host.handle("GET", "/view/sec/rel/ok.txt")
        assert status == 200
        assert read_body(body) == b"relative-root-ok"

    def test_skip_is_logged(self, tmp_path: pathlib.Path, caplog):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        with caplog.at_level(logging.DEBUG):
            host.handle("GET", "/api/discover")
        messages = " ".join(r.getMessage() for r in caplog.records)
        assert "abs" in messages and "skip" in messages.lower(), (
            f"absolute staticRoot skip is not logged: {messages!r}"
        )
        assert "allow_absolute_static_roots" in messages, (
            f"skip log does not name the opt-in flag: {messages!r}"
        )

    def test_opt_in_serves_the_absolute_root(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)], allow_absolute_static_roots=True)
        status, _, body = host.handle("GET", "/view/sec/abs/secret.txt")
        assert status == 200
        assert read_body(body) == b"abs-root-secret"


# ── 3. /api/discover 不回传绝对路径 ─────────────────────────────────────────


class TestDiscoverLeaksNoAbsolutePaths:
    def test_response_contains_no_absolute_filesystem_path(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, body = host.handle("GET", "/api/discover")
        assert status == 200
        text = body.decode()
        assert str(tmp_path) not in text
        bundle = json.loads(text)[0]
        for value in (bundle["dir"], bundle["registryDir"],
                      *[r["base"] for r in bundle["staticRoots"]]):
            assert re.match(r"^(/|[A-Za-z]:\\)", value) is None, (
                f"absolute path leaked in /api/discover: {value!r}"
            )
        assert bundle["dir"] == "sec"
        assert bundle["registryDir"] == tmp_path.name

    def test_single_bundle_mode_dir_is_dot(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path / "wrapper")
        host = LavsHost(registry_dirs=[str(tmp_path / "wrapper" / "sec")])
        _, _, body = host.handle("GET", "/api/discover")
        bundle = json.loads(body)[0]
        assert bundle["dir"] == "."
        assert bundle["registryDir"] == "sec"

    def test_internal_bundle_info_keeps_absolute_paths(self, tmp_path: pathlib.Path):
        """File serving / calling must keep working off absolute in-process paths."""
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        assert host._find_bundle("sec")["dir"] == str(tmp_path / "sec")
        status, _, _ = host.handle("GET", "/view/sec/view/index.html")
        assert status == 200


# ── 4. 显式 allow_origins 才回 CORS 头 ─────────────────────────────────────


class TestExplicitAllowOrigins:
    def test_allow_origins_echoes_the_origin(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)], allow_origins=[EVIL_ORIGIN])
        status, headers, _ = host.handle("GET", "/api/discover",
                                         headers={"Origin": EVIL_ORIGIN})
        assert status == 200
        assert lower(headers)["access-control-allow-origin"] == EVIL_ORIGIN

    def test_allow_origins_star_answers_star(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)], allow_origins=["*"])
        status, headers, _ = host.handle("GET", "/api/discover",
                                         headers={"Origin": EVIL_ORIGIN})
        assert status == 200
        assert lower(headers)["access-control-allow-origin"] == "*"

    def test_unlisted_origin_is_still_rejected(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)], allow_origins=["http://other.example"])
        status, headers, _ = host.handle("GET", "/api/discover",
                                         headers={"Origin": EVIL_ORIGIN})
        assert status == 403
        assert "access-control-allow-origin" not in lower(headers)

    def test_preflight_from_allowed_origin_is_answered(self, tmp_path: pathlib.Path):
        """allow_origins only helps real browsers if the preflight is answered."""
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)], allow_origins=[EVIL_ORIGIN])
        status, headers, _ = host.handle(
            "OPTIONS", "/api/call/sec/touch",
            headers={"Origin": EVIL_ORIGIN, "Access-Control-Request-Method": "POST"},
        )
        assert status in (200, 204)
        assert lower(headers)["access-control-allow-origin"] == EVIL_ORIGIN

    def test_cross_origin_non_guarded_path_is_not_blocked(self, tmp_path: pathlib.Path):
        """Guard scope mirrors TS isGuardedPath: /api/* and /view/* only."""
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)])
        status, _, _ = host.handle("GET", "/", headers={"Origin": EVIL_ORIGIN})
        assert status == 200

    def test_allowed_call_still_runs_the_handler(self, tmp_path: pathlib.Path):
        make_sec_bundle(tmp_path)
        host = LavsHost(registry_dirs=[str(tmp_path)], allow_origins=[EVIL_ORIGIN])
        status, _, _ = host.handle("POST", "/api/call/sec/touch",
                                   headers={"Origin": EVIL_ORIGIN,
                                            "Content-Type": "text/plain"},
                                   body=b"{}")
        assert status == 200
        assert touched(tmp_path)
