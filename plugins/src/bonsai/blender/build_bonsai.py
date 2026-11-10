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
from mathutils import Vector, Matrix
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
SHOTS = os.path.join(ROOT, "out", "shots", "bonsai")
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
    patch = g.math("GREATER_THAN", tex.outputs["Fac"], 0.55)
    ring = g.math("LESS_THAN", g.math("ADD", near, g.math("MULTIPLY", tex.outputs["Fac"], 0.06)), 0.15)
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
    lift = g.mad(g.math("MULTIPLY", inner, g.mad(bump.outputs["Fac"], 0.009, -0.0015)), 1.0, 0.0007)
    geo = g.n("GeometryNodeSetPosition", {"Geometry": geo, "Offset": g.vmath("SCALE", nrm, scale=lift)}).outputs["Geometry"]
    bm = g.bmesh(geo, ob=slab_ob)
    box_uv(bm, 0.035)
    return bm


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

    def add(self, pts, wrap=None):
        """pts: [(Vector, radius)]."""
        if wrap is None:
            wrap = max(1, round(TAU * pts[0][1] / BARK_TILE))
        self.chains.append((pts, wrap))

    def object(self, name):
        me = bpy.data.meshes.new(name)
        verts, edges, rad, wrap = [], [], [], []
        for pts, w in self.chains:
            base = len(verts)
            for i, (p, r) in enumerate(pts):
                verts.append(tuple(p)); rad.append(r); wrap.append(float(w))
                if i:
                    edges.append((base + i - 1, base + i))
        me.from_pydata(verts, edges, [])
        for nm, vals in (("radius", rad), ("wrap", wrap)):
            a = me.attributes.new(nm, "FLOAT", "POINT")
            a.data.foreach_set("value", vals)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def sweep(skel, name, ring, res):
    """GN: edge chains -> Catmull-Rom curves -> radius-scaled open-arc sweep with seamless bark UVs."""
    src = skel.object(name + "-skel")
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
    uv = g.xyz(g.math("MULTIPLY", g.named("around"), g.named("wrap")), g.math("DIVIDE", g.named("along"), BARK_TILE))
    mesh = g.store(mesh, "uvw", uv, "FLOAT_VECTOR", "CORNER")
    bm = g.bmesh(mesh, ob=src)
    bpy.data.objects.remove(src, do_unlink=True)
    for nm in ("along", "around", "wrap", "radius"):
        lay = bm.verts.layers.float.get(nm)
        if lay is not None:
            bm.verts.layers.float.remove(lay)
    holes = [e for e in bm.edges if e.is_boundary]
    if holes:
        bmesh.ops.holes_fill(bm, edges=holes, sides=0)
    return bm


def add_pad(pads, centre, radii, tip, fine, rng, hd):
    k = len(pads)
    pads.append({"centre": centre.copy(), "radii": radii, "tip": tip.copy()})
    n = 4 if hd else 3
    for j in range(n):
        a = TAU * (j + rng.random() * 0.6) / n
        end = centre + Vector((math.cos(a) * radii[0] * 0.62, math.sin(a) * radii[1] * 0.62, radii[2] * (0.05 + 0.25 * rng.random())))
        mid = tip.lerp(end, 0.5) + Vector((0, 0, 0.004))
        fine.add([(tip, 0.0034), (mid, 0.0024), (end, 0.0012)], wrap=1)
    return k


def build_tree(hd, M, ct, slab_ob, ground):
    rng = random.Random(TREE_SEED)
    hit = ground(TRUNK_XY[0], TRUNK_XY[1])
    base = Vector((TRUNK_XY[0], TRUNK_XY[1], hit))
    thick, thin, fine = Skeleton(), Skeleton(), Skeleton()
    thick.add([(base + Vector(p[:3]), p[3]) for p in TRUNK])
    pads = []
    # nebari: surface roots hugging the slab
    for az, reach in ROOTS:
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
        add_pad(pads, tip + Vector((0, 0, radii[2] * 0.45)), radii, tip, fine, rng, hd)
        if sec:
            daz, at, reach2, r2 = sec
            sp_, sr = pts[1] if at < 0.45 else pts[2]
            a2 = a + math.radians(daz)
            d2 = Vector((math.cos(a2), math.sin(a2), 0))
            tip2 = sp_ + d2 * reach2 + Vector((0, 0, 0.012))
            thin.add([(sp_, sr * 0.8), (sp_.lerp(tip2, 0.5) + Vector((0, 0, -0.004)), sr * 0.55), (tip2, 0.0035)], wrap=1)
            add_pad(pads, tip2 + Vector((0, 0, r2[2] * 0.45)), r2, tip2, fine, rng, hd)
    apex, _ = trunk_at(1.0)
    apex = base + apex
    add_pad(pads, apex + Vector((0, 0, APEX_PAD[2] * 0.35)), APEX_PAD, apex, fine, rng, hd)
    assert len(pads) <= MAX_PADS, len(pads)
    bm = sweep(thick, "trunk-thick", 16 if hd else 10, 6 if hd else 4)
    for sk, nm, ring, res in ((thin, "branches", 10 if hd else 7, 5 if hd else 3), (fine, "twigs", 4, 3 if hd else 2)):
        part = sweep(sk, nm, ring, res)
        me = bpy.data.meshes.new("tmp"); part.to_mesh(me); part.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    trunk = new_obj("trunk", bm, M["bark"], ct, smooth=90, recalc=False)
    foliage = new_obj("foliage", build_foliage(pads, hd), M["leaf"], ct, smooth=90, recalc=False)
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


def foliage_data(ob, pads):
    """COLOR_0 = (AO, pad code, rank) and bent normals (the pad dome's), per vertex."""
    me = ob.data
    rank = me.attributes.get("rank")
    rk = [0.0] * len(me.vertices)
    if rank is not None:
        rank.data.foreach_get("value", rk)
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
            rgb.append((ao, (k + 0.5) / MAX_PADS, rk[i]))
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
        if s == "standard" or len(SETS) == 1:
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
