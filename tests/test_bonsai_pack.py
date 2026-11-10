"""Shipped Bonsai pack: pack-local vitest and GLB asset integrity."""
from __future__ import annotations

import hashlib
import json
import struct
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "bonsai"
PACK_TEST = SRC / "frontend" / "bonsai.test.ts"
MAX_GLB_BYTES = 800 * 1024
MAX_ENV_BYTES = 400 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
MAX_GPU_BYTES = 8 * 1024 * 1024
BASE_NODES = {"bench", "board", "rock", "moss", "contact-shadow"}
TREE_NODES = {"trunk", "foliage", "blossom-card", "falling-leaf"}
MAX_PADS = 16


def _ensure_web_vitest() -> None:
    web = ROOT / "web"
    if (web / "node_modules" / ".bin" / "vitest").is_file():
        return
    proc = subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=web, capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def _glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    magic, version, _length = struct.unpack("<III", raw[:12])
    assert magic == 0x46546C67 and version == 2, path
    chunk_len, chunk_type = struct.unpack("<II", raw[12:20])
    assert chunk_type == 0x4E4F534A, path
    doc = json.loads(raw[20:20 + chunk_len])
    o = 20 + chunk_len
    bin_len, bin_type = struct.unpack("<II", raw[o:o + 8])
    assert bin_type == 0x004E4942, path
    return doc, raw[o + 8:o + 8 + bin_len]


def _image_size(data: bytes) -> tuple[int, int]:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    i = 2
    while i < len(data):
        marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + length
    raise AssertionError("no image size")


def _gpu_bytes(doc: dict, bin_chunk: bytes) -> int:
    total = 0
    for im in doc.get("images", []):
        view = doc["bufferViews"][im["bufferView"]]
        start = view.get("byteOffset", 0)
        w, h = _image_size(bin_chunk[start:start + view["byteLength"]])
        total += w * h * 4 * 4 // 3
    return total


def _assets() -> list[dict]:
    doc = yaml.safe_load((SRC / "plugin.yml").read_text(encoding="utf-8"))
    return doc["assets"]


def test_bonsai_pack_vitest() -> None:
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


def test_bonsai_assets_match_manifest_and_budget() -> None:
    rows = _assets()
    ids = [r["id"] for r in rows]
    assert ids == ["bonsai-base", "bonsai-tree", "bonsai-base-hd", "bonsai-tree-hd", "env-hd"]
    total = 0
    for row in rows:
        data = (SRC / row["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == row["sha256"], row["id"]
        assert len(data) == row["bytes"], row["id"]
        total += len(data)
        if row.get("role") == "environment":
            assert row["path"].endswith(".jpg") and "triangles" not in row
            assert len(data) <= MAX_ENV_BYTES
            continue
        assert len(data) <= MAX_GLB_BYTES, row["id"]
        assert 0 < row["triangles"] <= 120_000, row["id"]
    assert total <= MAX_TOTAL_BYTES
    assert [r for r in rows if r.get("role") == "environment"] == [rows[-1]]


def test_bonsai_decoded_textures_fit_the_gpu_budget_in_both_sets() -> None:
    rows = {r["id"]: r for r in _assets()}
    env = (SRC / rows["env-hd"]["path"]).read_bytes()
    ew, eh = _image_size(env)
    for ids, extra in ((("bonsai-base", "bonsai-tree"), 0), (("bonsai-base-hd", "bonsai-tree-hd"), ew * eh * 4 * 4 // 3)):
        gpu = extra + sum(_gpu_bytes(*_glb(SRC / rows[i]["path"])) for i in ids)
        assert gpu <= MAX_GPU_BYTES, (ids, gpu)


def test_bonsai_glbs_are_meshopt_with_named_nodes() -> None:
    want = {"bonsai-base": BASE_NODES, "bonsai-tree": TREE_NODES}
    for row in _assets():
        if row.get("role") == "environment":
            continue
        doc, _ = _glb(SRC / row["path"])
        used = set(doc.get("extensionsUsed", []))
        assert "EXT_meshopt_compression" in used, row["id"]
        assert not used & {"KHR_texture_basisu", "KHR_draco_mesh_compression"}, row["id"]
        names = {n.get("name") for n in doc.get("nodes", [])}
        base = row["id"].removesuffix("-hd")
        assert want[base] <= names, (row["id"], want[base] - names)
        assert "env-probe" not in names, row["id"]
        assert doc.get("images"), row["id"]
        for im in doc["images"]:
            assert im.get("mimeType") in ("image/jpeg", "image/png"), row["id"]


def test_bonsai_foliage_carries_pad_and_rank_data() -> None:
    """Foliage COLOR_0 is data the host decodes: g = (pad + 0.5) / 16, b = rank."""
    for rid in ("bonsai-tree", "bonsai-tree-hd"):
        doc, _ = _glb(SRC / f"assets/{rid}.glb")
        node = next(n for n in doc["nodes"] if n.get("name") == "foliage")
        # gltfpack -kn may hang the mesh on a child that carries the dequantisation transform
        while "mesh" not in node:
            node = doc["nodes"][node["children"][0]]
        prim = doc["meshes"][node["mesh"]]["primitives"][0]
        assert "COLOR_0" in prim["attributes"], rid
        acc = doc["accessors"][prim["attributes"]["COLOR_0"]]
        assert acc["type"] in ("VEC3", "VEC4"), rid
        mat = doc["materials"][prim["material"]]
        assert mat.get("alphaMode") == "MASK", rid
        assert mat.get("doubleSided") is True, rid


def test_bonsai_hd_is_the_richer_set() -> None:
    rows = {r["id"]: r for r in _assets()}
    for base in ("bonsai-base", "bonsai-tree"):
        assert rows[f"{base}-hd"]["triangles"] > rows[base]["triangles"], base
        std, _ = _glb(SRC / rows[base]["path"])
        hd, _ = _glb(SRC / rows[f"{base}-hd"]["path"])
        assert any("normalTexture" in m for m in hd["materials"]), base
        assert not any("normalTexture" in m for m in std["materials"]), base


def test_bonsai_data_matches_the_pads() -> None:
    text = (SRC / "frontend" / "bonsai-data.ts").read_text(encoding="utf-8")
    data = json.loads(text.split("export const BONSAI = ", 1)[1].rsplit(" as const;", 1)[0])
    assert 6 <= len(data["pads"]) <= MAX_PADS
    g = data["ground"]
    assert len(g["h"]) == g["nx"] * g["nz"]
    assert max(g["h"]) > 0.04 and min(g["h"]) == data["board"]["bench"]


def test_bonsai_assets_credited() -> None:
    text = (SRC / "ASSETS.md").read_text(encoding="utf-8")
    for source in ("japanese_zelkova_bark", "periwinkle_plant", "namaqualand_boulder_05", "dark_wood",
                   "japanese_cedar_planks", "chinese_garden", "Moss002"):
        assert source in text, source
    assert "CC0" in text
