"""Marble Run Standard vs HD track check (Blender 5.x, VISIBLE window; quits when done).

  blender --python plugins/src/marble-run/blender/check_track_hd.py -- \
      --out plugins/src/marble-run --report out/shots/04-marble/integrity.json \
      [--hdri out/sources/04-marble/carpentry_shop_02/carpentry_shop_02_1k.hdr] [--render out/shots/04-marble]

Imports assets/marble-track.glb and assets/marble-track-hd.glb (as packed, meshopt) and checks the
HD set is the same track: every Standard node exists in HD, each part's bounds match within the
bevel tolerance, every textured part has UVs, and no vertex is NaN. With --render it also renders
both from the build_track.py preview camera under the HDRI (blender-render-{standard,hd}.png).
"""
from __future__ import annotations

import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name: str, default: str | None) -> str | None:
    return os.path.abspath(argv[argv.index(name) + 1]) if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out", os.path.abspath(os.path.join(HERE, "..")))
REPORT = arg("--report", None)
HDRI = arg("--hdri", None)
RENDER = arg("--render", None)
QUIT = "--keep-open" not in argv
TOL = 0.0045  # metres: bevels round edges inward, never outward


def clear() -> None:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def load(path: str) -> dict[str, dict]:
    """Import a packed GLB; per named node: world bounds, triangles, UV presence, NaN check."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    parts: dict[str, dict] = {}
    for o in new:
        if o.type != "MESH":
            continue
        name = o.parent.name if o.parent and not o.parent.name.startswith("Mesh_") else o.name
        name = name.split(".")[0]
        me = o.data
        me.calc_loop_triangles()
        pts = [o.matrix_world @ v.co for v in me.vertices]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        nan = any(not all(math.isfinite(c) for c in p) for p in pts)
        textured = any(
            n.type == "TEX_IMAGE" for m in me.materials if m and m.node_tree for n in m.node_tree.nodes
        )
        parts[name] = {
            "object": o,
            "lo": lo, "hi": hi, "tris": len(me.loop_triangles), "uv": len(me.uv_layers) > 0,
            "textured": textured, "nan": nan, "material": me.materials[0].name if me.materials else None,
        }
    return parts


def render(parts: dict[str, dict], show: bool, path: str) -> None:
    for p in parts.values():
        p["object"].hide_render = not show
    if show:
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("rendered", path)


def setup_render() -> None:
    sc = bpy.context.scene
    world = sc.world or bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    if HDRI and os.path.exists(HDRI):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(HDRI)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0
    for k, (loc, e) in enumerate((((-1.5, -2.5, 3.2), 160), ((2.5, -2.0, 2.0), 60))):
        ld = bpy.data.lights.new(f"l{k}", "AREA")
        ld.energy = e
        ld.size = 1.5
        lo = bpy.data.objects.new(f"l{k}", ld)
        lo.location = loc
        sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0.1, 0.2, 0.8)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("cam")
    cd.lens = 40
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = (0.25, -4.1, 1.55)
    co.rotation_euler = (Vector((0.1, 0.2, 0.82)) - co.location).to_track_quat("-Z", "Y").to_euler()
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 900
    sc.render.film_transparent = False


def main() -> None:
    clear()
    std = load(os.path.join(OUT, "assets", "marble-track.glb"))
    hd = load(os.path.join(OUT, "assets", "marble-track-hd.glb"))
    problems: list[str] = []
    rows = {}
    for name, s in sorted(std.items()):
        h = hd.get(name)
        if not h:
            problems.append(f"{name}: missing in HD")
            continue
        d_lo = max(abs(a - b) for a, b in zip(s["lo"], h["lo"]))
        d_hi = max(abs(a - b) for a, b in zip(s["hi"], h["hi"]))
        if max(d_lo, d_hi) > TOL:
            problems.append(f"{name}: bounds differ by {max(d_lo, d_hi):.4f} m")
        if h["textured"] and not h["uv"]:
            problems.append(f"{name}: textured without UVs")
        if h["nan"]:
            problems.append(f"{name}: NaN vertex")
        rows[name] = {"standardTris": s["tris"], "hdTris": h["tris"], "boundsDelta": round(max(d_lo, d_hi), 5),
                      "hdMaterial": h["material"], "hdUv": h["uv"]}
    extra = sorted(set(hd) - set(std))
    if extra:
        problems.append(f"HD-only parts {extra}")
    report = {
        "ok": not problems, "problems": problems, "tolerance": TOL,
        "standardTris": sum(p["tris"] for p in std.values()),
        "hdTris": sum(p["tris"] for p in hd.values()),
        "parts": rows,
    }
    print(json.dumps({k: report[k] for k in ("ok", "problems", "standardTris", "hdTris")}))
    if REPORT:
        os.makedirs(os.path.dirname(REPORT), exist_ok=True)
        with open(REPORT, "w") as f:
            json.dump(report, f, indent=1)
    if RENDER:
        setup_render()
        render(hd, False, "")
        render(std, True, os.path.join(RENDER, "blender-render-standard.png"))
        render(std, False, "")
        render(hd, True, os.path.join(RENDER, "blender-render-hd.png"))


try:
    main()
    print("check_track_hd: done")
except BaseException as e:
    import traceback
    traceback.print_exc()
    print("check_track_hd: FAILED", e)
if QUIT:
    bpy.ops.wm.quit_blender()
