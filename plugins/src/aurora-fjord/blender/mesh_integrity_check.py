"""Re-import the packed Aurora Fjord GLBs and check their meshes (Blender 5.x, GUI visible).

Blender's glTF importer cannot read EXT_meshopt_compression, so decode the shipped files first
(positions keep their packed, dequantised values):

  for f in plugins/src/aurora-fjord/assets/*.glb; do
    gltfpack -i $f -o out/sources/aurora-fjord/decoded/$(basename $f) -noq -kn -km; done
  blender --factory-startup --python plugins/src/aurora-fjord/blender/mesh_integrity_check.py \
      -- --glb-dir out/sources/aurora-fjord/decoded --report out/shots/08-plugin-aurora-fjord/integrity.json

Per mesh, after welding the glTF seam splits (UV / normal seams duplicate vertices on export):
loose vertices, wire edges, non-manifold edges, degenerate faces (area < 1e-12 m^2), slivers
(area < 1e-9 m^2) and non-finite positions. The terrain and pine cards are open sheets, so
boundary edges are reported but allowed. Every file must carry its named nodes (terrain; cabins,
pines, boulders and cabin-window-0..7), and nothing may sit more than 0.05 m under the water
except the terrain's shore skirt and the boulders, which are bedded into the shallows (up to
1.5 m). Prints FJORD_INTEGRITY_OK / FJORD_INTEGRITY_FAILED.
"""
import bpy, bmesh, json, math, os, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB_DIR = os.path.abspath(argv[argv.index("--glb-dir") + 1]) if "--glb-dir" in argv else os.getcwd()
REPORT = os.path.abspath(argv[argv.index("--report") + 1]) if "--report" in argv else None
QUIT = "--keep-open" not in argv
WANT = {
    "fjord-terrain": {"terrain"},
    "fjord-shore": {"cabins", "pines", "boulders"} | {f"cabin-window-{k}" for k in range(8)},
}
# deepest point allowed per node (m); the host discards everything below the waterline
UNDERWATER = {"terrain": -math.inf, "boulders": -1.5}


def check_mesh(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    row = {
        "verts": len(bm.verts), "faces": len(bm.faces),
        "loose_verts": sum(1 for v in bm.verts if not v.link_edges),
        "wire_edges": sum(1 for e in bm.edges if e.is_wire),
        "nonmanifold_edges": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary),
        "boundary_edges": sum(1 for e in bm.edges if e.is_boundary),
        "degenerate_faces": sum(1 for f in bm.faces if f.calc_area() < 1e-12),
        "sliver_faces": sum(1 for f in bm.faces if f.calc_area() < 1e-9),
        "nonfinite": sum(1 for v in bm.verts if not all(math.isfinite(c) for c in v.co)),
        # Blender is Z-up after import: glTF y (height above the water) is z here
        "min_height": round(min((v.co.z for v in bm.verts), default=0.0), 3),
    }
    bm.free()
    return row


def main():
    report = {"glbDir": GLB_DIR, "files": {}, "problems": []}
    for name in sorted(os.listdir(GLB_DIR)):
        if not name.endswith(".glb"):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(GLB_DIR, name))
        mine = [o for o in bpy.data.objects if o not in before]
        names = {o.name.split(".")[0] for o in mine}
        base = name[:-4].removesuffix("-hd")
        missing = sorted(WANT.get(base, set()) - names)
        if missing:
            report["problems"].append(f"{name}: missing nodes {missing}")
        rows = {}
        for ob in mine:
            if ob.type != "MESH":
                continue
            row = check_mesh(ob)
            key = (ob.parent.name if ob.parent and ob.parent.type == "EMPTY" else ob.name).split(".")[0]
            rows[key] = row
            label = f"{name}:{key}"
            if row["loose_verts"] or row["wire_edges"] or row["nonmanifold_edges"] or row["degenerate_faces"] or row["nonfinite"]:
                report["problems"].append(label)
            if row["min_height"] < UNDERWATER.get(key, -0.05):
                report["problems"].append(f"{label}: {row['min_height']} m under the water")
        report["files"][name] = rows
        for ob in mine:
            bpy.data.objects.remove(ob, do_unlink=True)
    if REPORT:
        os.makedirs(os.path.dirname(REPORT), exist_ok=True)
        with open(REPORT, "w") as f:
            json.dump(report, f, indent=2, sort_keys=True)
            f.write("\n")
    totals = {k: sum(r[k] for rows in report["files"].values() for r in rows.values())
              for k in ("loose_verts", "wire_edges", "nonmanifold_edges", "degenerate_faces", "sliver_faces", "nonfinite")}
    print("fjord integrity totals", totals)
    print("FJORD_INTEGRITY_FAILED" if report["problems"] else "FJORD_INTEGRITY_OK", report["problems"])
    sys.stdout.flush()


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    print("FJORD_INTEGRITY_FAILED")
    sys.stdout.flush()
if QUIT:
    # quit_blender can hang on GNOME Wayland after an import; leave hard once the report is out
    os._exit(0)
