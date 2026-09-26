import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPackMirrorRenderer, expectedRendererNeedle } from "./pack-mirror-renderer-gate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("pack mirror renderer gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("honors ZOTO_VIZ_EXPECT_RENDERER when set", () => {
    vi.stubEnv("ZOTO_VIZ_EXPECT_RENDERER", "swiftshader");
    expect(expectedRendererNeedle()).toBe("swiftshader");
    expect(() => assertPackMirrorRenderer("AMD Radeon")).toThrow();
    assertPackMirrorRenderer("ANGLE SwiftShader Device");
  });

  it("only requires non-empty renderer when ZOTO_VIZ_EXPECT_RENDERER is unset", () => {
    vi.stubEnv("ZOTO_VIZ_EXPECT_RENDERER", "");
    assertPackMirrorRenderer("AMD Radeon Pro");
    expect(() => assertPackMirrorRenderer("")).toThrow();
  });

  it("CI web job exports ZOTO_VIZ_EXPECT_RENDERER for SwiftShader readback", () => {
    const ci = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/ZOTO_VIZ_EXPECT_RENDERER:\s*swiftshader/);
  });
});
