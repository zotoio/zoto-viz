import { afterEach, describe, expect, it } from "vitest";
import {
  ARCADE_ENGINES, GRAPH_BASES, BT_MAX_NODES, BT_MAX_NODES_CEILING, allModes, bluetooth, capBluetoothDevices, categorize, CPU_RED, cpuHeat, defaultCatalogMode, defaultOpts, graphModes, hashColor, heat,
  droneFormationPoint, droneShow, droneShowLive, layersInternetLive, modeById, orgOf, paneLabelCap, parseWatchList, pluginMenuRows, setPluginModes, sources, topology, viewCaption, viewSource, wifi,
} from "./modes";
import type { Device } from "./types";

const catalogRow = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  ...topology,
  id: `plugin:${id}`,
  pluginId: id,
  label,
  standalone: false,
  ...extra,
});

afterEach(() => setPluginModes([]));

describe("modes", () => {
  it("keeps host engines as wrap targets, not live menu rows", () => {
    expect(allModes()).toEqual([]);
    expect(GRAPH_BASES.some((m) => m.id === "topology")).toBe(true);
    expect(GRAPH_BASES.some((m) => m.id === "wifi")).toBe(true);
    expect(GRAPH_BASES.some((m) => m.id === "bluetooth")).toBe(true);
    expect(GRAPH_BASES.some((m) => m.id === "cpu")).toBe(true);
    expect(GRAPH_BASES.some((m) => m.id === "sources")).toBe(true);
    expect(new Set(GRAPH_BASES.map((m) => m.id)).size).toBe(GRAPH_BASES.length);
    expect(ARCADE_ENGINES.map((m) => m.id)).toEqual([
      "netpong", "invaders", "command", "frogger", "cpupong", "doom",
      "waves", "orbits", "helix", "skyline", "pacman", "tetris", "portal",
    ]);
    expect(ARCADE_ENGINES.every((m) => m.standalone)).toBe(true);
  });

  it("builds legends and default opts for every host engine", () => {
    for (const m of [...GRAPH_BASES, ...ARCADE_ENGINES]) {
      const opts = defaultOpts(m);
      expect(Array.isArray(m.legend(opts))).toBe(true);
    }
    expect(Array.isArray(wifi.legend(defaultOpts(wifi)))).toBe(true);
    expect(Array.isArray(bluetooth.legend(defaultOpts(bluetooth)))).toBe(true);
  });

  it("does not assume a hardcoded topology menu row when the catalog is empty", () => {
    setPluginModes([]);
    expect(allModes()).toEqual([]);
    expect(defaultCatalogMode()).toBeUndefined();
    expect(() => modeById("missing")).not.toThrow();
    const stub = modeById("missing");
    expect(allModes().some((m) => m.id === stub.id)).toBe(false);
    expect(stub.id).toBe("topology");
  });

  it("falls back to the catalog topology plugin, then first sorted catalog id", () => {
    const heatRow = catalogRow("heat", "LAN heat");
    const topo = catalogRow("topology", "Topology");
    setPluginModes([heatRow, topo]);
    expect(defaultCatalogMode()?.id).toBe("plugin:topology");
    expect(modeById("missing").id).toBe("plugin:topology");
    expect(modeById("topology").id).toBe("plugin:topology");
    expect(modeById("plugin:topology").id).toBe("plugin:topology");
    setPluginModes([heatRow, catalogRow("pulse", "Pulse")]);
    expect(defaultCatalogMode()?.pluginId).toBe("heat");
    expect(modeById("missing").pluginId).toBe("heat");
  });

  it("hashes, heats, categorises, and parses watch lists", () => {
    expect(hashColor("a")).toBe(hashColor("a"));
    expect(heat(0)).toBeTypeOf("number");
    expect(heat(1)).toBeTypeOf("number");
    expect(heat(0.4)).toBeTypeOf("number");
    expect(cpuHeat(0)).toBe(heat(0));
    expect(cpuHeat(CPU_RED)).toBe(heat(1));
    expect(cpuHeat(100)).toBe(heat(1));
    expect(categorize(["udp/53"]).id).toBe("dns");
    expect(categorize(["tcp/443"]).id).toBe("tls");
    expect(categorize(["udp/443"]).id).toBe("quic");
    expect(categorize([])).toBeTruthy();
    expect(parseWatchList("a, b, c")).toEqual(["a", "b", "c"]);
    expect(paneLabelCap({ smallPane: true, labelCount: 10 } as never, 10)).toBe(5);
    expect(paneLabelCap({ smallPane: false, labelCount: 10 } as never)).toBe(10);
    setPluginModes([catalogRow("x", "X")]);
    expect(allModes().some((m) => m.id === "plugin:x")).toBe(true);
    expect(allModes().some((m) => m.id === "topology")).toBe(false);
    setPluginModes([]);
    expect(orgOf({ ip: "1.1.1.1", names: ["api.google.com"], hostnames: [], role: "internet" } as unknown as Device).length).toBeGreaterThan(0);
    expect(viewSource(topology)).toBe("NET");
    expect(viewSource({ id: "doom" })).toBe("CPU");
    expect(viewSource(sources)).toBe("SRC");
    expect(viewCaption(topology)).toBe("NET Topology");
    expect(viewCaption(sources)).toBe("SRC Source web");
    expect(viewCaption(wifi)).toMatch(/^AIR /);
    expect(viewCaption(bluetooth)).toMatch(/^BT /);
  });

  it("caps Bluetooth advertisers, keeping this host and named devices first", () => {
    const bt = (over: Partial<Device>): Device => ({
      ip: "bt:00:00:00:00:00:00", mac: "00:00:00:00:00:00", vendor: "", hostnames: [], names: [],
      sources: [], ports: [], ifaces: [], aliases: [], first_seen: 0, last_seen: 0,
      bytes_in: 0, bytes_out: 0, packets: 0, role: "lan", online: true, ...over,
    });
    const self = bt({ ip: "bt:aa:aa:aa:aa:aa:aa", role: "self", last_seen: 1, packets: 1 });
    const named = bt({ ip: "bt:11:11:11:11:11:11", hostnames: ["Hue bulb"], last_seen: 50, packets: 2 });
    const crowd = Array.from({ length: 80 }, (_, i) => bt({
      ip: `bt:00:00:00:00:00:${i.toString(16).padStart(2, "0")}`,
      last_seen: 100 + i,
      packets: 10 + i,
    }));
    const kept = capBluetoothDevices([self, named, ...crowd], { top: "16" });
    expect(kept).toHaveLength(16);
    expect(kept.some((d) => d.role === "self")).toBe(true);
    expect(kept.some((d) => d.hostnames.includes("Hue bulb"))).toBe(true);
    expect(capBluetoothDevices(crowd).length).toBe(BT_MAX_NODES);
    expect(capBluetoothDevices(crowd, { top: "999" })).toHaveLength(BT_MAX_NODES_CEILING);
    const field = bluetooth.config?.find((f) => f.key === "top");
    expect(field?.max).toBe(BT_MAX_NODES_CEILING);
    expect(defaultOpts(bluetooth).top).toBe(String(BT_MAX_NODES));
  });

  it("adds unique plugin ids as menu rows and overlays a later duplicate onto the first catalog row", () => {
    const a = catalogRow("pulse", "Pulse");
    const b = catalogRow("pulse", "Pulse overlay");
    const c = catalogRow("heat", "LAN heat");
    setPluginModes([a, b, c]);
    expect(allModes().map((m) => m.pluginId)).toEqual(["pulse", "heat"]);
    expect(allModes().map((m) => m.label)).toEqual(["Pulse", "LAN heat"]);
    expect(allModes().some((m) => m.id === "topology")).toBe(false);
    expect(pluginMenuRows([a, b, c])).toHaveLength(2);
    expect(graphModes().every((m) => !m.standalone)).toBe(true);
  });

  it("drops a catalog id from the menu while the host engine remains wrappable", () => {
    setPluginModes([catalogRow("topology", "Topology"), catalogRow("talkers", "Top talkers")]);
    expect(allModes().some((m) => m.pluginId === "topology")).toBe(true);
    setPluginModes([catalogRow("talkers", "Top talkers")]);
    expect(allModes().some((m) => m.pluginId === "topology")).toBe(false);
    expect(GRAPH_BASES.some((m) => m.id === "topology")).toBe(true);
  });

  it("waves the layers internet stack by column and time", () => {
    const a = layersInternetLive(1.2, 0, 0, 0);
    const b = layersInternetLive(1.2, 3, 1, 7);
    expect(a.shape).toBeGreaterThanOrEqual(0);
    expect(a.shape).toBeLessThanOrEqual(5);
    expect(a.dy).not.toBe(b.dy);
    expect(a.dx).not.toBe(b.dx);
    expect(layersInternetLive(1.2, 0, 0, 0).dy).toBe(a.dy);
    expect(a.scale).toBeGreaterThan(0.7);
    expect(Math.abs(a.spin)).toBeGreaterThan(0);
    expect(a.glow).toBeGreaterThanOrEqual(0);
  });

  it("places a 3D drone fleet and yaws the craft", () => {
    expect(GRAPH_BASES.some((m) => m.id === "drone-show")).toBe(true);
    expect(droneShow.camera?.[1]).toBeLessThan(80);
    const a = droneFormationPoint("sphere", 0, 16, 1);
    const b = droneFormationPoint("sphere", 8, 16, 1);
    expect(a[1]).toBeGreaterThan(80);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(20);
    const helix = droneFormationPoint("helix", 0, 12);
    const helixTop = droneFormationPoint("helix", 11, 12);
    expect(helixTop[1]).toBeGreaterThan(helix[1]);
    const rings = droneFormationPoint("rings", 0, 20);
    expect(rings[1]).toBeGreaterThan(50);
    const wave = droneFormationPoint("wave", 3, 20);
    expect(Number.isFinite(wave[0])).toBe(true);
    const look = droneShowLive(1.4, 2, 80);
    expect(look.shape).toBe(6);
    expect(look.spin).not.toBe(droneShowLive(1.4, 9, 0).spin);
    expect(look.glow).toBeGreaterThan(droneShowLive(1.4, 2, 0).glow);
    const opts = defaultOpts(droneShow);
    expect(opts.form).toBe("sphere");
    expect(droneShow.legend(opts).length).toBeGreaterThan(2);
  });
});
