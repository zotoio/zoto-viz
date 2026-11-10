"""Aquarium HD scan set (Blender 5.x, run in a VISIBLE window; quits when done).

  python3 plugins/src/aquarium/blender/fetch_hd_sources.py out/sources/03-aquarium-hd-scans
  python3 plugins/src/aquarium/blender/prep_hd_textures.py out/sources/03-aquarium-hd-scans
  blender --factory-startup --python plugins/src/aquarium/blender/build_scape_hd.py -- \
      --out plugins/src/aquarium --src out/sources/03-aquarium-hd-scans [--gltfpack <bin>] \
      [--render <dir>] [--keep-open]

(On GNOME Wayland a fresh Blender given `--window-geometry` can stall before running the script.)

Writes only `assets/aquarium-scape-hd.glb` (the Standard `aquarium-scape.glb` is never touched),
with the node names the host scenery finds (web/src/graph/aquarium-scenery.ts), in the same tank
units as build_scape.py (glTF Y-up; inner glass x +-1.2, floor y -0.805, back z -1.0):

  substrate                 fine sand (ambientCG Ground080), ray-traced AO from the fresh scape
  fresh-rocks               Poly Haven "Rock Moss Set 01" scans as seiryu stone, at the Standard
                            anchors (the territory rock stays at x -0.55, z 0.05) plus satellites
  fresh-driftwood           Poly Haven "Dry Branches Medium 01" scans along the Standard trunk and limb
  fresh-plant-fern          java fern leaves (ambientCG LeafSet013) rooted on the driftwood
  fresh-plant-vallisneria   ribbons of photographed grass blades (ambientCG Foliage001) along the back
  fresh-plant-rotala        stems at the Standard plant spots with LeafSet022 leaves, red toward the light
  fresh-plant-moss          moss mounds (ambientCG Moss002)
  reef-sand                 pale rippled sand (ambientCG Ground093A) over the bed, AO from the reef
  reef-rocks                Poly Haven "Moon Rock 01" (pitted, porous) as live rock with coralline tint
  reef-coral-staghorn / -brain / -fan, reef-anemone
                            ambientCG Sponge002 porous detail under per-coral vertex colour; sea fans
                            are an alpha-masked lattice from ambientCG Leather008's cell seams
  fish-<name>               the Standard species templates (same geometry and sizes) with UVs into a
                            baked atlas: the species pattern rendered per texel, multiplied by
                            Leather008 scale relief, plus a scale normal map

Every texture comes from the CC0 photo sources (see ../ASSETS.md); vertex colour carries AO and
tints. Packed with gltfpack (-cc -kn -km -vpf): positions stay float in tank units because the
host bends fish and sways plants from local `position`. `build_scape_hd_meta.json` records bytes,
sha256, triangles, node names and the re-import check of the packed file.
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

import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name: str, default: str | None) -> str | None:
    return os.path.abspath(argv[argv.index(name) + 1]) if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out", os.path.abspath(os.path.join(HERE, "..")))
REPO = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SRC = arg("--src", os.path.join(REPO, "out", "sources", "03-aquarium-hd-scans"))
GLTFPACK = arg("--gltfpack", os.path.join(REPO, "out", "tools", "node_modules", ".bin", "gltfpack"))
RENDER = arg("--render", None)
QUIT = "--keep-open" not in argv
ASSETS = os.path.join(OUT, "assets")
BAKED = os.path.join(SRC, "baked")
RAW = os.path.join(SRC, "raw")
os.makedirs(RAW, exist_ok=True)
GLB = "aquarium-scape-hd.glb"

FLOOR = -0.805
HX, BACK, FRONT = 1.2, -1.0, 1.0
PROFILES = json.load(open(os.path.join(BAKED, "plant_profiles.json")))


def G(x: float, y: float, z: float) -> Vector:
    """glTF (x, y up, z toward viewer) -> Blender (x, y back, z up)."""
    return Vector((x, -z, y))


def lerp(a, b, t):
    return a + (b - a) * t


def mix3(a, b, t):
    return tuple(lerp(a[i], b[i], t) for i in range(3))


def smooth(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def hash01(i: float) -> float:
    return (math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1.0


def lin(c):
    """Authored sRGB -> linear (vertex colours are linear in glTF)."""
    return tuple(max(0.0, x) ** 2.2 for x in c)


def sand_h(x: float, z: float) -> float:
    """The Standard bed's height field (build_scape.py), so fish clearances are unchanged."""
    h = 0.03 + 0.05 * smooth(0.4, -1.0, z)
    h += 0.012 * noise.noise(Vector((x * 2.2, z * 2.2, 0.3)))
    h += 0.004 * noise.noise(Vector((x * 9.0, z * 9.0, 1.7)))
    return FLOOR + h


def clear_all() -> None:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


# ------------------------------------------------------------------ materials
def image(name: str, non_color: bool = False) -> bpy.types.Image:
    img = bpy.data.images.load(os.path.join(BAKED, name), check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def pbr(name: str, albedo: str | None, normal: str | None = None, *, rough: float = 0.8,
        metal: float = 0.0, coat: float = 0.0, coat_rough: float = 0.1, normal_strength: float = 1.0,
        double: bool = False, alpha: float = 1.0, clip: bool = False) -> bpy.types.Material:
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
        if clip:
            # glTF alphaMode MASK (cutoff 0.5): the exporter reads a Round node on the alpha
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(t.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], p.inputs["Alpha"])
            m.surface_render_method = "DITHERED"
    else:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        nt.links.new(attr.outputs["Color"], p.inputs["Base Color"])
    if normal:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = image(normal, non_color=True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat > 0:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = coat_rough
    if alpha < 1:
        p.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = not double
    return m


# ------------------------------------------------------------------ mesh helpers
class Builder:
    """bmesh with per-vertex UV and linear colour (exported as TEXCOORD_0 / COLOR_0)."""

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

    def flush(self, name: str, material: bpy.types.Material, closed: bool = False, smooth_shade: bool = True) -> bpy.types.Object:
        bm = self.bm
        if closed:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            # the weld can keep a different survivor among coincident verts from run to run, which
            # reorders faces; rebuild them sorted (each rotated to its lowest vert, winding kept)
            bm.verts.index_update()
            verts = list(bm.verts)
            polys = []
            for face in bm.faces:
                ids = [v.index for v in face.verts]
                k = ids.index(min(ids))
                polys.append(tuple(ids[k:] + ids[:k]))
            bmesh.ops.delete(bm, geom=list(bm.faces), context="FACES_ONLY")
            for ids in sorted(polys):
                bm.faces.new([verts[i] for i in ids])
            REPORT.append(validate_closed(name, bm))
        uvl = bm.loops.layers.uv.new("UVMap")
        for face in bm.faces:
            face.smooth = smooth_shade
            for loop in face.loops:
                loop[uvl].uv = self.uv[loop.vert]
        bm.verts.index_update()
        cols = [self.col[vv] for vv in bm.verts]
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for i, c in enumerate(cols):
            ca.data[i].color = (*c, 1.0)
        me.color_attributes.active_color = ca
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        return ob


REPORT: list = []


def validate_closed(name: str, bm) -> dict:
    """Non-manifold / boundary edges, zero-area faces and inward normals of a closed mesh."""
    bm.normal_update()
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
    vol = 0.0
    for f in bm.faces:
        v = [x.co for x in f.verts]
        for i in range(1, len(v) - 1):
            vol += v[0].dot(v[i].cross(v[i + 1])) / 6.0
    ok = boundary == 0 and nonman == 0 and zero == 0 and vol > 0
    return {"name": name, "faces": len(bm.faces), "boundary": boundary, "non_manifold": nonman,
            "zero_area": zero, "volume": vol, "ok": ok}


def grid_sheet(B: Builder, f, nu: int, nv: int, uvf, colf, flip: bool = False):
    """Quad sheet: f(u, v) -> Vector, uvf(u, v) -> uv, colf(u, v) -> linear rgb."""
    rows = [[B.v(f(i / nu, j / nv), uvf(i / nu, j / nv), colf(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            q = (rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])
            B.f(*(q[::-1] if flip else q))
    return rows


def tube(B: Builder, pts, radii, sides: int, colf, vscale: float = 1.0, tip: bool = True):
    """Swept tube along Blender-space points; u around, v along (arc length x vscale)."""
    rings = []
    n = len(pts)
    along = 0.0
    for i, p in enumerate(pts):
        if i:
            along += (pts[i] - pts[i - 1]).length
        t = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        b1 = t.cross(a).normalized()
        b2 = t.cross(b1)
        ring = []
        for k in range(sides + 1):
            ang = 2 * math.pi * k / sides
            ring.append(B.v(p + (b1 * math.cos(ang) + b2 * math.sin(ang)) * radii[i],
                            (k / sides, along * vscale), colf(i / (n - 1), k / sides)))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(sides):
            B.f(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k])
    if tip:
        end = B.v(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.6, (0.5, along * vscale), colf(1.0, 0))
        for k in range(sides):
            B.f(rings[-1][k], rings[-1][k + 1], end)


def tris(me: bpy.types.Mesh) -> int:
    return sum(len(p.vertices) - 2 for p in me.polygons)


def join(objs: list, name: str) -> bpy.types.Object:
    with bpy.context.temp_override(active_object=objs[0], object=objs[0],
                                   selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    ob.data.name = name
    return ob


def import_meshes(path: str) -> list:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    return sorted(meshes, key=lambda o: o.name)


def template(o) -> tuple:
    """World-space copy of a scanned mesh, centred on X/Y with its base at z = 0, plus its size."""
    me = o.data.copy()
    me.transform(o.matrix_world)
    # glTF splits vertices along UV seams; weld them (UVs are per corner) so decimation cannot crack
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    me.transform(Matrix.Translation(-Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))))
    return me, Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))


def largest_island(me: bpy.types.Mesh) -> None:
    """Drop every loose piece but the biggest (a scan's pebbles would float once it is turned)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.index_update()
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    drop = [f for isl in islands[1:] for f in isl]
    print(f"largest_island: {len(islands)} pieces, keeping {len(islands[0])} faces, dropping {len(drop)}")
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(me)
    bm.free()


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


def place(me: bpy.types.Mesh, dims: Vector, cx: float, cz: float, rx: float, rz: float, height: float,
          sink: float, yaw: float, name: str, tilt: Matrix | None = None) -> bpy.types.Object:
    """A scan copy whose footprint is ~2 rx by 2 rz and top ~height above the sand at (cx, cz)."""
    me = me.copy()
    if tilt is not None:
        me.transform(tilt)
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        zs = [v.co.z for v in me.vertices]
        me.transform(Matrix.Translation(-Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))))
        dims = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
    sx = 2 * rx / max(1e-6, dims.x)
    sy = 2 * rz / max(1e-6, dims.y)
    sz = height / max(1e-6, dims.z)
    base = sand_h(cx, cz) - sink
    me.transform(Matrix.Translation(G(cx, base, cz)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((sx, sy, sz, 1.0)))
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def set_material(ob, mat) -> None:
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def ensure_uv_name(ob) -> None:
    if ob.data.uv_layers:
        ob.data.uv_layers[0].name = "UVMap"


def colour_attr(ob, fn) -> None:
    """Per-vertex linear colour from fn(world position (glTF y up), normal) -> rgb."""
    me = ob.data
    # some scans carry their own (white) colour layer; the exporter must only see ours
    for other in [a.name for a in me.color_attributes if a.name != "Col"]:
        me.color_attributes.remove(me.color_attributes[other])
    ca = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    mw = ob.matrix_world
    for i, v in enumerate(me.vertices):
        p = mw @ v.co
        c = fn(Vector((p.x, p.z, -p.y)), v.normal)
        ca.data[i].color = (*c, 1.0)
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


# ------------------------------------------------------------------ ambient occlusion (vertex colour)
def bvh_of(objs: list) -> BVHTree:
    verts, polys = [], []
    for o in objs:
        mw = o.matrix_world
        off = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[off + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys)


def hemisphere(n: int) -> list:
    """Deterministic cosine-weighted directions about +Z (Fibonacci spiral)."""
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        a = i * ga
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - r * r)))))
    return out


def bake_ao(ob, bvh: BVHTree, dist: float, strength: float, rays: int = 24, up_only: bool = False) -> list:
    """Multiply each vertex colour by 1 - strength x (share of hemisphere rays that hit within dist)."""
    me = ob.data
    ca = me.color_attributes["Col"]
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    dirs = hemisphere(rays)
    aos = []
    for i, v in enumerate(me.vertices):
        p = mw @ v.co
        n = Vector((0, 0, 1)) if up_only else (nm @ v.normal).normalized()
        rot = n.to_track_quat("Z", "Y")
        start = p + n * 0.002
        hit = 0.0
        for d in dirs:
            loc, _, _, h = bvh.ray_cast(start, rot @ d, dist)
            if loc is not None:
                hit += 1.0 - h / dist * 0.5
        ao = 1.0 - strength * hit / rays
        aos.append(ao)
        c = ca.data[i].color
        ca.data[i].color = (c[0] * ao, c[1] * ao, c[2] * ao, 1.0)
    return aos


# ------------------------------------------------------------------ beds
def bed(name: str, mat, lift: float, uv_scale: float, tint, grid=(48, 40)) -> bpy.types.Object:
    B = Builder()

    def pos(u, v):
        x, z = lerp(-HX, HX, u), lerp(BACK, FRONT, v)
        return G(x, sand_h(x, z) + lift, z)

    def uvf(u, v):
        return (lerp(-HX, HX, u) * uv_scale, lerp(BACK, FRONT, v) * uv_scale)

    def colf(u, v):
        x, z = lerp(-HX, HX, u), lerp(BACK, FRONT, v)
        k = 0.5 + 0.5 * noise.noise(Vector((x * 3.1, z * 3.1, 4.2)))
        g = 1.0 - 0.1 * smooth(0.55, 0.85, k)
        return lin((tint[0] * g, tint[1] * g, tint[2] * g))

    grid_sheet(B, pos, grid[0], grid[1], uvf, colf, flip=True)
    return B.flush(name, mat)


# ------------------------------------------------------------------ fresh scape
SEIRYU = [  # (x, z, rx, ry, rz) Standard anchors first; the first is fish-behaviour's territory rock
    (-0.55, 0.05, 0.20, 0.10, 0.15),
    (-0.95, -0.72, 0.22, 0.26, 0.18),
    (0.95, -0.70, 0.18, 0.20, 0.16),
    (0.38, 0.40, 0.08, 0.04, 0.07),
    (-0.74, -0.42, 0.09, 0.09, 0.08),
    (0.72, -0.48, 0.08, 0.08, 0.07),
    (-0.32, 0.24, 0.06, 0.04, 0.05),
]
PLANT_SPOTS = [(-0.45, -0.25), (0.15, -0.3), (0.45, 0.05), (-0.6, -0.55), (0.65, -0.55)]
MOSS = ((-0.2, 0.3, 0.11), (0.0, 0.45, 0.08), (0.75, 0.25, 0.12), (-0.95, 0.35, 0.09), (0.3, -0.05, 0.07))


def build_rocks_fresh(stone) -> bpy.types.Object:
    srcs = import_meshes(os.path.join(SRC, "rock_moss_set_01", "rock_moss_set_01_1k.gltf"))
    tpls = [template(o) for o in srcs]
    for o in srcs:
        bpy.data.objects.remove(o, do_unlink=True)
    parts = []
    for i, (cx, cz, rx, ry, rz) in enumerate(SEIRYU):
        me, dims = tpls[(i * 5 + 1) % len(tpls)]
        target = 950 if rx >= 0.15 else 420
        # seiryu stands taller and more angular than the Standard blobs
        ob = place(decimated(me, target), dims, cx, cz, rx, rz, 1.55 * ry, 0.02, 0.7 + i * 2.3, f"fr{i}")
        ensure_uv_name(ob)
        parts.append(ob)
    for o in parts:
        set_material(o, stone)
    rocks = join(parts, "fresh-rocks")
    tint = lin((1.0, 1.0, 1.0))
    colour_attr(rocks, lambda p, n: tuple(t * (0.62 + 0.38 * smooth(-0.02, 0.06, p.y - sand_h(p.x, p.z))) for t in tint))
    return rocks


def root_end(me: bpy.types.Mesh, axis: int) -> tuple[Vector, Vector]:
    """A branch's long axis (unit, pointing base -> tip) and its base: the thicker end's centre."""
    lo = min(v.co[axis] for v in me.vertices)
    hi = max(v.co[axis] for v in me.vertices)
    span = hi - lo

    def slab(at: float) -> tuple[float, Vector]:
        vs = [v.co for v in me.vertices if abs(v.co[axis] - at) < span * 0.08]
        others = [i for i in range(3) if i != axis]
        ext = 1.0
        c = Vector((0.0, 0.0, 0.0))
        for i in others:
            ext *= max(p[i] for p in vs) - min(p[i] for p in vs)
            c[i] = (max(p[i] for p in vs) + min(p[i] for p in vs)) / 2
        c[axis] = at
        return ext, c

    (a_lo, c_lo), (a_hi, c_hi) = slab(lo), slab(hi)
    e = Vector((0.0, 0.0, 0.0))
    e[axis] = 1.0 if a_lo >= a_hi else -1.0
    return e, (c_lo if a_lo >= a_hi else c_hi)


def build_driftwood(wood) -> tuple[bpy.types.Object, list]:
    srcs = import_meshes(os.path.join(SRC, "dry_branches_medium_01", "dry_branches_medium_01_1k.gltf"))
    tpl = {o.name[-1]: template(o) for o in srcs}
    for o in srcs:
        bpy.data.objects.remove(o, do_unlink=True)
    parts = []
    # (branch, base x, z, tip x, y, z, roll, arch, tris): the long crooked branch on the Standard
    # trunk line, rising from the front-left of centre to the back right, and a short one as its low
    # limb leaning out to the left. Dry branches are slimmer than the Standard trunk, so each is
    # thickened across its length and bent into the same arch.
    for k, (which, bx, bz, tx, ty, tz, roll, arch, target) in enumerate([
        ("a", -0.35, -0.35, 0.55, -0.32, -0.85, 0.3, 0.08, 1700),
        ("c", -0.37, -0.33, -0.78, -0.60, 0.02, 2.2, 0.03, 900),
    ]):
        me, dims = tpl[which]
        axis_i = max(range(3), key=lambda i: dims[i])
        e, end = root_end(me, axis_i)
        m = decimated(me, target)
        base = G(bx, sand_h(bx, bz) - 0.02, bz)
        tip = G(tx, ty, tz)
        axis = tip - base
        s = axis.length / max(1e-6, dims[axis_i])
        diag = [s * 1.6] * 3
        diag[axis_i] = s
        rot = e.rotation_difference(axis.normalized()).to_matrix().to_4x4()
        m.transform(Matrix.Translation(base) @ rot @ Matrix.Rotation(roll, 4, e)
                    @ Matrix.Diagonal((*diag, 1.0)) @ Matrix.Translation(-end))
        ax = axis.normalized()
        for v in m.vertices:
            t = max(0.0, min(1.0, (v.co - base).dot(ax) / axis.length))
            v.co.z += arch * math.sin(math.pi * t)
        m.update()
        ob = bpy.data.objects.new(f"dw{k}", m)
        bpy.context.collection.objects.link(ob)
        ensure_uv_name(ob)
        set_material(ob, wood)
        parts.append(ob)
    # java fern roots on the main piece's upper faces, spread along it
    main = parts[0]
    cand = []
    for p in main.data.polygons:
        if p.normal.z > 0.55:
            c = main.matrix_world @ p.center
            g = Vector((c.x, c.z, -c.y))
            if g.y > sand_h(g.x, g.z) + 0.07:
                cand.append(g)
    cand.sort(key=lambda g: g.x)
    roots = [cand[int(i * (len(cand) - 1) / 6)] for i in range(7)] if len(cand) >= 7 else cand
    wood_ob = join(parts, "fresh-driftwood")
    colour_attr(wood_ob, lambda p, n: lin(tuple(0.55 + 0.45 * smooth(-0.01, 0.12, p.y - sand_h(p.x, p.z)) for _ in range(3))))
    return wood_ob, roots


def card_uv(rect, across: float, t: float) -> tuple:
    """A point of a straightened photo strip (rect in image space, y down; tip at the top)."""
    x0, y0, x1, y1 = rect
    return (lerp(x0, x1, across), 1.0 - lerp(y1, y0, t))


def width_at(profile: list, t: float) -> float:
    f = t * (len(profile) - 1)
    i = min(len(profile) - 2, int(f))
    return lerp(profile[i], profile[i + 1], f - i)


def leaf_card(B: Builder, base: Vector, direc: Vector, up: Vector, length: float, width: float, spec: dict,
              curl: float, col_a, col_b, nu: int = 6, fold: float = 0.25) -> None:
    """A leaf with its photo's outline: three columns (edge, midrib, edge), the midrib lifted a little."""
    side = direc.cross(up).normalized()
    norm = side.cross(direc).normalized()
    prof = spec["profile"]
    rows = []
    for i in range(nu + 1):
        t = i / nu
        w = width * width_at(prof, t)
        c = base + direc * (length * t) + up * (curl * length * t * t)
        col = lin(mix3(col_a, col_b, t))
        rows.append([B.v(c + side * (w * s) + norm * (fold * w * (1 - abs(s))), card_uv(spec["rect"], (s + 1) / 2, t), col)
                     for s in (-1.0, 0.0, 1.0)])
    for i in range(nu):
        for j in range(2):
            B.f(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])


def build_fern(plant, roots: list) -> bpy.types.Object:
    B = Builder()
    specs = PROFILES["fern"]
    for i, r in enumerate(roots):
        n = 5 + (i % 3)
        for k in range(n):
            a = k / n * 2 * math.pi + i * 0.9
            spread = 0.55 + 0.25 * hash01(i * 7 + k)
            d = Vector((math.cos(a) * spread, math.sin(a) * spread, 1.0)).normalized()
            L = 0.15 + 0.07 * hash01(i * 3.1 + k)
            spec = specs[(i + k) % len(specs)]
            leaf_card(B, G(r.x, r.y, r.z), d, Vector((0, 0, 1)), L, L / spec["aspect"] * 1.1, spec, -0.18,
                      (0.55, 0.62, 0.5), (1.0, 1.0, 0.95))
    return B.flush("fresh-plant-fern", plant)


def build_vallisneria(plant) -> bpy.types.Object:
    B = Builder()
    specs = PROFILES["vallisneria"]
    N = 64
    for i in range(N):
        x = lerp(-1.14, 1.14, (i + 0.5 * noise.noise(Vector((i, 0.2, 0)))) / (N - 1))
        z = -0.93 + 0.06 * noise.noise(Vector((i * 1.7, 4, 0)))
        if abs(x - 0.55) < 0.1:
            continue
        h = 0.72 + 0.6 * (0.5 + 0.5 * noise.noise(Vector((i * 0.37, 9, 0))))
        lean = 0.14 * noise.noise(Vector((i * 0.9, 2, 0)))
        y0 = sand_h(x, z) - 0.01
        w = 0.011 + 0.004 * hash01(i * 1.3)
        spec = specs[i % len(specs)]
        prof = spec["profile"]
        tw0 = i * 1.7

        def f(u, v, x=x, z=z, h=h, lean=lean, y0=y0, w=w, prof=prof, tw0=tw0):
            ww = w * max(0.35, width_at(prof, u)) * (v - 0.5) * 2
            tw = u * 2.2 + tw0
            return G(x + ww * math.cos(tw) + lean * u * u, y0 + h * u, z + 0.14 * u * u + ww * math.sin(tw))

        def colf(u, v, i=i):
            g = 0.45 + 0.55 * smooth(0.0, 0.25, u)
            return lin((g * (0.95 + 0.1 * hash01(i)), g, g * 0.92))

        grid_sheet(B, f, 12, 1, lambda u, v, spec=spec: card_uv(spec["rect"], v, u), colf)
    return B.flush("fresh-plant-vallisneria", plant)


def build_rotala(plant) -> bpy.types.Object:
    B = Builder()
    specs = PROFILES["rotala"]
    stem_spec = PROFILES["vallisneria"][1]
    for si, (px, pz) in enumerate(PLANT_SPOTS):
        stems = 5 if si != 2 else 4
        for s in range(stems):
            a = s * 2.4 + si
            r = 0.03 + 0.05 * ((s * 7) % 5) / 5
            x0, z0 = px + r * math.cos(a), pz + r * math.sin(a)
            h = (0.32 + 0.26 * ((s * 3 + si) % 4) / 4) * (0.55 if si == 2 else 1.0)
            y0 = sand_h(x0, z0) - 0.01
            lean = Vector((math.cos(a), math.sin(a), 0)) * 0.06
            NP, SIDES = 7, 3
            pts = [G(x0, y0 + h * t, z0) + lean * t * t for t in [i / (NP - 1) for i in range(NP)]]
            x_mid = (stem_spec["rect"][0] + stem_spec["rect"][2]) / 2
            tube(B, pts, [0.0035] * NP, SIDES, lambda t, k: lin((0.5, 0.55, 0.4)), tip=False)
            # stems sample the middle of a grass blade (a plain green line)
            for vv in list(B.uv)[-(NP * (SIDES + 1)):]:
                B.uv[vv] = (x_mid, 1.0 - B.uv[vv][1] * 0.5 % 1.0)
            for w in range(2, NP):
                c = pts[w]
                t = w / (NP - 1)
                red = smooth(0.35, 1.0, t)
                for k in range(2):
                    aa = k * math.pi + w * (math.pi / 2) + si
                    d = Vector((math.cos(aa), math.sin(aa), 0.35 + 0.25 * t)).normalized()
                    spec = specs[(w + k + s) % len(specs)]
                    L = 0.058 - 0.016 * t
                    # rotala reddens toward the light: green leaves below, copper-red at the crown
                    tint_a = mix3((0.85, 1.0, 0.8), (1.25, 0.62, 0.42), red)
                    leaf_card(B, c, d, Vector((0, 0, 1)), L, L / spec["aspect"], spec, 0.12,
                              tuple(x * 0.85 for x in tint_a), tint_a, nu=2, fold=0.15)
    return B.flush("fresh-plant-rotala", plant)


def build_moss(moss) -> bpy.types.Object:
    B = Builder()
    for (mx, mz, mr) in MOSS:
        bm2 = bmesh.new()
        bmesh.ops.create_icosphere(bm2, subdivisions=2, radius=1.0)
        idx = {}
        for v in bm2.verts:
            d = v.co.normalized()
            r = 1 + 0.25 * noise.noise(d * 5 + Vector((mx, mz, 0)))
            y = sand_h(mx, mz) - 0.008 + max(-0.2, d.z) * mr * 0.45 * r
            x, z = mx + d.x * mr * r, mz + d.y * mr * r
            g = 0.7 + 0.3 * smooth(-0.2, 0.6, d.z)
            idx[v] = B.v(G(x, y, z), (x * 3.0, z * 3.0), lin((g, g, g)))
        for f in bm2.faces:
            B.f(*[idx[v] for v in reversed(f.verts)])
        bm2.free()
    return B.flush("fresh-plant-moss", moss)


# ------------------------------------------------------------------ reef scape
LIVE_ROCK = [  # (x, z, rx, ry, rz, stand on end)
    (-0.55, 0.05, 0.20, 0.10, 0.15, False),
    (-0.85, -0.72, 0.30, 0.34, 0.20, True),
    (0.85, -0.72, 0.30, 0.30, 0.20, True),
]


def build_rocks_reef(liverock) -> bpy.types.Object:
    srcs = import_meshes(os.path.join(SRC, "moon_rock_01", "moon_rock_01_1k.gltf"))
    src = next(o for o in srcs if o.name.endswith("LOD0"))
    largest_island(src.data)
    me, dims = template(src)
    for o in srcs:
        bpy.data.objects.remove(o, do_unlink=True)
    lo = decimated(me, 1300)
    parts = []
    for i, (cx, cz, rx, ry, rz, upright) in enumerate(LIVE_ROCK):
        tilt = Matrix.Rotation(math.pi / 2 * (1 if i == 1 else -1), 4, "X") if upright else None
        ob = place(lo, dims, cx, cz, rx, rz, 1.45 * ry, 0.03, 0.4 + i * 2.1, f"lr{i}", tilt)
        ensure_uv_name(ob)
        set_material(ob, liverock)
        parts.append(ob)
    rocks = join(parts, "reef-rocks")
    colour_attr(rocks, lambda p, n: lin(tuple(t * (0.6 + 0.4 * smooth(-0.02, 0.07, p.y - sand_h(p.x, p.z))) for t in (1.0, 0.96, 1.0))))
    return rocks


def build_staghorn(coral) -> bpy.types.Object:
    B = Builder()
    A, C = (0.72, 0.52, 0.62), (0.98, 0.90, 0.80)

    def stag(p, d, length, r, depth):
        n = 4
        pts = [p + d * (length * i / n) for i in range(n + 1)]
        tube(B, pts, [lerp(r, r * 0.7, i / n) for i in range(n + 1)], 5,
             lambda t, k, depth=depth: lin(mix3(A, C, smooth(0.0, 1.0, (3 - depth + t) / 3))), vscale=6.0)
        if depth > 0:
            for k in range(2 if depth < 2 else 3):
                a = k * 2.1 + depth + p.x * 9
                nd = (d + Vector((math.cos(a) * 0.7, math.sin(a) * 0.7, 0.1))).normalized()
                stag(pts[-1], nd, length * 0.72, r * 0.7, depth - 1)

    for (cx, cz) in ((-0.45, -0.25), (0.65, -0.55)):
        stag(G(cx, sand_h(cx, cz) - 0.01, cz), Vector((0, 0, 1)), 0.11, 0.016, 3)
    return B.flush("reef-coral-staghorn", coral)


def build_brain(coral) -> bpy.types.Object:
    B = Builder()
    A, C = (0.62, 0.66, 0.34), (0.34, 0.44, 0.22)
    for (cx, cz, cr, sub) in ((0.15, -0.3, 0.14, 4), (0.45, 0.05, 0.09, 3)):
        bm2 = bmesh.new()
        bmesh.ops.create_icosphere(bm2, subdivisions=sub, radius=1.0)
        idx = {}
        for v in bm2.verts:
            d = v.co.normalized()
            ridge = abs(math.sin(14 * d.x + 6 * noise.noise(d * 2.0)) * math.sin(14 * d.y + 6 * noise.noise(d * 2.3 + Vector((4, 0, 0)))))
            r = cr * (1 + 0.06 * ridge)
            z = max(-0.15, d.z)
            p = G(cx + d.x * r, sand_h(cx, cz) + z * r * 0.7 + 0.005, cz + d.y * r)
            idx[v] = B.v(p, (0.5 + math.atan2(d.y, d.x) / (2 * math.pi) * 2.5, (d.z + 1) * 1.25), lin(mix3(C, A, ridge)))
        for f in bm2.faces:
            B.f(*[idx[v] for v in reversed(f.verts)])
        bm2.free()
    return B.flush("reef-coral-brain", coral)


def build_fans(fan) -> bpy.types.Object:
    B = Builder()
    A, C = (0.75, 0.20, 0.32), (0.98, 0.50, 0.46)
    for (cx, cz, a, h) in ((-0.6, -0.55, 0.3, 0.42), (0.2, -0.8, -0.2, 0.55), (-0.1, -0.85, 0.6, 0.36)):
        y0 = sand_h(cx, cz) - 0.01
        side = Vector((math.cos(a), math.sin(a), 0))

        def f(u, v, cx=cx, cz=cz, y0=y0, h=h, side=side, a=a):
            e = max(0.0, 1.0 - ((u - 0.56) / 0.56) ** 2)
            w = (v - 0.5) * 2 * h * 0.58 * math.sqrt(e) * smooth(0.0, 0.12, u)
            cup = 0.05 * h * (1 - (2 * v - 1) ** 2) * u
            return G(cx, y0 + h * u, cz) + side * w + Vector((-math.sin(a), math.cos(a), 0)) * cup \
                + Vector((0, 0.015 * math.sin(u * 5 + v * 3), 0))

        grid_sheet(B, f, 8, 8, lambda u, v, h=h: (v * h * 5.0, u * h * 5.0),
                   lambda u, v: lin(mix3(A, C, u * 0.8 + 0.2 * abs(math.sin(v * 9)))))
    return B.flush("reef-coral-fan", fan)


def build_anemone(coral) -> bpy.types.Object:
    B = Builder()
    A, C = (0.72, 0.48, 0.64), (0.98, 0.88, 0.62)
    ax, az = 0.35, 0.25
    for k in range(34):
        a = k * 2.39996
        r = 0.02 + 0.06 * math.sqrt(k / 34)
        p0 = G(ax + r * math.cos(a), sand_h(ax, az) + 0.04, az + r * math.sin(a))
        d = Vector((math.cos(a) * 0.6, math.sin(a) * 0.6, 1)).normalized()
        pts = [p0 + d * (0.11 * t) + Vector((0, 0, -0.03 * t * t)) for t in [i / 4 for i in range(5)]]
        tube(B, pts, [0.007 * (1 - 0.5 * i / 4) for i in range(5)], 5, lambda t, kk: lin(mix3(A, C, t)), vscale=8.0)
    # the column the tentacles grow from
    pts = [G(ax, sand_h(ax, az) - 0.01 + 0.045 * t, az) for t in (0, 0.5, 1.0)]
    tube(B, pts, [0.05, 0.058, 0.07], 14, lambda t, kk: lin(mix3((0.55, 0.36, 0.48), A, t)), vscale=8.0)
    return B.flush("reef-anemone", coral)


# ------------------------------------------------------------------ fish (Standard geometry + atlas UVs)
FISH: list = []  # one record per species: name, dims, colours (for the atlas bake)
TILES = 4
TILE_MARGIN = 0.03


def fish(name, half_len, half_h, body_h, body_w, colf, tail="fork", dorsal=0.3, anal=0.25,
         dorsal_h=0.3, anal_h=0.25, tail_len=0.22, tail_h=0.5, fin_col=None, fin_long=0.0):
    """build_scape.py's template, unchanged in shape, with a side-projection UV into its atlas tile."""
    S = 2.0
    L = half_len * 2 * S
    Ht = half_h * 2 * S
    lb = L * (1 - tail_len)
    z_nose = L / 2
    z_ped = z_nose - lb
    H = Ht * body_h
    W = H * body_w
    tile = len(FISH)
    tx, ty = tile % TILES, tile // TILES
    z_lo, z_hi = -L / 2 - fin_long - L * 0.02, z_nose + lb * 0.02
    y_lo, y_hi = -Ht / 2 - fin_long * 0.6 - H * 0.1, Ht / 2 + fin_long * 0.5 + H * 0.1

    def uv(p: Vector) -> tuple:
        z, y = -p.y, p.z
        s = (z_hi - z) / (z_hi - z_lo)
        t = (y - y_lo) / (y_hi - y_lo)
        m = TILE_MARGIN
        return ((tx + m + (1 - 2 * m) * min(1, max(0, s))) / TILES, (ty + m + (1 - 2 * m) * min(1, max(0, t))) / TILES)

    white = (1.0, 1.0, 1.0)
    B = Builder()
    NU, NV = (28, 18) if half_len > 0.05 else (20, 12)
    rings = []
    for i in range(1, NU + 1):
        u = i / NU
        prof = math.sin(math.pi * min(1.0, 0.08 + u * 0.92) ** 0.75) ** 0.8
        prof = max(prof, 0.16 * smooth(0.7, 1.0, u))
        ry = H / 2 * prof
        rx = W / 2 * prof
        yc = -H * 0.04 * math.sin(math.pi * u)
        z = z_nose - lb * u
        ring = []
        for j in range(NV):
            a = 2 * math.pi * j / NV
            p = G(rx * math.cos(a), yc + ry * math.sin(a), z)
            # gltfpack drops a constant white COLOR_0 and the host needs one: a soft belly occlusion
            g = 0.86 + 0.14 * smooth(-1.0, 0.6, math.sin(a))
            ring.append(B.v(p, uv(p), lin((g, g, g))))
        rings.append(ring)
    p = G(0, -H * 0.02, z_nose + lb * 0.012)
    nose = B.v(p, uv(p), white)
    for j in range(NV):
        B.f(nose, rings[0][j], rings[0][(j + 1) % NV])
    for i in range(NU - 1):
        for j in range(NV):
            B.f(rings[i][j], rings[i][(j + 1) % NV], rings[i + 1][(j + 1) % NV], rings[i + 1][j])
    p = G(0, 0, z_ped - L * 0.01)
    end = B.v(p, uv(p), white)
    for j in range(NV):
        B.f(rings[-1][(j + 1) % NV], rings[-1][j], end)
    body = B.flush(name + "-body", M_FISH, closed=True)

    F = Builder()
    th = Ht / 2 * tail_h

    def sheet(f, nu, nv, pect=False):
        rows = []
        for i in range(nu + 1):
            row = []
            for j in range(nv + 1):
                q = f(i / nu, j / nv)
                g = 1.0 - 0.12 * (j / nv if pect else i / nu)
                # pectorals overlap the flank in side view: give them the fin colour just above the body
                row.append(F.v(q, uv(q + Vector((0, 0, H * 0.75))) if pect else uv(q), lin((g, g, g))))
            rows.append(row)
        for i in range(nu):
            for j in range(nv):
                F.f(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])

    def tailf(u, v):
        z = z_ped - (L * tail_len + fin_long) * u
        if tail == "fork":
            spread = th * (0.25 + 0.75 * u) * (v - 0.5) * 2
            z += (L * tail_len * 0.45) * u * (1 - abs(v - 0.5) * 2)
        elif tail == "fan":
            spread = th * (0.3 + 0.9 * u) * (v - 0.5) * 2
        else:
            spread = th * (0.2 + 0.6 * math.sin(math.pi * 0.5 * u)) * (v - 0.5) * 2
        return G(0, spread, z)

    sheet(tailf, 5, 4)
    if dorsal > 0:
        z0 = z_nose - lb * 0.3
        z1 = z0 - lb * dorsal - fin_long * 0.6

        def df(u, v):
            z = lerp(z0, z1, u)
            top = H / 2 * 0.85
            hh = Ht / 2 * dorsal_h * math.sin(math.pi * min(1, 0.15 + u * 0.95)) + fin_long * 0.4 * u
            return G(0, top + hh * v, z - hh * v * 0.5)

        sheet(df, 5, 2)
    if anal > 0:
        z0 = z_nose - lb * 0.55
        z1 = z0 - lb * anal - fin_long * 0.6

        def af(u, v):
            z = lerp(z0, z1, u)
            bot = -H / 2 * 0.8
            hh = Ht / 2 * anal_h * math.sin(math.pi * min(1, 0.15 + u * 0.95)) + fin_long * 0.5 * u
            return G(0, bot - hh * v, z - hh * v * 0.5)

        sheet(af, 5, 2)
    for s in (-1, 1):
        def pf(u, v, s=s):
            z = z_nose - lb * 0.28 - lb * 0.12 * u
            return G(s * (W / 2 * 0.9 + lb * 0.08 * u), -H * 0.12 - lb * 0.04 * u + lb * 0.05 * (v - 0.5), z - lb * 0.03 * v)

        sheet(pf, 2, 1, pect=True)
    fins = F.flush(name + "-fins", M_FIN)

    E = Builder()
    er = max(H * 0.06, 0.002)
    for s in (-1, 1):
        bm2 = bmesh.new()
        bmesh.ops.create_uvsphere(bm2, u_segments=8, v_segments=5, radius=er)
        idx = {}
        for v in bm2.verts:
            c = (0.02, 0.02, 0.02) if v.co.x * s > er * 0.35 or v.co.x * s < -er * 0.2 else (0.75, 0.7, 0.5)
            idx[v] = E.v(G(s * (W / 2 * 0.62) + v.co.x, H * 0.12 + v.co.z, z_nose - lb * 0.12 + v.co.y), (0.0, 0.0), lin(c))
        for f in bm2.faces:
            E.f(*[idx[v] for v in f.verts])
        bm2.free()
    eyes = E.flush(name + "-eyes", M_EYE, closed=True)
    root = bpy.data.objects.new("fish-" + name, None)
    bpy.context.collection.objects.link(root)
    for o in (body, fins, eyes):
        o.parent = root
    FISH.append(dict(name=name, tile=tile, L=L, Ht=Ht, H=H, lb=lb, z_nose=z_nose, z_ped=z_ped, tail_len=tail_len,
                     th=th, fin_long=fin_long, z_lo=z_lo, z_hi=z_hi, y_lo=y_lo, y_hi=y_hi,
                     colf=colf, fin_col=fin_col))
    return root


def stripes(base, bands, band_col, edge=0.012, edge_col=(0.02, 0.02, 0.02)):
    def f(u, v, part):
        c = base(u, v, part)
        for (b0, b1) in bands:
            if b0 <= u <= b1:
                return band_col
            if b0 - edge <= u < b0 or b1 < u <= b1 + edge:
                return edge_col
        return c
    return f


def build_fish() -> None:
    def neon_c(u, v, part):
        if part == "fin":
            return (0.70, 0.75, 0.80)
        if 0.05 < v < 0.38 and u > 0.08:
            return (0.10, 0.55, 0.95)
        if v <= 0.05 and u > 0.42:
            return (0.85, 0.08, 0.10)
        return (0.80, 0.82, 0.86) if v < 0 else (0.35, 0.38, 0.30)
    fish("neon", 0.018, 0.008, 0.62, 0.55, neon_c, tail="fork")

    def angel_c(u, v, part):
        if any(abs(u - b) < 0.035 for b in (0.18, 0.45, 0.72)):
            return (0.06, 0.06, 0.07)
        return (0.84, 0.85, 0.80) if part == "body" else (0.75, 0.78, 0.76)
    fish("angel", 0.06, 0.076, 0.42, 0.22, angel_c, tail="fan", dorsal=0.35, anal=0.35, dorsal_h=0.48, anal_h=0.5,
         tail_len=0.2, tail_h=0.4, fin_long=0.05)

    def guppy_c(u, v, part):
        if part == "fin" and u > 0.6:
            k = 0.5 + 0.5 * math.sin(u * 40 + v * 7)
            return mix3((0.95, 0.35, 0.10), (0.15, 0.30, 0.85), k)
        return (0.72, 0.70, 0.62) if v > -0.3 else (0.85, 0.82, 0.76)
    fish("guppy", 0.02, 0.015, 0.4, 0.55, guppy_c, tail="fan", dorsal=0.2, anal=0.12, tail_len=0.42, tail_h=0.95)

    def cory_c(u, v, part):
        spot = noise.noise(Vector((u * 30, v * 10, 0))) > 0.25
        if part == "fin":
            return (0.6, 0.58, 0.5)
        if v < -0.3:
            return (0.85, 0.80, 0.72)
        return (0.25, 0.24, 0.22) if spot else (0.62, 0.60, 0.52)
    fish("cory", 0.032, 0.023, 0.6, 0.8, cory_c, tail="fork", dorsal=0.18, dorsal_h=0.45, anal=0.1)

    def discus_c(u, v, part):
        k = math.sin(v * 18 + math.sin(u * 14) * 1.6)
        if part == "fin":
            return (0.85, 0.30, 0.15) if abs(v) > 0.8 else (0.25, 0.55, 0.85)
        return (0.85, 0.32, 0.12) if k > 0.35 else (0.18, 0.55, 0.85)
    fish("discus", 0.075, 0.06, 0.82, 0.18, discus_c, tail="fan", dorsal=0.55, anal=0.45, dorsal_h=0.14, anal_h=0.14,
         tail_len=0.12, tail_h=0.35)

    def cichlid_c(u, v, part):
        bar = math.sin(u * 30) > 0.55 and part == "body"
        return (0.12, 0.18, 0.45) if bar else (0.28, 0.55, 0.95) if v > -0.5 else (0.60, 0.75, 0.95)
    fish("cichlid", 0.053, 0.025, 0.66, 0.4, cichlid_c, tail="round", dorsal=0.5, dorsal_h=0.3, anal=0.25)

    def betta_c(u, v, part):
        if part == "fin":
            return mix3((0.55, 0.05, 0.12), (0.15, 0.10, 0.65), 0.5 + 0.5 * math.sin(u * 12 + v * 3))
        return (0.50, 0.06, 0.12)
    fish("betta", 0.037, 0.031, 0.32, 0.5, betta_c, tail="fan", dorsal=0.3, anal=0.5, dorsal_h=0.5, anal_h=0.7,
         tail_len=0.45, tail_h=1.0, fin_long=0.015)

    ORANGE = (0.98, 0.42, 0.04)
    WHITE = (0.96, 0.96, 0.94)
    fish("clown", 0.04, 0.022, 0.62, 0.45,
         stripes(lambda u, v, p: ORANGE, ((0.13, 0.2), (0.4, 0.5), (0.72, 0.76)), WHITE, edge=0.015),
         tail="round", dorsal=0.55, dorsal_h=0.25, anal=0.2)

    def tang_c(u, v, part):
        if u > 0.78:
            return (0.98, 0.85, 0.05)
        if part == "body" and 0.1 < v < 0.6 and 0.2 < u < 0.7:
            return (0.03, 0.04, 0.10)
        return (0.12, 0.30, 0.90)
    fish("tang", 0.06, 0.045, 0.62, 0.22, tang_c, tail="fork", dorsal=0.6, anal=0.45, dorsal_h=0.18, anal_h=0.18, tail_len=0.18)

    def damsel_c(u, v, part):
        return (0.95, 0.85, 0.08) if (u > 0.68 or v < -0.4) else (0.08, 0.25, 0.85)
    fish("damsel", 0.022, 0.014, 0.6, 0.45, damsel_c, tail="fork", dorsal=0.5, dorsal_h=0.25, anal=0.2)

    def goby_c(u, v, part):
        if part == "fin":
            return (0.75, 0.75, 0.70)
        return (0.95, 0.80, 0.10) if noise.noise(Vector((u * 25, v * 6, 2))) < 0.35 else (0.15, 0.55, 0.85)
    fish("goby", 0.03, 0.01, 0.65, 0.9, goby_c, tail="round", dorsal=0.3, dorsal_h=0.6, anal=0.2)

    def yellowtang_c(u, v, part):
        if part == "fin" and u > 0.8:
            return (0.96, 0.92, 0.80)
        return (0.98, 0.84, 0.06)
    fish("yellowtang", 0.05, 0.04, 0.64, 0.24, yellowtang_c, tail="fork", dorsal=0.6, anal=0.45, dorsal_h=0.2, anal_h=0.2, tail_len=0.17)

    def gramma_c(u, v, part):
        return (0.65, 0.12, 0.85) if u < 0.45 else (0.98, 0.82, 0.08)
    fish("gramma", 0.025, 0.012, 0.6, 0.45, gramma_c, tail="fork", dorsal=0.55, anal=0.35)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def load_px(name: str) -> np.ndarray:
    """A baked texture as float rows bottom-up (Blender pixel order), RGB, as stored (no transform)."""
    img = image(name, non_color=True)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[..., :3]


def save_px(name: str, rgb: np.ndarray, quality: int) -> None:
    """Rows bottom-up, values as stored (sRGB for colour maps)."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(os.path.splitext(name)[0], w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    px = np.concatenate([np.clip(rgb, 0, 1), np.ones((h, w, 1), np.float32)], -1).astype(np.float32)
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(BAKED, name)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = quality
    sc.render.image_settings.color_mode = "RGB"
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)
    print("fish atlas", name, w, h, os.path.getsize(path))


def bake_fish_atlas() -> None:
    """Every species' pattern per texel in its side-view tile, times Leather008 scale relief."""
    # side views are long and low: 2:1 atlases, so each species' tile is 2:1 too
    AW, AH = 1024, 512
    albedo = np.full((AH, AW, 3), 0.5, np.float32)
    detail = load_px("scale_detail.jpg")[..., 0]
    nrm_src = load_px("scale_normal.jpg")
    NW, NH = 512, 256
    normal = np.zeros((NH, NW, 3), np.float32)
    normal[..., :] = (0.5, 0.5, 1.0)
    dh, dw = detail.shape
    for f in FISH:
        tx, ty = f["tile"] % TILES, f["tile"] // TILES
        m = TILE_MARGIN
        L, lb, H, Ht = f["L"], f["lb"], f["H"], f["Ht"]
        # physical scale size: ~26 leather cells per body length, square
        reps = 1.3
        aspect = (f["y_hi"] - f["y_lo"]) / (f["z_hi"] - f["z_lo"])
        for tw, th, out, is_n in ((AW // TILES, AH // TILES, albedo, False), (NW // TILES, NH // TILES, normal, True)):
            for py in range(th):
                t = ((py + 0.5) / th - m) / (1 - 2 * m)
                y = f["y_lo"] + t * (f["y_hi"] - f["y_lo"])
                row = np.empty((tw, 3), np.float32)
                for px in range(tw):
                    s = ((px + 0.5) / tw - m) / (1 - 2 * m)
                    z = f["z_hi"] - s * (f["z_hi"] - f["z_lo"])
                    u = (f["z_nose"] - z) / lb
                    inside = False
                    if 0.0 <= u <= 1.0:
                        prof = math.sin(math.pi * min(1.0, 0.08 + u * 0.92) ** 0.75) ** 0.8
                        prof = max(prof, 0.16 * smooth(0.7, 1.0, u))
                        ry = H / 2 * prof * 1.04
                        yc = -H * 0.04 * math.sin(math.pi * u)
                        inside = abs(y - yc) <= ry
                    # tile -> leather: scale cells run along the body
                    sx = (s * reps) % 1.0 * (dw - 1)
                    sy = (t * reps * aspect * 2.2) % 1.0 * (dh - 1)
                    if is_n:
                        row[px] = nrm_src[int(sy), int(sx)] if inside else (0.5, 0.5, 1.0)
                        continue
                    if inside:
                        sy_body = max(-1.0, min(1.0, (y - yc) / max(1e-6, ry)))
                        c = f["colf"](u * (1 - f["tail_len"]), sy_body, "body")
                        if 0.2 < u < 0.235:
                            c = (c[0] * 0.62, c[1] * 0.62, c[2] * 0.62)
                        k = detail[int(sy), int(sx)]
                    else:
                        if z < f["z_ped"]:
                            uu = 1 - f["tail_len"] + f["tail_len"] * min(1.0, (f["z_ped"] - z) / max(1e-6, L * f["tail_len"] + f["fin_long"]))
                            vv = max(-1.0, min(1.0, y / max(1e-6, f["th"])))
                        else:
                            uu = max(0.0, min(1.0, (f["z_nose"] - z) / L))
                            vv = 1.0 if y > 0 else -1.0
                        c = f["fin_col"](uu, vv) if f["fin_col"] else f["colf"](uu, vv, "fin")
                        # membrane: the relief stretched into soft streaks along the rays
                        k = 0.94 + 0.06 * (detail[int(sy * 0.25) % dh, int(sx)] - 1.0) / 0.14
                    row[px] = (c[0] * k, c[1] * k, c[2] * k)
                if is_n:
                    out[ty * th + py, tx * tw:(tx + 1) * tw] = row
                else:
                    # colour functions are authored sRGB; the JPEG stores sRGB
                    out[ty * th + py, tx * tw:(tx + 1) * tw] = np.clip(row, 0, 1)
    save_px("fish_albedo.jpg", albedo, 82)
    save_px("fish_normal.jpg", normal, 80)


# ------------------------------------------------------------------ build
def build() -> dict:
    clear_all()
    noise.seed_set(4242)
    global M_FISH, M_FIN, M_EYE
    sand = pbr("sand", "sand_albedo.jpg", "sand_normal.jpg", rough=0.95)
    reefsand = pbr("reef-sand", "reefsand_albedo.jpg", "reefsand_normal.jpg", rough=0.92)
    stone = pbr("seiryu-stone", "stone_albedo.jpg", "stone_normal.jpg", rough=0.78)
    wood = pbr("driftwood", "wood_albedo.jpg", "wood_normal.jpg", rough=0.72)
    plant = pbr("plant", "plants_albedo.jpg", "plants_normal.jpg", rough=0.5, double=True, normal_strength=0.6)
    moss = pbr("moss", "moss_albedo.jpg", "moss_normal.jpg", rough=0.9)
    liverock = pbr("live-rock", "liverock_albedo.jpg", "liverock_normal.jpg", rough=0.82)
    coral = pbr("coral", "coral_albedo.jpg", "coral_normal.jpg", rough=0.7)
    fan = pbr("sea-fan", "fan_lattice.png", None, rough=0.7, double=True, clip=True)

    sub = bed("substrate", sand, 0.0, 1.7, (1.0, 0.98, 0.95), (44, 36))
    reef_bed = bed("reef-sand", reefsand, 0.009, 1.4, (1.0, 1.0, 1.0), (36, 30))
    rocks = build_rocks_fresh(stone)
    drift, roots = build_driftwood(wood)
    fern = build_fern(plant, roots)
    vall = build_vallisneria(plant)
    rot = build_rotala(plant)
    mo = build_moss(moss)
    lrock = build_rocks_reef(liverock)
    stag = build_staghorn(coral)
    brain = build_brain(coral)
    fans = build_fans(fan)
    anem = build_anemone(coral)

    # AO: the beds from everything standing on them; stone and wood from each other and the bed
    fresh_solid = [rocks, drift, mo]
    fresh_all = fresh_solid + [fern, vall, rot]
    reef_all = [lrock, stag, brain, anem]
    bake_ao(sub, bvh_of(fresh_all), 0.28, 0.65, 32, up_only=True)
    bake_ao(reef_bed, bvh_of(reef_all), 0.28, 0.65, 32, up_only=True)
    for ob, others in ((rocks, [drift, sub]), (drift, [rocks, sub]), (lrock, [reef_bed, stag, brain])):
        bake_ao(ob, bvh_of([ob] + others), 0.12, 0.6, 16)

    M_FISH = pbr("fish-skin", "fish_albedo.jpg" if os.path.exists(os.path.join(BAKED, "fish_albedo.jpg")) else None,
                 None, rough=0.32, coat=0.6, coat_rough=0.08)
    M_FIN = pbr("fish-fin", None, None, rough=0.4, double=True, alpha=0.78)
    M_EYE = pbr("fish-eye", None, None, rough=0.08, coat=1.0, coat_rough=0.02)
    build_fish()
    bake_fish_atlas()
    for m, tex, nrm in ((M_FISH, "fish_albedo.jpg", "fish_normal.jpg"), (M_FIN, "fish_albedo.jpg", None)):
        rewire(m, tex, nrm)

    print("fish mesh validation:")
    bad = [r for r in REPORT if not r["ok"]]
    for r in REPORT:
        print(f"  {r['name']:16s} faces {r['faces']:5d} boundary {r['boundary']} non-manifold {r['non_manifold']} "
              f"zero-area {r['zero_area']} volume {r['volume']:.3e} {'OK' if r['ok'] else 'FAIL'}")
    if bad:
        raise SystemExit("fish validation failed: " + ", ".join(r["name"] for r in bad))
    parts = {o.name: tris(o.data) for o in bpy.data.objects if o.type == "MESH"}
    print("parts", json.dumps(parts))
    return {"parts": parts, "fish_validation": [{k: v for k, v in r.items() if k != "volume"} for r in REPORT]}


def rewire(m, albedo: str, normal: str | None) -> None:
    """Point a fish material at the baked atlas (it was created before the atlas existed)."""
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for n in [n for n in nt.nodes if n.type in ("TEX_IMAGE", "VERTEX_COLOR", "NORMAL_MAP")]:
        nt.nodes.remove(n)
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = image(albedo)
    t.image.reload()
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    if normal:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = image(normal, non_color=True)
        tn.image.reload()
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])


def export_glb(path: str) -> None:
    kw = dict(
        filepath=path, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=False, export_skins=False,
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
    subprocess.run([GLTFPACK, "-i", raw, "-o", dest, "-cc", "-kn", "-km", "-vpf"], check=True)
    print("packed", dest, os.path.getsize(dest))


# ------------------------------------------------------------------ verify the packed GLB
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


def verify(path: str) -> dict:
    j = glb_json(path)
    clear_all()
    bpy.ops.import_scene.gltf(filepath=decode(path))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    nodes = sorted(n.get("name", "") for n in j["nodes"] if n.get("name"))
    pos_float = all(j["accessors"][p["attributes"]["POSITION"]]["componentType"] == 5126
                    for m in j["meshes"] for p in m["primitives"])
    has_col = all("COLOR_0" in p["attributes"] for m in j["meshes"] for p in m["primitives"])
    info = {
        "bytes": os.path.getsize(path), "sha256": sha256(path), "triangles": glb_tris(j),
        "nodes": nodes, "images": len(j.get("images", [])), "extensions": j.get("extensionsUsed", []),
        "position_float": pos_float, "color_0_everywhere": has_col,
        "alpha_modes": sorted({m.get("alphaMode", "OPAQUE") + ":" + m.get("name", "") for m in j.get("materials", [])}),
        "reimported_meshes": len(meshes),
    }
    bad = []
    if not pos_float:
        bad.append("positions are quantized (the host bends fish from local position)")
    if not has_col:
        bad.append("a primitive has no COLOR_0 (the host forces vertexColors)")
    for need in ["substrate", "fresh-rocks", "fresh-driftwood", "fresh-plant-fern", "fresh-plant-vallisneria",
                 "fresh-plant-rotala", "fresh-plant-moss", "reef-rocks", "reef-coral-staghorn", "reef-coral-brain",
                 "reef-coral-fan", "reef-anemone", "reef-sand"]:
        if need not in nodes:
            bad.append(f"missing {need}")
    for sp in ["neon", "angel", "guppy", "cory", "discus", "cichlid", "betta", "clown", "tang", "damsel", "goby", "yellowtang", "gramma"]:
        for part in (f"fish-{sp}", f"{sp}-body", f"{sp}-fins", f"{sp}-eyes"):
            if part not in nodes:
                bad.append(f"missing {part}")
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
        nan = sum(1 for v in bm.verts if any(math.isnan(c) for c in v.co))
        bm.free()
        if degenerate > len(o.data.polygons) * 0.01 or nan:
            bad.append({"mesh": o.name, "degenerate": degenerate, "nan": nan})
        if not o.name.endswith("-eyes") and not o.data.uv_layers:
            bad.append({"mesh": o.name, "uv": "missing"})
        if o.name in ("substrate", "reef-sand"):
            up = sum(p.normal.z * p.area for p in o.data.polygons) / sum(p.area for p in o.data.polygons)
            info.setdefault("facing_up", {})[o.name] = round(up, 3)
            if up < 0.8:
                bad.append({"mesh": o.name, "facing_up": up})
    info["problems"] = bad
    print("verify", json.dumps({k: v for k, v in info.items() if k != "nodes"}))
    return info


def render_previews(dest: str) -> None:
    """EEVEE stills of the fresh and reef scape (reviewer aid; not shipped)."""
    os.makedirs(dest, exist_ok=True)
    sc = bpy.context.scene
    names = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in names else names[0]
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.view_settings.view_transform = "Standard"
    world = sc.world or bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.08, 0.12, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    for k, (loc, e, s) in enumerate((((0, 0, 1.6), 260, 2.4), ((-1.8, -2.5, 0.8), 60, 1.5), ((1.8, -2.5, 0.2), 30, 1.5))):
        ld = bpy.data.lights.new(f"l{k}", "AREA")
        ld.energy, ld.size = e, s
        lo = bpy.data.objects.new(f"l{k}", ld)
        lo.location = loc
        sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0, 0, -0.4)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("cam")
    cd.angle_y = math.radians(38)
    cd.sensor_fit = "VERTICAL"
    cd.clip_start = 0.002
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = G(0, 0.0, 3.0)
    co.rotation_euler = (G(0, -0.25, 0) - co.location).to_track_quat("-Z", "Y").to_euler()
    fishes = sorted([o for o in bpy.data.objects if o.name.startswith("fish-")], key=lambda o: o.name)
    spots = [(-0.7, 0.2, 0.2), (-0.3, 0.35, 0.0), (0.2, 0.1, 0.3), (0.6, 0.3, -0.1), (0.0, -0.3, 0.4), (-0.6, -0.15, -0.2),
             (0.75, -0.1, 0.25), (-0.15, 0.55, -0.3), (0.4, 0.55, 0.1), (-0.9, 0.5, -0.2), (0.9, 0.55, -0.4), (0.1, -0.55, 0.45),
             (-0.35, -0.5, 0.45)]
    for o, (x, y, z) in zip(fishes, spots):
        o.location = G(x, y, z)
        o.rotation_euler = (0, 0, 0.6 if x < 0 else -0.6)
    for reef in (False, True):
        for o in bpy.data.objects:
            if o.type == "MESH" and not o.parent:
                o.hide_render = o.name.startswith("reef-") != reef and not o.name == "substrate"
        sc.render.filepath = os.path.join(dest, f"blender-render-{'reef' if reef else 'fresh'}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", sc.render.filepath)
    for o in fishes:
        o.location = (0, 0, 0)
        o.rotation_euler = (0, 0, 0)


def main() -> None:
    built = build()
    if RENDER:
        render_previews(RENDER)
        for o in [o for o in bpy.data.objects if o.type in ("LIGHT", "CAMERA")]:
            bpy.data.objects.remove(o, do_unlink=True)
        for o in bpy.data.objects:
            o.hide_render = False
    raw = os.path.join(RAW, GLB)
    export_glb(raw)
    os.makedirs(ASSETS, exist_ok=True)
    dest = os.path.join(ASSETS, GLB)
    gltfpack(raw, dest)
    info = verify(dest)
    meta = {GLB: {**info, **built}}
    meta_path = os.path.join(OUT, "blender", "build_scape_hd_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, sort_keys=True)
        f.write("\n")
    print("META", meta_path, "problems", info["problems"] or "none")
    if info["problems"]:
        raise SystemExit(f"integrity problems: {info['problems']}")
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
