import type { PluginInstance } from "../../src/plugins/instances";
import type { PluginView } from "../../src/plugins/plugin";

/** Headlines pack with an Alt feed instance row (outside web/src for PR #73 fixtures). */
export const HEADLINES_PACK: PluginView = {
  id: "headlines",
  packName: "Headlines",
  version: 1,
  engine: "graph",
  config: [{ key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 5 }],
  instances: [{ id: "alt", name: "Alt feed" }],
};

export const ALT_FEED_INSTANCE: PluginInstance = { id: "alt", name: "Alt feed" };
