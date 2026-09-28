import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";
import { wrapPluginSky } from "../graph/backdrop";
import { parseVizContract, VizBufferWriter, type VizPluginContract } from "./viz-host";
import type { VizZoto, VizZotoUniformValue } from "../../../plugins/sdk/viz-zoto";
import {
  assertPluginSkySmokeAnimates,
  assertPluginSkySmokeDraws,
  smokeRenderPluginSky,
  type PluginSkySmokeUniforms,
} from "./plugin-sky-smoke-render";

export const STARTER_CI_PACK_ID = "pack-starter-e2e";

export type StarterPipelineStage =
  | "visualisation-contract"
  | "compile"
  | "shader"
  | "pack-on-frame"
  | "smoke-render";

export type StarterPipelineResult =
  | { ok: true; smokeAssertion: string; bundleBytes: number }
  | { ok: false; stage: StarterPipelineStage; error: string };

export function assertStarterVisualisationContract(packHome: string): string | null {
  const vis = readFileSync(path.join(packHome, "visualisation.yml"), "utf8");
  if (!/^engine:\s*graph/m.test(vis)) return "missing engine: graph";
  if (!/fixture:\s*host/.test(vis)) return "missing idle.fixture: host";
  if (!/backdrop:\s*plugin/.test(vis)) return "missing look.backdrop: plugin";
  return null;
}

export function classifyStarterPipelineFailure(message: string): StarterPipelineStage {
  const msg = message;
  if (msg.includes("smoke") || msg.includes("luma") || msg.includes("variance")) return "smoke-render";
  if (
    msg.includes("shader")
    || /compile|link failed|syntax error|undeclared|no webgl2|no matching|ERROR:\s*0:/i.test(msg)
  ) {
    return "shader";
  }
  return "pack-on-frame";
}

/** Run service.plugins.scan() on a staged plugins/src/<id> tree. */
export function scanStarterPackCatalog(repoRoot: string, stageRoot: string, packId: string): {
  errors: string[];
  pluginIds: string[];
} {
  const script = `
import json, os
from pathlib import Path
from service import plugins

stage = Path(${JSON.stringify(stageRoot)})
home = stage / ".zoto-home"
home.mkdir(exist_ok=True)
os.environ["ZOTO_VIZ_REPO_ROOT"] = str(stage)
os.environ["ZOTO_VIZ_HOME"] = str(home)
os.environ["ZOTO_VIZ_PLUGIN_LOCAL"] = str(home / "plugins" / "local")
plugins.reset_bundles()
scan = plugins.scan(stage)
errors = [e.get("error") or e.get("message") or str(e) for e in scan.get("errors") or []]
ids = [p.get("id") for p in scan.get("plugins") or []]
print(json.dumps({"errors": errors, "pluginIds": ids, "packId": ${JSON.stringify(packId)}}))
`;
  const venvPython = path.join(repoRoot, ".venv/bin/python");
  const python = existsSync(venvPython) ? venvPython : "python3";
  const raw = execFileSync(python, ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: repoRoot },
  }).trim();
  const parsed = JSON.parse(raw) as { errors: string[]; pluginIds: string[] };
  return parsed;
}

export function stageStarterWithFiles(
  starterTemplate: string,
  repoRoot: string,
  overrides: { visualisationYml?: string; fragmentGlsl?: string },
): { stageRoot: string; packHome: string } {
  const staged = stageStarterTree(starterTemplate, repoRoot);
  if (overrides.visualisationYml !== undefined) {
    writeFileSync(path.join(staged.packHome, "visualisation.yml"), overrides.visualisationYml);
  }
  if (overrides.fragmentGlsl !== undefined) {
    writeFileSync(path.join(staged.packHome, "sky/fragment.glsl"), overrides.fragmentGlsl);
  }
  return staged;
}

export function starterContractFromPluginYml(packHome: string): VizPluginContract {
  const yml = readFileSync(path.join(packHome, "plugin.yml"), "utf8");
  const vizBlock = yml.match(/viz:\s*\n([\s\S]*?)(?:\nconfig:|\nfrontend:)/)?.[1] ?? "";
  if (!/graphWalk:\s*false/.test(vizBlock)) throw new Error("starter viz.graphWalk must be false");
  const maxBuffers = Number(vizBlock.match(/maxBuffers:\s*(\d+)/)?.[1] ?? 2);
  const maxBufferFloats = Number(vizBlock.match(/maxBufferFloats:\s*(\d+)/)?.[1] ?? 32);
  const maxParticles = Number(vizBlock.match(/maxParticles:\s*(\d+)/)?.[1] ?? 0);
  const uniforms = [...vizBlock.matchAll(/-\s*(u\w+)/g)].map((m) => m[1]!);
  const contract = parseVizContract({
    graphWalk: false,
    maxBuffers,
    maxBufferFloats,
    maxParticles,
    uniforms,
    idle: { fixture: "host" },
  });
  if (!contract) throw new Error("invalid starter viz contract");
  return contract;
}

export function patchPackIds(packHome: string, packId = STARTER_CI_PACK_ID): void {
  const pluginYml = path.join(packHome, "plugin.yml");
  let yml = readFileSync(pluginYml, "utf8");
  yml = yml.replace(/^id:.*$/m, `id: ${packId}`);
  writeFileSync(pluginYml, yml);
}

export function stageStarterTree(starterTemplate: string, repoRoot: string): { stageRoot: string; packHome: string } {
  const stageRoot = mkdtempSync(path.join(os.tmpdir(), "zoto-starter-pack-"));
  const packHome = path.join(stageRoot, "plugins", "src", STARTER_CI_PACK_ID);
  cpSync(starterTemplate, packHome, { recursive: true });
  const testArtifact = path.join(packHome, "frontend/starter.test.ts");
  if (existsSync(testArtifact)) unlinkSync(testArtifact);
  patchPackIds(packHome);
  return { stageRoot, packHome };
}

export function compileStarterZipPack(
  repoRoot: string,
  packSrc: string,
  zotoHome: string,
): { runtimeDir: string; bundleJs: string } {
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
pack_id = ${JSON.stringify(STARTER_CI_PACK_ID)}
src = Path(${JSON.stringify(packSrc)})
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
got = plugins.bundle_for(pack_id)
assert got, "missing bundle"
bundle_path = runtime / "module.js"
bundle_path.write_bytes(got[1])
print(str(runtime))
`;
  const runtimeDir = execFileSync("python3", ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ZOTO_VIZ_HOME: zotoHome,
      ZOTO_VIZ_PLUGIN_LOCAL: path.join(zotoHome, "plugins", "local"),
      PYTHONPATH: repoRoot,
    },
  }).trim();
  const bundleJs = readFileSync(path.join(runtimeDir, "module.js"), "utf8");
  return { runtimeDir, bundleJs };
}

export function assertStarterBundleInlinesSdk(bundleJs: string): void {
  if (/\bfrom\s+["'](?:\.\.\/)+sdk\//.test(bundleJs)) {
    throw new Error("compiled module.js still imports plugins/sdk at runtime");
  }
  if (!bundleJs.includes("assignTalkerSlots")) {
    throw new Error("compiled module.js does not include bundled assignTalkerSlots");
  }
}

async function runPackOnIdleFrame(
  bundleJs: string,
  contract: VizPluginContract,
): Promise<{ ubo: Float32Array; uniforms: PluginSkySmokeUniforms }> {
  const writer = new VizBufferWriter(contract);
  const skyUniforms: Partial<PluginSkySmokeUniforms> = {
    uTime: 1.2,
    uOpacity: 0.92,
    uBright: 0.85,
    uAudio: 0,
    uAccent: [0.35, 0.75, 1],
    uBg: [0.05, 0.1, 0.22],
  };

  const zoto: VizZoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => ({}),
    writeBuffer: (slot, data) => {
      writer.writeBuffer(slot, data);
    },
    writeUniform: (name, value: VizZotoUniformValue) => {
      writer.writeUniform(name, value);
      if (name === "uBright" && typeof value === "number") skyUniforms.uBright = value;
      if (name === "uOpacity" && typeof value === "number") skyUniforms.uOpacity = value;
      if (name === "uAccent" && Array.isArray(value)) skyUniforms.uAccent = value as [number, number, number];
      if (name === "uBg" && Array.isArray(value)) skyUniforms.uBg = value as [number, number, number];
    },
    writeParticles: () => {},
  };

  (globalThis as unknown as { zoto?: VizZoto }).zoto = zoto;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(bundleJs, "utf8").toString("base64")}`;
  await import(dataUrl);
  const frame: VizDataFrame = buildIdleVizFrame(2, 1 / 60);
  if (!zoto.onFrame) throw new Error("pack did not register onFrame");
  zoto.onFrame(frame);

  return {
    ubo: writer.ubo,
    uniforms: skyUniforms as PluginSkySmokeUniforms,
  };
}

export async function runStarterPackDrawPipeline(
  repoRoot: string,
  packHome: string,
): Promise<StarterPipelineResult> {
  const vizErr = assertStarterVisualisationContract(packHome);
  if (vizErr) return { ok: false, stage: "visualisation-contract", error: vizErr };

  const zotoHome = mkdtempSync(path.join(os.tmpdir(), "zoto-starter-home-"));
  try {
    let runtimeDir: string;
    let bundleJs: string;
    try {
      const compiled = compileStarterZipPack(repoRoot, packHome, zotoHome);
      runtimeDir = compiled.runtimeDir;
      bundleJs = compiled.bundleJs;
      assertStarterBundleInlinesSdk(bundleJs);
    } catch (e) {
      return { ok: false, stage: "compile", error: e instanceof Error ? e.message : String(e) };
    }

    const rawFrag = readFileSync(path.join(runtimeDir, "sky", "fragment.glsl"), "utf8");
    const wrapped = wrapPluginSky(rawFrag);
    if ("error" in wrapped) {
      return { ok: false, stage: "shader", error: wrapped.error };
    }

    const contract = starterContractFromPluginYml(packHome);
    let ubo: Float32Array;
    let uniforms: PluginSkySmokeUniforms;
    try {
      const ran = await runPackOnIdleFrame(bundleJs, contract);
      ubo = ran.ubo;
      uniforms = ran.uniforms;
      const smokeA = await smokeRenderPluginSky(wrapped.frag, ubo, { ...uniforms, uTime: 0.2 });
      const smokeB = await smokeRenderPluginSky(wrapped.frag, ubo, { ...uniforms, uTime: 2.7 });
      assertPluginSkySmokeDraws(smokeA);
      assertPluginSkySmokeDraws(smokeB);
      assertPluginSkySmokeAnimates(smokeA, smokeB);
      return {
        ok: true,
        smokeAssertion: `${smokeA.assertion} | animate: ${smokeA.pixelChecksum}→${smokeB.pixelChecksum}`,
        bundleBytes: bundleJs.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, stage: classifyStarterPipelineFailure(msg), error: msg };
    }
  } finally {
    rmSync(zotoHome, { recursive: true, force: true });
  }
}

export function listPackTsFiles(packRoot: string, rel = ""): string[] {
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
