"""Bonsai generator (Blender 5.x, run with the GUI visible).

  .venv/bin/python plugins/src/bonsai/blender/fetch_sources.py   # CC0 maps -> out/sources/bonsai/prep
  blender --gpu-backend vulkan --window-geometry 1400 0 1400 900 \
      --python plugins/src/bonsai/blender/build_bonsai.py -- --out plugins/src/bonsai

Builds a slab-planted bonsai on a garden bench, per model set (Standard and HD):
  assets/bonsai-base[-hd].glb  bench top, oval display board, the scanned stone slab (Poly Haven
                               boulder scan, decimated and flattened), moss mounds, contact shadow
  assets/bonsai-tree[-hd].glb  trunk, nebari roots, branches and twigs (one geometry-node sweep over a
                               Python skeleton, zelkova bark scan), foliage (leaf cards instanced on
                               pad domes by geometry nodes, scanned periwinkle leaf alpha), the
                               blossom-card and falling-leaf templates
Ambient occlusion is ray-cast into COLOR_0 (24 fixed hemisphere rays per vertex). Foliage COLOR_0 is
data, not colour: r = AO, g = (pad + 0.5) / 16, b = the leaf's density rank; the host scenery
decodes it. Exports go through gltfpack (-cc -kn -km); writes blender/build_bonsai_meta.json and
frontend/bonsai-data.ts (pads, ground heights, camera in glTF Y-up metres). Deterministic.
"""
import bpy, bmesh, math, json, os, sys, subprocess, hashlib, random, struct
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.getcwd()
SETS = [argv[argv.index("--set") + 1]] if "--set" in argv else ["standard", "hd"]
RENDER = "--no-render" not in argv
QUIT = "--keep-open" not in argv
ROOT = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SRC = os.path.join(ROOT, "out", "sources", "bonsai")
PREP = os.path.join(SRC, "prep")
BUILD = os.path.join(SRC, "build")
SHOTS = os.path.abspath(argv[argv.index("--shots") + 1]) if "--shots" in argv else os.path.join(ROOT, "out", "shots", "bonsai")
GLTFPACK = os.environ.get("GLTFPACK") or os.path.join(ROOT, "out", "tools", "node_modules", ".bin", "gltfpack")
TAU = math.tau
MAX_PADS = 16

# ---------------------------------------------------------------- layout (Blender Z-up metres, front = -Y)
BOARD_RX, BOARD_RY, BOARD_T = 0.40, 0.27, 0.028
FEET_H = 0.008
TABLE_Z = -(BOARD_T + FEET_H)          # bench top
SLAB_W = 0.58                          # scanned boulder scaled to this width ...
SLAB_H = 0.105                         # ... and flattened to this height
TRUNK_XY = (-0.045, 0.035)
BARK_TILE = 0.075                      # metres of trunk per bark texture repeat
TREE_SEED = 7

# trunk centreline relative to its base on the slab: (x, y, z, radius)
TRUNK = [(0.0, 0.0, -0.014, 0.074), (0.008, 0.0, 0.028, 0.058), (0.030, -0.004, 0.080, 0.047),
         (0.038, 0.002, 0.140, 0.039), (0.016, 0.010, 0.195, 0.032), (-0.020, 0.006, 0.245, 0.026),
         (-0.032, -0.004, 0.295, 0.020), (-0.014, 0.0, 0.340, 0.015), (0.004, 0.002, 0.382, 0.010)]
# branches: (trunk t, azimuth deg (0 = +X right, 90 = back), reach m, pad radii (x, y, z) m, secondary)
BRANCHES = [
    (0.30, 178, 0.230, (0.100, 0.080, 0.046), (-62, 0.55, 0.10, (0.066, 0.056, 0.036))),
    (0.42, 4, 0.190, (0.090, 0.072, 0.044), (70, 0.55, 0.085, (0.060, 0.050, 0.034))),
    (0.50, 112, 0.135, (0.078, 0.066, 0.040), None),
    (0.57, 62, 0.110, (0.068, 0.058, 0.037), None),
    (0.63, 206, 0.135, (0.072, 0.060, 0.038), (60, 0.5, 0.065, (0.052, 0.044, 0.030))),
    (0.72, -24, 0.105, (0.066, 0.056, 0.036), None),
    (0.80, 140, 0.080, (0.058, 0.050, 0.033), None),
    (0.86, 28, 0.064, (0.052, 0.046, 0.031), None),
]
APEX_PAD = (0.074, 0.064, 0.046)
ROOTS = [(-150, 0.10), (-95, 0.085), (-30, 0.11), (40, 0.075), (120, 0.09), (190, 0.07)]

# atlas tiles (col, row) in the 4 x 2 leaf atlas; autumn = +2 columns
LEAF_TILES = [(0, 0), (1, 0), (0, 1)]
BLOSSOM_TILE = (1, 1)
FALL_TILE = (2, 0)                     # the scanned yellow leaf: the host tints it red / orange / gold

# HD: willow bark at a coarser repeat, a deeper root flare (lobes run up the trunk from these roots),
# and the HD atlas rects (fetch_sources.py hd_leaf_atlas, px in the shipped 1024 x 512 atlas)
BARK_TILE_HD = 0.11
ROOTS_HD = [(-158, 0.13, 1.0), (-120, 0.085, 0.7), (-84, 0.11, 0.9), (-38, 0.14, 1.0), (4, 0.075, 0.6),
            (42, 0.10, 0.85), (88, 0.07, 0.55), (128, 0.115, 0.9), (172, 0.09, 0.75), (214, 0.08, 0.65)]
TRUNK_TWIST = 2.4                      # radians per metre the flutes spiral up the trunk
HD_SEED = 23


def hd_atlas():
    return json.load(open(os.path.join(PREP, "atlas.json")))["hd"]


def gl(v):  # Blender Z-up -> glTF Y-up
    return [round(v[0], 5) + 0.0, round(v[2], 5) + 0.0, round(-v[1], 5) + 0.0]


# ---------------------------------------------------------------- materials
IMG = {}
def img(set_name, name, data=False):
    path = os.path.join(PREP, set_name, name)
    if not os.path.isfile(path):
        path = os.path.join(PREP, "standard", name)
    if path not in IMG:
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = "Non-Color" if data else "sRGB"
        IMG[path] = im
    return IMG[path]


def mat(name, set_name, diff, nrm=None, rough=0.6, clip=False, blend=False, emit=None, emit_strength=0.0,
        nrm_strength=1.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = rough
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(set_name, diff)
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if clip:
        # Round on alpha is how the glTF exporter recognises alphaMode MASK (cutoff 0.5)
        r = nt.nodes.new("ShaderNodeMath"); r.operation = "ROUND"
        nt.links.new(t.outputs["Alpha"], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs["Alpha"])
        m.use_backface_culling = False
    if blend:
        nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
        try:
            m.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            m.blend_method = "BLEND"
    if nrm:
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img(set_name, nrm, data=True)
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = nrm_strength
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emit:
        te = nt.nodes.new("ShaderNodeTexImage"); te.image = img(set_name, emit)
        nt.links.new(te.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emit_strength
    if sheen > 0 and "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = sheen
    return m


def materials(s):
    hd = s == "hd"
    M = {}
    M["bark"] = mat("bark", s, "bark_diff.jpg", "bark_nrm.jpg" if hd else None, rough=0.85, nrm_strength=1.2)
    M["rock"] = mat("rock", s, "rock_diff.jpg", "rock_nrm.jpg" if hd else None, rough=0.8)
    M["moss"] = mat("moss", s, "moss_diff.jpg", "moss_nrm.jpg" if hd else None, rough=0.95)
    M["wood"] = mat("wood", s, "wood_diff.jpg", rough=0.62)
    M["bench"] = mat("bench", s, "bench_diff.jpg", rough=0.7)
    M["leaf"] = mat("leaf", s, "leaf_atlas.png", rough=0.72, clip=True)
    M["blossom"] = mat("blossom", s, "leaf_atlas.png", rough=0.72, clip=True)
    M["fall"] = mat("falling-leaf", s, "leaf_atlas.png", rough=0.72, clip=True)
    M["shadow"] = mat("contact-shadow", s, "contact_shadow.png", rough=1.0, blend=True)
    if hd:
        M["fronds"] = mat("moss-fronds", s, "moss_fronds.png", rough=0.95, clip=True)
    return M


# ---------------------------------------------------------------- mesh helpers
COLL = {}
def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    COLL[name] = c
    return c


def smooth_all(bm, angle=None):
    for f in bm.faces:
        f.smooth = True
    if angle is not None:
        lim = math.radians(angle)
        for e in bm.edges:
            if len(e.link_faces) != 2 or e.calc_face_angle(0.0) > lim:
                e.smooth = False


def box_uv(bm, s=0.25, off=(0.0, 0.0), rot=False):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            u, v = (c.x, c.y) if ax == 2 else ((c.x, c.z) if ax == 1 else (c.y, c.z))
            if rot:
                u, v = v, u
            l[uv].uv = (u / s + off[0], v / s + off[1])


def new_obj(name, bm, m, coll, loc=(0, 0, 0), uv=None, smooth=35.0, recalc=True, uv_rot=False):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if uv is not None:
        box_uv(bm, uv, rot=uv_rot)
    if smooth is not None:
        smooth_all(bm, smooth if smooth < 90 else None)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    me.materials.append(m)
    coll.objects.link(ob)
    return ob


def quad(bm, size, tile=None, centre=(0.0, 0.0), stem=False):
    """Unit card in the XY plane (normal +Z). `tile` maps it onto one atlas cell; `stem` puts the
    origin at the card's top edge (the leaf stem) with the leaf running along +Y."""
    uvl = bm.loops.layers.uv.verify()
    w = size
    y0 = 0.0 if stem else -size / 2
    vs = [bm.verts.new((centre[0] - w / 2, centre[1] + y0, 0)), bm.verts.new((centre[0] + w / 2, centre[1] + y0, 0)),
          bm.verts.new((centre[0] + w / 2, centre[1] + y0 + size, 0)), bm.verts.new((centre[0] - w / 2, centre[1] + y0 + size, 0))]
    f = bm.faces.new(vs)
    c, r = tile if tile else (0, 0)
    u0, u1 = (c / 4, (c + 1) / 4) if tile else (0.0, 1.0)
    vt, vb = (1 - r / 2, 1 - (r + 1) / 2) if tile else (1.0, 0.0)
    # image top (stem) at the card's y0 edge
    for l, (u, v) in zip(f.loops, ((u0, vt), (u1, vt), (u1, vb), (u0, vb))):
        l[uvl].uv = (u, v)
    return f



def canonical(bm):
    """Sort verts by position and faces by their verts. remove_doubles (also inside create_uvsphere)
    keeps a run-dependent one of each duplicate, so element order, and everything that follows it
    (point distribution, AO, export), would differ between builds."""
    def by(seq, key):
        seq.index_update()
        rank = {e.index: r for r, e in enumerate(sorted(seq, key=key))}
        seq.sort(key=lambda e: rank[e.index])
        seq.index_update()

    by(bm.verts, lambda v: (v.co.x, v.co.y, v.co.z))
    by(bm.faces, lambda f: sorted(v.index for v in f.verts))
    by(bm.edges, lambda e: sorted(v.index for v in e.verts))


# ---------------------------------------------------------------- geometry nodes
class GN:
    """Tiny builder: one GN tree, evaluated (on an empty mesh or on `ob`) to a plain bmesh."""

    def __init__(self, name, with_input=False):
        self.ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
        if with_input:
            self.ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
            self.inp = self.ng.nodes.new("NodeGroupInput").outputs[0]
        self.ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
        self.out = self.ng.nodes.new("NodeGroupOutput")

    def n(self, kind, inputs=None, **props):
        node = self.ng.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        for k, v in (inputs or {}).items():
            self.feed(node.inputs[k], v)
        return node

    def feed(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.ng.links.new(v, sock)
        elif isinstance(v, (list, tuple)) and v and isinstance(v[0], bpy.types.NodeSocket):
            for s in v:
                self.ng.links.new(s, sock)
        else:
            sock.default_value = v

    def math(self, op, a, b=0.0):
        return self.n("ShaderNodeMath", {0: a, 1: b}, operation=op).outputs[0]

    def mad(self, a, b, c):
        return self.n("ShaderNodeMath", {0: a, 1: b, 2: c}, operation="MULTIPLY_ADD").outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        node = self.n("ShaderNodeVectorMath", operation=op)
        self.feed(node.inputs[0], a)
        if b is not None:
            self.feed(node.inputs[1], b)
        if scale is not None:
            self.feed(node.inputs["Scale"], scale)
        return node.outputs["Vector"]

    def xyz(self, x=0.0, y=0.0, z=0.0):
        return self.n("ShaderNodeCombineXYZ", {"X": x, "Y": y, "Z": z}).outputs[0]

    def sep(self, v):
        return self.n("ShaderNodeSeparateXYZ", {"Vector": v}).outputs

    def pos(self):
        return self.n("GeometryNodeInputPosition").outputs[0]

    def named(self, name, dtype="FLOAT"):
        return self.n("GeometryNodeInputNamedAttribute", {"Name": name}, data_type=dtype).outputs["Attribute"]

    def store(self, geo, name, value, dtype="FLOAT", domain="POINT"):
        node = self.ng.nodes.new("GeometryNodeStoreNamedAttribute")
        node.data_type = dtype
        node.domain = domain
        node.inputs["Name"].default_value = name
        self.feed(node.inputs["Geometry"], geo)
        self.feed(node.inputs["Value"], value)
        return node.outputs["Geometry"]

    def rand(self, lo, hi, seed, dtype="FLOAT"):
        node = self.ng.nodes.new("FunctionNodeRandomValue")
        node.data_type = dtype
        node.inputs["Min"].default_value = lo
        node.inputs["Max"].default_value = hi
        node.inputs["Seed"].default_value = seed
        return node.outputs["Value"]

    def xform(self, geo, t=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
        node = self.n("GeometryNodeTransform", {"Geometry": geo})
        node.inputs["Translation"].default_value = t
        node.inputs["Rotation"].default_value = r
        node.inputs["Scale"].default_value = s
        return node.outputs["Geometry"]

    def join(self, *geos):
        return self.n("GeometryNodeJoinGeometry", {"Geometry": list(geos)}).outputs["Geometry"]

    def mesh(self, geo, ob=None):
        """Evaluate to a new Mesh datablock (FLOAT_VECTOR corner attribute `uvw` becomes UVMap)."""
        self.ng.links.new(geo, self.out.inputs[0])
        tmp = None
        if ob is None:
            tmp = bpy.data.meshes.new(self.ng.name + "-src")
            ob = bpy.data.objects.new(self.ng.name + "-src", tmp)
            bpy.context.scene.collection.objects.link(ob)
        mod = ob.modifiers.new("gn", "NODES"); mod.node_group = self.ng
        dg = bpy.context.evaluated_depsgraph_get()
        res = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.remove(mod)
        if tmp is not None:
            bpy.data.objects.remove(ob, do_unlink=True); bpy.data.meshes.remove(tmp)
        bpy.data.node_groups.remove(self.ng)
        vec_to_uv(res)
        return res

    def bmesh(self, geo, ob=None, merge=1e-7):
        res = self.mesh(geo, ob)
        bm = bmesh.new(); bm.from_mesh(res); bpy.data.meshes.remove(res)
        if merge:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
        return bm


def vec_to_uv(me, name="uvw"):
    a = me.attributes.get(name)
    if a is None:
        return
    n = len(me.loops)
    buf = [0.0] * (n * 3)
    a.data.foreach_get("vector", buf)
    me.attributes.remove(me.attributes[name])
    for layer in list(me.uv_layers):
        me.uv_layers.remove(layer)
    uv = me.uv_layers.new(name="UVMap")
    flat = [0.0] * (n * 2)
    flat[0::2] = buf[0::3]
    flat[1::2] = buf[1::3]
    uv.data.foreach_set("uv", flat)


# ---------------------------------------------------------------- AO (ray-cast, deterministic)
def hemisphere(n):
    """Cosine-weighted Fibonacci directions on the +Z hemisphere."""
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        a = i * ga
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - r * r)))))
    return out


def bvh_of(objs):
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in objs:
        me = ob.evaluated_get(dg).to_mesh()
        base = len(verts)
        mw = ob.matrix_world
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        ob.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


def bake_ao(ob, tree, reach, strength=0.8, rays=24, floor=0.25):
    me = ob.data
    dirs = hemisphere(rays)
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    vals = []
    for v in me.vertices:
        p = mw @ v.co
        n = (nm @ v.normal).normalized()
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = p + n * 0.0008
        hit = 0.0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            loc, _, _, dist = tree.ray_cast(o, w, reach)
            if loc is not None:
                hit += 1.0 - 0.5 * dist / reach
        vals.append(max(floor, 1.0 - strength * hit / rays))
    set_color(me, [(a, a, a) for a in vals])


def set_color(me, rgb):
    a = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    flat = []
    for c in rgb:
        flat.extend((c[0], c[1], c[2], 1.0))
    a.data.foreach_set("color", flat)
    try:
        me.color_attributes.active_color = a
        me.color_attributes.render_color_index = list(me.color_attributes).index(a)
    except (AttributeError, TypeError, ValueError):
        pass


# ---------------------------------------------------------------- base: bench, board, slab, moss
def build_slab(hd, m):
    src = json.load(open(os.path.join(PREP, "boulder", "source.json")))["gltf"]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    ob = meshes[0]
    for o in new:
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    ob.parent = None
    me = ob.data.copy()
    me.transform(ob.matrix_world)
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bpy.data.objects.remove(ob, do_unlink=True)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    s = SLAB_W / (max(xs) - min(xs))
    sz = SLAB_H / (max(zs) - min(zs))
    z0 = min(zs)
    for v in bm.verts:
        v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s * 1.05, (v.co.z - z0) * sz - 0.006))
    # the scan's own UVs and material stay; decimate to the set's budget (collapse keeps UV seams)
    tmp = bpy.data.meshes.new("slab-tmp"); bm.to_mesh(tmp); bm.free()
    o = bpy.data.objects.new("slab-tmp", tmp); bpy.context.scene.collection.objects.link(o)
    target = 9000 if hd else 2400
    dec = o.modifiers.new("dec", "DECIMATE"); dec.ratio = target / max(1, len(tmp.polygons) * 1.0)
    dec.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    res = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o, do_unlink=True); bpy.data.meshes.remove(tmp)
    for layer in list(res.uv_layers)[1:]:
        res.uv_layers.remove(layer)
    if res.uv_layers:
        res.uv_layers[0].name = "UVMap"
    res.materials.clear()
    res.materials.append(m)
    for p in res.polygons:
        p.use_smooth = True
    return res


def build_moss(slab_ob, hd, m, seed):
    """Moss carpet: the slab's upward faces around the trunk foot and in noise-shaped patches, lifted
    off the stone by a bumpy cushion that tapers to the stone at the patch rim."""
    g = GN("moss", with_input=True)
    nrm = g.n("GeometryNodeInputNormal").outputs[0]
    nz = g.sep(nrm)[2]
    p = g.sep(g.pos())
    dx = g.math("SUBTRACT", p[0], TRUNK_XY[0]); dy = g.math("SUBTRACT", p[1], TRUNK_XY[1])
    near = g.math("SQRT", g.math("ADD", g.math("MULTIPLY", dx, dx), g.math("MULTIPLY", dy, dy)))
    tex = g.n("ShaderNodeTexNoise", {"Vector": g.pos(), "Scale": 7.0, "Detail": 3.0, "Roughness": 0.6})
    patch = g.math("GREATER_THAN", tex.outputs["Fac"], 0.5 if hd else 0.55)
    ring = g.math("LESS_THAN", g.math("ADD", near, g.math("MULTIPLY", tex.outputs["Fac"], 0.06)), 0.17 if hd else 0.15)
    up = g.math("GREATER_THAN", nz, 0.5)
    keep = g.math("MULTIPLY", up, g.math("MAXIMUM", ring, patch))
    geo = g.n("GeometryNodeDeleteGeometry", {"Geometry": g.inp, "Selection": g.math("LESS_THAN", keep, 0.5)},
              domain="FACE").outputs["Geometry"]
    if hd:
        geo = g.n("GeometryNodeSubdivideMesh", {"Mesh": geo, "Level": 1}).outputs[0]
    rim = g.math("LESS_THAN", g.n("GeometryNodeInputMeshEdgeNeighbors").outputs["Face Count"], 1.5)
    on_edges = g.n("GeometryNodeFieldOnDomain", {"Value": rim}, domain="EDGE", data_type="FLOAT").outputs[0]
    inner = g.math("LESS_THAN", on_edges, 0.001)
    bump = g.n("ShaderNodeTexNoise", {"Vector": g.pos(), "Scale": 55.0, "Detail": 4.0, "Roughness": 0.65})
    lift = g.mad(g.math("MULTIPLY", inner, g.mad(bump.outputs["Fac"], 0.013 if hd else 0.009, -0.0015)), 1.0, 0.0007)
    geo = g.n("GeometryNodeSetPosition", {"Geometry": geo, "Offset": g.vmath("SCALE", nrm, scale=lift)}).outputs["Geometry"]
    bm = g.bmesh(geo, ob=slab_ob)
    if hd:
        moss_cushions(bm, slab_ob, random.Random(seed))
        canonical(bm)
    box_uv(bm, 0.035)
    return bm


def moss_cushions(bm, slab_ob, rng):
    """HD: lumpy moss cushions sat on the slab's upper faces, clear of the trunk foot."""
    hit = bvh_of([slab_ob])
    spots, tries = [], 0
    while len(spots) < 12 and tries < 2000:
        tries += 1
        x, y = rng.uniform(-SLAB_W * 0.46, SLAB_W * 0.46), rng.uniform(-0.2, 0.2)
        loc, nrm, _, _ = hit.ray_cast(Vector((x, y, 1.0)), Vector((0, 0, -1)), 3.0)
        if loc is None or nrm.z < 0.75 or loc.z < 0.035:
            continue
        if math.hypot(x - TRUNK_XY[0], y - TRUNK_XY[1]) < 0.15:
            continue
        if any(math.hypot(x - sx, y - sy) < 0.045 for sx, sy, _ in spots):
            continue
        spots.append((x, y, loc.z))
    for i, (x, y, z) in enumerate(spots):
        r = rng.uniform(0.014, 0.03)
        res = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=1.0)
        off = Vector((x, y, 0.0)) * 37.0 + Vector((i * 3.1, 0.0, 0.0))
        for v in res["verts"]:
            c = v.co.copy()
            if c.z < 0:
                c.z *= 0.15
            s = r * (1.0 + 0.38 * noise.noise(c * 1.8 + off) + 0.12 * noise.noise(c * 5.0 + off))
            v.co = Vector((x + c.x * s * 1.3, y + c.y * s, z - 0.004 + c.z * s * 0.4))
    return len(spots)


def moss_fronds(moss_ob):
    """HD: the scanned moss_01 frond cards stood up on the moss carpet and cushions (normal = the
    carpet's, so they light as one soft surface)."""
    g = GN("moss-fronds", with_input=True)
    nrm = g.n("GeometryNodeInputNormal").outputs[0]
    up = g.math("GREATER_THAN", g.sep(nrm)[2], 0.3)
    d = 0.0056
    dist = g.n("GeometryNodeDistributePointsOnFaces", {"Mesh": g.inp, "Selection": up, "Distance Min": d,
                                                        "Density Max": 4.0 / (d * d), "Seed": 5},
               distribute_method="POISSON")
    cards = []
    for i in range(4):
        grid = g.n("GeometryNodeMeshGrid", {"Size X": 0.5, "Size Y": 1.0, "Vertices X": 2, "Vertices Y": 2})
        uvf = g.sep(grid.outputs["UV Map"])
        geo = g.store(grid.outputs["Mesh"], "uvw", g.xyz(g.mad(uvf[0], 0.25, i / 4), uvf[1], 0.0), "FLOAT_VECTOR", "CORNER")
        # frond standing along +Z, its dark stalk sunk into the carpet
        cards.append(g.xform(g.xform(geo, t=(0, 0.2, 0)), r=(math.pi / 2, 0, 0)))
    inst = g.n("GeometryNodeGeometryToInstance", {"Geometry": cards}).outputs["Instances"]
    r1 = g.n("FunctionNodeAlignRotationToVector", {"Vector": dist.outputs["Normal"]}, axis="Z").outputs[0]
    tw = g.n("FunctionNodeAxisAngleToRotation", {"Axis": (0.0, 0.0, 1.0), "Angle": g.rand(0.0, TAU, 61)}).outputs[0]
    tl = g.n("FunctionNodeAxisAngleToRotation", {"Axis": (1.0, 0.0, 0.0), "Angle": g.rand(-0.45, 0.45, 62)}).outputs[0]
    rot = g.n("FunctionNodeRotateRotation", {"Rotation": r1, "Rotate By": tw}, rotation_space="LOCAL").outputs[0]
    rot = g.n("FunctionNodeRotateRotation", {"Rotation": rot, "Rotate By": tl}, rotation_space="LOCAL").outputs[0]
    iop = g.n("GeometryNodeInstanceOnPoints", {"Points": dist.outputs["Points"], "Instance": inst, "Pick Instance": True,
                                              "Instance Index": g.rand(0, 3, 63, "INT"), "Rotation": rot,
                                              "Scale": g.rand(0.006, 0.012, 64)}).outputs["Instances"]
    iop = g.store(iop, "bent", dist.outputs["Normal"], "FLOAT_VECTOR", "INSTANCE")
    real = g.n("GeometryNodeRealizeInstances", {"Geometry": iop}).outputs["Geometry"]
    me = g.mesh(real, ob=moss_ob)
    bent = me.attributes.get("bent")
    nb = [0.0] * (len(me.vertices) * 3)
    bent.data.foreach_get("vector", nb)
    me.attributes.remove(bent)
    return me, [Vector(nb[i:i + 3]).normalized() for i in range(0, len(nb), 3)]


def bake_slab(slab_ob, M):
    """HD: bake the boulder scan blended with the mossy_rock scan on its upper faces (noise-broken)
    into one 512 px albedo on the scan's UVs, and use it as the slab's colour map."""
    sc = bpy.context.scene
    engine = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.cycles.device = "CPU"
    target = bpy.data.images.new("rock_moss_diff", 512, 512, alpha=False)
    bm_ = bpy.data.materials.new("rock-bake"); bm_.use_nodes = True
    nt = bm_.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    rock = nt.nodes.new("ShaderNodeTexImage"); rock.image = img("hd", "rock_diff.jpg")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (4.0, 4.0, 4.0)
    moss = nt.nodes.new("ShaderNodeTexImage"); moss.image = img("hd", "mossy_rock_diff.jpg")
    moss.projection = "BOX"; moss.projection_blend = 0.3
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], moss.inputs["Vector"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sz = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Normal"], sz.inputs["Vector"])
    up = nt.nodes.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value, up.inputs["From Max"].default_value = 0.35, 0.8
    nt.links.new(sz.outputs["Z"], up.inputs["Value"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 9.0; nz.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    br = nt.nodes.new("ShaderNodeMapRange")
    br.inputs["From Min"].default_value, br.inputs["From Max"].default_value = 0.38, 0.58
    nt.links.new(nz.outputs["Fac"], br.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
    nt.links.new(up.outputs["Result"], mul.inputs[0]); nt.links.new(br.outputs["Result"], mul.inputs[1])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    nt.links.new(mul.outputs[0], mix.inputs["Factor"])
    nt.links.new(rock.outputs["Color"], mix.inputs["A"]); nt.links.new(moss.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], em.inputs["Color"]); nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    tnode = nt.nodes.new("ShaderNodeTexImage"); tnode.image = target
    nt.nodes.active = tnode
    me = slab_ob.data
    keep = list(me.materials)
    me.materials.clear(); me.materials.append(bm_)
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    slab_ob.select_set(True)
    bpy.context.view_layer.objects.active = slab_ob
    bpy.ops.object.bake(type="EMIT", margin=8, use_clear=True)
    me.materials.clear()
    for m in keep:
        me.materials.append(m)
    os.makedirs(BUILD, exist_ok=True)
    path = os.path.join(BUILD, "rock_moss_diff.jpg")
    target.file_format = "JPEG"
    target.filepath_raw = path
    sc.render.image_settings.quality = 88
    target.save(filepath=path, quality=88)
    bpy.data.images.remove(target)
    bpy.data.materials.remove(bm_)
    baked = bpy.data.images.load(path, check_existing=False)
    tex = next(n for n in M["rock"].node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name == "sRGB")
    tex.image = baked
    sc.render.engine = engine


def build_base(hd, M, cb):
    stats = {}
    # bench top: wide dark planks under everything
    bm = bmesh.new()
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r["verts"]:
        v.co = Vector((v.co.x * 3.4, v.co.y * 1.5 + 0.1, v.co.z * 0.05 + TABLE_Z - 0.025))
    if hd:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(60)]
        bmesh.ops.bevel(bm, geom=edges, offset=0.006, segments=3, affect="EDGES", profile=0.5, clamp_overlap=True)
    # the cedar map's planks run along v: one repeat across the 1.4 m depth, planks along the bench
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            c = l.vert.co
            l[uvl].uv = ((c.y + c.z) / 1.4, c.x / 0.7)
    table = new_obj("bench", bm, M["bench"], cb)
    # oval display board (jiita) on four low feet, end grain across the bench grain
    bm = bmesh.new()
    seg = 96 if hd else 48
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=1.0, radius2=1.0, depth=1.0)
    for v in res["verts"]:
        v.co = Vector((v.co.x * BOARD_RX, v.co.y * BOARD_RY, (v.co.z + 0.5) * BOARD_T - BOARD_T))
    if hd:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(60)]
        bmesh.ops.bevel(bm, geom=edges, offset=0.004, segments=2, affect="EDGES", profile=0.5, clamp_overlap=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            fr = bmesh.ops.create_cube(bm, size=1.0)
            for v in fr["verts"]:
                v.co = Vector((v.co.x * 0.07 + sx * BOARD_RX * 0.62, v.co.y * 0.05 + sy * BOARD_RY * 0.55,
                               v.co.z * FEET_H - BOARD_T - FEET_H / 2))
    board = new_obj("board", bm, M["wood"], cb, uv=0.42, uv_rot=True)
    # slab
    me = build_slab(hd, M["rock"])
    slab = bpy.data.objects.new("rock", me)
    cb.objects.link(slab)
    if hd:
        bake_slab(slab, M)
    # contact shadow on the bench (under the board) and on the board (under the slab)
    bm = bmesh.new()
    for (rx, ry, z) in ((BOARD_RX * 1.18, BOARD_RY * 1.25, TABLE_Z + 0.0006), (SLAB_W * 0.56, SLAB_W * 0.36, 0.0006)):
        rr = bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
        uv = bm.loops.layers.uv.verify()
        for v in rr["verts"]:
            v.co = Vector((v.co.x * 2 * rx, v.co.y * 2 * ry, z))
        faces = {f for v in rr["verts"] for f in v.link_faces}
        for f in faces:
            for l in f.loops:
                l[uv].uv = (l.vert.co.x / (2 * rx) + 0.5, l.vert.co.y / (2 * ry) + 0.5)
    new_obj("contact-shadow", bm, M["shadow"], cb, smooth=None)
    moss = new_obj("moss", build_moss(slab, hd, M["moss"], 11), M["moss"], cb, smooth=90, recalc=False)
    if hd:
        # fronds join the moss node as its second material, so they ride the turntable with it
        fr, bent = moss_fronds(moss)
        me = moss.data
        n0 = len(me.vertices)
        bm = bmesh.new(); bm.from_mesh(me)
        nf0 = len(bm.faces)
        bm.from_mesh(fr)
        bm.faces.ensure_lookup_table()
        for i in range(nf0, len(bm.faces)):
            bm.faces[i].material_index = 1
            bm.faces[i].smooth = True
        bm.to_mesh(me); bm.free(); bpy.data.meshes.remove(fr)
        me.materials.append(M["fronds"])
        me.update()
        me.normals_split_custom_set_from_vertices([v.normal.copy() for v in me.vertices][:n0] + bent)
    return {"bench": table, "board": board, "rock": slab, "moss": moss}


# ---------------------------------------------------------------- tree
def trunk_at(t):
    """Point and radius along the trunk polyline at parameter t (0 base .. 1 apex)."""
    n = len(TRUNK) - 1
    x = max(0.0, min(1.0, t)) * n
    i = min(n - 1, int(x))
    f = x - i
    a, b = TRUNK[i], TRUNK[i + 1]
    return Vector([a[k] + (b[k] - a[k]) * f for k in range(3)]), a[3] + (b[3] - a[3]) * f


class Skeleton:
    """Polyline chains with per-point radius, bark wrap and along-offset (a mesh of edges)."""

    def __init__(self):
        self.chains = []

    def add(self, pts, wrap=None, tile=BARK_TILE):
        """pts: [(Vector, radius)]."""
        if wrap is None:
            wrap = max(1, round(TAU * pts[0][1] / tile))
        self.chains.append((pts, wrap))

    def object(self, name, chain_ids=False):
        me = bpy.data.meshes.new(name)
        verts, edges, rad, wrap, chain = [], [], [], [], []
        for k, (pts, w) in enumerate(self.chains):
            base = len(verts)
            for i, (p, r) in enumerate(pts):
                verts.append(tuple(p)); rad.append(r); wrap.append(float(w)); chain.append(float(k))
                if i:
                    edges.append((base + i - 1, base + i))
        me.from_pydata(verts, edges, [])
        for nm, vals in (("radius", rad), ("wrap", wrap)) + ((("chain", chain),) if chain_ids else ()):
            a = me.attributes.new(nm, "FLOAT", "POINT")
            a.data.foreach_set("value", vals)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def sweep(skel, name, ring, res, tile=BARK_TILE, deform=None):
    """GN: edge chains -> Catmull-Rom curves -> radius-scaled open-arc sweep with seamless bark UVs.
    `deform(me, ring)` reshapes the evaluated sweep (ring-major vertices, seam duplicates still
    apart) before the seam is welded."""
    src = skel.object(name + "-skel", chain_ids=deform is not None)
    g = GN(name, with_input=True)
    c = g.n("GeometryNodeMeshToCurve", {"Mesh": g.inp}).outputs["Curve"]
    c = g.n("GeometryNodeCurveSplineType", {"Curve": c}, spline_type="CATMULL_ROM").outputs["Curve"]
    c = g.n("GeometryNodeSetSplineResolution", {0: c, "Resolution": res}).outputs[0]
    rs = g.n("GeometryNodeResampleCurve", {"Curve": c})
    for value in ("Evaluated", "EVALUATED"):
        try:
            rs.inputs["Mode"].default_value = value
            break
        except (TypeError, KeyError, ValueError):
            continue
    c = g.n("GeometryNodeSetCurveRadius", {"Curve": rs.outputs["Curve"], "Radius": g.named("radius")}).outputs["Curve"]
    sp = g.n("GeometryNodeSplineParameter")
    c = g.store(c, "along", sp.outputs["Length"])
    arc = g.n("GeometryNodeCurveArc", {"Resolution": ring, "Radius": 1.0, "Sweep Angle": TAU}, mode="RADIUS")
    sp2 = g.n("GeometryNodeSplineParameter")
    prof = g.store(arc.outputs["Curve"], "around", sp2.outputs["Factor"])
    mesh = g.n("GeometryNodeCurveToMesh", {"Curve": c, "Profile Curve": prof,
                                           "Scale": g.n("GeometryNodeInputRadius").outputs[0],
                                           "Fill Caps": False}).outputs["Mesh"]
    uv = g.xyz(g.math("MULTIPLY", g.named("around"), g.named("wrap")), g.math("DIVIDE", g.named("along"), tile))
    mesh = g.store(mesh, "uvw", uv, "FLOAT_VECTOR", "CORNER")
    if deform is None:
        bm = g.bmesh(mesh, ob=src)
    else:
        me = g.mesh(mesh, ob=src)
        deform(me, ring)
        bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bpy.data.objects.remove(src, do_unlink=True)
    for nm in ("along", "around", "wrap", "radius", "chain"):
        lay = bm.verts.layers.float.get(nm)
        if lay is not None:
            bm.verts.layers.float.remove(lay)
    holes = [e for e in bm.edges if e.is_boundary]
    if holes:
        bmesh.ops.holes_fill(bm, edges=holes, sides=0)
    if deform is not None:
        canonical(bm)
    return bm


def add_pad(pads, centre, radii, tip, fine, rng, hd, hd_rng=None):
    """One pad and the twigs into it. HD draws the same values from `rng` as Standard (so both sets
    share one skeleton) and grows more twigs from `hd_rng`."""
    k = len(pads)
    pads.append({"centre": centre.copy(), "radii": radii, "tip": tip.copy()})
    n = 3
    for j in range(n):
        a = TAU * (j + rng.random() * 0.6) / n
        end = centre + Vector((math.cos(a) * radii[0] * 0.62, math.sin(a) * radii[1] * 0.62, radii[2] * (0.05 + 0.25 * rng.random())))
        if not hd:
            mid = tip.lerp(end, 0.5) + Vector((0, 0, 0.004))
            fine.add([(tip, 0.0034), (mid, 0.0024), (end, 0.0012)], wrap=1)
    if hd:
        n = 7
        for j in range(n):
            a = TAU * (j + hd_rng.random() * 0.7) / n
            reach = 0.45 + 0.35 * hd_rng.random()
            end = centre + Vector((math.cos(a) * radii[0] * reach, math.sin(a) * radii[1] * reach,
                                   radii[2] * (0.0 + 0.3 * hd_rng.random())))
            mid = tip.lerp(end, 0.45) + Vector((0, 0, 0.003 + 0.004 * hd_rng.random()))
            fine.add([(tip, 0.0044), (mid, 0.0029), (end, 0.0012)], wrap=1)
    return k


class Height:
    """The HD bark height map (fetch_sources.py bark_height.png), bilinear with wrap-around."""

    def __init__(self):
        im = bpy.data.images.load(os.path.join(PREP, "hd", "bark_height.png"), check_existing=False)
        im.colorspace_settings.name = "Non-Color"
        w, h = im.size
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        self.h = px[0::4].reshape(h, w)
        bpy.data.images.remove(im)

    def __call__(self, uv):
        h, w = self.h.shape
        x = np.mod(uv[:, 0], 1.0) * w - 0.5
        y = np.mod(uv[:, 1], 1.0) * h - 0.5
        x0 = np.floor(x).astype(np.int64); y0 = np.floor(y).astype(np.int64)
        fx, fy = x - x0, y - y0
        a = self.h[y0 % h, x0 % w]; b = self.h[y0 % h, (x0 + 1) % w]
        c = self.h[(y0 + 1) % h, x0 % w]; d = self.h[(y0 + 1) % h, (x0 + 1) % w]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def ring_frame(me, ring):
    """Positions, per-vertex UVs and ring centres of a sweep (vertices are ring-major)."""
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    luv = np.empty(len(me.loops) * 2, dtype=np.float64); me.uv_layers[0].data.foreach_get("uv", luv)
    lv = np.empty(len(me.loops), dtype=np.int64); me.loops.foreach_get("vertex_index", lv)
    uv = np.zeros((n, 2)); uv[lv] = luv.reshape(-1, 2)
    along = np.empty(n); me.attributes["along"].data.foreach_get("value", along)
    assert n % ring == 0 and np.ptp(along.reshape(-1, ring), axis=1).max() < 1e-5, "sweep is not ring-major"
    rings = co.reshape(-1, ring, 3)
    seam = np.abs(rings[:, 0] - rings[:, -1]).max() < 1e-6
    centre = np.repeat((rings[:, :-1] if seam else rings).mean(axis=1), ring, axis=0)
    return co, uv, centre


def put_co(me, co):
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.update()


def lumps(co, scale, seed):
    return np.array([noise.noise(Vector(p) * scale + Vector((seed, 0.0, 0.0))) for p in co])


def gnarl_trunk(foot, height):
    """Flutes that flare into the nebari and spiral up the trunk, burls, and bark-scan relief."""
    lobes = [(math.radians(az), w) for az, _, w in ROOTS_HD]

    def deform(me, ring):
        co, uv, c = ring_frame(me, ring)
        d = co - c
        r = np.linalg.norm(d, axis=1)
        n = d / np.maximum(r, 1e-9)[:, None]
        h = np.maximum(0.0, co[:, 2] - foot.z)
        phi = np.arctan2(n[:, 1], n[:, 0])
        f = np.zeros(len(co))
        for a, w in lobes:
            dphi = np.angle(np.exp(1j * (phi - a - TRUNK_TWIST * h)))
            f += w * np.exp(-0.5 * (dphi / 0.3) ** 2)
        amp = 0.8 * np.exp(-h / 0.035) + 0.16 * np.exp(-h / 0.3)
        s = 1.0 + amp * (f - 0.32)
        s *= 1.0 + 0.11 * lumps(co, 11.0, 3.0) + 0.035 * lumps(co, 37.0, 9.0)
        relief = (height(uv) - 0.5) * 0.0055 * np.clip(r / 0.035, 0.35, 1.0)
        put_co(me, c + n * (r * s + relief)[:, None])
    return deform


def gnarl_limb(height, burl, relief_amp, flatten=0.0):
    """Branches and roots: small burls and bark relief; roots flatten their underside onto the slab."""
    def deform(me, ring):
        co, uv, c = ring_frame(me, ring)
        d = co - c
        r = np.linalg.norm(d, axis=1)
        n = d / np.maximum(r, 1e-9)[:, None]
        s = 1.0 + burl * lumps(co, 45.0, 17.0)
        if flatten:
            s *= np.where(n[:, 2] < 0, 1.0 - flatten * -n[:, 2], 1.0)
        relief = (height(uv) - 0.5) * relief_amp * np.clip(r / 0.02, 0.3, 1.0)
        put_co(me, c + n * (r * s + relief)[:, None])
    return deform


def hd_roots(base, ground, rng):
    roots = Skeleton()
    for i, (az, reach, w) in enumerate(ROOTS_HD):
        d = Vector((math.cos(math.radians(az)), math.sin(math.radians(az)), 0))
        side = Vector((-d.y, d.x, 0))
        bend = rng.uniform(-1.0, 1.0)
        pts = []
        for j, f in enumerate((0.0, 0.16, 0.34, 0.54, 0.76, 1.0)):
            q = base + d * reach * f + side * (0.018 * bend * f * f + 0.004 * math.sin(9.0 * f + i))
            z = ground(q.x, q.y)
            r = (0.034 * w) * (1 - f) ** 1.25 + 0.0032
            zz = base.z + 0.045 if j == 0 else z + 0.15 * r - 0.001 - 0.005 * f
            pts.append((Vector((q.x, q.y, zz)), r))
        roots.add(pts, wrap=2 if w > 0.8 else 1)
    return roots


def build_tree(hd, M, ct, slab_ob, ground):
    rng = random.Random(TREE_SEED)
    hd_rng = random.Random(HD_SEED)
    hit = ground(TRUNK_XY[0], TRUNK_XY[1])
    base = Vector((TRUNK_XY[0], TRUNK_XY[1], hit))
    thick, thin, fine = Skeleton(), Skeleton(), Skeleton()
    if hd:
        top = TRUNK[-1][2]
        thick.add([(base + Vector(p[:3]), p[3] * (1.0 - 0.15 * max(0.0, p[2]) / top)) for p in TRUNK],
                  tile=BARK_TILE_HD)
    else:
        thick.add([(base + Vector(p[:3]), p[3]) for p in TRUNK])
    pads = []
    # nebari: surface roots hugging the slab
    for az, reach in ([] if hd else ROOTS):
        d = Vector((math.cos(math.radians(az)), math.sin(math.radians(az)), 0))
        pts = []
        for i, f in enumerate((0.0, 0.3, 0.62, 1.0)):
            q = base + d * reach * f
            z = ground(q.x, q.y)
            pts.append((Vector((q.x, q.y, (base.z + 0.03 if i == 0 else z - 0.002 - 0.004 * f))), 0.022 * (1 - f) + 0.003))
        thick.add(pts, wrap=1)
    # branches with their pads, then secondary pads off them
    for (t, az, reach, radii, sec) in BRANCHES:
        p0, r0 = trunk_at(t)
        p0 = base + p0
        a = math.radians(az)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        s = 1 if rng.random() < 0.5 else -1
        pts = [(p0, r0 * 0.62),
               (p0 + d * reach * 0.28 + Vector((0, 0, -0.008)) + side * 0.010 * s, r0 * 0.46),
               (p0 + d * reach * 0.62 + Vector((0, 0, -0.012)) - side * 0.012 * s, r0 * 0.32),
               (p0 + d * reach + Vector((0, 0, 0.0)), 0.006)]
        thin.add(pts, wrap=1 if r0 * 0.62 < 0.012 else 2)
        tip = pts[-1][0]
        add_pad(pads, tip + Vector((0, 0, radii[2] * 0.45)), radii, tip, fine, rng, hd, hd_rng)
        if sec:
            daz, at, reach2, r2 = sec
            sp_, sr = pts[1] if at < 0.45 else pts[2]
            a2 = a + math.radians(daz)
            d2 = Vector((math.cos(a2), math.sin(a2), 0))
            tip2 = sp_ + d2 * reach2 + Vector((0, 0, 0.012))
            thin.add([(sp_, sr * 0.8), (sp_.lerp(tip2, 0.5) + Vector((0, 0, -0.004)), sr * 0.55), (tip2, 0.0035)], wrap=1)
            add_pad(pads, tip2 + Vector((0, 0, r2[2] * 0.45)), r2, tip2, fine, rng, hd, hd_rng)
    apex, _ = trunk_at(1.0)
    apex = base + apex
    add_pad(pads, apex + Vector((0, 0, APEX_PAD[2] * 0.35)), APEX_PAD, apex, fine, rng, hd, hd_rng)
    assert len(pads) <= MAX_PADS, len(pads)
    if hd:
        height = Height()
        bm = sweep(thick, "trunk-thick", 40, 12, BARK_TILE_HD, gnarl_trunk(base, height))
        parts = ((hd_roots(base, ground, hd_rng), "roots", 14, 6, gnarl_limb(height, 0.10, 0.003, flatten=0.45)),
                 (thin, "branches", 12, 6, gnarl_limb(height, 0.07, 0.0022)), (fine, "twigs", 5, 3, None))
    else:
        bm = sweep(thick, "trunk-thick", 10, 4)
        parts = ((thin, "branches", 7, 3, None), (fine, "twigs", 4, 2, None))
    for sk, nm, ring, res, deform in parts:
        part = sweep(sk, nm, ring, res, BARK_TILE_HD if hd else BARK_TILE, deform)
        me = bpy.data.meshes.new("tmp"); part.to_mesh(me); part.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    trunk = new_obj("trunk", bm, M["bark"], ct, smooth=90, recalc=False)
    leaves = build_foliage_hd(pads) if hd else build_foliage(pads, hd)
    foliage = new_obj("foliage", leaves, M["leaf"], ct, smooth=90, recalc=False)
    foliage_data(foliage, pads)
    return trunk, foliage, pads, base


def leaf_cards(g, hd):
    """Three green leaf cards (one per scanned leaf), stem at the origin, leaf along +Y, normal +Z."""
    out = []
    for c, r in LEAF_TILES:
        grid = g.n("GeometryNodeMeshGrid", {"Size X": 1.0, "Size Y": 1.0, "Vertices X": 3 if hd else 2,
                                            "Vertices Y": 2})
        uvf = g.sep(grid.outputs["UV Map"])
        u = g.mad(uvf[0], 0.25, c / 4)
        v = g.mad(uvf[1], -0.5, 1 - r / 2)
        geo = g.store(grid.outputs["Mesh"], "uvw", g.xyz(u, v, 0.0), "FLOAT_VECTOR", "CORNER")
        geo = g.xform(geo, t=(0, 0.5, 0))
        if hd:
            # cup across the blade and a gentle droop toward the tip
            p = g.sep(g.pos())
            cup = g.math("MULTIPLY", g.math("MULTIPLY", p[0], p[0]), -0.55)
            droop = g.math("MULTIPLY", g.math("MULTIPLY", p[1], p[1]), -0.22)
            geo = g.n("GeometryNodeSetPosition", {"Geometry": geo, "Offset": g.xyz(0, 0, g.math("ADD", cup, droop))}).outputs["Geometry"]
        out.append(geo)
    return out


def build_foliage(pads, hd):
    """GN per pad: Poisson points on an outer dome and a sparser inner dome, leaf cards instanced on
    them (normal tilted up, blade turned outward, random twist, tilt and size), realised."""
    bm = bmesh.new()
    size = 0.021
    for k, pad in enumerate(pads):
        rx, ry, rz = pad["radii"]
        rz *= 1.3
        g = GN(f"pad-{k}")
        cards = leaf_cards(g, hd)
        inst = g.n("GeometryNodeGeometryToInstance", {"Geometry": cards}).outputs["Instances"]
        layers = []
        shells = ((1.0, -0.55, 0.0083 if hd else 0.0096), (0.74, -0.35, 0.0112 if hd else 0.0135),
                  (0.48, -0.1, 0.015 if hd else 0.019))
        for li, (scale, cut, dmin) in enumerate(shells):
            ico = g.n("GeometryNodeMeshIcoSphere", {"Radius": 1.0, "Subdivisions": 3})
            # a cloud, not a dome: the shell swells and dips with a low-frequency noise
            lump = g.n("ShaderNodeTexNoise", {"Vector": g.pos(), "Scale": 1.6, "Detail": 1.0, "W": float(k)},
                       noise_dimensions="4D")
            cloud = g.vmath("SCALE", g.pos(), scale=g.mad(lump.outputs["Fac"], 0.55, 0.72))
            sh = g.n("GeometryNodeSetPosition", {"Geometry": ico.outputs["Mesh"], "Position": cloud}).outputs["Geometry"]
            dome = g.xform(sh, s=(rx * scale, ry * scale, rz * scale))
            low = g.math("LESS_THAN", g.sep(g.pos())[2], cut * rz * scale)
            dome = g.n("GeometryNodeDeleteGeometry", {"Geometry": dome, "Selection": low}, domain="FACE").outputs["Geometry"]
            dist = g.n("GeometryNodeDistributePointsOnFaces", {"Mesh": dome, "Distance Min": dmin,
                                                                "Density Max": 4.0 / (dmin * dmin), "Seed": 31 * k + li},
                       distribute_method="POISSON")
            up = g.vmath("NORMALIZE", g.vmath("ADD", dist.outputs["Normal"], (0.0, 0.0, 1.0)))
            r1 = g.n("FunctionNodeAlignRotationToVector", {"Vector": up}, axis="Z").outputs[0]
            r2 = g.n("FunctionNodeAlignRotationToVector", {"Rotation": r1, "Vector": g.pos()}, axis="Y", pivot_axis="Z").outputs[0]
            tw = g.n("FunctionNodeAxisAngleToRotation", {"Axis": (0.0, 0.0, 1.0), "Angle": g.rand(-0.8, 0.8, 101 + k * 7 + li)}).outputs[0]
            tl = g.n("FunctionNodeAxisAngleToRotation", {"Axis": (1.0, 0.0, 0.0), "Angle": g.rand(-0.1, 0.5, 202 + k * 7 + li)}).outputs[0]
            rot = g.n("FunctionNodeRotateRotation", {"Rotation": r2, "Rotate By": tw}, rotation_space="LOCAL").outputs[0]
            rot = g.n("FunctionNodeRotateRotation", {"Rotation": rot, "Rotate By": tl}, rotation_space="LOCAL").outputs[0]
            sc = g.math("MULTIPLY", g.rand(0.72, 1.12, 303 + k * 7 + li), size)
            iop = g.n("GeometryNodeInstanceOnPoints", {"Points": dist.outputs["Points"], "Instance": inst,
                                                      "Pick Instance": True,
                                                      "Instance Index": g.rand(0, 2, 404 + k * 7 + li, "INT"),
                                                      "Rotation": rot, "Scale": sc}).outputs["Instances"]
            iop = g.store(iop, "rank", g.rand(0.0, 1.0, 505 + k * 7 + li), "FLOAT", "INSTANCE")
            layers.append(iop)
        real = g.n("GeometryNodeRealizeInstances", {"Geometry": g.join(*layers)}).outputs["Geometry"]
        real = g.xform(real, t=tuple(pad["centre"]))
        me = g.mesh(real)
        bm.from_mesh(me)
        n_after = len(bm.verts)
        pad["verts"] = n_after
        bpy.data.meshes.remove(me)
    return bm


def atlas_card(g, rect, size, grid, bend=(0.0, 0.0)):
    """One card cut to an HD atlas rect (shipped px), stem at the origin, blade along +Y, normal +Z;
    `bend` = (cup across, droop along) in card units."""
    a = hd_atlas()
    W, H = a["size"]
    x0, y0, x1, y1 = rect
    aspect = (x1 - x0) / (y1 - y0)
    gr = g.n("GeometryNodeMeshGrid", {"Size X": aspect, "Size Y": 1.0, "Vertices X": grid[0], "Vertices Y": grid[1]})
    uvf = g.sep(gr.outputs["UV Map"])
    u = g.mad(uvf[0], (x1 - x0) / W, x0 / W)
    v = g.mad(uvf[1], -(y1 - y0) / H, 1 - y0 / H)
    geo = g.store(gr.outputs["Mesh"], "uvw", g.xyz(u, v, 0.0), "FLOAT_VECTOR", "CORNER")
    geo = g.xform(geo, t=(0, 0.5, 0))
    if bend != (0.0, 0.0):
        p = g.sep(g.pos())
        cup = g.math("MULTIPLY", g.math("MULTIPLY", p[0], p[0]), -bend[0])
        droop = g.math("MULTIPLY", g.math("MULTIPLY", p[1], p[1]), -bend[1])
        geo = g.n("GeometryNodeSetPosition", {"Geometry": geo, "Offset": g.xyz(0, 0, g.math("ADD", cup, droop))}).outputs["Geometry"]
    return g.xform(geo, s=(size, size, size))


# HD pad shells: (dome scale, low cut, sprig spacing or None, leaf spacing) in metres
HD_SHELLS = ((0.9, -0.5, 0.0125, 0.0092), (0.8, -0.4, 0.0155, 0.0108), (0.56, -0.15, None, 0.0135))


def build_foliage_hd(pads):
    """GN per pad: clumped Poisson points on three noise-swollen shells; the outer two carry scanned
    leaf sprays (the pad's silhouette), every shell carries single scanned leaves. Each card keeps a
    density rank and a shade for COLOR_0."""
    a = hd_atlas()
    bm = bmesh.new()
    for k, pad in enumerate(pads):
        rx, ry, rz = pad["radii"]
        rz *= 1.15
        g = GN(f"pad-hd-{k}")
        sprigs = g.n("GeometryNodeGeometryToInstance", {"Geometry": [atlas_card(g, r, 1.0, (3, 3), (0.5, 0.18))
                                                                     for r in a["sprigs"]]}).outputs["Instances"]
        leaves = g.n("GeometryNodeGeometryToInstance", {"Geometry": [atlas_card(g, r, 1.0, (2, 2))
                                                                     for r in a["leaves"]]}).outputs["Instances"]
        layers = []
        for li, (scale, cut, d_sprig, d_leaf) in enumerate(HD_SHELLS):
            ico = g.n("GeometryNodeMeshIcoSphere", {"Radius": 1.0, "Subdivisions": 3})
            lump = g.n("ShaderNodeTexNoise", {"Vector": g.pos(), "Scale": 1.6, "Detail": 1.0, "W": float(k)},
                       noise_dimensions="4D")
            cloud = g.vmath("SCALE", g.pos(), scale=g.mad(lump.outputs["Fac"], 0.6, 0.7))
            sh = g.n("GeometryNodeSetPosition", {"Geometry": ico.outputs["Mesh"], "Position": cloud}).outputs["Geometry"]
            dome = g.xform(sh, s=(rx * scale, ry * scale, rz * scale))
            low = g.math("LESS_THAN", g.sep(g.pos())[2], cut * rz * scale)
            dome = g.n("GeometryNodeDeleteGeometry", {"Geometry": dome, "Selection": low}, domain="FACE").outputs["Geometry"]
            # tufts: density falls away between noise clumps, so pads read as clustered sprays
            tuft = g.n("ShaderNodeTexNoise", {"Vector": g.pos(), "Scale": 22.0 / max(rx, ry) * 0.06, "Detail": 2.0,
                                              "W": float(k) + 0.5 * li}, noise_dimensions="4D")
            dens = g.math("POWER", g.n("ShaderNodeMapRange", {"Value": tuft.outputs["Fac"], "From Min": 0.36,
                                                               "From Max": 0.62}).outputs["Result"], 0.7)
            for kind, (inst, d, sz, n_tiles, tilt) in enumerate(((sprigs, d_sprig, (0.04, 0.056), 4, (0.1, 0.5)),
                                                                 (leaves, d_leaf, (0.017, 0.026), 7, (-0.15, 0.55)))):
                if d is None:
                    continue
                seed = 31 * k + 7 * li + kind
                dist = g.n("GeometryNodeDistributePointsOnFaces", {"Mesh": dome, "Distance Min": d,
                                                                    "Density Max": 4.0 / (d * d), "Density Factor": dens,
                                                                    "Seed": seed}, distribute_method="POISSON")
                up = g.vmath("NORMALIZE", g.vmath("ADD", dist.outputs["Normal"], (0.0, 0.0, 0.8)))
                r1 = g.n("FunctionNodeAlignRotationToVector", {"Vector": up}, axis="Z").outputs[0]
                r2 = g.n("FunctionNodeAlignRotationToVector", {"Rotation": r1, "Vector": g.pos()}, axis="Y", pivot_axis="Z").outputs[0]
                tw = g.n("FunctionNodeAxisAngleToRotation", {"Axis": (0.0, 0.0, 1.0), "Angle": g.rand(-0.9, 0.9, 101 + seed)}).outputs[0]
                tl = g.n("FunctionNodeAxisAngleToRotation", {"Axis": (1.0, 0.0, 0.0), "Angle": g.rand(tilt[0], tilt[1], 202 + seed)}).outputs[0]
                rot = g.n("FunctionNodeRotateRotation", {"Rotation": r2, "Rotate By": tw}, rotation_space="LOCAL").outputs[0]
                rot = g.n("FunctionNodeRotateRotation", {"Rotation": rot, "Rotate By": tl}, rotation_space="LOCAL").outputs[0]
                iop = g.n("GeometryNodeInstanceOnPoints", {"Points": dist.outputs["Points"], "Instance": inst,
                                                          "Pick Instance": True,
                                                          "Instance Index": g.rand(0, n_tiles - 1, 404 + seed, "INT"),
                                                          "Rotation": rot, "Scale": g.rand(sz[0], sz[1], 303 + seed)}).outputs["Instances"]
                iop = g.store(iop, "rank", g.rand(0.0, 1.0, 505 + seed), "FLOAT", "INSTANCE")
                iop = g.store(iop, "shade", g.rand(0.78, 1.0, 606 + seed), "FLOAT", "INSTANCE")
                layers.append(iop)
        real = g.n("GeometryNodeRealizeInstances", {"Geometry": g.join(*layers)}).outputs["Geometry"]
        real = g.xform(real, t=tuple(pad["centre"]))
        me = g.mesh(real)
        bm.from_mesh(me)
        pad["verts"] = len(bm.verts)
        bpy.data.meshes.remove(me)
    return bm


def foliage_data(ob, pads):
    """COLOR_0 = (AO, pad code, rank) and bent normals (the pad dome's), per vertex."""
    me = ob.data
    rank = me.attributes.get("rank")
    rk = [0.0] * len(me.vertices)
    if rank is not None:
        rank.data.foreach_get("value", rk)
    shade = me.attributes.get("shade")
    sh = [1.0] * len(me.vertices)
    if shade is not None:
        shade.data.foreach_get("value", sh)
        me.attributes.remove(shade)
    rgb, normals = [], []
    start = 0
    for k, pad in enumerate(pads):
        end = pad["verts"]
        c = pad["centre"]; rx, ry, rz = pad["radii"]
        for i in range(start, end):
            p = me.vertices[i].co
            q = Vector(((p.x - c.x) / rx, (p.y - c.y) / ry, (p.z - c.z) / rz))
            depth = min(1.0, q.length)
            ao = max(0.32, min(1.0, 0.42 + 0.38 * depth + 0.28 * max(-0.4, min(1.0, q.z))))
            rgb.append((ao * sh[i], (k + 0.5) / MAX_PADS, rk[i]))
            dome = Vector((q.x / rx, q.y / ry, q.z / rz + 1.2 / rz)).normalized()
            card = me.vertices[i].normal
            if card.dot(dome) < 0:
                card = -card
            normals.append(tuple((dome * 0.75 + card * 0.25).normalized()))
        start = end
    assert start == len(me.vertices), (start, len(me.vertices))
    if rank is not None:
        me.attributes.remove(rank)
    set_color(me, rgb)
    me.normals_split_custom_set_from_vertices(normals)


def templates(hd, M, ct):
    park = (0.0, 0.0, -3.0)
    if hd:
        # a double blossom: the scanned-petal flower cupped, and a smaller copy turned half a petal
        a = hd_atlas()
        g = GN("blossom-hd")
        outer = g.xform(atlas_card(g, a["blossom"], 0.032, (4, 4), (0.0, 0.0)), t=(0, -0.016, 0))
        inner = g.xform(g.xform(atlas_card(g, a["blossom"], 0.022, (3, 3)), t=(0, -0.011, 0)), t=(0, 0, 0.0018), r=(0, 0, math.pi / 5))
        flower = g.join(outer, inner)
        p = g.sep(g.pos())
        bowl = g.math("MULTIPLY", g.mad(p[0], p[0], g.math("MULTIPLY", p[1], p[1])), 9.0)
        flower = g.n("GeometryNodeSetPosition", {"Geometry": flower, "Offset": g.xyz(0, 0, bowl)}).outputs["Geometry"]
        new_obj("blossom-card", g.bmesh(flower, merge=0), M["blossom"], ct, loc=park, smooth=None, recalc=False)
        g = GN("fall-hd")
        leaf = atlas_card(g, a["fall"], 0.026, (2, 3), (0.35, 0.2))
        new_obj("falling-leaf", g.bmesh(leaf, merge=0), M["fall"], ct, loc=(0.1, 0.0, -3.0), smooth=None, recalc=False)
        return
    bm = bmesh.new(); quad(bm, 0.03, BLOSSOM_TILE)
    new_obj("blossom-card", bm, M["blossom"], ct, loc=park, smooth=None, recalc=False)
    bm = bmesh.new(); quad(bm, 0.026, FALL_TILE)
    new_obj("falling-leaf", bm, M["fall"], ct, loc=(0.1, 0.0, -3.0), smooth=None, recalc=False)


def build(s):
    hd = s == "hd"
    M = materials(s)
    cb = collection(f"bonsai-base-{s}")
    ct = collection(f"bonsai-tree-{s}")
    base = build_base(hd, M, cb)
    occ = [base["rock"], base["moss"], base["board"], base["bench"]]
    tree_g = bvh_of([base["rock"], base["moss"], base["board"]])

    def ground(x, y):
        loc, _, _, _ = tree_g.ray_cast(Vector((x, y, 1.0)), Vector((0, 0, -1)), 3.0)
        return loc.z if loc is not None else 0.0

    trunk, foliage, pads, foot = build_tree(hd, M, ct, base["rock"], ground)
    templates(hd, M, ct)
    every = bvh_of(occ + [trunk, foliage])
    bake_ao(trunk, every, 0.10, 0.85)
    bake_ao(base["rock"], every, 0.08, 0.9)
    bake_ao(base["moss"], every, 0.05, 0.7)
    bake_ao(base["board"], every, 0.06, 0.6)
    return {"pads": pads, "foot": foot, "ground": ground}


# ---------------------------------------------------------------- export
def canonical_indices(path):
    """The glTF exporter emits the same triangles in a run-dependent order; sort each index buffer
    (winding kept, smallest index first) so the packed GLBs are byte-identical between builds."""
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


def glb_doc(path):
    raw = open(path, "rb").read()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20 + jlen])
    return doc, raw[20 + jlen + 8:]


def image_size(data):
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
        ln = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + ln
    return 0, 0


def gpu_bytes(path):
    """Decoded texture memory of one GLB: RGBA8 with a full mip chain (w * h * 4 * 4/3)."""
    doc, binc = glb_doc(path)
    total, dims = 0, []
    for im in doc.get("images", []):
        bv = doc["bufferViews"][im["bufferView"]]
        data = binc[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        w, h = image_size(data)
        dims.append(f"{w}x{h}")
        total += int(w * h * 4 * 4 / 3)
    return total, dims


def check_foliage_colour(path, n_pads):
    """The raw export must carry COLOR_0 on the foliage with every pad code present."""
    doc, binc = glb_doc(path)
    for mesh in doc["meshes"]:
        if mesh.get("name") != "foliage":
            continue
        prim = mesh["primitives"][0]
        assert "COLOR_0" in prim["attributes"], "foliage lost COLOR_0"
        acc = doc["accessors"][prim["attributes"]["COLOR_0"]]
        bv = doc["bufferViews"][acc["bufferView"]]
        comps = 4 if acc["type"] == "VEC4" else 3
        fmt, size, scale = {5126: ("<f", 4, 1.0), 5123: ("<H", 2, 65535.0), 5121: ("<B", 1, 255.0)}[acc["componentType"]]
        off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = bv.get("byteStride", comps * size)
        codes = set()
        for i in range(acc["count"]):
            g = struct.unpack_from(fmt, binc, off + i * stride + size)[0] / scale
            codes.add(int(g * MAX_PADS))
        assert codes == set(range(n_pads)), (sorted(codes), n_pads)
        return
    raise AssertionError("no foliage mesh")


def export(s, pads):
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
    suffix = "-hd" if s == "hd" else ""
    rows = []
    dg = bpy.context.evaluated_depsgraph_get()
    for base in ("bonsai-base", "bonsai-tree"):
        coll = COLL[f"{base}-{s}"]
        for ob in bpy.context.scene.objects:
            ob.select_set(False)
        tris = 0
        bad = {"nonmanifold": 0, "degenerate": 0}
        for ob in coll.all_objects:
            ob.select_set(True)
            me = ob.evaluated_get(dg).to_mesh()
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
            print(f"  {ob.name}: verts={len(me.vertices)} tris={len(me.loop_triangles)}")
            bm = bmesh.new(); bm.from_mesh(me)
            # cards and the scanned slab are open sheets by design; the swept wood is closed
            if ob.name in ("trunk", "board", "bench"):
                bad["nonmanifold"] += sum(1 for e in bm.edges if not e.is_manifold)
            bad["degenerate"] += sum(1 for f in bm.faces if f.calc_area() < 1e-12)
            bm.free(); ob.evaluated_get(dg).to_mesh_clear()
        raw = os.path.join(BUILD, f"{base}{suffix}.raw.glb")
        bpy.ops.export_scene.gltf(filepath=raw, export_format="GLB", use_selection=True, export_apply=True,
                                  export_yup=True, export_normals=True, export_texcoords=True,
                                  export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                                  export_materials="EXPORT", export_image_format="AUTO",
                                  export_cameras=False, export_lights=False, export_extras=False)
        canonical_indices(raw)
        if base == "bonsai-tree":
            check_foliage_colour(raw, len(pads))
        dst = os.path.join(OUT, "assets", f"{base}{suffix}.glb")
        subprocess.run([GLTFPACK, "-i", raw, "-o", dst, "-cc", "-kn", "-km"], check=True)
        data = open(dst, "rb").read()
        gpu, dims = gpu_bytes(dst)
        rows.append({"id": f"{base}{suffix}", "path": f"assets/{base}{suffix}.glb",
                     "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "triangles": tris,
                     "rawBytes": os.path.getsize(raw), "integrity": bad, "gpuBytes": gpu, "images": dims})
        print(f"bonsai {s}: {base}{suffix} tris={tris} bytes={len(data)} gpu={gpu} images={dims} integrity={bad}")
    return rows


def write_data(info):
    pads = info["pads"]
    ground = info["ground"]
    # ground heights (glTF y) on a grid over the board, for leaves landing; x right, z toward the viewer
    nx, nz, x0, z0, step = 17, 13, -0.40, -0.30, 0.05
    heights = []
    for j in range(nz):
        for i in range(nx):
            x, z = x0 + i * step, z0 + j * step
            bx, by = x, -z
            inside = (bx / (BOARD_RX - 0.004)) ** 2 + (by / (BOARD_RY - 0.004)) ** 2 <= 1.0
            heights.append(round(ground(bx, by) if inside else TABLE_Z, 4))
    cx = sum(p["centre"].x for p in pads) / len(pads)
    cy = sum(p["centre"].y for p in pads) / len(pads)
    cz = sum(p["centre"].z for p in pads) / len(pads)
    data = {
        "pads": [{"c": gl(p["centre"]), "r": [p["radii"][0], p["radii"][2], p["radii"][1]]} for p in pads],
        "crown": {"centre": gl(Vector((cx, cy, cz))), "top": round(max(p["centre"].z + p["radii"][2] for p in pads), 4)},
        "foot": gl(info["foot"]),
        "board": {"rx": BOARD_RX, "rz": BOARD_RY, "top": 0.0, "bench": round(TABLE_Z, 4)},
        "ground": {"x0": x0, "z0": z0, "step": step, "nx": nx, "nz": nz, "h": heights},
        "camera": {"target": [0.0, 0.27, 0.0], "distance": 1.5, "elevationDeg": 12, "fovDeg": 30},
        "nodes": {"turntable": ["board", "rock", "moss", "contact-shadow", "trunk", "foliage"],
                  "foliage": "foliage", "blossom": "blossom-card", "fall": "falling-leaf"},
        "atlas": {"cols": 4, "rows": 2, "autumnOffsetU": 0.5},
    }
    ts = os.path.join(OUT, "frontend", "bonsai-data.ts")
    os.makedirs(os.path.dirname(ts), exist_ok=True)
    with open(ts, "w") as f:
        f.write("// Generated by blender/build_bonsai.py — do not edit by hand.\n")
        f.write("// Layout in glTF Y-up metres (board top y=0, front = +z). Pad radii are (x, y up, z).\n")
        f.write("export const BONSAI = " + json.dumps(data, separators=(",", ":")) + " as const;\n")


def render(s):
    sc = bpy.context.scene
    for c in bpy.context.scene.collection.children:
        c.hide_render = not c.name.endswith(f"-{s}")
    world = sc.world or bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    hdr = os.path.join(SRC, "raw", "polyhaven", "chinese_garden", "chinese_garden_1k.hdr")
    if os.path.isfile(hdr) and not any(n.type == "TEX_ENVIRONMENT" for n in nt.nodes):
        env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(hdr)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    if "sun" not in bpy.data.objects:
        ld = bpy.data.lights.new("sun", "SUN"); ld.energy = 3.0; ld.color = (1.0, 0.9, 0.78); ld.angle = math.radians(6)
        lo = bpy.data.objects.new("sun", ld); lo.rotation_euler = (math.radians(50), 0, math.radians(35))
        sc.collection.objects.link(lo)
        cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.angle = math.radians(30)
        co = bpy.data.objects.new("cam", cd); sc.collection.objects.link(co); sc.camera = co
        el = math.radians(14)
        tgt = Vector((0, 0, 0.2))
        co.location = tgt + 1.3 * Vector((0, -math.cos(el), math.sin(el)))
        co.rotation_euler = (tgt - co.location).to_track_quat("-Z", "Y").to_euler()
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
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
        bpy.data.materials.remove(m)
    IMG.clear()
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)


ENV_SRC = os.path.join(PREP, "hd", "env-hd.jpg")
ENV_PATH = "assets/env-hd.jpg"


def copy_env():
    """The HD environment image (plugin.yml role: environment) ships beside the GLBs."""
    dst = os.path.join(OUT, ENV_PATH)
    with open(ENV_SRC, "rb") as f:
        data = f.read()
    with open(dst, "wb") as f:
        f.write(data)
    w, h = struct.unpack(">HH", data[data.index(b"\xff\xc0") + 5:][:4])[::-1]
    return {"id": "env-hd", "path": ENV_PATH, "role": "environment", "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "image": f"{w}x{h}", "gpu": w * h * 4 * 4 // 3}


def sync_manifest(sets, env):
    """Rewrite plugin.yml's assets block (standard ids first, then -hd, then the HD env image)."""
    path = os.path.join(OUT, "plugin.yml")
    if not os.path.isfile(path) or not all(k in sets for k in ("standard", "hd")):
        return
    text = open(path).read()
    start, end = text.index("assets:\n"), text.index("viz:\n")
    rows = ["assets:"]
    for s in ("standard", "hd"):
        for r in sets[s]:
            rows += [f"  - id: {r['id']}", f"    path: {r['path']}", f"    sha256: {r['sha256']}",
                     f"    bytes: {r['bytes']}", f"    triangles: {r['triangles']}"]
    if env:
        rows += [f"  - id: {env['id']}", f"    path: {env['path']}", f"    role: {env['role']}",
                 f"    sha256: {env['sha256']}", f"    bytes: {env['bytes']}"]
    with open(path, "w") as f:
        f.write(text[:start] + "\n".join(rows) + "\n" + text[end:])


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    meta = {"sets": {}, "gltfpack": subprocess.run([GLTFPACK, "-v"], capture_output=True, text=True).stdout.strip()
            or "gltfpack", "blender": bpy.app.version_string}
    info = None
    for s in SETS:
        info = build(s)
        meta["sets"][s] = export(s, info["pads"])
        if RENDER:
            render(s)
        if s == "standard":
            # pads and the leaf-landing grid come from the Standard build; the HD tree shares its skeleton
            write_data(info)
        if s != SETS[-1]:
            clear_set(s)
    meta_path = os.path.join(OUT, "blender", "build_bonsai_meta.json")
    old = {}
    if os.path.isfile(meta_path):
        old = json.load(open(meta_path))
    old.setdefault("sets", {}).update(meta["sets"])
    old["gltfpack"], old["blender"] = meta["gltfpack"], meta["blender"]
    old["env"] = copy_env()
    with open(meta_path, "w") as f:
        json.dump(old, f, indent=2, sort_keys=True); f.write("\n")
    sync_manifest(old["sets"], old["env"])
    print("BONSAI_BUILD_DONE")
    sys.stdout.flush()


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    print("BONSAI_BUILD_FAILED")
    sys.stdout.flush()
if QUIT:
    bpy.ops.wm.quit_blender()
