from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path

import pytest
from aiohttp.test_utils import make_mocked_request

from service import cursor_stats
from service import logbuf
from service import paths


@pytest.fixture(autouse=True)
def _stats_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    logbuf.reset_for_tests()
    dest = tmp_path / "cursor-stats.jsonl"
    monkeypatch.setenv("ZOTO_VIZ_CURSOR_STATS", str(dest))
    monkeypatch.setenv("CURSOR_API_KEY", "key_testsecretvalue0123456789")
    return dest


def test_sanitize_strips_key_and_secret_fields() -> None:
    got = cursor_stats.sanitize({
        "apiKey": "key_testsecretvalue0123456789",
        "CURSOR_API_KEY": "key_testsecretvalue0123456789",
        "authorization": "Bearer nope",
        "op": "chat",
        "usage": {"inputTokens": 3, "outputTokens": 5, "totalTokens": 8},
        "note": "used key_testsecretvalue0123456789 in prompt",
    })
    assert "apiKey" not in got
    assert "CURSOR_API_KEY" not in got
    assert "authorization" not in got
    assert got["usage"]["totalTokens"] == 8
    assert "[redacted]" in got["note"]
    assert "key_testsecretvalue0123456789" not in json.dumps(got)


def test_append_and_ingest_dedup_and_debug_line(tmp_path: Path) -> None:
    dest = Path(os.environ["ZOTO_VIZ_CURSOR_STATS"])
    rec = {
        "id": "stat-1",
        "op": "chat",
        "model": "grok-4.6",
        "status": "finished",
        "usage": {"inputTokens": 12, "outputTokens": 4, "totalTokens": 16},
        "cost": {"rawCostCents": 1.5, "chargedCents": 1.2},
        "account": {"apiKeyName": "zoto-viz"},
    }
    first = cursor_stats.ingest({"stats": rec})
    second = cursor_stats.ingest({"stats": rec})
    assert first and first["id"] == "stat-1"
    assert second and second["id"] == "stat-1"
    lines = dest.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    stored = json.loads(lines[0])
    assert stored["usage"]["inputTokens"] == 12
    assert stored["cost"]["chargedCents"] == 1.2
    assert dest.stat().st_mode & 0o777 == 0o600
    text = logbuf.since(0)["lines"][0]["text"]
    assert "cursor stats chat grok-4.6" in text
    assert "in=12" in text
    assert "charged=1.2¢" in text
    assert "key=zoto-viz" in text


def test_usage_blob_for_parking_log() -> None:
    blob = cursor_stats.usage_from_stats({
        "op": "chat",
        "model": "grok-4.6",
        "runId": "run-1",
        "agentId": "agent-1",
        "durationMs": 12,
        "usage": {"inputTokens": 10, "outputTokens": 2, "totalTokens": 12, "cacheReadTokens": 4},
        "billed": {"error": "feature_unavailable", "cost": {"chargedCents": 0}},
    })
    assert blob and blob["usage"]["cacheReadTokens"] == 4
    assert blob["cost"]["chargedCents"] == 0
    assert blob["spendError"] == "feature_unavailable"
    assert blob["model"] == "grok-4.6"


def test_tail_and_api_omit_secrets() -> None:
    cursor_stats.append({
        "op": "list",
        "models": 3,
        "apiKey": "key_testsecretvalue0123456789",
        "account": {"apiKeyName": "lab"},
    })
    rows = cursor_stats.tail(10)
    assert rows[-1]["op"] == "list"
    assert "apiKey" not in rows[-1]
    dumped = json.dumps(rows)
    assert "key_testsecretvalue0123456789" not in dumped


def test_api_stats_returns_tail() -> None:
    cursor_stats.append({"op": "still", "model": "composer-2.5", "usage": {"totalTokens": 9}})
    req = make_mocked_request("GET", "/api/ai/cursor-stats?tail=5")
    resp = asyncio.run(cursor_stats.api_stats(req))
    body = json.loads(resp.body)
    assert body["ok"] is True
    assert body["path"] == "cursor-stats.jsonl"
    assert body["lines"][-1]["op"] == "still"


def test_node_stats_module_redacts_and_writes(tmp_path: Path) -> None:
    dest = tmp_path / "from-node.jsonl"
    js = paths.repo_root() / "service" / "cursor-bridge"
    script = """
import { appendStats, sanitize } from "./stats.mjs";
const clean = sanitize({
  apiKey: process.env.CURSOR_API_KEY,
  usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  cost: { rawCostCents: 0.4, chargedCents: 0.2 },
});
if (clean.apiKey) throw new Error("apiKey leaked");
const rec = appendStats({
  id: "node-1",
  op: "chat",
  model: "grok-4.6",
  usage: clean.usage,
  cost: clean.cost,
  apiKey: process.env.CURSOR_API_KEY,
});
if (!rec.usage || rec.apiKey) throw new Error("bad record");
process.stdout.write("ok\\n");
"""
    env = os.environ.copy()
    env["ZOTO_VIZ_CURSOR_STATS"] = str(dest)
    env["CURSOR_API_KEY"] = "key_testsecretvalue0123456789"
    out = subprocess.check_output(
        ["node", "--input-type=module", "-e", script],
        env=env,
        cwd=str(js),
        text=True,
    )
    assert out.strip() == "ok"
    row = json.loads(dest.read_text(encoding="utf-8").splitlines()[0])
    assert row["id"] == "node-1"
    assert row["usage"]["totalTokens"] == 3
    assert row["cost"]["chargedCents"] == 0.2
    assert "apiKey" not in row
    assert "key_testsecretvalue0123456789" not in dest.read_text(encoding="utf-8")


def test_status_poll_skips_list_ingest() -> None:
    row = {
        "stats": {
            "id": "list-skip",
            "op": "list",
            "models": 2,
            "account": {"apiKeyName": "lab"},
        }
    }
    assert cursor_stats.ingest(row)
    dest = Path(os.environ["ZOTO_VIZ_CURSOR_STATS"])
    before = dest.read_text(encoding="utf-8")
    # enrich_status uses capture=False so Python does not ingest the poll.
    # A second identical id is also ignored.
    assert cursor_stats.ingest(row)
    assert dest.read_text(encoding="utf-8") == before
