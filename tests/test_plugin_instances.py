from __future__ import annotations

from pathlib import Path

import pytest

from service import plugin_instances as pins


@pytest.fixture(autouse=True)
def _iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    user = tmp_path / ".zoto-viz"
    user.mkdir()
    monkeypatch.setattr(pins.paths, "user_dir", lambda: user)
    pins.reset_for_tests()


def test_upsert_merge_and_attach() -> None:
    row = pins.upsert({"plugin": "carousel", "id": "flickr", "name": "Flickr", "source": "flickr"})
    assert row["id"] == "flickr"
    assert pins.delete("carousel", "flickr") is True
    assert pins.delete("carousel", "flickr") is False
    pins.upsert({"plugin": "hn-term", "id": "lobsters", "source": "lobsters", "name": "Lobsters Term"})
    catalog = [
        {"id": "carousel", "name": "Carousel", "instances": [{"id": "carousel", "source": "nasa"}]},
        {"id": "hn-term", "name": "HN Term"},
    ]
    attached = pins.attach(catalog)
    carousel = next(p for p in attached if p["id"] == "carousel")
    assert any(i["id"] == "carousel" for i in carousel["instances"])
    term = next(p for p in attached if p["id"] == "hn-term")
    ids = {i["id"] for i in term["instances"]}
    assert ids == {"hn-term", "lobsters"}
    assert next(i for i in term["instances"] if i["id"] == "lobsters")["source"] == "lobsters"


def test_normalize_rejects_bad_ids() -> None:
    with pytest.raises(ValueError, match="plugin"):
        pins.normalize({"plugin": "Nope", "id": "x"})
    with pytest.raises(ValueError, match="instance"):
        pins.normalize({"plugin": "carousel", "id": ""})
