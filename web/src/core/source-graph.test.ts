import { describe, expect, it } from "vitest";
import { jsonLeaves, sourcesSlice, SRC_HUB } from "./source-graph";
import type { SourceLive } from "./sources";

const live = (over: Partial<SourceLive> & Pick<SourceLive, "id" | "kind">): SourceLive => ({
  label: over.id,
  ok: true,
  feed: true,
  ...over,
});

describe("jsonLeaves", () => {
  it("prefers title/name and walks nested objects", () => {
    const rows = jsonLeaves({ title: "Hello", nested: { name: "World", n: 3 } }, 8);
    expect(rows.map((r) => r.text)).toEqual(expect.arrayContaining(["Hello", "World", "3"]));
  });
});

describe("sourcesSlice", () => {
  it("builds a hub, one feed, and RSS items — not LAN devices", () => {
    const slice = sourcesSlice({
      hn: live({
        id: "hn", kind: "rss", label: "HN",
        items: [{ title: "Jemalloc" }, { title: "Waymo" }],
      }),
    });
    expect(slice.gateway).toBe(SRC_HUB);
    expect(slice.localIp).toBe(SRC_HUB);
    expect(slice.devices.some((d) => d.ip === SRC_HUB && d.role === "self")).toBe(true);
    expect(slice.devices.some((d) => d.ip === "src:feed:hn" && d.vendor === "rss")).toBe(true);
    expect(slice.devices.map((d) => d.names[0])).toEqual(expect.arrayContaining(["Jemalloc", "Waymo"]));
    expect(slice.devices.every((d) => d.ip.startsWith("src:"))).toBe(true);
    expect(slice.flows.some((f) => f.a === SRC_HUB && f.b === "src:feed:hn")).toBe(true);
  });

  it("maps HTTP JSON leaves and file lines to different roles", () => {
    const slice = sourcesSlice({
      api: live({ id: "api", kind: "http", json: { users: [{ name: "Ada" }, { name: "Grace" }] } }),
      notes: live({ id: "notes", kind: "file", text: "alpha\nbeta\n" }),
    });
    const ada = slice.devices.find((d) => d.names[0] === "Ada");
    const alpha = slice.devices.find((d) => d.names[0] === "alpha");
    expect(ada?.role).toBe("internet");
    expect(ada?.vendor).toBe("http");
    expect(alpha?.role).toBe("local");
    expect(alpha?.vendor).toBe("file");
  });

  it("filters by kind", () => {
    const slice = sourcesSlice({
      hn: live({ id: "hn", kind: "rss", items: [{ title: "A" }] }),
      notes: live({ id: "notes", kind: "file", text: "only-file" }),
    }, { kind: "file" });
    expect(slice.devices.some((d) => d.ip === "src:feed:hn")).toBe(false);
    expect(slice.devices.some((d) => d.names[0] === "only-file")).toBe(true);
  });

  it("keeps a failed feed offline without children", () => {
    const slice = sourcesSlice({
      down: live({ id: "down", kind: "rss", ok: false, items: [{ title: "Hidden" }] }),
    });
    expect(slice.devices.find((d) => d.ip === "src:feed:down")?.online).toBe(false);
    expect(slice.devices.some((d) => d.names[0] === "Hidden")).toBe(false);
  });
});
