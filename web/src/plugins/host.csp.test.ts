import { afterEach, describe, expect, it } from "vitest";
import { PluginSandbox, pluginSandboxFrameUrl } from "./host";

describe("PluginSandbox", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("loads a same-origin bootstrap frame instead of srcdoc", async () => {
    const box = new PluginSandbox();
    await box.load("pulse", "globalThis.ok = true;", ["graph.read", "nope"], { a: "1" });
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.src).toContain("plugin-sandbox.html");
    expect(iframe?.srcdoc).toBeFalsy();
    box.unload();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("does not emit script-src securitypolicyviolation while booting", async () => {
    const violations: Event[] = [];
    const onViolation = (e: Event) => violations.push(e);
    document.addEventListener("securitypolicyviolation", onViolation);
    const box = new PluginSandbox();
    await box.load("pulse", "globalThis.ok = true;", ["graph.read"], {});
    box.unload();
    document.removeEventListener("securitypolicyviolation", onViolation);
    expect(violations.length).toBe(0);
  });

  it("drops the iframe and blob url after repeated load/unload", async () => {
    const box = new PluginSandbox();
    for (let i = 0; i < 20; i++) {
      await box.load("pulse", `globalThis.i=${i};`, ["graph.read"], {});
      box.unload();
    }
    expect(document.querySelectorAll("iframe").length).toBe(0);
  });

  it("points the bootstrap at a same-origin html url", () => {
    expect(pluginSandboxFrameUrl()).toMatch(/plugin-sandbox\.html$/);
  });
});
