/**
 * The first edit writes the v2 envelope and one legacy key.
 * v1 profiles and sessions upgrade to v2. A rewritten tile keeps its overrides.
 * A pack swap drops pack config and keeps look and the render floor.
 * A stored pack value beats an instance default.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcileMosaicTilesWithMode, type TileOverride } from "../app/boot-view-restore";
import { expandPluginInstances } from "../plugins/instances";
import { loadPluginConfig, type PluginView } from "../plugins/plugin";
import { normalizeSettings, shippedSettings } from "./profiles";
import { readSessionLive, SESSION_LIVE_KEY, writeSessionLive } from "./session-live";
import { applyUserEdit, SETTINGS_ENVELOPE_KEY, type SettingsStore } from "./settings-dual-write";

class Mem implements SettingsStore {
  private map = new Map<string, string>();
  sets: string[] = [];
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.sets.push(k); this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

describe("v2 settings write", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("(1) the first edit writes v2 and exactly one legacy key", () => {
    const store = new Mem();
    store.setItem("zoto-viz.anim.yawPeriod", "150");
    store.sets.length = 0;
    const env = applyUserEdit(store, {
      legacyKey: "zoto-viz.anim.yawPeriod",
      value: "90",
      scope: "global",
      field: "anim.yawPeriod",
    });
    expect(env.v).toBe(2);
    expect(env.global.anim?.yawPeriod).toBe(90);
    expect(store.sets.filter((k) => k === SETTINGS_ENVELOPE_KEY)).toHaveLength(1);
    const legacy = store.sets.filter((k) => k !== SETTINGS_ENVELOPE_KEY);
    expect(legacy).toEqual(["zoto-viz.anim.yawPeriod"]);
    const saved = JSON.parse(store.getItem(SETTINGS_ENVELOPE_KEY) ?? "{}") as { v: number };
    expect(saved.v).toBe(2);
  });

  it("(2) an older tab that reads only the legacy key sees the new value", () => {
    const store = new Mem();
    applyUserEdit(store, {
      legacyKey: "zoto-viz.plugin.koi-pond.gain",
      value: "4",
      scope: "pack",
      field: "gain",
      packId: "koi-pond",
    });
    expect(store.getItem("zoto-viz.plugin.koi-pond.gain")).toBe("4");
    expect(store.getItem(SETTINGS_ENVELOPE_KEY)).toContain('"gain":"4"');
  });

  it("(3) profile v1 and session v1 upgrade to v2 with no value lost", () => {
    const profile = normalizeSettings({ ...shippedSettings(), v: 1, theme: "aurora", vizGovernor: false, dream: true });
    expect(profile.v).toBe(2);
    expect(profile.legacy).toBe(false);
    expect(profile.newer).toBe(false);
    expect(profile.theme).toBe("aurora");
    expect(profile.vizGovernor).toBe(false);
    expect(profile.dream).toBe(true);

    sessionStorage.setItem(SESSION_LIVE_KEY, JSON.stringify({
      v: 1,
      profileId: "user",
      dirty: true,
      settings: { ...shippedSettings(), v: 1, theme: "ember", mode: "plugin:talkers" },
      selected: "10.0.0.2",
    }));
    const read = readSessionLive();
    expect(read?.v).toBe(2);
    expect(read?.settings.theme).toBe("ember");
    expect(read?.settings.mode).toBe("plugin:talkers");
    expect(read?.selected).toBe("10.0.0.2");
    writeSessionLive({
      profileId: read!.profileId,
      dirty: read!.dirty,
      settings: read!.settings,
      selected: read!.selected,
    });
    const stored = JSON.parse(sessionStorage.getItem(SESSION_LIVE_KEY) ?? "{}") as { v: number; settings: { theme: string; mode: string } };
    expect(stored.v).toBe(2);
    expect(stored.settings.theme).toBe("ember");
    expect(stored.settings.mode).toBe("plugin:talkers");
  });

  it("(4) a rewritten tile id keeps its overrides", () => {
    const bag: Record<string, TileOverride> = {
      "plugin:cpu-pong": { look: { backdrop: "nebula" }, config: { slot: "a" }, floor: 0.4 },
    };
    const tiles = reconcileMosaicTilesWithMode(["plugin:cpu-pong"], "plugin:cpupong", null, bag);
    expect(tiles).toEqual(["plugin:cpupong"]);
    expect(bag["plugin:cpupong"]).toEqual({ look: { backdrop: "nebula" }, config: { slot: "a" }, floor: 0.4 });
    expect(bag["plugin:cpu-pong"]).toBeUndefined();
  });

  it("(5) a pack swap drops pack config and keeps look and the render floor", () => {
    const bag: Record<string, TileOverride> = {
      "plugin:koi-pond": { look: { backdrop: "nebula" }, config: { slot: "a" }, floor: 0.4 },
    };
    const tiles = reconcileMosaicTilesWithMode(["plugin:koi-pond"], "plugin:aquarium", "plugin:koi-pond", bag);
    expect(tiles).toEqual(["plugin:aquarium"]);
    expect(bag["plugin:aquarium"]).toEqual({ look: { backdrop: "nebula" }, floor: 0.4 });
    expect(bag["plugin:koi-pond"]).toBeUndefined();
  });

  it("(6) a user pack value beats an instance default", () => {
    const spec: PluginView = {
      id: "koi-pond",
      name: "Koi",
      version: 1,
      instances: [{ id: "pond-1", defaults: { slot: "Koi Pond 1" } }],
      config: [{ key: "slot", label: "slot", type: "text", default: "Koi Pond" }],
    };
    const row = expandPluginInstances(spec).find((s) => s.instanceId === "pond-1")!;
    expect(loadPluginConfig(row, row.config).slot).toBe("Koi Pond 1");
    localStorage.setItem("zoto-viz.plugin.koi-pond.slot", "pack-wide");
    expect(loadPluginConfig(row, row.config).slot).toBe("pack-wide");
  });
});
