/**
 * #261: wired reads go through the resolver and return the same values as before.
 * An instance default still beats a stored pack value. That flip is #262.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readArcadeKnob } from "./arcade-knob";
import { optsForMode } from "../app/mode-opts";
import { DEFAULT_DREAM, type DreamAnim } from "../graph/scene";
import { Mosaic, mosaicAnimForTile } from "../graph/mosaic";
import { applyPluginCatalog, loadPluginConfig, type PluginView } from "../plugins/plugin";
import { expandPluginInstances } from "../plugins/instances";
import type { ViewMode } from "../core/modes";

const PIN = "plugin:pin-pack";

function wallIds(n: number): string[] {
  const ids = [PIN, "plugin:plain", "plugin:other", "plugin:fourth"];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(i === n - 1 && n > 1 ? `${PIN}!2` : ids[i % ids.length]!);
  return out;
}

describe("#261 scope reads match today's results", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    applyPluginCatalog([{
      id: "pin-pack",
      name: "Pin",
      version: 1,
      look: { backdrop: "nebula", edgeGlow: "pulse" },
    } as PluginView]);
  });

  afterEach(() => {
    applyPluginCatalog([]);
    localStorage.clear();
  });

  it("(1) 1×, 2×2 and 2×4, a !2 tile, an instance row and an arcade knob", () => {
    const wall = { ...DEFAULT_DREAM, backdrop: "grid" as const };
    const table: { size: number; tileSky?: string }[] = [
      { size: 1 },
      { size: 4, tileSky: "matrix" },
      { size: 8, tileSky: "matrix" },
    ];
    for (const row of table) {
      for (const id of wallIds(row.size)) {
        const anim = mosaicAnimForTile(wall, id, row.tileSky as DreamAnim["backdrop"]);
        const pinned = id.startsWith(PIN);
        expect(anim.backdrop, `${row.size} ${id}`).toBe(pinned ? "nebula" : row.tileSky ?? "grid");
        expect(anim.edgeGlow, `${row.size} ${id} pin`).toBe(pinned ? "pulse" : wall.edgeGlow);
      }
    }

    const spec: PluginView = {
      id: "koi-pond",
      name: "Koi",
      version: 1,
      instances: [{ id: "pond-1", defaults: { slot: "Koi Pond 1" } }],
      config: [{ key: "slot", label: "slot", type: "text", default: "Koi Pond" }],
    };
    const row = expandPluginInstances(spec).find((s) => s.instanceId === "pond-1")!;
    localStorage.setItem("zoto-viz.plugin.koi-pond.slot", "pack-wide");
    expect(loadPluginConfig(row, row.config).slot).toBe("pack-wide");

    const mode = {
      id: "topology",
      options: [{ key: "layout", label: "layout", default: "force", values: [["force", "force"], ["radial", "radial"]] }],
    } as ViewMode;
    localStorage.setItem("zoto-viz.mode.topology.layout", "radial");
    expect(optsForMode(mode, () => null).layout).toBe("radial");
    localStorage.setItem("zoto-viz.mode.topology.layout", "nope");
    expect(optsForMode(mode, () => null).layout).toBe("force");

    expect(readArcadeKnob("zoto-viz.pong.speed", "1")).toBe("1");
    localStorage.setItem("zoto-viz.pong.speed", "2");
    expect(readArcadeKnob("zoto-viz.pong.speed", "1")).toBe("2");
  });

  it("(2) applyLooks keeps the pack pin on the tile", () => {
    const seen: DreamAnim[] = [];
    const wall = document.createElement("div");
    const mosaic = new Mosaic({
      wall,
      sceneEl: document.createElement("div"),
      main: {
        currentMode: { id: PIN },
        setCompactLabels: () => {},
        relayout: () => {},
        setMode: () => {},
        setAnim: (a: DreamAnim) => { seen.push(a); },
      } as never,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: { id: "midnight" } as never,
        filters: {},
        anim: { ...DEFAULT_DREAM, backdrop: "grid" },
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.applyLooks({ ...DEFAULT_DREAM, backdrop: "grid" });
    expect(seen[0]?.backdrop).toBe("nebula");
    expect(seen[0]?.edgeGlow).toBe("pulse");
  });
});
