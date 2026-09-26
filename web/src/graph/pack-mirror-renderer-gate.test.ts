import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPackMirrorRenderer, expectedRendererNeedle } from "./pack-mirror-renderer-gate";

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

});
