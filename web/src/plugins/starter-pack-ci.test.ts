import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { VIZ_FIXTURE_IDLE } from "../../../plugins/sdk/viz-fixtures";
import { formatViolationMessage, scanPackDirectory } from "../../../plugins/sdk/pack-lint";
import { STARTER_TEMPLATE_SIM_CLASS } from "./plugin";
import { StarterSim } from "../../../plugins/sdk/starter/frontend/sim";
import { closePluginSkySmokeBrowser } from "./plugin-sky-smoke-render";
import {
  compileStarterZipPack,
  assertStarterBundleInlinesSdk,
  patchPackIds,
  stageStarterWithFiles,
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
const ciCompileReady = ciDrawReady;

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

  it.skipIf(!ciCompileReady)(
    "zips, compiles through service esbuild with SDK inlined in module.js",
    () => {
      expect.hasAssertions();
      const { stageRoot, packHome } = stageStarterTree(starterTemplate, repoRoot);
      const zotoHome = mkdtempSync(path.join(os.tmpdir(), "zoto-starter-home-"));
      try {
        const { runtimeDir, bundleJs } = compileStarterZipPack(repoRoot, packHome, zotoHome);
        assertStarterBundleInlinesSdk(bundleJs);
        expect(bundleJs).not.toMatch(/\bdeclare\s+const\s+zoto\s*:/);
        expect(bundleJs).toContain("getVizZoto");
        expect(bundleJs).toContain(STARTER_TEMPLATE_SIM_CLASS);
        expect(bundleJs).not.toMatch(/from\s+["']\.\.\/\.\.\//);
        const pluginYml = readFileSync(path.join(runtimeDir, "plugin.yml"), "utf8");
        expect(pluginYml).toContain(`id: ${STARTER_CI_PACK_ID}`);
      } finally {
        rmSync(stageRoot, { recursive: true, force: true });
        rmSync(zotoHome, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!ciCompileReady)(
    "draws: zip → compile → sky → headless WebGL2 smoke (non-black)",
    async () => {
      expect.hasAssertions();
      const { stageRoot, packHome } = stageStarterTree(starterTemplate, repoRoot);
      try {
        const result = await runStarterPackDrawPipeline(repoRoot, packHome);
        expect(result.ok, result.ok ? "" : `${result.stage}: ${result.error}`).toBe(true);
        if (result.ok) {
          console.log(`starter-pack-smoke: ${result.smokeAssertion}`);
          expect(result.smokeAssertion.length).toBeGreaterThan(0);
        }
      } finally {
        rmSync(stageRoot, { recursive: true, force: true });
      }
    },
    15_000,
  );

  const REGRESSION_BAD_VIS = "id: plugin:pack-starter-template\nname: Pack starter\nbase: talkers\n";

  it.skipIf(!ciCompileReady)("regression visualisation.yml missing engine fails visualisation-contract", async () => {
    expect.hasAssertions();
    const badVis = REGRESSION_BAD_VIS;
    const { stageRoot, packHome } = stageStarterWithFiles(starterTemplate, repoRoot, { visualisationYml: badVis });
    try {
      const result = await runStarterPackDrawPipeline(repoRoot, packHome);
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("visualisation-contract");
    } finally {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  });

  const REGRESSION_BAD_FRAG = `void main() {
  vec3 dir = normalize(vDir);
  float bars = 0.0;
  for (int i = 0; i < 4; i++) {
    float h = zotoVizSlots[i / 4][mod(float(i), 4.0)];
    float x = float(i) * 0.22 - 0.33;
    bars += smoothstep(0.02, 0.0, abs(dir.x - x) - 0.04) * h;
  }
  float murk = zotoVizSlots[2][0];
  vec3 col = mix(uBg, uAccent, bars + murk * 0.35);
  col *= uBright;
  fragColor = vec4(col, uOpacity);
}
`;

  it.skipIf(!ciCompileReady)("regression pre-fix shader fails WebGL compile at shader stage", async () => {
    expect.hasAssertions();
    const badFrag = REGRESSION_BAD_FRAG;
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
    expect(failed.slot0[8]).toBeCloseTo(0.85, 5);
    expect(failed.labelMetric).toContain("fail");
  });
});
