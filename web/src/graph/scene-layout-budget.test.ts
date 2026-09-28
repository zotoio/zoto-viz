/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";
import { LAYOUT_BODY_SATELLITE } from "./layout-budget";
import { topology, type ViewMode } from "../core/modes";
import type { Device, Role, StateMsg } from "../core/types";

vi.mock("./webgl", () => ({
  probeWebGL: vi.fn(() => true),
  disposeOwnedWebGLRenderer: vi.fn(),
}));

function dev(ip: string, role: Role, bytes: number): Device {
  return {
    ip, mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [], ifaces: [], aliases: [],
    first_seen: 1, last_seen: 1, bytes_in: bytes, bytes_out: 0, packets: 1, role, online: false,
  };
}

function state(devices: Device[]): StateMsg {
  return {
    type: "state",
    ts: 10,
    iface: "eth0",
    interfaces: ["eth0"],
    network: "10.0.0.0/24",
    local_ip: "me",
    gateway: "gw",
    uptime: 1,
    stats: { pps: 0, bps: 0, packets: 0, bytes: 0, devices: devices.length, online: 0, flows: 0, active_flows: 0 },
    devices,
    flows: [],
  };
}

describe("NetScene layout budget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function makeScene(satellite: boolean): { scene: NetScene; host: RenderHost } {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 600 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 300 });
    wall.appendChild(pane);
    return { scene: new NetScene(pane, { host, satellite }), host };
  }

  it("keeps a 200-node offline snapshot inside the satellite worker budget", () => {
    const { scene, host } = makeScene(true);
    scene.setFilters({ lan: true, internet: true, multicast: true, offline: true, labels: true, cpuIdle: true });
    const devices = [dev("gw", "gateway", 5), dev("me", "self", 5)];
    for (let i = 0; i < 200; i++) devices.push(dev(`203.0.113.${i % 250}-${i}`, "internet", i));
    scene.update(state(devices));
    const sim = (scene as unknown as { simNodes: unknown[] }).simNodes;
    const layout = (scene as unknown as { layout: unknown }).layout;
    expect(sim.length).toBeLessThanOrEqual(LAYOUT_BODY_SATELLITE);
    expect(sim.length).toBeGreaterThan(0);
    expect(layout).toBeTruthy();
    scene.dispose();
    host.dispose();
  });

  it("a stage-only mode creates no layout client and no nodes", () => {
    const { scene, host } = makeScene(true);
    const stage: ViewMode = { ...topology, id: "plugin:fractal-zoom", stageOnly: true, label: "Fractal" };
    scene.setMode(stage, {});
    const devices = [dev("gw", "gateway", 5)];
    for (let i = 0; i < 40; i++) devices.push(dev(`198.51.100.${i}`, "internet", i));
    scene.update(state(devices));
    expect(scene.nodeCount).toBe(0);
    expect((scene as unknown as { layout: unknown }).layout).toBeNull();
    expect((scene as unknown as { simNodes: unknown[] }).simNodes).toEqual([]);
    scene.dispose();
    host.dispose();
  });
});
