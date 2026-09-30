import { describe, expect, it } from "vitest";
import { TileHealthMonitor, writeTileHealErrors } from "./tile-health-monitor";
import { TILE_LOAD_GRACE_MS, freshTileHealthState } from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { deviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";

function mockScene(serial = 0, lost = false): NetScene {
  return mockPartial<NetScene>({
    viewEl: document.createElement("div"),
    pictureSerial: serial,
    gpuContextLost: lost,
    lastViewport: deviceRect(0, 0, 200, 120),
  });
}

function baseMonitor(over: Partial<{
  awaitingApproval: boolean | (() => boolean);
  onScreen: boolean | (() => boolean);
  tabVisible: boolean | (() => boolean);
  onHeal: (id: string, step: string) => void;
}> = {}) {
  const { awaitingApproval, onScreen: onScreenOver, tabVisible: tabVisibleOver } = over;
  const awaiting = typeof awaitingApproval === "function"
    ? awaitingApproval
    : () => awaitingApproval ?? false;
  const onScreen = typeof onScreenOver === "function"
    ? onScreenOver
    : () => onScreenOver ?? true;
  const tabVisible = typeof tabVisibleOver === "function"
    ? tabVisibleOver
    : () => tabVisibleOver ?? true;
  const host = {
    software: true,
    canvas: document.createElement("canvas"),
    pixelRatio: 1,
    gl: null,
  } as RenderHost;
  const scene = mockScene(0);
  const heals: string[] = [];
  const mon = new TileHealthMonitor({
    host,
    mainScene: scene,
    mosaic: null,
    paneEl: () => scene.viewEl,
    sceneFor: () => scene,
    packFor: () => null,
    mayBeStatic: () => false,
    awaitingApproval: awaiting,
    isVisible: () => true,
    showErrors: () => localStorage.getItem("zoto-viz.tileHealErrors") === "1",
    tabVisible,
    onScreen,
    onHeal: (id, step) => {
      heals.push(`${id}:${step}`);
      over.onHeal?.(id, step);
    },
  });
  return { mon, heals, scene };
}

describe("TileHealthMonitor messages", () => {
  it("hides heal text when the setting is off and shows it when on", () => {
    writeTileHealErrors(false);
    const { mon, scene } = baseMonitor();
    const state = freshTileHealthState();
    state.lastMessage = "Tile blank for 6 s, restarted pack";
    (mon as unknown as { states: Map<string, unknown> }).states.set("main", state);
    (mon as unknown as { paintLabel: (id: string, s: unknown) => void }).paintLabel("main", state);
    const label = scene.viewEl.querySelector(".tile-heal-msg") as HTMLElement;
    expect(label.hidden).toBe(true);
    writeTileHealErrors(true);
    (mon as unknown as { paintLabel: (id: string, s: unknown) => void }).paintLabel("main", state);
    expect(label.hidden).toBe(false);
    expect(label.textContent).toContain("restarted pack");
    writeTileHealErrors(false);
  });
});

describe("TileHealthMonitor exemptions", () => {
  it("does not heal during view grace then one flat check after grace is not enough", () => {
    const { mon, heals } = baseMonitor();
    mon.noteGrace("main", 0);
    for (let t = 500; t < TILE_LOAD_GRACE_MS; t += 700) {
      mon.tick(t);
    }
    expect(heals).toHaveLength(0);
    mon.tick(TILE_LOAD_GRACE_MS + 500);
    expect(heals).toHaveLength(0);
    expect(mon.state("main").emptyStreak).toBeLessThan(3);
  });

  it("does not heal while awaiting approval and resets after approve + grace", () => {
    let blocked = true;
    const { mon, heals } = baseMonitor({ awaitingApproval: () => blocked } as { awaitingApproval: () => boolean });
    const internal = mon as unknown as { states: Map<string, { emptyStreak: number }> };
    internal.states.set("main", { ...freshTileHealthState(), emptyStreak: 2 });
    for (let i = 0; i < 5; i++) mon.tick(10_000 + i * 2500);
    expect(heals).toHaveLength(0);
    expect(mon.state("main").emptyStreak).toBe(0);
    blocked = false;
    mon.noteGrace("main", 10_000);
    mon.tick(11_000);
    expect(heals).toHaveLength(0);
  });

  it("resets counters when the tab was hidden and shown again", () => {
    let tab = true;
    const { mon } = baseMonitor({ tabVisible: () => tab });
    const internal = mon as unknown as { states: Map<string, { emptyStreak: number }> };
    const seeded = { ...freshTileHealthState(), emptyStreak: 2, backoffUntil: 50_000 };
    internal.states.set("main", seeded);
    tab = false;
    (mon as unknown as { onTabVisibility: () => void }).onTabVisibility();
    expect(mon.state("main").emptyStreak).toBe(0);
    expect(mon.state("main").backoffUntil).toBe(0);
    tab = true;
    (mon as unknown as { onTabVisibility: () => void }).onTabVisibility();
    expect(mon.state("main").emptyStreak).toBe(0);
  });

  it("never checks an off-screen tile", () => {
    const { mon, heals } = baseMonitor({ onScreen: false });
    mon.state("main"); // ensure state slot exists
    const internal = mon as unknown as { states: Map<string, ReturnType<typeof freshTileHealthState>> };
    internal.states.set("main", { ...freshTileHealthState(), emptyStreak: 2, backoffUntil: 99_000 });
    for (let i = 0; i < 6; i++) mon.tick(20_000 + i * 2500);
    expect(heals).toHaveLength(0);
    expect(mon.state("main").emptyStreak).toBe(0);
    expect(mon.state("main").backoffUntil).toBe(0);
  });
});
