"""Live pack-asset frame ids per browser session (revocation on teardown)."""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field

FRAME_ABSOLUTE_TTL_S = 86_400


@dataclass
class _FrameRow:
    registered_at: float


@dataclass
class PackAssetFrameRegistry:
    """session_id -> frame_id -> registration time."""

    _by_session: dict[str, dict[str, _FrameRow]] = field(default_factory=lambda: defaultdict(dict))

    def register(self, session_id: str, frame_id: str, *, now: float | None = None) -> None:
        if not session_id or not frame_id:
            return
        t = now if now is not None else time.time()
        self._by_session[session_id][frame_id] = _FrameRow(registered_at=t)

    def unregister(self, session_id: str, frame_id: str) -> None:
        if not session_id or not frame_id:
            return
        bucket = self._by_session.get(session_id)
        if bucket:
            bucket.pop(frame_id, None)
            if not bucket:
                self._by_session.pop(session_id, None)

    def is_live(self, session_id: str, frame_id: str, *, now: float | None = None) -> bool:
        if not session_id or not frame_id:
            return False
        row = self._by_session.get(session_id, {}).get(frame_id)
        if not row:
            return False
        t = now if now is not None else time.time()
        return t <= row.registered_at + FRAME_ABSOLUTE_TTL_S


def registry_for_app(app) -> PackAssetFrameRegistry:
    key = "pack_asset_frame_registry"
    reg = app.get(key)
    if reg is None:
        reg = PackAssetFrameRegistry()
        app[key] = reg
    return reg
