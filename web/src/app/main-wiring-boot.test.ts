/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../ui/settings";
import { hostModeById } from "./host-mode";

const here = dirname(fileURLToPath(import.meta.url));
const wallHtml = readFileSync(join(here, "main-wall-fixture.html"), "utf8");

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

  it("delegates plugin fields, bind-this-view, applyMode drawer, and mosaic pane pick at boot", async () => {
    await import("./main");
    await new Promise((r) => setTimeout(r, 100));
    capturedSettings!.onPluginChange!("plugin:topology", {});
    capturedSettings!.viewCog!.click();

    const expectSpyOnce = (spy: { mock: { calls: unknown[] } }, name: string) => {
      const n = spy.mock.calls.length;
      if (n !== 1) expect.fail(`expected "${name}" to be called 1 times, but got ${n} times`);
    };
    expectSpyOnce(runMainOnPluginFields, "runMainOnPluginFields");
    expectSpyOnce(runMainBindThisView, "runMainBindThisView");
    expectSpyOnce(runMainApplyModeDrawerRebind, "runMainApplyModeDrawerRebind");
    expectSpyOnce(createMosaicPanePickHandler, "createMosaicPanePickHandler");

    const onFieldsDeps = runMainOnPluginFields.mock.calls[0]![0]!;
    expect(onFieldsDeps.settings).toBe(capturedSettings);
    expect(onFieldsDeps.hostModeById("plugin:topology").id).toBe(hostModeById("plugin:topology").id);

    const bindDeps = runMainBindThisView.mock.calls[0]![0]!;
    const bindModeId = runMainBindThisView.mock.calls[0]![1] as string;
    expect(bindDeps.settings).toBe(capturedSettings);
    expect(bindDeps.hostModeById("plugin:topology").id).toBe(hostModeById("plugin:topology").id);
    expect(bindModeId).toBe(onFieldsDeps.modeSelValue());

    const drawerArgs = runMainApplyModeDrawerRebind.mock.calls[0]!;
    expect(typeof drawerArgs[0]).toBe("function");
    const drawerCtx = drawerArgs[1] as {
      settings: Settings | null | undefined;
      modeId: string;
      hostModeById: typeof hostModeById;
    };
    expect(drawerCtx.hostModeById("plugin:topology").id).toBe(hostModeById("plugin:topology").id);
    expect(drawerCtx.modeId).toBe(
      localStorage.getItem("zoto-viz.mode") ?? "topology",
    );

    const pickDeps = createMosaicPanePickHandler.mock.calls[0]![0] as {
      getMosaic: () => unknown;
      hostModeById: typeof hostModeById;
      pluginSpecForMode: (id: string) => unknown;
    };
    expect(pickDeps.hostModeById("plugin:topology").id).toBe(hostModeById("plugin:topology").id);
    expect(typeof pickDeps.getMosaic).toBe("function");
    expect(typeof pickDeps.pluginSpecForMode).toBe("function");
  });
});
