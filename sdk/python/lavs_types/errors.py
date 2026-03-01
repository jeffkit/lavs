"""
LAVS Error types and JSON-RPC 2.0 error codes.

See docs/SPEC.md section 5.3 for error code definitions.
"""

from __future__ import annotations


class LAVSError(Exception):
    """
    LAVS standard error format (JSON-RPC 2.0 compatible).

    Attributes:
        code: JSON-RPC 2.0 error code.
        message: Human-readable error message.
        data: Optional additional error data.
    """

    def __init__(
        self,
        code: int,
        message: str,
        data: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data or {}
        self.name = "LAVSError"

    def to_dict(self) -> dict[str, object]:
        """Convert to JSON-RPC 2.0 error object."""
        result: dict[str, object] = {"code": self.code, "message": self.message}
        if self.data:
            result["data"] = self.data
        return result


# JSON-RPC 2.0 compatible error codes
class LAVSErrorCode:
    """LAVS error codes (JSON-RPC 2.0 compatible)."""

    ParseError = -32700
    InvalidRequest = -32600
    MethodNotFound = -32601
    InvalidParams = -32602
    InternalError = -32603
    PermissionDenied = -32001
    Timeout = -32002
    HandlerError = -32003
