import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VIZ_FIXTURE_GOLDEN_LIVE_FAILED,
  VIZ_FIXTURE_IDLE,
} from "../../../plugins/sdk/viz-fixtures";
import { scanPackLintFixture } from "../../../plugins/sdk/pack-lint";
import { StarterSim } from "../../../plugins/sdk/starter/frontend/sim";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const esbuildBin = path.join(repoRoot, "web/node_modules/.bin/esbuild");
const starterTemplate = path.join(repoRoot, "plugins/sdk/starter");
const SHIPPED_PACK_ID = "pack-starter-e2e";

function pythonDepsReady(): boolean {
  try {
    execFileSync("python3", ["-c", "import aiohttp, yaml"], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: repoRoot },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function listPackTsFiles(packRoot: string, rel = ""): string[] {
  const dir = path.join(packRoot, rel);
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listPackTsFiles(packRoot, sub));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts") && !ent.name.endsWith(".test.ts")) {
      out.push(sub);
    }
  }
  return out;
}

function lintStarterAsShippedPack(packRoot: string): ReturnType<typeof scanPackLintFixture> {
  const violations: ReturnType<typeof scanPackLintFixture> = [];
  for (const rel of listPackTsFiles(packRoot)) {
    const repoRel = `plugins/src/${SHIPPED_PACK_ID}/${rel}`;
    const text = readFileSync(path.join(packRoot, rel), "utf8");
    violations.push(...scanPackLintFixture(repoRel, text, SHIPPED_PACK_ID, repoRoot));
  }
  violations.sort((a, b) => (a.file === b.file ? a.rule.localeCompare(b.rule) : a.file.localeCompare(b.file)));
  return violations;
}

function patchPackIds(packHome: string): void {
  const pluginYml = path.join(packHome, "plugin.yml");
  let yml = readFileSync(pluginYml, "utf8");
  yml = yml.replace(/^id:.*$/m, `id: ${SHIPPED_PACK_ID}`);
  writeFileSync(pluginYml, yml);
  const visYml = path.join(packHome, "visualisation.yml");
  let vis = readFileSync(visYml, "utf8");
  vis = vis.replace(/^id:.*$/m, `id: plugin:${SHIPPED_PACK_ID}`);
  writeFileSync(visYml, vis);
}

function stageStarterTree(): { stageRoot: string; packHome: string } {
  const stageRoot = mkdtempSync(path.join(os.tmpdir(), "zoto-starter-pack-"));
  const packHome = path.join(stageRoot, "plugins", "src", SHIPPED_PACK_ID);
  cpSync(starterTemplate, packHome, { recursive: true });
  const testArtifact = path.join(packHome, "frontend/starter.test.ts");
  if (existsSync(testArtifact)) unlinkSync(testArtifact);
  cpSync(path.join(repoRoot, "plugins/sdk"), path.join(stageRoot, "plugins", "sdk"), { recursive: true });
  patchPackIds(packHome);
  return { stageRoot, packHome };
}

function resolveFrontendEntry(packHome: string): string {
  const yml = readFileSync(path.join(packHome, "plugin.yml"), "utf8");
  const feBlock = yml.match(/frontend:\s*\n(?:\s+.+\n)*?\s+entry:\s*(\S+)/);
  const entry = feBlock?.[1] ?? yml.match(/entry:\s*(\S+)/)?.[1] ?? "frontend/index.ts";
  return path.join(packHome, entry);
}

function packCompileAndBundle(zotoHome: string, packSrc: string, stageRoot: string): string {
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
pack_id = ${JSON.stringify(SHIPPED_PACK_ID)}
src = Path(${JSON.stringify(packSrc)})
stage = Path(${JSON.stringify(stageRoot)})
local = paths.plugin_local_dir(create=True)
zip_path = local / f"{pack_id}.zip"
pz.pack_tree(src, zip_path)
runtime = paths.plugin_local_runtime_dir(create=True) / pack_id
if runtime.exists():
    shutil.rmtree(runtime)
pz.unpack_zip(zip_path, runtime)
sdk_src = stage / "plugins" / "sdk"
sdk_dst = paths.plugin_local_dir(create=True) / "sdk"
if sdk_src.is_dir():
    shutil.copytree(sdk_src, sdk_dst, dirs_exist_ok=True)
doc = yaml.safe_load((runtime / "plugin.yml").read_text(encoding="utf-8"))
out = plugins.compile_typescript(doc, runtime / "plugin.yml")
assert out.get("hash"), out
print(runtime)
`;
  const runtime = execFileSync("python3", ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ZOTO_VIZ_HOME: zotoHome, PYTHONPATH: repoRoot },
  }).trim();
  const entry = resolveFrontendEntry(runtime);
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
    ],
    { encoding: "utf8" },
  );
}

describe("pack starter template CI", () => {
  it("is lint-clean as a shipped plugins/src pack (no baseline entry)", () => {
    const { stageRoot, packHome } = stageStarterTree();
    try {
      expect(lintStarterAsShippedPack(packHome)).toEqual([]);
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(esbuildBin) || !pythonDepsReady())(
    "copies to a temp pack, zips, compiles from runtime, and bundles",
    () => {
      const { stageRoot, packHome } = stageStarterTree();
      const zotoHome = mkdtempSync(path.join(os.tmpdir(), "zoto-starter-home-"));
      try {
        const js = packCompileAndBundle(zotoHome, packHome, stageRoot);
        expect(js.length).toBeGreaterThan(64);
        expect(js).not.toMatch(/declare const zoto/);
      } finally {
        rmSync(stageRoot, { recursive: true, force: true });
        rmSync(zotoHome, { recursive: true, force: true });
      }
    },
  );

  it("idle vs idle-failed failure visuals differ (starter sim)", () => {
    const idleSim = new StarterSim({ displayName: "Starter" });
    const failSim = new StarterSim({ displayName: "Starter" });
    const idle = idleSim.advance(VIZ_FIXTURE_IDLE, 1280, 800);
    const failed = failSim.advance(VIZ_FIXTURE_GOLDEN_LIVE_FAILED, 1280, 800);
    expect(idle.smokeLuma).not.toBe(failed.smokeLuma);
    expect(idle.slot0[3]).toBeLessThan(failed.slot0[3]);
  });
});
