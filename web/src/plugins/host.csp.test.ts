import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import {
  PluginSandbox,
  pluginSandboxFrameUrl,
  setPluginModuleSandboxUrlForTests,
} from "./host";

const pluginModuleDataUrl = (body = "export {};") =>
  `data:text/javascript,${encodeURIComponent(body)}`;

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("page CSP bootstrap policy", () => {
  it("does not rely on hand-maintained script-src hashes for the app shell", () => {
    const index = readFileSync(path.join(webRoot, "index.html"), "utf8");
    const csp = index.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/'sha256-/);
    expect(csp).not.toMatch(/'nonce-/);
  });

  it("loads plugin sandbox from same-origin html + module (no srcdoc)", () => {
    const sandbox = readFileSync(path.join(webRoot, "plugin-sandbox.html"), "utf8");
    expect(sandbox).not.toMatch(/\bsrcdoc\b/i);
    expect(sandbox).toMatch(/<script[^>]+src="/);
    expect(sandbox).not.toMatch(/<script[^>]*>[^<]+/);
    expect(sandbox).toContain("connect-src 'none'");
  });
});

describe("PluginSandbox", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue("11111111-1111-4111-8111-111111111111");
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPackAssetTokenForTests("backrooms", "test-backrooms-token");
    setPluginModuleSandboxUrlForTests(async () => pluginModuleDataUrl());
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    setPackAssetTokenForTests("backrooms", "");
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

  it("backrooms full-screen pack uses the module bootstrap without CSP violations", async () => {
    const violations: Event[] = [];
    const onViolation = (e: Event) => violations.push(e);
    document.addEventListener("securitypolicyviolation", onViolation);
    const box = new PluginSandbox();
    await box.loadModule("backrooms", ["graph.read", "viz.read"], {}, "stage-hash");
    expect(box.liveFrame?.src).toContain("plugin-sandbox.html");
    expect(box.liveFrame?.srcdoc).toBeFalsy();
    box.unload();
    document.removeEventListener("securitypolicyviolation", onViolation);
    expect(violations.length).toBe(0);
  });

  it("points the bootstrap at a token-gated pack-assets html url", async () => {
    setPackAssetTokenForTests("_sandbox", "tok");
    expect(
      await pluginSandboxFrameUrl("11111111-1111-4111-8111-111111111111"),
    ).toMatch(/\/pack-assets\/tok\/_sandbox\/plugin-sandbox\.html#/);
  });
});
