import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { probePluginSkyCompile, wrapPluginSky } from "./plugin-sky-probe";
import {
  countShippedPacksDeclaringSkyShader,
  PINNED_SHIPPED_PACK_SKY_IDS,
  scanShippedPackSkyFragments,
} from "./shipped-pack-sky-scan";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("shipped pack sky fragments (host)", () => {
  const fragments = scanShippedPackSkyFragments(repoRoot);
  const scannedIds = fragments.map((f) => f.packId);

  it("checks every shipped pack that declares a sky shader (count matches catalog inspect)", () => {
    const declared = countShippedPacksDeclaringSkyShader(repoRoot);
    expect(fragments.length).toBe(declared);
    expect(fragments.length).toBe(PINNED_SHIPPED_PACK_SKY_IDS.length);
  });

  it("matches pinned shipped pack sky ids (both directions)", () => {
    const pinned = [...PINNED_SHIPPED_PACK_SKY_IDS].sort();
    const scanned = [...scannedIds].sort();
    const missing = pinned.filter((id) => !scanned.includes(id));
    const extra = scanned.filter((id) => !(PINNED_SHIPPED_PACK_SKY_IDS as readonly string[]).includes(id));
    expect(missing, `missing sky packs from scan: ${missing.join(", ") || "(none)"}`).toEqual([]);
    expect(extra, `unexpected sky packs in scan: ${extra.join(", ") || "(none)"}`).toEqual([]);
    expect(scanned).toEqual(pinned);
  });

  for (const { packId, source } of fragments) {
    it(`wraps and compiles ${packId} sky/fragment.glsl`, () => {
      const wrapped = wrapPluginSky(source);
      expect("error" in wrapped).toBe(false);
      if ("error" in wrapped) return;
      expect(wrapped.frag).toContain("zotoVizSlots");
      const gpuErr = probePluginSkyCompile(wrapped.frag);
      expect(gpuErr).toBeNull();
    });
  }

  function backroomsSource(): string {
    const row = fragments.find((f) => f.packId === "backrooms");
    expect(row?.source, "backrooms must be in shipped sky scan").toBeTruthy();
    return row!.source;
  }

  it("backrooms: rejects non-whitelisted uniform immediately after #version", () => {
    const raw = backroomsSource();
    const broken = `#version 300 es\nuniform float evilUniform;\n${raw}`;
    const wrapped = wrapPluginSky(broken);
    expect("error" in wrapped).toBe(true);
    if (!("error" in wrapped)) return;
    expect(wrapped.error).toContain("evilUniform");
  });

  it("backrooms: rejects non-whitelisted uniform in body (no #version line)", () => {
    const raw = backroomsSource();
    const lines = raw.split("\n");
    const broken = [lines[0], "uniform float evilUniform;", ...lines.slice(1)].join("\n");
    const wrapped = wrapPluginSky(broken);
    expect("error" in wrapped).toBe(true);
  });

  it("backrooms: compile probe fails on undeclared body identifier", () => {
    const raw = backroomsSource();
    const broken = raw.replace(
      /void\s+main\s*\(\s*\)\s*\{/,
      "void main() { float x = zotoUndeclaredCompileBreaker; ",
    );
    const wrapped = wrapPluginSky(broken);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;

    const lose = vi.fn();
    const gl = {
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      createShader: () => ({}),
      shaderSource() {},
      compileShader() {},
      getShaderParameter: () => false,
      getShaderInfoLog: () => "ERROR: undeclared identifier zotoUndeclaredCompileBreaker",
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "webgl2") return gl as never;
      return orig.call(this, type as never);
    } as typeof orig;
    try {
      const gpuErr = probePluginSkyCompile(wrapped.frag);
      expect(gpuErr).not.toBeNull();
      expect(gpuErr).toContain("zotoUndeclaredCompileBreaker");
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});
