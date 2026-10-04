"""Regression guard for issue #18 (Python host).

The Python host page must post every message with a concrete target origin,
and the IIFE asset it serves (``lavs_runtime/assets/lavs-view.iife.js``) is a
copy of the @lavs/view build — so it must be regenerated whenever the view
bridge changes.
"""

from __future__ import annotations

import re
from pathlib import Path

from lavs_runtime.host_page import render_host_page

WILDCARD_TARGET = re.compile(r"""postMessage\([^;]*?,\s*['"]\*['"]\s*\)""", re.S)
ASSET = Path(__file__).resolve().parents[1] / "lavs_runtime" / "assets" / "lavs-view.iife.js"


def test_host_page_does_not_post_with_wildcard_target():
    page = render_host_page()
    assert WILDCARD_TARGET.search(page) is None


def test_host_page_targets_window_location_origin():
    assert "window.location.origin" in render_host_page()


def test_bundled_view_iife_has_no_wildcard_target():
    """The shipped @lavs/view build must be regenerated after the fix."""
    js = ASSET.read_text(encoding="utf-8")
    assert WILDCARD_TARGET.search(js) is None
