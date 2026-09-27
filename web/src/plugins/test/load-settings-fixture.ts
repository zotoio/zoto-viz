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
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "yaml";
import { toPluginView } from "../plugin-visualisation";
import type { PluginView } from "../plugin";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Catalog row shape: plugin.yml identity + visualisation.yml body. */
  const plugin = yaml.parse(readFileSync(join(DIR, "../fixtures/settings-decl-pack/plugin.yml"), "utf8"));
  const visualisation = yaml.parse(readFileSync(join(DIR, "../fixtures/settings-decl-pack/visualisation.yml"), "utf8"));
  return toPluginView({ ...plugin, visualisation });
