"""Tests for LAVSRateLimiter."""

import time

import pytest

from lavs_runtime import LAVSRateLimiter, RateLimitConfig, RateLimitResult


def test_rate_limiter_allows_requests_within_limit() -> None:
    """Test requests within limit are allowed."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=5, window_ms=60000))

    for _ in range(5):
        result = limiter.check("agent:endpoint")
        assert result.allowed is True
        assert result.remaining >= 0


def test_rate_limiter_denies_over_limit() -> None:
    """Test requests over limit are denied."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=3, window_ms=60000))

    for _ in range(3):
        limiter.check("agent:endpoint")

    result = limiter.check("agent:endpoint")
    assert result.allowed is False
    assert result.remaining == 0


def test_rate_limiter_reset() -> None:
    """Test reset allows requests again."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=2, window_ms=60000))

    limiter.check("key1")
    limiter.check("key1")
    result = limiter.check("key1")
    assert result.allowed is False

    limiter.reset("key1")
    result = limiter.check("key1")
    assert result.allowed is True


def test_rate_limiter_different_keys() -> None:
    """Test different keys have independent limits."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=1, window_ms=60000))

    r1 = limiter.check("key1")
    r2 = limiter.check("key2")
    assert r1.allowed is True
    assert r2.allowed is True

    r1_again = limiter.check("key1")
    assert r1_again.allowed is False


def test_rate_limiter_window_expiry() -> None:
    """Test window expiry allows new requests."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=1, window_ms=100))

    limiter.check("key1")
    result = limiter.check("key1")
    assert result.allowed is False

    time.sleep(0.15)  # Wait for window to expire
    result = limiter.check("key1")
    assert result.allowed is True


def test_rate_limiter_clear_all() -> None:
    """Test clear_all resets all keys."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=1, window_ms=60000))

    limiter.check("key1")
    limiter.check("key2")
    limiter.clear_all()

    assert limiter.check("key1").allowed is True
    assert limiter.check("key2").allowed is True


def test_rate_limiter_remaining_decreases() -> None:
    """Test remaining count decreases with each request."""
    limiter = LAVSRateLimiter(RateLimitConfig(max_requests=5, window_ms=60000))

    r1 = limiter.check("key1")
    r2 = limiter.check("key1")
    r3 = limiter.check("key1")

    assert r1.remaining > r2.remaining > r3.remaining
