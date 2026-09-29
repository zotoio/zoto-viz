"""Third-party datasource recipes materialize without clobbering operator rows."""
from __future__ import annotations

from service.source_library import catalog, materialize


def test_extends_copies_the_parent_url_shape() -> None:
    rows = materialize("sydney-meteo")
    assert rows[0]["id"] == "sydney-meteo"
    assert rows[0]["type"] == "http"
    assert "open-meteo.com" in rows[0]["url"]
    assert rows[0]["feed"] is False


def test_combine_then_overlay() -> None:
    rows = materialize(["usgs-quakes", "bbc-news"], {"interval": 900, "feed": True})
    assert [row["id"] for row in rows] == ["usgs-quakes", "bbc-news"]
    assert rows[0]["fields"]["list"] == "features"
    assert rows[1]["type"] == "rss"
    assert all(row["interval"] == 900 and row["feed"] is True for row in rows)


def test_catalog_hides_urls() -> None:
    rows = catalog()
    assert any(row["id"] == "frankfurter" for row in rows)
    assert all("url" not in row for row in rows)


def test_jsonlint_countries_project_titles() -> None:
    rows = materialize("jl-countries")
    assert rows[0]["url"] == "https://jsonlint.com/datasets/countries.json"
    assert rows[0]["fields"]["list"] == "countries"
    assert rows[0]["fields"]["title"] == "name"
    assert rows[0]["feed"] is False
    assert rows[0]["interval"] == 86_400


def test_jsonlint_catalog_is_selectable() -> None:
    rows = catalog()
    picked = [row for row in rows if str(row["id"]).startswith("jl-")]
    assert len(picked) >= 40
    useful = [row for row in picked if row.get("featured")]
    assert any(row["id"] == "jl-countries" for row in useful)
    assert any(row["id"] == "jl-config-eslint" and not row.get("featured") for row in picked)
    assert all("url" not in row for row in picked)


def test_unknown_library_id() -> None:
    try:
        materialize("not-a-feed")
    except ValueError as exc:
        assert "not-a-feed" in str(exc)
    else:
        raise AssertionError("expected ValueError")
