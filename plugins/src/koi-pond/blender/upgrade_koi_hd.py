"""Upgrade koi HD from the shipped textured standard GLBs + photoreal scape.

Run (GUI visible, no splash):
  blender --python plugins/src/koi-pond/blender/upgrade_koi_hd.py -- --out plugins/src/koi-pond --keep-open

- Fish: import koi-{variety}.glb (already textured PBR + skinned swim),
  validate head region, retarget a stronger S-curve swim on the existing
  armature (lateral body wave + pectoral flap), optional 1-level densify,
  export koi-{variety}-hd.glb. Keeps root/head/spine/tail hierarchy.
- Scape: bake image textures (stone, mossy pad, petal, pebble) onto
  basin/kerb/fountain/lilies/rocks and export koi-pond-scape.glb.
"""
from __future__ import annotations
import bpy, bmesh, math, os, sys, hashlib, json
from mathutils import Vector, Euler
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
QUIT = "--keep-open" not in argv
ASSETS = os.path.join(OUT, "assets")
TEX = os.path.join(OUT, "blender", "textures")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(TEX, exist_ok=True)

def clear_all():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for a in list(bpy.data.armatures):
        bpy.data.armatures.remove(a)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img.name in ("Render Result", "Viewer Node"):
            continue
        try: bpy.data.images.remove(img)
        except Exception: pass

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()

def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False, export_apply=False,
        export_yup=True, export_normals=True, export_texcoords=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=True,
        export_skins=True, export_morph=False, export_image_format="AUTO",
    )
    print("wrote", path, os.path.getsize(path))

def mesh_integrity(ob):
    """Return head/body gap stats. long axis = length of fish."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    xs=[v.co.x for v in bm.verts]; ys=[v.co.y for v in bm.verts]; zs=[v.co.z for v in bm.verts]
    extent = {"x": max(xs)-min(xs), "y": max(ys)-min(ys), "z": max(zs)-min(zs)}
    axis = max(extent, key=extent.get)
    vals = [getattr(v.co, axis) for v in bm.verts]
    lo, hi = min(vals), max(vals)
    head_cut = hi - 0.12 * (hi - lo)
    head_idx = {v.index for v in bm.verts if getattr(v.co, axis) >= head_cut}
    head_boundary = sum(
        1 for e in bm.edges
        if e.is_boundary and (e.verts[0].index in head_idx or e.verts[1].index in head_idx)
    )
    # Closed body (ignore fin open edges): count boundary in mid-body band
    mid_lo, mid_hi = lo + 0.25*(hi-lo), lo + 0.75*(hi-lo)
    body_boundary = 0
    for e in bm.edges:
        if not e.is_boundary: continue
        a = getattr(e.verts[0].co, axis); b = getattr(e.verts[1].co, axis)
        if mid_lo <= a <= mid_hi and mid_lo <= b <= mid_hi:
            body_boundary += 1
    bare = 0
    if ob.vertex_groups:
        for i in head_idx:
            total = sum(g.weight for g in ob.data.vertices[i].groups)
            if total < 0.05: bare += 1
    bm.free()
    return {
        "verts": len(ob.data.vertices), "faces": len(ob.data.polygons),
        "axis": axis, "head_verts": len(head_idx), "head_boundary": head_boundary,
        "body_band_boundary": body_boundary, "bare_head_weights": bare,
        "has_head_bone_group": "head" in [g.name for g in ob.vertex_groups],
        "ok_head": len(head_idx) >= 20 and bare == 0,
    }

def rewrite_swim(arm_ob):
    """Replace swim with a realistic lateral S-curve + pectoral fans (Blender 5 keyframe_insert)."""
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.mode_set(mode="POSE")
    # Clear every action so export has a single swim clip (no swim.001).
    if arm_ob.animation_data:
        arm_ob.animation_data_clear()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    frames = 48  # 2s at 24fps
    # Amplitudes grow toward the tip (S-curve travelling wave)
    wave = [
        ("spine_01", 0.10, 0.0),
        ("spine_02", 0.18, 0.55),
        ("spine_03", 0.28, 1.1),
        ("tail_01", 0.42, 1.65),
        ("tail_02", 0.55, 2.2),
    ]
    for name, amp, phase in wave:
        pb = arm_ob.pose.bones.get(name)
        if not pb: continue
        pb.rotation_mode = "XYZ"
        for fi in range(frames + 1):
            t = fi / frames * math.pi * 2
            # Primary bend around local bone "side" axis. For Y-along bones after glTF,
            # Z rotation is lateral wag in pose space for this rig.
            yaw = amp * math.sin(t + phase)
            # slight vertical undulation
            pitch = amp * 0.12 * math.sin(t + phase + 0.4)
            pb.rotation_euler = (pitch, 0.0, yaw)
            pb.keyframe_insert(data_path="rotation_euler", frame=fi + 1)
    for side, name in [(-1, "fin_pectoral_L"), (1, "fin_pectoral_R")]:
        pb = arm_ob.pose.bones.get(name)
        if not pb: continue
        pb.rotation_mode = "XYZ"
        for fi in range(frames + 1):
            t = fi / frames * math.pi * 2
            # Out-of-phase flap
            flap = 0.55 * math.sin(t * 2.0 + (0 if side < 0 else math.pi))
            pb.rotation_euler = (flap * 0.35, flap * side * 0.25, flap * 0.15)
            pb.keyframe_insert(data_path="rotation_euler", frame=fi + 1)
    # Soft head counter-sway (keeps nose leading)
    pb = arm_ob.pose.bones.get("head")
    if pb:
        pb.rotation_mode = "XYZ"
        for fi in range(frames + 1):
            t = fi / frames * math.pi * 2
            pb.rotation_euler = (0.0, 0.0, -0.06 * math.sin(t))
            pb.keyframe_insert(data_path="rotation_euler", frame=fi + 1)
    ad = arm_ob.animation_data
    if ad and ad.action:
        ad.action.name = "swim"
        try:
            ad.action.use_frame_range = True
            ad.action.frame_start = 1
            ad.action.frame_end = frames + 1
        except Exception:
            pass
    bpy.ops.object.mode_set(mode="OBJECT")

def densify_mesh(ob, levels=1):
    """Subdivide once for HD density while keeping UVs/weights."""
    mod = ob.modifiers.new("hd_subdiv", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    mod.quality = 3
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)

def enhance_body_material(ob):
    """Boost coat/roughness for wet photoreal look on existing PBR textures."""
    for slot in ob.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes: continue
        nt = mat.node_tree
        prin = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not prin: continue
        if "Coat Weight" in prin.inputs:
            prin.inputs["Coat Weight"].default_value = max(prin.inputs["Coat Weight"].default_value, 0.55)
        if "Coat Roughness" in prin.inputs:
            prin.inputs["Coat Roughness"].default_value = 0.12
        if "Roughness" in prin.inputs and not prin.inputs["Roughness"].is_linked:
            prin.inputs["Roughness"].default_value = min(prin.inputs["Roughness"].default_value, 0.35)

def upgrade_fish(variety: str):
    clear_all()
    src = os.path.join(ASSETS, f"koi-{variety}.glb")
    if not os.path.isfile(src):
        raise FileNotFoundError(src)
    bpy.ops.import_scene.gltf(filepath=src)
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and "Icosphere" not in o.name)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    before = mesh_integrity(mesh)
    print(f"[{variety}] before", before)
    if not before["ok_head"]:
        raise RuntimeError(f"{variety}: source mesh fails head integrity: {before}")
    # Ensure head bone exists and is weighted
    if "head" not in [b.name for b in arm.data.bones]:
        raise RuntimeError(f"{variety}: missing head bone")
    enhance_body_material(mesh)
    # Do NOT subdiv-apply on a skinned mesh — it collapses head weights/topology
    # ("headless" koi). Keep the watertight textured source density; HD gain is
    # PBR + improved swim Action.
    after_geo = mesh_integrity(mesh)
    print(f"[{variety}] after enhance", after_geo)
    rewrite_swim(arm)
    # Parent cleanup: keep armature + mesh
    out = os.path.join(ASSETS, f"koi-{variety}-hd.glb")
    export_glb(out)
    # Re-import check
    clear_all()
    bpy.ops.import_scene.gltf(filepath=out)
    mesh2 = next(o for o in bpy.data.objects if o.type == "MESH" and "Icosphere" not in o.name)
    check = mesh_integrity(mesh2)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    bones = [b.name for b in arms[0].data.bones] if arms else []
    anims = [a.name for a in bpy.data.actions]
    imgs = [i.name for i in bpy.data.images if i.name not in ("Render Result", "Viewer Node")]
    print(f"[{variety}] export check", check, "bones", bones, "anims", anims, "images", len(imgs))
    if not check["ok_head"]:
        raise RuntimeError(f"{variety} HD export lost head integrity: {check}")
    if "head" not in bones:
        raise RuntimeError(f"{variety} HD missing head bone after export")
    if "swim" not in anims:
        raise RuntimeError(f"{variety} HD missing swim action")
    if len(imgs) < 1:
        raise RuntimeError(f"{variety} HD lost textures")
    return {"path": out, "integrity": check, "bones": bones, "images": len(imgs), "bytes": os.path.getsize(out)}

# ---------- textured scape ----------
def make_noise_image(name, size, paint_fn):
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            r, g, b = paint_fn(x / size, y / size)
            i = (y * size + x) * 4
            pixels[i:i+4] = [r, g, b, 1.0]
    img.pixels = pixels
    img.pack()
    path = os.path.join(TEX, f"{name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img

def tex_mat(name, img, rough=0.6, coat=0.0, scale=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    prin = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    mapn = nt.nodes.new("ShaderNodeMapping")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapn.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["UV"], mapn.inputs["Vector"])
    nt.links.new(mapn.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], prin.inputs["Base Color"])
    prin.inputs["Roughness"].default_value = rough
    if "Coat Weight" in prin.inputs:
        prin.inputs["Coat Weight"].default_value = coat
    nt.links.new(prin.outputs["BSDF"], out.inputs["Surface"])
    return m

def vc_to_uv_project(ob):
    """Ensure UVs exist (smart project)."""
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

def build_textured_scape():
    clear_all()
    # Procedural-looking but real image textures
    def stone_px(u, v):
        n = math.sin(u*37.1)+math.cos(v*41.3)+math.sin((u+v)*23.7)
        n = 0.5 + 0.5 * math.sin(n)
        base = 0.42 + 0.18 * n
        grit = 0.08 * abs(math.sin(u*90)*math.cos(v*85))
        return (base+grit, base*0.96+grit*0.8, base*0.9)
    def pebble_px(u, v):
        n = abs(math.sin(u*50)+math.cos(v*47))
        c = 0.35 + 0.25 * (n % 1)
        moss = 0.15 if (math.sin(u*17)+math.cos(v*19)) > 1.2 else 0
        return (c*0.9, c*0.75+moss, c*0.55+moss*0.5)
    def pad_px(u, v):
        # radial vein-ish
        dx, dy = u-0.5, v-0.5
        r = math.hypot(dx, dy)
        ang = math.atan2(dy, dx)
        vein = abs(math.sin(ang*8)) * (1-r)
        g = 0.18 + 0.35*(1-r) + 0.1*vein
        return (0.05+0.05*vein, g, 0.08+0.1*vein)
    def petal_px(u, v):
        dx, dy = u-0.5, v-0.5
        r = math.hypot(dx, dy)
        pink = 0.85 - 0.4*r
        return (0.95, 0.45+0.35*pink, 0.55+0.25*pink)
    img_stone = make_noise_image("stone_albedo", 512, stone_px)
    img_peb = make_noise_image("pebble_albedo", 512, pebble_px)
    img_pad = make_noise_image("pad_albedo", 512, pad_px)
    img_petal = make_noise_image("petal_albedo", 512, petal_px)
    M_STONE = tex_mat("stone", img_stone, rough=0.85, scale=2.5)
    M_PEB = tex_mat("pebble", img_peb, rough=0.95, scale=3.0)
    M_PAD = tex_mat("pad", img_pad, rough=0.55, scale=1.0)
    M_PETAL = tex_mat("petal", img_petal, rough=0.35, coat=0.3, scale=1.0)

    # Reuse geometry builders from build_pond via exec of key bits — inline compact scape
    def G(x, y, z):
        return Vector((x, -z, y))

    class Builder:
        def __init__(self):
            self.bm = bmesh.new(); self.uvs = {}
        def v(self, p, uv=(0,0)):
            vv = self.bm.verts.new(p); self.uvs[vv] = uv; return vv
        def f(self, *vs):
            try: return self.bm.faces.new(vs)
            except ValueError: return None
        def flush(self, name, material):
            self.bm.verts.ensure_lookup_table(); self.bm.faces.ensure_lookup_table()
            uv_layer = self.bm.loops.layers.uv.new("UVMap")
            for f in self.bm.faces:
                for loop in f.loops:
                    loop[uv_layer].uv = self.uvs.get(loop.vert, (0.0, 0.0))
            me = bpy.data.meshes.new(name)
            self.bm.to_mesh(me); self.bm.free()
            for p in me.polygons: p.use_smooth = True
            ob = bpy.data.objects.new(name, me)
            ob.data.materials.append(material)
            bpy.context.collection.objects.link(ob)
            return ob

    R = 1.05
    # substrate
    B = Builder(); NU, NV = 64, 24
    rows=[]
    for i in range(NU+1):
        row=[]
        for j in range(NV+1):
            u=i/NU; v=j/NV
            ang=u*math.pi*2; rad=v*R*(0.88+0.10*abs(math.sin(u*math.pi*5)))  # irregular shoreline, not a perfect disc
            x=math.cos(ang)*rad; z=math.sin(ang)*rad
            h=-0.08+0.01*math.sin(x*8)+0.008*math.cos(z*9)
            row.append(B.v(G(x,h,z), (u*3, v*3)))
        rows.append(row)
    for i in range(NU):
        for j in range(NV):
            B.f(rows[i][j], rows[i+1][j], rows[i+1][j+1], rows[i][j+1])
    B.flush("substrate", M_PEB)

    # Natural stone bank — a few shoreline CLUMPS only (never a full circular hoop).
    B = Builder()
    clumps = [
        # (center_angle, spread_rad, count, base_r)
        (0.35, 0.55, 7, 0.95),
        (2.0, 0.45, 6, 1.00),
        (3.6, 0.60, 8, 0.93),
        (5.1, 0.40, 5, 0.98),
    ]
    stone_i = 0
    for cang, spread, count, base_r in clumps:
        for k in range(count):
            ang = cang + (k / max(1, count - 1) - 0.5) * spread
            jitter = 0.04 * math.sin(stone_i * 2.3)
            rad = base_r + jitter + 0.03 * math.cos(k * 1.7)
            rx = 0.06 + 0.05 * abs(math.sin(stone_i * 1.1))
            ry = 0.04 + 0.03 * abs(math.cos(stone_i * 0.8))
            rz = 0.05 + 0.04 * abs(math.sin(stone_i * 1.4))
            seed = 4.2 + stone_i * 0.41
            cx = math.cos(ang) * rad; cz = math.sin(ang) * rad
            bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=2, radius=1.0)
            idx = {}
            for v in bm2.verts:
                d = v.co.normalized()
                n1 = math.sin(d.x * 5 + seed) + math.cos(d.z * 4.2)
                r = 1.0 + 0.22 * math.sin(n1)
                p = Vector((d.x * rx * r, d.y * ry * r, d.z * rz * r))
                if d.y < -0.2: p.y *= 0.4
                y = -0.02 + p.y + ry * 0.4
                idx[v] = B.v(G(cx + p.x, y, cz + p.z), (0.5 + d.x * 0.5, 0.5 + d.z * 0.5))
            for f in bm2.faces:
                B.f(*[idx[v] for v in f.verts])
            bm2.free()
            stone_i += 1
    # Two larger accent boulders (not forming a ring)
    for ang, rad, rx, ry, rz, seed in [
        (0.5, 1.02, 0.13, 0.09, 0.11, 11.0),
        (3.4, 1.00, 0.12, 0.08, 0.10, 14.0),
    ]:
        cx = math.cos(ang) * rad; cz = math.sin(ang) * rad
        bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=3, radius=1.0)
        idx = {}
        for v in bm2.verts:
            d = v.co.normalized()
            n1 = math.sin(d.x * 4 + seed)
            r = 1.0 + 0.25 * math.sin(n1)
            p = Vector((d.x * rx * r, d.y * ry * r, d.z * rz * r))
            if d.y < -0.15: p.y *= 0.45
            y = -0.01 + p.y + ry * 0.35
            idx[v] = B.v(G(cx + p.x, y, cz + p.z), (0.5 + d.x * 0.5, 0.5 + d.z * 0.5))
        for f in bm2.faces:
            B.f(*[idx[v] for v in f.verts])
        bm2.free()
    B.flush("bank-stones", M_STONE)

    # Fountain spout — stacked natural stones (NOT a circular bowl/torus).
    B = Builder()
    for si, (rx, ry, rz, yoff, seed) in enumerate([
        (0.07, 0.05, 0.06, 0.02, 1.1),
        (0.05, 0.06, 0.05, 0.09, 2.2),
        (0.035, 0.05, 0.035, 0.15, 3.3),
    ]):
        bm2 = bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=2, radius=1.0)
        idx = {}
        for v in bm2.verts:
            d = v.co.normalized()
            n1 = math.sin(d.x * 5 + seed)
            r = 1.0 + 0.2 * math.sin(n1)
            p = Vector((d.x * rx * r, d.y * ry * r, d.z * rz * r))
            if d.y < -0.2: p.y *= 0.5
            idx[v] = B.v(G(p.x, yoff + p.y + ry * 0.3, p.z), (0.5 + d.x * 0.5, 0.5 + d.z * 0.5))
        for f in bm2.faces:
            B.f(*[idx[v] for v in f.verts])
        bm2.free()
    B.flush("fountain", M_STONE)

    # rocks
    B = Builder()
    for i,(cx,cz,rx,ry,rz,seed) in enumerate([
        (0.55,0.35,0.14,0.09,0.12,1.3),(-0.62,0.28,0.16,0.11,0.13,2.9),
        (0.22,-0.68,0.12,0.08,0.10,5.1),(-0.35,-0.55,0.10,0.07,0.09,7.7),
        (0.72,-0.15,0.11,0.08,0.10,4.2),
    ]):
        bm2=bmesh.new(); bmesh.ops.create_icosphere(bm2, subdivisions=3, radius=1.0)
        idx={}
        for v in bm2.verts:
            d=v.co.normalized()
            n1=math.sin(d.x*6+seed)+math.cos(d.y*5)
            r=1.0+0.2*math.sin(n1)
            p=Vector((d.x*rx*r, d.y*ry*r, d.z*rz*r))
            if d.y<-0.15: p.y*=0.45
            y=-0.06+p.y+ry*0.35
            idx[v]=B.v(G(cx+p.x,y,cz+p.z), (0.5+d.x*0.5, 0.5+d.z*0.5))
        for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
        bm2.free()
    B.flush("pond-rocks", M_STONE)

    # flowering lilies
    def lily(cx, cz, scale, seed, white=False):
        B = Builder()
        NU,NV=28,8
        rows=[]
        for i in range(NU+1):
            row=[]
            for j in range(NV+1):
                u=i/NU; v=j/NV; ang=u*math.pi*2
                notch=max(0.15, 1.0-0.75*max(0, 1-min(u,1-u)/0.08))
                rad=scale*(0.12+0.18*v)*notch
                x=cx+math.cos(ang)*rad; z=cz+math.sin(ang)*rad
                y=0.012+0.006*math.sin(ang*3+seed)*v
                row.append(B.v(G(x,y,z),(u,v)))
            rows.append(row)
        for i in range(NU):
            for j in range(NV):
                B.f(rows[i][j], rows[i][j+1], rows[i+1][j+1], rows[i+1][j])
        B.flush(f"lily-pad-{seed:.0f}", M_PAD)
        B = Builder()
        for layer,(npet,rad,h,lift) in enumerate([(9,0.05,0.04,0.02),(7,0.032,0.045,0.038),(5,0.018,0.03,0.055)]):
            for p in range(npet):
                ang=p/npet*math.pi*2+layer*0.25+seed
                pts=[]
                for ui in range(6):
                    row=[]
                    for vi in range(4):
                        u=ui/5; vv=(vi/3)-0.5
                        along=rad*scale*2.4*u
                        wide=rad*scale*(0.6*math.sin(math.pi*u))*(1-abs(vv)*0.35)
                        px=cx+math.cos(ang)*along-math.sin(ang)*wide*vv*2
                        pz=cz+math.sin(ang)*along+math.cos(ang)*wide*vv*2
                        py=lift*scale*2+h*scale*2*math.sin(math.pi*u)*(1-abs(vv)*0.4)
                        row.append(B.v(G(px,py,pz),(u,vv+0.5)))
                    pts.append(row)
                for ui in range(5):
                    for vi in range(3):
                        B.f(pts[ui][vi], pts[ui+1][vi], pts[ui+1][vi+1], pts[ui][vi+1])
        # centre
        bm2=bmesh.new(); bmesh.ops.create_uvsphere(bm2,u_segments=12,v_segments=8,radius=scale*0.02)
        idx={}
        for v in bm2.verts:
            idx[v]=B.v(G(cx+v.co.x, 0.05*scale*2+v.co.z+0.02, cz+v.co.y), (0.5+v.co.x*5, 0.5+v.co.y*5))
        for f in bm2.faces: B.f(*[idx[v] for v in f.verts])
        bm2.free()
        B.flush(f"lotus-bloom-{seed:.0f}", M_PETAL)

    for spec in [
        (0.35,0.40,1.05,1.0,False),(-0.42,0.22,0.95,2.0,True),(0.18,-0.48,1.15,3.0,False),
        (-0.28,-0.32,0.9,4.0,True),(0.55,-0.25,0.8,5.0,False),(-0.55,0.05,0.85,6.0,True),
    ]:
        lily(*spec[:4], white=spec[4])

    root = bpy.data.objects.new("koi-pond-scape", None)
    bpy.context.collection.objects.link(root)
    for o in list(bpy.data.objects):
        if o != root and o.parent is None and o.type == "MESH":
            o.parent = root
    out = os.path.join(ASSETS, "koi-pond-scape.glb")
    export_glb(out)
    return {"path": out, "bytes": os.path.getsize(out)}

def main():
    meta = {"fish": {}, "scape": None}
    print("=== textured scape ===")
    meta["scape"] = build_textured_scape()
    for v in ("kohaku", "showa", "ogon"):
        print(f"=== upgrade koi-{v}-hd ===")
        meta["fish"][v] = upgrade_fish(v)
    # Also refresh lily-pads-hd / pond-rocks-hd from scape pieces? keep prior flowering ones
    # Re-export lily + rocks quickly from scape scene is heavy; leave and pack separately if needed
    meta_path = os.path.join(OUT, "blender", "upgrade_koi_hd_meta.json")
    for v, info in meta["fish"].items():
        info["sha256"] = sha256(info["path"])
    meta["scape"]["sha256"] = sha256(meta["scape"]["path"])
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print("META", json.dumps(meta, indent=2))
    if QUIT:
        bpy.ops.wm.quit_blender()

if __name__ == "__main__":
    main()
