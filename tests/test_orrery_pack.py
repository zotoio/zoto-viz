"""Shipped Orrery pack: pack-local vitest and GLB asset integrity."""
from __future__ import annotations

import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "orrery"
PACK_TEST = SRC / "frontend" / "orrery.test.ts"
MAX_GLB_BYTES = 800 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
MAX_ENV_BYTES = 400 * 1024
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
        "orrery-study-hd", "orrery-machine-hd", "orrery-planets-hd", "env-hd",
    ]
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


def test_orrery_model_sets_fit_the_gpu_budget() -> None:
    vis = yaml.safe_load((SRC / "visualisation.yml").read_text(encoding="utf-8"))
    cap = vis["workBudget"]["maxGpuBytes"]
    sets = {"standard": 0, "hd": 0}
    for row in _assets():
        sets["hd" if row["id"].endswith("-hd") else "standard"] += _gpu_bytes(row)
    for name, total in sets.items():
        assert 0 < total <= cap, (name, total, cap)


def test_orrery_glbs_are_meshopt_with_named_nodes() -> None:
    want = {"orrery-study": {"desk-top", "blotter", "plinth", "contact-shadow", "lamp-shade"},
            "orrery-machine": GEAR_NODES | ARM_NODES, "orrery-planets": PLANET_NODES}
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
