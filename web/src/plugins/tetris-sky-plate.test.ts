import { describe, expect, it } from "vitest";
import { applyPluginCatalog, lookForMode, mergeLook } from "./plugin";
import { toPluginView } from "./plugin-visualisation";
import { DEFAULT_DREAM } from "../graph/scene";

describe("Tetris shipped sky plate", () => {
  it("pins meadow photo backdrop on both plugin:tetris and tetris menu ids", () => {
    applyPluginCatalog([
      toPluginView({
        id: "tetris",
        name: "Tetris",
        version: 1,
        engine: "tetris",
        look: { backdrop: "meadow", stageOnly: true, theme: "phosphor" },
      }),
    ]);
    expect(lookForMode("plugin:tetris")?.backdrop).toBe("meadow");
    expect(lookForMode("tetris")?.backdrop).toBe("meadow");
    expect(lookForMode("tetris")?.stageOnly).toBe(true);
    const anim = mergeLook(DEFAULT_DREAM, lookForMode("tetris"));
    expect(anim.backdrop).toBe("meadow");
    applyPluginCatalog([]);
  });
});
