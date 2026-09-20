from service import logbuf


def setup_function() -> None:
    logbuf.reset_for_tests()


def test_record_and_since_skips_seen() -> None:
    a = logbuf.record("wifi scan")
    b = logbuf.record("client connected")
    assert a["seq"] == 1
    assert b["text"] == "client connected"
    got = logbuf.since(1)
    assert got["seq"] == 2
    assert [r["text"] for r in got["lines"]] == ["client connected"]
    assert logbuf.since(2)["lines"] == []


def test_record_caps_text_and_bad_after() -> None:
    logbuf.record("x" * 5000)
    assert len(logbuf.since(0)["lines"][0]["text"]) == logbuf.MAX_TEXT
    assert logbuf.since("nope")["seq"] == 1
    assert logbuf.since(-3)["lines"]
