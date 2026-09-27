import { setPluginModes } from "../../core/modes";
import type { PluginInstance } from "../instances";
import { compilePlugin, type PluginView } from "../plugin";

/** Minimal settings-decl pack used in duplicate-slot / host-mode tests. */
export function loadSettingsDeclFixture(): PluginView {
  return {
    id: "settings-fixture",
    packName: "Settings fixture",
    version: 1,
    engine: "graph",
    config: [
      { key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 5 },
      { key: "preset", label: "preset", type: "select", values: [["a", "A"], ["b", "B"]], default: "a" },
    ],
  };
}

export const HEADLINES_PACK: PluginView = { id: "headlines", packName: "Headlines", version: 1, engine: "graph", config: [{ key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 5 }], instances: [{ id: "alt", name: "Alt feed" }] };
export const ALT_FEED_INSTANCE: PluginInstance = { id: "alt", name: "Alt feed" };
