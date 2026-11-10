"""Re-import the packed Orrery GLBs and check their meshes (Blender 5.x, run with the GUI visible).

Blender's glTF importer cannot read EXT_meshopt_compression, so decode the shipped files first
(positions keep their packed, dequantised values):

  for f in plugins/src/orrery/assets/*.glb; do gltfpack -i $f -o out/sources/orrery/decoded/$(basename $f) -noq -kn -km; done
  blender --window-geometry 1400 0 1400 900 --python plugins/src/orrery/blender/mesh_integrity_check.py \
      -- --glb-dir out/sources/orrery/decoded --report out/shots/orrery-v2/integrity.json

Per mesh, after welding the glTF seam splits (UV / normal seams duplicate vertices on export):
loose vertices, wire edges, non-manifold edges, degenerate faces (area < 1e-12 m^2), slivers
(area < 1e-9 m^2) and non-finite positions. HD planet UVs must stay inside their atlas cell.
Writes the report and prints ORRERY_INTEGRITY_OK / ORRERY_INTEGRITY_FAILED.
"""
import bpy, bmesh, json, math, os, struct, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB_DIR = os.path.abspath(argv[argv.index("--glb-dir") + 1]) if "--glb-dir" in argv else os.getcwd()
REPORT = os.path.abspath(argv[argv.index("--report") + 1]) if "--report" in argv else None
QUIT = "--keep-open" not in argv
ATLAS_COLS, ATLAS_ROWS = 2, 4


def check_mesh(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
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
    }
    bm.free()
    return row


def base_color_transform(path):
    """(offset, scale) of the first material's baseColorTexture KHR_texture_transform: gltfpack
    stores quantised UVs and dequantises them there; the importer leaves the raw UVs on the mesh."""
    raw = open(path, "rb").read()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20 + jlen])
    for m in doc.get("materials", []):
        tex = (m.get("pbrMetallicRoughness") or {}).get("baseColorTexture") or {}
        tt = (tex.get("extensions") or {}).get("KHR_texture_transform")
        if tt:
            return tuple(tt.get("offset", (0.0, 0.0))), tuple(tt.get("scale", (1.0, 1.0)))
    return (0.0, 0.0), (1.0, 1.0)


def uv_cells(ob, xf):
    """Atlas cells the mesh's UVs fall in (Blender v = 1 - glTF v; glTF v = 0 is the image top)."""
    (ou, ov), (su, sv) = xf
    uv = ob.data.uv_layers.active
    cells = set()
    if not uv:
        return cells
    for d in uv.data:
        u = d.uv[0] * su + ou
        v = (1.0 - d.uv[1]) * sv + ov
        col = min(ATLAS_COLS - 1, max(0, int(u * ATLAS_COLS)))
        row = min(ATLAS_ROWS - 1, max(0, int(v * ATLAS_ROWS)))
        cells.add(row * ATLAS_COLS + col)
    return cells


def main():
    report = {"glbDir": GLB_DIR, "files": {}, "problems": []}
    for name in sorted(os.listdir(GLB_DIR)):
        if not name.endswith(".glb"):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(GLB_DIR, name))
        mine = [o for o in bpy.data.objects if o not in before]
        rows = {}
        for ob in mine:
            if ob.type != "MESH":
                continue
            row = check_mesh(ob)
            key = ob.parent.name if ob.parent and ob.parent.type == "EMPTY" else ob.name
            rows[key.split(".")[0]] = row
            label = f"{name}:{key}"
            if row["loose_verts"] or row["wire_edges"] or row["nonmanifold_edges"] or row["degenerate_faces"] or row["nonfinite"]:
                report["problems"].append(label)
            if name.startswith("orrery-planets-hd"):
                base = key.split(".")[0]
                want = 7 if base == "planet-6-ring" else int(base.split("-")[1]) if base.startswith("planet-") else None
                cells = uv_cells(ob, base_color_transform(os.path.join(GLB_DIR, name)))
                row["atlas_cells"] = sorted(cells)
                if want is not None and cells != {want}:
                    report["problems"].append(f"{label}: uv cells {sorted(cells)} != [{want}]")
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
    print("orrery integrity totals", totals)
    print("ORRERY_INTEGRITY_FAILED" if report["problems"] else "ORRERY_INTEGRITY_OK", report["problems"])
    sys.stdout.flush()


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    print("ORRERY_INTEGRITY_FAILED")
    sys.stdout.flush()
if QUIT:
    bpy.ops.wm.quit_blender()
