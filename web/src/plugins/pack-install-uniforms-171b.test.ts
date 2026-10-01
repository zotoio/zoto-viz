/**
 * #171 (b): the install lint blocks a pack on the three blocking uniform rules
 * (`glsl-uniform-undeclared`, `uniform-type-conflict`, `write-uniform-not-in-manifest`) with one plain
 * sentence and the block reason `graphics_code_error` (the service swaps the #185 "run pack lint" tail
 * for "Ask its author for a fixed version." on that reason only). The two warn-only uniform rules
 * (`glsl-uniform-unset`, `uniform-set-undeclared`) never block: their file:line rule lines go to stderr
 * for the service log, and the user sees nothing. Every other refusal keeps its #185 shape (no reason).
 *
 * The verdict rows run the real web/scripts/bundle-pack-entry.mjs (so the committed built lint) on temp
 * fixture packs, the way the service does. The scan-scope row counts the files the install uniform pass
 * reads: exactly the pack's sky GLSL, linted frontend TS and plugin.yml, never the tree around it.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PACK_LINT_PLAIN_SUMMARY } from "../../../plugins/sdk/pack-lint-hints";
import type { PackLintViolation } from "../../../plugins/sdk/pack-lint-types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GRAPHICS_REASON = "graphics_code_error";
/** UX Pro's sentence for "<Name> was blocked because <sentence> …" (the three blocking uniform rules). */
const GRAPHICS = "its graphics code has an error that would stop it drawing.";
const SANDBOX = "it tries to reach outside its sandbox.";
const EXIT_LINT_BLOCK = 1;
const BLOCKING = ["glsl-uniform-undeclared", "uniform-type-conflict", "write-uniform-not-in-manifest"] as const;
const WARN_ONLY = ["glsl-uniform-unset", "uniform-set-undeclared"] as const;

const tmpRoots: string[] = [];
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
}

const VIZ_UTIME = "viz:\n  graphWalk: false\n  idle:\n    mode: calm\n  uniforms: [uTime]\n";
const yml = (id: string, extra = "") =>
  `id: ${id}\nname: Uniform Probe\nversion: 1\nfrontend:\n  entry: frontend/index.ts\n${extra}`;
const WRITES = (name: string) =>
  `export function onFrame(z: { writeUniform(name: string, v: number): void }): void {\n  z.writeUniform("${name}", 1);\n}\n`;
const QUIET_FRONTEND = "export const ready = true;\n";
const SKY_OK = "void main() {\n  fragColor = vec4(uAccent * uBright, uOpacity);\n}\n";

/** One temp pack home named `id` (its plugin.yml id), with `files` on top of a clean frontend. */
function pack(id: string, files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "zv171b-"));
  tmpRoots.push(root);
  const home = path.join(root, id);
  writeTree(home, { "plugin.yml": yml(id), "frontend/index.ts": QUIET_FRONTEND, ...files });
  return home;
}

const FIXTURES = {
  "glsl-uniform-undeclared": {
    "sky/fragment.glsl": "void main() {\n  float g = uGlow;\n  fragColor = vec4(vec3(g), 1.0);\n}\n",
  },
  "uniform-type-conflict": {
    "sky/fragment.glsl": "uniform vec3 uTime;\nvoid main() {\n  fragColor = vec4(uTime, 1.0);\n}\n",
  },
  "write-uniform-not-in-manifest": {
    "plugin.yml": yml("uniform-probe-write-uniform-not-in-manifest", VIZ_UTIME),
    "sky/fragment.glsl": SKY_OK,
    "frontend/index.ts": WRITES("uAudio"),
  },
  "glsl-uniform-unset": {
    "sky/fragment.glsl": "uniform float uGlow;\nvoid main() {\n  fragColor = vec4(vec3(uGlow), 1.0);\n}\n",
  },
  "uniform-set-undeclared": {
    "plugin.yml": yml("uniform-probe-uniform-set-undeclared", VIZ_UTIME),
    "frontend/index.ts": WRITES("uTime"),
  },
} as const;

/** Where each fixture's finding is (pack-relative file:line), and a word the log line must carry. */
const WHERE = {
  "glsl-uniform-undeclared": { at: "sky/fragment.glsl:2", word: "uGlow" },
  "uniform-type-conflict": { at: "sky/fragment.glsl:1", word: "uTime" },
  "write-uniform-not-in-manifest": { at: "frontend/index.ts:2", word: "uAudio" },
  "glsl-uniform-unset": { at: "sky/fragment.glsl:3", word: "uGlow" },
  "uniform-set-undeclared": { at: "frontend/index.ts:2", word: "uTime" },
} as const;

type Run = SpawnSyncReturns<string> & { nonce: string };

/** bundle-pack-entry.mjs on `home` with the install lint on (the service's argv and env). */
function install(home: string, opts: { lintOnly: boolean }): Run {
  const nonce = randomUUID();
  const script = path.join(repoRoot, "web/scripts/bundle-pack-entry.mjs");
  const argv = opts.lintOnly
    ? [script, "--lint-only", home, repoRoot]
    : [script, path.join(home, "frontend/index.ts"), path.join(repoRoot, "plugins/sdk"), home, repoRoot];
  const r = spawnSync(process.execPath, argv, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ZOTO_PACK_INSTALL_LINT: "1", ZOTO_PACK_INSTALL_LINT_NONCE: nonce, NODE_ENV: "production" },
    timeout: 60_000,
  });
  return Object.assign(r, { nonce });
}

function jsonLines(text: string, type: string): Record<string, unknown>[] {
  return text.split(/\r?\n/).flatMap((l) => {
    try {
      const raw: unknown = JSON.parse(l.trim());
      return raw && typeof raw === "object" && Reflect.get(raw, "type") === type ? [{ ...raw }] : [];
    } catch {
      return [];
    }
  });
}

const why = (r: SpawnSyncReturns<string>) => `exit ${r.status} signal ${r.signal}; stderr: ${r.stderr.slice(0, 900)}`;

/** The user text must not carry any of the finding's raw parts (#185: those are for the log). */
function expectPlain(message: string): void {
  for (const raw of [...BLOCKING, ...WARN_ONLY, "uGlow", "uTime", "uAudio", "fragment", "vertex", ".glsl", "plugin.yml", "frontend/", "plugins/"]) {
    expect(message, raw).not.toContain(raw);
  }
  expect(message).not.toMatch(/:\d/);
}

describe("#171 (b) the install lint blocks a pack whose graphics code would stop it drawing", () => {
  it("the three blocking uniform rules share UX Pro's plain sentence", () => {
    for (const rule of BLOCKING) expect(PACK_LINT_PLAIN_SUMMARY[rule], rule).toBe(GRAPHICS);
  });

  for (const rule of BLOCKING) {
    for (const lintOnly of [true, false]) {
      it(`${rule} blocks (${lintOnly ? "unbundled, --lint-only" : "bundled"}) with reason ${GRAPHICS_REASON}`, () => {
        const id = `uniform-probe-${rule}`;
        const r = install(pack(id, FIXTURES[rule]), { lintOnly });
        expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
        const block = jsonLines(r.stderr, "pack-install-lint-block");
        expect(block, why(r)).toHaveLength(1);
        expect(block[0]!.message).toBe(GRAPHICS);
        expect(block[0]!.reason).toBe(GRAPHICS_REASON);
        expectPlain(String(block[0]!.message));
        const details = block[0]!.details;
        expect(Array.isArray(details) ? details : [], why(r)).toHaveLength(1);
        const line = String(Array.isArray(details) ? details[0] : "");
        expect(line.startsWith(`plugins/src/${id}/${WHERE[rule].at} ${rule} — `), line).toBe(true);
        expect(line).toContain(WHERE[rule].word);
        expect(jsonLines(r.stderr, "pack-install-lint-pass")).toEqual([]);
      }, 60_000);
    }
  }
});

describe("#171 (b) warn-only uniform rules never block: the log gets the line, the user nothing", () => {
  for (const rule of WARN_ONLY) {
    it(`${rule} passes, with its file:line rule line on stderr for the service log`, () => {
      const id = `uniform-probe-${rule}`;
      const r = install(pack(id, FIXTURES[rule]), { lintOnly: true });
      expect(r.status, why(r)).toBe(0);
      expect(jsonLines(r.stderr, "pack-install-lint-block"), why(r)).toEqual([]);
      const lines = r.stderr.split(/\r?\n/).filter(Boolean);
      expect(lines.at(-1), why(r)).toBe(JSON.stringify({ type: "pack-install-lint-pass", nonce: r.nonce, pack: id }));
      const warn = lines.filter((l) => l.startsWith(`plugins/src/${id}/${WHERE[rule].at} ${rule} — `));
      expect(warn, why(r)).toHaveLength(1);
      expect(warn[0]).toContain(WHERE[rule].word);
    }, 60_000);
  }
});

describe("#171 (b) other refusals keep their #185 shape (no graphics reason)", () => {
  it("a sandbox escape alone: its own sentence, no reason (so the service keeps the run-pack-lint tail)", () => {
    const id = "uniform-probe-sandbox";
    const r = install(pack(id, { "frontend/index.ts": 'export const db = () => indexedDB.open("x");\n' }), { lintOnly: true });
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    const block = jsonLines(r.stderr, "pack-install-lint-block");
    expect(block, why(r)).toHaveLength(1);
    expect(block[0]!.message).toBe(SANDBOX);
    expect(block[0]).not.toHaveProperty("reason");
  }, 60_000);

  it("a sandbox escape plus a uniform block: both sentences, no graphics reason (the #185 tail applies)", () => {
    const id = "uniform-probe-mixed";
    const r = install(
      pack(id, { ...FIXTURES["glsl-uniform-undeclared"], "frontend/index.ts": 'export const db = () => indexedDB.open("x");\n' }),
      { lintOnly: true },
    );
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    const block = jsonLines(r.stderr, "pack-install-lint-block");
    expect(block, why(r)).toHaveLength(1);
    expect(block[0]!.message).toBe("it tries to reach outside its sandbox. Its graphics code has an error that would stop it drawing.");
    expect(block[0]).not.toHaveProperty("reason");
    const details = block[0]!.details;
    expect((Array.isArray(details) ? details : []).map((d) => String(d).split(" ")[1])).toEqual(["sandbox-escape", "glsl-uniform-undeclared"]);
  }, 60_000);
});

type InstallUniformPass = (packDirAbs: string, repoRoot: string, packId: string) => readonly PackLintViolation[];
const isInstallUniformPass = (f: unknown): f is InstallUniformPass => typeof f === "function";

/** The install lint's uniform pass (`lintInstalledPackUniforms`), or null when the module has none. */
async function installUniformPass(): Promise<InstallUniformPass | null> {
  const mod: object = await import("../../../plugins/sdk/pack-lint-uniforms");
  const fn: unknown = Reflect.get(mod, "lintInstalledPackUniforms");
  return isInstallUniformPass(fn) ? fn : null;
}

/** Every path `fs.readFileSync` / `fs.readdirSync` is called with while `run` runs. */
function countReads(run: () => void): { reads: string[]; dirs: string[] } {
  const reads: string[] = [];
  const dirs: string[] = [];
  const realRead = fs.readFileSync;
  const realDir = fs.readdirSync;
  const r = vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
    reads.push(path.resolve(String(args[0])));
    return realRead(...args);
  });
  const d = vi.spyOn(fs, "readdirSync").mockImplementation((...args: Parameters<typeof fs.readdirSync>) => {
    dirs.push(path.resolve(String(args[0])));
    return realDir(...args);
  });
  try {
    run();
  } finally {
    r.mockRestore();
    d.mockRestore();
  }
  return { reads, dirs };
}

describe("#171 (b) scan scope: the install uniform pass reads the pack, never the tree around it", () => {
  /** A pack inside a tree that has other GLSL, manifests and TS (a decoy pack, a fake web/src). */
  function scopeTree(): { tree: string; home: string; packFiles: string[] } {
    const tree = mkdtempSync(path.join(os.tmpdir(), "zv171b-scope-"));
    tmpRoots.push(tree);
    writeTree(tree, {
      "README.md": "# not a pack\n",
      "notes.txt": "uGlow\n",
      "plugins/src/decoy/plugin.yml": "id: decoy\nname: Decoy\nversion: 1\n",
      "plugins/src/decoy/sky/fragment.glsl": "void main() { fragColor = vec4(uGlow); }\n",
      "plugins/src/decoy/frontend/index.ts": WRITES("uAudio"),
      "other/sky/x.glsl": "void main() { fragColor = vec4(uGlow); }\n",
      "web/src/far.ts": 'export const FAR = "void main() { fragColor = vec4(uGlow); }";\n',
    });
    const id = "scope-probe";
    const home = path.join(tree, "packs", id);
    writeTree(home, {
      "plugin.yml": yml(id, VIZ_UTIME),
      "sky/fragment.glsl": SKY_OK,
      "sky/deep/layer.glsl": "void main() {\n  fragColor = vec4(uBg, uOpacity);\n}\n",
      "frontend/index.ts": WRITES("uTime"),
      // An import out of the pack: the uniform pass must not follow it (the boundary lint refuses it anyway).
      "frontend/util.ts": 'import { FAR } from "../../../web/src/far";\nexport const frag = FAR;\n',
      // Not linted: tests, declarations, docs, assets, GLSL outside sky/.
      "frontend/index.test.ts": WRITES("uGlow"),
      "frontend/types.d.ts": "export type X = number;\n",
      "README.md": "# scope probe\n",
      "assets/sky.glsl.txt": "uGlow\n",
      "notes/extra.glsl": "void main() { fragColor = vec4(uGlow); }\n",
    });
    const packFiles = ["frontend/index.ts", "frontend/util.ts", "plugin.yml", "sky/deep/layer.glsl", "sky/fragment.glsl"].map((r) =>
      path.join(home, r),
    );
    return { tree, home, packFiles };
  }

  it("reads == the pack's shader, frontend and manifest files; nothing outside the pack but the host's uniform contract", async () => {
    const pass = await installUniformPass();
    expect(pass, "pack-lint-uniforms has no install pass (lintInstalledPackUniforms)").not.toBeNull();
    if (!pass) return;
    const { tree, home, packFiles } = scopeTree();
    const inPack = (p: string) => p === home || p.startsWith(home + path.sep);

    // Cold (fresh module): the only reads outside the pack are the host's uniform contract sources
    // (the sky preamble and PLUGIN_SKY_UNIFORMS), read once and cached; never plugins/src or the tree.
    const cold = countReads(() => expect(pass(home, repoRoot, "scope-probe")).toEqual([]));
    const outside = [...new Set(cold.reads.filter((p) => !inPack(p)))];
    for (const p of outside) {
      expect(p.startsWith(path.join(repoRoot, "web/src/plugins") + path.sep), p).toBe(true);
    }
    expect(outside.length).toBeLessThanOrEqual(3);
    expect(cold.reads.filter((p) => p.startsWith(tree + path.sep) && !inPack(p))).toEqual([]);
    expect(cold.reads.filter((p) => p.startsWith(path.join(repoRoot, "plugins/src")))).toEqual([]);
    expect(cold.dirs.filter((p) => !inPack(p))).toEqual([]);

    // Warm: the read count EQUALS the pack's linted files, each read once.
    const warm = countReads(() => expect(pass(home, repoRoot, "scope-probe")).toEqual([]));
    expect(warm.reads.length).toBe(packFiles.length);
    expect([...warm.reads].sort()).toEqual([...packFiles].sort());
    expect(warm.dirs.filter((p) => !inPack(p))).toEqual([]);
  });
});
