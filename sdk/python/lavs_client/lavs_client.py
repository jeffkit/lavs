"""
Bundle-level LAVS client (issue #16, layer 4).

Talks to any LAVS host (Node or Python) over its HTTP routes — for services
that want to *call* a running host rather than embed one.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx


class LavsClient:
    """HTTP client for a running LAVS host.

    Usage::

        c = LavsClient("http://127.0.0.1:7855")
        bundles = c.discover()
        result = c.call("demo", "getItems", {})
        for event in c.events():          # blocking SSE iterator
            ...
    """

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    def discover(self) -> list[dict[str, Any]]:
        r = httpx.get(f"{self.base_url}/api/discover", timeout=self._timeout)
        r.raise_for_status()
        return r.json()

    def get_manifest(self, bundle: str) -> dict[str, Any]:
        r = httpx.get(f"{self.base_url}/api/manifest/{bundle}", timeout=self._timeout)
        r.raise_for_status()
        return r.json()

    def call(self, bundle: str, endpoint: str, input: dict | None = None) -> Any:
        r = httpx.post(
            f"{self.base_url}/api/call/{bundle}/{endpoint}",
            json=input or {},
            timeout=self._timeout,
        )
        r.raise_for_status()
        return r.json().get("result")

    def notify(
        self,
        bundle: str,
        endpoint: str,
        result: Any = None,
        content_type: str | None = None,
        ui_command: bool = False,
        args: Any = None,
    ) -> None:
        """Notify views that an agent action occurred (mirrors the CLI notify path)."""
        payload: dict[str, Any] = {"result": result}
        if ui_command:
            payload.update({"kind": "ui_command", "input": args})
        r = httpx.post(
            f"{self.base_url}/api/notify/{bundle}/{endpoint}", json=payload, timeout=self._timeout
        )
        r.raise_for_status()

    def events(self) -> Iterator[dict[str, Any]]:
        """Blocking iterator over agent-action events (SSE)."""
        with httpx.stream("GET", f"{self.base_url}/api/events", timeout=None) as r:
            r.raise_for_status()
            event_name = None
            data_lines: list[str] = []
            for line in r.iter_lines():
                if line == "":
                    if data_lines:
                        data = json.loads("\n".join(data_lines))
                        yield {"event": event_name or "message", "data": data}
                    event_name, data_lines = None, []
                elif line.startswith("event: "):
                    event_name = line[7:]
                elif line.startswith("data: "):
                    data_lines.append(line[6:])
