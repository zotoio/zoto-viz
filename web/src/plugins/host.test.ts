import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox, consentHash, hashConsented, hostAllows, pluginModuleUrl, setTsPluginsAllowed, tsPluginsAllowed } from "./host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import {
  PluginSandbox,
  consentHash,
  hashConsented,
  hostAllows,
  packAssetUrlWithToken,
  pluginModuleSandboxUrl,
  pluginModuleUrl,
  setTsPluginsAllowed,
  tsPluginsAllowed,
} from "./host";

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

  it("allows tile-heal sandbox messages without extra caps", () => {
    expect(hostAllows("drawState", [])).toBe(true);
    expect(hostAllows("loseHostContext", ["viz.read"])).toBe(true);
  });
});

describe("PluginSandbox", () => {
  it("posts config updates to the iframe when config.read is allowed", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const posted: unknown[] = [];
    try {
      await box.load("cfg-pack", "globalThis.ok = true;", ["config.read"], { a: "1" });
      const win = document.querySelector("iframe")?.contentWindow as Window & {
        postMessage: (data: unknown) => void;
      };
      const orig = win.postMessage.bind(win);
      win.postMessage = (data) => { posted.push(data); orig(data); };
      box.setConfig({ a: "2", b: "on" });
      expect(posted.some((m) => (m as { type?: string }).type === "config")).toBe(true);
    } finally {
      box.unload();
    }
  });

  it("does not post config when config.read is missing", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const posted: unknown[] = [];
    try {
      await box.load("cfg-pack", "globalThis.ok = true;", ["graph.read"], { a: "1" });
      const win = document.querySelector("iframe")?.contentWindow as Window & {
        postMessage: (data: unknown) => void;
      };
      const orig = win.postMessage.bind(win);
      win.postMessage = (data) => { posted.push(data); orig(data); };
      box.setConfig({ a: "2" });
      expect(posted.some((m) => (m as { type?: string }).type === "config")).toBe(false);
    } finally {
      box.unload();
    }
  });

  it("posts config even when the payload is empty", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const posted: unknown[] = [];
    try {
      await box.load("cfg-pack", "globalThis.ok = true;", ["config.read"], { a: "1" });
      const win = document.querySelector("iframe")?.contentWindow as Window & {
        postMessage: (data: unknown) => void;
      };
      const orig = win.postMessage.bind(win);
      win.postMessage = (data) => { posted.push(data); orig(data); };
      box.setConfig({});
      const cfg = posted.find((m) => (m as { type?: string }).type === "config") as { config?: Record<string, string> };
      expect(cfg?.config).toEqual({});
    } finally {
      box.unload();
    }
});

describe("PluginSandbox", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((f) => f.remove());
  });

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
describe("pack asset URLs", () => {
  afterEach(() => {
    setPackAssetTokenForTests("_sandbox", "");
    setPackAssetTokenForTests("pulse-ts", "");
  });

  it("puts the session token in the path segment", async () => {
    setPackAssetTokenForTests("pulse-ts", "sess-tok-abc");
    setPackAssetTokenForTests("_sandbox", "sess-tok-abc");
    const url = packAssetUrlWithToken("sess-tok-abc", "pulse-ts", "module.js");
    expect(url).toBe("/pack-assets/sess-tok-abc/pulse-ts/module.js");
    expect(url).not.toContain("?");
    expect(await pluginModuleSandboxUrl("pulse-ts", "deadbeef")).toContain(
      "/pack-assets/sess-tok-abc/pulse-ts/module.js?h=deadbeef",
    );
  });
});

describe("PluginSandbox module load", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue("11111111-1111-4111-8111-111111111111");
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
  });

  it("loads pack-assets module.js in the bootstrap frame", async () => {
    setPackAssetTokenForTests("_sandbox", "sess-tok-abc");
    setPackAssetTokenForTests("pulse", "sess-tok-abc");
    const box = new PluginSandbox();
    expect(pluginModuleUrl("pulse", "deadbeef")).toBe("/api/plugins/pulse/module.js?h=deadbeef");
    const boot = box.loadModule("pulse", ["graph.read", "os.exec"], { a: "1" }, "deadbeef");
    await boot;
    const iframe = document.querySelector("iframe");
    expect(iframe?.src).toContain("/pack-assets/sess-tok-abc/_sandbox/plugin-sandbox.html");
    box.unload();
  });
});
