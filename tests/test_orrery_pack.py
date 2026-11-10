"""Shipped Orrery pack: pack-local vitest and GLB asset integrity."""
from __future__ import annotations

import hashlib
import json
import struct
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "orrery"
PACK_TEST = SRC / "frontend" / "orrery.test.ts"
MAX_GLB_BYTES = 800 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
GEAR_NODES = {"gear-crown", "gear-2", "gear-3", "escape-wheel", "anchor", "balance", "sun"}
ARM_NODES = {"arm-hub", "arm-bar", "arm-post", "arm-cup"}
PLANET_NODES = {f"planet-{k}" for k in range(7)} | {"planet-6-ring"}


def _ensure_web_vitest() -> None:
    web = ROOT / "web"
    if (web / "node_modules" / ".bin" / "vitest").is_file():
        return
    proc = subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=web, capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def _glb_json(path: Path) -> dict:
    raw = path.read_bytes()
    magic, version, _length = struct.unpack("<III", raw[:12])
    assert magic == 0x46546C67 and version == 2, path
    chunk_len, chunk_type = struct.unpack("<II", raw[12:20])
    assert chunk_type == 0x4E4F534A, path
    return json.loads(raw[20:20 + chunk_len])


def _assets() -> list[dict]:
    doc = yaml.safe_load((SRC / "plugin.yml").read_text(encoding="utf-8"))
    return doc["assets"]


def test_orrery_pack_vitest() -> None:
    assert PACK_TEST.is_file()
    _ensure_web_vitest()
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(SRC / "vitest.config.cjs")],
        cwd=ROOT / "web",
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_orrery_assets_match_manifest_and_budget() -> None:
    rows = _assets()
    ids = [r["id"] for r in rows]
    assert ids == [
        "orrery-study", "orrery-machine", "orrery-planets",
        "orrery-study-hd", "orrery-machine-hd", "orrery-planets-hd",
    ]
    total = 0
    for row in rows:
        path = SRC / row["path"]
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == row["sha256"], row["id"]
        assert len(data) == row["bytes"], row["id"]
        assert len(data) <= MAX_GLB_BYTES, row["id"]
        assert 0 < row["triangles"] <= 120_000, row["id"]
        total += len(data)
    assert total <= MAX_TOTAL_BYTES


def test_orrery_glbs_are_meshopt_with_named_nodes() -> None:
    want = {"orrery-study": {"desk-top", "blotter", "plinth", "contact-shadow", "lamp-shade"},
            "orrery-machine": GEAR_NODES | ARM_NODES, "orrery-planets": PLANET_NODES}
    for row in _assets():
        doc = _glb_json(SRC / row["path"])
        used = set(doc.get("extensionsUsed", []))
        assert "EXT_meshopt_compression" in used, row["id"]
        assert not used & {"KHR_texture_basisu", "KHR_draco_mesh_compression"}, row["id"]
        names = {n.get("name") for n in doc.get("nodes", [])}
        base = row["id"].removesuffix("-hd")
        assert want[base] <= names, (row["id"], want[base] - names)
        assert doc.get("images"), row["id"]
        for im in doc["images"]:
            assert im.get("mimeType") in ("image/jpeg", "image/png"), row["id"]
        if row["id"] == "orrery-machine-hd":
            assert "env-probe" in names
        if row["id"] == "orrery-machine":
            assert "env-probe" not in names


def test_orrery_hd_is_the_richer_set() -> None:
    rows = {r["id"]: r for r in _assets()}
    for base in ("orrery-study", "orrery-machine", "orrery-planets"):
        assert rows[f"{base}-hd"]["triangles"] > rows[base]["triangles"], base
        std = _glb_json(SRC / rows[base]["path"])
        hd = _glb_json(SRC / rows[f"{base}-hd"]["path"])
        if base != "orrery-planets":
            assert any("normalTexture" in m for m in hd["materials"]), base
            assert not any("normalTexture" in m for m in std["materials"]), base


def test_orrery_assets_credited() -> None:
    text = (SRC / "ASSETS.md").read_text(encoding="utf-8")
    for source in ("black_walnut_veneer_02", "leather_red_02", "aerial_rocks_02", "marble_cliff_02",
                   "snow_field_aerial", "fireplace", "Metal048B", "Metal051A", "Onyx010", "Onyx013",
                   "Marble012", "Travertine009"):
        assert source in text, source
    assert "CC0" in text
