"""
LAVS Rate Limiter.

Simple in-memory rate limiter for LAVS endpoint calls.
Uses a sliding window counter algorithm.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class RateLimitConfig:
    """Rate limit configuration."""

    max_requests: int = 60
    window_ms: int = 60000


@dataclass
class RateLimitResult:
    """Rate limit check result."""

    allowed: bool
    remaining: int
    reset_at: float


@dataclass
class _WindowEntry:
    """Internal window entry."""

    count: int = 0
    window_start: float = field(default_factory=time.time)


class LAVSRateLimiter:
    """
    LAVS Rate Limiter - prevents excessive endpoint calls.
    """

    def __init__(self, config: RateLimitConfig | None = None) -> None:
        """
        Create a rate limiter with default configuration.

        Args:
            config: Rate limit config (default: 60 requests per minute).
        """
        self._config = config or RateLimitConfig()
        self._windows: dict[str, _WindowEntry] = {}

    def check(
        self,
        key: str,
        config: RateLimitConfig | None = None,
    ) -> RateLimitResult:
        """
        Check if a request is allowed under the rate limit.

        Args:
            key: Rate limit key (e.g., f"{agent_id}:{endpoint_id}").
            config: Optional per-key override config.

        Returns:
            Rate limit check result.
        """
        cfg = config or self._config
        now = time.time()
        window_ms_sec = cfg.window_ms / 1000.0

        entry = self._windows.get(key)

        if entry is None or (now - entry.window_start) >= window_ms_sec:
            entry = _WindowEntry(count=0, window_start=now)
            self._windows[key] = entry

        if entry.count >= cfg.max_requests:
            return RateLimitResult(
                allowed=False,
                remaining=0,
                reset_at=entry.window_start + window_ms_sec,
            )

        entry.count += 1

        return RateLimitResult(
            allowed=True,
            remaining=cfg.max_requests - entry.count,
            reset_at=entry.window_start + window_ms_sec,
        )

    def reset(self, key: str) -> None:
        """Reset rate limit for a key."""
        self._windows.pop(key, None)

    def clear_all(self) -> None:
        """Clear all rate limit entries."""
        self._windows.clear()

    def cleanup(self) -> None:
        """Clean up expired windows to prevent memory leaks."""
        now = time.time()
        expired = [
            k
            for k, v in self._windows.items()
            if (now - v.window_start) >= (self._config.window_ms / 1000.0) * 2
        ]
        for k in expired:
            del self._windows[k]
