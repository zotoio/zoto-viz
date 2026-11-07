"""Koi pond scape + HD fish (Blender 5.x).

Run via GUI Blender (reuse MCP) or:
  blender --python plugins/src/koi-pond/blender/build_pond.py -- --out plugins/src/koi-pond --keep-open

Builds (pond units ≈ host mesh frame, water at y≈0, radius ≈1):
  koi-pond-scape.glb   basin bed, stone kerb, pebble substrate, fountain,
                       flowering water lilies, accent rocks (vertex colour)
  koi-{kohaku,showa,ogon}-hd.glb  skinned koi with swim Action (tail/body/fins)
  lily-pads-hd.glb     flowering lily cluster (also embedded in scape)
  pond-rocks-hd.glb    accent rocks (also embedded in scape)

Deterministic (noise seed 2026). Vertex colours, no image textures (host shaders + VC).
"""
from __future__ import annotations
import bpy, bmesh, math, os, sys, hashlib
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
QUIT = "--keep-open" not in argv
ASSETS = os.path.join(OUT, "assets")
os.makedirs(ASSETS, exist_ok=True)

noise.seed_set(2026)

def G(x, y, z):
    """glTF Y-up → Blender Z-up."""
    return Vector((x, -z, y))

def lerp(a, b, t): return a + (b - a) * t
def mix3(a, b, t): return tuple(lerp(a[i], b[i], t) for i in range(3))
def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / max(1e-9, e1 - e0))); return t * t * (3 - 2 * t)

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for a in list(bpy.data.armatures):
        bpy.data.armatures.remove(a)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    global M_STONE, M_PEBBLE, M_PAD, M_PETAL, M_FISH, M_FIN, M_EYE, M_WATER
    m = mats()
    M_STONE, M_PEBBLE, M_PAD, M_PETAL = m["stone"], m["pebble"], m["pad"], m["petal"]
    M_FISH, M_FIN, M_EYE, M_WATER = m["fish"], m["fin"], m["eye"], m["water"]

def vcmat(name, rough=0.6, coat=0.0, emit=0.0, double=True, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    a = nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = "Col"
    nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value = coat
    if emit > 0:
        nt.links.new(a.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emit
    m.use_backface_culling = not double
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
    return m

M_STONE = M_PEBBLE = M_PAD = M_PETAL = M_FISH = M_FIN = M_EYE = M_WATER = None

def mats():
    return {
        "stone": vcmat("stone", rough=0.88, double=False),
        "pebble": vcmat("pebble", rough=0.95, double=False),
        "pad": vcmat("lily-pad", rough=0.55),
        "petal": vcmat("lotus-petal", rough=0.35, coat=0.25, emit=0.05),
        "fish": vcmat("fish", rough=0.32, coat=0.65, double=False),
        "fin": vcmat("fin", rough=0.4, alpha=0.82),
        "eye": vcmat("eye", rough=0.08, coat=1.0, double=False),
        "water": vcmat("fountain-water", rough=0.05, coat=0.9, alpha=0.55),
    }

class Builder:
    def __init__(self):
        self.bm = bmesh.new(); self.col = {}
    def v(self, p, c):
        vv = self.bm.verts.new(p); self.col[vv] = c; return vv
    def f(self, *vs):
        try: return self.bm.faces.new(vs)
        except ValueError: return None
    def flush(self, name, material, smooth_shade=True):
        self.bm.verts.ensure_lookup_table(); self.bm.faces.ensure_lookup_table()
        me = bpy.data.meshes.new(name)
        # colour layer on bmesh first
        cl = self.bm.loops.layers.color.new("Col")
        for f in self.bm.faces:
            for loop in f.loops:
                c = self.col.get(loop.vert, (0.5, 0.5, 0.5))
                loop[cl] = (*c, 1.0)
        self.bm.to_mesh(me); self.bm.free()
        if smooth_shade:
            for p in me.polygons: p.use_smooth = True
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(material)
        bpy.context.collection.objects.link(ob)
        return ob

def grid_sheet(B, f, nu, nv, colf, flip=False):
    rows = [[B.v(f(i / nu, j / nv), colf(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            q = (rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])
            B.f(*(q[::-1] if flip else q))

def export_glb(path, objects=None):
    if objects is not None:
        bpy.ops.object.select_all(action="DESELECT")
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        use_sel = True
    else:
        use_sel = False
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=use_sel, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=False, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=True,
        export_skins=True, export_morph=False,
    )
    print("wrote", path, "bytes", os.path.getsize(path))

# ------------------------------------------------------------------ scape
def build_scape():
    clear_scene()
    R = 1.05
    # substrate disc with pebbles
    B = Builder()
    SAND = (0.55, 0.48, 0.36); GRIT = (0.32, 0.30, 0.26); MOSS = (0.28, 0.38, 0.22)
    def sand_h(u, v):
        ang = u * math.pi * 2; rad = v * R * 0.98
        x = math.cos(ang) * rad; z = math.sin(ang) * rad
        h = -0.08 + 0.012 * noise.noise(Vector((x * 3.1, z * 3.1, 0.4)))
        h += 0.006 * noise.noise(Vector((x * 9, z * 9, 2.1)))
        return G(x, h, z)
    def sand_c(u, v):
        ang = u * math.pi * 2; rad = v * R
        x = math.cos(ang) * rad; z = math.sin(ang) * rad
        k = 0.5 + 0.5 * noise.noise(Vector((x * 4, z * 4, 1.2)))
        c = mix3(SAND, GRIT, smooth(0.45, 0.9, k))
        if noise.noise(Vector((x * 2.2, z * 2.2, 7))) > 0.35:
            c = mix3(c, MOSS, 0.35)
        return c
    # radial grid
    NU, NV = 48, 18
    rows = []
    for i in range(NU + 1):
        row = []
        for j in range(NV + 1):
            u = i / NU; v = j / NV
            row.append(B.v(sand_h(u, v), sand_c(u, v)))
        rows.append(row)
    for i in range(NU):
        for j in range(NV):
            B.f(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])
    B.flush("substrate", M_PEBBLE)

    # basin outer wall (kerb ring)
    B = Builder()
    STONE = (0.62, 0.60, 0.56); DARK = (0.38, 0.36, 0.34)
    N = 36
    for i in range(N):
        a0 = i / N * math.pi * 2; a1 = (i + 1) / N * math.pi * 2
        for k, (r0, r1, y0, y1, c) in enumerate([
            (R * 0.98, R * 1.08, -0.10, 0.06, STONE),
            (R * 1.08, R * 1.14, -0.04, 0.10, mix3(STONE, DARK, 0.3)),
        ]):
            def ring_pt(a, r, y):
                return G(math.cos(a) * r, y + 0.008 * math.sin(a * 5 + k), math.sin(a) * r)
            v00 = B.v(ring_pt(a0, r0, y0), c); v10 = B.v(ring_pt(a1, r0, y0), c)
            v11 = B.v(ring_pt(a1, r1, y0), mix3(c, DARK, 0.2)); v01 = B.v(ring_pt(a0, r1, y0), mix3(c, DARK, 0.2))
            B.f(v00, v10, v11, v01)
            t00 = B.v(ring_pt(a0, r0, y1), mix3(c, (0.75, 0.74, 0.7), 0.3))
            t10 = B.v(ring_pt(a1, r0, y1), mix3(c, (0.75, 0.74, 0.7), 0.3))
            t11 = B.v(ring_pt(a1, r1, y1), c); t01 = B.v(ring_pt(a0, r1, y1), c)
            B.f(t00, t01, t11, t10)
            B.f(v00, t00, t10, v10); B.f(v01, v11, t11, t01)
    B.flush("basin-kerb", M_STONE)

    # fountain pedestal + bowl
    B = Builder()
    GREY = (0.55, 0.54, 0.52)
    for i in range(16):
        a0 = i / 16 * math.pi * 2; a1 = (i + 1) / 16 * math.pi * 2
        for (r0, r1, y0, y1) in [(0.0, 0.09, 0.0, 0.16), (0.09, 0.15, 0.16, 0.20)]:
            def p(a, r, y): return G(math.cos(a) * r, y, math.sin(a) * r)
            if r0 < 1e-6:
                c = B.v(G(0, y0, 0), GREY)
                for a in (a0, a1):
                    pass
                v1 = B.v(p(a0, r1, y0), GREY); v2 = B.v(p(a1, r1, y0), GREY)
                v3 = B.v(p(a0, r1, y1), mix3(GREY, (0.7, 0.7, 0.68), 0.3))
                v4 = B.v(p(a1, r1, y1), mix3(GREY, (0.7, 0.7, 0.68), 0.3))
                top = B.v(G(0, y1, 0), mix3(GREY, (0.75, 0.75, 0.72), 0.4))
                B.f(c, v1, v2); B.f(v1, v3, v4, v2); B.f(top, v4, v3)
            else:
                v00 = B.v(p(a0, r0, y0), GREY); v10 = B.v(p(a1, r0, y0), GREY)
                v11 = B.v(p(a1, r1, y0), GREY); v01 = B.v(p(a0, r1, y0), GREY)
                t00 = B.v(p(a0, r0, y1), GREY); t10 = B.v(p(a1, r0, y1), GREY)
                t11 = B.v(p(a1, r1, y1), GREY); t01 = B.v(p(a0, r1, y1), GREY)
                B.f(v00, v10, v11, v01); B.f(t00, t01, t11, t10)
                B.f(v00, t00, t10, v10); B.f(v01, v11, t11, t01)
    B.flush("fountain", M_STONE)

    # accent rocks
    def rock(B, cx, cz, rx, ry, rz, seed, base, vein):
        bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=3, radius=1.0)
        idx = {}
        for v in bm2.verts:
            d = v.co.normalized()
            n1 = noise.noise(d * 1.6 + Vector((seed, 0, 0)))
            n2 = noise.noise(d * 4.5 + Vector((0, seed, 0)))
            r = 1.0 + 0.28 * n1 + 0.08 * n2
            p = Vector((d.x * rx * r, d.y * ry * r, d.z * rz * r))
            if d.y < -0.15: p.y *= 0.45
            stripe = 0.5 + 0.5 * math.sin((d.x * 6 + d.y * 9 + n2 * 4))
            c = mix3(base, vein, smooth(0.75, 0.95, stripe))
            y = -0.06 + p.y + ry * 0.35
            idx[v] = B.v(G(cx + p.x, y, cz + p.z), c)
        for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
        bm2.free()

    B = Builder()
    SEIRYU = (0.42, 0.44, 0.45); VEIN = (0.72, 0.74, 0.72)
    for spec in [
        (0.55, 0.35, 0.14, 0.09, 0.12, 1.3),
        (-0.62, 0.28, 0.16, 0.11, 0.13, 2.9),
        (0.22, -0.68, 0.12, 0.08, 0.10, 5.1),
        (-0.35, -0.55, 0.10, 0.07, 0.09, 7.7),
        (0.72, -0.15, 0.11, 0.08, 0.10, 4.2),
    ]:
        rock(B, *spec[:5], spec[5], SEIRYU, VEIN)
    rocks_ob = B.flush("pond-rocks", M_STONE)

    # flowering water lilies
    def lily(cx, cz, scale, petal_col, seed):
        B = Builder()
        GREEN = (0.18, 0.42, 0.22); DG = (0.12, 0.30, 0.16)
        # pad — notched disc
        NU, NV = 24, 6
        rows = []
        for i in range(NU + 1):
            row = []
            for j in range(NV + 1):
                u = i / NU; v = j / NV
                ang = u * math.pi * 2
                # notch at u≈0
                notch = 1.0 - 0.55 * smooth(0.92, 1.0, abs((u % 1) - 0.0) * 2 if u < 0.08 or u > 0.92 else 0)
                if u < 0.08 or u > 0.92:
                    notch = 1.0 - 0.7 * (1 - abs(0.5 - ((u + 0.04) % 1)) * 8 / 1)
                    notch = max(0.15, 1.0 - 0.75 * smooth(0.0, 0.08, min(u, 1 - u)))
                rad = scale * (0.12 + 0.18 * v) * notch
                wave = 0.006 * math.sin(ang * 3 + seed) * v
                x = cx + math.cos(ang) * rad
                z = cz + math.sin(ang) * rad
                y = 0.012 + wave + 0.004 * v
                c = mix3(GREEN, DG, v * 0.5 + 0.2 * noise.noise(Vector((x * 8, z * 8, seed))))
                row.append(B.v(G(x, y, z), c))
            rows.append(row)
        for i in range(NU):
            for j in range(NV):
                B.f(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])
        B.flush(f"lily-pad-{seed:.0f}", M_PAD)
        # flower — layered petals
        B = Builder()
        for layer, (npet, rad, h, lift) in enumerate([(8, 0.045, 0.035, 0.02), (6, 0.028, 0.04, 0.035), (5, 0.015, 0.03, 0.05)]):
            for p in range(npet):
                ang = p / npet * math.pi * 2 + layer * 0.2 + seed
                for ui in range(4):
                    for vi in range(3):
                        pass
                # petal as tapered sheet
                pts = []
                for ui in range(5):
                    row = []
                    for vi in range(4):
                        u = ui / 4; v = (vi / 3) - 0.5
                        along = rad * scale * 2.2 * u
                        wide = rad * scale * (0.55 * math.sin(math.pi * u)) * (1 - abs(v) * 0.3)
                        px = cx + math.cos(ang) * along - math.sin(ang) * wide * v * 2
                        pz = cz + math.sin(ang) * along + math.cos(ang) * wide * v * 2
                        py = lift * scale * 2 + h * scale * 2 * math.sin(math.pi * u) * (1 - abs(v) * 0.4)
                        c = mix3(petal_col, (1, 1, 0.85), u * 0.35 + layer * 0.1)
                        row.append(B.v(G(px, py, pz), c))
                    pts.append(row)
                for ui in range(4):
                    for vi in range(3):
                        B.f(pts[ui][vi], pts[ui + 1][vi], pts[ui + 1][vi + 1], pts[ui][vi + 1])
        # centre
        bm2 = bmesh.new(); bmesh.ops.create_uvsphere(bm2, u_segments=10, v_segments=6, radius=scale * 0.018)
        idx = {}
        for v in bm2.verts:
            idx[v] = B.v(G(cx + v.co.x, 0.04 * scale * 2 + v.co.z + 0.02, cz + v.co.y), (0.95, 0.82, 0.15))
        for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
        bm2.free()
        B.flush(f"lotus-bloom-{seed:.0f}", M_PETAL)

    blooms = [
        (0.35, 0.40, 1.0, (0.92, 0.55, 0.70), 1.0),
        (-0.42, 0.22, 0.9, (0.95, 0.92, 0.88), 2.0),
        (0.18, -0.48, 1.1, (0.90, 0.48, 0.62), 3.0),
        (-0.28, -0.32, 0.85, (0.95, 0.90, 0.86), 4.0),
        (0.55, -0.25, 0.75, (0.88, 0.40, 0.55), 5.0),
        (-0.55, 0.05, 0.8, (0.93, 0.88, 0.85), 6.0),
    ]
    for spec in blooms:
        lily(*spec)

    # empty root for naming
    root = bpy.data.objects.new("koi-pond-scape", None)
    bpy.context.collection.objects.link(root)
    for o in list(bpy.data.objects):
        if o != root and o.parent is None:
            o.parent = root

    out = os.path.join(ASSETS, "koi-pond-scape.glb")
    export_glb(out)
    return out

# ------------------------------------------------------------------ HD lily / rocks standalone (subset)
def build_lily_pads_hd():
    clear_scene()
    # reuse lily builder via scape pieces — simplified: 5 flowering pads
    def make():
        # inline minimal
        pass
    # Call build pieces by re-importing scape flowers — easier: run lily helpers
    # Rebuild 5 pads only
    global_blooms = [
        (0.0, 0.0, 1.0, (0.92, 0.55, 0.70), 1.0),
        (0.35, 0.1, 0.9, (0.95, 0.92, 0.88), 2.0),
        (-0.3, 0.15, 1.0, (0.90, 0.48, 0.62), 3.0),
        (0.15, -0.35, 0.85, (0.95, 0.90, 0.86), 4.0),
        (-0.2, -0.3, 0.8, (0.88, 0.40, 0.55), 5.0),
    ]
    # duplicate lily function locally by exec of scape's — just call build_scape's lily via import of functions
    # We'll redefine quickly:
    def lily(cx, cz, scale, petal_col, seed):
        B = Builder()
        GREEN = (0.18, 0.42, 0.22); DG = (0.12, 0.30, 0.16)
        NU, NV = 24, 6
        rows = []
        for i in range(NU + 1):
            row = []
            for j in range(NV + 1):
                u = i / NU; v = j / NV
                ang = u * math.pi * 2
                notch = max(0.15, 1.0 - 0.75 * smooth(0.0, 0.08, min(u, 1 - u)))
                rad = scale * (0.12 + 0.18 * v) * notch
                wave = 0.006 * math.sin(ang * 3 + seed) * v
                x = cx + math.cos(ang) * rad; z = cz + math.sin(ang) * rad
                y = 0.012 + wave + 0.004 * v
                c = mix3(GREEN, DG, v * 0.5)
                row.append(B.v(G(x, y, z), c))
            rows.append(row)
        for i in range(NU):
            for j in range(NV):
                B.f(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])
        pad = B.flush(f"Pad{int(seed)}", M_PAD)
        B = Builder()
        for layer, (npet, rad, h, lift) in enumerate([(8, 0.045, 0.035, 0.02), (6, 0.028, 0.04, 0.035)]):
            for p in range(npet):
                ang = p / npet * math.pi * 2 + layer * 0.2 + seed
                pts = []
                for ui in range(5):
                    row = []
                    for vi in range(4):
                        u = ui / 4; v = (vi / 3) - 0.5
                        along = rad * scale * 2.2 * u
                        wide = rad * scale * (0.55 * math.sin(math.pi * u)) * (1 - abs(v) * 0.3)
                        px = cx + math.cos(ang) * along - math.sin(ang) * wide * v * 2
                        pz = cz + math.sin(ang) * along + math.cos(ang) * wide * v * 2
                        py = lift * scale * 2 + h * scale * 2 * math.sin(math.pi * u) * (1 - abs(v) * 0.4)
                        c = mix3(petal_col, (1, 1, 0.85), u * 0.35)
                        row.append(B.v(G(px, py, pz), c))
                    pts.append(row)
                for ui in range(4):
                    for vi in range(3):
                        B.f(pts[ui][vi], pts[ui + 1][vi], pts[ui + 1][vi + 1], pts[ui][vi + 1])
        bloom = B.flush(f"Bloom{int(seed)}", M_PETAL)
        return pad, bloom
    root = bpy.data.objects.new("lily-pads-root", None)
    bpy.context.collection.objects.link(root)
    for spec in global_blooms:
        pad, bloom = lily(*spec)
        pad.parent = root; bloom.parent = root
    out = os.path.join(ASSETS, "lily-pads-hd.glb")
    export_glb(out)
    return out

def build_rocks_hd():
    clear_scene()
    B = Builder()
    SEIRYU = (0.42, 0.44, 0.45); VEIN = (0.72, 0.74, 0.72)
    def rock(cx, cz, rx, ry, rz, seed):
        bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=3, radius=1.0)
        idx = {}
        for v in bm2.verts:
            d = v.co.normalized()
            n1 = noise.noise(d * 1.6 + Vector((seed, 0, 0)))
            n2 = noise.noise(d * 4.5 + Vector((0, seed, 0)))
            r = 1.0 + 0.28 * n1 + 0.08 * n2
            p = Vector((d.x * rx * r, d.y * ry * r, d.z * rz * r))
            if d.y < -0.15: p.y *= 0.45
            stripe = 0.5 + 0.5 * math.sin((d.x * 6 + d.y * 9 + n2 * 4))
            c = mix3(SEIRYU, VEIN, smooth(0.75, 0.95, stripe))
            idx[v] = B.v(G(cx + p.x, p.y + ry * 0.35, cz + p.z), c)
        for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
        bm2.free()
    for i, spec in enumerate([
        (0.0, 0.0, 0.18, 0.12, 0.15, 1.3),
        (0.4, 0.1, 0.14, 0.10, 0.12, 2.9),
        (-0.35, 0.15, 0.16, 0.11, 0.13, 5.1),
        (0.1, -0.4, 0.12, 0.09, 0.11, 7.7),
    ]):
        rock(*spec)
    rocks_ob = B.flush("pond-rocks", M_STONE)
    root = bpy.data.objects.new("pond-rocks-root", None)
    bpy.context.collection.objects.link(root)
    rocks_ob.parent = root
    # Split into Rock0.. for host naming parity: duplicate as separate empties not required;
    # single mesh under root is fine for host-mesh instancing.
    out = os.path.join(ASSETS, "pond-rocks-hd.glb")
    export_glb(out)
    return out

# ------------------------------------------------------------------ skinned HD koi
def koi_colours(variety):
    """Return (body_fn) mapping (u along body 0=nose..1=tail, v=-1..1 height) -> rgb."""
    if variety == "kohaku":
        def f(u, v):
            # white body, red hi patches
            base = (0.92, 0.90, 0.86)
            red = (0.78, 0.08, 0.06)
            patch = 0
            if 0.12 < u < 0.38 and abs(v - 0.15) < 0.55: patch = 1
            if 0.48 < u < 0.72 and v > -0.2: patch = 1
            if 0.78 < u < 0.92 and abs(v) < 0.4: patch = 1
            return red if patch else base
        return f
    if variety == "showa":
        def f(u, v):
            base = (0.06, 0.05, 0.05)
            red = (0.75, 0.10, 0.07)
            white = (0.9, 0.88, 0.84)
            if 0.15 < u < 0.35 and v > 0: return red
            if 0.55 < u < 0.7 and v < 0.2: return white
            if 0.75 < u < 0.9: return red
            return base
        return f
    # ogon — metallic gold
    def f(u, v):
        g = 0.55 + 0.25 * math.sin(u * 12 + v * 3)
        return (0.75 + 0.15 * g, 0.55 + 0.1 * g, 0.12 + 0.05 * g)
    return f

def build_koi_hd(variety: str):
    clear_scene()
    colf = koi_colours(variety)
    # body length ~1.6 host units before KOI_FISH_SCALE 0.48 → visual ~0.77; build at ~1.0 length
    L = 1.0; H = 0.28; W = 0.22
    # armature bones along +Z (nose)
    arm_data = bpy.data.armatures.new(f"arm-{variety}")
    arm_ob = bpy.data.objects.new(f"arm-{variety}", arm_data)
    bpy.context.collection.objects.link(arm_ob)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    z_nose = L / 2
    chain = [
        ("root", -0.05, 0.05),
        ("spine_01", 0.05, 0.25),
        ("spine_02", 0.25, 0.45),
        ("spine_03", 0.45, 0.65),
        ("tail_01", 0.65, 0.82),
        ("tail_02", 0.82, 0.98),
        ("head", 0.0, 0.12),
    ]
    # bones along Z from tail(-) to nose(+): parameter t from 0 at nose to 1 at tip? 
    # Standard koi: nose +Z. Place bones from z=-L/2 (tail) to z=+L/2 (nose).
    bone_specs = [
        ("root", -0.05),
        ("spine_01", 0.12),
        ("spine_02", 0.30),
        ("spine_03", 0.48),
        ("tail_01", 0.65),
        ("tail_02", 0.82),
    ]
    # u=0 nose at +L/2, u=1 tail at -L/2 → bone positions by u
    prev = None
    bones_u = [
        ("head", 0.05, 0.0),
        ("spine_01", 0.22, 0.12),
        ("spine_02", 0.40, 0.28),
        ("spine_03", 0.58, 0.46),
        ("tail_01", 0.75, 0.64),
        ("tail_02", 0.95, 0.82),
    ]
    # Actually simpler chain from head to tip
    names = ["head", "spine_01", "spine_02", "spine_03", "tail_01", "tail_02"]
    us = [0.0, 0.18, 0.36, 0.55, 0.72, 0.90, 1.05]
    created = {}
    for i, name in enumerate(names):
        b = eb.new(name)
        z0 = z_nose - L * us[i]
        z1 = z_nose - L * us[i + 1]
        b.head = G(0, 0, z0)
        b.tail = G(0, 0, z1)
        if i > 0:
            b.parent = created[names[i - 1]]
            b.use_connect = True
        created[name] = b
    # pectoral fins
    for side, nm in [(-1, "fin_pectoral_L"), (1, "fin_pectoral_R")]:
        b = eb.new(nm)
        b.head = G(side * W * 0.35, -H * 0.05, z_nose - L * 0.22)
        b.tail = G(side * W * 0.7, -H * 0.08, z_nose - L * 0.28)
        b.parent = created["spine_01"]
        created[nm] = b
    bpy.ops.object.mode_set(mode="OBJECT")

    # mesh body
    B = Builder()
    NU, NV = 56, 28
    rings = []
    for i in range(NU + 1):
        u = i / NU  # 0 nose → 1 tip
        prof = math.sin(math.pi * min(1.0, 0.06 + u * 0.94) ** 0.7) ** 0.75
        if u > 0.85: prof *= smooth(1.0, 0.85, u)
        ry = H / 2 * max(prof, 0.08); rx = W / 2 * max(prof, 0.08)
        z = z_nose - L * u
        ring = []
        for j in range(NV):
            a = 2 * math.pi * j / NV
            sy = math.sin(a)
            c = colf(u, sy)
            # gill darken
            if 0.15 < u < 0.20: c = mix3(c, (c[0]*0.5, c[1]*0.5, c[2]*0.5), 0.5)
            ring.append(B.v(G(rx * math.cos(a), ry * sy * 0.95, z), c))
        rings.append(ring)
    nose = B.v(G(0, 0, z_nose + 0.01), colf(0, 0))
    for j in range(NV): B.f(nose, rings[0][j], rings[0][(j + 1) % NV])
    for i in range(NU):
        for j in range(NV):
            B.f(rings[i][j], rings[i][(j + 1) % NV], rings[i + 1][(j + 1) % NV], rings[i + 1][j])
    tip = B.v(G(0, 0, z_nose - L - 0.01), colf(1, 0))
    for j in range(NV): B.f(rings[-1][(j + 1) % NV], rings[-1][j], tip)
    body = B.flush(f"koi_{variety}", M_FISH)

    # fins
    F = Builder()
    def fin_col(u, v):
        c = colf(min(0.95, u), v)
        return mix3(c, (c[0]*0.85, c[1]*0.85, c[2]*0.9), 0.3)
    # tail fan
    z_ped = z_nose - L * 0.78
    grid_sheet(F,
        lambda u, v: G(0, (v - 0.5) * H * 0.9 * (0.3 + 0.9 * u), z_ped - L * 0.22 * u),
        6, 5, lambda u, v: fin_col(0.8 + 0.2 * u, (v - 0.5) * 2))
    # dorsal
    grid_sheet(F,
        lambda u, v: G(0, H * 0.4 + H * 0.35 * v * math.sin(math.pi * u), z_nose - L * (0.25 + 0.4 * u)),
        6, 3, lambda u, v: fin_col(0.3 + 0.4 * u, 1))
    # pectorals
    for s in (-1, 1):
        grid_sheet(F,
            lambda u, v, s=s: G(s * (W * 0.4 + W * 0.35 * u), -H * 0.05 - H * 0.08 * u + H * 0.05 * (v - 0.5),
                                z_nose - L * (0.2 + 0.12 * u)),
            4, 2, lambda u, v: fin_col(0.25, -0.3))
    fins = F.flush(f"koi_{variety}_fins", M_FIN)

    # eyes
    E = Builder()
    for s in (-1, 1):
        bm2 = bmesh.new(); bmesh.ops.create_uvsphere(bm2, u_segments=10, v_segments=6, radius=0.018)
        idx = {}
        for v in bm2.verts:
            c = (0.02, 0.02, 0.02) if v.co.x * s > 0.005 else (0.85, 0.8, 0.55)
            idx[v] = E.v(G(s * W * 0.28 + v.co.x, H * 0.12 + v.co.z, z_nose - L * 0.1 + v.co.y), c)
        for f in bm2.faces: E.f(*[idx[v] for v in f.verts])
        bm2.free()
    eyes = E.flush(f"koi_{variety}_eyes", M_EYE)

    # join meshes
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True); fins.select_set(True); eyes.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    mesh_ob = body
    mesh_ob.name = f"koi_{variety}"

    # skin
    mod = mesh_ob.modifiers.new("arm", "ARMATURE")
    mod.object = arm_ob
    # automatic weights
    bpy.ops.object.select_all(action="DESELECT")
    mesh_ob.select_set(True); arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # swim action — Blender 5.x layered Action has no .fcurves; keyframe via pose bones.
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.mode_set(mode="POSE")
    frames = 48
    wave_bones = ["spine_01", "spine_02", "spine_03", "tail_01", "tail_02", "fin_pectoral_L", "fin_pectoral_R"]
    amps = {
        "spine_01": 0.08, "spine_02": 0.14, "spine_03": 0.22,
        "tail_01": 0.35, "tail_02": 0.5,
        "fin_pectoral_L": 0.4, "fin_pectoral_R": 0.4,
    }
    for bi, bname in enumerate(wave_bones):
        pb = arm_ob.pose.bones.get(bname)
        if not pb: continue
        pb.rotation_mode = "XYZ"
        amp = amps[bname]
        phase = bi * 0.45
        for fi in range(frames + 1):
            tt = fi / frames * math.pi * 2
            if "fin_pectoral" in bname:
                yaw = amp * math.sin(tt * 2 + phase + (0 if "L" in bname else math.pi))
                pitch = amp * 0.15 * math.sin(tt * 2 + phase)
            else:
                yaw = amp * math.sin(tt + phase)
                pitch = amp * 0.05 * math.sin(tt + phase)
            pb.rotation_euler[0] = pitch
            pb.rotation_euler[1] = 0.0
            pb.rotation_euler[2] = yaw
            pb.keyframe_insert(data_path="rotation_euler", frame=fi + 1)
    # Name the action swim for the host mixer
    ad = arm_ob.animation_data
    if ad and ad.action:
        ad.action.name = "swim"
        # Prefer a cyclic range
        try:
            ad.action.use_cyclic = True
        except Exception:
            pass
        try:
            for fc in getattr(ad.action, "fcurves", []) or []:
                for kp in fc.keyframe_points:
                    kp.interpolation = "BEZIER"
        except Exception:
            pass
        # Blender 5 layered actions: walk channelbags/fcurves if present
        try:
            for layer in getattr(ad.action, "layers", []) or []:
                for strip in getattr(layer, "strips", []) or []:
                    for bag in getattr(strip, "channelbags", []) or []:
                        for fc in getattr(bag, "fcurves", []) or []:
                            for kp in fc.keyframe_points:
                                kp.interpolation = "BEZIER"
        except Exception:
            pass
    bpy.ops.object.mode_set(mode="OBJECT")

    # root empty
    root = bpy.data.objects.new(f"koi-{variety}-root", None)
    bpy.context.collection.objects.link(root)
    arm_ob.parent = root
    mesh_ob.parent = root

    out = os.path.join(ASSETS, f"koi-{variety}-hd.glb")
    export_glb(out, objects=[root, arm_ob, mesh_ob])
    return out

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def count_tris():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")

def main():
    results = {}
    print("=== building koi-pond-scape ===")
    results["koi-pond-scape"] = build_scape()
    print("=== building lily-pads-hd ===")
    results["lily-pads-hd"] = build_lily_pads_hd()
    print("=== building pond-rocks-hd ===")
    results["pond-rocks-hd"] = build_rocks_hd()
    for v in ("kohaku", "showa", "ogon"):
        print(f"=== building koi-{v}-hd ===")
        results[f"koi-{v}-hd"] = build_koi_hd(v)
    meta = {}
    for k, p in results.items():
        meta[k] = {"path": p, "sha256": sha256(p), "bytes": os.path.getsize(p)}
    meta_path = os.path.join(OUT, "blender", "build_pond_meta.json")
    import json
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print("META", json.dumps(meta, indent=2))
    if QUIT:
        bpy.ops.wm.quit_blender()

if __name__ == "__main__":
    main()
