/**
 * #184 R3: every SDK write API has a production consumer, or is @deprecated on every typed SDK surface.
 *
 * R1 pins writeParticles by name. This row is generic: the write-API list is read from the SDK surfaces
 * themselves (every `write*` member of the pack-facing `zoto` API), so a write API added later without
 * a consumer turns the row red too.
 *
 * A consumer is the host path that reads what the API stores and gets it on screen:
 *  - a production HANDOFF site in web/src (tests and test-support excluded) that passes the stored
 *    data on, and
 *  - every HOP after it (NetScene -> Backdrop) still applying it to the sky shader.
 * An API with no probe below (a new one) has no consumer until someone adds one here.
 *
 *  writeBuffer    -> slot storage (views of `writer.ubo`, or `writer.snapshot(slot)`) handed to
 *                    setPluginUboBuffer / broadcastPluginUbo; Backdrop copies it into the plugin UBO.
 *  writeUniform   -> an ok `writeUniform` (or batch `onUniform`) feeding setPluginUniform; Backdrop sets
 *                    the shader uniform.
 *  writeParticles -> `writer.particleSnapshot()`: no production reader (R1), so it must be @deprecated.
 *
 * Revert rows: Backdrop.setPluginUboBuffer no longer reads `buf` -> writeBuffer red; the `.ubo` handoffs
 * renamed away -> writeBuffer red; Backdrop.setPluginUniform no longer sets `u.value` -> writeUniform
 * red; the setPluginUniform handoffs renamed away -> writeUniform red; `@deprecated` dropped from one
 * SDK surface -> writeParticles red; a fake `writeMesh` added to VizZoto -> sanity row and writeMesh red.
 *
 * Static source reads only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const CODE = /\.(ts|js|mjs|cjs)$/;
const NOT_PRODUCTION = /(\.test\.|\.spec\.|\.d\.ts$|[\\/](test|test-support|__tests__|node_modules|dist)[\\/])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.test(name) && !NOT_PRODUCTION.test(p)) out.push(p);
  }
  return out;
}

/** Source with comments blanked (line numbers kept), so prose that names an API is not a use of it. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
}

const rel = (p: string) => relative(REPO, p).split(sep).join("/");
const read = (repoRel: string) => readFileSync(join(REPO, repoRel), "utf8");

/** [start, end] 0-based line range of the block opened on the first line matching `sig`, by brace depth. */
function blockLines(lines: string[], sig: RegExp, what: string): [number, number] {
  const start = lines.findIndex((l) => sig.test(l));
  if (start < 0) throw new Error(`${what}: no line matches ${sig}`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === "{") { depth++; opened = true; }
      else if (ch === "}") depth--;
    }
    if (opened && depth === 0) return [start, i];
  }
  throw new Error(`${what}: unclosed block ${sig}`);
}

/**
 * The pack-facing `zoto` write surfaces (block: the declaration to read; null = the whole file). `typed` ones are what pack code type-checks against, so that is
 * where `@deprecated` reaches a pack author; the other two are the inline JS the sandbox actually runs.
 */
const MEMBER = /^\s*(write[A-Z]\w*)\??\s*[:(]/;
const SDK_SURFACES = [
  { file: "plugins/sdk/viz-zoto.ts", block: /^export interface VizZoto\b/, member: MEMBER, typed: true },
  { file: "plugins/sdk/plugin-sandbox.ts", block: /^export interface ZotoVizPluginHost\b/, member: MEMBER, typed: true },
  { file: "web/src/plugins/sandbox-frame.ts", block: /^export type SandboxZoto\b/, member: MEMBER, typed: true },
  { file: "web/src/plugins/sdk.ts", block: /^window\.zoto = \{/, member: /^\s*(write[A-Z]\w*)\s*\(/, typed: false },
  { file: "web/src/plugins/viz-sdk.ts", block: null, member: /^zoto\.(write[A-Z]\w*)\s*=/, typed: false },
] as const;

type SurfaceMember = { line: number; doc: string };

/** Write members of one surface, with the JSDoc directly above (or before) each declaration. */
function surfaceMembers(s: (typeof SDK_SURFACES)[number]): Map<string, SurfaceMember> {
  const raw = read(s.file).split("\n");
  const lines = code(raw.join("\n")).split("\n");
  const [a, b] = s.block ? blockLines(lines, s.block, s.file) : [-1, lines.length - 1];
  const out = new Map<string, SurfaceMember>();
  for (let i = a + 1; i <= b; i++) {
    const m = s.member.exec(lines[i]!);
    if (!m) continue;
    let doc = /\/\*\*[\s\S]*?\*\//.exec(raw[i]!)?.[0] ?? "";
    if (!doc && i > 0 && raw[i - 1]!.trim().endsWith("*/")) {
      let j = i - 1;
      while (j > a && !raw[j]!.includes("/**")) j--;
      doc = raw.slice(j, i).join("\n");
    }
    out.set(m[1]!, { line: i + 1, doc });
  }
  return out;
}

/** Every SDK write API: the union over all surfaces, so a new one on any surface is picked up. */
function sdkWriteApis(): string[] {
  const all = new Set<string>();
  for (const s of SDK_SURFACES) for (const api of surfaceMembers(s).keys()) all.add(api);
  return [...all].sort();
}

type Hop = { file: string; method: RegExp; reads: RegExp[]; what: string };
type Probe = {
  /** A production line in web/src that hands the stored data on. */
  handoff: RegExp;
  /** When set, the handoff line or one of the two above it must show it is fed by this API. */
  fedBy?: RegExp;
  /** Every hop after the handoff must still apply the data (NetScene -> Backdrop -> shader). */
  hops: Hop[];
};

const SCENE = "web/src/graph/scene.ts";
const BACKDROP = "web/src/graph/backdrop.ts";

/** How each write API's stored data reaches the screen. No entry = no known consumer. */
const CONSUMER_PROBES: Record<string, Probe> = {
  writeBuffer: {
    handoff: /\b(setPluginUboBuffer|broadcastPluginUbo)\s*\([^;]*\.ubo\b|\b\w*[wW]riter[!?]*\.snapshot\s*\(/,
    hops: [
      { file: SCENE, method: /^\s*setPluginUboBuffer\s*\(\s*buf\b/, reads: [/this\.backdrop\.setPluginUboBuffer\(\s*buf\s*\)/], what: "NetScene forwards the UBO to Backdrop" },
      { file: BACKDROP, method: /^\s*setPluginUboBuffer\s*\(\s*buf\b/, reads: [/\.set\(\s*buf\s*\)/, /\.value\s*=\s*this\.pluginUbo\b/], what: "Backdrop copies it into the plugin shader UBO" },
    ],
  },
  writeUniform: {
    handoff: /(?<!this\.backdrop)\.setPluginUniform\s*\(/,
    fedBy: /\bwriteUniform\s*\(|\bonUniform\b/,
    hops: [
      { file: SCENE, method: /^\s*setPluginUniform\s*\(\s*name\b/, reads: [/this\.backdrop\.setPluginUniform\(\s*name\s*,\s*value\s*\)/], what: "NetScene forwards the uniform to Backdrop" },
      { file: BACKDROP, method: /^\s*setPluginUniform\s*\(\s*name\b/, reads: [/\bu\.value\s*=\s*value\b/], what: "Backdrop sets the shader uniform" },
    ],
  },
  writeParticles: {
    handoff: /\b\w*[wW]riter[!?]*\.particleSnapshot\s*\(/,
    hops: [],
  },
};

let productionCache: { file: string; lines: string[] }[] | null = null;
function production(): { file: string; lines: string[] }[] {
  productionCache ??= walk(join(REPO, "web/src")).map((f) => ({ file: rel(f), lines: code(readFileSync(f, "utf8")).split("\n") }));
  return productionCache;
}

/** Handoff sites and broken hops for one API (no probe: no sites). */
function consumerOf(api: string): { sites: string[]; broken: string[] } {
  const probe = CONSUMER_PROBES[api];
  if (!probe) return { sites: [], broken: ["no consumer probe registered"] };
  const sites: string[] = [];
  for (const { file, lines } of production()) {
    lines.forEach((l, i) => {
      if (!probe.handoff.test(l)) return;
      if (probe.fedBy && !lines.slice(Math.max(0, i - 2), i + 1).some((c) => probe.fedBy!.test(c))) return;
      sites.push(`${file}:${i + 1}`);
    });
  }
  const broken: string[] = [];
  for (const hop of probe.hops) {
    const lines = code(read(hop.file)).split("\n");
    const [a, b] = blockLines(lines, hop.method, hop.file);
    const body = lines.slice(a, b + 1).join("\n");
    const miss = hop.reads.filter((r) => !r.test(body));
    if (miss.length) broken.push(`${hop.what} (${hop.file}:${a + 1} lacks ${miss.join(", ")})`);
  }
  return { sites, broken };
}

const APIS = sdkWriteApis();

describe("#184 R3: every SDK write API has a production consumer or is @deprecated", () => {
  it("the SDK write APIs are exactly writeBuffer, writeUniform, writeParticles, on every surface", () => {
    expect(APIS, "write APIs across the SDK surfaces").toEqual(["writeBuffer", "writeParticles", "writeUniform"]);
    for (const s of SDK_SURFACES) {
      expect([...surfaceMembers(s).keys()].sort(), `${s.file} write members`).toEqual(APIS);
    }
    expect(Object.keys(CONSUMER_PROBES).sort(), "a probe for a write API the SDK no longer has").toEqual(APIS);
  });

  it.each(APIS)("%s has a production consumer, or is @deprecated on every typed SDK surface", (api) => {
    const { sites, broken } = consumerOf(api);
    const consumed = sites.length > 0 && broken.length === 0;
    const undeprecated = SDK_SURFACES.filter((s) => s.typed).flatMap((s) => {
      const m = surfaceMembers(s).get(api);
      return m && !/@deprecated\b/.test(m.doc) ? [`${s.file}:${m.line}`] : [];
    });
    const detail = [
      `handoffs: ${sites.length ? sites.join(", ") : "none"}`,
      `broken hops: ${broken.length ? broken.join("; ") : "none"}`,
      `not @deprecated on: ${undeprecated.length ? undeprecated.join(", ") : "none"}`,
    ].join(" | ");
    expect(consumed || undeprecated.length === 0, `${api} has no production consumer and is not @deprecated. ${detail}`).toBe(true);
  });
});
