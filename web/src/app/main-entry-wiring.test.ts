/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../ui/settings";

const here = dirname(fileURLToPath(import.meta.url));
const wallHtml = readFileSync(join(here, "test/main-wall-fixture.html"), "utf8");

let capturedSettings: Settings | null = null;

const bindHostView = vi.hoisted(() => vi.fn(function bindThisView() {}));
const rebindViewDrawerOnApplyMode = vi.hoisted(() => vi.fn(function rebindViewDrawerOnApplyMode() {}));

vi.mock("three", async (importOriginal) => {
  const t = await importOriginal<typeof import("three")>();
  class R {
    domElement = document.createElement("canvas");
    setSize() {}
    setPixelRatio() {}
    setScissorTest() {}
    setViewport() {}
    setScissor() {}
    getContext() { return null; }
    render() {}
    dispose() {}
  }
  return { ...t, WebGLRenderer: R };
});
vi.mock("../graph/webgl", () => ({ probeWebGL: () => false }));
vi.mock("./host-view-bind", () => ({ bindThisView: bindHostView }));
vi.mock("./host-apply-mode-rebind", async (importOriginal) => {
  const o = await importOriginal<typeof import("./host-apply-mode-rebind")>();
  return { ...o, rebindViewDrawerOnApplyMode };
});

vi.mock("../ui/settings", async (importOriginal) => {
  const o = await importOriginal<typeof import("../ui/settings")>();
  class SettingsCapture extends o.Settings {
    constructor(opts: ConstructorParameters<typeof o.Settings>[0]) {
      super(opts);
      capturedSettings = this;
    }
  }
  return { ...o, Settings: SettingsCapture };
});

vi.mock("../plugins/plugin", async (importOriginal) => {
  const o = await importOriginal<typeof import("../plugins/plugin")>();
  return { ...o, installPlugins: vi.fn(() => new Promise<never>(() => {})) };
});

class WS {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { queueMicrotask(() => this.onopen?.()); }
  close() { this.onclose?.(); }
  send() {}
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((r) => queueMicrotask(r));
}

function expectSpyOnce(spy: { mock: { calls: unknown[] } }, name: string): void {
  const n = spy.mock.calls.length;
  if (n !== 1) expect.fail(`expected "${name}" to be called 1 times, but got ${n} times`);
}

describe("main.ts entry wiring", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    capturedSettings = null;
    vi.stubGlobal("WebSocket", WS);
    document.body.innerHTML = wallHtml;
    vi.resetModules();
    bindHostView.mockClear();
    rebindViewDrawerOnApplyMode.mockClear();
  });

  it("bindThisView routes mode cog through host-view-bind", async () => {
    await import("./main");
    await flushMicrotasks();
    bindHostView.mockClear();
    const viewCog = document.querySelector<HTMLButtonElement>("#modeBox button.cog");
    expect(viewCog).toBeTruthy();
    viewCog!.click();
    expectSpyOnce(bindHostView, "bindThisView");
    expect(bindHostView.mock.calls[0]![0]!.settings).toBe(capturedSettings);
  });

  it("applyMode at boot wires drawer rebind before bindThisView", async () => {
    await import("./main");
    await flushMicrotasks();
    expectSpyOnce(rebindViewDrawerOnApplyMode, "rebindViewDrawerOnApplyMode");
    expect(typeof rebindViewDrawerOnApplyMode.mock.calls[0]![0]).toBe("function");
  });
});
