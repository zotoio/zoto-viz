"""Orrery generator (Blender 5.x, run with the GUI visible).

  python3 plugins/src/orrery/blender/fetch_sources.py          # CC0 maps -> out/sources/orrery/prep
  blender --gpu-backend vulkan --window-geometry 1400 0 1400 900 \
      --python plugins/src/orrery/blender/build_orrery.py -- --out plugins/src/orrery

Builds a brass clockwork orrery on a walnut study desk, per model set (Standard and HD):
  assets/orrery-study[-hd].glb    desk, leather blotter, books, banker's lamp, walnut plinth
  assets/orrery-machine[-hd].glb  base plate, zodiac ring, column, sun, gear train, escapement,
                                  arm templates (hub, bar, post, cup); HD also carries every brass part
  assets/orrery-planets[-hd].glb  planet-0..6 unit-sphere templates (planet-6 carries its ring)
  assets/env-hd.jpg               HD only: the study HDRI as the pack's `role: environment` image
Gears, rings, the hairspring and arm parts are geometry-node trees driven by real photo textures.
Exports go through gltfpack (-cc -kn -km); writes blender/build_orrery_meta.json and
frontend/orrery-data.ts (pivots, gear radii, arm layout in glTF Y-up metres). Deterministic.
"""
import bpy, bmesh, math, json, os, sys, subprocess, hashlib
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.getcwd()
SETS = [argv[argv.index("--set") + 1]] if "--set" in argv else ["standard", "hd"]
RENDER = "--no-render" not in argv
QUIT = "--keep-open" not in argv
ROOT = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
PREP = os.path.join(ROOT, "out", "sources", "orrery", "prep")
BUILD = os.path.join(ROOT, "out", "sources", "orrery", "build")
SHOTS = os.path.join(ROOT, "out", "shots", "orrery")
GLTFPACK = os.environ.get("GLTFPACK") or os.path.join(ROOT, "out", "tools", "node_modules", ".bin", "gltfpack")
TAU = math.tau

# ---------------------------------------------------------------- layout (Blender Z-up metres, front = -Y)
PLINTH_R, PLINTH_Z0, PLINTH_Z1 = 0.30, 0.025, 0.072
PLATE_R, PLATE_T = 0.262, 0.008
BASE_Z = PLINTH_Z1 + PLATE_T
SUN_Z, SUN_R = 0.40, 0.045
COLUMN_R = 0.011
MOD = 0.0028
GEAR_T = 0.005
GEAR_Z = BASE_Z + 0.006
N_ARMS = 8
POST_H = 0.026
def hub_h(k): return 0.33 - 0.026 * k
def arm_r(k): return 0.10 + 0.05 * k
G_CROWN = dict(name="gear-crown", teeth=60, xy=(0.0, 0.0), z=GEAR_Z)
_g2 = (0.5 * MOD * (60 + 36)) * Vector((math.cos(math.radians(-50)), math.sin(math.radians(-50))))
_g3 = _g2 + (0.5 * MOD * (36 + 20)) * Vector((math.cos(math.radians(-10)), math.sin(math.radians(-10))))
G_2 = dict(name="gear-2", teeth=36, xy=tuple(_g2), z=GEAR_Z)
G_3 = dict(name="gear-3", teeth=20, xy=tuple(_g3), z=GEAR_Z)
ESC = dict(name="escape-wheel", teeth=15, r=0.032, xy=tuple(_g3), z=GEAR_Z + 0.016)
_adir = Vector((math.cos(math.radians(-150)), math.sin(math.radians(-150))))
ANCHOR_XY = tuple(_g3 + 0.047 * _adir)
BAL_XY = tuple(_g3 + 0.047 * _adir + 0.044 * _adir)
ANCHOR_Z = ESC["z"] + 0.0015
BAL_Z, BAL_R = GEAR_Z + 0.034, 0.03
LAMP = dict(xy=(0.92, 0.34), head=(0.92, 0.22, 0.43))
STUDY_TOP = 0.0035   # blotter top

def gl(v):  # Blender Z-up -> glTF Y-up
    return [round(v[0], 5) + 0.0, round(v[2], 5) + 0.0, round(-v[1], 5) + 0.0]


# ---------------------------------------------------------------- materials
IMG = {}
def img(set_name, name, data=False):
    path = os.path.join(PREP, set_name, name)
    if not os.path.isfile(path):
        path = os.path.join(PREP, "standard", name)
    key = path
    if key not in IMG:
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = "Non-Color" if data else "sRGB"
        IMG[key] = im
    return IMG[key]


def mat(name, set_name, diff, nrm=None, orm=None, metal=0.0, rough=0.5, coat=0.0, coat_rough=0.08,
        emit=None, emit_strength=0.0, blend=False, nrm_strength=1.0, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(set_name, diff)
    if tint:  # exported as baseColorFactor (glTF: Mix RGBA Multiply by a constant, factor 1)
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        mx.inputs[7].default_value = (*tint, 1.0)
        nt.links.new(t.outputs["Color"], mx.inputs[6]); nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    else:
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
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
    if orm:
        to = nt.nodes.new("ShaderNodeTexImage"); to.image = img(set_name, orm, data=True)
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(to.outputs["Color"], sp.inputs["Color"])
        nt.links.new(sp.outputs["Green"], b.inputs["Roughness"]); nt.links.new(sp.outputs["Blue"], b.inputs["Metallic"])
    if coat > 0:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if emit:
        te = nt.nodes.new("ShaderNodeTexImage"); te.image = img(set_name, emit)
        nt.links.new(te.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def materials(s):
    hd = s == "hd"
    M = {}
    if hd:
        # roughness / metal are the scanned maps' means (those maps are near-constant); one neutral
        # leather scan is tinted per material, so the blotter and both books share its two maps
        M["brass"] = mat("brass", s, "brass_diff.jpg", metal=1.0, rough=0.24)
        M["brushed"] = mat("brass-brushed", s, "brass_diff.jpg", "brushed_nrm.jpg", metal=1.0, rough=0.22, nrm_strength=0.35)
        M["walnut"] = mat("walnut", s, "walnut_diff.jpg", metal=0.0, rough=0.43, coat=0.35, coat_rough=0.12)
        M["leather"] = mat("leather", s, "leather_lum.jpg", "leather_nrm.jpg", rough=0.5, tint=(0.1758, 0.0552, 0.0226))
        M["book-green"] = mat("book-green", s, "leather_lum.jpg", "leather_nrm.jpg", rough=0.5, tint=(0.0552, 0.1669, 0.0752))
        M["book-navy"] = mat("book-navy", s, "leather_lum.jpg", "leather_nrm.jpg", rough=0.5, tint=(0.0387, 0.0648, 0.2039))
    else:
        M["brass"] = mat("brass", s, "brass_diff.jpg", metal=0.55, rough=0.45)
        M["brushed"] = M["brass"]
        M["walnut"] = mat("walnut", s, "walnut_diff.jpg", rough=0.55)
        M["leather"] = mat("leather", s, "leather_diff.jpg", rough=0.7)
        M["book-green"] = mat("book-green", s, "book_green.jpg", rough=0.7)
        M["book-navy"] = mat("book-navy", s, "book_navy.jpg", rough=0.7)
    M["pages"] = mat("pages", s, "pages.jpg" if hd else "planet_saturn.jpg", rough=0.8)
    M["shade"] = mat("lamp-shade", s, "lamp_shade.jpg", rough=0.12 if hd else 0.3, coat=0.8 if hd else 0.0,
                     emit="lamp_shade.jpg", emit_strength=0.35)
    M["shadow"] = mat("contact-shadow", s, "contact_shadow.png", rough=1.0, blend=True)
    M["sun"] = mat("sun", s, "sun_diff.jpg", metal=0.0, rough=0.4, emit="sun_diff.jpg", emit_strength=0.9 if hd else 0.8)
    planets = ["jove", "terra", "ares", "luna", "nox", "glacier", "saturn"]
    if hd:
        M["planets"] = [mat("planet-atlas", s, "planet_atlas.jpg", rough=0.35, coat=0.5, coat_rough=0.1)] * len(planets)
    else:
        M["planets"] = [mat(f"planet-{p}", s, f"planet_{p}.jpg", rough=0.6, coat=0.0, coat_rough=0.1) for p in planets]
    return M


# ---------------------------------------------------------------- mesh helpers
COLL = {}
def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    COLL[name] = c
    return c


def smooth_sharp(bm, angle=35.0):
    lim = math.radians(angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0.0) > lim:
            e.smooth = False


def box_uv(bm, s=0.25, off=(0.0, 0.0)):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            u, v = (c.x, c.y) if ax == 2 else ((c.x, c.z) if ax == 1 else (c.y, c.z))
            l[uv].uv = (u / s + off[0], v / s + off[1])


def new_obj(name, bm, m, coll, loc=(0, 0, 0), uv=0.25, smooth=35.0, keep_uv=False, rot_z=0.0, parent=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if not keep_uv:
        box_uv(bm, uv)
    if smooth is not None:
        smooth_sharp(bm, smooth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    me.materials.append(m)
    coll.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def bm_box(bm, c, d):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r["verts"]:
        v.co = Vector((c[0] + v.co.x * d[0], c[1] + v.co.y * d[1], c[2] + v.co.z * d[2]))
    return r["verts"]


def bm_cyl(bm, c, r, h, seg=32, r2=None):
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                                radius2=r if r2 is None else r2, depth=h)
    for v in res["verts"]:
        v.co += Vector(c) + Vector((0, 0, h / 2))
    return res["verts"]


def bm_sphere(bm, c, r, u=24, v=12):
    bm.loops.layers.uv.verify()  # calc_uvs only fills an existing UV layer
    res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r, calc_uvs=True)
    for vv in res["verts"]:
        vv.co += Vector(c)
    return res["verts"]


def bevel_edges(bm, offset, segs=2, angle=60.0):
    lim = math.radians(angle)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segs, affect="EDGES", profile=0.5, clamp_overlap=True)


# ---------------------------------------------------------------- geometry nodes
class GN:
    """Tiny builder: one GN tree on an empty mesh object, evaluated to a plain bmesh."""

    def __init__(self, name):
        self.ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
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

    def vmath(self, op, a, b=None, scale=None):
        node = self.n("ShaderNodeVectorMath", operation=op)
        self.feed(node.inputs[0], a)
        if b is not None:
            self.feed(node.inputs[1], b)
        if scale is not None:
            self.feed(node.inputs["Scale"], scale)
        return node.outputs["Vector"]

    def xform(self, geo, t=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
        node = self.n("GeometryNodeTransform", {"Geometry": geo})
        node.inputs["Translation"].default_value = t
        node.inputs["Rotation"].default_value = r
        node.inputs["Scale"].default_value = s
        return node.outputs["Geometry"]

    def join(self, *geos):
        return self.n("GeometryNodeJoinGeometry", {"Geometry": list(geos)}).outputs["Geometry"]

    def tube(self, curve, w, h, caps=True, kind="line"):
        if TUBE_SWAP[kind]:
            w, h = h, w
        q = self.n("GeometryNodeCurvePrimitiveQuadrilateral", {"Width": w, "Height": h})
        return self.n("GeometryNodeCurveToMesh", {"Curve": curve, "Profile Curve": q.outputs["Curve"],
                                                  "Fill Caps": caps}).outputs["Mesh"]

    def radial(self, points, inst):
        """Instance `inst` on each curve point, local +X pointing away from the centre."""
        pos = self.n("GeometryNodeInputPosition").outputs[0]
        try:
            al = self.n("FunctionNodeAlignRotationToVector", {"Vector": pos})
        except RuntimeError:
            al = self.n("FunctionNodeAlignEulerToVector", {"Vector": pos})
        al.axis = "X"
        iop = self.n("GeometryNodeInstanceOnPoints", {"Points": points, "Instance": inst,
                                                     "Rotation": al.outputs[0]})
        return self.n("GeometryNodeRealizeInstances", {"Geometry": iop.outputs["Instances"]}).outputs["Geometry"]

    def bmesh(self, geo):
        self.ng.links.new(geo, self.out.inputs[0])
        me = bpy.data.meshes.new(self.ng.name + "-src")
        ob = bpy.data.objects.new(self.ng.name + "-src", me)
        bpy.context.scene.collection.objects.link(ob)
        mod = ob.modifiers.new("gn", "NODES"); mod.node_group = self.ng
        dg = bpy.context.evaluated_depsgraph_get()
        res = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob, do_unlink=True); bpy.data.meshes.remove(me)
        bpy.data.node_groups.remove(self.ng)
        bm = bmesh.new(); bm.from_mesh(res); bpy.data.meshes.remove(res)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
        return bm


TUBE_SWAP = {"circle": False, "line": False}


def probe_tubes():
    """Curve to Mesh maps the profile onto the curve normal frame; measure it once instead of guessing."""
    for kind in ("circle", "line"):
        g = GN(f"probe-{kind}")
        if kind == "circle":
            c = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 32, "Radius": 0.2}).outputs["Curve"]
        else:
            c = g.n("GeometryNodeCurvePrimitiveLine", {"Start": (0, 0, 0), "End": (1, 0, 0)}).outputs["Curve"]
        bm = g.bmesh(g.tube(c, 0.03, 0.001, caps=kind == "line", kind=kind))
        dz = max(v.co.z for v in bm.verts) - min(v.co.z for v in bm.verts)
        bm.free()
        TUBE_SWAP[kind] = dz > 0.01
    print("tube orientation swap", TUBE_SWAP)


def gn_gear(name, teeth, r, t, hd, style="spur", bore=0.0035, windows=0, boss=True):
    """Gear blank as GN: tooth-profiled circle -> fill -> extrude, closed, boss unioned, bore and
    crossing windows cut with an exact Mesh Boolean."""
    g = GN(name)
    res = teeth * (8 if hd else 4)
    circ = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": res, "Radius": r})
    pos = g.n("GeometryNodeInputPosition").outputs[0]
    sep = g.n("ShaderNodeSeparateXYZ", {"Vector": pos})
    th = g.math("ARCTAN2", sep.outputs["Y"], sep.outputs["X"])
    if style == "saw":
        ph = g.math("FRACT", g.math("MULTIPLY", th, teeth / TAU))
        f = g.math("SUBTRACT", g.math("POWER", ph, 1.6), 0.62)
        off = g.math("MULTIPLY", f, 3.2 * MOD)
    else:
        s = g.math("SINE", g.math("MULTIPLY", th, float(teeth)))
        f = g.math("MAXIMUM", g.math("MINIMUM", g.math("MULTIPLY", s, 1.7), 1.0), -1.0)
        off = g.math("MULTIPLY", g.math("SUBTRACT", g.math("MULTIPLY", f, 1.125), 0.125), MOD)
    vec = g.vmath("SCALE", g.vmath("NORMALIZE", pos), scale=off)
    sp = g.n("GeometryNodeSetPosition", {"Geometry": circ.outputs["Curve"], "Offset": vec})
    fill = g.n("GeometryNodeFillCurve", {"Curve": sp.outputs["Geometry"]})
    if hasattr(fill, "mode"):
        fill.mode = "NGONS"
    elif "Mode" in fill.inputs:
        try:
            fill.inputs["Mode"].default_value = "N-gons"
        except (TypeError, ValueError):
            pass
    ext = g.n("GeometryNodeExtrudeMesh", {"Mesh": fill.outputs["Mesh"], "Offset": (0.0, 0.0, 1.0), "Offset Scale": t})
    ext.mode = "FACES"
    flip = g.n("GeometryNodeFlipFaces", {"Mesh": fill.outputs["Mesh"]})
    blank = g.n("GeometryNodeMergeByDistance", {"Geometry": g.join(ext.outputs["Mesh"], flip.outputs["Mesh"]),
                                                 "Distance": 1e-6}).outputs["Geometry"]
    if boss:
        cyl = g.n("GeometryNodeMeshCylinder", {"Vertices": 32 if hd else 16, "Radius": bore * 2.4, "Depth": t * 1.8})
        u = g.n("GeometryNodeMeshBoolean", {"Mesh 2": [blank, g.xform(cyl.outputs["Mesh"], (0, 0, t / 2))]})
        u.operation = "UNION"
        blank = u.outputs["Mesh"]
    cuts = [g.n("GeometryNodeMeshCylinder", {"Vertices": 24 if hd else 12, "Radius": bore, "Depth": 1.0}).outputs["Mesh"]]
    if windows:
        rin, rout = bore * 2.4 + 0.002, r - 2.4 * MOD
        rd, rw = 0.5 * (rin + rout), 0.5 * (rout - rin) * 0.92
        if rw > 0.0025:
            ring = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": windows, "Radius": rd})
            hole = g.n("GeometryNodeMeshCylinder", {"Vertices": 28, "Radius": min(rw, rd * math.sin(math.pi / windows) * 0.78),
                                                    "Depth": 1.0})
            cuts.append(g.radial(ring.outputs["Curve"], hole.outputs["Mesh"]))
    d = g.n("GeometryNodeMeshBoolean", {"Mesh 1": blank, "Mesh 2": cuts})
    d.operation = "DIFFERENCE"
    bm = g.bmesh(d.outputs["Mesh"])
    if hd:  # the exporter fans the toothed n-gon faces into needles that the packed grid flattens
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
        bmesh.ops.dissolve_degenerate(bm, dist=3e-4, edges=bm.edges[:])
    return bm


def gn_ring(name, r, w, h, ticks=0, major=0, tick_len=0.008, hd=True):
    """Annulus as a swept quad, optional radial tick marks instanced on a circle."""
    g = GN(name)
    c = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 192 if hd else 96, "Radius": r})
    geo = [g.tube(c.outputs["Curve"], w, h, caps=False, kind="circle")]
    for count, ln, wd in ((ticks, tick_len, 0.0008), (major, tick_len * 1.6, 0.0016)):
        if count:
            pts = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": count, "Radius": r})
            cube = g.n("GeometryNodeMeshCube", {"Size": (ln, wd, h * 1.6)})
            geo.append(g.radial(pts.outputs["Curve"], cube.outputs["Mesh"]))
    return g.bmesh(g.join(*geo))


def gn_balance(hd):
    g = GN("balance")
    rim = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 96 if hd else 48, "Radius": BAL_R})
    geo = [g.tube(rim.outputs["Curve"], 0.003, 0.0026, caps=False, kind="circle")]
    sp = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 3, "Radius": BAL_R / 2})
    bar = g.n("GeometryNodeMeshCube", {"Size": (BAL_R, 0.0022, 0.0016)})
    geo.append(g.radial(sp.outputs["Curve"], bar.outputs["Mesh"]))
    hub = g.n("GeometryNodeMeshCylinder", {"Vertices": 24, "Radius": 0.0035, "Depth": 0.004})
    geo.append(hub.outputs["Mesh"])
    if hd:
        sc = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 12, "Radius": BAL_R + 0.0018})
        screw = g.n("GeometryNodeMeshCylinder", {"Vertices": 12, "Radius": 0.0011, "Depth": 0.0022})
        geo.append(g.radial(sc.outputs["Curve"], g.xform(screw.outputs["Mesh"], r=(0, math.pi / 2, 0))))
    return g.bmesh(g.join(*geo))


def gn_hairspring():
    g = GN("hairspring")
    sp = g.n("GeometryNodeCurveSpiral", {"Resolution": 64, "Rotations": 9.0, "Start Radius": 0.0045,
                                         "End Radius": 0.016, "Height": 0.0})
    return g.bmesh(g.tube(sp.outputs["Curve"], 0.00035, 0.0016, kind="circle"))


def gn_bar(name, pts, w, h, closed=False):
    """Swept rectangular bar through `pts` (anchor fork, lamp arm, arm bar)."""
    g = GN(name)
    line = g.n("GeometryNodeCurvePrimitiveLine", {"Start": pts[0], "End": pts[1]})
    geo = [g.tube(line.outputs["Curve"], w, h)]
    for a, b in zip(pts[1:-1], pts[2:]):
        l2 = g.n("GeometryNodeCurvePrimitiveLine", {"Start": a, "End": b})
        geo.append(g.tube(l2.outputs["Curve"], w, h))
    return g.bmesh(g.join(*geo))


def gn_torus(name, r, rr, hd=True):
    g = GN(name)
    c = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 64 if hd else 32, "Radius": r})
    p = g.n("GeometryNodeCurvePrimitiveCircle", {"Resolution": 12 if hd else 8, "Radius": rr})
    return g.bmesh(g.n("GeometryNodeCurveToMesh", {"Curve": c.outputs["Curve"], "Profile Curve": p.outputs["Curve"]}).outputs["Mesh"])


ATLAS_W, ATLAS_H, ATLAS_COLS, ATLAS_ROWS, ATLAS_PAD = 512, 512, 2, 4, 2  # fetch_sources.planet_atlas


def atlas_uv(bm, cell):
    """Squeeze a [0,1] UV layout into the HD planet atlas cell (inside its padding)."""
    uv = bm.loops.layers.uv.verify()
    cw, ch = ATLAS_W / ATLAS_COLS, ATLAS_H / ATLAS_ROWS
    x0, y0 = (cell % ATLAS_COLS) * cw + ATLAS_PAD, (cell // ATLAS_COLS) * ch + ATLAS_PAD
    w, h = cw - 2 * ATLAS_PAD, ch - 2 * ATLAS_PAD
    for f in bm.faces:
        for l in f.loops:
            u, v = l[uv].uv
            l[uv].uv = ((x0 + u * w) / ATLAS_W, 1.0 - (y0 + (1.0 - v) * h) / ATLAS_H)


def ring_uv(bm, r_in, r_out):
    """Ring bands run with the radius: v = radial fraction, u held at the cell's middle (no seam)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            r = math.hypot(l.vert.co.x, l.vert.co.y)
            l[uv].uv = (0.5, min(1.0, max(0.0, (r - r_in) / (r_out - r_in))))


def merge_into(dst, src, mat=None):
    me = bpy.data.meshes.new("tmp"); src.to_mesh(me); src.free()
    dst.from_mesh(me); bpy.data.meshes.remove(me)


# ---------------------------------------------------------------- build
def build(s):
    hd = s == "hd"
    M = materials(s)
    stats = {}
    # ---- study ----------------------------------------------------------------
    cs = collection(f"orrery-study-{s}")
    bm = bmesh.new(); bm_box(bm, (0, 0.1, -0.025), (3.4, 1.3, 0.05))
    if hd:
        bevel_edges(bm, 0.006, 3)
    new_obj("desk-top", bm, M["walnut"], cs, uv=0.9)
    bm = bmesh.new(); bm_box(bm, (0, -0.53, -0.11), (3.3, 0.04, 0.12))
    if hd:
        bevel_edges(bm, 0.004, 2)
    new_obj("desk-apron", bm, M["walnut"], cs, uv=0.9)
    bm = bmesh.new(); bm_box(bm, (0, 0.02, STUDY_TOP / 2), (1.36, 0.82, STUDY_TOP))
    new_obj("blotter", bm, M["leather"], cs, uv=0.35)
    if hd:  # brass blotter corners
        bm = bmesh.new()
        for sx in (-1, 1):
            for sy in (-1, 1):
                cx, cy = sx * 0.66, 0.02 + sy * 0.39
                bm_box(bm, (cx, cy, STUDY_TOP + 0.0006), (0.05, 0.05, 0.0012))
        new_obj("blotter-corners", bm, M["brass"], cs, uv=0.05)
    # plinth + feet
    bm = bmesh.new(); bm_cyl(bm, (0, 0, PLINTH_Z0), PLINTH_R, PLINTH_Z1 - PLINTH_Z0, 96 if hd else 48)
    if hd:
        bevel_edges(bm, 0.004, 3, 50)
    new_obj("plinth", bm, M["walnut"], cs, uv=0.4)
    bm = bmesh.new()
    for k in range(4):
        a = TAU * (k + 0.5) / 4
        bm_sphere(bm, (0.25 * math.cos(a), 0.25 * math.sin(a), STUDY_TOP + 0.011), 0.013, 24 if hd else 12, 12 if hd else 6)
    new_obj("plinth-feet", bm, M["brass"], cs, uv=0.03, keep_uv=True, smooth=80)
    if hd:
        tr = gn_torus("plinth-trim", PLINTH_R + 0.0015, 0.003)
        for v in tr.verts:
            v.co.z += PLINTH_Z1 - 0.004
        new_obj("plinth-trim", tr, M["brass"], cs, uv=0.05, smooth=80)
    bm = bmesh.new(); r = bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.4)
    uv = bm.loops.layers.uv.verify()
    for v in r["verts"]:
        v.co.z = STUDY_TOP + 0.0004
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / 0.8 + 0.5, l.vert.co.y / 0.8 + 0.5)
    new_obj("contact-shadow", bm, M["shadow"], cs, keep_uv=True, smooth=None)
    # books (back left) — leather covers, travertine page block
    books = [((-0.92, 0.36), 0.30, 0.22, 0.045, 0.12, M["book-green"]),
             ((-0.91, 0.355), 0.27, 0.20, 0.038, -0.05, M["leather"]),
             ((-0.93, 0.37), 0.25, 0.18, 0.034, 0.22, M["book-navy"])]
    z = 0.0
    for i, (c, L, W, H, rz, cm) in enumerate(books):
        bm = bmesh.new(); bm_box(bm, (0, 0, H / 2), (L, W, H))
        if hd:
            bevel_edges(bm, 0.003, 2)
        new_obj(f"book-{i}", bm, cm, cs, loc=(c[0], c[1], z), uv=0.2, rot_z=rz)
        bm = bmesh.new(); bm_box(bm, (0.006, 0, H / 2), (L - 0.012, W - 0.004, H * 0.8))
        bm.verts.ensure_lookup_table()
        new_obj(f"book-{i}-pages", bm, M["pages"], cs, loc=(c[0], c[1], z), uv=0.06, rot_z=rz)
        z += H
    # banker's lamp (back right): brass base, stem, arm, green glass shade
    lx, ly = LAMP["xy"]; hx, hy, hz = LAMP["head"]
    bm = bmesh.new()
    bm_cyl(bm, (lx, ly, 0), 0.085, 0.018, 64 if hd else 32, r2=0.07)
    bm_cyl(bm, (lx, ly, 0.018), 0.009, 0.34, 24 if hd else 12)
    if hd:
        for zz in (0.06, 0.2, 0.34):
            bm_cyl(bm, (lx, ly, zz), 0.013, 0.008, 24)
    new_obj("lamp-base", bm, M["brass"], cs, uv=0.05)
    arm = gn_bar("lamp-arm", [(lx, ly, 0.355), (lx, ly - 0.06, 0.42), (hx, hy, hz + 0.02)], 0.008, 0.008)
    new_obj("lamp-arm", arm, M["brass"], cs, uv=0.05)
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=False, segments=48 if hd else 24, radius1=0.075, radius2=0.045, depth=0.07)
    for v in res["verts"]:
        v.co = Vector((v.co.x * 1.0, v.co.y * 0.55, v.co.z)) + Vector((hx, hy, hz))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.003)
    new_obj("lamp-shade", bm, M["shade"], cs, uv=0.1)
    # ---- machine ---------------------------------------------------------------
    cm = collection(f"orrery-machine-{s}")
    if hd:  # every GLB decodes its own images: HD brass lives in the machine GLB only
        for ob in [o for o in cs.objects if o.active_material is M["brass"]]:
            cs.objects.unlink(ob)
            cm.objects.link(ob)
    bm = bmesh.new(); bm_cyl(bm, (0, 0, PLINTH_Z1), PLATE_R, PLATE_T, 128 if hd else 64)
    if hd:
        bevel_edges(bm, 0.0015, 2, 50)
    new_obj("base-plate", bm, M["brushed"], cm, uv=0.08)
    zr = gn_ring("zodiac-ring", PLATE_R - 0.022, 0.03, 0.0018, ticks=72 if hd else 0, major=12, hd=hd)
    for v in zr.verts:
        v.co.z += BASE_Z + 0.0009
    new_obj("zodiac-ring", zr, M["brass"], cm, uv=0.08)
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, BASE_Z), COLUMN_R, SUN_Z - SUN_R * 0.7 - BASE_Z, 32 if hd else 16)
    bm_cyl(bm, (0, 0, BASE_Z), 0.026, 0.004, 48 if hd else 24, r2=0.018)
    if hd:
        for zz in (BASE_Z + 0.25, SUN_Z - SUN_R - 0.012):
            bm_cyl(bm, (0, 0, zz), 0.016, 0.005, 32)
        bm_cyl(bm, (0, 0, SUN_Z - SUN_R - 0.005), 0.024, 0.006, 32, r2=0.012)
    new_obj("column", bm, M["brass"], cm, uv=0.06)
    bm = bmesh.new(); bm_sphere(bm, (0, 0, 0), SUN_R, 64 if hd else 32, 32 if hd else 16)
    new_obj("sun", bm, M["sun"], cm, loc=(0, 0, SUN_Z), keep_uv=True, smooth=80)
    gears = {}
    for gd, win in ((G_CROWN, 6), (G_2, 5), (G_3, 0)):
        r = 0.5 * MOD * gd["teeth"]
        gb = gn_gear(gd["name"], gd["teeth"], r, GEAR_T, hd, windows=win if hd else 0,
                     bore=COLUMN_R + 0.0005 if gd is G_CROWN else 0.0025)
        gears[gd["name"]] = new_obj(gd["name"], gb, M["brushed"], cm, loc=(gd["xy"][0], gd["xy"][1], gd["z"]), uv=0.06)
    eb = gn_gear(ESC["name"], ESC["teeth"], ESC["r"], 0.0025, hd, style="saw", windows=5 if hd else 0, bore=0.0018)
    gears[ESC["name"]] = new_obj(ESC["name"], eb, M["brushed"], cm, loc=(ESC["xy"][0], ESC["xy"][1], ESC["z"]), uv=0.06)
    # anchor (pallet fork) in local frame: +X toward escape wheel, -X toward balance
    esc_dir = (Vector(ESC["xy"]) - Vector(ANCHOR_XY)).normalized()
    a_rot = math.atan2(esc_dir.y, esc_dir.x)
    fork = gn_bar("anchor", [(-0.044, 0, 0), (0.0, 0, 0), (0.018, 0.014, 0)], 0.0022, 0.002)
    merge_into(fork, gn_bar("anchor-b", [(0.0, 0, 0), (0.018, -0.014, 0)], 0.0022, 0.002))
    bm = bmesh.new(); bm_cyl(bm, (0, 0, -0.002), 0.0028, 0.004, 16)
    bm_box(bm, (0.0195, 0.0145, 0), (0.004, 0.002, 0.003)); bm_box(bm, (0.0195, -0.0145, 0), (0.004, 0.002, 0.003))
    merge_into(fork, bm)
    gears["anchor"] = new_obj("anchor", fork, M["brass"], cm, loc=(ANCHOR_XY[0], ANCHOR_XY[1], ANCHOR_Z), uv=0.04, rot_z=a_rot)
    bal = gn_balance(hd)
    gears["balance"] = new_obj("balance", bal, M["brushed"], cm, loc=(BAL_XY[0], BAL_XY[1], BAL_Z), uv=0.04)
    if hd:
        hs = gn_hairspring()
        new_obj("hairspring", hs, M["brass"], cm, loc=(BAL_XY[0], BAL_XY[1], BAL_Z - 0.004), uv=0.03)
    # arbors + balance cock (static)
    bm = bmesh.new()
    for gd in (G_2, G_3):
        bm_cyl(bm, (gd["xy"][0], gd["xy"][1], BASE_Z), 0.0024, ESC["z"] - BASE_Z + 0.006, 16)
    bm_cyl(bm, (ANCHOR_XY[0], ANCHOR_XY[1], BASE_Z), 0.002, ANCHOR_Z - BASE_Z + 0.004, 12)
    bm_cyl(bm, (BAL_XY[0], BAL_XY[1], BASE_Z), 0.002, BAL_Z - BASE_Z + 0.005, 12)
    cock_dir = (Vector(BAL_XY) - Vector(_g3)).normalized()
    cp = Vector(BAL_XY) + 0.045 * cock_dir
    bm_cyl(bm, (cp.x, cp.y, BASE_Z), 0.004, BAL_Z - BASE_Z + 0.004, 16)
    new_obj("arbors", bm, M["brass"], cm, uv=0.04)
    cock = gn_bar("balance-cock", [(cp.x, cp.y, BAL_Z + 0.0045), (BAL_XY[0], BAL_XY[1], BAL_Z + 0.0045)], 0.006, 0.002)
    new_obj("balance-cock", cock, M["brass"], cm, uv=0.04)
    # arm templates (host clones one set per talker slot); parked below the desk
    park = (0.0, 0.0, -5.0)
    hb = gn_gear("arm-pinion", 10, 0.5 * MOD * 10, 0.004, hd, bore=COLUMN_R + 0.0004, boss=False)
    for v in hb.verts:
        v.co.z -= 0.006
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, -0.002), 0.017, 0.008, 32 if hd else 16)
    bm_cyl(bm, (-0.035, 0, -0.001), 0.0018, 0.002, 8)
    bm_box(bm, (-0.018, 0, 0.0), (0.03, 0.003, 0.003))
    bm_sphere(bm, (-0.038, 0, 0.0), 0.006, 16 if hd else 8, 8 if hd else 4)
    merge_into(hb, bm)
    new_obj("arm-hub", hb, M["brass"], cm, loc=park, uv=0.04)
    bar = gn_bar("arm-bar", [(0.012, 0, 0), (1.0, 0, 0)], 0.006, 0.0035)
    new_obj("arm-bar", bar, M["brass"], cm, loc=park, uv=0.05)
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, 0), 0.0045, 0.004, 16)
    bm_cyl(bm, (0, 0, 0.004), 0.0022, POST_H - 0.004, 16 if hd else 8)
    new_obj("arm-post", bm, M["brass"], cm, loc=park, uv=0.03)
    cup = gn_torus("arm-cup", 0.0065, 0.0013, hd)
    new_obj("arm-cup", cup, M["brass"], cm, loc=park, uv=0.02, smooth=80)
    # ---- planets ---------------------------------------------------------------
    cp_ = collection(f"orrery-planets-{s}")
    for k in range(7):
        bm = bmesh.new(); bm_sphere(bm, (0, 0, 0), 1.0, 48 if hd else 24, 24 if hd else 12)
        if hd:
            atlas_uv(bm, k)
        p = new_obj(f"planet-{k}", bm, M["planets"][k], cp_, loc=(3.0 * k, 0, -5.0), keep_uv=True, smooth=80)
        if k == 6:
            ring = gn_ring("planet-6-ring", 1.75, 0.8, 0.04, hd=hd)
            if hd:  # the ring band is atlas cell 7, so the HD planets GLB carries one image
                ring_uv(ring, 1.75 - 0.4, 1.75 + 0.4)
                atlas_uv(ring, 7)
                ob = new_obj("planet-6-ring", ring, M["planets"][k], cp_, keep_uv=True)
            else:
                ob = new_obj("planet-6-ring", ring, M["brushed"], cp_, uv=0.5)
            ob.parent = p
            ob.rotation_euler = (math.radians(22), 0, 0)
    return M, gears


def canonical_indices(path):
    """The glTF exporter emits the same triangles in a run-dependent order; sort each index buffer
    (winding kept, smallest index first) so the packed GLBs are byte-identical between builds."""
    import struct
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


def export(s):
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
    suffix = "-hd" if s == "hd" else ""
    rows = []
    dg = bpy.context.evaluated_depsgraph_get()
    for base in ("orrery-study", "orrery-machine", "orrery-planets"):
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
            bm = bmesh.new(); bm.from_mesh(me)
            if ob.name not in ("contact-shadow", "lamp-shade"):
                bad["nonmanifold"] += sum(1 for e in bm.edges if not e.is_manifold)
            bad["degenerate"] += sum(1 for f in bm.faces if f.calc_area() < 1e-12)
            bm.free(); ob.evaluated_get(dg).to_mesh_clear()
        raw = os.path.join(BUILD, f"{base}{suffix}.raw.glb")
        bpy.ops.export_scene.gltf(filepath=raw, export_format="GLB", use_selection=True, export_apply=True,
                                  export_yup=True, export_normals=True, export_texcoords=True,
                                  export_materials="EXPORT", export_image_format="AUTO",
                                  export_cameras=False, export_lights=False, export_extras=False)
        canonical_indices(raw)
        dst = os.path.join(OUT, "assets", f"{base}{suffix}.glb")
        subprocess.run([GLTFPACK, "-i", raw, "-o", dst, "-cc", "-kn", "-km"], check=True)
        data = open(dst, "rb").read()
        rows.append({"id": f"{base}{suffix}", "path": f"assets/{base}{suffix}.glb",
                     "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "triangles": tris,
                     "rawBytes": os.path.getsize(raw), "integrity": bad})
        print(f"orrery {s}: {base}{suffix} tris={tris} bytes={len(data)} integrity={bad}")
    return rows


def write_data(gears):
    def gear(gd, r):
        return {"name": gd["name"], "teeth": gd["teeth"], "radius": round(r, 5),
                "pivot": gl(Vector((gd["xy"][0], gd["xy"][1], gd["z"] + GEAR_T)))}
    data = {
        "desk": {"top": STUDY_TOP, "plinthTop": PLINTH_Z1, "baseTop": round(BASE_Z, 5)},
        "sun": {"centre": gl(Vector((0, 0, SUN_Z))), "radius": SUN_R},
        "column": {"radius": COLUMN_R, "base": gl(Vector((0, 0, BASE_Z)))},
        "gears": [gear(G_CROWN, 0.5 * MOD * 60), gear(G_2, 0.5 * MOD * 36), gear(G_3, 0.5 * MOD * 20),
                  {"name": ESC["name"], "teeth": ESC["teeth"], "radius": ESC["r"],
                   "pivot": gl(Vector((ESC["xy"][0], ESC["xy"][1], ESC["z"] + 0.0025)))}],
        "anchor": {"pivot": gl(Vector((ANCHOR_XY[0], ANCHOR_XY[1], ANCHOR_Z)))},
        "balance": {"pivot": gl(Vector((BAL_XY[0], BAL_XY[1], BAL_Z))), "radius": BAL_R},
        "arms": [{"hub": round(hub_h(k), 5), "radius": round(arm_r(k), 5)} for k in range(N_ARMS)],
        "postHeight": POST_H,
        "lamp": {"head": gl(Vector(LAMP["head"]))},
        "camera": {"target": [0, 0.2, 0], "distance": 1.35, "elevationDeg": 24, "fovDeg": 30},
        "nodes": {"planets": [f"planet-{k}" for k in range(7)], "ring": "planet-6-ring",
                  "arm": ["arm-hub", "arm-bar", "arm-post", "arm-cup"],
                  "gears": ["gear-crown", "gear-2", "gear-3", "escape-wheel", "anchor", "balance"],
                  "sun": "sun"},
    }
    ts = os.path.join(OUT, "frontend", "orrery-data.ts")
    os.makedirs(os.path.dirname(ts), exist_ok=True)
    with open(ts, "w") as f:
        f.write("// Generated by blender/build_orrery.py — do not edit by hand.\n")
        f.write("// Machine layout in glTF Y-up metres (desk top y=0, front = +z).\n")
        f.write("export const ORRERY = " + json.dumps(data, separators=(",", ":")) + " as const;\n")


def render(s):
    sc = bpy.context.scene
    for c in bpy.context.scene.collection.children:
        c.hide_render = not c.name.endswith(f"-{s}")
    world = sc.world or bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    hdr = os.path.join(ROOT, "out", "sources", "orrery", "raw", "polyhaven", "fireplace", "fireplace_1k.hdr")
    if os.path.isfile(hdr) and not any(n.type == "TEX_ENVIRONMENT" for n in nt.nodes):
        env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(hdr)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.5
    if "key" not in bpy.data.objects:
        ld = bpy.data.lights.new("key", "POINT"); ld.energy = 25; ld.color = (1.0, 0.82, 0.6); ld.shadow_soft_size = 0.05
        lo = bpy.data.objects.new("key", ld); lo.location = (LAMP["head"][0], LAMP["head"][1], LAMP["head"][2] - 0.04)
        sc.collection.objects.link(lo)
        cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.angle = math.radians(30)
        co = bpy.data.objects.new("cam", cd); sc.collection.objects.link(co); sc.camera = co
        el = math.radians(24)
        tgt = Vector((0, 0, 0.2))
        co.location = tgt + 1.35 * Vector((0, -math.cos(el), math.sin(el)))
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


def sync_manifest(sets):
    """Rewrite plugin.yml's assets block (standard ids first, then -hd) from the packed files."""
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
    meta = {"sets": {}, "gltfpack": subprocess.run([GLTFPACK, "-v"], capture_output=True, text=True).stdout.strip()
            or "gltfpack", "blender": bpy.app.version_string}
    gears = None
    probe_tubes()
    for s in SETS:
        _, gears = build(s)
        meta["sets"][s] = export(s)
        if RENDER:
            render(s)
        if s != SETS[-1]:
            clear_set(s)
    write_data(gears)
    meta_path = os.path.join(OUT, "blender", "build_orrery_meta.json")
    old = {}
    if os.path.isfile(meta_path):
        old = json.load(open(meta_path))
    old.setdefault("sets", {}).update(meta["sets"])
    old["gltfpack"], old["blender"] = meta["gltfpack"], meta["blender"]
    with open(meta_path, "w") as f:
        json.dump(old, f, indent=2, sort_keys=True); f.write("\n")
    sync_manifest(old["sets"])
    print("ORRERY_BUILD_DONE")
    sys.stdout.flush()


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    print("ORRERY_BUILD_FAILED")
    sys.stdout.flush()
if QUIT:
    bpy.ops.wm.quit_blender()
