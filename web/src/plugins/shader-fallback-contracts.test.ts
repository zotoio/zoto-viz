import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { VIZ_PLUGIN_SDK } from "./viz-sdk";

const webRoot = resolve(import.meta.dirname, "../..");

function runTypecheck(): { status: number | null; out: string } {
  const r = spawnSync("pnpm", ["typecheck"], { cwd: webRoot, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("shader fallback contract typecheck", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("type-shader-pack-contract", () => {
    const { status, out } = runTypecheck();
    expect(status).toBe(0);
    expect(out).not.toContain("shader-fallback-contracts.typecheck.ts");
  });

  it("type-viz-zoto-hooks", () => {
    const { status } = runTypecheck();
    expect(status).toBe(0);
  });

  it("type-nixie-zoto-hooks", () => {
    const src = readFileSync(
      resolve(webRoot, "../plugins/src/nixie-clock/frontend/index.ts"),
      "utf8",
    );
    expect(src.indexOf("VizZotoPluginHooks")).toBeGreaterThan(-1);
  });

  it("type-packet-tunnel-zoto-hooks", () => {
    const src = readFileSync(
      resolve(webRoot, "../plugins/src/packet-tunnel/frontend/index.ts"),
      "utf8",
    );
    expect(src.indexOf("VizZotoPluginHooks")).toBeGreaterThan(-1);
  });
});

describe("viz plugin sdk fragment", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("viz-sdk-on-frame-guard", () => {
    const nested = 'if (d.type === "frame" && vizAllowed("viz.read")) {';
    expect(VIZ_PLUGIN_SDK.indexOf(nested)).toBeGreaterThan(-1);
    expect(VIZ_PLUGIN_SDK.indexOf("if (window.zoto.onFrame) window.zoto.onFrame(d.frame);")).toBeGreaterThan(-1);
    expect(VIZ_PLUGIN_SDK.indexOf('vizAllowed("viz.read") && window.zoto.onFrame')).toBe(-1);
  });
});
