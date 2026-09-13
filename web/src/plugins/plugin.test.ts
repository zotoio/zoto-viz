import { describe, expect, it } from "vitest";
import {
  applyPluginConfigs, collectPluginConfigs, compilePlugin, fetchPlugins, fieldDefault, grantPluginConsent, installPlugins,
  loadPluginConfig, lookForMode, mergeLook, parsePluginId, pluginNeedsReview, pluginViewId, shippedModeIds, specCaption,
  viewSelectOptions, writePluginConfig, type PluginView,
} from "./plugin";
import { DEFAULT_DREAM } from "../graph/scene";
import type { GNode } from "../graph/scene";
import type { Device } from "../core/types";

const device = (over: Partial<Device> = {}): Device => ({
  ip: "192.168.86.10", mac: "", vendor: "", hostnames: [], names: ["nest"], sources: [], ports: ["tcp/443"],
  ifaces: [], aliases: [], first_seen: 0, last_seen: 0, bytes_in: 100, bytes_out: 50, packets: 3,
  role: "lan", online: true, ...over,
});

const node = (over: Partial<GNode> = {}, d?: Device): GNode => ({
  id: d?.ip ?? "192.168.86.10",
  device: d ?? device(),
  color: { getHex: () => 0 } as never,
  scale: 1, glow: 0, opacity: 1, shape: 0, label: {} as never, labelEl: document.createElement("div"),
  visible: true, active: true, rate: 12, targetScale: 1, px: 0, py: 0, pz: 0, ...over,
} as GNode);

const spec = (over: Partial<PluginView> = {}): PluginView => ({
  id: "pulse", name: "Pulse", version: 1, engine: "graph", base: "topology", ...over,
});

describe("plugin ids and look", () => {
  it("parses plugin view ids", () => {
    expect(pluginViewId("pulse")).toBe("plugin:pulse");
    expect(parsePluginId("plugin:pulse")).toBe("pulse");
    expect(parsePluginId("topology")).toBeNull();
    expect(pluginNeedsReview(spec())).toBe(false);
    expect(pluginNeedsReview(spec({ runtime: "typescript" }))).toBe(true);
    expect(pluginNeedsReview(spec({ service: "service/__init__.py" }))).toBe(true);
    expect(shippedModeIds().has("topology")).toBe(true);
    expect(mergeLook(DEFAULT_DREAM, null).backdrop).toBe(DEFAULT_DREAM.backdrop);
    expect(mergeLook(DEFAULT_DREAM, { backdrop: "matrix" }).backdrop).toBe("matrix");
    expect(lookForMode("missing")).toBeUndefined();
  });
});

describe("plugin config", () => {
  it("defaults, stores, and collects field values", () => {
    expect(fieldDefault({ key: "x", label: "x", type: "boolean", default: true })).toBe("1");
    expect(fieldDefault({ key: "x", label: "x", type: "boolean" })).toBe("0");
    expect(fieldDefault({ key: "n", label: "n", type: "number", min: 3 })).toBe("3");
    expect(fieldDefault({ key: "s", label: "s", type: "select", values: [["a", "A"]] })).toBe("a");
    expect(fieldDefault({ key: "t", label: "t", type: "text" })).toBe("");
    const s = spec({ config: [{ key: "gain", label: "gain", type: "number", default: 4 }] });
    writePluginConfig("pulse", { gain: "9" });
    expect(loadPluginConfig(s).gain).toBe("9");
    expect(collectPluginConfigs([s]).pulse?.gain).toBe("9");
    applyPluginConfigs({ pulse: { gain: "2" } });
    expect(loadPluginConfig(s).gain).toBe("2");
    applyPluginConfigs(undefined);
  });
});

describe("compilePlugin", () => {
  it("wraps a graph base and styles nodes", () => {
    const mode = compilePlugin(spec({
      style: { nodeColor: "role", nodeScale: "bytes", labels: "all", flatten: true },
      layout: { lanShell: 40, internetShell: 90 },
      options: [{ key: "rank", label: "rank", values: [["bytes", "bytes"]], default: "bytes" }],
    }));
    expect(mode.id).toBe("plugin:pulse");
    expect(mode.pluginId).toBe("pulse");
    const lan = node();
    const wan = node({}, device({ ip: "1.1.1.1", role: "internet", names: ["cdn"] }));
    const ctx = {
      now: 1, nodes: new Map([[lan.id, lan], [wan.id, wan]]), links: new Map(),
      opts: { rank: "bytes", top: "8", internet: "dim" }, gateway: "", localIp: "", selected: null,
      spreadX: 1, spreadZ: 1, labelCount: 10,
    };
    mode.prepare?.(ctx);
    expect(mode.nodeColor?.(lan, ctx)).toBeTypeOf("number");
    expect(mode.nodeColor?.(wan, ctx)).toBeTypeOf("number");
    expect(mode.nodeScale?.(lan, ctx)).toBeGreaterThan(0);
    expect(mode.forceLabel?.(lan, ctx)).toBe(true);
    expect(mode.suppressLabel?.(lan, ctx)).toBe(false);
    expect(mode.shellRadius?.(lan, { self: 1, gateway: 2, lan: 3, local: 4, internet: 5, multicast: 6 })).toBe(40);
  });

  it("honours label and colour variants", () => {
    const styles = ["kind", "heat", "proto", "hash"] as const;
    for (const nodeColor of styles) {
      const mode = compilePlugin(spec({ id: nodeColor, style: { nodeColor, labels: "none" } }));
      const n = node({ rate: 8 });
      const ctx = {
        now: 1, nodes: new Map([[n.id, n]]), links: new Map(), opts: { internet: "hide" },
        gateway: "", localIp: "", selected: null, spreadX: 1, spreadZ: 1, labelCount: 4,
      };
      mode.prepare?.(ctx);
      mode.nodeColor?.(n, ctx);
      expect(mode.forceLabel?.(n, ctx)).toBe(false);
      expect(mode.suppressLabel?.(n, ctx)).toBe(true);
    }
    const top = compilePlugin(spec({ id: "top", style: { labels: "top", nodeScale: "rate" } }));
    const n = node({ rate: 20 });
    const ctx = {
      now: 1, nodes: new Map([[n.id, n]]), links: new Map(), opts: { rank: "rate", top: "1" },
      gateway: "", localIp: "", selected: null, spreadX: 1, spreadZ: 1, labelCount: 4,
    };
    top.prepare?.(ctx);
    expect(top.forceLabel?.(n, ctx)).toBe(true);
    expect(top.nodeScale?.(n, ctx)).toBeGreaterThan(0);
  });

  it("compiles arcade plugins and view options", () => {
    const arcade = compilePlugin({ id: "pong", name: "Pong", version: 1, engine: "netpong" });
    expect(arcade.standalone).toBe(true);
    expect(arcade.arcadeId).toBe("netpong");
    expect(specCaption({ id: "air", name: "Air SSIDs", version: 1, engine: "graph", base: "wifi" })).toBe("AIR SSIDs");
    expect(specCaption({ id: "bt", name: "Air Bluetooth", version: 1, engine: "graph", base: "bluetooth" })).toBe("BT Bluetooth");
    expect(specCaption({ id: "cores", name: "CPU cores", version: 1, engine: "graph", base: "cores" })).toBe("CPU cores");
    expect(specCaption({ id: "pong", name: "Pong", version: 1, engine: "netpong" })).toBe("NET Pong");
    expect(viewSelectOptions().some((o) => o.value === "topology" && o.label === "NET Topology")).toBe(true);
  });

  it("loads plugins from the API", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        dir: "", schema: "",
        plugins: [
          { id: "topology", name: "Topology", version: 1, engine: "graph", look: { backdrop: "space" } },
          { id: "pulse", name: "Pulse", version: 1, engine: "graph", base: "topology", config: [{ key: "g", label: "g", type: "string" }], look: { backdrop: "matrix" } },
        ],
        errors: [{ file: "x.yml", error: "nope" }],
      }),
    })) as never;
    const list = await installPlugins();
    expect(list.some((p) => p.id === "pulse")).toBe(true);
    expect(lookForMode("plugin:pulse")?.backdrop).toBe("matrix");
    expect(viewSelectOptions().some((o) => o.value === "plugin:pulse" && o.label === "NET Pulse")).toBe(true);
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as never;
    await expect(fetchPlugins()).rejects.toThrow(/plugins/);
    globalThis.fetch = (async () => { throw new Error("offline"); }) as never;
    expect(await installPlugins()).toEqual([]);
    globalThis.fetch = orig;
  });

  it("records source-review consent", async () => {
    const orig = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body || "");
      return { ok: true, headers: { get: () => null }, json: async () => ({ ok: true }) } as unknown as Response;
    }) as typeof fetch;
    await grantPluginConsent("pulse-ts", "reviewed");
    expect(body).toMatch(/reviewed/);
    globalThis.fetch = (async () => ({ ok: false, status: 403, headers: { get: () => null } }) as unknown as Response) as typeof fetch;
    await expect(grantPluginConsent("pulse-ts", "authored")).rejects.toThrow(/consent/);
    globalThis.fetch = orig;
  });
});
