import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { StateMsg } from "../../core/types";
import { isSysBase, type ViewMode } from "../../core/modes";
import { paintFeedState } from "../../app/feed-paint";
import { buildIdleVizFrame } from "./idle-viz-frame";
import { goldenLanFixture } from "./golden-lan-state";
import {
  hostIdleTargetForMode,
  mergeHostIdleForSlot,
  withGoldenIfIdle,
} from "./golden-state";
import {
  compileShippedPackMode,
  hostIdleOfShippedPack,
  listHostIdleShippedPackIds,
  loadShippedPackSpec,
} from "./host-idle-shipped-packs";
import {
  packetTunnelDemoBranchCount,
  packetTunnelFields,
  resetPacketTunnelDemoBranchCount,
} from "../../../../plugins/src/packet-tunnel/frontend/tunnel";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function emptyMonitorState(ts = 1): StateMsg {
  return {
    type: "state",
    ts,
    iface: "",
    interfaces: [],
    network: "",
    local_ip: "",
    gateway: "",
    uptime: 0,
    stats: {
      pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
    },
    devices: [],
    flows: [],
  };
}

function graphNodeCount(state: StateMsg, mode: ViewMode): number {
  const base = mode.graphBase;
  if (base === "bluetooth" || base === "wifi" || base === "cpu" || (base && isSysBase(base))) {
    return state.views?.[base]?.devices?.length ?? 0;
  }
  const active = state.devices.filter((d) => d.online && d.packets > 0 && d.role !== "multicast");
  return active.length;
}

const HOST_IDLE_PACKS = listHostIdleShippedPackIds(repoRoot);

describe("host idle fixture merge", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("discovers host idle packs from plugins/src plugin.yml trees", () => {
    const manual = readdirSync(path.join(repoRoot, "plugins/src"))
      .filter((id) => existsSync(path.join(repoRoot, "plugins/src", id, "plugin.yml")));
    expect(HOST_IDLE_PACKS.length).toBeGreaterThan(20);
    for (const id of HOST_IDLE_PACKS) {
      expect(manual).toContain(id);
      const dir = path.join(repoRoot, "plugins/src", id);
      const texts = [
        readFileSync(path.join(dir, "plugin.yml"), "utf8"),
        ...(existsSync(path.join(dir, "visualisation.yml"))
          ? [readFileSync(path.join(dir, "visualisation.yml"), "utf8")]
          : []),
      ];
      expect(texts.some((t) => /fixture:\s*host/.test(t))).toBe(true);
    }
  });

  for (const packId of HOST_IDLE_PACKS) {
    it(`pack ${packId} fills empty live slice`, () => {
      const mode = compileShippedPackMode(repoRoot, packId);
      const idle = hostIdleOfShippedPack(repoRoot, packId);
      expect(idle).toEqual({ fixture: "host" });
      const target = hostIdleTargetForMode(mode);
      const empty = emptyMonitorState();
      const slot = mergeHostIdleForSlot(empty, { slotId: "hero", idle, target });
      expect(slot.isDemo).toBe(true);
      expect(graphNodeCount(slot.state, mode)).toBeGreaterThan(0);

      const painted = paintFeedState({
        raw: empty,
        heroModeId: mode.id,
        mosaicOn: false,
        mosaicTileIds: [],
        modeById: (id) => (id === mode.id ? mode : mode),
        pluginSpecForMode: () => loadShippedPackSpec(repoRoot, packId),
      });
      expect(painted.demoSlots.has("hero")).toBe(true);
      const hero = painted.slotPaints.get("hero")!;
      expect(graphNodeCount(hero, mode)).toBeGreaterThan(0);

      const viaGolden = withGoldenIfIdle(empty, idle);
      if (target.kind === "main") {
        expect(viaGolden.devices.length).toBeGreaterThan(0);
      }
    });
  }

  it("live slice wins over golden host fixture", () => {
    const golden = goldenLanFixture();
    const bases = ["bluetooth", "memory", "disk", "bridge"] as const;
    for (const base of bases) {
      const slice = golden.views?.[base];
      expect(slice?.devices.length ?? 0).toBeGreaterThan(0);
      const live: StateMsg = {
        ...emptyMonitorState(),
        views: { [base]: slice },
      };
      const before = slice!.devices.length;
      const { state, isDemo } = mergeHostIdleForSlot(live, {
        slotId: "hero",
        idle: { fixture: "host" },
        target: { kind: "view", base },
      });
      expect(isDemo).toBe(false);
      expect(state.views?.[base]?.devices.length).toBe(before);
    }
    const liveLan = goldenLanFixture();
    liveLan.devices[0]!.packets = 999;
    const main = mergeHostIdleForSlot(liveLan, {
      slotId: "hero",
      idle: { fixture: "host" },
      target: { kind: "main" },
    });
    expect(main.isDemo).toBe(false);
    expect(main.state.devices[0]!.packets).toBe(999);
  });

  it("packet-tunnel no-traffic demo branch once per frame without idle packets", () => {
    resetPacketTunnelDemoBranchCount();
    const quiet = { t: 1.25, dt: 0.016, packets: [] as { proto: string; size: number; field: number }[] };
    packetTunnelFields(quiet);
    expect(packetTunnelDemoBranchCount).toBe(1);
    packetTunnelFields(quiet);
    expect(packetTunnelDemoBranchCount).toBe(2);

    resetPacketTunnelDemoBranchCount();
    const idle = buildIdleVizFrame(1.25, 0.016);
    expect(idle.packets.length).toBeGreaterThan(0);
    packetTunnelFields(idle);
    expect(packetTunnelDemoBranchCount).toBe(0);
  });
});
