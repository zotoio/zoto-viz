/**
 * #180 H1: a pack's own writeUniform values survive the host's per-frame look sync.
 *
 * Rule: a written uTime / uAudio / uAccent / uBg wins over the host's; uOpacity and uBright are
 * host × pack (pack default 1), so a crossfade and the host look still apply. A pack that never
 * writes gets exactly the host's values, as before.
 *
 * Revert row: put `syncPluginLook` back to copying every host value (and `setPluginUniform` back
 * to a plain write) -> the pack-wins and multiply rows go red; the never-writes row stays green.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Backdrop } from "./backdrop";

const FRAG = `
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(mix(uBg, uAccent, 0.5 + 0.5 * dir.y) * uBright * (0.5 + 0.5 * sin(uTime + uAudio)), uOpacity);
}
`;

type Host = { mat: THREE.ShaderMaterial };

function mounted(id = "pack-a"): Backdrop {
  const sky = new Backdrop();
  sky.setViewport(640, 360, 1);
  sky.setKind("plugin");
  expect(sky.setPluginShader({ id, source: FRAG }, () => null)).toBeNull();
  expect(sky.pluginSkyId()).toBe(id);
  return sky;
}

function u(sky: Backdrop): THREE.ShaderMaterial["uniforms"] {
  return (sky.mesh.material as THREE.ShaderMaterial).uniforms;
}

function hostU(sky: Backdrop): THREE.ShaderMaterial["uniforms"] {
  return (sky as unknown as Host).mat.uniforms;
}

function rgb(c: unknown): number[] {
  const k = c as THREE.Color;
  return [k.r, k.g, k.b].map((v) => Math.round(v * 1000) / 1000);
}

/** One host frame's worth of look changes: clock, sliders, theme colours. */
function hostFrame(sky: Backdrop, t: number): void {
  sky.setLook(0.9, 1.2, 0.7);
  sky.setColors(0x3366cc, 0x101820);
  sky.tick(t);
}

describe("#180 H1: pack-written sky uniforms win over the host's look sync", () => {
  it("uTime written by the pack survives a frame (a frozen clock stays frozen)", () => {
    const sky = mounted();
    hostFrame(sky, 1);
    expect(sky.setPluginUniform("uTime", 0)).toBe(true);
    hostFrame(sky, 2);
    hostFrame(sky, 3);
    expect(hostU(sky).uTime.value, "the host clock runs").toBeGreaterThan(0);
    expect(u(sky).uTime.value, "the pack's uTime").toBe(0);
  });

  it("uAudio written by the pack survives a frame", () => {
    const sky = mounted();
    hostFrame(sky, 1);
    expect(sky.setPluginUniform("uAudio", 0.25)).toBe(true);
    hostFrame(sky, 2);
    expect(hostU(sky).uAudio.value).toBe(0.7);
    expect(u(sky).uAudio.value, "the pack's uAudio").toBe(0.25);
  });

  it("uAccent written by the pack survives a frame and a theme colour change", () => {
    const sky = mounted();
    hostFrame(sky, 1);
    expect(sky.setPluginUniform("uAccent", [1, 0.38, 0.06])).toBe(true);
    hostFrame(sky, 2);
    sky.setColors(0x00ff00, 0x000000);
    expect(rgb(u(sky).uAccent.value), "the pack's uAccent").toEqual([1, 0.38, 0.06]);
  });

  it("uBg written by the pack survives a frame and a theme colour change", () => {
    const sky = mounted();
    hostFrame(sky, 1);
    expect(sky.setPluginUniform("uBg", [0.06, 0.03, 0.02])).toBe(true);
    hostFrame(sky, 2);
    sky.setColors(0x00ff00, 0xffffff);
    expect(rgb(u(sky).uBg.value), "the pack's uBg").toEqual([0.06, 0.03, 0.02]);
  });

  it("uOpacity and uBright are host × pack, through a crossfade and a look change", () => {
    const writer = new Backdrop();
    const plain = new Backdrop();
    for (const sky of [writer, plain]) {
      sky.setViewport(640, 360, 1);
      sky.setKind("aurora");
      expect(sky.setPluginShader({ id: "pack-a", source: FRAG }, () => null)).toBeNull();
      sky.tick(0);
      sky.setLook(0.9, 1.2, 0.7);
      sky.setKind("plugin"); // aurora -> pack sky: crossfade starts
      expect(sky.skyMorphing()).toBe(true);
    }
    writer.setPluginUniform("uOpacity", 0.5);
    writer.setPluginUniform("uBright", 0.8);
    for (const t of [0.05, 0.1, 0.2]) {
      for (const sky of [writer, plain]) sky.tick(t);
    }
    expect(writer.skyMorphing(), "still mid-crossfade").toBe(true);
    const mid = u(plain).uOpacity.value as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.9);
    expect(u(writer).uOpacity.value as number).toBeCloseTo(mid * 0.5, 9);
    expect(u(writer).uBright.value as number).toBeCloseTo(1.2 * 0.8, 9);
    for (const sky of [writer, plain]) sky.setLook(0.6, 0.5, 0.7);
    expect(u(writer).uBright.value as number, "host look still applies").toBeCloseTo(0.5 * 0.8, 9);
    for (let t = 0.3; t < 3; t += 0.1) for (const sky of [writer, plain]) sky.tick(t);
    expect(writer.skyMorphing()).toBe(false);
    expect(u(plain).uOpacity.value).toBe(0.6);
    expect(u(writer).uOpacity.value as number).toBeCloseTo(0.6 * 0.5, 9);
  });

  it("a pack that never writes gets exactly the host's values, frame after frame", () => {
    const sky = mounted();
    for (const t of [1, 1.5, 2, 2.5]) {
      hostFrame(sky, t);
      const p = u(sky);
      const h = hostU(sky);
      for (const k of ["uTime", "uOpacity", "uBright", "uAudio"] as const) expect(p[k].value, k).toBe(h[k].value);
      expect(rgb(p.uAccent.value)).toEqual(rgb(h.uAccent.value));
      expect(rgb(p.uBg.value)).toEqual(rgb(h.uBg.value));
    }
  });

  it("another pack bound after a writer does not inherit its writes", () => {
    const sky = mounted("pack-a");
    sky.setPluginUniform("uTime", 0);
    sky.setPluginUniform("uBright", 0.25);
    sky.setPluginUniform("uAccent", [1, 0, 0]);
    expect(sky.setPluginShader({ id: "pack-b", source: FRAG.replace("0.5 + 0.5 * dir.y", "0.5 + 0.4 * dir.y") }, () => null)).toBeNull();
    hostFrame(sky, 4);
    expect(sky.pluginSkyId()).toBe("pack-b");
    expect(u(sky).uTime.value).toBe(hostU(sky).uTime.value);
    expect(u(sky).uBright.value).toBe(hostU(sky).uBright.value);
    expect(rgb(u(sky).uAccent.value)).toEqual(rgb(hostU(sky).uAccent.value));
  });
});
