from __future__ import annotations

import pytest

from service.plugins import _check_plugin_settings, validate_doc


def test_presets_require_preset_field() -> None:
    doc = {
        "id": "bad-preset",
        "name": "Bad",
        "version": 1,
        "visualisation": {
            "engine": "graph",
            "settings": {
                "presets": [{"id": "a", "label": "A", "values": {"gain": 1}}],
            },
            "config": [{"key": "gain", "type": "number", "min": 0, "max": 10}],
        },
    }
    with pytest.raises(ValueError, match="presetField"):
        _check_plugin_settings(doc)


def test_random_range_requires_min_max() -> None:
    doc = {
        "id": "bad-range",
        "name": "Bad",
        "version": 1,
        "visualisation": {
            "engine": "graph",
            "settings": {
                "presetField": "preset",
                "presets": [{"id": "a", "label": "A", "values": {"gain": 1}}],
            },
            "config": [
                {"key": "preset", "type": "select", "values": [["a", "A"]]},
                {"key": "gain", "type": "number", "randomRange": [1, 5]},
            ],
        },
    }
    with pytest.raises(ValueError, match="min and max"):
        _check_plugin_settings(doc)


def test_random_range_only_on_numbers() -> None:
    doc = {
        "id": "bad-rr-text",
        "name": "Bad",
        "version": 1,
        "visualisation": {
            "engine": "graph",
            "config": [
                {"key": "label", "type": "text", "randomRange": [0, 1]},
            ],
        },
    }
    with pytest.raises(ValueError, match="number fields"):
        _check_plugin_settings(doc)


def test_top_level_settings_semantics_via_validate_doc() -> None:
    doc = {
        "id": "ok",
        "name": "Ok",
        "version": 1,
        "engine": "graph",
        "settings": {
            "presetField": "preset",
            "presets": [{"id": "a", "label": "A", "values": {"gain": 1}}],
        },
        "config": [
            {"key": "preset", "type": "select", "values": [["a", "A"]]},
            {"key": "gain", "type": "number", "min": 0, "max": 10, "randomRange": [1, 5]},
        ],
    }
    validate_doc(doc)
