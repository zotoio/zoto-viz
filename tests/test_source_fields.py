from __future__ import annotations

from service import source_fields


def test_project_apod_shape() -> None:
    data = [
        {"title": "Nebula", "explanation": "A cloud", "hdurl": "https://apod.nasa.gov/a.jpg", "url": "https://apod.nasa.gov/s.jpg", "media_type": "image"},
        {"title": "Talk", "explanation": "Audio", "url": "https://apod.nasa.gov/x.mp3", "media_type": "video"},
    ]
    items = source_fields.project_items(data, {
        "title": "title",
        "caption": "explanation",
        "image": "hdurl",
        "imageFallback": "url",
        "link": "url",
        "filter": "media_type=image",
    })
    assert len(items) == 1
    assert items[0]["title"] == "Nebula"
    assert items[0]["summary"] == "A cloud"
    assert items[0]["image"] == "https://apod.nasa.gov/a.jpg"


def test_project_guardian_nested_and_met_template() -> None:
    guardian = {
        "response": {
            "results": [{
                "webTitle": "Storm",
                "webUrl": "https://www.theguardian.com/world/storm",
                "fields": {"trailText": "Winds", "thumbnail": "https://media.guim.co.uk/a.jpg"},
            }],
        },
    }
    rows = source_fields.project_items(guardian, {
        "list": "response.results",
        "title": "webTitle",
        "caption": "fields.trailText",
        "image": "fields.thumbnail",
        "link": "webUrl",
    })
    assert rows[0]["title"] == "Storm"
    assert rows[0]["image"].startswith("https://")
    rec = {"id": 12, "image_id": "abc", "title": "Sunflowers"}
    item = source_fields.item_from_record(rec, {
        "title": "title",
        "imageTemplate": "https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg",
    })
    assert item is not None
    assert "abc" in item["image"]


def test_expand_ids_cap() -> None:
    ids = source_fields.expand_ids({"objectIDs": [1, 2, 3, 4, 5]}, {"list": "objectIDs", "expandCap": 3})
    assert ids == [1, 2, 3]
    assert source_fields.normalize_fields({"title": "webTitle", "expandCap": 99})["expandCap"] == source_fields.MAX_EXPAND
    many = source_fields.expand_ids({"objectIDs": list(range(80))}, {"list": "objectIDs", "expandCap": 40})
    assert many == list(range(40))


def test_project_botz_archive_byline_and_relative_image() -> None:
    data = {"editorials": [{
        "title": "Editorial take",
        "author": "Botz Desk",
        "published_at": "2026-11-03T01:00:00Z",
        "image_url": "/cache/images/abc.png",
        "entry": {"article": {
            "title": "Model ships", "url": "https://example.com/a", "source": "Example News",
            "author": "Jo Writer", "published_at": "2026-11-02T22:00:00Z",
        }},
    }]}
    items = source_fields.project_items(data, {
        "list": "editorials",
        "title": "entry.article.title",
        "caption": "title",
        "link": "entry.article.url",
        "imageTemplate": "https://botz.ai{image_url}",
        "author": "entry.article.author",
        "source": "entry.article.source",
        "published": "entry.article.published_at",
    })
    assert items == [{
        "title": "Model ships",
        "summary": "Editorial take",
        "link": "https://example.com/a",
        "published": "2026-11-02T22:00:00Z",
        "author": "Jo Writer",
        "source": "Example News",
        "image": "https://botz.ai/cache/images/abc.png",
    }]


def test_byline_fields_are_optional() -> None:
    items = source_fields.project_items([{"title": "T", "image": "https://x.test/a.png"}], {"author": "nope", "source": "nope"})
    assert "author" not in items[0] and "source" not in items[0]
