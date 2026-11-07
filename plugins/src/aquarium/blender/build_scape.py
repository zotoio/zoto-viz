"""Aquarium aquascape + fish generator (Blender 5.x).

Run with the GUI visible:
  blender --python plugins/src/aquarium/blender/build_scape.py -- --out plugins/src/aquarium

Builds, in tank units (glTF Y-up; inner glass x +-1.2, floor y -0.805, back z -1.0):
  substrate      sand bed with darker grit patches (vertex colour)
  fresh-*        freshwater scape: seiryu stones, a driftwood branch with java fern, vallisneria
                 along the back, rotala stem clumps and moss mounds
  reef-*         reef scape: live-rock arch, staghorn and brain coral, sea fans, a sand anemone
  fish-<name>    one swim template per species, nose +Z, tail -Z, centred, built to its swim
                 size (the host instances them and bends them with a travelling wave)
Exports assets/aquarium-scape.glb (vertex colours, no textures) and renders
blender/aquarium-scape.png. Deterministic: noise is seeded.

Pass `--gltfpack <path-to-gltfpack>` (npm i gltfpack@0.24) to meshopt-compress the GLB in place
(-cc -kn -km -noq: named nodes, materials and float positions are kept; the host lane decodes
EXT_meshopt_compression). The shipped asset is packed.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.getcwd()
RENDER = "--no-render" not in argv
HEADS = os.path.abspath(argv[argv.index("--heads") + 1]) if "--heads" in argv else None
GLTFPACK = argv[argv.index("--gltfpack") + 1] if "--gltfpack" in argv else None
QUIT = "--keep-open" not in argv

for _o in list(bpy.data.objects):
    bpy.data.objects.remove(_o, do_unlink=True)
noise.seed_set(4242)

FLOOR = -0.805
HX, BACK, FRONT = 1.2, -1.0, 1.0

def G(x, y, z):
    """glTF (x, y up, z toward viewer) -> Blender (x, y back, z up)."""
    return Vector((x, -z, y))

def lerp(a, b, t): return a + (b - a) * t
def mix3(a, b, t): return tuple(lerp(a[i], b[i], t) for i in range(3))
def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)

# ------------------------------------------------------------------ materials (vertex colour)
def vcmat(name, rough=0.6, sheen=0.0, coat=0.0, emit=0.0, double=True, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    a = nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = "Col"
    nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value = coat
    if emit > 0:
        nt.links.new(a.outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = emit
    m.use_backface_culling = not double
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
    return m

M_SAND = vcmat("sand", rough=0.95, double=False)
M_ROCK = vcmat("rock", rough=0.85, double=False)
M_WOOD = vcmat("wood", rough=0.8, double=False)
M_PLANT = vcmat("plant", rough=0.55)
M_CORAL = vcmat("coral", rough=0.7)
M_FISH = vcmat("fish", rough=0.35, coat=0.6, double=False)
M_FIN = vcmat("fin", rough=0.4, alpha=0.78)
M_EYE = vcmat("eye", rough=0.1, coat=1.0, double=False)

class Builder:
    """bmesh + per-vertex colour, flushed into one object."""
    def __init__(self): self.bm = bmesh.new(); self.col = {}
    def v(self, p, c):
        vv = self.bm.verts.new(p); self.col[vv] = c; return vv
    def f(self, *vs):
        try: return self.bm.faces.new(vs)
        except ValueError: return None
    def obj(self, name, material, smooth_shade=True, closed=False):
        bm = self.bm
        if closed:
            # a closed solid: weld seams, face every normal outward, then prove it is watertight
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            REPORT.append(validate_closed(name, bm))
        bm.verts.index_update()
        me = bpy.data.meshes.new(name)
        cols = [self.col[v] for v in bm.verts]
        bm.to_mesh(me); bm.free()
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for i, c in enumerate(cols): ca.data[i].color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1.0)  # authored sRGB -> linear
        for p in me.polygons: p.use_smooth = smooth_shade
        ob = bpy.data.objects.new(name, me); ob.data.materials.append(material)
        bpy.context.collection.objects.link(ob); return ob

REPORT = []

def validate_closed(name, bm):
    """Non-manifold / boundary edges, zero-area faces and inward normals of a closed mesh."""
    bm.normal_update()
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
    # signed volume of fan-triangulated faces; positive = normals point out
    vol = 0.0
    for f in bm.faces:
        v = [x.co for x in f.verts]
        for i in range(1, len(v) - 1):
            vol += v[0].dot(v[i].cross(v[i + 1])) / 6.0
    ok = boundary == 0 and nonman == 0 and zero == 0 and vol > 0
    return {"name": name, "faces": len(bm.faces), "boundary": boundary, "non_manifold": nonman,
            "zero_area": zero, "volume": vol, "outward": vol > 0, "ok": ok}

def grid_sheet(B, f, nu, nv, colf, flip=False):
    """Quad sheet: f(u, v) -> Vector; colf(u, v) -> rgb."""
    rows = [[B.v(f(i / nu, j / nv), colf(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            q = (rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])
            B.f(*(q[::-1] if flip else q))
    return rows

def tube(B, pts, radii, sides, colf):
    """Swept tube along Blender-space points."""
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        t = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        b1 = t.cross(a).normalized(); b2 = t.cross(b1)
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            ring.append(B.v(p + (b1 * math.cos(ang) + b2 * math.sin(ang)) * radii[i], colf(i / (n - 1), k / sides)))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(sides):
            B.f(rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k])
    tip = B.v(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.6, colf(1.0, 0))
    for k in range(sides): B.f(rings[-1][k], rings[-1][(k + 1) % sides], tip)

# ------------------------------------------------------------------ substrate
def sand_h(x, z):
    h = 0.03 + 0.05 * smooth(0.4, -1.0, z)                      # slopes up toward the back
    h += 0.012 * noise.noise(Vector((x * 2.2, z * 2.2, 0.3)))
    h += 0.004 * noise.noise(Vector((x * 9.0, z * 9.0, 1.7)))
    return FLOOR + h

B = Builder()
SAND = (0.78, 0.68, 0.52); GRIT = (0.42, 0.37, 0.31)
def sand_col(u, v):
    x = lerp(-HX, HX, u); z = lerp(BACK, FRONT, v)
    k = 0.5 + 0.5 * noise.noise(Vector((x * 3.1, z * 3.1, 4.2)))
    return mix3(SAND, GRIT, smooth(0.55, 0.85, k) * 0.7)
grid_sheet(B, lambda u, v: G(lerp(-HX, HX, u), sand_h(lerp(-HX, HX, u), lerp(BACK, FRONT, v)), lerp(BACK, FRONT, v)),
           72, 60, sand_col, flip=True)
B.obj("substrate", M_SAND)

# ------------------------------------------------------------------ rocks
def rock(B, cx, cz, rx, ry, rz, seed, base, vein):
    bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=3, radius=1.0)
    idx = {}
    for v in bm2.verts:
        d = v.co.normalized()
        n1 = noise.noise(d * 1.6 + Vector((seed, 0, 0)))
        n2 = noise.noise(d * 4.5 + Vector((0, seed, 0)))
        r = 1.0 + 0.28 * n1 + 0.08 * n2
        p = Vector((d.x * rx * r, d.y * ry * r, d.z * rz * r))
        if d.y < -0.2: p.y *= 0.5                                  # flat bottom set into the sand
        stripe = 0.5 + 0.5 * math.sin((d.x * 6 + d.y * 9 + n2 * 4))
        c = mix3(base, vein, smooth(0.8, 0.95, stripe))
        c = mix3(c, (c[0] * 0.6, c[1] * 0.6, c[2] * 0.6), smooth(0.3, -0.5, d.y))
        y = sand_h(cx, cz) - 0.01 + p.y + ry * 0.35
        idx[v] = B.v(G(cx + p.x, y, cz + p.z), c)
    for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
    bm2.free()

SEIRYU = (0.36, 0.39, 0.40); VEIN = (0.72, 0.74, 0.72)
LIVE = (0.55, 0.40, 0.42); LIVE_V = (0.62, 0.30, 0.48)
B = Builder()
rock(B, -0.55, 0.05, 0.20, 0.10, 0.15, 1.3, SEIRYU, VEIN)         # territory rock (fish-behaviour TERRITORY_SPOTS)
rock(B, -0.95, -0.72, 0.22, 0.26, 0.18, 2.9, SEIRYU, VEIN)
rock(B, 0.95, -0.70, 0.18, 0.20, 0.16, 5.1, SEIRYU, VEIN)
rock(B, 0.38, 0.40, 0.08, 0.04, 0.07, 7.7, SEIRYU, VEIN)
B.obj("fresh-rocks", M_ROCK)

B = Builder()
rock(B, -0.55, 0.05, 0.20, 0.10, 0.15, 3.3, LIVE, LIVE_V)
rock(B, -0.85, -0.72, 0.30, 0.34, 0.20, 4.4, LIVE, LIVE_V)
rock(B, 0.85, -0.72, 0.30, 0.30, 0.20, 6.6, LIVE, LIVE_V)
B.obj("reef-rocks", M_ROCK)

# ------------------------------------------------------------------ driftwood + java fern
B = Builder()
BARK = (0.30, 0.20, 0.13); HEART = (0.52, 0.38, 0.25)
def wood_col(t, k): return mix3(BARK, HEART, 0.5 + 0.5 * math.sin(k * 12.6 + t * 30))
def branch(B, p0, p1, bend, r0, r1, n=14):
    pts = []
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t) + bend * math.sin(math.pi * t)
        p += Vector((noise.noise(p * 7) * 0.012, noise.noise(p * 7 + Vector((3, 0, 0))) * 0.012, 0))
        pts.append(p)
    tube(B, pts, [lerp(r0, r1, i / n) for i in range(n + 1)], 8, wood_col)
    return pts
trunk = branch(B, G(-0.35, FLOOR + 0.05, -0.35), G(0.55, -0.32, -0.85), G(0, 0.18, 0), 0.045, 0.014)
branch(B, trunk[5], G(0.15, -0.12, -0.55), G(0, 0.05, 0.05), 0.022, 0.006, 10)
branch(B, trunk[9], G(0.85, -0.45, -0.55), G(0, 0.07, 0), 0.018, 0.005, 10)
branch(B, G(-0.35, FLOOR + 0.05, -0.35), G(-0.75, -0.62, 0.0), G(0, 0.04, 0), 0.03, 0.01, 10)
B.obj("fresh-driftwood", M_WOOD)

def leaf(B, base, direc, up, length, width, col_a, col_b, curl=0.25, n=6):
    side = direc.cross(up).normalized()
    def f(u, v):
        w = width * math.sin(math.pi * min(1, u * 1.1)) * (v - 0.5) * 2
        return base + direc * (length * u) + up * (curl * length * u * u) + side * w
    grid_sheet(B, f, n, 2, lambda u, v: mix3(col_a, col_b, u * 0.8 + abs(v - 0.5) * 0.3))

B = Builder()
FERN_A = (0.10, 0.28, 0.10); FERN_B = (0.22, 0.48, 0.16)
for i, p in enumerate(trunk[3:12:2]):
    for k in range(5):
        a = k * 1.26 + i * 0.7
        d = Vector((math.cos(a), math.sin(a), 0.9)).normalized()
        leaf(B, p, d, Vector((0, 0, 1)), 0.13 + 0.03 * (k % 2), 0.022, FERN_A, FERN_B, 0.2)
B.obj("fresh-plant-fern", M_PLANT)

# ------------------------------------------------------------------ vallisneria + rotala + moss
B = Builder()
VAL_A = (0.12, 0.32, 0.10); VAL_B = (0.42, 0.62, 0.22)
for i in range(46):
    x = lerp(-1.12, 1.12, (i + 0.5 * noise.noise(Vector((i, 0.2, 0)))) / 45)
    z = -0.93 + 0.05 * noise.noise(Vector((i * 1.7, 4, 0)))
    if abs(x - 0.55) < 0.12: continue
    h = 0.75 + 0.55 * (0.5 + 0.5 * noise.noise(Vector((i * 0.37, 9, 0))))
    lean = 0.12 * noise.noise(Vector((i * 0.9, 2, 0)))
    y0 = sand_h(x, z)
    def f(u, v, x=x, z=z, h=h, lean=lean, y0=y0, i=i):
        w = 0.011 * (1 - u * 0.6) * (v - 0.5) * 2
        tw = u * 2.5 + i
        return G(x + w * math.cos(tw) + lean * u * u, y0 + h * u, z + 0.12 * u * u + w * math.sin(tw))
    grid_sheet(B, f, 10, 1, lambda u, v: mix3(VAL_A, VAL_B, u))
B.obj("fresh-plant-vallisneria", M_PLANT)

PLANT_SPOTS = [(-0.45, -0.25), (0.15, -0.3), (0.45, 0.05), (-0.6, -0.55), (0.65, -0.55)]
ROT_A = (0.32, 0.45, 0.12); ROT_B = (0.78, 0.38, 0.22)
B = Builder()
for si, (px, pz) in enumerate(PLANT_SPOTS):
    stems = 7 if si != 2 else 4
    for s in range(stems):
        a = s * 2.4 + si
        r = 0.03 + 0.05 * ((s * 7) % 5) / 5
        x0, z0 = px + r * math.cos(a), pz + r * math.sin(a)
        h = (0.3 + 0.25 * ((s * 3 + si) % 4) / 4) * (0.55 if si == 2 else 1.0)
        y0 = sand_h(x0, z0)
        lean = Vector((math.cos(a), math.sin(a), 0)) * 0.05
        pts = [G(x0, y0 + h * t, z0) + lean * t * t for t in [i / 8 for i in range(9)]]
        tube(B, pts, [0.004] * 9, 4, lambda t, k: (0.25, 0.35, 0.12))
        for w in range(2, 9):
            c = pts[w]; t = w / 8
            col_tip = mix3(ROT_A, ROT_B, smooth(0.4, 1.0, t))         # rotala reddens toward the light
            for k in range(4):
                aa = k * math.pi / 2 + w * 0.6
                d = Vector((math.cos(aa), math.sin(aa), 0.5)).normalized()
                leaf(B, c, d, Vector((0, 0, 1)), 0.038, 0.009, mix3(ROT_A, col_tip, 0.5), col_tip, 0.1, 3)
B.obj("fresh-plant-rotala", M_PLANT)

B = Builder()
MOSS_A = (0.10, 0.26, 0.08); MOSS_B = (0.28, 0.50, 0.14)
for (mx, mz, mr) in ((-0.2, 0.3, 0.11), (0.0, 0.45, 0.08), (0.75, 0.25, 0.12), (-0.95, 0.35, 0.09), (0.3, -0.05, 0.07)):
    bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=2, radius=1.0); idx = {}
    for v in bm2.verts:
        d = v.co.normalized(); r = 1 + 0.25 * noise.noise(d * 5 + Vector((mx, mz, 0)))
        y = sand_h(mx, mz) + max(-0.2, d.z) * mr * 0.4 * r
        idx[v] = B.v(G(mx + d.x * mr * r, y, mz + d.y * mr * r), mix3(MOSS_A, MOSS_B, 0.5 + 0.5 * noise.noise(d * 9)))
    for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
    bm2.free()
B.obj("fresh-plant-moss", M_PLANT)

# ------------------------------------------------------------------ reef: corals, fans, anemone
B = Builder()
STAG_A = (0.62, 0.42, 0.55); STAG_B = (0.92, 0.80, 0.70)
def stag(B, p, d, length, r, depth):
    n = 5; pts = [p + d * (length * i / n) for i in range(n + 1)]
    tube(B, pts, [lerp(r, r * 0.7, i / n) for i in range(n + 1)], 6,
         lambda t, k, depth=depth: mix3(STAG_A, STAG_B, smooth(0.0, 1.0, (3 - depth + t) / 3)))
    if depth > 0:
        for k in range(2 if depth < 2 else 3):
            a = k * 2.1 + depth + p.x * 9
            nd = (d + Vector((math.cos(a) * 0.7, math.sin(a) * 0.7, 0.1))).normalized()
            stag(B, pts[-1], nd, length * 0.72, r * 0.7, depth - 1)
for (cx, cz) in ((-0.45, -0.25), (0.65, -0.55)):
    stag(B, G(cx, sand_h(cx, cz), cz), Vector((0, 0, 1)), 0.11, 0.016, 3)
B.obj("reef-coral-staghorn", M_CORAL)

B = Builder()
BRAIN_A = (0.55, 0.55, 0.25); BRAIN_B = (0.30, 0.42, 0.20)
for (cx, cz, cr) in ((0.15, -0.3, 0.14), (0.45, 0.05, 0.09)):
    bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=4, radius=1.0); idx = {}
    for v in bm2.verts:
        d = v.co.normalized()
        ridge = abs(math.sin(14 * d.x + 6 * noise.noise(d * 2.0)) * math.sin(14 * d.y + 6 * noise.noise(d * 2.3 + Vector((4, 0, 0)))))
        r = cr * (1 + 0.05 * ridge)
        z = max(-0.15, d.z)
        idx[v] = B.v(G(cx + d.x * r, sand_h(cx, cz) + z * r * 0.7 + 0.01, cz + d.y * r), mix3(BRAIN_B, BRAIN_A, ridge))
    for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
    bm2.free()
B.obj("reef-coral-brain", M_CORAL)

B = Builder()
FAN_A = (0.68, 0.18, 0.30); FAN_B = (0.92, 0.42, 0.40)
for (cx, cz, a, h) in ((-0.6, -0.55, 0.3, 0.42), (0.2, -0.8, -0.2, 0.55), (-0.1, -0.85, 0.6, 0.36)):
    y0 = sand_h(cx, cz); side = Vector((math.cos(a), math.sin(a), 0))
    def f(u, v, cx=cx, cz=cz, y0=y0, h=h, side=side):
        w = (v - 0.5) * 2 * h * 0.55 * math.sin(math.pi * 0.5 * min(1, u * 1.4))
        return G(cx, y0 + h * u, cz) + side * w + Vector((0, 0.02 * math.sin(u * 5 + v * 3), 0))
    grid_sheet(B, f, 9, 9, lambda u, v: mix3(FAN_A, FAN_B, u * 0.7 + 0.3 * abs(math.sin(v * 20))))
B.obj("reef-coral-fan", M_CORAL)

B = Builder()
ANEM_A = (0.70, 0.45, 0.62); ANEM_B = (0.95, 0.85, 0.55)
ax, az = 0.35, 0.25
for k in range(36):
    a = k * 2.39996; r = 0.02 + 0.06 * math.sqrt(k / 36)
    p0 = G(ax + r * math.cos(a), sand_h(ax, az) + 0.04, az + r * math.sin(a))
    d = Vector((math.cos(a) * 0.6, math.sin(a) * 0.6, 1)).normalized()
    pts = [p0 + d * (0.11 * t) + Vector((0, 0, -0.03 * t * t)) for t in [i / 5 for i in range(6)]]
    tube(B, pts, [0.007 * (1 - 0.5 * i / 5) for i in range(6)], 5, lambda t, kk: mix3(ANEM_A, ANEM_B, t))
B.obj("reef-anemone", M_CORAL)

# ------------------------------------------------------------------ fish templates
# Sizes match fish-behaviour MESH_BODY x FISH_MESH_SCALE (2.0): length = 4 x halfLen, fin height = 4 x halfH.
def fish(name, half_len, half_h, body_h, body_w, colf, tail="fork", dorsal=0.3, anal=0.25,
         dorsal_h=0.3, anal_h=0.25, tail_len=0.22, tail_h=0.5, fin_col=None, fin_long=0.0):
    S = 2.0
    L = half_len * 2 * S; Ht = half_h * 2 * S
    lb = L * (1 - tail_len)                       # body length, nose at +L/2
    z_nose = L / 2; z_ped = z_nose - lb
    H = Ht * body_h; W = H * body_w
    B = Builder()
    NU, NV = (28, 18) if half_len > 0.05 else (20, 12)
    rings = []
    for i in range(1, NU + 1):
        u = i / NU
        prof = math.sin(math.pi * min(1.0, 0.08 + u * 0.92) ** 0.75) ** 0.8
        prof = max(prof, 0.16 * smooth(0.7, 1.0, u))
        ry = H / 2 * prof; rx = W / 2 * prof
        yc = -H * 0.04 * math.sin(math.pi * u)
        z = z_nose - lb * u
        ring = []
        for j in range(NV):
            a = 2 * math.pi * j / NV
            sy = math.sin(a)
            c = colf(u * (1 - tail_len), sy, "body")
            if 0.2 < u < 0.235:                                   # gill cover edge
                c = (c[0] * 0.62, c[1] * 0.62, c[2] * 0.62)
            ring.append(B.v(G(rx * math.cos(a), yc + ry * sy, z), c))
        rings.append(ring)
    nose = B.v(G(0, -H * 0.02, z_nose + lb * 0.012), colf(0.0, 0.0, "body"))
    for j in range(NV): B.f(nose, rings[0][j], rings[0][(j + 1) % NV])
    for i in range(NU - 1):
        for j in range(NV):
            B.f(rings[i][j], rings[i][(j + 1) % NV], rings[i + 1][(j + 1) % NV], rings[i + 1][j])
    end = B.v(G(0, 0, z_ped - L * 0.01), colf(1 - tail_len, 0, "body"))
    for j in range(NV): B.f(rings[-1][(j + 1) % NV], rings[-1][j], end)
    body = B.obj(name + "-body", M_FISH, closed=True)
    # fins: flat sheets in the x=0 plane (double sided)
    F = Builder()
    fc = fin_col or (lambda u, v: colf(u, v, "fin"))
    th = Ht / 2 * tail_h
    def tailf(u, v):
        z = z_ped - (L * tail_len + fin_long) * u
        if tail == "fork":
            spread = th * (0.25 + 0.75 * u) * (v - 0.5) * 2
            z += (L * tail_len * 0.45) * u * (1 - abs(v - 0.5) * 2)       # notch
        elif tail == "fan":
            spread = th * (0.3 + 0.9 * u) * (v - 0.5) * 2
        else:
            spread = th * (0.2 + 0.6 * math.sin(math.pi * 0.5 * u)) * (v - 0.5) * 2
        return G(0, spread, z)
    grid_sheet(F, tailf, 5, 4, lambda u, v: fc(1 - tail_len + tail_len * u, (v - 0.5) * 2))
    if dorsal > 0:
        z0 = z_nose - lb * 0.3; z1 = z0 - lb * dorsal - fin_long * 0.6
        def df(u, v):
            z = lerp(z0, z1, u); top = H / 2 * 0.85
            hh = Ht / 2 * dorsal_h * math.sin(math.pi * min(1, 0.15 + u * 0.95)) + fin_long * 0.4 * u
            return G(0, top + hh * v, z - hh * v * 0.5)
        grid_sheet(F, df, 5, 2, lambda u, v: fc(0.3 + 0.4 * u, 1.0))
    if anal > 0:
        z0 = z_nose - lb * 0.55; z1 = z0 - lb * anal - fin_long * 0.6
        def af(u, v):
            z = lerp(z0, z1, u); bot = -H / 2 * 0.8
            hh = Ht / 2 * anal_h * math.sin(math.pi * min(1, 0.15 + u * 0.95)) + fin_long * 0.5 * u
            return G(0, bot - hh * v, z - hh * v * 0.5)
        grid_sheet(F, af, 5, 2, lambda u, v: fc(0.55 + 0.3 * u, -1.0))
    for s in (-1, 1):
        def pf(u, v, s=s):
            z = z_nose - lb * 0.28 - lb * 0.12 * u
            return G(s * (W / 2 * 0.9 + lb * 0.08 * u), -H * 0.12 - lb * 0.04 * u + lb * 0.05 * (v - 0.5), z - lb * 0.03 * v)
        grid_sheet(F, pf, 2, 1, lambda u, v: fc(0.3, -0.2))
    fins = F.obj(name + "-fins", M_FIN)
    E = Builder()
    er = max(H * 0.06, 0.002)
    for s in (-1, 1):
        bm2 = bmesh.new(); bmesh.ops.create_uvsphere(bm2, u_segments=8, v_segments=5, radius=er); idx = {}
        for v in bm2.verts:
            c = (0.02, 0.02, 0.02) if v.co.x * s > er * 0.35 or v.co.x * s < -er * 0.2 else (0.75, 0.7, 0.5)
            idx[v] = E.v(G(s * (W / 2 * 0.62) + v.co.x, H * 0.12 + v.co.z, z_nose - lb * 0.12 + v.co.y), c)
        for f in bm2.faces: E.f(*[idx[v] for v in f.verts])
        bm2.free()
    eyes = E.obj(name + "-eyes", M_EYE, closed=True)
    root = bpy.data.objects.new("fish-" + name, None)
    bpy.context.collection.objects.link(root)
    for o in (body, fins, eyes): o.parent = root
    return root

def stripes(base, bands, band_col, edge=0.012, edge_col=(0.02, 0.02, 0.02)):
    def f(u, v, part):
        c = base(u, v, part)
        for (b0, b1) in bands:
            if b0 <= u <= b1: return band_col
            if b0 - edge <= u < b0 or b1 < u <= b1 + edge: return edge_col
        return c
    return f

def neon_c(u, v, part):
    if part == "fin": return (0.70, 0.75, 0.80)
    if 0.05 < v < 0.38 and u > 0.08: return (0.10, 0.55, 0.95)          # iridescent stripe
    if v <= 0.05 and u > 0.42: return (0.85, 0.08, 0.10)               # red rear belly
    return (0.80, 0.82, 0.86) if v < 0 else (0.35, 0.38, 0.30)
fish("neon", 0.018, 0.008, 0.62, 0.55, neon_c, tail="fork")

def angel_c(u, v, part):
    bar = any(abs(u - b) < 0.035 for b in (0.18, 0.45, 0.72))
    if bar: return (0.06, 0.06, 0.07)
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
    if part == "fin": return (0.6, 0.58, 0.5)
    if v < -0.3: return (0.85, 0.80, 0.72)
    return (0.25, 0.24, 0.22) if spot else (0.62, 0.60, 0.52)
fish("cory", 0.032, 0.023, 0.6, 0.8, cory_c, tail="fork", dorsal=0.18, dorsal_h=0.45, anal=0.1)

def discus_c(u, v, part):
    k = math.sin(v * 18 + math.sin(u * 14) * 1.6)
    if part == "fin": return (0.85, 0.30, 0.15) if abs(v) > 0.8 else (0.25, 0.55, 0.85)
    return (0.85, 0.32, 0.12) if k > 0.35 else (0.18, 0.55, 0.85)
fish("discus", 0.075, 0.06, 0.82, 0.18, discus_c, tail="fan", dorsal=0.55, anal=0.45, dorsal_h=0.14, anal_h=0.14,
     tail_len=0.12, tail_h=0.35)

def cichlid_c(u, v, part):
    bar = math.sin(u * 30) > 0.55 and part == "body"
    return (0.12, 0.18, 0.45) if bar else (0.28, 0.55, 0.95) if v > -0.5 else (0.60, 0.75, 0.95)
fish("cichlid", 0.053, 0.025, 0.66, 0.4, cichlid_c, tail="round", dorsal=0.5, dorsal_h=0.3, anal=0.25)

def betta_c(u, v, part):
    if part == "fin": return mix3((0.55, 0.05, 0.12), (0.15, 0.10, 0.65), 0.5 + 0.5 * math.sin(u * 12 + v * 3))
    return (0.50, 0.06, 0.12)
fish("betta", 0.037, 0.031, 0.32, 0.5, betta_c, tail="fan", dorsal=0.3, anal=0.5, dorsal_h=0.5, anal_h=0.7,
     tail_len=0.45, tail_h=1.0, fin_long=0.015)

ORANGE = (0.98, 0.42, 0.04); WHITE = (0.96, 0.96, 0.94)
fish("clown", 0.04, 0.022, 0.62, 0.45,
     stripes(lambda u, v, p: ORANGE, ((0.13, 0.2), (0.4, 0.5), (0.72, 0.76)), WHITE, edge=0.015),
     tail="round", dorsal=0.55, dorsal_h=0.25, anal=0.2)

def tang_c(u, v, part):
    if u > 0.78: return (0.98, 0.85, 0.05)
    if part == "body" and 0.1 < v < 0.6 and 0.2 < u < 0.7: return (0.03, 0.04, 0.10)
    return (0.12, 0.30, 0.90)
fish("tang", 0.06, 0.045, 0.62, 0.22, tang_c, tail="fork", dorsal=0.6, anal=0.45, dorsal_h=0.18, anal_h=0.18, tail_len=0.18)

def damsel_c(u, v, part): return (0.95, 0.85, 0.08) if (u > 0.68 or v < -0.4) else (0.08, 0.25, 0.85)
fish("damsel", 0.022, 0.014, 0.6, 0.45, damsel_c, tail="fork", dorsal=0.5, dorsal_h=0.25, anal=0.2)

def goby_c(u, v, part):
    if part == "fin": return (0.75, 0.75, 0.70)
    return (0.95, 0.80, 0.10) if noise.noise(Vector((u * 25, v * 6, 2))) < 0.35 else (0.15, 0.55, 0.85)
fish("goby", 0.03, 0.01, 0.65, 0.9, goby_c, tail="round", dorsal=0.3, dorsal_h=0.6, anal=0.2)

def yellowtang_c(u, v, part):
    if part == "fin" and u > 0.8: return (0.96, 0.92, 0.80)   # white tail spine
    return (0.98, 0.84, 0.06)
fish("yellowtang", 0.05, 0.04, 0.64, 0.24, yellowtang_c, tail="fork", dorsal=0.6, anal=0.45, dorsal_h=0.2, anal_h=0.2, tail_len=0.17)

def gramma_c(u, v, part): return (0.65, 0.12, 0.85) if u < 0.45 else (0.98, 0.82, 0.08)
fish("gramma", 0.025, 0.012, 0.6, 0.45, gramma_c, tail="fork", dorsal=0.55, anal=0.35)

# lay the templates out in a row for the preview; the host re-centres each one
for k, o in enumerate(sorted([o for o in bpy.data.objects if o.name.startswith("fish-")], key=lambda o: o.name)):
    o.location = (0, 0, 0)

# ------------------------------------------------------------------ validation (fails the build)
print("fish mesh validation:")
bad = [r for r in REPORT if not r["ok"]]
for r in REPORT:
    print(f"  {r['name']:16s} faces {r['faces']:5d}  boundary {r['boundary']}  non-manifold {r['non_manifold']}"
          f"  zero-area {r['zero_area']}  volume {r['volume']:.3e}  outward {r['outward']}  {'OK' if r['ok'] else 'FAIL'}")
if bad:
    print("VALIDATION FAILED:", ", ".join(r["name"] for r in bad))
    sys.exit(2)

# ------------------------------------------------------------------ export
os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
glb = os.path.join(OUT, "assets", "aquarium-scape.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_apply=True,
                          export_yup=True, export_normals=True, export_texcoords=False, export_materials="EXPORT",
                          export_cameras=False, export_lights=False)
if GLTFPACK:
    import subprocess
    tmp = glb + ".raw.glb"; os.replace(glb, tmp)
    subprocess.run([GLTFPACK, "-i", tmp, "-o", glb, "-cc", "-kn", "-km", "-noq"], check=True)
    os.remove(tmp)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print(f"aquarium-scape: {tris} triangles -> {glb}")

# ------------------------------------------------------------------ preview render (fresh scape)
if RENDER or HEADS:
    sc = bpy.context.scene
    for o in bpy.data.objects:
        if o.name.startswith("reef-"): o.hide_render = True
    rows = sorted([o for o in bpy.data.objects if o.name.startswith("fish-")], key=lambda o: o.name)
    spots = [(-0.7, 0.2, 0.2), (-0.3, 0.35, 0.0), (0.2, 0.1, 0.3), (0.6, 0.3, -0.1), (0.0, -0.3, 0.4), (-0.6, -0.15, -0.2),
             (0.75, -0.1, 0.25), (-0.15, 0.55, -0.3), (0.4, 0.55, 0.1), (-0.9, 0.5, -0.2), (0.9, 0.55, -0.4), (0.1, -0.55, 0.45),
             (-0.35, -0.5, 0.45)]
    for o, (x, y, z) in zip(rows, spots):
        o.location = G(x, y, z); o.rotation_euler = (0, 0, 0.6 if x < 0 else -0.6)
    world = sc.world or bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.08, 0.12, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    for k, (loc, e, s) in enumerate((((0, 0, 1.6), 260, 2.4), ((-1.8, -2.5, 0.8), 60, 1.5), ((1.8, -2.5, 0.2), 30, 1.5))):
        ld = bpy.data.lights.new(f"l{k}", "AREA"); ld.energy = e; ld.size = s
        ld.color = (0.85, 0.95, 1.0) if k == 0 else (1.0, 0.95, 0.85)
        lo = bpy.data.objects.new(f"l{k}", ld); lo.location = loc; sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0, 0, -0.4)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("cam"); cd.angle_y = math.radians(38); cd.sensor_fit = "VERTICAL"; cd.clip_start = 0.002
    co = bpy.data.objects.new("cam", cd); sc.collection.objects.link(co); sc.camera = co
    co.location = G(0, 0.0, 3.2)
    co.rotation_euler = (G(0, -0.12, 0) - co.location).to_track_quat("-Z", "Y").to_euler()
    names = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in names else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = 1920; sc.render.resolution_y = 1080
    sc.render.filepath = os.path.join(OUT, "blender", "aquarium-scape.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", sc.render.filepath)

# ------------------------------------------------------------------ head close-ups (--heads DIR)
if HEADS:
    sc = bpy.context.scene
    os.makedirs(HEADS, exist_ok=True)
    fishes = sorted([o for o in bpy.data.objects if o.name.startswith("fish-")], key=lambda o: o.name)
    for o in bpy.data.objects:
        if o.type == "MESH" and not (o.parent and o.parent.name.startswith("fish-")): o.hide_render = True
    for o in fishes: o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0)
    sc.render.resolution_x = 640; sc.render.resolution_y = 480
    world = sc.world; world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.10, 0.14, 1)
    for f in fishes:
        for o in fishes:
            hide = o is not f
            for c in o.children: c.hide_render = hide
        size = max(max(c.dimensions) for c in f.children)
        for view, d in (("front", G(0, 0.0, 1)), ("profile", G(1, 0.0, 0.25))):
            sc.camera.location = d.normalized() * size * 1.9
            sc.camera.rotation_euler = (Vector((0, 0, 0)) - sc.camera.location).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(HEADS, f"{f.name}-{view}.png")
            bpy.ops.render.render(write_still=True)
    print("heads rendered to", HEADS)

if QUIT:
    bpy.ops.wm.quit_blender()
