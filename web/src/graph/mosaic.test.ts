import { afterEach, describe, expect, it } from "vitest";
import { assignMosaicSkies, mosaicAnimForTile, mosaicIds, mosaicIsGraph, mosaicPaneMode, mosaicShouldLift, mosaicTileTheme, shouldUniqueMosaicSkies } from "./mosaic";
import { memory, setPluginModes, topology } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM } from "./scene";

afterEach(() => setPluginModes([]));

describe("mosaicIds", () => {
  it("is empty when the catalog has not loaded yet", () => {
    expect(mosaicIds("4")).toEqual([]);
    expect(mosaicIds("6", "plugin:topology")).toEqual([]);
  });

  it("takes the first n catalog rows", () => {
    setPluginModes(["a", "b", "c", "d"].map((id) => ({
      ...topology,
      id: `plugin:${id}`,
      pluginId: id,
      label: id,
    })));
    expect(mosaicIds("4")).toEqual(["plugin:a", "plugin:b", "plugin:c", "plugin:d"]);
  });
});

describe("mosaicPaneMode", () => {
  it("uses the host engine when the catalog is empty so SYS tiles still graph", () => {
    expect(mosaicIsGraph("plugin:memory")).toBe(true);
    expect(mosaicPaneMode("plugin:memory").graphBase).toBe("memory");
    expect(mosaicPaneMode("plugin:cores").graphBase).toBe("cpu");
    expect(mosaicIsGraph("plugin:pacman")).toBe(false);
  });

  it("prefers the compiled catalog row when present", () => {
    setPluginModes([{ ...memory, id: "plugin:memory", pluginId: "memory", label: "Mem wrap" }]);
    expect(mosaicPaneMode("plugin:memory").id).toBe("plugin:memory");
    expect(mosaicPaneMode("plugin:memory").label).toBe("Mem wrap");
  });
});

describe("mosaicShouldLift", () => {
  it("picks up from chrome or alt immediately", () => {
    expect(mosaicShouldLift("chrome", null, "a")).toBe(true);
    expect(mosaicShouldLift("alt", "a", "a")).toBe(true);
  });

  it("picks up a body drag only once the pointer is over another tile", () => {
    expect(mosaicShouldLift("body", null, "a")).toBe(false);
    expect(mosaicShouldLift("body", "a", "a")).toBe(false);
    expect(mosaicShouldLift("body", "b", "a")).toBe(true);
  });
});

describe("mosaic unique skies", () => {
  it("is unique on a low roll and shared on a high roll", () => {
    expect(shouldUniqueMosaicSkies(() => 0)).toBe(true);
    expect(shouldUniqueMosaicSkies(() => 0.49)).toBe(true);
    expect(shouldUniqueMosaicSkies(() => 0.5)).toBe(false);
  });

  it("gives every pane a different host sky and keeps plugin shaders", () => {
    const skies = assignMosaicSkies(
      ["plugin:a", "plugin:b", "plugin:c", "plugin:d"],
      "aurora",
      ["aurora", "space", "fire", "ocean", "matrix"],
      (id) => id === "plugin:b" ? "plugin" : undefined,
    );
    expect(skies["plugin:b"]).toBe("plugin");
    const host = ["plugin:a", "plugin:c", "plugin:d"].map((id) => skies[id]);
    expect(new Set(host).size).toBe(3);
    expect(host.includes("aurora")).toBe(false);
  });

  it("overrides a host wall sky per tile and keeps plugin shaders", () => {
    const wall = { ...DEFAULT_DREAM, backdrop: "aurora" as const };
    expect(mosaicAnimForTile(wall, "plugin:talkers", "fire").backdrop).toBe("fire");
    expect(mosaicAnimForTile({ ...wall, backdrop: "plugin" as const }, "plugin:talkers", "fire").backdrop).toBe("plugin");
  });
});

describe("mosaicTileTheme", () => {
  it("reuses the wall palette when one theme is on", () => {
    const wall = themeById("midnight");
    const used = new Set([wall.id]);
    expect(mosaicTileTheme(true, wall, used, "ocean").id).toBe("midnight");
    expect(used.size).toBe(1);
  });

  it("takes an unused palette when tiles keep their own", () => {
    const wall = themeById("midnight");
    const used = new Set([wall.id]);
    expect(mosaicTileTheme(false, wall, used, "ocean").id).toBe("ocean");
    expect(used.has("ocean")).toBe(true);
  });
});
