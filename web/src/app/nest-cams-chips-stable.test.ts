import { beforeEach, describe, expect, it, vi } from "vitest";
import * as viewDrawer from "../ui/view-drawer-module";
import { setPluginModes } from "../core/modes";
import { compilePlugin, configStoreId, fieldDefault, loadPluginConfig, writePluginConfig } from "../plugins/plugin";
import { Settings } from "../ui/settings";
import { hostModeById } from "./host-mode";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
  pickMosaicSlot,
} from "./test/duplicate-slot-mosaic-fixture";
import { settingsViewDrawerRoot } from "./test/duplicate-slot-scope-note-test-dom";

const NEST = "plugin:nest-cams";

function cameraChipButtons(root: ParentNode): HTMLButtonElement[] {
  const fields = [...root.querySelectorAll<HTMLElement>(".nest-cam-field")];
  const cameras = fields.find((f) => f.querySelector(".subcap")?.textContent === "cameras");
  expect(cameras).toBeTruthy();
  return [...cameras!.querySelectorAll<HTMLButtonElement>("button")];
}

describe("nest cams drawer chips", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

  it("device chips and selection survive duplicate pack count 2→3 without drawer rebuild", async () => {
    const nestSpec = {
      id: "nest-cams",
      name: "Nest cams",
      version: 1,
      engine: "graph" as const,
      config: [
        { key: "live", label: "live stream", type: "boolean", default: true },
        { key: "stills", label: "motion stills", type: "boolean", default: false },
        { key: "grid", label: "layout", type: "select", values: [["auto", "all"], ["4", "2×2"]], default: "auto" },
        { key: "pick", label: "cameras", type: "text", default: "" },
        { key: "prompt", label: "prompt", type: "textarea", default: "" },
      ],
    };
    setPluginModes([
      compilePlugin(nestSpec),
      compilePlugin({ id: "topology", name: "Topology", version: 1, engine: "graph", base: "topology" }),
      compilePlugin({ id: "memory", name: "Memory", version: 1, engine: "graph", base: "memory" }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-nest-chips-stable", onChange: () => {} });
    document.body.append(settings.el);
    const { mosaic, bindThisView } = mountDuplicateSlotMosaicHarness(settings, {
      hostModeById,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "nest-cams" ? nestSpec : null),
      lookForMode: () => null,
      fallbackModeId: () => NEST,
    });
    const devices = [
      { id: "cam-a", label: "Front door", camera: true },
      { id: "cam-b", label: "Driveway", camera: true },
    ];
    const seeded: Record<string, string> = {};
    for (const f of nestSpec.config) seeded[f.key] = fieldDefault(f);
    seeded.pick = "Front door";
    writePluginConfig(configStoreId(nestSpec), seeded);
    applyMosaicTiles(settings, mosaic, [NEST, `${NEST}!1`, "plugin:topology", "plugin:memory"]);
    bindThisView(NEST);
    settings.bindView(nestSpec, nestSpec.config);
    settings.setNestDevices(devices);
    settings.openView(NEST);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const viewRoot = settingsViewDrawerRoot(settings);
    const labelsBefore = cameraChipButtons(viewRoot).map((b) => b.textContent);
    expect(labelsBefore).toEqual(["all", "Front door", "Driveway"]);

    const before = cameraChipButtons(viewRoot);
    expect(before.find((b) => b.textContent === "Front door")?.getAttribute("aria-pressed")).toBe("true");
    const rebuildSpy = vi.spyOn(viewDrawer, "rebuildViewDrawerContent");
    rebuildSpy.mockClear();
    pickMosaicSlot(settings, 2, NEST);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(rebuildSpy).not.toHaveBeenCalled();
    rebuildSpy.mockRestore();

    const after = cameraChipButtons(viewRoot);
    expect(after.map((b) => b.textContent)).toEqual(labelsBefore);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(before[i]);
    }
    const pickCfg = loadPluginConfig(nestSpec, nestSpec.config);
    expect(pickCfg.pick).toBe("Front door");
    const frontAfter = after.find((b) => b.textContent === "Front door")!;
    expect(frontAfter.getAttribute("aria-pressed")).toBe("true");

    settings.el.remove();
  });
});
