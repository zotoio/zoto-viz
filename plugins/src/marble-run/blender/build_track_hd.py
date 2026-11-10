"""Marble Run HD track (Blender 5.x, run in a VISIBLE window; quits when done).

  python3 plugins/src/marble-run/blender/fetch_hd_sources.py out/sources/04-marble
  python3 plugins/src/marble-run/blender/prep_hd_textures.py out/sources/04-marble
  blender --python plugins/src/marble-run/blender/build_track_hd.py -- \
      --out plugins/src/marble-run --src out/sources/04-marble [--gltfpack <bin>] [--keep-open]

Writes only assets/marble-track-hd.glb (marble-track.glb and frontend/track-data.ts are never
touched). The geometry is the Standard track's: build_track.py runs unchanged into <src>/std, and
its track-data.ts must match the shipped one byte for byte, so the marbles roll on the same path.
On top of that geometry the HD set adds:

  UVs        rails by arc length (brush streaks follow the rail); boxes and fittings by box
             projection with the grain or brush along the part's long axis.
  bevels     rounded edges on the base board, back panel, posts, stands and xylophone bars.
  materials  oiled walnut planks (base), oak veneer (posts, stands), smoked
             oak (back panel), brushed steel (rails, lift rod), brushed brass (ties, lift thread,
             funnel rim, bell), anodised bars, clearer teal acrylic. Maps are the tiling ones
             from prep_hd_textures.py; colours are glTF baseColorFactor on shared maps.

Node names match marble-track.glb (the host finds `xylo-bar-<k>` and `bell` by name). The GLB is
meshopt-packed with gltfpack (-cc -kn -km -ke), re-imported to check it, and
blender/build_track_hd_meta.json records bytes, sha256, triangles, node names, images and the
decoded texture budget.
"""
from __future__ import annotations

import bpy
import bmesh
import hashlib
import json
import math
import os
import struct
import subprocess
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name: str, default: str) -> str:
    return os.path.abspath(argv[argv.index(name) + 1]) if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out", os.path.abspath(os.path.join(HERE, "..")))
REPO = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SRC = arg("--src", os.path.join(REPO, "out", "sources", "04-marble"))
GLTFPACK = arg("--gltfpack", os.path.join(REPO, "out", "tools", "node_modules", ".bin", "gltfpack"))
QUIT = "--keep-open" not in argv
ASSETS = os.path.join(OUT, "assets")
BAKED = os.path.join(SRC, "baked")
STD = os.path.join(SRC, "std")
RAW = os.path.join(SRC, "raw")
PACK_FLAGS = ["-cc", "-kn", "-km", "-ke"]
# visualisation.yml workBudget.maxGpuBytes; the env PMREM is counted too (see prep_hd_textures.py)
MAX_GPU_BYTES = 8388608
ENV_PMREM_BYTES = 384 * 512 * 8


# ------------------------------------------------------------------ Standard geometry
def run_standard_build() -> dict:
    os.makedirs(os.path.join(STD, "frontend"), exist_ok=True)
    script = os.path.join(HERE, "build_track.py")
    saved = sys.argv
    sys.argv = [saved[0], "--", "--out", STD, "--no-render", "--keep-open"]
    ns: dict = {"__name__": "build_track", "__file__": script}
    try:
        exec(compile(open(script).read(), script, "exec"), ns)
    finally:
        sys.argv = saved
    shipped = open(os.path.join(OUT, "frontend", "track-data.ts"), "rb").read()
    rebuilt = open(os.path.join(STD, "frontend", "track-data.ts"), "rb").read()
    if shipped != rebuilt:
        raise SystemExit("build_track.py no longer reproduces frontend/track-data.ts; HD would drift off the path")
    print("track-data.ts reproduced byte for byte")
    return ns


def sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def gltfpack(raw: str, dest: str) -> None:
    subprocess.run([GLTFPACK, "-i", raw, "-o", dest, *PACK_FLAGS], check=True)
    print("packed", dest, os.path.getsize(dest))


# ------------------------------------------------------------------ materials
def image(name: str, non_color: bool = False) -> bpy.types.Image:
    img = bpy.data.images.load(os.path.join(BAKED, name), check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


# baseColorFactor / roughness / metallic overrides written into the glTF after export
FACTORS: dict[str, dict] = {}


def pbr(name: str, albedo: str | None, normal: str | None = None, mr: str | None = None, *,
        color=(1.0, 1.0, 1.0), rough: float = 0.5, metal: float = 0.0, metal_factor: float | None = None,
        coat: float = 0.0, coat_rough: float = 0.08, alpha: float = 1.0) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(p.outputs["BSDF"], out.inputs["Surface"])
    if albedo:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(albedo)
        nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    else:
        p.inputs["Base Color"].default_value = (*color, 1.0)
    if normal:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = image(normal, non_color=True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    if mr:
        tm = nt.nodes.new("ShaderNodeTexImage")
        tm.image = image(mr, non_color=True)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], p.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], p.inputs["Metallic"])
    else:
        p.inputs["Roughness"].default_value = rough
        p.inputs["Metallic"].default_value = metal
    if coat > 0:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = coat_rough
    if alpha < 1:
        p.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            m.blend_method = "BLEND"
    f: dict = {}
    if albedo:
        f["baseColorFactor"] = [round(c, 4) for c in (*color, alpha)]
    if metal_factor is not None:
        f["metallicFactor"] = metal_factor
    FACTORS[name] = f
    return m


def materials(ns: dict) -> dict[str, bpy.types.Material]:
    rgb = lambda c: tuple(c[:3])
    M = {
        "walnut": pbr("walnut-hd", "walnut_albedo.jpg", "walnut_normal.jpg", "walnut_mr.jpg"),
        "oak": pbr("oak-hd", "oak_albedo.jpg", rough=0.5),
        "panel": pbr("panel-hd", "oak_albedo.jpg", color=(0.34, 0.31, 0.28), rough=0.62),
        # a touch cooler than the Standard steel: the workshop light is warm and brass must still read as brass
        "steel": pbr("steel-hd", "metal_albedo.jpg", mr="metal_mr.jpg", color=(0.70, 0.75, 0.82)),
        "brass": pbr("brass-hd", "metal_albedo.jpg", mr="metal_mr.jpg", color=rgb(ns["BRASS"])),
        "acrylic": pbr("acrylic-teal-hd", None, color=rgb(ns["TEAL"]), rough=0.05, alpha=0.42),
    }
    for k, c in enumerate(ns["XYLO"]):
        M[f"xylo-{k}"] = pbr(f"xylo-{k}-hd", "metal_albedo.jpg", mr="metal_mr.jpg", color=rgb(c),
                             metal_factor=0.55, coat=0.6, coat_rough=0.05)
    return M


# ------------------------------------------------------------------ UVs and bevels
def box_uv(bm: bmesh.types.BMesh, scale: float, along: int | None = None, along_u: bool = False) -> None:
    """Per-face box projection. `along` (0/1/2 = x/y/z) is the grain or brush axis: it maps to v
    (wood photos run their grain up the image) or, with `along_u`, to u (brush streaks run across)."""
    uvl = bm.loops.layers.uv.verify()
    for face in bm.faces:
        n = face.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        if along is not None and along != ax:
            other = a if b == along else b
            u_ax, v_ax = (along, other) if along_u else (other, along)
        else:
            u_ax, v_ax = a, b
        # opposite faces get different offsets so a part never shows the same patch twice
        off = 0.37 * ax + (0.21 if n[ax] < 0 else 0.0)
        for loop in face.loops:
            co = loop.vert.co
            loop[uvl].uv = (co[u_ax] / scale + off, co[v_ax] / scale + off)


def bevel(bm: bmesh.types.BMesh, width: float) -> None:
    res = bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=width, offset_type="OFFSET",
                          segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    for f in bm.faces:
        f.smooth = False
    for f in res["faces"]:
        f.smooth = True


def edit(ob: bpy.types.Object, fn) -> None:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    fn(bm)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


RAIL_TILE = 0.30  # metres of rail per metal tile (brush along the rail)


def rail_uv(ob: bpy.types.Object, ns: dict) -> None:
    """Rails are swept rings of 6 (build_track.sweep) in run/side/ring order: u = arc length, v = ring."""
    PTS, TAGS, runs = ns["PTS"], ns["TAGS"], ns["runs"]
    sides = 6
    us: list[float] = []
    for run in runs(lambda i: TAGS[i] != "lift"):
        for _side in (-1, 1):
            s = 0.0
            for j, i in enumerate(run):
                if j:
                    s += (PTS[i] - PTS[run[j - 1]]).length
                us.extend([s / RAIL_TILE] * sides)
    me = ob.data
    if len(us) != len(me.vertices):
        raise SystemExit(f"rails: {len(me.vertices)} verts, expected {len(us)} (build_track sweep changed)")

    def fn(bm: bmesh.types.BMesh) -> None:
        uvl = bm.loops.layers.uv.verify()
        bm.verts.ensure_lookup_table()
        for face in bm.faces:
            ks = {lp.vert.index % sides for lp in face.loops}
            wrap = 0 in ks and sides - 1 in ks
            for lp in face.loops:
                k = lp.vert.index % sides
                if wrap and k == 0:
                    k = sides
                lp[uvl].uv = (us[lp.vert.index], 0.1 * k / sides)

    edit(ob, fn)


def dress(ns: dict) -> dict[str, int]:
    M = materials(ns)
    plan = {
        # name: (material, bevel width or 0, box scale, grain/brush axis, brush along u)
        "base": ("walnut", 0.004, 0.75, 0, False),
        "pegboard": ("panel", 0.003, 0.9, 2, False),
        "posts": ("oak", 0.0015, 0.45, 2, False),
        "stands": ("oak", 0.002, 0.45, 2, False),
        "ties": ("brass", 0, 0.3, None, True),
        "lift-rod": ("steel", 0, 0.3, 2, True),
        "lift-thread": ("brass", 0, 0.3, None, True),
        "funnel-rim": ("brass", 0, 0.3, 2, False),
        "bell": ("brass", 0, 0.3, 2, False),
        "lift-tube": ("acrylic", 0, 0, None, False),
        "funnel": ("acrylic", 0, 0, None, False),
    }
    for k in range(8):
        plan[f"xylo-bar-{k}"] = (f"xylo-{k}", 0.0015, 0.3, 1, True)
    tri = {}
    for ob in [o for o in bpy.data.objects if o.type == "MESH"]:
        name = ob.name
        if name == "rails":
            rail_uv(ob, ns)
            mat = M["steel"]
        elif name in plan:
            key, bw, scale, axis, along_u = plan[name]
            mat = M[key]

            def fn(bm, bw=bw, scale=scale, axis=axis, along_u=along_u):
                if bw > 0:
                    bevel(bm, bw)
                if scale > 0:
                    box_uv(bm, scale, axis, along_u)

            edit(ob, fn)
        else:
            raise SystemExit(f"unplanned track part {name!r}")
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        ob.data.calc_loop_triangles()
        tri[name] = len(ob.data.loop_triangles)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    return tri


# ------------------------------------------------------------------ export
def export_glb(path: str) -> None:
    kw = dict(
        filepath=path, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=False, export_skins=False,
        export_morph=False, export_image_format="AUTO", export_jpeg_quality=90,
    )
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="NONE")
    except TypeError as e:
        print("glTF exporter options fallback:", e)
        kw.pop("export_jpeg_quality")
        bpy.ops.export_scene.gltf(**kw, export_colors=False)
    print("raw", path, os.path.getsize(path))


def read_glb(path: str) -> tuple[dict, bytes]:
    data = open(path, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen
    blen = struct.unpack_from("<I", data, bin_off)[0]
    return doc, data[bin_off + 8: bin_off + 8 + blen]


def write_glb(path: str, doc: dict, blob: bytes) -> None:
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    blob += b"\0" * (-len(blob) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)


def patch_factors(path: str) -> None:
    doc, blob = read_glb(path)
    for m in doc.get("materials", []):
        f = FACTORS.get(m.get("name", ""))
        if not f:
            continue
        pmr = m.setdefault("pbrMetallicRoughness", {})
        for k, v in f.items():
            pmr[k] = v
    write_glb(path, doc, blob)


def image_dims(blob: bytes) -> tuple[int, int]:
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", blob[16:24])
    i = 2
    while i < len(blob):
        if blob[i] != 0xFF:
            i += 1
            continue
        marker = blob[i + 1]
        seg = struct.unpack(">H", blob[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", blob[i + 5:i + 9])
            return w, h
        i += 2 + seg
    raise ValueError("no SOF")


def gpu_bytes(path: str) -> tuple[int, list[dict]]:
    """Decoded texture bytes as three.js uploads them: RGBA8 plus a full mip chain (x4/3)."""
    doc, blob = read_glb(path)
    total = 0
    images = []
    for img in doc.get("images", []):
        bv = doc["bufferViews"][img["bufferView"]]
        raw = blob[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        w, h = image_dims(raw)
        b = (w * h * 4 * 4) // 3
        total += b
        images.append({"name": img.get("name", ""), "mime": img.get("mimeType"), "size": [w, h],
                       "bytes": bv["byteLength"], "gpuBytes": b})
    return total, images


def verify_packed(path: str) -> tuple[int, list[str]]:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=path)
    # gltfpack keeps each named node and hangs its (quantised) mesh on an unnamed child
    doc, _ = read_glb(path)
    names = sorted(n["name"] for n in doc["nodes"] if n.get("name"))
    tris = 0
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    return tris, names


def main() -> None:
    os.makedirs(RAW, exist_ok=True)
    ns = run_standard_build()
    std_raw = os.path.join(STD, "assets", "marble-track.glb")
    std_packed = os.path.join(RAW, "marble-track.repack.glb")
    gltfpack(std_raw, std_packed)
    # the shipped Standard GLB was packed by an older gltfpack: compare the glTF JSON, not bytes
    shipped, _ = read_glb(os.path.join(ASSETS, "marble-track.glb"))
    rebuilt, _ = read_glb(std_packed)
    shipped.pop("asset", None)
    rebuilt.pop("asset", None)
    std_match = shipped == rebuilt
    print("standard rebuild has the shipped marble-track.glb glTF structure:", std_match)

    tri = dress(ns)
    raw = os.path.join(RAW, "marble-track-hd.raw.glb")
    export_glb(raw)
    patch_factors(raw)
    dest = os.path.join(ASSETS, "marble-track-hd.glb")
    gltfpack(raw, dest)
    tex_bytes, images = gpu_bytes(dest)
    imported_tris, names = verify_packed(dest)
    doc, _ = read_glb(dest)
    # plugin.yml triangles = index-buffer triangles (Blender's importer drops a few degenerate ones)
    index_tris = sum(doc["accessors"][p["indices"]]["count"] // 3 for m in doc["meshes"] for p in m["primitives"])
    budget = tex_bytes + ENV_PMREM_BYTES
    meta = {
        "asset": "assets/marble-track-hd.glb",
        "bytes": os.path.getsize(dest),
        "sha256": sha(dest),
        "triangles": index_tris,
        "importedTriangles": imported_tris,
        "trianglesByPart": dict(sorted(tri.items())),
        "nodes": names,
        "images": images,
        "textureGpuBytes": tex_bytes,
        "envPmremGpuBytes": ENV_PMREM_BYTES,
        "gpuBytesTotal": budget,
        "maxGpuBytes": MAX_GPU_BYTES,
        "gltfpack": ["gltfpack", *PACK_FLAGS],
        "standardRebuildMatchesShippedJson": std_match,
        "trackDataReproduced": True,
    }
    with open(os.path.join(HERE, "build_track_hd_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
    print(json.dumps({k: meta[k] for k in ("bytes", "sha256", "triangles", "textureGpuBytes", "gpuBytesTotal")}))
    if budget > MAX_GPU_BYTES:
        raise SystemExit(f"HD texture budget {budget} > maxGpuBytes {MAX_GPU_BYTES}")
    for part in ("rails", "lift-thread", "funnel", "bell", "xylo-bar-0", "xylo-bar-7", "base"):
        if part not in names:
            raise SystemExit(f"packed HD GLB lost node {part!r}")


try:
    main()
    print("build_track_hd: done")
except BaseException as e:  # keep the visible window's log useful, then still quit
    import traceback
    traceback.print_exc()
    print("build_track_hd: FAILED", e)
if QUIT:
    bpy.ops.wm.quit_blender()
