/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../ui/settings";
const here = dirname(fileURLToPath(import.meta.url));
const wallHtml = readFileSync(join(here, "test/main-wall-fixture.html"), "utf8");

let capturedSettings: Settings | null = null;

const {
  runMainOnPluginFields,
  runMainBindThisView,
  runMainApplyModeDrawerRebind,
  createMosaicPanePickHandler,
} = vi.hoisted(() => ({
  runMainOnPluginFields: vi.fn(function runMainOnPluginFields() {}),
  runMainBindThisView: vi.fn(function runMainBindThisView() {}),
  runMainApplyModeDrawerRebind: vi.fn(function runMainApplyModeDrawerRebind() {}),
  createMosaicPanePickHandler: vi.fn(function createMosaicPanePickHandler() {
    return vi.fn(() => true);
  }),
}));

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

vi.mock("./main-on-plugin-fields", () => ({ runMainOnPluginFields }));
vi.mock("./main-bind-this-view", () => ({ runMainBindThisView }));
vi.mock("./main-apply-mode-drawer", () => ({ runMainApplyModeDrawerRebind }));
vi.mock("./host-mosaic-pane-pick", () => ({ createMosaicPanePickHandler }));

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

describe("main.ts wiring boot", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    capturedSettings = null;
    vi.stubGlobal("WebSocket", WS);
    document.body.innerHTML = wallHtml;
    vi.resetModules();
    runMainOnPluginFields.mockClear();
    runMainBindThisView.mockClear();
    runMainApplyModeDrawerRebind.mockClear();
    createMosaicPanePickHandler.mockClear();
  });

  it("onPluginFields calls runMainOnPluginFields on plugin change", async () => {
    await import("./main");
    await flushMicrotasks();
    capturedSettings!.onPluginChange!("plugin:topology", {});
    expectSpyOnce(runMainOnPluginFields, "runMainOnPluginFields");
    const onFieldsDeps = runMainOnPluginFields.mock.calls[0]![0]!;
    expect(onFieldsDeps.settings).toBe(capturedSettings);
  });

  it("bindThisView calls runMainBindThisView from view cog", async () => {
    await import("./main");
    await flushMicrotasks();
    const viewCog = document.querySelector<HTMLButtonElement>("#modeBox button.cog");
    expect(viewCog).toBeTruthy();
    viewCog!.click();
    expectSpyOnce(runMainBindThisView, "runMainBindThisView");
    expect(runMainBindThisView.mock.calls[0]![0]!.settings).toBe(capturedSettings);
  });

  it("applyMode calls runMainApplyModeDrawerRebind at boot", async () => {
    await import("./main");
    await flushMicrotasks();
    expectSpyOnce(runMainApplyModeDrawerRebind, "runMainApplyModeDrawerRebind");
    const drawerArgs = runMainApplyModeDrawerRebind.mock.calls[0]!;
    expect(typeof drawerArgs[0]).toBe("function");
    expect((drawerArgs[1] as { modeId: string }).modeId).toBe(localStorage.getItem("zoto-viz.mode") ?? "topology");
  });

  it("settings wires createMosaicPanePickHandler at boot", async () => {
    await import("./main");
    await flushMicrotasks();
    expectSpyOnce(createMosaicPanePickHandler, "createMosaicPanePickHandler");
    expect(typeof (createMosaicPanePickHandler.mock.calls[0]![0] as { getMosaic: () => unknown }).getMosaic).toBe("function");
  });
});
