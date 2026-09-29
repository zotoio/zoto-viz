import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GraphFabric } from "./fabric";

type FakeShader = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

function compiledFabricShader(): { shader: FakeShader; base: FakeShader } {
  const mat = new GraphFabric().mesh.material as THREE.MeshStandardMaterial;
  const base: FakeShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  const shader: FakeShader = { ...base, uniforms: {} };
  mat.onBeforeCompile(shader as never, {} as never);
  return { shader, base };
}

function namesIn(src: string, re: RegExp): Set<string> {
  return new Set(src.match(re) ?? []);
}

/** Identifiers the fabric material added on top of the stock three.js standard source. */
function injected(src: string, stock: string, re: RegExp): string[] {
  const stockNames = namesIn(stock, re);
  return [...namesIn(src, re)].filter((n) => !stockNames.has(n)).sort();
}

function declares(src: string, qualifier: "uniform" | "varying", name: string): boolean {
  return new RegExp(`^\\s*${qualifier}\\s+(?:(?:highp|mediump|lowp)\\s+)?\\w+\\s+${name}\\s*;`, "m").test(src);
}

/** Names three.js itself declares in its shader chunks (vColor, vUv, ...). */
const THREE_CHUNK_SRC = Object.values(THREE.ShaderChunk).join("\n");

const U_NAME = /\bu[A-Z]\w*/g;
const V_NAME = /\bv[A-Z]\w*/g;

describe("fabric material shader (Graph Cloth / tubes / ribbon)", () => {
  it("declares every custom uniform it sets in onBeforeCompile", () => {
    const { shader } = compiledFabricShader();
    const set = Object.keys(shader.uniforms).sort();
    expect(set.length).toBeGreaterThan(0);
    const undeclared = set.filter(
      (n) => !declares(shader.vertexShader, "uniform", n) && !declares(shader.fragmentShader, "uniform", n),
    );
    expect(undeclared, `uniforms set but never declared: ${undeclared.join(", ")}`).toEqual([]);
  });

  it("declares every custom uniform in the stage that reads it", () => {
    const { shader, base } = compiledFabricShader();
    for (const stage of ["vertexShader", "fragmentShader"] as const) {
      const used = injected(shader[stage], base[stage], U_NAME);
      const undeclared = used.filter((n) => !declares(shader[stage], "uniform", n));
      expect(undeclared, `${stage} reads undeclared uniforms: ${undeclared.join(", ")}`).toEqual([]);
      const unset = used.filter((n) => !(n in shader.uniforms));
      expect(unset, `${stage} reads uniforms onBeforeCompile never sets: ${unset.join(", ")}`).toEqual([]);
    }
  });

  it("declares every fabric varying the fragment reads in both stages", () => {
    const { shader, base } = compiledFabricShader();
    const used = injected(shader.fragmentShader, base.fragmentShader, V_NAME);
    const own = used.filter((n) => !new RegExp(`\\b${n}\\b`).test(THREE_CHUNK_SRC));
    expect(own.length).toBeGreaterThan(0);
    for (const n of own) {
      expect(declares(shader.fragmentShader, "varying", n), `fragment missing varying ${n}`).toBe(true);
      expect(declares(shader.vertexShader, "varying", n), `vertex missing varying ${n}`).toBe(true);
    }
  });
});
