from __future__ import annotations

from pathlib import Path

import pytest

from service import sources


RSS = """<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>Example</title>
<item><title>First</title><link>https://example.com/1</link><description><p>Hi &amp; <b>there</b></p></description></item>
<item><title>Second</title><link>https://example.com/2</link></item>
<item>
  <title>A long NASA caption that should stay intact on the ticker and slides</title>
  <enclosure url="https://www.nasa.gov/wp-content/uploads/2026/01/iotd.jpg" type="image/jpeg" length="4500000"/>
</item>
</channel></rss>
"""

ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom</title>
<entry><title>A1</title><link href="https://example.com/a"/></entry>
</feed>
"""


@pytest.fixture(autouse=True)
def _iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    user = home / ".zoto-viz"
    user.mkdir()
    monkeypatch.setattr(sources.paths, "user_dir", lambda: user)
    monkeypatch.setattr(Path, "home", staticmethod(lambda: home))
    monkeypatch.setattr(sources.agent_assets, "check_url", lambda u: u.strip())
    sources.reset_for_tests()
    return user


def test_parse_rss_and_atom() -> None:
    rss = sources.parse_rss(RSS)
    assert rss["title"] == "Example"
    assert [i["title"] for i in rss["items"]] == [
        "First",
        "Second",
        "A long NASA caption that should stay intact on the ticker and slides",
    ]
    assert rss["items"][0]["summary"] == "Hi & there"
    assert rss["items"][2]["image"] == "https://www.nasa.gov/wp-content/uploads/2026/01/iotd.jpg"


ATOM_POTD = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Commons POTD</title>
<entry>
  <title>Picture of the day</title>
  <summary type="html">&lt;img src=&quot;https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Baikal%2C_Cape_Burhan.jpg/330px-Baikal%2C_Cape_Burhan.jpg?utm_source=commons&amp;amp;utm_campaign=parser&quot; /&gt;
  &lt;img src=&quot;https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Baikal%2C_Cape_Burhan.jpg/960px-Baikal%2C_Cape_Burhan.jpg?utm_source=commons&quot; /&gt;</summary>
</entry>
</feed>
"""


def test_commons_potd_keeps_full_thumb() -> None:
    atom = sources.parse_rss(ATOM_POTD)
    image = atom["items"][0]["image"]
    assert "/960px-Baikal" in image
    assert image.startswith("https://thumb.wikimedia.org/")
    assert "utm_" not in image
    assert sources.clean_image_url(
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Baikal.jpg"
    ).endswith("/1280px-Baikal.jpg")
    atom = sources.parse_rss(ATOM)
    assert atom["items"][0]["title"] == "A1"
    assert atom["items"][0]["link"] == "https://example.com/a"


def test_normalize_and_unique_ids() -> None:
    a = sources.normalize({"id": "hn", "type": "rss", "url": "https://hnrss.org/frontpage"})
    assert a["id"] == "hn"
    assert a["interval"] == 300
    with pytest.raises(ValueError, match="type"):
        sources.normalize({"id": "x", "type": "ftp", "url": "https://example.com"})
    j = sources.normalize({"id": "journal", "type": "journal", "unit": "foo.service"})
    assert j["type"] == "journal" and j["unit"] == "foo.service"
    k = sources.normalize({"id": "kmsg", "type": "kmsg"})
    assert k["type"] == "kmsg" and "url" not in k and "path" not in k
    with pytest.raises(ValueError, match="path"):
        sources.normalize({"id": "x", "type": "file"})
    taken = {"notes"}
    assert sources.unique_id("notes", taken) == "notes-2"


def test_file_guard_and_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    user = sources.paths.user_dir()
    notes = user / "sources"
    notes.mkdir()
    p = notes / "hello.txt"
    p.write_text("line one\nline two\n", encoding="utf-8")
    row = sources.normalize({"id": "notes", "type": "file", "path": str(p)})
    sources.save([row])
    assert sources.snapshot()["notes"]["pending"] is True
    import asyncio
    asyncio.run(sources.fetch_one(row))
    live = sources.snapshot()["notes"]
    assert live["ok"] is True
    assert live["text"].startswith("line one")
    with pytest.raises(ValueError):
        sources.check_file("/etc/passwd")


def test_parse_kmsg_and_journal_shape() -> None:
    item = sources.parse_kmsg_line("3,123,456,-;usb 1-2: new device")
    assert item is not None
    assert item["title"].startswith("usb")
    assert item["summary"] == "err"
    assert sources.parse_kmsg_line("   ") is None
    lines = sources.read_journal()
    assert isinstance(lines, list)
    if lines:
        assert "title" in lines[0]


def test_seed_defaults_and_crud() -> None:
    rows = sources.load()
    ids = {r["id"] for r in rows}
    assert "hn" in ids
    assert "nasa" in ids
    assert "apod" in ids
    assert "lobsters" in ids
    assert "journal" in ids
    assert "kmsg" in ids
    assert sources.sources_file().is_file()
    extra = sources.upsert({"id": "notes", "type": "file", "path": str(sources.paths.user_dir() / "missing.txt")})
    assert extra["id"] == "notes"
    assert sources.delete("notes") is True
    assert sources.delete("notes") is False
    lines = sources.headlines()
    assert isinstance(lines, list)


def test_parse_rss_keeps_a_deep_page() -> None:
    items = "".join(f"<item><title>Shot {i}</title></item>" for i in range(40))
    parsed = sources.parse_rss(f'<?xml version="1.0"?><rss><channel><title>Deep</title>{items}</channel></rss>')
    assert len(parsed["items"]) == 40


def test_raise_feed_depth_rewrites_old_caps() -> None:
    sources.save([
        sources.normalize({
            "id": "apod", "type": "http",
            "url": "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=8",
            "fields": {"title": "title", "image": "hdurl"},
        }),
        sources.normalize({
            "id": "met", "type": "http",
            "url": "https://collectionapi.metmuseum.org/public/collection/v1/search?q=art",
            "fields": {"list": "objectIDs", "expandCap": 8, "title": "title"},
        }),
        sources.normalize({
            "id": "guardian", "type": "http",
            "url": "https://content.guardianapis.com/search?page-size=12&api-key=test",
            "fields": {"list": "response.results", "title": "webTitle"},
        }),
    ])
    sources.reset_for_tests()
    rows = {r["id"]: r for r in sources.load()}
    assert f"count={sources.APOD_COUNT}" in rows["apod"]["url"]
    assert rows["met"]["fields"]["expandCap"] == sources.MET_EXPAND
    assert f"page-size={sources.GUARDIAN_PAGE}" in rows["guardian"]["url"]


def test_seed_content_sources_on_old_registry() -> None:
    sources.save([sources.normalize({"id": "hn", "type": "rss", "url": "https://hnrss.org/frontpage"})])
    sources.reset_for_tests()
    ids = {r["id"] for r in sources.load()}
    assert "hn" in ids
    assert "apod" in ids
    assert "earth-iotd" in ids
    assert "met" in ids
    assert "guardian" in ids
    assert "mastodon" in ids
    apod = next(r for r in sources.ensure() if r["id"] == "apod")
    assert apod["fields"]["image"] == "hdurl"


def test_api_image_requires_url() -> None:
    class Req:
        query: dict[str, str] = {}

    import asyncio
    resp = asyncio.run(sources.api_image(Req()))  # type: ignore[arg-type]
    assert resp.status == 400
