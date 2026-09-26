"""Production logging must never record pack-asset tokens (stderr + app log)."""
from __future__ import annotations

import asyncio
import logging
import sys
import tempfile
from io import StringIO
from pathlib import Path

from aiohttp import ClientSession

from service import access, monitor, pack_asset_frames
from tests.monitor_app_test_util import host_header, make_app_server
from tests.pack_asset_test_util import SECRET, SESSION, mint, new_frame_id


def _dist_with_sandbox() -> Path:
    dist = Path(tempfile.mkdtemp())
    dist.joinpath("plugin-sandbox.html").write_text("<html><body>x</body></html>", encoding="utf-8")
    dist.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")
    return dist


def test_production_logs_token_zero_times_after_forced_mutate_failure() -> None:
    dist = _dist_with_sandbox()
    frame = new_frame_id()
    stderr_buf = StringIO()
    app_lines: list[str] = []

    async def run() -> None:
        async with make_app_server(web_dist=dist) as (ip, port, runner):
            assert monitor.run_app_kwargs()["access_log"] is None
            runner.app["pack_asset_secret"] = SECRET
            pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
            tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
            path = access.pack_asset_url(tok, "_sandbox", "plugin-sandbox.html")
            root = logging.getLogger()
            handler = logging.Handler()
            handler.emit = lambda record: app_lines.append(record.getMessage())  # type: ignore[method-assign]
            root.addHandler(handler)
            root.setLevel(logging.INFO)
            old_stderr = sys.stderr
            sys.stderr = stderr_buf
            access_lines: list[str] = []
            log = logging.getLogger("aiohttp.access")
            al_handler = logging.Handler()
            al_handler.emit = lambda record: access_lines.append(record.getMessage())  # type: ignore[method-assign]
            log.addHandler(al_handler)
            log.setLevel(logging.INFO)
            try:
                async with ClientSession() as session:
                    async with session.get(
                        f"http://{ip}:{port}{path}",
                        headers={**host_header(port), access.HEADER: SESSION},
                    ) as resp:
                        assert resp.status == 200
            finally:
                log.removeHandler(al_handler)
                sys.stderr = old_stderr
                root.removeHandler(handler)

            joined = "\n".join(app_lines + access_lines) + "\n" + stderr_buf.getvalue()
            assert joined.count(tok) == 0

    asyncio.run(run())
