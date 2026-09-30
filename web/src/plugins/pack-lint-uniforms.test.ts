/**
 * #171 option (b): uniform declaration lint rows. Each rule has a red fixture, a green fixture
 * and a revert proof (switch the rule off and its red fixture lints clean). The real-tree rows
 * pin what the lint sees, the #171 Graph Cloth regression, and the catalog findings.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import yaml from "yaml";
import { formatViolationMessage, listPackIds, type PackLintViolation } from "../../../plugins/sdk/pack-lint";
import {
  CUSTOM_UNIFORM_RE,
  describeUniformPrograms,
  glslUniformDecls,
  hostSkyPreambleDecls,
  lintPackUniforms,
  lintUniformsTs,
  manifestVizUniforms,
  pluginSkyUniformNames,
  readPackSkyInput,
  scanUniformTree,
  UNIFORM_LINT_RULES,
  type UniformLintOptions,
  type UniformLintRule,
  type UniformTreeScan,
} from "../../../plugins/sdk/pack-lint-uniforms";
import { assertBaselineGuard, fullTreeScanCount, loadBaseline } from "../../../plugins/sdk/pack-lint-test-support";
import { UNIFORM_BLOCKING_RULES } from "../../../plugins/sdk/pack-lint-types";
import { wrapPluginSky } from "./plugin-sky-probe";
import { PLUGIN_SKY_UNIFORMS } from "./plugin-sky-uniforms";
import { parseVizContractResult } from "./viz-host";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = "plugins/sdk/uniform-lint-fixtures";
const packsRoot = path.join(repoRoot, "plugins/src");

/** The shipped pack ids, as pinned for the service catalog (tests/shipped_catalog.py, 73 today). */
function pinnedShippedPackIds(): string[] {
  const py = readFileSync(path.join(repoRoot, "tests/shipped_catalog.py"), "utf8");
  const body = py.match(/PINNED_SHIPPED_PLUGIN_IDS[^=]*=\s*\(([\s\S]*?)\)/)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
}

/**
 * The one full-tree scan in this file (web/src + every plugins/src pack). It takes a second or two,
 * more under load, so it runs once here with its own explicit timeout; the catalog, coverage and
 * manifest rows read the result. Fixture and single-file rows keep their own small lints. The last
 * row pins exactly one full-tree scan per file.
 */
const FULL_TREE_SCAN_TIMEOUT_MS = 30_000;
let tree: UniformTreeScan = { violations: [], packs: [] };

beforeAll(() => {
  const t0 = performance.now();
  tree = scanUniformTree(repoRoot);
  console.info(`uniform lint full-tree scan: ${Math.round(performance.now() - t0)} ms`);
}, FULL_TREE_SCAN_TIMEOUT_MS);

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
  {
    label: "packs/bad-type-conflict (sky redeclares host float uTime / vec2 uResolution as vec3)",
    run: (o) => lintPackFixture("bad-type-conflict", o),
    hits: [
      { file: "plugins/src/bad-type-conflict/sky/fragment.glsl", rule: "uniform-type-conflict", target: "fragment:uResolution" },
      { file: "plugins/src/bad-type-conflict/sky/fragment.glsl", rule: "uniform-type-conflict", target: "fragment:uTime" },
    ],
    names: ["plugins/src/bad-type-conflict/sky/fragment.glsl", "fragment", "pack bad-type-conflict", "vec3", "host sky preamble"],
  },
  {
    label: 'packs/bad-write-not-in-manifest (writeUniform("uAccent"), viz.uniforms [uTime, uBright])',
    run: (o) => lintPackFixture("bad-write-not-in-manifest", o),
    hits: [
      { file: "plugins/src/bad-write-not-in-manifest/frontend/index.ts", rule: "write-uniform-not-in-manifest", target: "uAccent" },
    ],
    names: [
      "plugins/src/bad-write-not-in-manifest/frontend/index.ts",
      "uAccent",
      "pack bad-write-not-in-manifest",
      "plugins/src/bad-write-not-in-manifest/plugin.yml viz.uniforms",
      "drops",
    ],
  },
];

const GREEN: { label: string; run: () => PackLintViolation[] }[] = [
  { label: "good/clean-material.ts", run: () => lintTsFixture("good/clean-material.ts") },
  { label: "good/clean-onbeforecompile.ts (fixed #171 shape)", run: () => lintTsFixture("good/clean-onbeforecompile.ts") },
  { label: "good/clean-raw-gl.ts", run: () => lintTsFixture("good/clean-raw-gl.ts") },
  { label: "good/open-runtime-frag.ts (runtime fragment: no proof, no finding)", run: () => lintTsFixture("good/open-runtime-frag.ts") },
  { label: "good/shared-glsl.ts", run: () => lintTsFixture("good/shared-glsl.ts") },
  { label: "packs/good (viz.uniforms lists every uniform it writes)", run: () => lintPackFixture("good") },
  { label: "packs/good-manifest-default (no viz.uniforms list: host default)", run: () => lintPackFixture("good-manifest-default") },
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
        expect(msg).toContain(h.target.split(":").pop()!);
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

  it("blocking policy: undeclared read, type conflict and writeUniform outside viz.uniforms block; the rest are baseline-able", () => {
    expect([...UNIFORM_BLOCKING_RULES].sort()).toEqual(["glsl-uniform-undeclared", "uniform-type-conflict", "write-uniform-not-in-manifest"]);
    expect(UNIFORM_LINT_RULES.filter((r) => !UNIFORM_BLOCKING_RULES.has(r)).sort()).toEqual(["glsl-uniform-unset", "uniform-set-undeclared"]);
    expect(loadBaseline(repoRoot).violations.filter((v) => UNIFORM_BLOCKING_RULES.has(v.rule))).toEqual([]);
  });

  for (const [rule, fixture] of [
    ["uniform-type-conflict", "bad-type-conflict"],
    ["write-uniform-not-in-manifest", "bad-write-not-in-manifest"],
  ] as const) {
    it(`BLOCK ${rule}: fails the guard and still fails when copied into the baseline`, () => {
      const hits = lintPackFixture(fixture);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.rule === rule)).toBe(true);
      const guard = assertBaselineGuard(hits, loadBaseline(repoRoot));
      expect(guard.disallowedUniformBlocking).toEqual(hits);
      expect(guard.newViolations).toEqual([]);
      expect(assertBaselineGuard(hits, { violations: hits }).ok).toBe(false);
    });
  }
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

  it("wrapPluginSky accepts the type-conflict fixture, so only a GPU compile (or this lint) catches it", () => {
    const raw = readFileSync(path.join(repoRoot, FIXTURES, "packs/bad-type-conflict/sky/fragment.glsl"), "utf8");
    const wrapped = wrapPluginSky(raw);
    if ("error" in wrapped) throw new Error(`expected wrapPluginSky to accept the fixture, got ${wrapped.error}`);
    const decls = glslUniformDecls(wrapped.frag).map(({ name, type }) => `${type} ${name}`);
    // vec3 uTime was stripped (host float remains, body uses .x); vec3 uResolution was not (redeclared).
    expect(decls.filter((d) => d.endsWith(" uTime"))).toEqual(["float uTime"]);
    expect(decls.filter((d) => d.endsWith(" uResolution"))).toEqual(["vec2 uResolution", "vec3 uResolution"]);
  });

  it("the statically read PLUGIN_SKY_UNIFORMS matches the host whitelist", () => {
    expect(pluginSkyUniformNames(repoRoot)).toEqual([...PLUGIN_SKY_UNIFORMS]);
  });

  it("manifestVizUniforms matches the host parser (parseVizContractResult) for every shipped pack and edge forms", () => {
    const host = (text: string): string[] => {
      const doc = yaml.parse(text) as { viz?: unknown } | null;
      const r = parseVizContractResult(doc?.viz);
      return r && r.state === "ready" ? [...r.contract.uniforms] : [];
    };
    const packs = listPackIds(packsRoot);
    expect(packs).toEqual(pinnedShippedPackIds());
    // The shared scan walked exactly this list (no dot-folder cache, no missing pack).
    expect(tree.packs.map((p) => p.packId)).toEqual(packs);
    const manifests = tree.packs.flatMap((p) => (p.manifest ? [p.manifest] : []));
    expect(manifests.map((m) => m.repoRel)).toEqual(packs.map((p) => `plugins/src/${p}/plugin.yml`));
    const texts = [
      ...manifests.map((m) => m.text),
      ...["bad-write-not-in-manifest", "good", "good-manifest-default"].map((p) =>
        readFileSync(path.join(repoRoot, FIXTURES, "packs", p, "plugin.yml"), "utf8"),
      ),
      "id: x\n",
      "id: x\nviz:\n  graphWalk: true\n  idle:\n    fixture: host\n",
      "id: x\nviz:\n  graphWalk: false\n  uniforms: [uTime, uResolution, 'uBg']\n  idle:\n    fixture: host\n",
      "id: x\nviz:\n  graphWalk: false\n  uniforms: []\n  idle:\n    fixture: host\n",
      "id: x\nviz:\n  graphWalk: false\n  uniforms:\n  - uBg\n  - uOpacity\n  idle:\n    fixture: host\n",
      "id: x\nviz:\n  graphWalk: false\n  uniforms:\n  idle:\n    fixture: host\n",
      "id: x\nviz:\n  graphWalk: false\n  uniforms:\n    - uAudio # comment\n    - \"uBright\"\n  idle:\n    fixture: host\nfrontend:\n  entry: a.ts\n",
    ];
    for (const text of texts) expect(manifestVizUniforms(text, repoRoot).uniforms, text).toEqual(host(text));
  });

  it("the pack folder list skips dot-folders: a .pack-sdk/ cache (or any dot-folder) holding a plugin.yml is not a pack", () => {
    // A temp mirror of plugins/src (every directory entry, dot-folders included, with its plugin.yml),
    // plus the gitignored runtime cache the service catalog scan and pack-bundle-install.test.ts write.
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pack-lint-dot-folders-"));
    try {
      for (const e of readdirSync(packsRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        mkdirSync(path.join(tmp, e.name));
        const yml = path.join(packsRoot, e.name, "plugin.yml");
        if (existsSync(yml)) writeFileSync(path.join(tmp, e.name, "plugin.yml"), readFileSync(yml));
      }
      for (const dot of [".pack-sdk", ".dot-folder-probe"]) {
        mkdirSync(path.join(tmp, dot), { recursive: true });
        writeFileSync(path.join(tmp, dot, "plugin.yml"), `id: ${dot.slice(1)}\nviz:\n  uniforms: [uTime]\n`);
        writeFileSync(path.join(tmp, dot, "air-bt.json"), "{}\n");
      }
      const listed = listPackIds(tmp);
      expect(listed.filter((p) => p.startsWith("."))).toEqual([]);
      expect(listed).toEqual(pinnedShippedPackIds());
      expect(listed).toHaveLength(73);
      expect(listed.every((p) => existsSync(path.join(tmp, p, "plugin.yml")))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
    expect(assertBaselineGuard(hits, loadBaseline(repoRoot)).disallowedUniformBlocking).toHaveLength(1);
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
    const found = tree.violations;
    expect(keyed(found)).toEqual([
      { file: "web/src/graph/backdrop.ts", rule: "uniform-set-undeclared", target: "uPhoto" },
    ]);
    expect(found.filter((v) => v.rule === "glsl-uniform-undeclared")).toEqual([]);
    expect(found.filter((v) => v.rule === "uniform-type-conflict")).toEqual([]);
    expect(found.filter((v) => v.rule === "write-uniform-not-in-manifest")).toEqual([]);
    expect(found.filter((v) => v.file.startsWith("plugins/src/"))).toEqual([]);
  });

  it("catalog coverage: the pack rules had real input (preamble redeclarations type-checked, writeUniform calls checked against manifests)", () => {
    const preamble = new Set(hostSkyPreambleDecls(repoRoot).map((d) => d.name));
    let redeclared = 0;
    let writes = 0;
    let manifests = 0;
    expect(tree.packs.length).toBeGreaterThan(0);
    for (const input of tree.packs) {
      if (input.manifest) manifests++;
      for (const sky of input.skies) redeclared += glslUniformDecls(sky.glsl).filter((d) => preamble.has(d.name)).length;
      for (const fe of input.frontend) writes += fe.text.match(/\bwriteUniform\s*\(\s*["']/g)?.length ?? 0;
    }
    expect(manifests).toBeGreaterThan(0);
    expect(redeclared).toBeGreaterThan(0);
    expect(writes).toBeGreaterThan(0);
    console.info(`uniform lint coverage: ${manifests} manifests, ${redeclared} preamble redeclarations, ${writes} literal writeUniform calls`);
  });
});

// Keep this block last: it counts every full-tree scan the rows above ran.
describe("uniform declaration lint (#171 b): scan budget", () => {
  it("runs exactly one full-tree scan (the shared beforeAll); no row re-scans the tree on its own", () => {
    expect(tree.packs.length).toBeGreaterThan(0);
    expect(fullTreeScanCount()).toBe(1);
  });
});
