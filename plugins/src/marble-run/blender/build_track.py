"""Marble Run track generator (Blender 5.x).

Run with the GUI visible:
  blender --python plugins/src/marble-run/blender/build_track.py -- --out plugins/src/marble-run

Builds a continuous wood-and-brass marble run (screw lift, spiral, zig-zag switchbacks, a
xylophone run, a vertical loop, a bell and a funnel), exports:
  assets/marble-track.glb      the static track (one glTF, no textures)
  frontend/track-data.ts       the marble centre path the sandbox sim follows (glTF Y-up metres)
and renders blender/marble-track.png as a preview. Deterministic: no randomness.
"""
import bpy, bmesh, math, json, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.getcwd()
RENDER = "--no-render" not in argv
QUIT = "--keep-open" not in argv

for _o in list(bpy.data.objects):
    bpy.data.objects.remove(_o, do_unlink=True)

MR = 0.018      # marble radius (m)
RR = 0.0045     # rail radius
RAIL_ANG = math.radians(42)
STEP = 0.012    # path sample spacing

# Palette: Munsell-style complementary pair. Anchor 7.5YR walnut/brass; accent 7.5B teal arcs.
WALNUT = (0.23, 0.12, 0.06, 1)
MAPLE = (0.62, 0.44, 0.27, 1)
BRASS = (0.83, 0.62, 0.30, 1)
STEEL = (0.78, 0.80, 0.82, 1)
TEAL = (0.18, 0.52, 0.56, 1)
PEG = (0.16, 0.17, 0.19, 1)
XYLO = [(0.86, 0.33, 0.25, 1), (0.90, 0.55, 0.22, 1), (0.88, 0.76, 0.28, 1), (0.52, 0.72, 0.36, 1),
        (0.25, 0.62, 0.60, 1), (0.25, 0.48, 0.78, 1), (0.47, 0.38, 0.75, 1), (0.72, 0.36, 0.62, 1)]

# ---------------------------------------------------------------- path (Blender coords, Z up)
def hermite(p0, t0, p1, t1, n):
    out = []
    for i in range(1, n + 1):
        s = i / n
        h00 = 2*s**3 - 3*s**2 + 1; h10 = s**3 - 2*s**2 + s; h01 = -2*s**3 + 3*s**2; h11 = s**3 - s**2
        out.append(p0*h00 + t0*h10 + p1*h01 + t1*h11)
    return out

class Path:
    def __init__(self):
        self.pts = []; self.tags = []; self.down = []
    def add(self, pts, tag, down=None):
        for i, p in enumerate(pts):
            self.pts.append(Vector(p)); self.tags.append(tag)
            self.down.append(None if down is None else Vector(down(i, p)))
    def end(self):
        p = self.pts[-1]; t = (self.pts[-1] - self.pts[-2]).normalized()
        return p, t
    def connect(self, p1, t1, tag="chute", k=0.9):
        p0, t0 = self.end()
        d = (p1 - p0).length
        n = max(4, int(d / 0.02))
        self.add(hermite(p0, t0 * d * k, p1, t1 * d * k, n), tag)

def helix(c, r, z0, z1, a0, turns, n_per_turn, cw=False):
    n = max(8, int(turns * n_per_turn)); out = []
    for i in range(n + 1):
        s = i / n; a = a0 + (-1 if cw else 1) * s * turns * 2 * math.pi
        out.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), z0 + (z1 - z0) * s))
    return out

def helix_tan(c, r, a, dz_per_rad, cw=False):
    sgn = -1 if cw else 1
    return Vector((-r * math.sin(a) * sgn, r * math.cos(a) * sgn, dz_per_rad)).normalized()

P = Path()
LIFT_C = (1.35, 0.0); LIFT_R = 0.075; LIFT_Z0 = 0.075; LIFT_Z1 = 1.62; LIFT_TURNS = 9
# 1. screw lift (constant speed, sim tag "lift")
P.add(helix(LIFT_C, LIFT_R, LIFT_Z0, LIFT_Z1, math.pi, LIFT_TURNS, 90), "lift")
# 2. spiral tower
SP_C = (0.52, 0.05); SP_R = 0.30; SP_Z0 = 1.46; SP_Z1 = 1.02; SP_T = 2.25
a0 = 0.0
p_sp0 = Vector((SP_C[0] + SP_R, SP_C[1], SP_Z0))
dzr = (SP_Z1 - SP_Z0) / (SP_T * 2 * math.pi)
P.connect(p_sp0, helix_tan(SP_C, SP_R, a0, dzr * 1.0 / SP_R * SP_R), "chute")
P.pts.pop(); P.tags.pop(); P.down.pop()
def spiral_down(i, p):
    c = Vector((SP_C[0], SP_C[1], p[2])); inward = (c - Vector(p)).normalized()
    return (Vector((0, 0, -1)) * 0.92 - inward * 0.38).normalized()
P.add(helix(SP_C, SP_R, SP_Z0, SP_Z1, a0, SP_T, 120), "spiral", spiral_down)
# 3. zig-zag switchbacks: leg 1 (front), U-turn, leg 2 (back), U-turn, leg 3 = xylophone (front)
YF, YB = -0.06, 0.18
def leg(x0, x1, y, z0, z1, tag):
    n = int(abs(x1 - x0) / STEP); P.add([(x0 + (x1 - x0) * i / n, y, z0 + (z1 - z0) * i / n) for i in range(1, n + 1)], tag)
def uturn(cx, y0, y1, z0, z1, left, tag="turn"):
    r = abs(y1 - y0) / 2; cy = (y0 + y1) / 2; n = 40; out = []
    for i in range(1, n + 1):
        s = i / n; a = math.pi * s
        x = cx + (-1 if left else 1) * r * math.sin(a)
        y = cy - (r if y1 > y0 else -r) * math.cos(a)
        out.append((x, y, z0 + (z1 - z0) * s))
    def bank(i, p):
        c = Vector((cx, cy, p[2])); inward = (c - Vector(p)).normalized()
        return (Vector((0, 0, -1)) * 0.9 - inward * 0.42).normalized()
    P.add(out, tag, bank)
P.connect(Vector((0.08, YF, 0.97)), Vector((-1, 0, -0.06)).normalized())
leg(0.08, -1.18, YF, 0.97, 0.88, "zigzag")
uturn(-1.18, YF, YB, 0.88, 0.85, True)
leg(-1.18, 0.30, YB, 0.85, 0.74, "zigzag")
uturn(0.30, YB, YF, 0.74, 0.71, False)
XY_X0, XY_X1, XY_Z0, XY_Z1 = 0.30, -0.95, 0.71, 0.62
leg(XY_X0, XY_X1, YF, XY_Z0, XY_Z1, "xylo")
# 4. U-turn to the back plane, steep drop, vertical loop
YL = 0.36
uturn(-0.95, YF, YL, 0.62, 0.58, True)
LOOP_C = (-0.42, 0.50); LOOP_R = 0.13; LOOP_Y0 = YL; LOOP_DY = 0.08
P.connect(Vector((LOOP_C[0], LOOP_Y0, LOOP_C[1] - LOOP_R)), Vector((1, 0, 0)), "drop", k=0.7)
P.pts[-1] = P.pts[-1]  # keep
n = 140; loop = []
for i in range(1, n + 1):
    s = i / n; a = -math.pi / 2 + s * 2 * math.pi
    loop.append((LOOP_C[0] + LOOP_R * math.cos(a), LOOP_Y0 + LOOP_DY * (s * s * (3 - 2 * s)), LOOP_C[1] + LOOP_R * math.sin(a)))
def loop_down(i, p):
    c = Vector((LOOP_C[0], p[1], LOOP_C[1])); return (Vector(p) - c).normalized()
P.add(loop, "loop", loop_down)
# 5. bell strike, then the funnel (tangential entry, spirals in and drops through)
FN_C = (0.62, 0.36); FN_R0 = 0.25; FN_R1 = 0.045; FN_Z0 = 0.40; FN_Z1 = 0.24; FN_T = 2.5
fa0 = math.pi * 1.0
p_fn0 = Vector((FN_C[0] + FN_R0 * math.cos(fa0), FN_C[1] + FN_R0 * math.sin(fa0), FN_Z0))
P.connect(Vector((-0.05, LOOP_Y0 + LOOP_DY, 0.43)), Vector((1, 0, 0.05)).normalized(), "chute")
BELL_AT = len(P.pts) - 1
P.connect(p_fn0, Vector((0, -1, -0.02)).normalized(), "bell")
fn = []; N = 260
for i in range(1, N + 1):
    s = i / N; a = fa0 - s * FN_T * 2 * math.pi  # clockwise from above (entering heading -y at a=pi)
    r = FN_R0 + (FN_R1 - FN_R0) * (s ** 0.8)
    z = FN_Z0 + (FN_Z1 - FN_Z0) * (s ** 1.3)
    fn.append((FN_C[0] + r * math.cos(a), FN_C[1] + r * math.sin(a), z))
def funnel_down(i, p):
    c = Vector((FN_C[0], FN_C[1], p[2])); inward = (c - Vector(p)).normalized()
    return (Vector((0, 0, -1)) * 0.6 - inward * 0.8).normalized()
P.add(fn, "funnel", funnel_down)
# drop through the throat, then the return chute into the bottom of the lift
p_end, _ = P.end()
P.add([(p_end[0], p_end[1], p_end[2] - 0.012 * i) for i in range(1, 7)], "drop")
lift_a = math.pi
p_l0 = Vector((LIFT_C[0] + LIFT_R * math.cos(lift_a), LIFT_C[1] + LIFT_R * math.sin(lift_a), LIFT_Z0))
P.connect(p_l0, helix_tan(LIFT_C, LIFT_R, lift_a, 0.0), "chute", k=0.8)
P.pts.pop(); P.tags.pop(); P.down.pop()  # the lift's first sample closes the loop

# resample to uniform spacing
def resample(pts, tags, downs, step):
    out, ot, od = [pts[0]], [tags[0]], [downs[0]]
    acc = 0.0; i = 1; prev = pts[0]
    while i < len(pts):
        seg = pts[i] - prev; L = seg.length
        if acc + L >= step:
            f = (step - acc) / L; q = prev + seg * f
            out.append(q); ot.append(tags[i]); od.append(downs[i]); prev = q; acc = 0.0
        else:
            acc += L; prev = pts[i]; i += 1
    return out, ot, od
PTS, TAGS, DOWNS = resample(P.pts, P.tags, P.down, STEP)
NPT = len(PTS)

def frames():
    F = []
    for i in range(NPT):
        t = (PTS[(i + 1) % NPT] - PTS[i - 1]).normalized()
        d = DOWNS[i] if DOWNS[i] is not None else Vector((0, 0, -1))
        d = (d - t * d.dot(t)).normalized()
        b = t.cross(d).normalized()
        F.append((t, d, b))
    return F
FR = frames()

# ---------------------------------------------------------------- geometry
def mat(name, rgba, metal=0.0, rough=0.5, alpha=1.0, emit=None, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value = coat
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
    if emit:
        b.inputs["Emission Color"].default_value = emit[0]; b.inputs["Emission Strength"].default_value = emit[1]
    return m

def new_obj(name, bm, material):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material)
    bpy.context.collection.objects.link(ob); return ob

def sweep(bm, centers, normals_b, normals_d, radius, sides, closed=False):
    rings = []
    for c, b, d in zip(centers, normals_b, normals_d):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(bm.verts.new(c + (b * math.cos(a) + d * math.sin(a)) * radius))
        rings.append(ring)
    n = len(rings)
    for i in range(n - 1 + (1 if closed else 0)):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))

def runs(pred):
    """Contiguous index runs where pred(i) holds."""
    out, cur = [], []
    for i in range(NPT):
        if pred(i): cur.append(i)
        elif cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return out

M_WAL = mat("walnut", WALNUT, rough=0.55, coat=0.3)
M_MAP = mat("maple", MAPLE, rough=0.5)
M_BRASS = mat("brass", BRASS, metal=1.0, rough=0.28)
M_STEEL = mat("steel", STEEL, metal=1.0, rough=0.22)
M_TEAL = mat("acrylic-teal", TEAL, rough=0.12, alpha=0.55)
M_PEG = mat("pegboard", PEG, rough=0.8)
M_XY = [mat(f"xylo-{i}", c, rough=0.35, coat=0.6) for i, c in enumerate(XYLO)]

# rails (everything except the lift, which is a screw)
bm = bmesh.new()
for run in runs(lambda i: TAGS[i] != "lift"):
    for side in (-1, 1):
        cs, bs, ds = [], [], []
        for i in run:
            t, d, b = FR[i]
            off = (d * math.cos(RAIL_ANG) + b * side * math.sin(RAIL_ANG)) * (MR + RR)
            c = PTS[i] + off
            nb = b; nd = t.cross(b)
            cs.append(c); bs.append(nb); ds.append(nd)
        sweep(bm, cs, bs, ds, RR, 6)
new_obj("rails", bm, M_STEEL)

# rail ties every ~9 cm (small brass saddles under the rails)
bm = bmesh.new()
for i in range(0, NPT, 8):
    if TAGS[i] in ("lift", "funnel"): continue
    t, d, b = FR[i]
    c = PTS[i] + d * (MR + RR * 2.2)
    m = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    for v in m:
        lv = Vector(v.co); v.co = c + b * lv.x * 0.062 + t * lv.y * 0.008 + d * lv.z * 0.006
new_obj("ties", bm, M_BRASS)

# screw lift: steel rod, brass thread under the marble path, teal acrylic tube
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.022, radius2=0.022, depth=LIFT_Z1 - LIFT_Z0 + 0.12,
                      matrix=__import__("mathutils").Matrix.Translation((LIFT_C[0], LIFT_C[1], (LIFT_Z0 + LIFT_Z1) / 2)))
new_obj("lift-rod", bm, M_STEEL)
bm = bmesh.new()
lift_idx = [i for i in range(NPT) if TAGS[i] == "lift"]
rows = []
for i in lift_idx:
    p = PTS[i]; c = Vector((LIFT_C[0], LIFT_C[1], p[2] - MR - 0.004)); out = (Vector((p[0], p[1], 0)) - Vector((LIFT_C[0], LIFT_C[1], 0))).normalized()
    rows.append([bm.verts.new(c + out * 0.02), bm.verts.new(c + out * (LIFT_R + MR + 0.004)),
                 bm.verts.new(c + out * (LIFT_R + MR + 0.004) + Vector((0, 0, 0.008))), bm.verts.new(c + out * 0.02 + Vector((0, 0, 0.008)))])
for a, b2 in zip(rows, rows[1:]):
    for k in range(4):
        bm.faces.new((a[k], a[(k + 1) % 4], b2[(k + 1) % 4], b2[k]))
new_obj("lift-thread", bm, M_BRASS)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=LIFT_R + MR + 0.012, radius2=LIFT_R + MR + 0.012,
                      depth=LIFT_Z1 - LIFT_Z0 + 0.06, matrix=__import__("mathutils").Matrix.Translation((LIFT_C[0], LIFT_C[1], (LIFT_Z0 + LIFT_Z1) / 2)))
new_obj("lift-tube", bm, M_TEAL)

# funnel bowl: a surface of revolution under the spiral path
from mathutils import Matrix
bm = bmesh.new(); segs = 40; prof = []
for k in range(13):
    s = k / 12; r = FN_R1 + 0.01 + (FN_R0 + MR * 2 - FN_R1) * s
    z = FN_Z1 - MR - 0.006 + (FN_Z0 - FN_Z1 + 0.02) * (s ** 1.6)
    prof.append((r, z))
ring = [[bm.verts.new((FN_C[0] + r * math.cos(2 * math.pi * j / segs), FN_C[1] + r * math.sin(2 * math.pi * j / segs), z)) for j in range(segs)] for r, z in prof]
for a, b2 in zip(ring, ring[1:]):
    for j in range(segs):
        bm.faces.new((a[j], a[(j + 1) % segs], b2[(j + 1) % segs], b2[j]))
new_obj("funnel", bm, M_TEAL)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=40, radius1=FN_R0 + MR * 2 + 0.012, radius2=FN_R0 + MR * 2 + 0.012, depth=0.016,
                      matrix=Matrix.Translation((FN_C[0], FN_C[1], FN_Z0 + 0.02)))
new_obj("funnel-rim", bm, M_BRASS)

# xylophone bars under the xylo leg
XYLO_S = []
xs = [i for i in range(NPT) if TAGS[i] == "xylo"]
for k in range(8):
    i = xs[int((k + 0.5) / 8 * len(xs))]
    t, d, b = FR[i]; c = PTS[i] + d * (MR + 0.004)
    bm = bmesh.new()
    for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]:
        lv = Vector(v.co); v.co = c + b * lv.x * (0.12 - k * 0.008) + t * lv.y * 0.05 + d * lv.z * 0.012
    new_obj(f"xylo-bar-{k}", bm, M_XY[k])
    XYLO_S.append(i)

# bell: brass bell on a maple arm over the bell chute
bi = [i for i in range(NPT) if TAGS[i] == "bell"]
BELL_I = bi[len(bi) // 2]
bp = PTS[BELL_I]; bt, bd, bb = FR[BELL_I]
bell_c = bp + bb * 0.045 - bd * 0.02
bm = bmesh.new(); prof = [(0.004, 0.05), (0.018, 0.045), (0.024, 0.03), (0.028, 0.012), (0.036, 0.0), (0.038, -0.004)]
ring = [[bm.verts.new(bell_c + Vector((r * math.cos(2 * math.pi * j / 24), r * math.sin(2 * math.pi * j / 24), z))) for j in range(24)] for r, z in prof]
for a, b2 in zip(ring, ring[1:]):
    for j in range(24): bm.faces.new((a[j], a[(j + 1) % 24], b2[(j + 1) % 24], b2[j]))
new_obj("bell", bm, M_BRASS)

# supports: maple posts from the base to the track, skipped where another run passes below
bm = bmesh.new()
def clear_below(p):
    for q in PTS:
        if q[2] < p[2] - 0.06 and abs(q[0] - p[0]) < 0.05 and abs(q[1] - p[1]) < 0.05: return False
    return True
for i in range(0, NPT, 38):
    if TAGS[i] in ("lift", "loop", "funnel", "drop"): continue
    p = PTS[i]; top = p[2] - MR - 0.012
    if top < 0.05 or not clear_below(p): continue
    for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]:
        lv = Vector(v.co); v.co = Vector((p[0] + lv.x * 0.014, p[1] + lv.y * 0.014, (top / 2) + lv.z * top))
new_obj("posts", bm, M_MAP)
# loop + funnel stands
bm = bmesh.new()
for x, y, h in ((LOOP_C[0], LOOP_Y0 + LOOP_DY / 2 + 0.05, LOOP_C[1] + LOOP_R), (FN_C[0], FN_C[1], FN_Z1 - 0.03)):
    for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]:
        lv = Vector(v.co); v.co = Vector((x + lv.x * 0.02, y + lv.y * 0.02, h / 2 + lv.z * h))
new_obj("stands", bm, M_MAP)

# base board and pegboard back
bm = bmesh.new()
for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]:
    lv = Vector(v.co); v.co = Vector((0.1 + lv.x * 3.3, 0.2 + lv.y * 1.0, -0.025 + lv.z * 0.05))
new_obj("base", bm, M_WAL)
bm = bmesh.new()
for v in bmesh.ops.create_cube(bm, size=1.0)["verts"]:
    lv = Vector(v.co); v.co = Vector((0.1 + lv.x * 3.3, 0.72 + lv.y * 0.02, 0.95 + lv.z * 1.9))
new_obj("pegboard", bm, M_PEG)

# ---------------------------------------------------------------- export
os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
glb = os.path.join(OUT, "assets", "marble-track.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_apply=True,
                          export_yup=True, export_normals=True, export_texcoords=False, export_materials="EXPORT",
                          export_cameras=False, export_lights=False)

def gl(v):  # Blender Z-up -> glTF Y-up
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]
TAGIDS = {"chute": 0, "spiral": 1, "zigzag": 2, "turn": 3, "xylo": 4, "drop": 5, "loop": 6, "bell": 7, "funnel": 8, "lift": 9}
flat = []
for p in PTS: flat += gl(p)
tags = [TAGIDS[t] for t in TAGS]
data = {
    "step": STEP, "marbleRadius": MR, "points": flat, "tags": tags,
    "xylo": XYLO_S, "bell": BELL_I,
    "bounds": [gl(Vector((-1.6, -0.3, 0))), gl(Vector((1.8, 0.72, 1.9)))],
}
ts = os.path.join(OUT, "frontend", "track-data.ts")
with open(ts, "w") as f:
    f.write("// Generated by blender/build_track.py — do not edit by hand.\n")
    f.write("// Marble centre path (glTF Y-up metres), one sample every `step` m, closed loop.\n")
    f.write("export const TRACK_TAGS = " + json.dumps(list(TAGIDS.keys())) + " as const;\n")
    f.write("export const TRACK = " + json.dumps(data, separators=(",", ":")) + ";\n")
print(f"marble-track: {NPT} samples, length {NPT * STEP:.2f} m -> {glb}")

# ---------------------------------------------------------------- preview render
if RENDER:
    sc = bpy.context.scene
    world = sc.world or bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    for k, (loc, e) in enumerate((((-1.5, -2.5, 3.2), 260), ((2.5, -2.0, 2.0), 120), ((0.2, 0.3, 3.0), 90))):
        ld = bpy.data.lights.new(f"l{k}", "AREA"); ld.energy = e; ld.size = 1.5
        lo = bpy.data.objects.new(f"l{k}", ld); lo.location = loc; sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0.1, 0.2, 0.8)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    gm = [mat(f"glass{k}", XYLO[k], rough=0.03, coat=1.0) for k in range(8)]
    for k in range(0, NPT, NPT // 26):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=MR, location=PTS[k], segments=24, ring_count=12)
        o = bpy.context.active_object; o.data.materials.append(gm[k % 8])
        bpy.ops.object.shade_smooth()
    cd = bpy.data.cameras.new("cam"); cd.lens = 40
    co = bpy.data.objects.new("cam", cd); sc.collection.objects.link(co); sc.camera = co
    co.location = (0.25, -4.1, 1.55)
    co.rotation_euler = (Vector((0.1, 0.2, 0.82)) - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = 1600; sc.render.resolution_y = 900
    sc.render.filepath = os.path.join(OUT, "blender", "marble-track.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", sc.render.filepath)

if QUIT:
    bpy.ops.wm.quit_blender()
