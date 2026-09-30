import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_DEFAULT, nixieCanvasSize } from "../../../plugins/src/nixie-clock/frontend/tubes";
import { resetVizClockInjectors, setVizClockInjector, setVizWallClockInjector } from "../core/viz-clock";
import { resetNixiePackHostScope, runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame, VizUniformValue } from "./viz-host";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NIXIE_PACK_DIR = path.join(repoRoot, "plugins/src/nixie-clock");
const NIXIE_INDEX = path.join(NIXIE_PACK_DIR, "frontend/index.ts");
const NIXIE_TUBES = path.join(NIXIE_PACK_DIR, "frontend/tubes.ts");

/**
 * Pack lint is loaded by a runtime specifier so tsconfig.test.json does not pull plugins/sdk/pack-lint.ts
 * (and its pre-existing sdk type errors) into the test program; vitest loads the same module by absolute path.
 */
const PACK_LINT_MODULE = path.join(repoRoot, "plugins/sdk/pack-lint.ts");
type PackInstallLintFinding = { rule: string; target: string; file: string; line: number };
type PackInstallLint = (packDirAbs: string, repoRoot: string) => {
  blocks: PackInstallLintFinding[];
  warnings: PackInstallLintFinding[];
};
let scanPackInstallLint: PackInstallLint;
beforeAll(async () => {
  ({ scanPackInstallLint } = (await import(/* @vite-ignore */ PACK_LINT_MODULE)) as { scanPackInstallLint: PackInstallLint });
});
/** The pack frontend (sandbox side) is loaded the same way: it imports the "plugins/sdk" vite alias. */
const NIXIE_FRONTEND_MODULE = NIXIE_INDEX;

function renderHostDoc(w: number, h: number): Document {
  const doc = document.implementation.createHTMLDocument("nixie");
  const canvas = doc.createElement("canvas");
  canvas.className = "render-host";
  canvas.width = w;
  canvas.height = h;
  doc.body.appendChild(canvas);
  return doc;
}

function frameAt(t: number, rate = 0): VizDataFrame {
  return {
    t, dt: 1 / 60, audio: 0.25, packets: [], rf: [],
    talkers: rate > 0 ? [{ id: "10.0.0.2", rate, role: "client" }] : [],
    headlines: [],
  } as VizDataFrame;
}

/** Swap `parent` (and `window.parent`) for the duration of a test; restored in afterEach. */
function stubParent(value: unknown): void {
  vi.stubGlobal("parent", value);
  if ((window as unknown) !== globalThis) {
    Object.defineProperty(window, "parent", { configurable: true, get: () => value });
  }
}

/** A foreign embedding page: every property read is recorded and throws (cross-origin). */
function throwingParent(reads: string[]): unknown {
  return new Proxy({}, {
    get(_t, key) {
      reads.push(String(key));
      throw new DOMException("Blocked a frame from accessing a cross-origin frame.", "SecurityError");
    },
    has(_t, key) {
      reads.push(`has:${String(key)}`);
      throw new DOMException("Blocked a frame from accessing a cross-origin frame.", "SecurityError");
    },
  });
}

/** A readable embedding page whose own canvas.render-host is a different size (2222×999). */
function readableParent(reads: string[]): unknown {
  const hostDoc = renderHostDoc(2222, 999);
  return new Proxy({}, {
    get(_t, key) {
      reads.push(String(key));
      return key === "document" ? hostDoc : undefined;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if ((window as unknown) !== globalThis) delete (window as { parent?: unknown }).parent;
});

describe("nixie-clock sandbox rows (#187)", () => {
  it("pack install lint finds no sandbox-escape in nixie-clock (#187)", () => {
    const { blocks } = scanPackInstallLint(NIXIE_PACK_DIR, repoRoot);
    expect(blocks.filter((v) => v.rule === "sandbox-escape")).toEqual([]);
  });

  it("nixieCanvasSize: real size from a passed happy-dom doc, default plate from an empty one (#187)", () => {
    expect(document.querySelector("canvas.render-host")).toBeNull();
    expect(nixieCanvasSize(renderHostDoc(1353, 786))).toEqual({ w: 1353, h: 786 });
    expect(nixieCanvasSize(document.implementation.createHTMLDocument("empty"))).toEqual(CANVAS_DEFAULT);
    expect(nixieCanvasSize()).toEqual(CANVAS_DEFAULT);
    expect(nixieCanvasSize(null)).toEqual(CANVAS_DEFAULT);
  });

  it("nixieCanvasSize with no doc reads the pack's own document (#187)", () => {
    const canvas = document.createElement("canvas");
    canvas.className = "render-host";
    canvas.width = 1111;
    canvas.height = 666;
    document.body.appendChild(canvas);
    try {
      expect(nixieCanvasSize()).toEqual({ w: 1111, h: 666 });
      expect(nixieCanvasSize(null)).toEqual({ w: 1111, h: 666 });
    } finally {
      canvas.remove();
    }
  });

  it("nixieCanvasSize never touches parent: a throwing cross-origin parent is not read, doc or no doc (#187)", () => {
    const reads: string[] = [];
    stubParent(throwingParent(reads));
    expect(nixieCanvasSize(renderHostDoc(1353, 786))).toEqual({ w: 1353, h: 786 });
    expect(nixieCanvasSize()).toEqual(CANVAS_DEFAULT);
    expect(nixieCanvasSize(null)).toEqual(CANVAS_DEFAULT);
    expect(reads, "parent / window.parent property reads").toEqual([]);
  });

  it("nixieCanvasSize never takes the embedding page's canvas, even when parent.document is readable (#187)", () => {
    const reads: string[] = [];
    stubParent(readableParent(reads));
    expect(nixieCanvasSize()).toEqual(CANVAS_DEFAULT);
    expect(nixieCanvasSize()).not.toEqual({ w: 2222, h: 999 });
    expect(nixieCanvasSize(renderHostDoc(1400, 900))).toEqual({ w: 1400, h: 900 });
    expect(reads, "parent / window.parent property reads").toEqual([]);
  });
});

describe("nixie-clock digits stay host-owned (#187)", () => {
  beforeEach(() => {
    resetVizClockInjectors();
    resetNixiePackHostScope();
  });
  afterEach(() => {
    resetVizClockInjectors();
    resetNixiePackHostScope();
  });

  it("host nixie handler writes the clock-digit buffer to slot 0 from the wall clock (#187)", () => {
    const wall = new Date(2026, 8, 30, 13, 5, 7, 250).getTime();
    setVizWallClockInjector(() => wall);
    setVizClockInjector(() => 5_000);
    const writes: { slot: number; data: number[] }[] = [];
    const uniforms: string[] = [];
    runPackFrameHandler("nixie-clock", frameAt(wall / 1000), {
      writeBuffer: (slot, data) => { writes.push({ slot, data: [...data] }); },
      writeUniform: (name) => { uniforms.push(name); },
      writeParticles: () => {},
    }, { format: "24", seconds: "1" });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.slot).toBe(0);
    expect(writes[0]!.data.slice(0, 6)).toEqual([1, 3, 0, 5, 0, 7]);
    expect(uniforms).toEqual(["uAudio", "uAccent", "uBg"]);
  });

  it("pack frontend source no longer references typeof parent / parent. / window.parent, nor packs digits (#187)", () => {
    for (const file of [NIXIE_INDEX, NIXIE_TUBES]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\btypeof\s+parent\b/);
      expect(src, file).not.toMatch(/\bparent\s*\./);
      expect(src, file).not.toMatch(/\bwindow\s*\.\s*parent\b/);
    }
    const index = readFileSync(NIXIE_INDEX, "utf8");
    expect(index).not.toMatch(/\bhostPackWritesBuffer\b/);
    expect(index).not.toMatch(/\bwriteBuffer\s*\(/);
    expect(index).not.toMatch(/\bpackNixieBuffer\b/);
  });

  describe("pack frontend onFrame (sandbox side)", () => {
    type Uniform = [string, VizUniformValue];
    const writeBuffer = vi.fn();
    const uniforms: Uniform[] = [];
    let onFrame: ((frame: VizDataFrame) => void) | null = null;

    beforeAll(async () => {
      (globalThis as { zoto?: unknown }).zoto = {
        onTick: null,
        onConfig: null,
        onFrame: null,
        getConfig: () => ({ format: "24", seconds: "1" }),
        writeBuffer: (slot: number, data: number[]) => writeBuffer(slot, data),
        writeUniform: (name: string, value: VizUniformValue) => { uniforms.push([name, value]); },
        writeParticles: () => {},
      };
      await import(/* @vite-ignore */ NIXIE_FRONTEND_MODULE);
      onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
      delete (globalThis as { zoto?: unknown }).zoto;
    });

    beforeEach(() => {
      writeBuffer.mockClear();
      uniforms.length = 0;
    });

    const EXPECTED: Uniform[] = [
      ["uAudio", 0.25],
      ["uAccent", [1.0, 0.38, 0.06]],
      ["uBg", [0.06, 0.03, 0.02]],
    ];

    it("top-level page (parent === window): writes only its 3 uniforms, never the digit buffer (#187)", () => {
      expect(onFrame, "nixie frontend registers zoto.onFrame").toBeTypeOf("function");
      stubParent(window);
      onFrame!(frameAt(new Date(2026, 8, 30, 13, 5, 7).getTime() / 1000, 90));
      expect(writeBuffer).not.toHaveBeenCalled();
      expect(uniforms).toEqual(EXPECTED);
    });

    it("sandboxed iframe (cross-origin parent): writes only its 3 uniforms and never reads parent (#187)", () => {
      expect(onFrame).toBeTypeOf("function");
      const reads: string[] = [];
      stubParent(throwingParent(reads));
      onFrame!(frameAt(new Date(2026, 8, 30, 13, 5, 7).getTime() / 1000, 90));
      expect(writeBuffer).not.toHaveBeenCalled();
      expect(uniforms).toEqual(EXPECTED);
      expect(reads).toEqual([]);
    });
  });
});
