"""issue #20 — `permissions.max_execution_time` caps `handler.timeout`.

`ScriptExecutor` resolves the timeout via
`PermissionChecker.get_effective_timeout` (min of handler.timeout and
permissions.max_execution_time), mirroring
`sdk/typescript/runtime/src/script-executor.ts` — both runtimes must agree on
the same effective timeout (AGENTS.md: 禁止只改 TS 或 Python 一侧导致双端语义漂移).
"""

from __future__ import annotations

import subprocess
import time
from typing import Any

import pytest

from lavs_runtime import ScriptExecutor
from lavs_types import (
    ExecutionContext,
    LAVSError,
    LAVSErrorCode,
    Permissions,
    ScriptHandler,
)

LONG_RUNNING = "import time; time.sleep(60)"


def _context(max_execution_time: int | None) -> ExecutionContext:
    return ExecutionContext(
        endpoint_id="slow",
        agent_id="agent-1",
        workdir=".",
        permissions=Permissions(max_execution_time=max_execution_time) if max_execution_time else Permissions(),
    )


def test_effective_timeout_is_capped_by_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fast, deterministic check on the timeout handed to subprocess.run."""
    recorded: dict[str, Any] = {}

    def fake_run(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        recorded.update(kwargs)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    handler = ScriptHandler(command="python3", args=["-c", LONG_RUNNING], timeout=60000)
    ScriptExecutor().execute(handler, None, _context(1000))

    assert recorded["timeout"] == pytest.approx(1.0)


def test_context_timeout_zero_is_treated_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """context.timeout=0 falls back to the 30000ms default, matching TS."""
    recorded: dict[str, Any] = {}

    def fake_run(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        recorded.update(kwargs)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    handler = ScriptHandler(command="python3", args=["-c", LONG_RUNNING])
    context = _context(None).model_copy(update={"timeout": 0})
    ScriptExecutor().execute(handler, None, context)

    assert recorded["timeout"] == pytest.approx(30.0)


def test_executor_kills_the_child_at_max_execution_time() -> None:
    """Real subprocess: permission cap must win over handler.timeout."""
    handler = ScriptHandler(command="python3", args=["-c", LONG_RUNNING], timeout=10000)

    started_at = time.monotonic()
    with pytest.raises(LAVSError) as exc_info:
        ScriptExecutor().execute(handler, None, _context(1000))
    elapsed = time.monotonic() - started_at

    assert exc_info.value.code == LAVSErrorCode.Timeout
    assert elapsed < 4.0
