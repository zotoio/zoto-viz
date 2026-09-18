import { describe, expect, it, afterEach } from "vitest";
import {
  applyPluginConfigs, applyPluginCatalog, attachPluginFrontend, collectPluginConfigs, compilePlugin, fetchPlugins, fieldDefault, grantPluginConsent, installPlugins,
  loadPluginConfig, lookForMode, mergeLook, parsePluginId, pluginHasFrontend, pluginModulePath, pluginNeedsReview, pluginSkyPath, pluginStageOnly, pluginViewId, shippedModeIds, specCaption,
  viewSelectOptions, writePluginConfig, type PluginView,
} from "./plugin";
import { pluginViewKnobs, toPluginView, VIEW_PROMPT_KEY } from "./plugin-visualisation";
import { PluginSandbox } from "./host";
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

afterEach(() => applyPluginCatalog([]));

describe("plugin ids and look", () => {
  it("parses plugin view ids", () => {
    expect(pluginViewId("pulse")).toBe("plugin:pulse");
    expect(parsePluginId("plugin:pulse")).toBe("pulse");
    expect(parsePluginId("topology")).toBeNull();
    expect(pluginNeedsReview(spec())).toBe(false);
    expect(pluginNeedsReview(spec({ id: "topology", name: "Topology" }))).toBe(false);
    expect(pluginNeedsReview(spec({ runtime: "typescript" }))).toBe(true);
    expect(pluginNeedsReview(spec({ has_frontend: true }))).toBe(true);
    expect(pluginNeedsReview(spec({ has_backend: true }))).toBe(true);
    expect(pluginNeedsReview(spec({ has_datasource: true }))).toBe(true);
    expect(pluginNeedsReview(spec({ service: "service/__init__.py" }))).toBe(true);
    expect(pluginNeedsReview(spec({ has_sky_shader: true }))).toBe(true);
    expect(pluginHasFrontend(spec())).toBe(false);
    expect(pluginHasFrontend(spec({ has_frontend: true }))).toBe(true);
    expect(pluginHasFrontend(spec({ runtime: "typescript" }))).toBe(true);
    expect(pluginModulePath("pulse")).toBe("/api/plugins/pulse/module.js");
    expect(pluginModulePath("pulse", "abc")).toBe("/api/plugins/pulse/module.js?h=abc");
    expect(pluginSkyPath("aurora")).toBe("/api/plugins/aurora/sky/fragment.glsl");
    expect(pluginSkyPath("aurora", "deadbeef")).toBe("/api/plugins/aurora/sky/fragment.glsl?h=deadbeef");
    expect(shippedModeIds().has("topology")).toBe(true);
    expect(shippedModeIds().has("doom")).toBe(true);
    expect(shippedModeIds().has("wifi")).toBe(true);
    expect(shippedModeIds().has("sources")).toBe(true);
    expect(mergeLook(DEFAULT_DREAM, null).backdrop).toBe(DEFAULT_DREAM.backdrop);
    expect(mergeLook(DEFAULT_DREAM, { backdrop: "matrix" }).backdrop).toBe("matrix");
    expect(mergeLook(DEFAULT_DREAM, { backdrop: "plugin" }).backdrop).toBe("plugin");
    expect(mergeLook(DEFAULT_DREAM, { graphFabric: "cloth" }).graphFabric).toBe("cloth");
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
    expect(collectPluginConfigs([s]).pulse?.prompt).toBe("");
    expect(pluginViewKnobs(s).some((f) => f.key === VIEW_PROMPT_KEY && f.type === "textarea")).toBe(true);
    applyPluginConfigs({ pulse: { gain: "2" } });
    expect(loadPluginConfig(s).gain).toBe("2");
    applyPluginConfigs(undefined);
  });

  it("falls back to legacy header mode keys for view options", () => {
    const s = spec({
      id: "talkers",
      options: [{ key: "rank", label: "rank by", values: [["rate", "rate"], ["bytes", "bytes"]], default: "bytes" }],
    });
    localStorage.setItem("zoto-viz.mode.plugin:talkers.rank", "rate");
    expect(loadPluginConfig(s, [{ key: "rank", label: "rank by", type: "select", values: [["rate", "rate"], ["bytes", "bytes"]], default: "bytes" }]).rank).toBe("rate");
    writePluginConfig("talkers", { rank: "bytes" });
    expect(loadPluginConfig(s, [{ key: "rank", label: "rank by", type: "select", values: [["rate", "rate"], ["bytes", "bytes"]], default: "bytes" }]).rank).toBe("bytes");
    localStorage.removeItem("zoto-viz.mode.plugin:talkers.rank");
    localStorage.removeItem("zoto-viz.plugin.talkers.rank");
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

  it("pins fabric mesh style onto the compiled graph mode", () => {
    const mode = compilePlugin(spec({ id: "cloth", style: { fabric: "cloth" } }));
    expect(mode.fabric).toBe("cloth");
    const off = compilePlugin(spec({ id: "plain", style: { flatten: true } }));
    expect(off.fabric).toBeUndefined();
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
    expect(arcade.kind).toBe("arcade");
    const storm = compilePlugin({
      id: "storm", name: "Storm", version: 1, engine: "graph", base: "talkers",
      capabilities: ["viz.read", "viz.write"], look: { backdrop: "plugin" },
    });
    expect(storm.kind).toBe("demo");
    expect(storm.stageOnly).toBe(true);
    expect(pluginStageOnly({
      engine: "graph", capabilities: ["viz.read"], look: { backdrop: "plugin" },
    })).toBe(true);
    expect(pluginStageOnly({
      engine: "graph", look: { backdrop: "none" },
    })).toBe(false);
    expect(pluginStageOnly({
      engine: "graph", capabilities: ["viz.write"], look: { backdrop: "plugin", stageOnly: false },
    })).toBe(false);
    expect(compilePlugin(toPluginView({
      id: "heat", name: "Heat", version: 1, engine: "graph", base: "talkers",
      look: { backdrop: "none" },
    })).stageOnly).toBe(false);
    expect(specCaption({ id: "air", name: "Air SSIDs", version: 1, engine: "graph", base: "wifi" })).toBe("AIR SSIDs");
    expect(specCaption({ id: "bt", name: "Air Bluetooth", version: 1, engine: "graph", base: "bluetooth" })).toBe("BT Bluetooth");
    expect(specCaption({ id: "cores", name: "CPU cores", version: 1, engine: "graph", base: "cores" })).toBe("CPU cores");
    expect(specCaption({ id: "source-web", name: "Source web", version: 1, engine: "graph", base: "sources" })).toBe("SRC Source web");
    expect(specCaption({ id: "pong", name: "Pong", version: 1, engine: "netpong" })).toBe("NET Pong");
    expect(specCaption({ id: "doom", name: "Doom", version: 1, engine: "doom" })).toBe("CPU Doom");
    applyPluginCatalog([spec({ id: "topology", name: "Topology" })]);
    expect(viewSelectOptions().some((o) => o.value === "plugin:topology" && o.label === "NET Topology")).toBe(true);
    applyPluginCatalog([]);
  });

  it("loads plugins from the API", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        dir: "", schema: "",
        plugins: [
          { id: "topology", name: "Topology", version: 1, engine: "graph", look: { backdrop: "space" }, has_frontend: false, frontend: { entry: "frontend/index.ts" }, capabilities: [], has_sky: false, has_sky_shader: false, has_backend: false, has_datasource: false },
          { id: "pulse", name: "Pulse", version: 1, engine: "graph", base: "topology", config: [{ key: "g", label: "g", type: "string" }], look: { backdrop: "matrix" }, has_frontend: true, frontend: { entry: "frontend/index.ts" }, capabilities: ["graph.read", "graph.style"], has_sky: false, has_sky_shader: false, has_backend: false, has_datasource: false },
        ],
        errors: [{ file: "x.yml", error: "nope" }],
      }),
    })) as never;
    const list = await installPlugins();
    expect(list.some((p) => p.id === "pulse")).toBe(true);
    const pulse = list.find((p) => p.id === "pulse")!;
    expect(pulse.has_frontend).toBe(true);
    expect(pulse.frontend?.entry).toBe("frontend/index.ts");
    expect(pulse.capabilities).toEqual(["graph.read", "graph.style"]);
    expect(pulse.has_sky).toBe(false);
    expect(pulse.has_sky_shader).toBe(false);
    expect(pulse.has_backend).toBe(false);
    expect(pulse.has_datasource).toBe(false);
    expect(list.find((p) => p.id === "topology")?.has_frontend).toBe(false);
    expect(lookForMode("plugin:pulse")?.backdrop).toBe("matrix");
    expect(lookForMode("plugin:topology")?.backdrop).toBe("space");
    expect(lookForMode("topology")).toBeUndefined();
    expect(viewSelectOptions().some((o) => o.value === "plugin:pulse" && o.label === "NET Pulse")).toBe(true);
    expect(viewSelectOptions().some((o) => o.value === "plugin:topology")).toBe(true);
    expect(viewSelectOptions().some((o) => o.value === "topology")).toBe(false);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      expect(String(url)).toContain("/api/plugins/pulse/module.js");
      return { ok: true, text: async () => "globalThis.fromModule = 1;" };
    }) as typeof fetch;
    const box = new PluginSandbox();
    await attachPluginFrontend(box, pulse, { g: "1" });
    expect(document.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    box.unload();
    await attachPluginFrontend(box, list.find((p) => p.id === "topology")!, {});
    expect(document.querySelector("iframe")).toBeNull();
    globalThis.fetch = origFetch;
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
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ ok: true }),
        clone: () => ({ json: async () => ({}) }),
      } as unknown as Response;
    }) as typeof fetch;
    await grantPluginConsent("pulse-ts", "reviewed");
    expect(body).toMatch(/reviewed/);
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      clone: () => ({ json: async () => ({ error: "consent" }) }),
    }) as unknown as Response) as typeof fetch;
    await expect(grantPluginConsent("pulse-ts", "authored")).rejects.toThrow(/consent/);
    globalThis.fetch = orig;
  });
});

describe("visualisation.yml", () => {
  it("round-trips a full visualisation fixture into PluginView", () => {
    const spec = toPluginView({
      id: "lan-heat",
      name: "LAN heat",
      version: 1,
      visualisation: {
        engine: "graph",
        base: "talkers",
        look: { backdrop: "plugin", theme: "ember", stageOnly: true },
        style: { nodeColor: "heat", nodeScale: "rate", labels: "top" },
        layout: { lanShell: 220, internetShell: 640 },
        options: {
          rank: { label: "rank by", default: "rate", values: [["rate", "rate"], ["bytes", "bytes"]] },
        },
        config: [
          { key: "internet", label: "internet hosts", type: "select", default: "dim", values: [["dim", "dim"], ["hide", "hide"]] },
        ],
      },
    });
    expect(spec.engine).toBe("graph");
    expect(spec.base).toBe("talkers");
    expect(spec.look?.backdrop).toBe("plugin");
    expect(spec.look?.stageOnly).toBe(true);
    expect(spec.style?.nodeColor).toBe("heat");
    expect(spec.layout?.lanShell).toBe(220);
    expect(spec.options?.[0]?.key).toBe("rank");
    expect(spec.config?.[0]?.key).toBe("internet");
    const mode = compilePlugin(spec);
    expect(mode.id).toBe("plugin:lan-heat");
    expect(mode.pluginId).toBe("lan-heat");
    expect(mode.graphBase).toBe("talkers");
    expect(mode.label).toBe("LAN heat");
    expect(mode.standalone).toBe(false);
    expect(mode.stageOnly).toBe(true);
  });

  it("parses fabric style and look pins", () => {
    const spec = toPluginView({
      id: "cloth",
      name: "Cloth",
      version: 1,
      visualisation: {
        engine: "graph",
        base: "topology",
        style: { fabric: "tubes" },
        look: { graphFabric: "ribbon" },
      },
    });
    expect(spec.style?.fabric).toBe("tubes");
    expect(spec.look?.graphFabric).toBe("ribbon");
    expect(compilePlugin(spec).fabric).toBe("tubes");
  });

  it("still loads a plugin with no visualisation.yml", () => {
    const spec = toPluginView({
      id: "agent-only", name: "Agent", version: 1,
      has_frontend: true, has_backend: true, capabilities: ["graph.read"],
      has_sky_shader: true, sky_available: false, sky_error: "awaiting review",
      shader_sha256: "abc",
    });
    expect(spec.engine).toBeUndefined();
    expect(spec.has_frontend).toBe(true);
    expect(spec.has_backend).toBe(true);
    expect(spec.has_sky_shader).toBe(true);
    expect(spec.sky_available).toBe(false);
    expect(spec.sky_error).toBe("awaiting review");
    expect(spec.shader_sha256).toBe("abc");
    const modes = applyPluginCatalog([spec]);
    expect(modes.some((m) => m.pluginId === "agent-only")).toBe(false);
  });

  it("compiles a former shipped id as a GRAPH_BASES wrap", () => {
    const mode = compilePlugin(toPluginView({
      id: "topology", name: "Topology", version: 1, engine: "graph", base: "topology",
    }));
    expect(mode.id).toBe("plugin:topology");
    expect(mode.graphBase).toBe("topology");
    expect(mode.standalone).toBe(false);
    const src = compilePlugin(toPluginView({
      id: "source-web", name: "Source web", version: 1, engine: "graph", base: "sources",
    }));
    expect(src.graphBase).toBe("sources");
    expect(src.kind).toBe("graph");
    expect(src.stageOnly).toBe(false);
    expect(mode.pluginId).toBe("topology");
  });

  it("maps arcade engines including doom onto arcadeId", () => {
    const doom = compilePlugin({ id: "doom", name: "Doom", version: 1, engine: "doom" });
    expect(doom.arcadeId).toBe("doom");
    expect(doom.standalone).toBe(true);
  });

  it("rejects unknown visualisation.engine", () => {
    expect(() => toPluginView({ id: "x", name: "X", version: 1, engine: "nope" })).toThrow(/unknown visualisation.engine/);
  });

  it("overlays a later duplicate plugin id onto the first catalog row", () => {
    applyPluginCatalog([
      spec({ id: "pulse", look: { backdrop: "matrix" } }),
      spec({ id: "pulse", look: { backdrop: "space", theme: "ember" } }),
      spec({ id: "heat", name: "Heat", look: { backdrop: "fire" } }),
    ]);
    expect(lookForMode("plugin:pulse")?.backdrop).toBe("space");
    expect(lookForMode("plugin:pulse")?.theme).toBe("ember");
    expect(lookForMode("plugin:heat")?.backdrop).toBe("fire");
    const extras = viewSelectOptions().filter((o) => o.value.startsWith("plugin:"));
    expect(extras.filter((o) => o.value === "plugin:pulse")).toHaveLength(1);
    expect(extras.some((o) => o.value === "plugin:heat")).toBe(true);
    expect(viewSelectOptions().some((o) => o.value === "pulse" || o.value === "topology")).toBe(false);
    applyPluginCatalog([]);
  });
});
