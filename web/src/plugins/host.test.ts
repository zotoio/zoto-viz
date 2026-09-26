import { afterEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
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
});

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
