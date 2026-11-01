"""Audit counters for MCP tool calls and capture health."""
from __future__ import annotations

from types import SimpleNamespace

from service import logbuf
from service import mcp
from service import signals


def test_mcp_tool_call_is_counted_without_arguments() -> None:
    logbuf.reset_for_tests()
    signals.reset_for_tests()
    mcp.handle_rpc({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "get_logs", "arguments": {"secret": "do-not-log"}},
    })
    mcp.handle_rpc({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "not-a-real-tool", "arguments": {"token": "also-hidden"}},
    })
    counters = signals.snapshot()["counters"]
    ok = [
        row for row in counters
        if row["name"] == "mcp_tool_calls_total"
        and row["labels"] == {"outcome": "ok", "tool": "get_logs"}
    ]
    other = [
        row for row in counters
        if row["name"] == "mcp_tool_calls_total"
        and row["labels"].get("tool") == "other"
        and row["labels"].get("outcome") == "error"
    ]
    assert ok and ok[0]["value"] == 1
    assert other and other[0]["value"] == 1
    text = " ".join(row["text"] for row in logbuf.since(0)["lines"])
    assert "event=mcp_tool tool=get_logs outcome=ok" in text
    assert "event=mcp_tool tool=other outcome=error" in text
    assert "do-not-log" not in text
    assert "also-hidden" not in text


def test_capture_age_gauge_and_single_burn() -> None:
    logbuf.reset_for_tests()
    signals.reset_for_tests()
    state = SimpleNamespace(last_packet_wall=1_000.0, started=1_000.0)
    signals.observe_capture(state, now=1_010.0)
    assert signals.gauge("capture_last_packet_age_seconds") == 10
    signals.observe_capture(state, now=1_040.0)
    assert signals.gauge("capture_last_packet_age_seconds") == 40
    assert "capture_slo_burn" not in " ".join(row["text"] for row in logbuf.since(0)["lines"])
    signals.observe_capture(state, now=1_340.0)
    signals.observe_capture(state, now=1_400.0)
    text = [row["text"] for row in logbuf.since(0)["lines"]]
    assert text.count("event=capture_slo_burn age_seconds=340") == 1
    signals.observe_capture(state, now=1_020.0)
    assert signals.gauge("capture_last_packet_age_seconds") == 20
    assert state._capture_slo["alerted"] is False


def test_capture_restart_counter_uses_bounded_reason() -> None:
    logbuf.reset_for_tests()
    signals.reset_for_tests()
    signals.capture_restart("permission", 1)
    signals.capture_restart("not-a-reason", None)
    counters = {row["labels"]["reason"]: row["value"] for row in signals.snapshot()["counters"]}
    assert counters["permission"] == 1
    assert counters["exit"] == 1
    text = " ".join(row["text"] for row in logbuf.since(0)["lines"])
    assert "event=capture_restart reason=permission rc=1" in text
    assert "event=capture_restart reason=exit rc=-" in text


def test_operator_token_file_is_not_echoed(tmp_path, monkeypatch) -> None:
    from service import operator_auth, paths

    monkeypatch.setattr(paths, "user_dir", lambda: tmp_path)
    monkeypatch.delenv(operator_auth.ENV, raising=False)
    token, created = operator_auth.load_or_create()
    assert created is True
    assert (tmp_path / "operator.token").stat().st_mode & 0o777 == 0o600
    again, created_again = operator_auth.load_or_create()
    assert again == token
    assert created_again is False
    monkeypatch.setenv(operator_auth.ENV, "from-env")
    env_token, env_created = operator_auth.load_or_create()
    assert env_token == "from-env"
    assert env_created is False
    assert "from-env" not in (tmp_path / "operator.token").read_text(encoding="utf-8")
