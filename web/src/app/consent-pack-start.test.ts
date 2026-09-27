import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "../graph/render-host";
import { Mosaic } from "../graph/mosaic";
import { NetScene, DEFAULT_DREAM } from "../graph/scene";
import { themeById } from "../core/themes";
import { setPluginModes, talkers, topology } from "../core/modes";
import { Settings } from "../ui/settings";
import { consentBlockMessage } from "./apply-mode-mosaic";
import { bootMosaicPackStartLayout } from "./mosaic-boot-pack-start";
import { mosaicHeaderModePick } from "./mosaic-header-mode-pick";
import { pickMosaicPaneWith } from "./mosaic-pane-pick";
import { wireSettingsMosaicPanePick } from "./mosaic-pane-pick-wire";
import { mosaicReloadLayoutTiles } from "./mosaic-reload-layout";
import { applyMosaicWallPanePick } from "./mosaic-pane-pick";
import {
  resetPaneSwitchTokens,
  switchPaneView,
  type SwitchPaneViewHost,
  type SwitchPaneViewResult,
} from "./switch-pane-view";

const HEAT_NOTICE = consentBlockMessage({ name: "Heat map" });

function expectPackStartConsentBlocked(opts: {
  mountView: ReturnType<typeof vi.fn>;
  setPaneView?: ReturnType<typeof vi.fn>;
  noticeText: string | undefined;
}): void {
  expect(opts.mountView).toHaveBeenCalledTimes(0);
  if (opts.setPaneView) expect(opts.setPaneView).not.toHaveBeenCalled();
  expect(opts.noticeText).toBe(HEAT_NOTICE);
  expect(opts.noticeText).toBe(consentBlockMessage({ name: "Heat map" }));
  expect(opts.noticeText?.includes("isn't approved yet")).toBe(true);
  expect(opts.noticeText?.includes("\u2019")).toBe(false);
}

function host(over: Partial<SwitchPaneViewHost> & Pick<SwitchPaneViewHost, "tileIds">): SwitchPaneViewHost {
  return {
    focusedId: null,
    setPaneView: vi.fn(() => true),
    setPaneNotice: vi.fn(),
    focus: vi.fn(),
    ...over,
  };
}

function runSwitch(
  m: SwitchPaneViewHost,
  mountView: ReturnType<typeof vi.fn>,
): (toViewId: string, fromViewId?: string) => Promise<SwitchPaneViewResult> {
  return (toViewId, fromViewId) =>
    switchPaneView(m, toViewId, {
      fromViewId,
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
}

function makeMosaic(
  panePickDeps: {
    runSwitch: (toViewId: string, fromViewId?: string) => Promise<SwitchPaneViewResult>;
    refreshMosaicSlots: () => void;
  },
): {
  mosaic: Mosaic;
  wall: HTMLElement;
} {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
  const sceneEl = document.createElement("div");
  Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
  const renderHost = new RenderHost(wall, { software: true });
  const main = new NetScene(sceneEl, { host: renderHost });
  main.retargetPanel("plugin:topology");
  const mosaic = new Mosaic(
    applyMosaicWallPanePick(
      {
        wall,
        sceneEl,
        main,
        host: renderHost,
        arcade: {},
        optsFor: () => ({}),
        onFocus: () => {},
        onPromote: () => {},
        onLayout: () => {},
        onCloseLast: () => {},
        sync: () => ({
      theme: themeById("midnight"),
      filters: {},
      anim: DEFAULT_DREAM,
      dreaming: false,
      nodeFilter: () => true,
      lastMsg: null,
      aliasMap: new Map(),
    }),
      },
      panePickDeps,
    ),
  );
  mosaic.setSize("2", "plugin:topology", "off", {
    tiles: ["plugin:topology", "plugin:wifi"],
  });
  mosaic.focus("plugin:topology");
  return { mosaic, wall };
}

describe("consent blocks pack start paths", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:heat", pluginId: "heat", label: "Heat map" },
      { ...topology, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
      { ...talkers, id: "plugin:kefrens", pluginId: "kefrens", label: "Kefrens" },
    ]);
  });

  afterEach(() => {
    resetPaneSwitchTokens();
    setPluginModes([]);
  });

  it("header mode pick shows consent notice and does not mount", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const mountView = vi.fn();
    const runMosaicPaneSwitch = runSwitch(m, mountView);
    const result = await mosaicHeaderModePick("plugin:heat", {
      mosaicOn: true,
      runMosaicPaneSwitch,
    });
    expect(result?.ok).toBe(false);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const notice = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expectPackStartConsentBlocked({
      mountView,
      setPaneView: m.setPaneView as ReturnType<typeof vi.fn>,
      noticeText: notice,
    });
  });

  it("tile chrome pick shows consent notice and does not mount", async () => {
    const mountView = vi.fn();
    let switchCalls = 0;
    const notices: string[] = [];
    let mosaic!: Mosaic;
    const panePickDeps = {
      runSwitch: async (toViewId: string, fromViewId?: string) => {
        switchCalls += 1;
        return runSwitch(mosaic, mountView)(toViewId, fromViewId);
      },
      refreshMosaicSlots: () => {},
    };
    const built = makeMosaic(panePickDeps);
    mosaic = built.mosaic;
    const wall = built.wall;
    const setPaneViewSpy = vi.spyOn(mosaic, "setPaneView");
    const origNotice = mosaic.setPaneNotice.bind(mosaic);
    mosaic.setPaneNotice = (id, text, recipe) => {
      if (text) notices.push(text);
      origNotice(id, text, recipe);
    };
    const pick = wall.querySelector<HTMLSelectElement>(".mosaic-pick");
    pick!.value = "plugin:heat";
    pick!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(switchCalls).toBe(1);
    expect(notices.length).toBe(1);
    expectPackStartConsentBlocked({
      mountView,
      setPaneView: setPaneViewSpy,
      noticeText: notices[0],
    });
    expect(mosaic.tileIds).toContain("plugin:topology");
    expect(mosaic.tileIds).not.toContain("plugin:heat");
    setPaneViewSpy.mockRestore();
  });

  it("settings wall slot pick calls switchPaneView once and shows consent notice", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const mountView = vi.fn();
    let switchCalls = 0;
    const s = new Settings({ storePrefix: "zoto-viz-consent-slot", onChange: () => {} });
    wireSettingsMosaicPanePick(s, (from, to) =>
      pickMosaicPaneWith(
        {
          runSwitch: async (toViewId, fromViewId) => {
            switchCalls += 1;
            return runSwitch(m, mountView)(toViewId, fromViewId);
          },
          refreshMosaicSlots: () => {},
        },
        from,
        to,
      ),
    );
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...DEFAULT_DREAM,
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:wifi"],
    });
    s.open("view");
    const sel = s.el.querySelector<HTMLSelectElement>(".mosaic-slot");
    sel!.value = "plugin:heat";
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(switchCalls).toBe(1);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const notice = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expectPackStartConsentBlocked({
      mountView,
      setPaneView: m.setPaneView as ReturnType<typeof vi.fn>,
      noticeText: notice,
    });
  });

  it("boot reconcile then switch shows consent notice and does not mount", async () => {
    const { tiles, mode } = bootMosaicPackStartLayout(
      ["plugin:topology", "plugin:wifi"],
      "plugin:heat",
      "plugin:topology",
      "plugin:topology",
    );
    expect(mode).toBe("plugin:heat");
    expect(tiles[0]).toBe("plugin:heat");
    const m = host({ tileIds: tiles, focusedId: "plugin:heat" });
    const mountView = vi.fn();
    const result = await mosaicHeaderModePick(mode, {
      mosaicOn: true,
      runMosaicPaneSwitch: runSwitch(m, mountView),
    });
    expect(result?.ok).toBe(false);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const notice = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expectPackStartConsentBlocked({
      mountView,
      setPaneView: m.setPaneView as ReturnType<typeof vi.fn>,
      noticeText: notice,
    });
  });

  it("reload header pick shows consent notice and does not mount", async () => {
    const tiles = mosaicReloadLayoutTiles(
      ["plugin:topology", "plugin:wifi", "plugin:kefrens", "plugin:talkers"],
      "plugin:heat",
      "plugin:kefrens",
    );
    expect(tiles.includes("plugin:heat")).toBe(true);
    const m = host({
      tileIds: tiles,
      focusedId: "plugin:kefrens",
    });
    const mountView = vi.fn();
    const result = await mosaicHeaderModePick("plugin:heat", {
      mosaicOn: true,
      runMosaicPaneSwitch: runSwitch(m, mountView),
    });
    expect(result?.ok).toBe(false);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const notice = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expectPackStartConsentBlocked({
      mountView,
      setPaneView: m.setPaneView as ReturnType<typeof vi.fn>,
      noticeText: notice,
    });
  });
});
