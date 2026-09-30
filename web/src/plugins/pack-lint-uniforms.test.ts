/**
 * #171 option (b): uniform declaration lint rows. Each rule has a red fixture, a green fixture
 * and a revert proof (switch the rule off and its red fixture lints clean). The real-tree rows
 * pin what the lint sees, the #171 Graph Cloth regression, and the catalog findings.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { formatViolationMessage, type PackLintViolation } from "../../../plugins/sdk/pack-lint";
import {
  CUSTOM_UNIFORM_RE,
  describeUniformPrograms,
  glslUniformDecls,
  hostSkyPreambleDecls,
  lintPackUniforms,
  lintUniformsTs,
  readPackSkyInput,
  scanUniformDeclarations,
  UNIFORM_LINT_RULES,
  type UniformLintOptions,
  type UniformLintRule,
} from "../../../plugins/sdk/pack-lint-uniforms";
import { assertBaselineGuard, loadBaseline } from "../../../plugins/sdk/pack-lint-test-support";
import { wrapPluginSky } from "./plugin-sky-probe";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = "plugins/sdk/uniform-lint-fixtures";

function lintTsFixture(rel: string, opts?: UniformLintOptions): PackLintViolation[] {
  const repoRel = `${FIXTURES}/${rel}`;
  return lintUniformsTs(repoRel, readFileSync(path.join(repoRoot, repoRel), "utf8"), repoRoot, opts);
}

function lintPackFixture(name: string, opts?: UniformLintOptions): PackLintViolation[] {
  const input = readPackSkyInput(path.join(repoRoot, FIXTURES, "packs", name), `plugins/src/${name}`, name);
  return lintPackUniforms(input, repoRoot, opts);
}

const keyed = (vs: PackLintViolation[]) => vs.map(({ file, rule, target }) => ({ file, rule, target }));

type Red = {
  label: string;
  run: (opts?: UniformLintOptions) => PackLintViolation[];
  hits: { file: string; rule: UniformLintRule; target: string }[];
  /** Words the formatted message must name (file, uniform, stage). */
  names: string[];
};

const RED: Red[] = [
  {
    label: "bad/undeclared-read-wrong-stage.ts (vertex reads a fragment-only uniform)",
    run: (o) => lintTsFixture("bad/undeclared-read-wrong-stage.ts", o),
    hits: [{ file: `${FIXTURES}/bad/undeclared-read-wrong-stage.ts`, rule: "glsl-uniform-undeclared", target: "vertex:uWave" }],
    names: ["undeclared-read-wrong-stage.ts", "uWave", "vertex"],
  },
  {
    label: "bad/undeclared-read-onbeforecompile.ts (#171 Graph Cloth shape)",
    run: (o) => lintTsFixture("bad/undeclared-read-onbeforecompile.ts", o),
    hits: [
      { file: `${FIXTURES}/bad/undeclared-read-onbeforecompile.ts`, rule: "glsl-uniform-undeclared", target: "vertex:uEdgeOpacity" },
      { file: `${FIXTURES}/bad/undeclared-read-onbeforecompile.ts`, rule: "uniform-set-undeclared", target: "uEdgeOpacity" },
    ],
    names: ["undeclared-read-onbeforecompile.ts", "uEdgeOpacity", "vertex"],
  },
  {
    label: "packs/bad-undeclared-read (pack sky reads an undeclared uniform)",
    run: (o) => lintPackFixture("bad-undeclared-read", o),
    hits: [{ file: "plugins/src/bad-undeclared-read/sky/fragment.glsl", rule: "glsl-uniform-undeclared", target: "fragment:uWobble" }],
    names: ["plugins/src/bad-undeclared-read/sky/fragment.glsl", "uWobble", "fragment"],
  },
  {
    label: "bad/set-undeclared-material.ts (uniforms: { uGhost })",
    run: (o) => lintTsFixture("bad/set-undeclared-material.ts", o),
    hits: [{ file: `${FIXTURES}/bad/set-undeclared-material.ts`, rule: "uniform-set-undeclared", target: "uGhost" }],
    names: ["set-undeclared-material.ts", "uGhost"],
  },
  {
    label: "bad/set-undeclared-member.ts (this.mat.uniforms.uGhost)",
    run: (o) => lintTsFixture("bad/set-undeclared-member.ts", o),
    hits: [{ file: `${FIXTURES}/bad/set-undeclared-member.ts`, rule: "uniform-set-undeclared", target: "uGhost" }],
    names: ["set-undeclared-member.ts", "uGhost"],
  },
  {
    label: 'bad/set-undeclared-get-uniform-location.ts (getUniformLocation(p, "uGhost"))',
    run: (o) => lintTsFixture("bad/set-undeclared-get-uniform-location.ts", o),
    hits: [{ file: `${FIXTURES}/bad/set-undeclared-get-uniform-location.ts`, rule: "uniform-set-undeclared", target: "uGhost" }],
    names: ["set-undeclared-get-uniform-location.ts", "uGhost"],
  },
  {
    label: 'packs/bad-set-undeclared (writeUniform("uGlow"))',
    run: (o) => lintPackFixture("bad-set-undeclared", o),
    hits: [{ file: "plugins/src/bad-set-undeclared/frontend/index.ts", rule: "uniform-set-undeclared", target: "uGlow" }],
    names: ["plugins/src/bad-set-undeclared/frontend/index.ts", "uGlow"],
  },
  {
    label: "packs/bad-write-no-sky (writeUniform with no sky/*.glsl)",
    run: (o) => lintPackFixture("bad-write-no-sky", o),
    hits: [{ file: "plugins/src/bad-write-no-sky/frontend/index.ts", rule: "uniform-set-undeclared", target: "uAudio" }],
    names: ["plugins/src/bad-write-no-sky/frontend/index.ts", "uAudio"],
  },
  {
    label: "bad/read-unset-material.ts (declared + read uSpeed, never set)",
    run: (o) => lintTsFixture("bad/read-unset-material.ts", o),
    hits: [{ file: `${FIXTURES}/bad/read-unset-material.ts`, rule: "glsl-uniform-unset", target: "fragment:uSpeed" }],
    names: ["read-unset-material.ts", "uSpeed", "fragment"],
  },
  {
    label: "packs/bad-unset-read (pack sky declares uExtra the host never sets)",
    run: (o) => lintPackFixture("bad-unset-read", o),
    hits: [{ file: "plugins/src/bad-unset-read/sky/fragment.glsl", rule: "glsl-uniform-unset", target: "fragment:uExtra" }],
    names: ["plugins/src/bad-unset-read/sky/fragment.glsl", "uExtra", "fragment"],
  },
];

const GREEN: { label: string; run: () => PackLintViolation[] }[] = [
  { label: "good/clean-material.ts", run: () => lintTsFixture("good/clean-material.ts") },
  { label: "good/clean-onbeforecompile.ts (fixed #171 shape)", run: () => lintTsFixture("good/clean-onbeforecompile.ts") },
  { label: "good/clean-raw-gl.ts", run: () => lintTsFixture("good/clean-raw-gl.ts") },
  { label: "good/open-runtime-frag.ts (runtime fragment: no proof, no finding)", run: () => lintTsFixture("good/open-runtime-frag.ts") },
  { label: "good/shared-glsl.ts", run: () => lintTsFixture("good/shared-glsl.ts") },
  { label: "packs/good", run: () => lintPackFixture("good") },
];

describe("uniform declaration lint (#171 b): fixtures", () => {
  for (const red of RED) {
    it(`RED ${red.label}`, () => {
      const hits = red.run();
      expect(keyed(hits)).toEqual(red.hits);
      for (const h of hits) {
        expect(h.line).toBeGreaterThan(0);
        const msg = formatViolationMessage(h);
        expect(msg).toMatch(/:\d+`/);
        for (const n of red.names.filter((w) => h.rule !== "uniform-set-undeclared" || !/^(vertex|fragment)$/.test(w))) {
          expect(msg).toContain(n);
        }
      }
    });

    it(`REVERT ${red.label}: rule(s) off → fixture passes`, () => {
      const rules = new Set(red.hits.map((h) => h.rule));
      expect(red.run({ disabledRules: rules })).toEqual([]);
    });
  }

  for (const green of GREEN) {
    it(`GREEN ${green.label}`, () => {
      expect(green.run()).toEqual([]);
    });
  }

  it("every rule has a red fixture", () => {
    const covered = new Set(RED.flatMap((r) => r.hits.map((h) => h.rule)));
    expect([...covered].sort()).toEqual([...UNIFORM_LINT_RULES].sort());
  });
});

describe("uniform declaration lint (#171 b): assumptions pinned", () => {
  it("three.js ShaderLib / ShaderChunk declare no custom-shaped (u[A-Z]…) uniforms, so the three prefix never supplies one", () => {
    const sources = [
      ...Object.values(THREE.ShaderChunk),
      ...Object.values(THREE.ShaderLib).flatMap((s) => [s.vertexShader, s.fragmentShader]),
    ].join("\n");
    const hits = (sources.match(/\b\w+\b/g) ?? []).filter((w) => CUSTOM_UNIFORM_RE.test(w));
    expect([...new Set(hits)]).toEqual([]);
  });

  it("the statically read host sky preamble matches what wrapPluginSky prepends at runtime", () => {
    const wrapped = wrapPluginSky("void main() { fragColor = vec4(0.0); }");
    if ("error" in wrapped) throw new Error(wrapped.error);
    const runtime = glslUniformDecls(wrapped.frag).map(({ name, type }) => `${type} ${name}`).sort();
    const lint = hostSkyPreambleDecls(repoRoot).map(({ name, type }) => `${type} ${name}`).sort();
    expect(lint).toEqual(runtime);
    expect(lint).toContain("vec4 zotoVizSlots");
    expect(lint).toContain("vec2 uResolution");
  });

  it("the lint sees every host program in web/src/graph (a green catalog is not vacuous)", () => {
    const seen = (rel: string) =>
      describeUniformPrograms(rel, readFileSync(path.join(repoRoot, rel), "utf8"), repoRoot).map(
        (p) => `${p.label}:${p.stages.map((s) => `${s.stage}${s.open ? "(open)" : ""}=${s.reads.length}`).join(",")}`,
      );
    expect(seen("web/src/graph/fabric.ts")).toEqual(["onBeforeCompile:vertex=5,fragment=0"]);
    expect(seen("web/src/graph/edge-sheath.ts")).toEqual(["ShaderMaterial:vertex=0,fragment=5"]);
    expect(seen("web/src/graph/floor.ts")).toEqual(["ShaderMaterial:vertex=0,fragment=10"]);
    expect(seen("web/src/graph/scene.ts")).toEqual(["ShaderMaterial:vertex=0,fragment=5", "onBeforeCompile:vertex=0,fragment=0"]);
    expect(seen("web/src/graph/backdrop.ts")).toEqual([
      "ShaderMaterial:vertex=0,fragment=13",
      "ShaderMaterial:vertex=0,fragment=8",
      "ShaderMaterial:vertex=0,fragment=13",
      "ShaderMaterial:vertex=0,fragment(open)=0",
    ]);
    expect(seen("web/src/plugins/plugin-sky-smoke-render.ts")).toEqual(["getUniformLocation:vertex=0,fragment(open)=0"]);
  });
});

describe("uniform declaration lint (#171 b): real tree", () => {
  const FABRIC = "web/src/graph/fabric.ts";
  const fabricSrc = readFileSync(path.join(repoRoot, FABRIC), "utf8");

  it("#171 regression: Graph Cloth without `uniform float uEdgeOpacity;` fails with file, uniform and stage", () => {
    const decl = "uniform float uEdgeOpacity;\n";
    expect(fabricSrc).toContain(decl);
    const hits = lintUniformsTs(FABRIC, fabricSrc.replace(decl, ""), repoRoot);
    const read = hits.find((h) => h.rule === "glsl-uniform-undeclared");
    expect(read).toMatchObject({ file: FABRIC, target: "vertex:uEdgeOpacity" });
    expect(formatViolationMessage(read!)).toMatch(/web\/src\/graph\/fabric\.ts:\d+.*vertex shader reads undeclared uniform uEdgeOpacity/);
    expect(assertBaselineGuard(hits, loadBaseline(repoRoot)).disallowedUniformUndeclared).toHaveLength(1);
    // Blocks even when someone copies it into the baseline.
    expect(assertBaselineGuard(hits, { violations: hits }).ok).toBe(false);
  });

  it("#171 revert proof: with glsl-uniform-undeclared off, the broken Graph Cloth passes that rule", () => {
    const broken = fabricSrc.replace("uniform float uEdgeOpacity;\n", "");
    const hits = lintUniformsTs(FABRIC, broken, repoRoot, { disabledRules: new Set(["glsl-uniform-undeclared"]) });
    expect(hits.filter((h) => h.rule === "glsl-uniform-undeclared")).toEqual([]);
  });

  it("Graph Cloth as shipped lints clean", () => {
    expect(lintUniformsTs(FABRIC, fabricSrc, repoRoot)).toEqual([]);
  });

  it("catalog: web/src + every plugins/src pack (findings pinned; pack skies and pack writeUniform calls are clean)", () => {
    const found = scanUniformDeclarations(repoRoot);
    expect(keyed(found)).toEqual([
      { file: "web/src/graph/backdrop.ts", rule: "uniform-set-undeclared", target: "uPhoto" },
      { file: "web/src/graph/scene.ts", rule: "uniform-set-undeclared", target: "uResolution" },
    ]);
    expect(found.filter((v) => v.rule === "glsl-uniform-undeclared")).toEqual([]);
    expect(found.filter((v) => v.file.startsWith("plugins/src/"))).toEqual([]);
  });
});
