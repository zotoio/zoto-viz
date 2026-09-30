import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanPackInstallLint } from "../../../plugins/sdk/pack-lint";
import { runPackOnFixtures } from "../../../plugins/sdk/viz-fixtures";
import {
  clamp01, EMPTY_SYS_GAUGES, packSysGauges, SYSCON_CANVAS_DEFAULT, sysAlert, sysconCanvasSize,
} from "../../../plugins/src/syscon/frontend/telemetry";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SYSCON_PACK_DIR = path.join(repoRoot, "plugins/src/syscon");

function renderHostDoc(w: number, h: number): Document {
  const doc = document.implementation.createHTMLDocument("syscon");
  const canvas = doc.createElement("canvas");
  canvas.className = "render-host";
  canvas.width = w;
  canvas.height = h;
  doc.body.appendChild(canvas);
  return doc;
}

describe("syscon gauges", () => {
  it("packs shared host fixtures into slot 0", () => {
    runPackOnFixtures((frame) => {
      const buf = packSysGauges(frame.sys ?? EMPTY_SYS_GAUGES, frame.audio, sysconCanvasSize());
      expect(buf.length).toBeGreaterThan(0);
    });
  });

  it("packs gauges plus canvas size", () => {
    const buf = packSysGauges({
      ...EMPTY_SYS_GAUGES,
      cpu: 0.4,
      mem: 0.8,
      failed: 0.5,
      temp: 0.9,
    }, 0.25, { w: 1353, h: 786 });
    expect(buf).toHaveLength(14);
    expect(buf[0]).toBeCloseTo(0.4);
    expect(buf[1]).toBeCloseTo(0.8);
    expect(buf[8]).toBeCloseTo(0.5);
    expect(buf[10]).toBeCloseTo(0.25);
    expect(buf[11]).toBeCloseTo(0.9);
    expect(buf[12]).toBe(1353);
    expect(buf[13]).toBe(786);
  });

  it("clamps and treats missing sys as zeros", () => {
    expect(packSysGauges(undefined, 2)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1280, 800,
    ]);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(sysAlert({ ...EMPTY_SYS_GAUGES, psi: 0.3, temp: 0.2 })).toBeCloseTo(0.3);
  });

  it("falls back to the default plate when no canvas is present", () => {
    const fake = { querySelector: () => null } as unknown as Document;
    expect(sysconCanvasSize(fake)).toEqual({ w: 1280, h: 800 });
  });

  it("pack install lint finds no sandbox-escape in syscon (#187)", () => {
    const { blocks } = scanPackInstallLint(SYSCON_PACK_DIR, repoRoot);
    expect(blocks.filter((v) => v.rule === "sandbox-escape")).toEqual([]);
  });

  it("sysconCanvasSize: default plate with no doc, real size from a doc's canvas.render-host (#187)", () => {
    expect(document.querySelector("canvas.render-host")).toBeNull();
    expect(sysconCanvasSize()).toEqual(SYSCON_CANVAS_DEFAULT);
    expect(sysconCanvasSize(null)).toEqual(SYSCON_CANVAS_DEFAULT);
    expect(sysconCanvasSize(renderHostDoc(1353, 786))).toEqual({ w: 1353, h: 786 });
  });

  it("sysconCanvasSize with no doc reads the pack's own document (#187)", () => {
    const canvas = document.createElement("canvas");
    canvas.className = "render-host";
    canvas.width = 1111;
    canvas.height = 666;
    document.body.appendChild(canvas);
    try {
      expect(sysconCanvasSize()).toEqual({ w: 1111, h: 666 });
    } finally {
      canvas.remove();
    }
  });
});
