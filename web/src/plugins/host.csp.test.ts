import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox, pluginSandboxFrameUrl } from "./host";

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
    expect(sandbox).toContain("connect-src 'self'");
  });
});

describe("PluginSandbox", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("loads a same-origin bootstrap frame instead of srcdoc", async () => {
    const box = new PluginSandbox();
    await box.load("pulse", "globalThis.ok = true;", ["graph.read", "nope"], { a: "1" });
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/plugins/backrooms/module.js")) {
        return new Response("export {};", { status: 200, headers: { "content-type": "text/javascript" } });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const box = new PluginSandbox();
    await box.loadModule("backrooms", ["graph.read", "viz.read"], {}, "stage-hash");
    expect(box.liveFrame?.src).toContain("plugin-sandbox.html");
    expect(box.liveFrame?.srcdoc).toBeFalsy();
    box.unload();
    document.removeEventListener("securitypolicyviolation", onViolation);
    vi.unstubAllGlobals();
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
