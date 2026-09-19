import { describe, expect, it } from "vitest";
import {
  SYS_LAYOUT_KIND, cgroupParent, cgroupTree, diskColumns, gpuPodium, memoryBubbles,
  pullToward, socketBipartite, udevClusters, unitGrid,
} from "./sys-layouts";

describe("sys layouts", () => {
  it("maps each SYS view to a distinct chart kind", () => {
    expect(new Set(Object.values(SYS_LAYOUT_KIND)).size).toBe(7);
    expect(SYS_LAYOUT_KIND.memory).toBe("bubbles");
    expect(SYS_LAYOUT_KIND.disk).toBe("columns");
    expect(SYS_LAYOUT_KIND.gpu).toBe("podium");
    expect(SYS_LAYOUT_KIND.sockets).toBe("bipartite");
    expect(SYS_LAYOUT_KIND.cgroups).toBe("tree");
    expect(SYS_LAYOUT_KIND.units).toBe("grid");
    expect(SYS_LAYOUT_KIND.udev).toBe("clusters");
  });

  it("packs memory processes on a 2D disc around the hub", () => {
    const nodes = [
      { id: "mem:host", role: "self" },
      { id: "psi:cpu", role: "lan" },
      { id: "mem:proc:1", role: "lan", bytes_in: 900 },
      { id: "mem:proc:2", role: "lan", bytes_in: 100 },
    ];
    const t = memoryBubbles(nodes);
    expect(t.get("mem:host")).toEqual([0, 0, 0]);
    const a = t.get("mem:proc:1")!, b = t.get("mem:proc:2")!;
    expect(a[1]).toBe(0);
    expect(b[1]).toBe(0);
    expect(Math.hypot(a[0], a[2])).toBeLessThan(Math.hypot(b[0], b[2]));
  });

  it("stands disk devices up as 3D columns in front of I/O processes", () => {
    const t = diskColumns([
      { id: "disk:host", role: "self" },
      { id: "disk:nvme0n1", role: "lan", vendor: "block", cpu: 80 },
      { id: "disk:proc:9", role: "lan", cpu: 10 },
    ]);
    const disk = t.get("disk:nvme0n1")!, proc = t.get("disk:proc:9")!;
    expect(disk[1]).toBeGreaterThan(proc[1]);
    expect(disk[2]).toBeLessThan(proc[2]);
  });

  it("places GPU cards on a 3D podium in front of the host", () => {
    const t = gpuPodium([
      { id: "gpu:host", role: "self" },
      { id: "gpu:0", role: "lan", cpu: 40 },
      { id: "gpu:1", role: "lan", cpu: 5 },
    ]);
    expect(t.get("gpu:0")![2]).toBeLessThan(t.get("gpu:host")![2]);
    expect(t.get("gpu:0")![0]).not.toBe(t.get("gpu:1")![0]);
  });

  it("splits sockets into a 2D process | peer bipartite", () => {
    const t = socketBipartite([
      { id: "sock:host", role: "self" },
      { id: "sock:proc:1", role: "lan" },
      { id: "sock:peer:1.1.1.1", role: "internet" },
      { id: "sock:peer:10.0.0.2", role: "local" },
    ]);
    expect(t.get("sock:proc:1")![0]).toBeLessThan(0);
    expect(t.get("sock:peer:1.1.1.1")![0]).toBeGreaterThan(t.get("sock:peer:10.0.0.2")![0]);
  });

  it("walks cgroup paths into a 2D layered tree", () => {
    expect(cgroupParent("cg:root")).toBeNull();
    expect(cgroupParent("cg:user.slice")).toBe("cg:root");
    expect(cgroupParent("cg:user.slice/app.service")).toBe("cg:user.slice");
    const t = cgroupTree([
      { id: "cg:root", role: "self" },
      { id: "cg:user.slice", role: "gateway" },
      { id: "cg:user.slice/app.service", role: "lan" },
      { id: "cg:system.slice", role: "gateway" },
    ]);
    expect(t.get("cg:root")![2]).toBeLessThan(t.get("cg:user.slice")![2]);
    expect(t.get("cg:user.slice")![2]).toBeLessThan(t.get("cg:user.slice/app.service")![2]);
    expect(t.get("cg:user.slice")![0]).not.toBe(t.get("cg:system.slice")![0]);
    const wide = cgroupTree([
      { id: "cg:root", role: "self" },
      ...Array.from({ length: 24 }, (_, i) => ({ id: `cg:user.slice/n${i}`, role: "lan" })),
    ]);
    const xs = [...wide.values()].map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(280);
  });

  it("grids failed units above running ones", () => {
    const t = unitGrid([
      { id: "unit:host", role: "self" },
      { id: "unit:dead.service", role: "internet" },
      { id: "unit:ok.service", role: "lan" },
    ]);
    expect(t.get("unit:dead.service")![2]).toBeLessThan(t.get("unit:ok.service")![2]);
  });

  it("clusters udev devices by class and lifts new / gone nodes", () => {
    const t = udevClusters([
      { id: "udev:host", role: "self" },
      { id: "udev:net/eth0", role: "lan", vendor: "net" },
      { id: "udev:net/wlan0", role: "local", vendor: "net" },
      { id: "udev:drm/card0", role: "internet", vendor: "drm" },
    ]);
    const eth = t.get("udev:net/eth0")!, fresh = t.get("udev:net/wlan0")!, gone = t.get("udev:drm/card0")!;
    expect(fresh[1]).toBeGreaterThan(eth[1]);
    expect(gone[1]).toBeLessThan(eth[1]);
    expect(Math.abs(eth[0] - gone[0])).toBeGreaterThan(80);
  });

  it("pulls nodes toward targets", () => {
    const n = { id: "a", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    pullToward([n], new Map([["a", [100, 0, 0]]]), 1, 0.2);
    expect(n.vx).toBeGreaterThan(0);
  });
});
