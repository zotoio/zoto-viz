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


def test_validate_doc_allows_settings_without_config_on_plugin_yml() -> None:
    doc = {
        "id": "split-yml",
        "name": "Split",
        "version": 1,
        "settings": {
            "presetField": "preset",
            "presets": [{"id": "a", "label": "A", "values": {"gain": 1}}],
        },
    }
    validate_doc(doc)


def test_rejects_custom_preset_id() -> None:
    doc = {
        "id": "bad-custom",
        "name": "Bad",
        "version": 1,
        "engine": "graph",
        "settings": {"presetField": "preset", "presets": [{"id": "custom", "label": "X", "values": {}}]},
        "config": [{"key": "preset", "type": "select", "values": [["custom", "c"]]}],
    }
    with pytest.raises(ValueError, match="custom"):
        _check_plugin_settings(doc)


def test_rejects_unknown_hud_label_field() -> None:
    doc = {
        "id": "bad-hud",
        "name": "Bad",
        "version": 1,
        "engine": "graph",
        "settings": {"hud": {"labelFields": ["missing"]}},
        "config": [{"key": "gain", "type": "number", "min": 0, "max": 1}],
    }
    with pytest.raises(ValueError, match="labelFields"):
        _check_plugin_settings(doc)


def test_rejects_unknown_preset_value_key() -> None:
    doc = {
        "id": "bad-preset-key",
        "name": "Bad",
        "version": 1,
        "engine": "graph",
        "settings": {
            "presetField": "preset",
            "presets": [{"id": "a", "label": "A", "values": {"nope": 1}}],
        },
        "config": [{"key": "preset", "values": [["a", "A"]]}, {"key": "gain", "type": "number", "min": 0, "max": 1}],
    }
    with pytest.raises(ValueError, match="nope"):
        _check_plugin_settings(doc)


def test_map_form_config_in_semantics() -> None:
    doc = {
        "id": "map-config",
        "name": "Map",
        "version": 1,
        "engine": "graph",
        "config": {
            "gain": {"type": "number", "min": 0, "max": 10, "default": 1},
        },
    }
    validate_doc(doc)
