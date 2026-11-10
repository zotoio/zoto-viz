"""Rocket Car Soccer HD set (Blender 5.x, run in a VISIBLE window; quits when done).

  python3 plugins/src/rocket-car-soccer/blender/fetch_hd_sources.py out/sources/05-rocket-car-hd
  blender --python plugins/src/rocket-car-soccer/blender/build_rocket_car_hd.py -- \
      --out plugins/src/rocket-car-soccer --src out/sources/05-rocket-car-hd [--gltfpack <bin>] [--keep-open]

Writes only the `-hd` assets (the Standard GLBs are read, never written):

  rocket-car-hd.glb, rocket-car-blue-hd.glb
      The Standard car (same geometry, node names and wheel / booster rig) with baked PBR:
      - livery: a 512 px albedo in object space, so it runs across UV seams: saturated team
        colour over a graphite lower body split by a white pinline, twin white racing stripes
        with dark pinlines over the nose, bonnet, deck, wing and tail, and a white number panel
        with a dark race number straddling the split on each door. Shut lines are darkened in.
      - paint: a 256 px panel-line normal (door, bonnet, deck and fuel-cap shut lines, bonnet
        pins, honeycomb vents) under a clearcoat that follows it, and a 256 px occlusion /
        roughness / metal map per livery region. All three are supersampled from 1024 px.
      - light: emissive team-colour light ribbons laid on the side sills and the tail (raycast
        onto the body), glowing brake calipers and hub caps, brighter head / tail lights and
        polished rims, so the cars read at the broadcast camera.
      - trim: ambientCG Fabric004 carbon-fibre weave (box-projected, tiled) under a clearcoat.
      - tyres: Rubber004 grain with a block tread, sidewall ribs and a team-colour pinstripe,
        baked on the Standard tyre UVs (u around the wheel, v across the profile).
  soccer-ball-hd.glb
      A 32-panel truncated icosahedron (12 pentagons, 20 hexagons) with pillowed panels and
      sunken seams, in Poly Haven "Leather White" grain with stitch rows. White hexagons and
      black pentagons are separate materials, so panel edges are geometry-sharp; a vertex-colour
      ramp darkens every seam. Hexagons share one atlas cell, pentagons the other (512 x 256).

All maps are computed here with numpy (no render bake), so the build is deterministic. Every
GLB is meshopt-packed with gltfpack (-cc -kn -km); `build_rocket_car_hd_meta.json` records
bytes, sha256, triangles, node names, image sizes and the integrity check of the packed files.
The decoded textures plus the env-hd.jpg PMREM must fit the 8 MiB maxGpuBytes ceiling.
"""
from __future__ import annotations

import bmesh
import bpy
import hashlib
import json
import math
import os
import struct
import subprocess
import sys

import numpy as np
from bpy_extras.bmesh_utils import bmesh_linked_uv_islands
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name: str, default: str) -> str:
    return os.path.abspath(argv[argv.index(name) + 1]) if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out", os.path.abspath(os.path.join(HERE, "..")))
REPO = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SRC = arg("--src", os.path.join(REPO, "out", "sources", "05-rocket-car-hd"))
GLTFPACK = arg("--gltfpack", os.path.join(REPO, "out", "tools", "node_modules", ".bin", "gltfpack"))
QUIT = "--keep-open" not in argv
ASSETS = os.path.join(OUT, "assets")
BAKED = os.path.join(SRC, "baked")
RAW = os.path.join(SRC, "raw")
DEC = os.path.join(SRC, "dec")
for d in (BAKED, RAW, DEC):
    os.makedirs(d, exist_ok=True)

TEAMS = {"rocket-car": "orange", "rocket-car-blue": "blue"}
# sRGB pinstripe on the tyre sidewall (the Standard team colours in visualisation.yml)
TEAM_RGB = {"orange": (1.0, 0.549, 0.196), "blue": (0.227, 0.655, 1.0)}
# sRGB livery: body colour (more saturated than Standard), white, graphite
LIVERY_BODY = {"orange": (1.0, 0.47, 0.05), "blue": (0.06, 0.40, 1.0)}
LIVERY_WHITE = (0.95, 0.95, 0.93)
LIVERY_DARK = (0.075, 0.08, 0.09)
RACE_NUMBER = {"orange": "7", "blue": "4"}
# linear emissive colour of light ribbons, calipers and hub caps
TEAM_LIGHT = {"orange": (1.0, 0.36, 0.03), "blue": (0.1, 0.5, 1.0)}

BODY_SS = 1024  # chassis raster (supersampled, then box-filtered)
BODY_ALB = 512  # livery albedo
BODY_N = 256    # chassis panel-line normal
BODY_ORM = 256  # chassis occlusion / roughness / metal
CARBON = 128
CARBON_TILE = 0.12  # mesh units per carbon tile
TYRE = (512, 128)
TYRE_SMALL = (256, 64)
BALL = (512, 256)
BALL_SS = 2
BALL_ORM = (256, 128)
GPU_CEILING = 8_388_608  # service/policy/work-budget-ceilings.json maxGpuBytes


# ------------------------------------------------------------------ small helpers
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def groove(dist, hw):
    """0..1 profile of a rounded shut line `hw` wide (half-width) at distance `dist`."""
    return np.exp(-(dist / hw) ** 2)


def load_px(path: str, size: tuple[int, int] | None = None) -> np.ndarray:
    """H x W x 3 float (file values, row 0 = image bottom like bpy pixels)."""
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    if size is not None and tuple(img.size) != size:
        img.scale(*size)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[..., :3].copy()


def sample(tex: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Bilinear, wrapping sample of `tex` (H x W x C) at texture coords u, v (1 = one tile)."""
    h, w = tex.shape[:2]
    x = (u % 1.0) * w - 0.5
    y = (v % 1.0) * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return ((tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx) * (1 - fy)
            + (tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx) * fy)


def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Wrapping box blur (radius r px) used to pre-filter sources before downsampling."""
    if r <= 0:
        return a
    out = a.copy()
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for k in range(-r, r + 1):
            acc += np.roll(out, k, axis=axis)
        out = acc / (2 * r + 1)
    return out


def save_image(name: str, rgb: np.ndarray, *, non_color: bool, quality: int = 90) -> bpy.types.Image:
    """Write `rgb` (H x W x 3, 0..1, row 0 = bottom) as BAKED/name.jpg and load it for export."""
    h, w = rgb.shape[:2]
    path = os.path.join(BAKED, name + ".jpg")
    img = bpy.data.images.new(name + "_tmp", w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "JPEG"
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        bpy.context.scene.render.image_settings.quality = quality
        img.save()
    bpy.data.images.remove(img)
    out = bpy.data.images.load(path, check_existing=False)
    out.name = name
    out.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    print(f"baked {name:24s} {w}x{h} {os.path.getsize(path):8d} B")
    return out


def box_down(a: np.ndarray, f: int) -> np.ndarray:
    """Average f x f blocks (H and W divisible by f)."""
    if f == 1:
        return a
    h, w = a.shape[:2]
    return a.reshape(h // f, f, w // f, f, *a.shape[2:]).mean((1, 3))


def down_normal(n: np.ndarray, f: int) -> np.ndarray:
    """Box-filter unit normals and renormalise (what a mip level of the map would hold)."""
    n = box_down(n, f)
    return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-9)


def encode_normal(n: np.ndarray) -> np.ndarray:
    n = n / np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def blend_normals(base: np.ndarray, detail: np.ndarray) -> np.ndarray:
    """Whiteout blend of two tangent-space normals (both unit, z up)."""
    out = np.stack([base[..., 0] + detail[..., 0], base[..., 1] + detail[..., 1], base[..., 2] * detail[..., 2]], -1)
    return out / np.linalg.norm(out, axis=-1, keepdims=True)


def dilate(rgb: np.ndarray, mask: np.ndarray, steps: int) -> np.ndarray:
    """Grow covered texels outward so mip levels never pull in uncovered texels."""
    rgb = rgb.copy()
    mask = mask.copy()
    for _ in range(steps):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(mask.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            m = np.roll(np.roll(mask, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * m[..., None]
            cnt += m
        grow = (~mask) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        mask = mask | grow
    return rgb


# ------------------------------------------------------------------ scene / io
def clear_all() -> None:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.node_groups, bpy.data.actions):
        for item in list(coll):
            coll.remove(item)
    for img in list(bpy.data.images):
        if img.name not in ("Render Result", "Viewer Node"):
            bpy.data.images.remove(img)


def decode(path: str) -> str:
    """Blender's importer cannot read EXT_meshopt_compression; unpack to float glTF under SRC/dec."""
    dec = os.path.join(DEC, os.path.basename(path))
    subprocess.run([GLTFPACK, "-i", path, "-o", dec, "-noq", "-kn", "-km"], check=True,
                   stdout=subprocess.DEVNULL)
    return dec


def export_glb(path: str) -> None:
    bpy.ops.object.select_all(action="SELECT")
    kw = dict(
        filepath=path, export_format="GLB", use_selection=False, export_apply=False,
        export_yup=True, export_normals=True, export_tangents=True, export_texcoords=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_morph=False,
        export_image_format="AUTO", export_vertex_color="ACTIVE",
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in known})
    print("raw", path, os.path.getsize(path))


def gltfpack(raw: str, dest: str) -> None:
    subprocess.run([GLTFPACK, "-i", raw, "-o", dest, "-cc", "-kn", "-km"], check=True)
    print("packed", dest, os.path.getsize(dest))


def glb_json(path: str) -> dict:
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + n])


def glb_tris(j: dict) -> int:
    """Drawn triangles: gltfpack instances shared meshes across nodes, so count per node."""
    per_mesh = [sum(j["accessors"][p["indices"]]["count"] // 3 for p in m["primitives"]) for m in j["meshes"]]
    return sum(per_mesh[n["mesh"]] for n in j.get("nodes", []) if "mesh" in n)


def sha256(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# ------------------------------------------------------------------ materials
def output_group() -> bpy.types.NodeTree:
    """The glTF exporter reads occlusion from a 'glTF Material Output' group node."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def principled(mat: bpy.types.Material):
    mat.use_nodes = True
    nt = mat.node_tree
    p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    return nt, p


def tex_node(nt, img: bpy.types.Image):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Linear"
    return t


def wire_pbr(mat: bpy.types.Material, *, albedo=None, normal=None, orm=None, coat: float = 0.0,
             coat_rough: float = 0.05, coat_normal: bool = False, rough: float | None = None,
             metal: float | None = None, normal_strength: float = 1.0, base=None, emission=None,
             emission_strength: float = 1.0) -> None:
    """Replace a material's texture inputs; base colour factor stays as imported unless `albedo`
    or `base` (linear RGB) is given. `emission` is a linear RGB emissive colour."""
    nt, p = principled(mat)
    for n in [n for n in nt.nodes if n.type in ("TEX_IMAGE", "NORMAL_MAP", "SEPARATE_COLOR")]:
        nt.nodes.remove(n)
    if base is not None:
        p.inputs["Base Color"].default_value = (*base, 1.0)
    if emission is not None:
        p.inputs["Emission Color"].default_value = (*emission, 1.0)
        p.inputs["Emission Strength"].default_value = emission_strength
    if albedo is not None:
        nt.links.new(tex_node(nt, albedo).outputs["Color"], p.inputs["Base Color"])
    if normal is not None:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_node(nt, normal).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
        if coat_normal:
            nt.links.new(nm.outputs["Normal"], p.inputs["Coat Normal"])
    if orm is not None:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex_node(nt, orm).outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], p.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], p.inputs["Metallic"])
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = output_group()
        nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    else:
        if rough is not None:
            p.inputs["Roughness"].default_value = rough
        if metal is not None:
            p.inputs["Metallic"].default_value = metal
    p.inputs["Coat Weight"].default_value = coat
    # the exporter omits KHR_materials_clearcoat only while Coat Roughness sits on the node default
    p.inputs["Coat Roughness"].default_value = coat_rough if coat > 0 else 0.03


# ------------------------------------------------------------------ mesh sampling
def mesh_arrays(ob: bpy.types.Object, uv_name: str):
    me = ob.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tri_v = np.empty(nt * 3, dtype=np.int64)
    tri_l = np.empty(nt * 3, dtype=np.int64)
    tri_m = np.empty(nt, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tri_v)
    me.loop_triangles.foreach_get("loops", tri_l)
    me.loop_triangles.foreach_get("material_index", tri_m)
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers[uv_name].data.foreach_get("uv", uv)
    nrm = np.empty(len(me.loops) * 3, dtype=np.float64)
    me.corner_normals.foreach_get("vector", nrm)
    return (tri_v.reshape(-1, 3), tri_l.reshape(-1, 3), tri_m, co.reshape(-1, 3),
            uv.reshape(-1, 2), nrm.reshape(-1, 3))


def rasterize(ob: bpy.types.Object, uv_name: str, size: int, mats: set[int]):
    """Per texel of a size^2 atlas: object-space position, normal, UV tangent frame, material."""
    tri_v, tri_l, tri_m, co, uv, nrm = mesh_arrays(ob, uv_name)
    H = W = size
    P = np.zeros((H, W, 3))
    N = np.zeros((H, W, 3))
    T = np.zeros((H, W, 3))
    B = np.zeros((H, W, 3))
    M = np.full((H, W), -1, dtype=np.int64)
    for t in range(len(tri_m)):
        if tri_m[t] not in mats:
            continue
        uvs = uv[tri_l[t]] * [W, H] - 0.5
        ps = co[tri_v[t]]
        ns = nrm[tri_l[t]]
        e1 = uvs[1] - uvs[0]
        e2 = uvs[2] - uvs[0]
        det = e1[0] * e2[1] - e1[1] * e2[0]
        if abs(det) < 1e-12:
            continue
        x0 = int(math.floor(uvs[:, 0].min())) - 1
        x1 = int(math.ceil(uvs[:, 0].max())) + 1
        y0 = int(math.floor(uvs[:, 1].min())) - 1
        y1 = int(math.ceil(uvs[:, 1].max())) + 1
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        dx = gx - uvs[0, 0]
        dy = gy - uvs[0, 1]
        b1 = (dx * e2[1] - dy * e2[0]) / det
        b2 = (e1[0] * dy - e1[1] * dx) / det
        b0 = 1.0 - b1 - b2
        inside = (b0 >= -1e-3) & (b1 >= -1e-3) & (b2 >= -1e-3)
        if not inside.any():
            continue
        ys, xs = gy[inside], gx[inside]
        bb = np.stack([b0[inside], b1[inside], b2[inside]], -1)
        P[ys, xs] = bb @ ps
        n = bb @ ns
        N[ys, xs] = n / np.linalg.norm(n, axis=-1, keepdims=True)
        # dP/du, dP/dv in texels: solve [e1 e2] -> [p1-p0 p2-p0]
        q1, q2 = ps[1] - ps[0], ps[2] - ps[0]
        dpdu = (q1 * e2[1] - q2 * e1[1]) / det
        dpdv = (q2 * e1[0] - q1 * e2[0]) / det
        T[ys, xs] = dpdu
        B[ys, xs] = dpdv
        M[ys, xs] = tri_m[t]
    mask = M >= 0
    # Orthonormalise the UV frame against the shading normal (what the renderer's TBN does).
    T = T - N * np.sum(T * N, -1, keepdims=True)
    B = B - N * np.sum(B * N, -1, keepdims=True)
    T /= np.maximum(np.linalg.norm(T, axis=-1, keepdims=True), 1e-12)
    B /= np.maximum(np.linalg.norm(B, axis=-1, keepdims=True), 1e-12)
    return P, N, T, B, M, mask


def height_normal(hfun, P, N, T, B, mask, eps: float) -> np.ndarray:
    """Tangent-space normal of height field h(P, N) by central differences along T and B."""
    ht = (hfun(P + T * eps, N) - hfun(P - T * eps, N)) / (2 * eps)
    hb = (hfun(P + B * eps, N) - hfun(P - B * eps, N)) / (2 * eps)
    n = np.stack([-ht, -hb, np.ones_like(ht)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    n[~mask] = (0.0, 0.0, 1.0)
    return n


# ------------------------------------------------------------------ car: chassis
def gl(P):
    """Blender object coords -> glTF mesh coords (x right, y up, z forward)."""
    return P[..., 0], P[..., 2], -P[..., 1]


def shut_lines(P, N) -> np.ndarray:
    """0..1 shut-line mask on the chassis paint (glTF mesh units; the chassis node scales 1.89)."""
    x, y, z = gl(P)
    nx, ny, _ = gl(N)
    side = smoothstep(0.45, 0.7, np.abs(nx))
    top = smoothstep(0.45, 0.7, ny)
    hw = 0.0065
    m = np.zeros(x.shape)
    # doors: front and rear shut lines and a sill line between the wheel arches
    door_y = smoothstep(-0.175, -0.16, y) * (1 - smoothstep(-0.012, 0.0, y))
    for z0 in (0.27, -0.33):
        m = np.maximum(m, side * door_y * groove(z - z0, hw))
    m = np.maximum(m, side * smoothstep(-0.34, -0.32, z) * (1 - smoothstep(0.26, 0.28, z)) * groove(y + 0.158, hw))
    # bonnet and rear deck: a cross line and two side lines each
    ax = np.abs(x)
    inner = 1 - smoothstep(0.325, 0.34, ax)
    m = np.maximum(m, top * inner * groove(z - 0.405, hw))
    m = np.maximum(m, top * smoothstep(0.395, 0.41, z) * groove(ax - 0.333, hw))
    m = np.maximum(m, top * inner * groove(z + 0.57, hw))
    m = np.maximum(m, top * (1 - smoothstep(-0.58, -0.565, z)) * groove(ax - 0.333, hw))
    # fuel cap on the left rear wing, bonnet pins either side of the vents
    r = np.hypot(x - 0.43, z + 0.69)
    m = np.maximum(m, top * groove(r - 0.042, hw * 0.8))
    for px in (0.24, -0.24):
        r = np.hypot(x - px, z - 0.86)
        m = np.maximum(m, top * np.maximum(groove(r - 0.02, hw * 0.6), 0.7 * groove(r, 0.008)))
    return m


def honeycomb(P, N) -> np.ndarray:
    """0 on the cell walls, 1 deep in each hexagonal cell of the vent mesh (box-projected)."""
    x, y, z = gl(P)
    nx, ny, nz = (np.abs(c) for c in gl(N))
    # project along the dominant normal axis
    side = nx >= np.maximum(ny, nz)
    a = np.where(side, z, x)
    b = np.where(side, y, np.where(ny >= nz, z, y))
    cell = 0.035
    p = np.stack([a / cell, b / cell], -1)
    # nearest centre of a hexagonal lattice (two offset rectangular lattices of pitch 1 x sqrt 3)
    s = np.array([1.0, math.sqrt(3.0)])
    c1 = np.floor(p / s) + 0.5
    c2 = np.floor((p - [0.5, 1.0]) / s) + 0.5
    h1 = p - c1 * s
    h2 = p - (c2 + 0.5) * s
    loc = np.where((np.sum(h1 * h1, -1) < np.sum(h2 * h2, -1))[..., None], h1, h2)
    q = np.abs(loc)
    edge = 0.5 - np.maximum(q[..., 0] * 0.5 + q[..., 1] * (math.sqrt(3.0) / 2), q[..., 0])
    return smoothstep(0.04, 0.12, edge)


def capsule(px, py, a, b):
    """Distance from points (px, py) to the segment a-b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = np.clip(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy), 0.0, 1.0)
    return np.hypot(px - a[0] - t * dx, py - a[1] - t * dy)


# race numbers as stroke segments in a glyph box (x right, y up; height 2 = the number panel)
GLYPHS = {
    "7": [((-0.42, 0.66), (0.42, 0.66)), ((0.42, 0.66), (-0.1, -0.7))],
    "4": [((0.24, 0.7), (0.24, -0.7)), ((0.24, 0.7), (-0.46, -0.18)), ((-0.46, -0.18), (0.5, -0.18))],
}
GLYPH_HW = 0.15


def rrect(u, v, hx, hy, r):
    """Signed distance to a rounded rectangle centred on 0 (negative inside)."""
    qx = np.abs(u) - hx + r
    qy = np.abs(v) - hy + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


# livery layout, glTF mesh units (the side tub between the wheel arches is x ~0.4, y -0.2..0)
SPLIT_Y = -0.105  # two-tone line: graphite below on every surface that is not a top
SKIRT_Y = -0.155  # side light ribbon, on the graphite
STRIPE_C, STRIPE_HW, PINLINE = 0.05, 0.03, 0.006
NUM_Z, NUM_Y, NUM_HX, NUM_HY, NUM_R = -0.03, -0.08, 0.1, 0.058, 0.028
UNDERSIDE_UV = 0.3


def livery(P, N, team: str):
    """sRGB albedo, roughness and metal of the paint livery at object-space points P, normals N."""
    x, y, z = gl(P)
    nx, ny, _ = gl(N)
    ax = np.abs(x)
    aa = 0.0016

    def inside(d):
        return 1.0 - smoothstep(-aa, aa, d)

    col = np.empty(x.shape + (3,))
    col[:] = LIVERY_BODY[team]
    rough = np.full(x.shape, 0.3)
    metal = np.full(x.shape, 0.25)

    def paint(mask, c, r, m):
        col[:] = col * (1 - mask[..., None]) + np.asarray(c) * mask[..., None]
        rough[:] = rough * (1 - mask) + r * mask
        metal[:] = metal * (1 - mask) + m * mask

    # two-tone: graphite lower body under a white pinline (tops stay team colour)
    not_top = 1 - smoothstep(0.45, 0.6, ny)
    lower = not_top * inside(y - SPLIT_Y)
    paint(not_top * inside(np.abs(y - SPLIT_Y) - 0.0035), LIVERY_WHITE, 0.26, 0.0)
    paint(lower, LIVERY_DARK, 0.42, 0.35)
    # twin white stripes with dark pinlines over every surface that does not face sideways
    along = (1 - smoothstep(0.5, 0.65, np.abs(nx))) * (1 - lower)
    d = np.abs(ax - STRIPE_C) - STRIPE_HW
    paint(along * inside(d - PINLINE), LIVERY_DARK, 0.35, 0.1)
    paint(along * inside(d), LIVERY_WHITE, 0.26, 0.0)
    # door number panel: white rounded rectangle, dark rim, dark number (u runs to the viewer's right)
    side = smoothstep(0.5, 0.65, np.abs(nx)) * smoothstep(0.3, 0.34, ax)
    u = -(z - NUM_Z) * np.sign(x)
    v = y - NUM_Y
    d = rrect(u, v, NUM_HX, NUM_HY, NUM_R)
    paint(side * inside(d - PINLINE), LIVERY_DARK, 0.35, 0.1)
    paint(side * inside(d), LIVERY_WHITE, 0.26, 0.0)
    glyph = np.min([capsule(u / NUM_HY, v / NUM_HY, a, b) for a, b in GLYPHS[RACE_NUMBER[team]]], axis=0)
    paint(side * inside((glyph - GLYPH_HW) * NUM_HY), LIVERY_DARK, 0.35, 0.0)
    # undersides graphite too
    paint(smoothstep(-0.4, -0.6, ny), LIVERY_DARK, 0.42, 0.35)
    return col, rough, metal


def chassis_maps(ob: bpy.types.Object, slots: dict[str, int], uv_name: str, team: str):
    paint, stripe, grille = slots["paint"], slots["stripe"], slots["grille"]
    P, N, T, B, M, mask = rasterize(ob, uv_name, BODY_SS, {paint, stripe, grille})
    is_paint = (M == paint) | (M == stripe)
    is_grille = M == grille

    def h(Pq, Nq):
        return -0.005 * shut_lines(Pq, Nq) * is_paint - 0.006 * honeycomb(Pq, Nq) * is_grille

    n = height_normal(h, P, N, T, B, mask, eps=0.0015)
    seam = shut_lines(P, N) * is_paint
    cell = honeycomb(P, N) * is_grille
    col, rough, metal = livery(P, N, team)
    col = np.where(is_grille[..., None], np.asarray(LIVERY_DARK) * (1 - 0.6 * cell)[..., None], col)
    col = col * (1 - 0.55 * seam)[..., None]
    rough = np.where(is_grille, 0.42 + 0.3 * cell, rough) + 0.3 * seam
    metal = np.where(is_grille, 0.35, metal) * (1 - 0.6 * seam)
    ao = 1.0 - 0.7 * seam - 0.45 * cell
    # one dilation for all nine channels, 4 texels deep at the coarsest map
    stack = np.concatenate([col, n, np.stack([ao, rough, metal], -1)], -1).astype(np.float32)
    stack = dilate(stack, mask, 4 * (BODY_SS // BODY_N))
    alb = box_down(stack[..., :3], BODY_SS // BODY_ALB)
    nrm = encode_normal(down_normal(stack[..., 3:6], BODY_SS // BODY_N))
    orm = box_down(stack[..., 6:], BODY_SS // BODY_ORM)
    cover = float(mask.mean())
    return alb, nrm, orm, cover


STRIP_HW = 0.009     # half width of a light ribbon (mesh units; ~3.5 px at the broadcast camera)
STRIP_LIFT = 0.0025  # off the paint
STRIP_STRENGTH = 3.5
TAIL_Y = -0.1


def light_strips(chassis: bpy.types.Object, team: str, hit_slots: set[int]) -> dict:
    """Emissive team-colour ribbons raycast onto the body: both side sills between the wheel
    arches (on the skirt line) and two bars across the tail either side of the booster."""
    me = chassis.data
    up = Vector((0.0, 0.0, 1.0))

    def cast(origin, direction, ok):
        hit, loc, nrm, fi = chassis.ray_cast(origin, direction)
        if not hit or me.polygons[fi].material_index not in hit_slots or not ok(loc):
            return None
        return loc.copy(), nrm.normalized()

    runs = []
    for side in (1.0, -1.0):
        runs.append([cast(Vector((side, -z, SKIRT_Y)), Vector((-side, 0.0, 0.0)), lambda p: 0.37 < abs(p.x) < 0.45)
                     for z in np.linspace(-0.3, 0.3, 41)])
    for x0, x1 in ((-0.32, -0.13), (0.13, 0.32)):
        runs.append([cast(Vector((x, 2.0, TAIL_Y)), Vector((0.0, -1.0, 0.0)), lambda p: p.y > 0.9)
                     for x in np.linspace(x0, x1, 13)])
    bm = bmesh.new()
    quads = 0
    for run in runs:
        seg = []
        for p in run + [None]:
            if p is not None:
                seg.append(p)
                continue
            if len(seg) >= 2:
                rows = []
                for loc, nrm in seg:
                    t = (up - nrm * nrm.dot(up)).normalized()
                    base = loc + nrm * STRIP_LIFT
                    rows.append((bm.verts.new(base - t * STRIP_HW), bm.verts.new(base + t * STRIP_HW), nrm))
                for (a0, b0, n0), (a1, b1, _) in zip(rows, rows[1:]):
                    f = bm.faces.new((a0, a1, b1, b0))
                    f.smooth = True
                    f.normal_update()
                    if f.normal.dot(n0) < 0:
                        f.normal_flip()
                    quads += 1
            seg = []
    me_s = bpy.data.meshes.new("light_strips")
    bm.to_mesh(me_s)
    bm.free()
    me_s.uv_layers.new(name="UVMap")
    mat = bpy.data.materials.new(f"car_light_strip_{team}")
    mat.use_nodes = True
    wire_pbr(mat, base=TEAM_LIGHT[team], emission=TEAM_LIGHT[team], emission_strength=STRIP_STRENGTH,
             rough=0.3, metal=0.0)
    me_s.materials.append(mat)
    ob = bpy.data.objects.new("light_strips", me_s)
    bpy.context.collection.objects.link(ob)
    ob.parent = chassis
    ob.matrix_parent_inverse.identity()
    hits = [sum(p is not None for p in r) for r in runs]
    return {"quads": quads, "hits_per_run": hits}


def chassis_uvs(ob: bpy.types.Object, slots: dict[str, int]) -> str:
    """Atlas UVs (smart project, packed) for paint/stripe/grille; tiled box UVs for carbon trim."""
    me = ob.data
    uvl = me.uv_layers.new(name="UVMap")
    me.uv_layers.active = uvl
    atlas = {slots["paint"], slots["stripe"], slots["grille"]}
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    ebm = bmesh.from_edit_mesh(me)
    for f in ebm.faces:
        f.select_set(False)
    for f in ebm.faces:
        if f.material_index in atlas:
            f.select_set(True)
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    # the underside is never seen by the arena cameras: give its texels to the livery
    ebm = bmesh.from_edit_mesh(me)
    uvl = ebm.loops.layers.uv.active
    for isl in bmesh_linked_uv_islands(ebm, uvl):
        if isl[0].material_index not in atlas:
            continue
        area = sum(f.calc_area() for f in isl)
        if sum(f.normal.z * f.calc_area() for f in isl) / max(area, 1e-12) > -0.5:
            continue
        loops = [lp for f in isl for lp in f.loops]
        c = sum((lp[uvl].uv for lp in loops), Vector((0.0, 0.0))) / len(loops)
        for lp in loops:
            lp[uvl].uv = c + (lp[uvl].uv - c) * UNDERSIDE_UV
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")
    # carbon: box projection, one Fabric004 tile per CARBON_TILE mesh units
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv["UVMap"]
    tile = CARBON_TILE
    carbon = slots["carbon"]
    for f in bm.faces:
        if f.material_index in atlas:
            continue
        if f.material_index != carbon:
            for loop in f.loops:
                loop[uv].uv = (0.0, 0.0)
            continue
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        for loop in f.loops:
            c = loop.vert.co
            loop[uv].uv = (c[a] / tile, c[b] / tile)
    bm.to_mesh(me)
    bm.free()
    return "UVMap"


# ------------------------------------------------------------------ car: carbon + tyre
def carbon_maps():
    src = os.path.join(SRC, "Fabric004", "Fabric004_1K-JPG_")
    col = load_px(src + "Color.jpg")
    nor = load_px(src + "NormalGL.jpg")
    rou = load_px(src + "Roughness.jpg")

    def down(a):
        return box_blur(a, 1).reshape(CARBON, a.shape[0] // CARBON, CARBON, a.shape[1] // CARBON, 3).mean((1, 3))

    albedo = down(col)
    # lift the weave contrast a touch: the scan is very even at car distance
    lum = albedo.mean(-1, keepdims=True)
    albedo = np.clip(lum.mean() + (albedo - lum.mean()) * 1.35, 0, 1) * np.array([0.92, 0.95, 1.0])
    n = down(nor) * 2 - 1
    n[..., :2] *= 1.4
    r = down(rou)[..., 1]
    orm = np.stack([np.ones_like(r), 0.28 + 0.25 * r, np.zeros_like(r)], -1)
    return albedo, encode_normal(n), orm


def tyre_profile(ob: bpy.types.Object):
    """v (Blender UV) -> (axial x, radius) along the Standard tyre's cross-section."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    pv = co[lv]
    # the wheel axle is the mesh x axis in both glTF and Blender coords
    x = pv[:, 0]
    r = np.hypot(pv[:, 1], pv[:, 2])
    v = uv[:, 1]
    bins = np.linspace(0, 1, 65)
    vc, xc, rc = [], [], []
    for i in range(64):
        s = (v >= bins[i]) & (v <= bins[i + 1])
        if s.any():
            vc.append(v[s].mean())
            xc.append(np.median(x[s]))
            rc.append(np.median(r[s]))
    return np.array(vc), np.array(xc), np.array(rc)


def tyre_maps(team: str, profile):
    vc, xc, rc = profile
    W, H = TYRE
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    xv = np.interp(v, vc, xc)
    rv = np.interp(v, vc, rc)
    # x is mirrored on the right-hand tyre mesh; design the tread symmetric in |x| about the centre
    xm = xv - 0.5 * (xc.max() + xc.min())
    U, V = np.meshgrid(u, v)
    X = np.broadcast_to(xm[:, None], U.shape)
    R = np.broadcast_to(rv[:, None], U.shape)
    S = U * 2 * math.pi  # arc length on the tread (tyre radius 1 in mesh units)
    ax = np.abs(X)
    tread = smoothstep(0.955, 0.985, R)
    wall = smoothstep(0.66, 0.7, R) * (1 - tread)
    # tread: two circumferential grooves, slanted shoulder blocks, sipes across the centre rib
    circ = groove(ax - 0.125, 0.022)
    shoulder = smoothstep(0.15, 0.17, ax)
    f = np.mod((S + 0.45 * ax) / 0.19, 1.0)
    lat = shoulder * (smoothstep(0.0, 0.05, f) * (1 - smoothstep(0.2, 0.25, f)))
    f2 = np.mod((S - 0.25 * X) / 0.095, 1.0)
    sipe = (1 - smoothstep(0.1, 0.11, ax)) * groove(f2 - 0.5, 0.05)
    edge = smoothstep(0.32, 0.36, ax)  # tread rolls into the shoulder
    tread_h = -(np.maximum(np.maximum(circ, lat), 0.55 * sipe)) * (1 - edge)
    # sidewall: two raised rings and fine radial serrations by the rim
    rings = groove(R - 0.9, 0.006) + groove(R - 0.745, 0.006)
    serr = (1 - smoothstep(0.7, 0.74, R)) * (0.5 + 0.5 * np.cos(U * 2 * math.pi * 96))
    wall_h = 0.35 * rings + 0.2 * serr
    grain = load_px(os.path.join(SRC, "Rubber004", "Rubber004_1K-JPG_Displacement.jpg"))[..., 0]
    gr = sample(grain[..., None], S / 0.9, (X + R) / 0.9)[..., 0]
    h = 0.03 * (tread * tread_h + wall * wall_h * 0.25) + 0.0012 * (gr - 0.5)
    # gradients in mesh units: du step = 2*pi*r/W along the tread, dv step from the profile
    du = 2 * math.pi * R / W
    dv_len = np.hypot(np.gradient(xv), np.gradient(rv))[:, None] * np.ones((1, W))
    ht = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * du)
    hb = np.gradient(h, axis=0) / np.maximum(dv_len, 1e-6)
    n = np.stack([-ht, -hb, np.ones_like(h)], -1)
    nrm = encode_normal(n)
    # albedo / orm at a quarter size
    w2, h2 = TYRE_SMALL
    fx, fy = W // w2, H // h2

    def down(a):
        return a.reshape(h2, fy, w2, fx, *a.shape[2:]).mean((1, 3))

    col = load_px(os.path.join(SRC, "Rubber004", "Rubber004_1K-JPG_Color.jpg"))
    cg = sample(col, S / 0.9, (X + R) / 0.9).mean(-1)
    base = 0.06 + 0.05 * (cg - cg.mean())
    groove_mask = np.clip(-tread_h, 0, 1) * tread
    shade = base * (1 - 0.45 * groove_mask) + wall * 0.012
    alb = np.stack([shade, shade, shade * 1.04], -1)
    stripe = wall * groove(R - 0.83, 0.0075)
    alb = alb * (1 - stripe[..., None]) + np.array(TEAM_RGB[team]) * stripe[..., None]
    rough = np.where(tread > 0.5, 0.86, 0.74) - 0.3 * stripe
    ao = 1 - 0.5 * groove_mask
    orm = np.stack([ao, rough, np.zeros_like(rough)], -1)
    return nrm, down(alb), down(orm)


# ------------------------------------------------------------------ car build
def find(name: str) -> bpy.types.Object:
    return next(o for o in bpy.data.objects if o.name == name or o.name.startswith(name + "."))


def build_car(asset: str) -> dict:
    team = TEAMS[asset]
    clear_all()
    bpy.ops.import_scene.gltf(filepath=decode(os.path.join(ASSETS, f"{asset}.glb")))
    chassis = find("chassis")
    names = [s.material.name for s in chassis.material_slots]
    slots = {
        "paint": names.index(f"car_paint_{team}"),
        "stripe": names.index("car_stripe"),
        "grille": names.index("car_grille"),
        "carbon": names.index("car_trim_carbon"),
    }
    uv_name = chassis_uvs(chassis, slots)
    alb, nrm, orm, cover = chassis_maps(chassis, slots, uv_name, team)
    body_alb = save_image(f"{asset}_body_basecolor", alb, non_color=False, quality=92)
    body_n = save_image(f"{asset}_body_normal", nrm, non_color=True, quality=92)
    body_orm = save_image(f"{asset}_body_orm", orm, non_color=True, quality=90)
    strips = light_strips(chassis, team, {slots["paint"], slots["carbon"]})
    c_alb, c_nrm, c_orm = carbon_maps()
    carbon_alb = save_image(f"{asset}_carbon_basecolor", c_alb, non_color=False)
    carbon_n = save_image(f"{asset}_carbon_normal", c_nrm, non_color=True)
    carbon_orm = save_image(f"{asset}_carbon_orm", c_orm, non_color=True)
    tyre_ob = find("wheel_front_left")
    t_nrm, t_alb, t_orm = tyre_maps(team, tyre_profile(tyre_ob))
    tyre_n = save_image(f"{asset}_tyre_normal", t_nrm, non_color=True, quality=92)
    tyre_alb = save_image(f"{asset}_tyre_basecolor", t_alb, non_color=False)
    tyre_orm = save_image(f"{asset}_tyre_orm", t_orm, non_color=True)

    mats = {m.name: m for m in bpy.data.materials}
    for name in (f"car_paint_{team}", "car_stripe"):
        wire_pbr(mats[name], albedo=body_alb, normal=body_n, orm=body_orm, coat=1.0, coat_rough=0.035,
                 coat_normal=True)
    wire_pbr(mats["car_grille"], albedo=body_alb, normal=body_n, orm=body_orm, normal_strength=1.0)
    wire_pbr(mats["car_trim_carbon"], albedo=carbon_alb, normal=carbon_n, orm=carbon_orm, coat=0.9,
             coat_rough=0.04)
    wire_pbr(mats["wheel_tyre"], albedo=tyre_alb, normal=tyre_n, orm=tyre_orm)
    # polished rims; brake calipers and hub caps glow in the team colour through the spokes
    wire_pbr(mats["wheel_rim"], base=(0.92, 0.92, 0.94), rough=0.14, metal=0.9, coat=0.6, coat_rough=0.05)
    wire_pbr(mats["wheel_hub"], base=TEAM_LIGHT[team], emission=TEAM_LIGHT[team], emission_strength=1.6,
             rough=0.3, metal=0.0)
    wire_pbr(mats[f"car_accent_{team}"], base=TEAM_LIGHT[team], emission=TEAM_LIGHT[team],
             emission_strength=3.0, rough=0.35, metal=0.0)
    wire_pbr(mats["car_canopy_glass"], rough=0.04, metal=0.6, coat=1.0, coat_rough=0.0)
    principled(mats["car_headlight"])[1].inputs["Emission Strength"].default_value = 8.0
    principled(mats["car_taillight"])[1].inputs["Emission Strength"].default_value = 6.0
    # HD renders with neutral tone mapping, which bleaches the Standard strength-6 flame to pink-white
    principled(mats["booster_flame_emissive"])[1].inputs["Emission Strength"].default_value = 2.2

    raw = os.path.join(RAW, f"{asset}-hd.glb")
    export_glb(raw)
    gltfpack(raw, os.path.join(ASSETS, f"{asset}-hd.glb"))
    return {"team": team, "atlas_coverage": round(cover, 3), "light_strips": strips}


# ------------------------------------------------------------------ ball
def truncated_icosahedron():
    """Unit-sphere panels: list of (centre, corners) with corners CCW seen from outside."""
    phi = (1 + 5 ** 0.5) / 2
    ico = []
    for a in (-1, 1):
        for b in (-phi, phi):
            ico += [(0, a, b), (a, b, 0), (b, 0, a)]
    ico = [np.array(p, float) / np.linalg.norm(p) for p in ico]
    edge = min(np.linalg.norm(ico[0] - q) for q in ico[1:])
    nbr = {i: [j for j in range(12) if j != i and abs(np.linalg.norm(ico[i] - ico[j]) - edge) < 1e-6]
           for i in range(12)}
    faces = sorted({tuple(sorted((i, j, k))) for i in range(12) for j in nbr[i] for k in nbr[i]
                    if j < k and k in nbr[j]})

    def cut(i, j):
        p = ico[i] + (ico[j] - ico[i]) / 3.0
        return p / np.linalg.norm(p)

    panels = []
    for i in range(12):
        panels.append([cut(i, j) for j in nbr[i]])
    for i, j, k in faces:
        panels.append([cut(i, j), cut(j, i), cut(j, k), cut(k, j), cut(k, i), cut(i, k)])
    out = []
    for corners in panels:
        c = np.mean(corners, 0)
        c /= np.linalg.norm(c)
        e1 = corners[0] - c * np.dot(corners[0], c)
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(c, e1)
        corners = sorted(corners, key=lambda q: math.atan2(np.dot(q, e2), np.dot(q, e1)) % (2 * math.pi))
        out.append((c, e1, e2, corners))
    return out


BALL_RINGS = [0.0, 0.42, 0.7, 0.86, 0.94, 0.98, 1.0]
# vertex-colour multiplier per ring: a dark seam line where the panels meet
BALL_RING_SHADE = [1.0, 1.0, 1.0, 1.0, 0.93, 0.5, 0.3]
BALL_PER_SIDE = 4
SEAM_DEPTH = 0.02
# linear base colours of the two panel materials (slightly cool: the stadium env is warm)
BALL_WHITE = (0.86, 0.87, 0.89)
BALL_BLACK = (0.006, 0.006, 0.007)
# atlas: hexagon cell centred at u 0.25, pentagon at 0.75 (v 0.5); same texels per unit on both
ATLAS_CENTRE = {6: (0.25, 0.5), 5: (0.75, 0.5)}


def ball_atlas_scale(a_plane: float) -> float:
    """V units per sphere unit: the hexagon (circumradius = edge, a corner on +u) fills 0.96 of the height."""
    return 0.28 / a_plane


def build_ball_mesh() -> tuple[bpy.types.Object, float]:
    panels = truncated_icosahedron()
    c, e1, e2, corners = next(p for p in panels if len(p[3]) == 6)
    a_plane = np.linalg.norm(corners[0] - c * np.dot(corners[0], c))  # hexagon planar circumradius
    scale = ball_atlas_scale(a_plane)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    coll = bm.loops.layers.float_color.new("seam")
    for c, e1, e2, corners in panels:
        n = len(corners)
        d = float(np.dot(corners[0], c))
        q2 = [np.array([np.dot(q, e1), np.dot(q, e2)]) for q in corners]
        perim = []
        for k in range(n):
            a0, a1 = q2[k], q2[(k + 1) % n]
            for s in range(BALL_PER_SIDE):
                perim.append(a0 + (a1 - a0) * (s / BALL_PER_SIDE))
        cu, cv = ATLAS_CENTRE[n]
        rows = []
        for s, shade in zip(BALL_RINGS, BALL_RING_SHADE):
            pts = [np.zeros(2)] if s == 0 else [p * s for p in perim]
            row = []
            for p2 in pts:
                p3 = c * d + e1 * p2[0] + e2 * p2[1]
                p3 = p3 / np.linalg.norm(p3)
                rad = 1.0 - SEAM_DEPTH * smoothstep(0.86, 1.0, s) ** 1.5
                vert = bm.verts.new(Vector(p3 * rad))
                row.append((vert, (cu + p2[0] * scale * 0.5, cv + p2[1] * scale), shade))
            rows.append(row)
        faces = []
        centre = rows[0][0]
        ring = rows[1]
        for j in range(len(ring)):
            faces.append([centre, ring[j], ring[(j + 1) % len(ring)]])
        for k in range(1, len(rows) - 1):
            r0, r1 = rows[k], rows[k + 1]
            for j in range(len(r0)):
                faces.append([r0[j], r1[j], r1[(j + 1) % len(r1)], r0[(j + 1) % len(r0)]])
        for f in faces:
            face = bm.faces.new([v for v, _, _ in f])
            face.smooth = True
            face.material_index = 0 if n == 6 else 1
            for loop, (_, uv, shade) in zip(face.loops, f):
                loop[uvl].uv = uv
                loop[coll] = (shade, shade, shade, 1.0)
            face.normal_update()
            if face.normal.dot(face.calc_center_median()) < 0:
                face.normal_flip()
    me = bpy.data.meshes.new("soccer_ball")
    bm.to_mesh(me)
    bm.free()
    seam = me.color_attributes["seam"]
    me.color_attributes.active_color = seam
    me.color_attributes.render_color_index = me.color_attributes.find("seam")
    ob = bpy.data.objects.new("soccer_ball", me)
    bpy.context.collection.objects.link(ob)
    ob.scale = (1.05, 1.05, 1.05)
    return ob, a_plane


def ball_maps(a_plane: float):
    """Atlas maps (normal + ORM): leather grain, sunken seam crease and stitch rows on both panel
    shapes, computed at BALL_SS x and box-filtered. Panel colour comes from the two materials."""
    W, H = BALL[0] * BALL_SS, BALL[1] * BALL_SS
    scale = ball_atlas_scale(a_plane)
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    hexa = U < 0.5
    cu = np.where(hexa, 0.25, 0.75)
    # panel-plane coords (sphere units); u is squeezed 2:1 because the atlas is 512 x 256
    X = (U - cu) / (scale * 0.5)
    Y = (V - 0.5) / scale
    n_sides = np.where(hexa, 6, 5)
    # circumradius of each polygon in the plane (equal edges): hexagon = a, pentagon = a / (2 sin 36)
    edge_len = a_plane
    circ = np.where(hexa, a_plane, edge_len / (2 * math.sin(math.pi / 5)))
    apothem = circ * np.cos(np.pi / n_sides)
    ang = np.arctan2(Y, X)
    sector = np.floor(np.mod(ang, 2 * np.pi) / (2 * np.pi / n_sides))
    mid = (sector + 0.5) * (2 * np.pi / n_sides)
    # distance to the nearest polygon edge and position along it
    along_n = X * np.cos(mid) + Y * np.sin(mid)
    t = -X * np.sin(mid) + Y * np.cos(mid)
    dist = apothem - along_n
    # seam crease, stitch dimples in a row just inside each edge (deeper than v1: crisper seams)
    crease = groove(dist, 0.006)
    stitch_pitch = 0.03
    st = np.mod(t / stitch_pitch, 1.0)
    stitch = groove(dist - 0.016, 0.0045) * groove(st - 0.5, 0.17) * smoothstep(0.0, 0.03, edge_len / 2 - np.abs(t))
    h = -0.01 * crease - 0.0055 * stitch
    gu = 1.0 / (W * scale * 0.5)
    gv = 1.0 / (H * scale)
    hx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * gu)
    hy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * gv)
    n = np.stack([-hx, -hy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lsrc = os.path.join(SRC, "leather_white", "leather_white_")
    tile = 2.7  # the scan is 300 mm square; one sphere unit is the 110 mm ball radius
    ln = sample(box_blur(load_px(lsrc + "nor_gl_1k.jpg"), 1), X / tile, Y / tile) * 2 - 1
    ln[..., :2] *= 0.55
    ln /= np.linalg.norm(ln, axis=-1, keepdims=True)
    nrm = encode_normal(down_normal(blend_normals(n, ln), BALL_SS))
    lr = sample(load_px(lsrc + "rough_1k.jpg"), X / tile, Y / tile)[..., 1]
    rough = 0.34 + 0.2 * (lr - lr.min()) / max(np.ptp(lr), 1e-6) + 0.3 * crease
    ao = 1 - 0.55 * crease - 0.35 * stitch
    orm = np.stack([ao, rough, np.zeros_like(rough)], -1)
    orm = box_down(orm, W // BALL_ORM[0])
    return nrm, orm


def build_ball() -> dict:
    clear_all()
    ob, a_plane = build_ball_mesh()
    nrm, orm = ball_maps(a_plane)
    nrm_img = save_image("soccer-ball_normal", nrm, non_color=True, quality=92)
    orm_img = save_image("soccer-ball_orm", orm, non_color=True)
    for name, base in (("soccer_ball_leather_white", BALL_WHITE), ("soccer_ball_leather_black", BALL_BLACK)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = True
        ob.data.materials.append(mat)
        wire_pbr(mat, base=base, normal=nrm_img, orm=orm_img, coat=0.35, coat_rough=0.12)
    raw = os.path.join(RAW, "soccer-ball-hd.glb")
    export_glb(raw)
    gltfpack(raw, os.path.join(ASSETS, "soccer-ball-hd.glb"))
    return {"panels": 32}


# ------------------------------------------------------------------ verify packed GLBs
def image_wh(data: bytes) -> tuple[int, int]:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        mk = data[i + 1]
        if mk in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return 0, 0


def image_sizes_file(path: str) -> tuple[int, int]:
    return image_wh(open(path, "rb").read())


def image_sizes(path: str, j: dict) -> list[list]:
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    bin0 = 20 + n + 8
    out = []
    for im in j.get("images", []):
        bv = j["bufferViews"][im["bufferView"]]
        data = b[bin0 + bv.get("byteOffset", 0): bin0 + bv.get("byteOffset", 0) + bv["byteLength"]]
        w, h = image_wh(data)
        out.append([im.get("name", ""), im.get("mimeType", ""), w, h, bv["byteLength"]])
    return out


def gpu_bytes(imgs) -> int:
    """three.js uploads every glTF image as RGBA8 with a full mip chain."""
    return sum(w * h * 16 // 3 for _, _, w, h, _ in imgs)


def env_pmrem_bytes(width: int) -> int:
    """PMREMGenerator.fromEquirectangular: cube 2^floor(log2(w / 4)), RGBA16F 3*max(cube, 112) x 4*cube."""
    cube = 2 ** int(math.floor(math.log2(width / 4)))
    return 3 * max(cube, 112) * 4 * cube * 8


def mesh_report(objs) -> dict:
    zero = loose = nan = nonman = 0
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        zero += sum(1 for f in bm.faces if f.calc_area() < 1e-12)
        loose += sum(1 for v in bm.verts if not v.link_faces)
        nan += sum(1 for v in bm.verts if any(math.isnan(c) for c in v.co))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        nonman += sum(1 for e in bm.edges if not e.is_manifold)
        bm.free()
    return {"zero_area_faces": zero, "loose_verts": loose, "nan_verts": nan, "non_manifold_edges_welded": nonman}


def verify(name: str, std: str | None) -> dict:
    path = os.path.join(ASSETS, name)
    j = glb_json(path)
    clear_all()
    bpy.ops.import_scene.gltf(filepath=decode(path))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    imgs = image_sizes(path, j)
    info = {
        "bytes": os.path.getsize(path),
        "sha256": sha256(path),
        "triangles": glb_tris(j),
        "nodes": sorted(n.get("name", "") for n in j["nodes"] if n.get("name")),
        "images": imgs,
        "gpu_bytes_est": gpu_bytes(imgs),
        "extensions": j.get("extensionsUsed", []),
        "integrity": mesh_report(meshes),
        "materials": [m.get("name", "") for m in j.get("materials", [])],
        "vertex_colors": sum(1 for m in j["meshes"] for p in m["primitives"] if "COLOR_0" in p["attributes"]),
    }
    problems = []
    for o in meshes:
        textured = any(
            s.material and s.material.use_nodes and any(n.type == "TEX_IMAGE" for n in s.material.node_tree.nodes)
            for s in o.material_slots)
        if textured and not o.data.uv_layers:
            problems.append({"mesh": o.name, "uv": "missing"})
    if info["integrity"]["nan_verts"] or info["integrity"]["zero_area_faces"] > info["triangles"] * 0.01:
        problems.append({"integrity": info["integrity"]})
    if std:
        sj = glb_json(os.path.join(ASSETS, std))
        snodes = sorted(n.get("name", "") for n in sj["nodes"] if n.get("name"))
        missing = [n for n in snodes if n not in info["nodes"]]
        if missing:
            problems.append({"missing_nodes": missing})
        info["standard_triangles"] = glb_tris(sj)
    if name.startswith("soccer"):
        # the welded ball must be closed (seams meet edge to edge)
        if info["integrity"]["non_manifold_edges_welded"]:
            problems.append({"ball": "open seams"})
        if not info["vertex_colors"]:
            problems.append({"ball": "seam vertex colours missing"})
    elif "light_strips" not in info["nodes"] or not any("light_strip" in m for m in info["materials"]):
        problems.append({"car": "light strips missing"})
    if info["bytes"] > 800_000:
        problems.append({"bytes": info["bytes"]})
    info["problems"] = problems
    print("verify", name, json.dumps({k: v for k, v in info.items() if k != "nodes"}))
    return info


def main() -> None:
    built = {
        "rocket-car-hd.glb": build_car("rocket-car"),
        "rocket-car-blue-hd.glb": build_car("rocket-car-blue"),
        "soccer-ball-hd.glb": build_ball(),
    }
    std = {"rocket-car-hd.glb": "rocket-car.glb", "rocket-car-blue-hd.glb": "rocket-car-blue.glb",
           "soccer-ball-hd.glb": None}
    meta = {}
    for name, b in built.items():
        meta[name] = {**verify(name, std[name]), **b}
    for name in ("rocket-car.glb", "rocket-car-blue.glb", "soccer-ball.glb"):
        p = os.path.join(ASSETS, name)
        j = glb_json(p)
        imgs = image_sizes(p, j)
        meta[name] = {"bytes": os.path.getsize(p), "sha256": sha256(p), "triangles": glb_tris(j),
                      "images": imgs, "gpu_bytes_est": gpu_bytes(imgs)}
    env = os.path.join(ASSETS, "env-hd.jpg")
    env_w = image_sizes_file(env)[0]
    pmrem = env_pmrem_bytes(env_w)
    gpu_hd = sum(meta[n]["gpu_bytes_est"] for n in built)
    meta["_totals"] = {
        "gpu_bytes_standard": sum(meta[n]["gpu_bytes_est"] for n in ("rocket-car.glb", "rocket-car-blue.glb", "soccer-ball.glb")),
        "gpu_bytes_hd": gpu_hd,
        "env_hd": {"bytes": os.path.getsize(env), "sha256": sha256(env), "width": env_w, "pmrem_bytes": pmrem},
        "gpu_bytes_hd_with_env": gpu_hd + pmrem,
        "max_gpu_bytes": GPU_CEILING,
        "bytes_hd": sum(meta[n]["bytes"] for n in built) + os.path.getsize(env),
    }
    if gpu_hd + pmrem > GPU_CEILING:
        meta["_totals"]["problems"] = [{"gpu_bytes_hd_with_env": gpu_hd + pmrem}]
    problems = {k: v["problems"] for k, v in meta.items() if v.get("problems")}
    meta_path = os.path.join(OUT, "blender", "build_rocket_car_hd_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, sort_keys=True)
        f.write("\n")
    print("META", meta_path, json.dumps(meta["_totals"]), "problems", problems or "none")
    if problems:
        raise SystemExit(f"integrity problems: {problems}")
    if QUIT:
        # wm.quit_blender() from a startup --python script can hang on Wayland.
        sys.stdout.flush()
        os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        if QUIT:
            os._exit(1)
        raise
