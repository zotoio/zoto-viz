import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox, consentHash, hashConsented, hostAllows, pluginModuleUrl, setTsPluginsAllowed, tsPluginsAllowed } from "./host";

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

describe("PluginSandbox module load", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it("fetches /plugins/<id>/module.js then loads the bootstrap frame", async () => {
    const orig = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(String(url));
      return { ok: true, text: async () => "globalThis.fromHost = true;" } as Response;
    }) as typeof fetch;
    const box = new PluginSandbox();
    expect(pluginModuleUrl("pulse", "deadbeef")).toBe("/api/plugins/pulse/module.js?h=deadbeef");
    const boot = box.loadModule("pulse", ["graph.read", "os.exec"], { a: "1" }, "deadbeef");
    await boot;
    expect(seen).toEqual(["/api/plugins/pulse/module.js?h=deadbeef"]);
    const iframe = document.querySelector("iframe");
    expect(iframe?.src).toContain("plugin-sandbox.html");
    box.unload();
    globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => "" }) as Response) as typeof fetch;
    await expect(box.loadModule("missing", ["graph.read"], {})).rejects.toThrow(/module 404/);
    globalThis.fetch = orig;
  });

  it("exposes setConfig for live config.read pushes", () => {
    expect(typeof new PluginSandbox().setConfig).toBe("function");
  });
});
