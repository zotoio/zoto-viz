"""Koi pond HD scan set (Blender 5.x, run in a VISIBLE window; quits when done).

  python3 plugins/src/koi-pond/blender/fetch_hd_sources.py out/sources/02-koi-hd-scans
  python3 plugins/src/koi-pond/blender/prep_hd_textures.py out/sources/02-koi-hd-scans
  blender --factory-startup --python plugins/src/koi-pond/blender/build_koi_hd_scans.py -- \
      --out plugins/src/koi-pond --src out/sources/02-koi-hd-scans [--gltfpack <bin>] [--keep-open]

(On GNOME Wayland a fresh Blender given `--window-geometry` can stall before running the script.)

Writes only the `-hd` assets (Standard GLBs are never touched):

  pond-rocks-hd.glb       every stone in the pond, from the Poly Haven photo scan "Rock Moss Set 02"
                          (decimated, one shared 1k albedo/normal + roughness atlas): the five accent
                          rocks (`pond-rocks`), the four shoreline clumps and two boulders
                          (`bank-stones`) and the stacked fountain stones (`fountain`), at the
                          Standard scape's anchors. Vertex colour darkens the wet waterline.
  lily-pads-hd.glb        notched, rim-curled pads (`lily-pads`) textured from a photographed leaf
                          warped into radial veins, and cupped four-whorl lotus blooms
                          (`lotus-blooms`) with daisy petal grain and a photographed stamen crown.
  koi-pond-scape-hd.glb   the pond bed (`substrate`) in Poly Haven "Ganges River Pebbles" PBR.
                          The rocks, pads and lotus live in the two GLBs above; the host pins them
                          at the origin with the HD set only.
  koi-{kohaku,showa,ogon}-hd.glb  the Standard koi rig with crisper scale normals, scale-edge
                          shading, wet clearcoat, thinner fin membranes and the HD swim clip.

Every GLB is meshopt-packed with gltfpack (-cc -kn -km). `build_koi_hd_scans_meta.json` records
bytes, sha256, triangles, node names and the koi head-integrity check of the packed files.
"""
from __future__ import annotations

import bpy
import bmesh
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name: str, default: str) -> str:
    return os.path.abspath(argv[argv.index(name) + 1]) if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out", os.path.abspath(os.path.join(HERE, "..")))
REPO = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SRC = arg("--src", os.path.join(REPO, "out", "sources", "02-koi-hd-scans"))
GLTFPACK = arg("--gltfpack", os.path.join(REPO, "out", "tools", "node_modules", ".bin", "gltfpack"))
QUIT = "--keep-open" not in argv
ASSETS = os.path.join(OUT, "assets")
BAKED = os.path.join(SRC, "baked")
RAW = os.path.join(SRC, "raw")
os.makedirs(RAW, exist_ok=True)

sys.path.insert(0, HERE)
import upgrade_koi_hd as koi_rig  # noqa: E402  (rewrite_swim, mesh_integrity, clear_all)


def G(x: float, y: float, z: float) -> Vector:
    """glTF Y-up -> Blender Z-up."""
    return Vector((x, -z, y))


def smooth(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / max(1e-9, e1 - e0)))
    return t * t * (3 - 2 * t)


def hash01(i: float) -> float:
    return (math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1.0


def clear_all() -> None:
    koi_rig.clear_all()
    for c in list(bpy.data.collections):
        if c.users == 0:
            bpy.data.collections.remove(c)


# ------------------------------------------------------------------ materials
def image(name: str, non_color: bool = False) -> bpy.types.Image:
    img = bpy.data.images.load(os.path.join(BAKED, name), check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def pbr(name: str, albedo: str, normal: str | None = None, mr: str | None = None, *,
        rough: float = 0.5, metal: float = 0.0, coat: float = 0.0, coat_rough: float = 0.1,
        sheen: float = 0.0, sheen_tint=(1.0, 1.0, 1.0), normal_strength: float = 1.0,
        double: bool = True, alpha: bool = False) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(p.outputs["BSDF"], out.inputs["Surface"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = image(albedo)
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    if alpha:
        nt.links.new(t.outputs["Alpha"], p.inputs["Alpha"])
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            m.blend_method = "BLEND"
    if normal:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = image(normal, non_color=True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
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
    if sheen > 0:
        p.inputs["Sheen Weight"].default_value = sheen
        p.inputs["Sheen Tint"].default_value = (*sheen_tint, 1.0)
        p.inputs["Sheen Roughness"].default_value = 0.4
    m.use_backface_culling = not double
    return m


# ------------------------------------------------------------------ mesh helpers
class Builder:
    """bmesh with per-vertex UV and colour (exported as TEXCOORD_0 / COLOR_0)."""

    def __init__(self) -> None:
        self.bm = bmesh.new()
        self.uv: dict = {}
        self.col: dict = {}

    def v(self, p: Vector, uv=(0.0, 0.0), c=(1.0, 1.0, 1.0)):
        vv = self.bm.verts.new(p)
        self.uv[vv] = uv
        self.col[vv] = c
        return vv

    def f(self, *vs):
        try:
            return self.bm.faces.new(vs)
        except ValueError:
            return None

    def flush(self, name: str, material: bpy.types.Material) -> bpy.types.Object:
        uvl = self.bm.loops.layers.uv.new("UVMap")
        for face in self.bm.faces:
            face.smooth = True
            for loop in face.loops:
                loop[uvl].uv = self.uv[loop.vert]
        self.bm.verts.index_update()
        cols = [self.col[vv] for vv in self.bm.verts]
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ca = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
        for i, c in enumerate(cols):
            ca.data[i].color = (*c, 1.0)
        me.color_attributes.active_color = ca
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        return ob


def join(objs: list, name: str) -> bpy.types.Object:
    with bpy.context.temp_override(active_object=objs[0], object=objs[0],
                                   selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    ob.data.name = name
    return ob


def tris(me: bpy.types.Mesh) -> int:
    return sum(len(p.vertices) - 2 for p in me.polygons)


def root_of(name: str, children: list) -> bpy.types.Object:
    r = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(r)
    for c in children:
        c.parent = r
    return r


def export_glb(path: str, skinned: bool = False) -> None:
    kw = dict(
        filepath=path, export_format="GLB", use_selection=False, export_apply=not skinned,
        export_yup=True, export_normals=True, export_texcoords=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=skinned, export_skins=skinned,
        export_morph=False, export_image_format="AUTO", export_jpeg_quality=88,
    )
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError as e:
        print("glTF exporter options fallback:", e)
        kw.pop("export_jpeg_quality")
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print("raw", path, os.path.getsize(path))


def gltfpack(raw: str, dest: str) -> None:
    subprocess.run([GLTFPACK, "-i", raw, "-o", dest, "-cc", "-kn", "-km"], check=True)
    print("packed", dest, os.path.getsize(dest))


# ------------------------------------------------------------------ rocks (photo scan)
ROCK_SRC = os.path.join(SRC, "rock_moss_set_02", "rock_moss_set_02_1k.gltf")


def rock_templates() -> list[tuple[bpy.types.Mesh, Vector]]:
    """The seven scanned rocks, transforms applied, centred on X/Y with their base at z = 0."""
    bpy.ops.import_scene.gltf(filepath=ROCK_SRC)
    obs = sorted([o for o in bpy.data.objects if o.type == "MESH"], key=lambda o: o.name)
    out = []
    for o in obs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        zs = [v.co.z for v in me.vertices]
        c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
        me.transform(Matrix.Translation(-c))
        dims = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
        out.append((me, dims))
        print("rock template", o.name, len(me.vertices), "verts", tris(me), "tris", tuple(round(d, 3) for d in dims))
    for o in obs:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def decimated(me: bpy.types.Mesh, target: int) -> bpy.types.Mesh:
    ob = bpy.data.objects.new("tmp-decimate", me.copy())
    bpy.context.collection.objects.link(ob)
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, target / max(1, tris(me)))
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def place_rock(tpl: tuple, target_tris: int, cx: float, cz: float, rx: float, rz: float,
               base: float, height: float, yaw: float, name: str, cache: dict, idx: int) -> bpy.types.Object:
    key = (idx, target_tris)
    if key not in cache:
        cache[key] = decimated(tpl[0], target_tris)
    me = cache[key].copy()
    dims = tpl[1]
    sxy = math.sqrt((2.1 * rx * 2.1 * rz) / max(1e-6, dims.x * dims.y))
    sx = sxy * max(0.8, min(1.25, (2.1 * rx / max(1e-6, dims.x)) / sxy))
    sy = sxy * max(0.8, min(1.25, (2.1 * rz / max(1e-6, dims.y)) / sxy))
    sz = max(0.6 * sxy, min(1.5 * sxy, height / max(1e-6, dims.z)))
    m = Matrix.Translation(G(cx, base, cz)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((sx, sy, sz, 1.0))
    me.transform(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def wet_colours(ob: bpy.types.Object, seed: float) -> None:
    """Darker, cooler stone below the waterline and in the crevices at its foot."""
    me = ob.data
    ca = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    tint = (1.0 + 0.06 * (hash01(seed) - 0.5), 1.0, 1.0 - 0.06 * (hash01(seed + 3) - 0.5))
    for i, v in enumerate(me.vertices):
        y = v.co.z  # Blender Z is glTF up
        wet = 1.0 - smooth(-0.005, 0.03, y)
        k = 1.0 - 0.42 * wet
        ca.data[i].color = (k * tint[0], k * 1.0, k * tint[2] * (1.0 + 0.05 * wet), 1.0)
    me.color_attributes.active_color = ca


def build_rocks() -> dict:
    clear_all()
    stone = pbr("stone", "rock_albedo.jpg", "rock_normal.jpg", "rock_mr.jpg", double=False)
    tpls = rock_templates()
    n = len(tpls)
    cache: dict = {}
    accents = [
        (0.55, 0.35, 0.14, 0.09, 0.12),
        (-0.62, 0.28, 0.16, 0.11, 0.13),
        (0.22, -0.68, 0.12, 0.08, 0.10),
        (-0.35, -0.55, 0.10, 0.07, 0.09),
        (0.72, -0.15, 0.11, 0.08, 0.10),
    ]
    parts = []
    for i, (cx, cz, rx, ry, rz) in enumerate(accents):
        parts.append(place_rock(tpls[i % n], 1150, cx, cz, rx, rz, -0.06, 1.7 * ry, 1.3 + i * 2.1,
                                f"pr{i}", cache, i % n))
    for o in parts:
        o.data.materials.clear()
        o.data.materials.append(stone)
    rocks = join(parts, "pond-rocks")

    bank = []
    clumps = [(0.35, 0.55, 7, 0.95), (2.0, 0.45, 6, 1.00), (3.6, 0.60, 8, 0.93), (5.1, 0.40, 5, 0.98)]
    si = 0
    for cang, spread, count, base_r in clumps:
        for k in range(count):
            ang = cang + (k / max(1, count - 1) - 0.5) * spread
            rad = base_r + 0.04 * math.sin(si * 2.3) + 0.03 * math.cos(k * 1.7)
            rx = 0.06 + 0.05 * abs(math.sin(si * 1.1))
            ry = 0.04 + 0.03 * abs(math.cos(si * 0.8))
            rz = 0.05 + 0.04 * abs(math.sin(si * 1.4))
            ti = (si * 3 + 1) % n
            bank.append(place_rock(tpls[ti], 300, math.cos(ang) * rad, math.sin(ang) * rad, rx, rz,
                                   -0.035, 1.55 * ry, si * 1.7, f"bs{si}", cache, ti))
            si += 1
    for j, (ang, rad, rx, ry, rz) in enumerate([(0.5, 1.02, 0.13, 0.09, 0.11), (3.4, 1.00, 0.12, 0.08, 0.10)]):
        ti = (j * 4 + 2) % n
        bank.append(place_rock(tpls[ti], 800, math.cos(ang) * rad, math.sin(ang) * rad, rx, rz,
                               -0.03, 1.5 * ry, 0.7 + j * 2.4, f"bb{j}", cache, ti))
    for o in bank:
        o.data.materials.clear()
        o.data.materials.append(stone)
    bank_ob = join(bank, "bank-stones")

    stack = []
    for k, (r, base, h, ti) in enumerate([(0.075, -0.045, 0.105, 5), (0.055, 0.050, 0.090, 2), (0.038, 0.128, 0.080, 6)]):
        stack.append(place_rock(tpls[ti % n], 420, 0.004 * k, -0.003 * k, r, r * 0.9, base, h, 0.9 + k * 2.2,
                                f"fs{k}", cache, ti % n))
    for o in stack:
        o.data.materials.clear()
        o.data.materials.append(stone)
    fountain = join(stack, "fountain")
    for i, o in enumerate((rocks, bank_ob, fountain)):
        wet_colours(o, 1.0 + i)
    root_of("pond-rocks-root", [rocks, bank_ob, fountain])
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    counts = {o.name: tris(o.data) for o in (rocks, bank_ob, fountain)}
    print("rocks tris", counts)
    raw = os.path.join(RAW, "pond-rocks-hd.glb")
    export_glb(raw)
    gltfpack(raw, os.path.join(ASSETS, "pond-rocks-hd.glb"))
    return {"parts": counts}


# ------------------------------------------------------------------ pebble bed
def build_scape() -> dict:
    clear_all()
    peb = pbr("pebble", "pebble_albedo.jpg", "pebble_normal.jpg", "pebble_mr.jpg", double=False)
    B = Builder()
    R = 1.05
    NU, NV = 72, 24

    def pt(u: float, v: float):
        # the Standard bed's irregular shoreline and ripple, with planar UVs (no seam)
        ang = u * math.pi * 2
        rad = v * R * (0.88 + 0.10 * abs(math.sin(u * math.pi * 5)))
        x, z = math.cos(ang) * rad, math.sin(ang) * rad
        h = -0.08 + 0.01 * math.sin(x * 8) + 0.008 * math.cos(z * 9)
        return B.v(G(x, h, z), (0.5 + x * 0.8, 0.5 + z * 0.8))

    centre = pt(0.0, 0.0)
    rings = [[pt(i / NU, j / NV) for i in range(NU)] for j in range(1, NV + 1)]
    # single-sided: wind counter-clockwise seen from above (+Y) so the bed faces the camera
    for i in range(NU):
        B.f(centre, rings[0][(i + 1) % NU], rings[0][i])
    for j in range(NV - 1):
        for i in range(NU):
            k = (i + 1) % NU
            B.f(rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i])
    sub = B.flush("substrate", peb)
    root_of("koi-pond-scape", [sub])
    raw = os.path.join(RAW, "koi-pond-scape-hd.glb")
    export_glb(raw)
    gltfpack(raw, os.path.join(ASSETS, "koi-pond-scape-hd.glb"))
    return {"parts": {"substrate": tris(sub.data)}}


# ------------------------------------------------------------------ lily pads + lotus
# Petal atlas quadrants (Blender UV, v up): pink | white petals on top, stamen disc | filaments below.
Q_PINK, Q_WHITE, Q_DISC, Q_FIL = (0.0, 0.5), (0.5, 0.5), (0.0, 0.0), (0.5, 0.0)


def quv(q, s: float, t: float):
    """s across (0..1), t from the top of the quadrant (0..1) -> atlas UV, inset 1.5%."""
    s = 0.015 + 0.97 * s
    t = 0.015 + 0.97 * t
    return (q[0] + 0.5 * s, q[1] + 0.5 * (1.0 - t))


def lily_pad(B: Builder, cx: float, cz: float, R: float, notch: float, seed: float, tint) -> None:
    NU, NV = 48, 8
    y0 = 0.014

    def pt(rho: float, t: float):
        w = 0.17 * rho ** 0.6
        a = notch + w + t * (2 * math.pi - 2 * w)
        r = R * rho * (1.0 + 0.025 * math.sin(a * 6 + seed) * rho)
        x, z = cx + math.cos(a) * r, cz + math.sin(a) * r
        y = y0 + 0.004 * rho * rho + 0.011 * smooth(0.86, 1.0, rho) ** 1.5 \
            + 0.0035 * math.sin(a * 4 + seed * 1.7) * rho ** 3
        uv = (0.5 + (x - cx) / (2 * R) * 0.98, 0.5 - (z - cz) / (2 * R) * 0.98)
        return G(x, y, z), uv

    centre_p, centre_uv = pt(0.0, 0.5)
    c = B.v(centre_p, centre_uv, tint)
    rings = []
    for j in range(1, NV + 1):
        rho = (j / NV) ** 0.85
        rings.append([B.v(*pt(rho, i / NU), tint) for i in range(NU + 1)])
    # i runs clockwise seen from above (+Y), so wind against it for an up-facing top
    for i in range(NU):
        B.f(c, rings[0][i + 1], rings[0][i])
    for j in range(NV - 1):
        for i in range(NU):
            B.f(rings[j][i], rings[j][i + 1], rings[j + 1][i + 1], rings[j + 1][i])
    # rim thickness: a short skirt under the curled edge
    skirt = []
    for i in range(NU + 1):
        p, uv = pt(1.0, i / NU)
        skirt.append(B.v(p - Vector((0, 0, 0.006)), uv, tuple(k * 0.7 for k in tint)))
    for i in range(NU):
        B.f(rings[-1][i], rings[-1][i + 1], skirt[i + 1], skirt[i])


def lotus(B: Builder, cx: float, cz: float, s: float, seed: float, white: bool) -> None:
    q = Q_WHITE if white else Q_PINK
    base_y = 0.022
    whorls = [  # (petals, length, elevation deg, width, cup, curl deg)
        (8, 0.100, 14, 0.040, 0.40, 22),
        (8, 0.090, 34, 0.037, 0.48, 24),
        (7, 0.076, 54, 0.032, 0.55, 22),
        (6, 0.058, 70, 0.025, 0.60, 16),
    ]
    NUP, NVP = 6, 5
    for wi, (n, L, elev, W, cup, curl) in enumerate(whorls):
        for k in range(n):
            th = (k + 0.5 * (wi % 2)) / n * 2 * math.pi + seed + 0.13 * math.sin(k * 2.7 + seed)
            d = Vector((math.cos(th), 0, math.sin(th)))
            side = Vector((-math.sin(th), 0, math.cos(th)))
            up = Vector((0, 1, 0))
            jit = 1.0 + 0.07 * math.sin(k * 3.1 + wi + seed)
            pos = Vector((cx, base_y, cz)) + d * (0.010 * s)
            axis_pts = [pos.copy()]
            for ui in range(1, NUP + 1):
                u = ui / NUP
                a = math.radians(elev + curl * u * u)
                pos = pos + (d * math.cos(a) + up * math.sin(a)) * (L * s * jit / NUP)
                axis_pts.append(pos.copy())
            rows = []
            for ui in range(NUP + 1):
                u = ui / NUP
                a = math.radians(elev + curl * u * u)
                ax = d * math.cos(a) + up * math.sin(a)
                nrm = side.cross(ax).normalized()  # inner (concave) side
                if nrm.dot(up - d) < 0:
                    nrm = -nrm
                # never zero width: a blunt tip and base keep every quad non-degenerate
                w = W * s * jit * math.sin(math.pi * (0.02 + 0.96 * u)) ** 0.75 * (1 - 0.3 * u * u)
                row = []
                for vi in range(NVP):
                    v = vi / (NVP - 1) * 2 - 1
                    p = axis_pts[ui] + side * (w * v) + nrm * (cup * w * v * v)
                    row.append(B.v(G(p.x, p.y, p.z), quv(q, (v + 1) / 2, u)))
                rows.append(row)
            for ui in range(NUP):
                for vi in range(NVP - 1):
                    B.f(rows[ui][vi], rows[ui + 1][vi], rows[ui + 1][vi + 1], rows[ui][vi + 1])
    # receptacle: a flat-topped cone of disc florets
    top_y, r_top, r_bot, SEG = base_y + 0.026 * s, 0.017 * s, 0.009 * s, 14
    ctop = B.v(G(cx, top_y + 0.002 * s, cz), quv(Q_DISC, 0.5, 0.5))
    ring_t, ring_b = [], []
    for i in range(SEG + 1):
        a = i / SEG * 2 * math.pi
        ring_t.append(B.v(G(cx + math.cos(a) * r_top, top_y, cz + math.sin(a) * r_top),
                          quv(Q_DISC, 0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a))))
        ring_b.append(B.v(G(cx + math.cos(a) * r_bot, base_y + 0.004 * s, cz + math.sin(a) * r_bot),
                          quv(Q_FIL, i / SEG, 0.95)))
    for i in range(SEG):
        B.f(ctop, ring_t[i], ring_t[i + 1])
        B.f(ring_b[i], ring_b[i + 1], ring_t[i + 1], ring_t[i])
    # stamen crown: slim golden blades leaning out around the receptacle
    for i in range(18):
        a = i / 18 * 2 * math.pi + seed * 0.5
        d = Vector((math.cos(a), 0, math.sin(a)))
        sd = Vector((-math.sin(a), 0, math.cos(a)))
        b0 = Vector((cx, base_y + 0.006 * s, cz)) + d * (r_top * 1.05)
        tip = b0 + d * (0.012 * s) + Vector((0, 0.024 * s, 0))
        hw = 0.0022 * s
        u0 = (i % 9) / 9
        quad = [b0 - sd * hw, b0 + sd * hw, tip + sd * hw * 0.6, tip - sd * hw * 0.6]
        uvs = [quv(Q_FIL, u0, 1.0), quv(Q_FIL, u0 + 0.1, 1.0), quv(Q_FIL, u0 + 0.1, 0.0), quv(Q_FIL, u0, 0.0)]
        vs = [B.v(G(p.x, p.y, p.z), uv) for p, uv in zip(quad, uvs)]
        B.f(*vs)


def build_lilies() -> dict:
    clear_all()
    pad_m = pbr("lily-pad", "pad_albedo.jpg", "pad_normal.jpg", "pad_mr.jpg", coat=0.35, coat_rough=0.12)
    petal_m = pbr("lotus-petal", "petal_albedo.jpg", "petal_normal.jpg", rough=0.5,
                  sheen=0.6, sheen_tint=(1.0, 0.85, 0.9), normal_strength=0.6)
    blooms = [  # Standard scape anchors: (x, z, scale, white)
        (0.35, 0.40, 1.05, False), (-0.42, 0.22, 0.95, True), (0.18, -0.48, 1.15, False),
        (-0.28, -0.32, 0.9, True), (0.55, -0.25, 0.8, False), (-0.55, 0.05, 0.85, True),
    ]
    extra = [  # flowerless young pads between them
        (0.05, 0.62, 0.55), (-0.70, -0.22, 0.6), (0.68, 0.12, 0.5), (-0.10, -0.75, 0.55), (-0.15, 0.48, 0.45),
    ]
    P = Builder()
    for i, (x, z, sc, _) in enumerate(blooms):
        g = hash01(i + 0.3)
        lily_pad(P, x, z, 0.27 * sc, notch=hash01(i + 7.1) * 6.283, seed=i + 1.0,
                 tint=(0.95 + 0.1 * g, 1.0, 0.92 + 0.06 * hash01(i + 2)))
    for i, (x, z, sc) in enumerate(extra):
        g = hash01(i + 9.4)
        lily_pad(P, x, z, 0.27 * sc, notch=hash01(i + 3.3) * 6.283, seed=i + 11.0,
                 tint=(1.0 + 0.12 * g, 1.02, 0.85 + 0.05 * g))
    pads = P.flush("lily-pads", pad_m)
    L = Builder()
    for i, (x, z, sc, white) in enumerate(blooms):
        lotus(L, x, z, sc, seed=i * 1.37, white=white)
    flowers = L.flush("lotus-blooms", petal_m)
    root_of("lily-pads-root", [pads, flowers])
    counts = {"lily-pads": tris(pads.data), "lotus-blooms": tris(flowers.data)}
    print("lily tris", counts)
    raw = os.path.join(RAW, "lily-pads-hd.glb")
    export_glb(raw)
    gltfpack(raw, os.path.join(ASSETS, "lily-pads-hd.glb"))
    return {"parts": counts}


# ------------------------------------------------------------------ koi
def build_koi(variety: str) -> dict:
    koi_rig.clear_all()
    bpy.ops.import_scene.gltf(filepath=decode(os.path.join(ASSETS, f"koi-{variety}.glb")))
    mesh = next(o for o in content_meshes() if any(m.type == "ARMATURE" for m in o.modifiers))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    before = koi_rig.mesh_integrity(mesh)
    if not before["ok_head"]:
        raise RuntimeError(f"{variety}: source fails head integrity {before}")
    swap = {
        f"koi_{variety}_body_basecolor": (f"koi_{variety}_albedo.jpg", False),
        f"koi_{variety}_body_normal": (f"koi_{variety}_normal.jpg", True),
        f"koi_{variety}_body_mr": (f"koi_{variety}_mr.jpg", True),
        f"koi_{variety}_fin_basecolor": (f"koi_{variety}_fin.png", False),
    }
    swapped = []
    for slot in mesh.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        prin = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                key = os.path.splitext(node.image.name)[0]
                if key in swap:
                    node.image = image(*swap[key])
                    swapped.append(key)
        if prin is None:
            continue
        if mat.name.endswith("_body"):
            prin.inputs["Coat Weight"].default_value = 0.85
            prin.inputs["Coat Roughness"].default_value = 0.06
        elif mat.name.endswith("_fin"):
            prin.inputs["Coat Weight"].default_value = 0.3
            prin.inputs["Coat Roughness"].default_value = 0.15
            if not prin.inputs["Roughness"].is_linked:
                prin.inputs["Roughness"].default_value = 0.3
        elif "eye" in mat.name:
            prin.inputs["Coat Weight"].default_value = 1.0
            prin.inputs["Coat Roughness"].default_value = 0.02
    if len(set(swapped)) != 4:
        raise RuntimeError(f"{variety}: swapped {swapped}")
    koi_rig.rewrite_swim(arm)
    raw = os.path.join(RAW, f"koi-{variety}-hd.glb")
    bpy.ops.object.select_all(action="SELECT")
    export_glb(raw, skinned=True)
    gltfpack(raw, os.path.join(ASSETS, f"koi-{variety}-hd.glb"))
    return {"before": before}


# ------------------------------------------------------------------ verify packed GLBs
def glb_json(path: str) -> dict:
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + n])


def glb_tris(j: dict) -> int:
    return sum(j["accessors"][p["indices"]]["count"] // 3 for m in j["meshes"] for p in m["primitives"])


def sha256(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def decode(path: str) -> str:
    """Blender's importer cannot read EXT_meshopt_compression; unpack to float glTF under SRC/dec."""
    dec_dir = os.path.join(SRC, "dec")
    os.makedirs(dec_dir, exist_ok=True)
    dec = os.path.join(dec_dir, os.path.basename(path))
    subprocess.run([GLTFPACK, "-i", path, "-o", dec, "-noq", "-kn", "-km"], check=True)
    return dec


def content_meshes() -> list:
    """Imported meshes minus the Icosphere the importer adds as a bone display shape."""
    shapes = {pb.custom_shape for o in bpy.data.objects if o.type == "ARMATURE"
              for pb in o.pose.bones if pb.custom_shape}
    return [o for o in bpy.data.objects if o.type == "MESH" and o not in shapes]


# Surfaces seen from above (Blender Z is glTF/three +Y); each must report an area-weighted facing.
FACING_UP = {"koi-pond-scape-hd.glb": ("substrate",), "lily-pads-hd.glb": ("lily-pads",)}


def named_ancestor(o: bpy.types.Object | None, names: tuple[str, ...]) -> str | None:
    """gltfpack keeps the name on the node and moves the geometry onto an unnamed child."""
    while o is not None:
        base = re.sub(r"\.\d{3}$", "", o.name)
        if base in names:
            return base
        o = o.parent
    return None


def verify(name: str) -> dict:
    path = os.path.join(ASSETS, name)
    j = glb_json(path)
    koi_rig.clear_all()
    bpy.ops.import_scene.gltf(filepath=decode(path))
    meshes = content_meshes()
    info = {
        "bytes": os.path.getsize(path),
        "sha256": sha256(path),
        "triangles": glb_tris(j),
        "nodes": sorted(n.get("name", "") for n in j["nodes"] if n.get("name")),
        "images": len(j.get("images", [])),
        "extensions": j.get("extensionsUsed", []),
        "reimported_meshes": len(meshes),
    }
    bad = []
    expect_up = FACING_UP.get(name, ())
    up_area: dict[str, list[float]] = {}
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
        nan = sum(1 for v in bm.verts if any(math.isnan(c) for c in v.co))
        surface = named_ancestor(o, expect_up)
        if surface:
            bm.transform(o.matrix_world)
            bm.normal_update()
            acc = up_area.setdefault(surface, [0.0, 0.0])
            for f in bm.faces:
                a = f.calc_area()
                acc[0] += f.normal.z * a
                acc[1] += a
        bm.free()
        if degenerate > len(o.data.polygons) * 0.01 or nan:
            bad.append({"mesh": o.name, "degenerate": degenerate, "nan": nan})
        if not o.data.uv_layers:
            bad.append({"mesh": o.name, "uv": "missing"})
    for surface in expect_up:
        up_sum, area = up_area.get(surface, (0.0, 0.0))
        if area <= 0:
            bad.append({"mesh": surface, "facing_up": "missing"})
            continue
        up = up_sum / area
        info.setdefault("facing_up", {})[surface] = round(up, 3)
        if up < 0.5:
            bad.append({"mesh": surface, "facing_up": up})
    info["problems"] = bad
    if name.split("-")[1] in ("kohaku", "showa", "ogon"):
        mesh = next(o for o in meshes if any(m.type == "ARMATURE" for m in o.modifiers))
        info["integrity"] = koi_rig.mesh_integrity(mesh)
        info["actions"] = [a.name for a in bpy.data.actions]
        if not info["integrity"]["ok_head"] or "swim" not in info["actions"]:
            bad.append({"koi": "head or swim missing"})
    print("verify", name, json.dumps({k: v for k, v in info.items() if k != "nodes"}))
    return info


def main() -> None:
    built = {
        "pond-rocks-hd.glb": build_rocks(),
        "koi-pond-scape-hd.glb": build_scape(),
        "lily-pads-hd.glb": build_lilies(),
    }
    for v in ("kohaku", "showa", "ogon"):
        built[f"koi-{v}-hd.glb"] = build_koi(v)
    meta = {}
    for name, b in built.items():
        meta[name] = {**verify(name), **b}
    problems = {k: v["problems"] for k, v in meta.items() if v["problems"]}
    meta_path = os.path.join(OUT, "blender", "build_koi_hd_scans_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, sort_keys=True)
        f.write("\n")
    print("META", meta_path, "problems", problems or "none")
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
