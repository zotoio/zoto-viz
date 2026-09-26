import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { VIZ_FIXTURE_IDLE } from "../../../plugins/sdk/viz-fixtures";
import { formatViolationMessage, scanPackDirectory } from "../../../plugins/sdk/pack-lint";
import { StarterSim } from "../../../plugins/sdk/starter/frontend/sim";
import { closePluginSkySmokeBrowser } from "./plugin-sky-smoke-render";
import {
  compileStarterZipPack,
  assertStarterBundleInlinesSdk,
  patchPackIds,
  stageStarterWithFiles,
  STARTER_REGRESSION_DIR,
  runStarterPackDrawPipeline,
  STARTER_CI_PACK_ID,
  stageStarterTree,
} from "./starter-pack-pipeline";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const esbuildBin = path.join(repoRoot, "web/node_modules/.bin/esbuild");
const starterTemplate = path.join(repoRoot, "plugins/sdk/starter");

function pythonDepsReady(): boolean {
  try {
    execFileSync("python3", ["-c", "from service import plugins"], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: repoRoot },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function lintStarterAsShippedPack(packRoot: string) {
  return scanPackDirectory(packRoot, repoRoot);
}

function withSysFailed(frame: VizDataFrame, failed: number): VizDataFrame {
  return {
    ...frame,
    sys: { ...(frame.sys ?? {}), failed },
  };
}

const ciDrawReady = existsSync(esbuildBin) && pythonDepsReady();

describe("pack starter template CI", () => {
  afterAll(async () => {
    await closePluginSkySmokeBrowser();
  });

  it("is lint-clean as a shipped plugins/src pack (no baseline entry)", () => {
    const { stageRoot, packHome } = stageStarterTree(starterTemplate, repoRoot);
    try {
      const lintHits = lintStarterAsShippedPack(packHome);
      expect(lintHits.map((v) => formatViolationMessage(v))).toEqual([]);
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!ciDrawReady)(
    "zips, compiles through service esbuild with SDK inlined in module.js",
    () => {
      const { stageRoot, packHome } = stageStarterTree(starterTemplate, repoRoot);
      const zotoHome = mkdtempSync(path.join(os.tmpdir(), "zoto-starter-home-"));
      try {
        const { bundleJs } = compileStarterZipPack(repoRoot, packHome, zotoHome);
        assertStarterBundleInlinesSdk(bundleJs);
        expect(bundleJs.length).toBeGreaterThan(64);
        expect(bundleJs).not.toMatch(/\bdeclare\s+const\s+zoto\s*:/);
        expect(bundleJs).toContain("getVizZoto");
      } finally {
        rmSync(stageRoot, { recursive: true, force: true });
        rmSync(zotoHome, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!ciDrawReady)(
    "draws: zip → compile → sky → headless WebGL2 smoke (non-black)",
    async () => {
      const { stageRoot, packHome } = stageStarterTree(starterTemplate, repoRoot);
      try {
        const result = await runStarterPackDrawPipeline(repoRoot, packHome);
        expect(result.ok, result.ok ? "" : `${result.stage}: ${result.error}`).toBe(true);
        if (result.ok) {
          console.log(`starter-pack-smoke: ${result.smokeAssertion}`);
          expect(result.bundleBytes).toBeGreaterThan(256);
        }
      } finally {
        rmSync(stageRoot, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it.skipIf(!ciDrawReady)("regression visualisation.yml missing engine fails visualisation-contract", async () => {
    const badVis = readFileSync(path.join(repoRoot, STARTER_REGRESSION_DIR, "visualisation.yml"), "utf8");
    const { stageRoot, packHome } = stageStarterWithFiles(starterTemplate, repoRoot, { visualisationYml: badVis });
    try {
      const result = await runStarterPackDrawPipeline(repoRoot, packHome);
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("visualisation-contract");
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!ciDrawReady)("regression pre-fix shader fails WebGL compile at shader stage", async () => {
    const badFrag = readFileSync(path.join(repoRoot, STARTER_REGRESSION_DIR, "sky/fragment.glsl"), "utf8");
    const { stageRoot, packHome } = stageStarterWithFiles(starterTemplate, repoRoot, { fragmentGlsl: badFrag });
    try {
      const result = await runStarterPackDrawPipeline(repoRoot, packHome);
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("shader");
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  });

  it("idle vs idle-failed failure visuals differ (starter sim)", () => {
    const idleFrame = VIZ_FIXTURE_IDLE;
    const failedFrame = withSysFailed(idleFrame, 0.85);
    const idleSim = new StarterSim({ displayName: "Starter" });
    const failSim = new StarterSim({ displayName: "Starter" });
    for (let i = 0; i < 90; i++) {
      const dt = 1 / 60;
      idleSim.advance({ ...idleFrame, t: i * dt, dt }, 1280, 800);
      failSim.advance({ ...failedFrame, t: i * dt, dt }, 1280, 800);
    }
    const idle = idleSim.advance(idleFrame, 1280, 800);
    const failed = failSim.advance(failedFrame, 1280, 800);
    expect(idle.smokeLuma).not.toBe(failed.smokeLuma);
    expect(idle.slot0[8]).toBe(0);
    expect(failed.slot0[8]).toBeGreaterThan(0.8);
    expect(failed.labelMetric).toContain("fail");
  });
});
