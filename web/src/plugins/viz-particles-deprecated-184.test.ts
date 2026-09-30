/**
 * #184 (a): `writeParticles` is deprecated because nothing renders what it writes.
 *
 * R1 no consumer, frozen writers:
 *  - nothing in host or production code READS the particle buffer: `VizBufferWriter.particleSnapshot()`
 *    has no production caller, and inside VizBufferWriter the buffer is touched only by the constructor
 *    (allocation), `writeParticles` (the write) and `particleSnapshot` (its definition);
 *  - the packs that WRITE it are frozen at exactly {aquarium, metro-lines, rocket-car-soccer}. A new
 *    writer turns the row red, and so does migrating one of the three off it (then shrink the list, and
 *    close the follow-up issue when it is empty).
 *  Revert rows: a production `particleSnapshot()` reader -> red; talker-storm calling writeParticles
 *  again -> red; metro-lines moved off writeParticles without updating the list -> red.
 *
 * R2 warn once per writer (dev only): two calls on one writer give one console.warn naming #184, a new
 *  writer warns again, writeBuffer / writeUniform never warn, a production build never warns, and the
 *  maxParticles cap still holds. Revert rows: no warn -> red; warn on every call -> red; one module-wide
 *  flag (not per writer) -> red.
 *
 * Static source reads + one real VizBufferWriter. Counts only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIZ_WRITE_PARTICLES_DEPRECATED, VizBufferWriter, parseVizContract } from "./viz-host";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Frozen set of packs that still call writeParticles (follow-up issue: move them to UBO slots). */
const PARTICLE_WRITER_PACKS = ["aquarium", "metro-lines", "rocket-car-soccer"] as const;

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

/** Host + production code: the web app, the SDK and every pack's own sources. */
function productionFiles(): string[] {
  return [...walk(join(REPO, "web/src")), ...walk(join(REPO, "plugins/sdk")), ...walk(join(REPO, "plugins/src"))];
}

/** [start, end] line range (1-based) of the method whose signature matches `sig`, by brace depth. */
function methodLines(lines: string[], sig: RegExp): [number, number] {
  const start = lines.findIndex((l) => sig.test(l));
  expect(start, `method ${sig}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === "{") { depth++; opened = true; }
      else if (ch === "}") depth--;
    }
    if (opened && depth === 0) return [start + 1, i + 1];
  }
  throw new Error(`unclosed method ${sig}`);
}

describe("#184 R1: nothing reads the particle buffer, and its writers are frozen", () => {
  it("no host or production code calls VizBufferWriter.particleSnapshot()", () => {
    const readers: string[] = [];
    for (const f of productionFiles()) {
      code(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
        if (!/\bparticleSnapshot\s*\(/.test(line)) return;
        if (rel(f) === "web/src/plugins/viz-host.ts" && /^\s*particleSnapshot\s*\(\s*\)\s*:/.test(line)) return; // the definition
        readers.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(readers, "production readers of the particle buffer").toEqual([]);
  });

  it("inside VizBufferWriter the buffer is only allocated, written and handed out by particleSnapshot", () => {
    const lines = code(readFileSync(join(REPO, "web/src/plugins/viz-host.ts"), "utf8")).split("\n");
    const allowed = [
      methodLines(lines, /^\s*constructor\s*\(\s*contract: VizPluginContract\s*\)/),
      methodLines(lines, /^\s*writeParticles\s*\(/),
      methodLines(lines, /^\s*particleSnapshot\s*\(\s*\)\s*:/),
    ];
    const touches: number[] = [];
    lines.forEach((l, i) => { if (/\bthis\.(particles|particleCount)\b/.test(l)) touches.push(i + 1); });
    expect(touches.length, "the buffer is used at all (sanity)").toBeGreaterThan(0);
    const stray = touches.filter((n) => !allowed.some(([a, b]) => n >= a && n <= b));
    expect(stray.map((n) => `viz-host.ts:${n}`), "other reads of the particle buffer").toEqual([]);
  });

  it("the packs that call writeParticles are exactly aquarium, metro-lines and rocket-car-soccer", () => {
    const writers = new Set<string>();
    const where: string[] = [];
    for (const f of walk(join(REPO, "plugins/src"))) {
      if (!/\.writeParticles\s*\(/.test(code(readFileSync(f, "utf8")))) continue;
      writers.add(rel(f).split("/")[2]!);
      where.push(rel(f));
    }
    expect([...writers].sort(), `pack writers (${where.join(", ")})`).toEqual([...PARTICLE_WRITER_PACKS]);
  });
});

describe("#184 R2: writeParticles warns once per writer, in dev only", () => {
  const contract = parseVizContract({ graphWalk: false, maxBuffers: 1, maxBufferFloats: 8, maxParticles: 4, uniforms: ["uTime", "uBright"], idle: { fixture: "host" } })!;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const deprecations = () => warn.mock.calls.filter((c: unknown[]) => c[0] === VIZ_WRITE_PARTICLES_DEPRECATED).length;

  it("one warning per writer, naming #184; buffer and uniform writes never warn; the cap still holds", () => {
    expect(contract.maxParticles).toBe(4);
    expect(VIZ_WRITE_PARTICLES_DEPRECATED).toMatch(/deprecated \(#184\)/);
    const a = new VizBufferWriter(contract);
    a.writeBuffer(0, [1, 2]);
    a.writeUniform("uBright", 0.5);
    expect(deprecations(), "writeBuffer / writeUniform").toBe(0);
    expect(a.writeParticles(new Array(4 * 4).fill(0.5), 4).ok, "at the cap").toBe(true);
    expect(a.writeParticles(new Array(5 * 4).fill(0.5), 4).ok, "over the cap").toBe(false);
    a.writeParticles([0, 0, 0, 1], 4);
    expect(deprecations(), "three calls on one writer").toBe(1);
    const b = new VizBufferWriter(contract);
    b.writeParticles([0, 0, 0, 1], 4);
    b.writeParticles([0, 0, 0, 1], 4);
    expect(deprecations(), "a second writer warns once too").toBe(2);
    expect(warn.mock.calls.length, "nothing else warned").toBe(2);
  });

  it("a production build never warns", () => {
    vi.stubEnv("DEV", false);
    const w = new VizBufferWriter(contract);
    w.writeParticles([0, 0, 0, 1], 4);
    w.writeParticles([0, 0, 0, 1], 4);
    expect(deprecations()).toBe(0);
    expect(w.writeParticles(new Array(5 * 4).fill(0.5), 4).ok, "the cap still holds").toBe(false);
  });
});
