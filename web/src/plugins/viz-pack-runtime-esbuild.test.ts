import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const esbuildBin = path.join(repoRoot, "web/node_modules/.bin/esbuild");

/** Packs migrated to `import type` from `plugins/sdk/viz-contract` (viz.read frontends). */
const MIGRATED_VIZ_PACKS = [
  "blob-mesh",
  "cypher-cic",
  "hn-rain",
  "hn-term",
  "kefrens-bars",
  "nixie-clock",
  "packet-tunnel",
  "rf-constellation",
  "roto-proto",
  "star-sines",
  "syscon",
  "talker-storm",
] as const;

function resolveFrontendEntry(packHome: string): string {
  const yml = readFileSync(path.join(packHome, "plugin.yml"), "utf8");
  const feBlock = yml.match(/frontend:\s*\n(?:\s+.+\n)*?\s+entry:\s*(\S+)/);
  const entry = feBlock?.[1] ?? yml.match(/entry:\s*(\S+)/)?.[1] ?? "frontend/index.ts";
  return path.join(packHome, entry);
}

function esbuildPackFromHome(packHome: string): string {
  const entry = resolveFrontendEntry(packHome);
  expect(existsSync(entry)).toBe(true);
  return execFileSync(
    esbuildBin,
    [
      entry,
      "--bundle",
      "--format=esm",
      "--platform=browser",
      "--target=es2022",
      "--external:three",
      "--external:d3-force-3d",
      "--external:../../../sdk/viz-zoto",
      "--external:../../../sdk/viz-pack-host",
    ],
    { encoding: "utf8" },
  );
}

function stageLocalRuntimePack(packId: string, zotoHome: string): string {
  const runtimeHome = path.join(zotoHome, "plugins", "local", ".runtime", packId);
  mkdirSync(path.dirname(runtimeHome), { recursive: true });
  cpSync(path.join(repoRoot, "plugins/src", packId), runtimeHome, { recursive: true });
  return runtimeHome;
}

describe("viz pack runtime esbuild", () => {
  it.skipIf(!existsSync(esbuildBin))("bundles every migrated pack from local .runtime layout", () => {
    const zotoHome = mkdtempSync(path.join(os.tmpdir(), "zoto-viz-home-"));
    try {
      for (const packId of MIGRATED_VIZ_PACKS) {
        const home = stageLocalRuntimePack(packId, zotoHome);
        const js = esbuildPackFromHome(home);
        expect(js.length).toBeGreaterThan(32);
        expect(js).not.toMatch(/viz-contract/);
      }
    } finally {
      rmSync(zotoHome, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(esbuildBin))("bundles cypher-cic and syscon from zip-unpacked local runtime", () => {
    const zotoHome = mkdtempSync(path.join(os.tmpdir(), "zoto-viz-zip-"));
    try {
      for (const packId of ["cypher-cic", "syscon"] as const) {
        const script = `
import shutil, sys, yaml
from pathlib import Path
from service import plugin_zip as pz
from service import plugins
from service import paths

home = Path(${JSON.stringify(zotoHome)})
import os
os.environ["ZOTO_VIZ_HOME"] = str(home)
plugins.reset_bundles()
pack_id = ${JSON.stringify(packId)}
src = Path(${JSON.stringify(repoRoot)}) / "plugins/src" / pack_id
local = paths.plugin_local_dir(create=True)
zip_path = local / f"{pack_id}.zip"
pz.pack_tree(src, zip_path)
runtime = paths.plugin_local_runtime_dir(create=True) / pack_id
if runtime.exists():
    shutil.rmtree(runtime)
pz.unpack_zip(zip_path, runtime)
doc = yaml.safe_load((runtime / "plugin.yml").read_text(encoding="utf-8"))
out = plugins.compile_typescript(doc, runtime / "plugin.yml")
assert out.get("hash"), out
`;
        execFileSync("python3", ["-c", script], {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, ZOTO_VIZ_HOME: zotoHome, PYTHONPATH: repoRoot },
        });
      }
    } finally {
      rmSync(zotoHome, { recursive: true, force: true });
    }
  });
});
