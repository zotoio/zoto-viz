"""Shipped Aurora Fjord pack: pack-local vitest and GLB asset integrity."""
from __future__ import annotations

import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "aurora-fjord"
PACK_TEST = SRC / "frontend" / "fjord.test.ts"
MAX_GLB_BYTES = 800 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
MAX_ENV_BYTES = 400 * 1024
TERRAIN_NODES = {"terrain"}
SHORE_NODES = {"cabins", "pines", "boulders"} | {f"cabin-window-{k}" for k in range(8)}


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


def _glb_bin(path: Path) -> bytes:
    raw = path.read_bytes()
    json_len = struct.unpack("<I", raw[12:16])[0]
    off = 20 + json_len
    bin_len, bin_type = struct.unpack("<II", raw[off:off + 8])
    assert bin_type == 0x004E4942, path
    return raw[off + 8:off + 8 + bin_len]


def _image_size(data: bytes) -> tuple[int, int]:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    assert data[:2] == b"\xff\xd8", "not a JPEG or PNG"
    i = 2
    while i < len(data):
        marker = data[i + 1]
        seg = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + seg
    raise AssertionError("JPEG without a frame header")


def _gpu_bytes(row: dict) -> int:
    """Decoded GPU memory of one asset row. GLB: RGBA8 with mips per image. Environment image: the
    host keeps only three's PMREM (cube = 2^floor(log2(width / 4)), one 3*max(cube, 112) x 4*cube
    half-float RGBA target) and frees the equirect once it is built."""
    path = SRC / row["path"]
    if row.get("role") == "environment":
        width = _image_size(path.read_bytes())[0]
        cube = 2 ** math.floor(math.log2(width / 4))
        return 3 * max(cube, 112) * 4 * cube * 8
    doc, blob = _glb_json(path), _glb_bin(path)
    total = 0
    for im in doc.get("images", []):
        view = doc["bufferViews"][im["bufferView"]]
        start = view.get("byteOffset", 0)
        w, h = _image_size(blob[start:start + view["byteLength"]])
        total += w * h * 4 * 4 // 3
    return total


def _assets() -> list[dict]:
    doc = yaml.safe_load((SRC / "plugin.yml").read_text(encoding="utf-8"))
    return doc["assets"]


def _meshes() -> list[dict]:
    return [r for r in _assets() if r.get("role", "mesh") == "mesh"]


def test_aurora_fjord_pack_vitest() -> None:
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


def test_aurora_fjord_assets_match_manifest_and_budget() -> None:
    rows = _assets()
    assert [r["id"] for r in rows] == ["fjord-terrain", "fjord-shore", "fjord-terrain-hd", "fjord-shore-hd", "env-hd"]
    total = 0
    for row in rows:
        path = SRC / row["path"]
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == row["sha256"], row["id"]
        assert len(data) == row["bytes"], row["id"]
        if row.get("role") == "environment":
            assert path.suffix == ".jpg" and "triangles" not in row
            assert len(data) <= MAX_ENV_BYTES
        else:
            assert len(data) <= MAX_GLB_BYTES, row["id"]
            assert 0 < row["triangles"] <= 120_000, row["id"]
        total += len(data)
    assert total <= MAX_TOTAL_BYTES


def test_aurora_fjord_model_sets_fit_the_budgets() -> None:
    vis = yaml.safe_load((SRC / "visualisation.yml").read_text(encoding="utf-8"))
    budget = vis["workBudget"]
    gpu = {"standard": 0, "hd": 0}
    tris = {"standard": 0, "hd": 0}
    for row in _assets():
        s = "hd" if row["id"].endswith("-hd") else "standard"
        gpu[s] += _gpu_bytes(row)
        tris[s] += row.get("triangles", 0)
    for name in gpu:
        assert 0 < gpu[name] <= budget["maxGpuBytes"], (name, gpu[name])
        # the host scenery draws every lane mesh twice (the land and its reflection)
        assert 2 * tris[name] <= budget["maxTriangles"], (name, tris[name])


def test_aurora_fjord_glbs_are_meshopt_with_named_nodes() -> None:
    want = {"fjord-terrain": TERRAIN_NODES, "fjord-shore": SHORE_NODES}
    for row in _meshes():
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
        windows = [m for m in doc["materials"] if m.get("name", "").startswith("window-")]
        if base == "fjord-shore":
            # one emissive material per cabin, so the scenery can light each window on its own
            assert len(windows) == 8 and all(m.get("emissiveFactor") for m in windows), row["id"]


def test_aurora_fjord_hd_is_the_richer_set() -> None:
    rows = {r["id"]: r for r in _assets()}
    for base in ("fjord-terrain", "fjord-shore"):
        assert rows[f"{base}-hd"]["triangles"] > rows[base]["triangles"], base
        std = _glb_json(SRC / rows[base]["path"])
        hd = _glb_json(SRC / rows[f"{base}-hd"]["path"])
        assert any("normalTexture" in m for m in hd["materials"]), base
        assert not any("normalTexture" in m for m in std["materials"]), base
        assert len(hd.get("images", [])) > len(std.get("images", [])), base


def test_aurora_fjord_frontend_layout_matches_the_build() -> None:
    meta = json.loads((SRC / "blender" / "build_fjord_meta.json").read_text(encoding="utf-8"))
    rows = {r["id"]: r for r in _assets()}
    for s in ("standard", "hd"):
        for r in meta["sets"][s]:
            assert rows[r["id"]]["sha256"] == r["sha256"], r["id"]
            assert r["integrity"] == {"degenerate": 0, "loose": 0, "nonmanifold": 0}, r["id"]
    data = (SRC / "frontend" / "fjord-data.ts").read_text(encoding="utf-8")
    assert data.count('"shore":') == 8


def test_aurora_fjord_kp_fixture_is_recorded_not_fetched() -> None:
    doc = json.loads((SRC / "frontend" / "fixtures" / "noaa-kp-headlines.json").read_text(encoding="utf-8"))
    heads = doc["headlines"]
    assert len(heads) == 8
    assert heads[0]["id"] == "noaa-kp:0" and heads[0]["text"].startswith("Kp ")
    for path in (SRC / "frontend").glob("*.ts"):
        text = path.read_text(encoding="utf-8")
        assert "fetch(" not in text and "XMLHttpRequest" not in text, path.name


def test_aurora_fjord_assets_credited() -> None:
    text = (SRC / "ASSETS.md").read_text(encoding="utf-8")
    for source in ("aerial_rocks_02", "snow_field_aerial", "forest_ground_04", "river_small_rocks",
                   "weathered_plank_siding", "roof_slates_02", "fir_sapling", "rock_moss_set_02",
                   "lakeside_night", "NOAA"):
        assert source in text, source
    assert "CC0" in text
