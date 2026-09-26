"""Traversal probes live in ``test_request_guard_policy`` (raw HTTP paths).

This module keeps the legacy static-root sandbox block assertion.
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from tests.test_request_guard_policy import test_plugin_sandbox_html_not_served_from_static_root

# Re-export for pytest discovery / revert sidecars that referenced this file.
test_traversal_cannot_reach_sandbox_html = test_plugin_sandbox_html_not_served_from_static_root
