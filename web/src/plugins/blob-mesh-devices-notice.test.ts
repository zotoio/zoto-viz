import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOB_MESH_SLOT_BUDGET } from "../../../plugins/sdk/blob-mesh-budget";
import { paintPackInfoCaption, resetBlobMeshNoticeLatches } from "./blob-mesh-devices-notice";
import { LAN11_35S_PPS, lanFrames35s } from "./pack-sky-lan-frame-test-helper";
import { runPackFrameHandler, type VizPackHandlers } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";
import type { VizDemoPackId } from "../ui/viz-hud";

/**
 * #173 rows: when the minimum blob sizes don't all fit the coverage budget, Blob Mesh draws the
 * busiest devices that fit and the tile says how many it left out (UX Pro copy), as an info
 * caption with ~3 s hysteresis. Driven through the host mirror (what the app draws) with fake timers.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.resolve(here, "../style.css"), "utf8");

/** 7 drawn: the plan holds back room for the busiest blob to reach 1.4x before counting what fits. */
const PLURAL = "Showing the 7 busiest devices. 4 quieter ones don't fit.";
const SINGULAR = "Showing the 7 busiest devices. 1 quieter one doesn't fit.";
const FRAME_MS = 100;

function lan(n: number): VizDataFrame {
  const talkers = Array.from({ length: n }, (_, i) => ({ id: `172.30.0.${10 + i}`, rate: 200 - i * 15, role: i === 1 ? "gateway" : "lan" }));
  return { t: 35, dt: FRAME_MS / 1000, audio: 0, packets: [], rf: [], talkers, headlines: [] };
}

let tile: HTMLElement;
let slot0: number[];
let notices: (string | null)[];

function handlers(): VizPackHandlers {
  return {
    writeBuffer: (slot, data) => { if (slot === 0) slot0 = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
    setInfoNotice: (text) => {
      notices.push(text);
      paintPackInfoCaption(tile, text);
    },
  };
}

/** Deliver `frame` every FRAME_MS for `ms` (first delivery now). */
function drive(frame: VizDataFrame, ms: number, packId: VizDemoPackId = "blob-mesh"): void {
  for (let t = 0; t < ms; t += FRAME_MS) {
    runPackFrameHandler(packId, frame, handlers());
    vi.advanceTimersByTime(FRAME_MS);
  }
  runPackFrameHandler(packId, frame, handlers());
}

const caption = () => tile.querySelector<HTMLElement>(".pack-info-caption");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T05:00:00Z"));
  resetBlobMeshNoticeLatches();
  tile = document.createElement("div");
  document.body.append(tile);
  slot0 = [];
  notices = [];
});

afterEach(() => {
  tile.remove();
  vi.useRealTimers();
});

describe("blob-mesh over-budget devices notice (#173)", () => {
  it("11-device live LAN: draws 7 blobs, busiest >= 1.4x the quietest, sum r^2 within budget, and the exact plural copy", () => {
    const [frame] = lanFrames35s({ fixture: "host" }, 2, 1, 6, 11);
    expect(frame!.talkers).toHaveLength(11);
    expect(frame!.talkers.reduce((s, t) => s + t.rate, 0)).toBe(LAN11_35S_PPS);
    drive(frame!, 3000);
    const radii = slot0.filter((_, i) => i % 4 === 2);
    const ratio = Math.max(...radii) / Math.min(...radii);
    const sumR2 = radii.reduce((s, r) => s + r * r, 0);
    const text = `radii=${radii.map((r) => r.toFixed(4)).join(",")} ratio=${ratio.toFixed(4)} sumR2=${sumR2.toFixed(6)}`;
    process.stdout.write(`[LAN11] ${text} notice=${JSON.stringify(caption()?.textContent ?? null)}\n`);
    expect(radii, text).toHaveLength(7);
    expect(ratio, text).toBeGreaterThanOrEqual(1.4 - 1e-9);
    expect(sumR2, `never a silent overlap past the budget: ${text}`).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + 1e-9);
    expect(caption()?.textContent).toBe(PLURAL);
  });

  it("11 devices: draws the 7 busiest inside the budget and says 4 quieter ones don't fit (exact plural copy)", () => {
    drive(lan(11), 3000);
    expect(caption()?.textContent).toBe(PLURAL);
    const radii = slot0.filter((_, i) => i % 4 === 2);
    expect(radii).toHaveLength(7);
    expect(radii.reduce((s, r) => s + r * r, 0), "never a silent overlap past the budget").toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + 1e-9);
  });

  it("8 devices: exact singular copy", () => {
    drive(lan(8), 3000);
    expect(caption()?.textContent).toBe(SINGULAR);
  });

  it("7 devices (the live demo, under budget): no notice, ever", () => {
    drive(lan(7), 10_000);
    expect(caption()).toBeNull();
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((n) => n === null)).toBe(true);
  });

  it("hysteresis: shows after 3 s over budget, hides after 3 s back under, and a short blip never shows", () => {
    drive(lan(11), 2900);
    expect(caption(), "2.9 s over: not yet").toBeNull();
    drive(lan(11), 100);
    expect(caption()?.textContent, "3 s over: shown").toBe(PLURAL);
    drive(lan(7), 2900);
    expect(caption()?.textContent, "2.9 s under: still shown").toBe(PLURAL);
    drive(lan(7), 100);
    expect(caption(), "3 s under: hidden").toBeNull();
    drive(lan(11), 2000);
    drive(lan(7), 500);
    drive(lan(11), 2000);
    expect(caption(), "over 2 s, under 0.5 s, over 2 s: the over timer restarted, so not shown").toBeNull();
  });

  it("is an info caption: normal tone, no Retry, small and click-through (never covers the blobs)", () => {
    drive(lan(11), 3000);
    const el = caption()!;
    expect(el.getAttribute("role")).toBe("status");
    expect(el.querySelector("button")).toBeNull();
    expect(tile.querySelector(".mosaic-pane-notice, .mosaic-pane-notice-fail")).toBeNull();
    const rule = CSS.match(/\.pack-info-caption \{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "style.css has a .pack-info-caption rule").not.toBe("");
    expect(rule).toMatch(/pointer-events: none/);
    expect(rule).toMatch(/top: 8px/);
    expect(rule).not.toMatch(/inset: 0|bottom: 0|height: 100%/);
    expect(rule).not.toMatch(/--bad|--err|--danger|#f00|red\b/);
    expect(rule).toMatch(/color: var\(--fg\)/);
  });

  it("switching the tile to another pack clears the caption", () => {
    drive(lan(11), 3000);
    expect(caption()).not.toBeNull();
    runPackFrameHandler("star-sines", lan(11), handlers());
    expect(caption()).toBeNull();
  });
});
