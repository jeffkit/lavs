"""
LAVS Client SDK.

Client library for calling LAVS endpoints from Python applications.
Uses httpx for HTTP requests and SSE.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import httpx

from lavs_types import LAVSManifest, LAVSError


class LAVSClient:
    """
    LAVS Client for calling agent endpoints.

    Supports call(), get_manifest(), and subscribe() methods.
    """

    def __init__(
        self,
        agent_id: str,
        base_url: str = "http://localhost:3000",
        project_path: str | None = None,
        auth_token: str | None = None,
    ) -> None:
        """
        Initialize LAVS client.

        Args:
            agent_id: Agent ID.
            base_url: Base URL for LAVS API (default: http://localhost:3000).
            project_path: Project path for data isolation.
            auth_token: Optional Bearer token for authentication.
        """
        self._agent_id = agent_id
        self._base_url = base_url.rstrip("/")
        self._project_path = project_path
        self._auth_token = auth_token
        self._manifest: LAVSManifest | None = None

    def _headers(self) -> dict[str, str]:
        """Build request headers."""
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"
        if self._project_path:
            headers["X-Project-Path"] = self._project_path
        return headers

    def get_manifest(self) -> LAVSManifest:
        """
        Get LAVS manifest for the agent.

        Returns:
            Parsed LAVS manifest.

        Raises:
            LAVSError: On HTTP or parse errors.
        """
        if self._manifest is not None:
            return self._manifest

        url = f"{self._base_url}/api/agents/{self._agent_id}/lavs/manifest"

        with httpx.Client() as client:
            response = client.get(url, headers=self._headers())

        if response.status_code != 200:
            self._raise_from_response(response)

        body = response.json()
        self._manifest = body.get("result", body)
        if isinstance(self._manifest, dict):
            self._manifest = LAVSManifest.model_validate(self._manifest)
        return self._manifest

    def call(self, endpoint_id: str, input_data: Any = None) -> Any:
        """
        Call a LAVS endpoint.

        Args:
            endpoint_id: Endpoint ID from manifest.
            input_data: Input data for the endpoint.

        Returns:
            Endpoint result.

        Raises:
            LAVSError: On HTTP or protocol errors.
        """
        url = f"{self._base_url}/api/agents/{self._agent_id}/lavs/{endpoint_id}"

        with httpx.Client() as client:
            response = client.post(
                url,
                headers=self._headers(),
                json=input_data or {},
            )

        if response.status_code != 200:
            self._raise_from_response(response)

        body = response.json()
        return body.get("result", body)

    def subscribe(
        self,
        endpoint_id: str,
        callback: Callable[[Any], None],
        *,
        on_error: Callable[[Exception], None] | None = None,
        on_connected: Callable[[dict], None] | None = None,
    ) -> Callable[[], None]:
        """
        Subscribe to a LAVS subscription endpoint via SSE.

        Runs the SSE connection in a background thread. Returns an unsubscribe
        function to close the connection.

        Args:
            endpoint_id: Subscription endpoint ID from manifest.
            callback: Called with event data on each SSE message.
            on_error: Optional error handler.
            on_connected: Optional handler for connection established.

        Returns:
            Unsubscribe function to close the SSE connection.
        """
        import threading

        stop_flag = threading.Event()

        def run_stream() -> None:
            url = f"{self._base_url}/api/agents/{self._agent_id}/lavs/{endpoint_id}/subscribe"
            try:
                with httpx.Client() as client:
                    with client.stream("GET", url, headers=self._headers()) as response:
                        if response.status_code != 200:
                            err = LAVSError(
                                -1,
                                f"SSE connection failed: {response.status_code}",
                            )
                            if on_error:
                                on_error(err)
                            return

                        event_type = ""
                        for line in response.iter_lines():
                            if stop_flag.is_set():
                                break
                            if line.startswith("event:"):
                                event_type = line[6:].strip()
                            elif line.startswith("data:"):
                                data_str = line[5:].strip()
                                try:
                                    data = json.loads(data_str)
                                except json.JSONDecodeError:
                                    data = data_str

                                if event_type == "connected" and on_connected:
                                    on_connected(
                                        data if isinstance(data, dict) else {"data": data}
                                    )
                                elif event_type == "data":
                                    callback(data)
            except Exception as e:
                if on_error:
                    on_error(e)

        thread = threading.Thread(target=run_stream, daemon=True)
        thread.start()

        def unsubscribe() -> None:
            stop_flag.set()

        return unsubscribe

    def clear_cache(self) -> None:
        """Clear manifest cache (force reload on next get_manifest)."""
        self._manifest = None

    def _raise_from_response(self, response: httpx.Response) -> None:
        """Raise LAVSError from HTTP response."""
        try:
            body = response.json()
            rpc_error = body.get("error", body)
            code = rpc_error.get("code", -1)
            message = rpc_error.get(
                "message", rpc_error.get("error", f"HTTP {response.status_code}")
            )
            data = rpc_error.get("data")
        except Exception:
            code = -1
            message = f"HTTP {response.status_code}: {response.reason_phrase}"
            data = None

        raise LAVSError(code, message, data)
