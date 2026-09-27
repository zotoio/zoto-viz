import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import * as tileBudget from "./viz-tile-budget";
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

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
import { VIZ_CONTRACT_VERSION, defaultVizContract } from "./viz-host";

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
    expect(hostAllows("publishBitmap", ["viz.write"])).toBe(true);
    expect(hostAllows("publishBitmap", ["viz.read"])).toBe(false);
    expect(hostAllows("publishBitmapFailed", ["viz.write"])).toBe(true);
    expect(hostAllows("publishBitmapFailed", ["viz.read"])).toBe(false);
  });

  it("allows tile-heal sandbox messages without extra caps", () => {
    expect(hostAllows("drawState", [])).toBe(true);
    expect(hostAllows("loseHostContext", ["viz.read"])).toBe(true);
  });
});

describe("page CSP", () => {
  it("allows inline scripts so sandboxed plugin srcdoc can run", () => {
    const html = readFileSync(path.join(webRoot, "index.html"), "utf8");
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/script-src[^;]*blob:/);
  });
});

describe("PluginSandbox", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((f) => f.remove());
  });

  it("unload resets viz tile scope to solo main", () => {
    const spy = vi.spyOn(tileBudget, "syncVizTileScope");
    const box = new PluginSandbox();
    box.unload();
    expect(spy).toHaveBeenCalledWith(["main"]);
    spy.mockRestore();
  });

  it("bakes contractVersion into sandbox srcdoc before init", async () => {
    const box = new PluginSandbox();
    await box.load("pulse", "globalThis.ok = true;", ["viz.write"], {}, defaultVizContract());
    const iframe = document.querySelector("iframe");
    expect(iframe?.srcdoc).toContain(`__zotoContractVersion = ${VIZ_CONTRACT_VERSION}`);
    box.unload();
  });

  it("posts contractVersion on init", async () => {
    const inits: { type?: string; contractVersion?: number }[] = [];
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = (node: Node) => {
      const out = append(node);
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        vi.spyOn(node.contentWindow, "postMessage").mockImplementation((data) => {
          inits.push(data as { type?: string; contractVersion?: number });
        });
      }
      return out;
    };
    const box = new PluginSandbox();
    await box.load("pulse", "globalThis.ok = true;", ["viz.write"], {}, defaultVizContract());
    document.body.appendChild = append;
    expect(inits.find((m) => m.type === "init")?.contractVersion).toBe(VIZ_CONTRACT_VERSION);
    box.unload();
  });

  it("resolves load when the iframe is removed before onload", async () => {
    const box = new PluginSandbox();
    const pending = box.load("slow", "globalThis.ok = true;", ["graph.read"], {});
    box.unload();
    await expect(pending).resolves.toBeUndefined();
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
    await box.loadModule("pulse", ["graph.read", "os.exec"], { a: "1" }, "deadbeef");
    const iframe = document.querySelector("iframe");
    expect(iframe?.src).toContain("/pack-assets/sess-tok-abc/_sandbox/plugin-sandbox.html");
    box.unload();
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
    box.deliverPresentTick(1, "plugin:demo");
    expect(spy).toHaveBeenCalled();
    box.unload();
    spy.mockClear();
    box.deliverPresentTick(2, "plugin:demo");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not post present when presentTick is off", async () => {
    const box = new PluginSandbox();
    await box.load("demo", "globalThis.ok = true;", ["viz.write"], {}, defaultVizContract());
    const cw = document.querySelector("iframe")!.contentWindow!;
    const spy = vi.spyOn(cw, "postMessage");
    box.deliverPresentTick(1, "x");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    box.unload();
  });
});
