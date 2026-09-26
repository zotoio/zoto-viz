import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox, consentHash, hashConsented, hostAllows, pluginModuleUrl, setTsPluginsAllowed, tsPluginsAllowed } from "./host";
import { defaultVizContract } from "./viz-host";

describe("hash consent and TypeScript allow", () => {
  afterEach(() => {
    localStorage.removeItem("zoto-viz.tsPlugins");
    localStorage.removeItem("zoto-viz.tsHashes");
  });

  it("records a compile hash", () => {
    consentHash("pulse-ts", "abc");
    expect(hashConsented("pulse-ts", "abc")).toBe(true);
    expect(hashConsented("pulse-ts", "zzz")).toBe(false);
    localStorage.setItem("zoto-viz.tsHashes", "not-json");
    expect(hashConsented("pulse-ts", "abc")).toBe(false);
  });

  it("toggles TypeScript plugins", () => {
    expect(tsPluginsAllowed()).toBe(true);
    setTsPluginsAllowed(true);
    expect(tsPluginsAllowed()).toBe(true);
    setTsPluginsAllowed(false);
    expect(tsPluginsAllowed()).toBe(false);
  });

  it("enforces graph.style on the host, not only in the SDK", () => {
    expect(hostAllows("setStyle", ["graph.read"])).toBe(false);
    expect(hostAllows("setStyle", ["graph.style"])).toBe(true);
    expect(hostAllows("setNodeColor", ["graph.style"])).toBe(true);
    expect(hostAllows("log", ["graph.style"])).toBe(false);
  });

  it("enforces viz.write on buffer and uniform writes", () => {
    expect(hostAllows("writeBuffer", ["viz.read"])).toBe(false);
    expect(hostAllows("writeBuffer", ["viz.write"])).toBe(true);
    expect(hostAllows("writeUniform", ["viz.write"])).toBe(true);
    expect(hostAllows("writeParticles", ["viz.write"])).toBe(true);
  });
});

describe("PluginSandbox", () => {
  it("loads srcdoc, ticks, and unloads", async () => {
    const box = new PluginSandbox();
    const styles: Record<string, unknown>[] = [];
    box.handlers = { setStyle: (s) => styles.push(s), setNodeColor: () => {} };
    await box.load("pulse", "globalThis.ok = true;", ["graph.read", "nope"], { a: "1" });
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.srcdoc).not.toMatch(/nope/);
    box.tick([{ id: "a", rate: 1, role: "lan" }]);
    box.unload();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("fetches /plugins/<id>/module.js then loads the iframe", async () => {
    const orig = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      return { ok: true, text: async () => "globalThis.fromHost = true;" } as Response;
    }) as typeof fetch;
    const box = new PluginSandbox();
    expect(pluginModuleUrl("pulse", "deadbeef")).toBe("/api/plugins/pulse/module.js?h=deadbeef");
    await box.loadModule("pulse", ["graph.read", "os.exec"], { a: "1" }, "deadbeef");
    expect(seen).toEqual(["/api/plugins/pulse/module.js?h=deadbeef"]);
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.srcdoc).toMatch(/fromHost/);
    expect(iframe?.srcdoc).not.toMatch(/os\.exec/);
    box.unload();
    globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => "" }) as Response) as typeof fetch;
    await expect(box.loadModule("missing", ["graph.read"], {})).rejects.toThrow(/module 404/);
    globalThis.fetch = orig;
  });

  it("does not post present ticks after unload", async () => {
    const box = new PluginSandbox();
    await box.load(
      "demo",
      "globalThis.ok = true;",
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: true }),
    );
    const iframe = document.querySelector("iframe")!;
    const cw = iframe.contentWindow!;
    const spy = vi.spyOn(cw, "postMessage");
    box.present({ frameMs: 1, tileId: "plugin:demo" });
    expect(spy).toHaveBeenCalled();
    box.unload();
    spy.mockClear();
    box.present({ frameMs: 2, tileId: "plugin:demo" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not post present when presentTick is off", async () => {
    const box = new PluginSandbox();
    await box.load("demo", "globalThis.ok = true;", ["viz.write"], {}, defaultVizContract());
    const cw = document.querySelector("iframe")!.contentWindow!;
    const spy = vi.spyOn(cw, "postMessage");
    box.present({ frameMs: 1, tileId: "x" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    box.unload();
  });
});
