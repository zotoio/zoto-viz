"""Aurora Fjord generator (Blender 5.x, run with the GUI visible).

  .venv/bin/python plugins/src/aurora-fjord/blender/fetch_sources.py   # CC0 sources -> out/sources/aurora-fjord/prep
  blender --factory-startup --python plugins/src/aurora-fjord/blender/build_fjord.py -- --out plugins/src/aurora-fjord

Builds a night fjord per model set (Standard and HD) in glTF Y-up metres, water level y = 0, the
fjord running away from the camera toward -z:
  assets/fjord-terrain[-hd].glb  valley walls, cabin shelves and the peaks at the fjord head as one
                                 heightfield cut at the waterline. HD: rock / snow / forest-floor /
                                 shore-gravel scans picked per face by height and slope. Standard:
                                 tints sampled from the same photos over one neutral rock detail map.
  assets/fjord-shore[-hd].glb    cabins (plank siding, slate roofs, trim from one photo atlas, 256 px
                                 Standard / 512 px HD), cabin-window-0..7 (one emissive material
                                 each, nearest cabin first), pines, mossy boulders
  assets/env-hd.jpg              HD only: the lakeside_night HDRI as the `role: environment` image
HD pines are crossed cards of Poly Haven's fir_sapling scan, rendered here in Cycles (its needles
are geometry, so there is no card in the download); Standard pines are two-tier cones tinted from
that render. Boulders are the rock_moss_set_02 scans, decimated. Exports go through gltfpack
(-cc -kn -km, plus -vp 16 for the shore); writes blender/build_fjord_meta.json and
frontend/fjord-data.ts. Deterministic.
"""
import bpy, bmesh, math, json, os, sys, subprocess, hashlib, struct
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.getcwd()
SETS = [argv[argv.index("--set") + 1]] if "--set" in argv else ["standard", "hd"]
RENDER = "--no-render" not in argv
QUIT = "--keep-open" not in argv
ROOT = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SRC = os.path.join(ROOT, "out", "sources", "aurora-fjord")
RAW, PREP, BUILD = (os.path.join(SRC, d) for d in ("raw", "prep", "build"))
SHOTS = os.path.join(ROOT, "out", "shots", "08-plugin-aurora-fjord")
GLTFPACK = os.environ.get("GLTFPACK") or os.path.join(ROOT, "out", "tools", "node_modules", ".bin", "gltfpack")
VENV_PY = os.path.join(ROOT, ".venv", "bin", "python")
FIR_GLTF = os.path.join(RAW, "fir_sapling", "fir_sapling_1k.gltf")
ROCK_GLTF = os.path.join(RAW, "rock_moss_set_02", "rock_moss_set_02_1k.gltf")

# ---------------------------------------------------------------- layout (glTF x, z; Blender Y = -z)
CAM_Z = 40.0
X0, X1, Z0, Z1 = -560.0, 560.0, 160.0, -1500.0
CAMERA = {"eye": (8.0, 14.0, CAM_Z), "aim": (0.0, 92.0, -800.0), "fovDeg": 34.0}
TERRAIN_GRID = {"standard": (150, 170), "hd": (300, 340)}
TERRAIN_TRIS = {"standard": 11000, "hd": 32000}
PINES = {"standard": 380, "hd": 700}
BOULDER_TRIS = {"standard": 160, "hd": 560}
# The shore spans the fjord (cabins to the head, ~1.25 km), so gltfpack's default 14-bit positions
# step ~7.5 cm and fold the 5 cm roof trim and the boulder scans; 16 bits step ~2 cm.
SHORE_VP = 16
SHORE_EXTENT = 1250.0
# (side +1 right / -1 left, fjord fraction t, distance from the shore in m)
CABIN_SITES = [(1, 0.29, 14), (1, 0.33, 26), (1, 0.37, 12), (1, 0.41, 22),
               (1, 0.46, 13), (1, 0.52, 24), (-1, 0.62, 14), (-1, 0.67, 20)]
CABIN_TINTS = [(1.0, 0.34, 0.24), (1.0, 0.78, 0.42), (1.0, 1.0, 1.0), (1.0, 0.34, 0.24),
               (0.62, 0.62, 0.66), (1.0, 0.78, 0.42), (1.0, 0.34, 0.24), (1.0, 1.0, 1.0)]
WINDOW_GLOW = (1.0, 0.62, 0.30)
# each card cell is one dense spruce crown: the three fir_sapling scans turned (deg) and scaled about
# one trunk, squashed sideways toward a Nordic spruce silhouette
CARD_CELLS = [[("fir_sapling_a", 0.0, 1.0), ("fir_sapling_b", 120.0, 1.2), ("fir_sapling_c", 240.0, 1.45)],
              [("fir_sapling_a", 90.0, 1.0), ("fir_sapling_c", 200.0, 1.5), ("fir_sapling_b", 300.0, 1.25)]]
CARD_SQUASH = 0.8
TILE = {"rock": 28.0, "snow": 40.0, "forest": 14.0, "shore": 8.0, "detail": 22.0}
DETAIL_MEAN = 0.51   # linear mean of the neutral detail map (sRGB 190)


def gl(v):  # Blender Z-up -> glTF Y-up
    return [round(float(v[0]), 3) + 0.0, round(float(v[2]), 3) + 0.0, round(-float(v[1]), 3) + 0.0]


def lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------- noise and the heightfield
def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _hash(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)).astype(np.float64) / 4294967295.0


def vnoise(x, y, seed):
    x = np.asarray(x, float); y = np.asarray(y, float)
    fx, fy = np.floor(x), np.floor(y)
    ix, iy = fx.astype(np.int64), fy.astype(np.int64)
    ux, uy = x - fx, y - fy
    ux, uy = ux * ux * (3 - 2 * ux), uy * uy * (3 - 2 * uy)
    a, b = _hash(ix, iy, seed), _hash(ix + 1, iy, seed)
    c, d = _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm(x, y, octaves, seed, ridge=False):
    s = norm = 0.0
    amp, f = 0.5, 1.0
    for i in range(octaves):
        n = vnoise(np.asarray(x) * f + i * 17.31, np.asarray(y) * f - i * 9.17, seed * 31 + i)
        if ridge:
            n = (1.0 - np.abs(2.0 * n - 1.0)) ** 2
        s = s + amp * n
        norm += amp
        amp *= 0.5
        f *= 2.03
    return s / norm


def t_of(z):
    return (CAM_Z - np.asarray(z, float)) / 1000.0


def centre_x(z):
    t = np.clip(t_of(z), 0.0, None)
    return -55.0 * t * t


def half_w(z):
    return 165.0 + 105.0 * np.sin(np.clip(t_of(z), 0.0, 1.0) * math.pi * 0.8)


def shore_d(x, z):
    """Signed distance from the shoreline in metres (negative = water)."""
    x = np.asarray(x, float); z = np.asarray(z, float)
    xc = centre_x(z)
    n = fbm(x / 150, z / 150, 4, 1) - 0.5
    d = np.abs(x - xc) - half_w(z) + 24.0 * n
    head = (t_of(z) - 1.15) * 800.0 + 0.0035 * (x - xc) ** 2 + 40.0 * n  # rounded, ragged fjord head
    return np.maximum(d, head)


def shelf_w(x, z):
    t = t_of(z)
    right = np.asarray(x, float) > centre_x(z)
    m_r = right * smoothstep(0.22, 0.27, t) * (1 - smoothstep(0.54, 0.59, t))
    m_l = (~right) * smoothstep(0.57, 0.61, t) * (1 - smoothstep(0.70, 0.74, t))
    return np.maximum(46.0 * m_r, 32.0 * m_l)


def field(x, z):
    x = np.asarray(x, float); z = np.asarray(z, float)
    t = t_of(z)
    d = shore_d(x, z)
    dp = np.maximum(d, 0.0)
    shelf = shelf_w(x, z)
    dw = np.maximum(dp - shelf, 0.0)
    hs = (95.0 + 30.0 * smoothstep(40, -40, x - centre_x(z))) * (0.72 + 0.56 * fbm(x / 420, z / 420, 3, 2))
    head = (1.0 + 0.45 * smoothstep(0.05, 0.8, t)) * (1.0 + 0.35 * smoothstep(0.95, 1.35, t))
    wall = hs * head * (1.0 - np.exp(-dw / 95.0)) ** 1.35
    crag = 30.0 * fbm(x / 80, z / 80, 4, 3, ridge=True) * smoothstep(0, 50, dw)
    peaks = 95.0 * fbm(x / 320, z / 320, 3, 4, ridge=True) * smoothstep(120, 380, dw + 300 * smoothstep(1.0, 1.25, t))
    peaks = peaks * smoothstep(0, 40, dp)
    beach = 1.5 * smoothstep(0, 7, dp)
    terrace = 0.06 * np.minimum(dp, shelf) + 0.9 * (fbm(x / 14, z / 14, 2, 5) - 0.5) * smoothstep(0, 6, dp) * (shelf > 0)
    h = beach + terrace + wall + crag + peaks
    return np.where(d < 0, np.maximum(d * 0.45, -9.0), h)


def slope(x, z, e=1.5):
    gx = (field(x + e, z) - field(x - e, z)) / (2 * e)
    gz = (field(x, z + e) - field(x, z - e)) / (2 * e)
    return np.sqrt(gx * gx + gz * gz)


def shore_x(z, side, dist):
    """x where the shore distance first reaches `dist` walking out from the fjord centre."""
    xc = float(centre_x(z))
    xs = xc + side * np.arange(0.0, 600.0, 0.5)
    d = shore_d(xs, np.full_like(xs, z))
    return float(xs[int(np.argmax(d >= dist))])


def terrain_weights(x, z, h, s):
    n1 = fbm(x / 60, z / 60, 3, 6)
    n2 = fbm(x / 90, z / 90, 3, 7)
    shore = 1.0 - smoothstep(1.2, 3.0, h)
    snow = smoothstep(95, 150, h + 40 * (n1 - 0.5)) * (1 - smoothstep(1.0, 1.6, s))
    forest = (1 - smoothstep(0.55, 0.85, s)) * (1 - smoothstep(60, 100, h + 30 * (n2 - 0.5))) * (1 - shore)
    rock = 0.35 + smoothstep(0.6, 1.2, s)
    w = np.stack([rock, snow * 1.6, forest * 1.3, shore * 2.0], axis=1)
    return w / w.sum(axis=1, keepdims=True)


# ---------------------------------------------------------------- materials
IMG = {}
def img(set_name, name, data=False):
    path = os.path.join(PREP, set_name, name)
    if not os.path.isfile(path):
        path = os.path.join(BUILD, name)
    if path not in IMG:
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = "Non-Color" if data else "sRGB"
        IMG[path] = im
    return IMG[path]


def mat(name, set_name=None, diff=None, nrm=None, rough=0.85, vcol=False, clip=False, emit=None,
        base=(0.8, 0.8, 0.8), nrm_strength=1.0, cull=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = cull
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = rough
    b.inputs["Base Color"].default_value = (*base, 1.0)
    col = None
    if diff:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(set_name, diff)
        col = t.outputs["Color"]
        if clip:
            r = nt.nodes.new("ShaderNodeMath"); r.operation = "ROUND"
            nt.links.new(t.outputs["Alpha"], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs["Alpha"])
    if vcol:
        va = nt.nodes.new("ShaderNodeVertexColor"); va.layer_name = "Color"
        if col is None:
            col = va.outputs["Color"]
        else:
            mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
            mx.inputs["Factor"].default_value = 1.0
            nt.links.new(col, mx.inputs[6]); nt.links.new(va.outputs["Color"], mx.inputs[7])
            col = mx.outputs[2]
    if col is not None:
        nt.links.new(col, b.inputs["Base Color"])
    if nrm:
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img(set_name, nrm, data=True)
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = nrm_strength
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


# ---------------------------------------------------------------- mesh helpers
COLL = {}
def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    COLL[name] = c
    return c


def mesh_obj(name, verts, faces, coll, mats, mat_idx=None, uvs=None, colors=None, normals=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    for m in mats:
        me.materials.append(m)
    if mat_idx is not None:
        me.polygons.foreach_set("material_index", np.asarray(mat_idx, np.int32))
    if uvs is not None:  # per loop, in face order
        me.uv_layers.new(name="UVMap").data.foreach_set("uv", np.asarray(uvs, np.float32).ravel())
    if colors is not None:  # per vertex, linear RGB
        ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
        rgba = np.concatenate([np.asarray(colors, np.float32), np.ones((len(verts), 1), np.float32)], axis=1)
        ca.data.foreach_set("color", rgba.ravel())
        me.color_attributes.active_color = ca
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), smooth, bool))
    me.validate()
    if normals is None:
        bm = bmesh.new(); bm.from_mesh(me)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
            bm.to_mesh(me)
        bm.free()
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


class Builder:
    """Accumulates world-space quads/tris with per-loop UVs, per-vertex colours and a material index."""
    def __init__(self):
        self.v, self.f, self.uv, self.col, self.mi = [], [], [], [], []

    def face(self, pts, uvs, color, mi=0):
        base = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.col += [tuple(color)] * len(pts)
        self.f.append(tuple(range(base, base + len(pts))))
        self.uv += [tuple(u) for u in uvs]
        self.mi.append(mi)

    def obj(self, name, coll, mats, smooth=False):
        return mesh_obj(name, self.v, self.f, coll, mats, self.mi, self.uv, self.col, smooth=smooth)


def counts(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def decimated(ob, target):
    tris = counts(ob)
    if tris <= target:
        return ob
    md = ob.modifiers.new("dec", "DECIMATE")
    md.ratio = target / tris
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.remove(md)
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


# ---------------------------------------------------------------- fir card (Cycles render of the scan)
def fir_card():
    png, meta_path = os.path.join(BUILD, "fir-card.png"), os.path.join(BUILD, "fir-card.json")
    if os.path.isfile(png) and os.path.isfile(meta_path) and "--rebuild-card" not in argv:
        return json.load(open(meta_path))
    os.makedirs(BUILD, exist_ok=True)
    sc = bpy.context.scene  # still empty: main() cleared it and nothing else is built yet
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=FIR_GLTF)
    mine = [o for o in bpy.data.objects if o not in before]
    for m in {s.material for o in mine if o.type == "MESH" for s in o.material_slots if s.material}:
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = b.inputs["Base Color"].links[0].from_node
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.samples = 8; ao.inputs["Distance"].default_value = 0.12
        mr = nt.nodes.new("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.42
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(ao.outputs["AO"], mr.inputs["Value"])
        nt.links.new(tex.outputs["Color"], mx.inputs[6]); nt.links.new(mr.outputs["Result"], mx.inputs[7])
        nt.links.new(mx.outputs[2], em.inputs["Color"]); nt.links.new(em.outputs[0], out.inputs["Surface"])
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = False
    sc.cycles.seed = 0
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 256, 512, 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.world = bpy.data.worlds.new("fir-card-world")
    cd = bpy.data.cameras.new("fir-card-cam"); cd.type = "ORTHO"; cd.sensor_fit = "VERTICAL"
    cam = bpy.data.objects.new("fir-card-cam", cd); sc.collection.objects.link(cam); sc.camera = cam
    roots = {o.name: o for o in mine if o.parent is None}
    cells, atlas = [], np.zeros((512, 512, 4), np.float32)
    for k, crown in enumerate(CARD_CELLS):
        for o in mine:
            o.hide_render = True
        pts = []
        for name, turn, s in crown:
            root = roots[name]
            root.location = (0.0, 0.0, 0.0)
            root.rotation_mode = "XYZ"
            root.rotation_euler = (0.0, 0.0, math.radians(turn))  # the importer already converts to Z-up
            root.scale = (s * CARD_SQUASH, s * CARD_SQUASH, s)
        bpy.context.view_layer.update()
        for name, _, _ in crown:
            root = roots[name]
            for o in [root] + list(root.children_recursive):
                o.hide_render = False
                if o.type == "MESH":
                    co = np.empty(len(o.data.vertices) * 3, np.float32); o.data.vertices.foreach_get("co", co)
                    co = co.reshape(-1, 3)
                    mw = np.array(o.matrix_world)
                    pts.append(co @ mw[:3, :3].T + mw[:3, 3])
        p = np.concatenate(pts)
        lo, hi = p.min(axis=0), p.max(axis=0)
        hs, ws = float(hi[2] - lo[2]), float(hi[0] - lo[0])
        scale = max(hs * 1.03 + 0.02, ws * 1.04 * 2.0)
        cd.ortho_scale = scale
        cx = (lo[0] + hi[0]) / 2
        cam.location = (cx, lo[1] - 5.0, lo[2] - 0.01 + scale / 2)
        cam.rotation_euler = (math.radians(90), 0.0, 0.0)
        cell_png = os.path.join(BUILD, f"fir-cell-{k}.png")
        sc.render.filepath = cell_png
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(cell_png)
        px = np.empty(256 * 512 * 4, np.float32); im.pixels.foreach_get(px)
        bpy.data.images.remove(im)
        atlas[:, k * 256:(k + 1) * 256] = px.reshape(512, 256, 4)
        cells.append({"cell": k, "heightFrac": round(hs / scale, 4), "baseFrac": round(0.01 / scale, 4),
                      "trunkU": round(float((0.0 - cx + scale * 0.25) / (scale * 0.5)), 4)})
    rgb, a = atlas[..., :3], np.clip(atlas[..., 3] * 1.6, 0.0, 1.0)
    solid = a > 0.5
    mean = (rgb[solid].mean(axis=0) if solid.any() else np.array([0.2, 0.25, 0.15])).tolist()
    filled = a > 0.02
    for _ in range(24):  # bleed colour outward so mip levels do not pull in black fringes
        acc = np.zeros_like(rgb); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(np.roll(rgb * filled[..., None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(filled.astype(np.float32), dy, 0), dx, 1)
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    rgb[~filled] = mean
    out = np.concatenate([rgb, a[..., None]], axis=2)
    card = bpy.data.images.new("fir-card", 512, 512, alpha=True)
    card.pixels.foreach_set(out.ravel())
    card.filepath_raw = png
    card.file_format = "PNG"
    card.save()
    bpy.data.images.remove(card)
    if os.path.isfile(VENV_PY):  # palette PNG with alpha: a third of the bytes, same look at 512 px
        subprocess.run([VENV_PY, "-c", "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');"
                        "im.quantize(256,method=Image.Quantize.FASTOCTREE).save(sys.argv[1],optimize=True)", png], check=True)
    meta = {"cells": cells, "mean": [round(float(c), 4) for c in mean], "aspect": 0.5}
    json.dump(meta, open(meta_path, "w"), indent=1, sort_keys=True)
    for o in mine + [cam]:
        me = o.data if o.type == "MESH" else None
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.data.cameras.remove(cd)
    sc.camera = None
    return meta


# ---------------------------------------------------------------- terrain
def build_terrain(s, tints):
    hd = s == "hd"
    coll = collection(f"fjord-terrain-{s}")
    nx, nz = TERRAIN_GRID[s]
    xs = np.linspace(X0, X1, nx + 1)
    zs = Z0 - (Z0 - Z1) * np.linspace(0, 1, nz + 1) ** 1.45
    X, Z = np.meshgrid(xs, zs)
    H = field(X, Z)
    verts = np.stack([X.ravel(), -Z.ravel(), H.ravel()], axis=1)
    r, c = np.meshgrid(np.arange(nz), np.arange(nx), indexing="ij")
    i0 = (r * (nx + 1) + c).ravel()
    quads = np.stack([i0, i0 + 1, i0 + nx + 2, i0 + nx + 1], axis=1)
    quads = quads[verts[quads, 2].max(axis=1) > -0.01]
    used = np.unique(quads)
    remap = np.full(len(verts), -1, np.int64); remap[used] = np.arange(len(used))
    me = bpy.data.meshes.new("terrain-src")
    me.from_pydata(verts[used].tolist(), [], remap[quads].tolist())
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-4,
                           plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("terrain", me)
    coll.objects.link(ob)
    decimated(ob, TERRAIN_TRIS[s])
    me = ob.data
    nv = len(me.vertices)
    co = np.empty(nv * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    co[:, 2] = np.where(co[:, 2] < 1e-3, 0.0, co[:, 2])  # keep the cut waterline at y = 0 through decimation
    me.vertices.foreach_set("co", co.ravel())
    x, z, h = co[:, 0], -co[:, 1], co[:, 2]
    w = terrain_weights(x, z, h, slope(x, z))
    vary = 0.86 + 0.24 * fbm(x / 35, z / 35, 3, 8)
    low = 0.78 + 0.22 * smoothstep(0, 30, h)
    if hd:  # the scans carry the colour; vertices only shade (and lift rock toward the snow line)
        cols = np.clip(np.repeat((vary * low)[:, None], 3, axis=1) * (1 + 0.6 * w[:, 1:2]), 0, 1)
    else:
        tint = np.stack([lin(tints[k]) for k in ("rock", "snow", "forest", "shore")])
        cols = np.clip((w @ tint) / DETAIL_MEAN * (vary * low)[:, None], 0, 1)
    npoly = len(me.polygons)
    ls = np.empty(npoly, np.int64); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(npoly, np.int64); me.polygons.foreach_get("loop_total", lt)
    fn = np.empty(npoly * 3); me.polygons.foreach_get("normal", fn); fn = fn.reshape(-1, 3)
    lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get("vertex_index", lv)
    lp = np.repeat(np.arange(npoly), lt)
    fw = np.zeros((npoly, 4)); np.add.at(fw, lp, w[lv])
    mi = fw.argmax(axis=1) if hd else np.zeros(npoly, np.int64)
    names = ["rock", "snow", "forest", "shore"]
    tile = np.array([TILE[n] for n in names])[mi] if hd else np.full(npoly, TILE["detail"])
    ax = np.abs(fn).argmax(axis=1)[lp]
    lc = co[lv]
    u = np.where(ax == 2, lc[:, 0], np.where(ax == 1, lc[:, 0], lc[:, 1]))
    v = np.where(ax == 2, lc[:, 1], lc[:, 2])
    uvs = np.stack([u, v], axis=1) / tile[lp][:, None]
    me.polygons.foreach_set("material_index", mi.astype(np.int32))
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", uvs.astype(np.float32).ravel())
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.concatenate([cols, np.ones((nv, 1))], axis=1).astype(np.float32).ravel())
    me.color_attributes.active_color = ca
    me.polygons.foreach_set("use_smooth", np.ones(npoly, bool))
    if hd:
        mats = [mat("terrain-rock", s, "rock.jpg", "rock-nrm.jpg", rough=0.88, vcol=True, nrm_strength=0.8),
                mat("terrain-snow", s, "snow.jpg", rough=0.7, vcol=True),
                mat("terrain-forest", s, "forest.jpg", rough=0.95, vcol=True),
                mat("terrain-shore", s, "shore.jpg", rough=0.8, vcol=True)]
    else:
        mats = [mat("terrain", s, "rock-detail.jpg", rough=0.9, vcol=True)]
    for m in mats:
        me.materials.append(m)
    me.update()
    return ob


# ---------------------------------------------------------------- shore: cabins, windows, pines, boulders
def cabin_sites():
    cam = np.array([CAMERA["eye"][0], CAMERA["eye"][2]])
    out = []
    for k, (side, t, dist) in enumerate(CABIN_SITES):
        z = CAM_Z - t * 1000.0
        x = shore_x(z, side, dist)
        ground = float(field(x, z))
        tz = z + 90.0
        f = np.array([float(centre_x(tz)) - x, tz - z]); f /= np.linalg.norm(f)
        sx = shore_x(z, side, 0.0) - side * 7.0
        out.append({"x": x, "z": z, "ground": ground, "facing": f, "tint": CABIN_TINTS[k],
                    "shore": (sx, z), "dist": float(np.linalg.norm(np.array([x, z]) - cam))})
    return sorted(out, key=lambda c: c["dist"])


def cabin_geometry(c, walls, window):
    W, D, WALL, RISE, OH = 6.4, 4.6, 2.8, 1.7, 0.4
    f = c["facing"]  # glTF (x, z); local -Y (front) maps onto it
    fb = Vector((f[0], -f[1]))
    rot = math.atan2(fb.y, fb.x) + math.pi / 2
    R = Matrix.Rotation(rot, 3, "Z")
    origin = Vector((c["x"], -c["z"], c["ground"]))
    def P(x, y, z):
        return tuple(R @ Vector((x, y, z)) + origin)
    tint = np.array(c["tint"])
    wall_c, roof_c, trim_c = tuple(tint), (0.8, 0.8, 0.86), (1.0, 1.0, 1.0)
    PL, SL, TR = (0.375, 1.0), (0.0625, 0.375), (0.005, 0.06)
    def wv(z, top):
        return PL[0] + (PL[1] - PL[0]) * min(1.0, (z + 0.8) / (top + 0.8))
    zb = -0.8
    hx, hy = W / 2, D / 2
    for (a, b) in (((-hx, -hy), (hx, -hy)), ((hx, -hy), (hx, hy)), ((hx, hy), (-hx, hy)), ((-hx, hy), (-hx, -hy))):
        walls.face([P(a[0], a[1], zb), P(b[0], b[1], zb), P(b[0], b[1], WALL), P(a[0], a[1], WALL)],
                   [(0, wv(zb, WALL)), (1, wv(zb, WALL)), (1, wv(WALL, WALL)), (0, wv(WALL, WALL))], wall_c)
    # ridge along local X: gables on the side walls, the front (water side) sits under the eave
    for sx in (-hx, hx):
        tri = [P(sx, -hy, WALL), P(sx, hy, WALL), P(sx, 0.0, WALL + RISE)]
        if sx < 0:
            tri = [tri[1], tri[0], tri[2]]
        walls.face(tri, [(0, wv(WALL, WALL + RISE)), (1, wv(WALL, WALL + RISE)), (0.5, wv(WALL + RISE, WALL + RISE))], wall_c)
    for sy in (-1, 1):
        e = (hy + OH) * sy
        drop = RISE * OH / hy
        quad = [P(-hx - OH, e, WALL - drop), P(hx + OH, e, WALL - drop), P(hx + OH, 0.0, WALL + RISE), P(-hx - OH, 0.0, WALL + RISE)]
        if sy > 0:
            quad = [quad[1], quad[0], quad[3], quad[2]]
        walls.face(quad, [(0, SL[0]), (1, SL[0]), (1, SL[1]), (0, SL[1])], roof_c)
        # the trim underside is its own sheet 5 cm down; sharing the roof's vertices would put four
        # faces on the ridge edge
        under = [(p[0], p[1], p[2] - 0.05) for p in reversed(quad)]
        walls.face(under, [(0, TR[0]), (0, TR[1]), (1, TR[1]), (1, TR[0])], trim_c)
    # chimney
    cx, cy, cw = hx * 0.45, hy * 0.35, 0.35
    ztop, zbot = WALL + RISE + 0.6, WALL + RISE * 0.3
    for (a, b) in (((cx - cw, cy - cw), (cx + cw, cy - cw)), ((cx + cw, cy - cw), (cx + cw, cy + cw)),
                   ((cx + cw, cy + cw), (cx - cw, cy + cw)), ((cx - cw, cy + cw), (cx - cw, cy - cw))):
        walls.face([P(a[0], a[1], zbot), P(b[0], b[1], zbot), P(b[0], b[1], ztop), P(a[0], a[1], ztop)],
                   [(0, TR[0]), (1, TR[0]), (1, TR[1]), (0, TR[1])], trim_c)
    walls.face([P(cx - cw, cy - cw, ztop), P(cx + cw, cy - cw, ztop), P(cx + cw, cy + cw, ztop), P(cx - cw, cy + cw, ztop)],
               [(0, TR[0]), (1, TR[0]), (1, TR[1]), (0, TR[1])], trim_c)
    # door on the front wall
    off = -hy - 0.03
    walls.face([P(-0.45 - 0.5, off, 0.0), P(-0.45 + 0.5, off, 0.0), P(-0.45 + 0.5, off, 2.0), P(-0.45 - 0.5, off, 2.0)],
               [(0.1, TR[0]), (0.3, TR[0]), (0.3, TR[1]), (0.1, TR[1])], trim_c)
    # windows: two on the front, one on each gable end
    panes = []
    for wx in (-2.2, 1.6):
        panes.append([P(wx - 0.5, off, 1.0), P(wx + 0.5, off, 1.0), P(wx + 0.5, off, 2.05), P(wx - 0.5, off, 2.05)])
    for sx in (-1, 1):
        e = (hx + 0.03) * sx
        q = [P(e, -0.4, 1.2), P(e, 0.4, 1.2), P(e, 0.4, 2.0), P(e, -0.4, 2.0)]
        panes.append(q if sx > 0 else [q[1], q[0], q[3], q[2]])
    for q in panes:
        window.face(q, [(0, 0), (1, 0), (1, 1), (0, 1)], (1.0, 1.0, 1.0))
    front = P(-0.3, off, 1.5)
    return {"centre": gl(origin), "window": gl(front), "facing": [round(float(f[0]), 4), round(float(f[1]), 4)]}


def pine_sites(cabins):
    rng = np.random.default_rng(8)
    gx, gz = np.meshgrid(np.arange(-430.0, 430.0, 8.0), np.arange(80.0, -1150.0, -8.0))
    x = (gx + rng.uniform(-3.5, 3.5, gx.shape)).ravel()
    z = (gz + rng.uniform(-3.5, 3.5, gz.shape)).ravel()
    h = field(x, z)
    s = slope(x, z)
    d = shore_d(x, z)
    patch = fbm(x / 70, z / 70, 3, 9)
    p = (1 - smoothstep(0.7, 1.15, s)) * smoothstep(2.6, 4.0, h) * (1 - smoothstep(70, 115, h)) * smoothstep(0.3, 0.55, patch)
    p *= (d < 300)
    for c in cabins:
        p *= np.hypot(x - c["x"], z - c["z"]) > 11.0
    keep = rng.uniform(0, 1, x.shape) < p
    pri = rng.uniform(0, 1, x.shape)
    idx = np.where(keep)[0]
    idx = idx[np.argsort(pri[idx])]
    hgt = rng.uniform(8.0, 15.0, x.shape)
    yaw = rng.uniform(0, math.tau, x.shape)
    var = rng.integers(0, 2, x.shape)
    return [(float(x[i]), float(z[i]), float(h[i]), float(hgt[i]), float(yaw[i]), int(var[i])) for i in idx]


def pines_hd(sites, card, coll, m):
    v, f, uv, nrm = [], [], [], []
    for (x, z, g, H, yaw, k) in sites:
        cell = card["cells"][k]
        Hc = H / cell["heightFrac"]
        Wc = Hc * card["aspect"]
        base = g - 0.3 - Hc * cell["baseFrac"]
        tu = cell["trunkU"]
        c = Vector((x, -z, 0.0))
        for q in range(3):
            a = yaw + q * math.pi / 3
            d = Vector((math.cos(a), math.sin(a), 0.0))
            n0 = Vector((-d.y, d.x, 0.0))
            for side in (1, -1):
                l, r = -tu * Wc, (1 - tu) * Wc
                pts = [c + d * l + Vector((0, 0, base)), c + d * r + Vector((0, 0, base)),
                       c + d * r + Vector((0, 0, base + Hc)), c + d * l + Vector((0, 0, base + Hc))]
                us = [(k * 0.5, 0), (k * 0.5 + 0.5, 0), (k * 0.5 + 0.5, 1), (k * 0.5, 1)]
                if side < 0:
                    pts = [pts[1], pts[0], pts[3], pts[2]]
                    us = [us[1], us[0], us[3], us[2]]
                b0 = len(v)
                for p in pts:
                    out = (p - Vector((c.x, c.y, p.z)))
                    out = out.normalized() if out.length > 1e-6 else Vector((0, 0, 0))
                    nn = (out * 0.75 + n0 * side * 0.35 + Vector((0, 0, 0.55))).normalized()
                    v.append(tuple(p)); nrm.append(tuple(nn))
                f.append((b0, b0 + 1, b0 + 2, b0 + 3))
                uv += us
    return mesh_obj("pines", v, f, coll, [m], uvs=uv, normals=nrm)


def pines_std(sites, card, coll, m):
    tint = lin(card["mean"]) * 0.9
    v, f, col = [], [], []
    seg = 7
    for (x, z, g, H, yaw, k) in sites:
        for (r0, z0, z1) in ((0.36 * H, 0.12 * H, 0.72 * H), (0.26 * H, 0.42 * H, H)):
            b0 = len(v)
            for i in range(seg):
                a = yaw + i * math.tau / seg
                v.append((x + r0 * math.cos(a), -z + r0 * math.sin(a), g + z0 - 0.3))
                col.append(tuple(tint * 0.55))
            v.append((x, -z, g + z1 - 0.3)); col.append(tuple(tint * 1.05))
            for i in range(seg):
                f.append((b0 + i, b0 + (i + 1) % seg, b0 + seg))
            c0 = len(v)  # flat underside on its own vertices, so it does not bend the side normals
            v += [v[b0 + i] for i in range(seg)]
            col += [tuple(tint * 0.4)] * seg
            f.append(tuple(c0 + (seg - 1 - i) for i in range(seg)))
    return mesh_obj("pines", v, f, coll, [m], colors=col, smooth=True)


ROCK_SRC = []
def rock_sources():
    if ROCK_SRC:
        return ROCK_SRC
    c = collection("rock-src")
    c.hide_render = True
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ROCK_GLTF)
    mine = sorted([o for o in bpy.data.objects if o not in before], key=lambda o: o.name)
    for o in mine:
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        c.objects.link(o)
        o.hide_viewport = True
    bpy.context.view_layer.update()
    for o in mine:
        if o.type != "MESH":
            continue
        co = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3) @ np.array(o.matrix_world)[:3, :3].T
        lo, hi = co.min(axis=0), co.max(axis=0)
        ROCK_SRC.append({"ob": o, "lo": lo, "hi": hi})
    return ROCK_SRC


def boulder_sites(cabins):
    rng = np.random.default_rng(11)
    sites = []
    for side in (1, -1):
        for z in np.linspace(25.0, -170.0, 6):
            z = float(z + rng.uniform(-12, 12))
            sites.append((side, z, float(rng.uniform(-1.5, 3.0))))
    for c in cabins[:6]:
        side = 1 if c["x"] > float(centre_x(c["z"])) else -1
        sites.append((side, c["z"] + float(rng.uniform(-14, 14)), float(rng.uniform(-1.0, 2.0))))
    out = []
    for k, (side, z, dist) in enumerate(sites):
        x = shore_x(z, side, dist)
        out.append((x, z, float(field(x, z)), float(rng.uniform(1.4, 3.0)), float(rng.uniform(0, math.tau)), k))
    return out


def boulders(s, sites, coll, m, tints):
    hd = s == "hd"
    src = rock_sources()
    dg = bpy.context.evaluated_depsgraph_get()
    per = max(40, BOULDER_TRIS[s])
    parts = []
    for i, r in enumerate(src):
        tmp = bpy.data.objects.new(f"boulder-src-{i}", r["ob"].data.copy())
        tmp.matrix_world = r["ob"].matrix_world.copy()
        coll.objects.link(tmp)
        decimated(tmp, per)
        parts.append(tmp)
    v, f, uv, col = [], [], [], []
    base_c = lin(tints["boulder"]) / 1.0
    rng = np.random.default_rng(5)
    for (x, z, g, sc, yaw, k) in sites:
        p = parts[k % len(parts)]
        r = src[k % len(src)]
        me = p.data
        M = Matrix.Translation((x, -z, g - 0.28 * sc * (r["hi"][2] - r["lo"][2]))) @ Matrix.Rotation(yaw, 4, "Z") @ \
            Matrix.Scale(sc, 4) @ Matrix.Translation((-(r["lo"][0] + r["hi"][0]) / 2, -(r["lo"][1] + r["hi"][1]) / 2, -r["lo"][2])) @ \
            Matrix(np.array(r["ob"].matrix_world).tolist()).to_3x3().to_4x4()
        b0 = len(v)
        for vert in me.vertices:
            v.append(tuple(M @ vert.co))
        shade = float(rng.uniform(0.8, 1.1))
        col += [tuple(np.clip(base_c * shade if not hd else np.array([shade] * 3), 0, 1))] * len(me.vertices)
        uvl = me.uv_layers.active
        for poly in me.polygons:
            f.append(tuple(b0 + me.loops[li].vertex_index for li in poly.loop_indices))
            for li in poly.loop_indices:
                uv.append(tuple(uvl.data[li].uv) if uvl else (0.0, 0.0))
    for p in parts:
        me = p.data
        bpy.data.objects.remove(p, do_unlink=True)
        bpy.data.meshes.remove(me)
    ob = mesh_obj("boulders", v, f, coll, [m], uvs=uv, colors=col, smooth=True)
    # the shore is packed with SHORE_VP-bit positions over the whole fjord (a couple of cm a step):
    # weld anything closer and drop the faces that collapse, so quantisation cannot fold the
    # decimated scan. A weld can fold the scan's thinnest tips onto one edge; those faces go too
    # (the rocks are open underneath anyway), until nothing folds.
    weld = 1.1 * SHORE_EXTENT / (1 << SHORE_VP)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for _ in range(4):
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
        bmesh.ops.dissolve_degenerate(bm, dist=weld, edges=bm.edges)
        folded = {fc for e in bm.edges if not e.is_manifold and not e.is_boundary for fc in e.link_faces}
        if not folded:
            break
        bmesh.ops.delete(bm, geom=list(folded), context="FACES")
    bmesh.ops.delete(bm, geom=[x for x in bm.verts if not x.link_faces], context="VERTS")
    bm.to_mesh(ob.data); bm.free()
    ob.data.update()
    return ob


def build_shore(s, tints, card):
    hd = s == "hd"
    coll = collection(f"fjord-shore-{s}")
    cabins = cabin_sites()
    walls = Builder()
    data = []
    for k, c in enumerate(cabins):
        window = Builder()
        data.append(cabin_geometry(c, walls, window))
        data[-1]["shore"] = [round(c["shore"][0], 3), 0.0, round(c["shore"][1], 3)]
        wm = mat(f"window-{k}", base=(0.03, 0.025, 0.02), rough=0.2, emit=WINDOW_GLOW)
        window.obj(f"cabin-window-{k}", coll, [wm])
    cabin_m = mat("cabin", s, "cabin-atlas.jpg", rough=0.85, vcol=True)
    walls.obj("cabins", coll, [cabin_m])
    sites = pine_sites(cabins)[:PINES[s]]
    if hd:
        pines_hd(sites, card, coll, mat("pine-card", s, "fir-card.png", rough=0.9, clip=True))
    else:
        pines_std(sites, card, coll, mat("pine", s, rough=0.9, vcol=True))
    bm = mat("boulder", s, "boulder.jpg", "boulder-nrm.jpg", rough=0.85, vcol=True) if hd else mat("boulder", s, rough=0.9, vcol=True)
    boulders(s, boulder_sites(cabins), coll, bm, tints)
    return data, len(sites)


# ---------------------------------------------------------------- export
def canonical_indices(path):
    """Sort each index buffer (winding kept, smallest index first) so packed GLBs are byte-identical between builds."""
    raw = bytearray(open(path, "rb").read())
    jlen = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(bytes(raw[20:20 + jlen]))
    base = 20 + jlen + 8
    fmts = {5121: "B", 5123: "H", 5125: "I"}
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" not in prim or prim.get("mode", 4) != 4:
                continue
            acc = doc["accessors"][prim["indices"]]
            bv = doc["bufferViews"][acc["bufferView"]]
            fmt = fmts[acc["componentType"]]
            off = base + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            n = acc["count"]
            idx = struct.unpack_from(f"<{n}{fmt}", raw, off)
            tris = []
            for i in range(0, n - n % 3, 3):
                t = idx[i:i + 3]
                k = t.index(min(t))
                tris.append(t[k:] + t[:k])
            tris.sort()
            struct.pack_into(f"<{len(tris) * 3}{fmt}", raw, off, *[v for t in tris for v in t])
    open(path, "wb").write(bytes(raw))


OPEN_SURFACES = ("terrain", "pines", "cabin-window", "cabins", "boulders")

def export(s):
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
    suffix = "-hd" if s == "hd" else ""
    rows = []
    dg = bpy.context.evaluated_depsgraph_get()
    for base in ("fjord-terrain", "fjord-shore"):
        coll = COLL[f"{base}-{s}"]
        for ob in bpy.context.scene.objects:
            ob.select_set(False)
        tris = 0
        bad = {"nonmanifold": 0, "degenerate": 0, "loose": 0}
        for ob in coll.all_objects:
            ob.select_set(True)
            me = ob.evaluated_get(dg).to_mesh()
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
            bm = bmesh.new(); bm.from_mesh(me)
            bad["nonmanifold"] += sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
            bad["degenerate"] += sum(1 for f in bm.faces if f.calc_area() < 1e-12)
            bad["loose"] += sum(1 for v in bm.verts if not v.link_faces)
            bm.free(); ob.evaluated_get(dg).to_mesh_clear()
        raw = os.path.join(BUILD, f"{base}{suffix}.raw.glb")
        bpy.ops.export_scene.gltf(filepath=raw, export_format="GLB", use_selection=True, export_apply=True,
                                  export_yup=True, export_normals=True, export_texcoords=True,
                                  export_materials="EXPORT", export_image_format="AUTO",
                                  export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                                  export_cameras=False, export_lights=False, export_extras=False)
        canonical_indices(raw)
        dst = os.path.join(OUT, "assets", f"{base}{suffix}.glb")
        vp = ["-vp", str(SHORE_VP)] if base == "fjord-shore" else []
        subprocess.run([GLTFPACK, "-i", raw, "-o", dst, "-cc", "-kn", "-km", *vp], check=True)
        data = open(dst, "rb").read()
        rows.append({"id": f"{base}{suffix}", "path": f"assets/{base}{suffix}.glb",
                     "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "triangles": tris,
                     "rawBytes": os.path.getsize(raw), "integrity": bad})
        print(f"fjord {s}: {base}{suffix} tris={tris} bytes={len(data)} integrity={bad}")
    return rows


def render(s):
    sc = bpy.context.scene
    world = sc.world or bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.012, 0.03, 0.05, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    if "preview-moon" not in bpy.data.objects:
        pc = collection("preview")
        ld = bpy.data.lights.new("preview-moon", "SUN"); ld.energy = 0.8; ld.color = (0.7, 0.8, 1.0)
        lo = bpy.data.objects.new("preview-moon", ld); lo.rotation_euler = (math.radians(55), 0, math.radians(-150))
        pc.objects.link(lo)
        la = bpy.data.lights.new("preview-aurora", "SUN"); la.energy = 0.35; la.color = (0.3, 1.0, 0.55)
        lo2 = bpy.data.objects.new("preview-aurora", la); lo2.rotation_euler = (math.radians(70), 0, math.radians(180))
        pc.objects.link(lo2)
        bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 600, 0))
        water = bpy.context.active_object; water.name = "preview-water"
        for uc in list(water.users_collection):
            uc.objects.unlink(water)
        pc.objects.link(water)
        wm = bpy.data.materials.new("preview-water-mat"); wm.use_nodes = True
        b = next(n for n in wm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (0.004, 0.01, 0.015, 1); b.inputs["Roughness"].default_value = 0.05
        water.data.materials.append(wm)
        cd = bpy.data.cameras.new("preview-cam"); cd.sensor_fit = "VERTICAL"; cd.angle = math.radians(CAMERA["fovDeg"])
        cd.clip_end = 5000
        co = bpy.data.objects.new("preview-cam", cd); pc.objects.link(co); sc.camera = co
        e, a = CAMERA["eye"], CAMERA["aim"]
        co.location = (e[0], -e[2], e[1])
        tgt = Vector((a[0], -a[2], a[1]))
        co.rotation_euler = (tgt - co.location).to_track_quat("-Z", "Y").to_euler()
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
    sc.render.film_transparent = False
    sc.render.resolution_x, sc.render.resolution_y = 1920, 540
    os.makedirs(SHOTS, exist_ok=True)
    sc.render.filepath = os.path.join(SHOTS, f"blender-render-{s}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", sc.render.filepath)


def clear_set(s):
    """Drop one set's objects, meshes and materials so the next set exports with the same node names."""
    for name in [n for n in COLL if n.endswith(f"-{s}")]:
        c = COLL.pop(name)
        for ob in list(c.all_objects):
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if me is not None and me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(c)
    for m in list(bpy.data.materials):
        if not m.name.startswith("preview-"):
            bpy.data.materials.remove(m)


def write_data(cabins, card):
    eye, aim = CAMERA["eye"], CAMERA["aim"]
    data = {
        "camera": {"eye": list(eye), "aim": list(aim), "fovDeg": CAMERA["fovDeg"]},
        "waterY": 0.0,
        "fjord": {"cameraZ": CAM_Z, "headZ": round(CAM_Z - 1150.0, 1), "halfWidthNear": 130.0, "halfWidthMid": 210.0},
        "cabins": cabins,
        "pineTint": card["mean"],
        "nodes": {"terrain": "terrain", "cabins": "cabins", "pines": "pines", "boulders": "boulders",
                  "windows": [f"cabin-window-{k}" for k in range(len(cabins))]},
    }
    ts = os.path.join(OUT, "frontend", "fjord-data.ts")
    os.makedirs(os.path.dirname(ts), exist_ok=True)
    with open(ts, "w") as f:
        f.write("// Generated by blender/build_fjord.py — do not edit by hand.\n")
        f.write("// Fjord layout in glTF Y-up metres (water y = 0, the fjord runs toward -z); cabins nearest first.\n")
        f.write("export const FJORD = " + json.dumps(data, separators=(",", ":")) + " as const;\n")


def sync_manifest(sets):
    """Rewrite plugin.yml's assets block (standard ids first, then -hd) from the packed files."""
    path = os.path.join(OUT, "plugin.yml")
    if not os.path.isfile(path) or not all(k in sets for k in ("standard", "hd")):
        return
    text = open(path).read()
    start, end = text.index("assets:"), text.index("viz:\n")
    rows = ["assets:"]
    for s in ("standard", "hd"):
        for r in sets[s]:
            rows += [f"  - id: {r['id']}", f"    path: {r['path']}", f"    sha256: {r['sha256']}",
                     f"    bytes: {r['bytes']}", f"    triangles: {r['triangles']}"]
    env = os.path.join(PREP, "hd", "env-hd.jpg")
    if os.path.isfile(env):
        data = open(env, "rb").read()
        with open(os.path.join(OUT, "assets", "env-hd.jpg"), "wb") as f:
            f.write(data)
        rows += ["  - id: env-hd", "    path: assets/env-hd.jpg", "    role: environment",
                 f"    sha256: {hashlib.sha256(data).hexdigest()}", f"    bytes: {len(data)}"]
    with open(path, "w") as f:
        f.write(text[:start] + "\n".join(rows) + "\n" + text[end:])


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    tints = json.load(open(os.path.join(PREP, "tints.json")))
    meta = {"sets": {}, "gltfpack": subprocess.run([GLTFPACK, "-v"], capture_output=True, text=True).stdout.strip()
            or "gltfpack", "blender": bpy.app.version_string}
    card = fir_card()
    cabins = None
    for s in SETS:
        build_terrain(s, tints)
        cabins, n_pines = build_shore(s, tints, card)
        meta["sets"][s] = export(s)
        meta.setdefault("pines", {})[s] = n_pines
        if RENDER:
            render(s)
        if s != SETS[-1]:
            clear_set(s)
    write_data(cabins, card)
    meta_path = os.path.join(OUT, "blender", "build_fjord_meta.json")
    old = json.load(open(meta_path)) if os.path.isfile(meta_path) else {}
    old.setdefault("sets", {}).update(meta["sets"])
    old.setdefault("pines", {}).update(meta.get("pines", {}))
    old["gltfpack"], old["blender"], old["firCard"] = meta["gltfpack"], meta["blender"], card
    with open(meta_path, "w") as f:
        json.dump(old, f, indent=2, sort_keys=True); f.write("\n")
    sync_manifest(old["sets"])
    print("FJORD_BUILD_DONE")
    sys.stdout.flush()


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    print("FJORD_BUILD_FAILED")
    sys.stdout.flush()
if QUIT:
    sys.stdout.flush()
    os._exit(0)
