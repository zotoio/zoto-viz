/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "yaml";
import { toPluginView } from "../plugin-visualisation";
import type { PluginInstance } from "../instances";
import type { PluginView } from "../plugin";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Catalog row shape: plugin.yml identity + visualisation.yml body. */
export function loadSettingsDeclFixture(): PluginView {
  const plugin = yaml.parse(readFileSync(join(DIR, "../fixtures/settings-decl-pack/plugin.yml"), "utf8"));
  const visualisation = yaml.parse(readFileSync(join(DIR, "../fixtures/settings-decl-pack/visualisation.yml"), "utf8"));
  return toPluginView({ ...plugin, visualisation });
}

export const HEADLINES_PACK: PluginView = {
  id: "headlines",
  name: "Headlines",
  packName: "Headlines",
  version: 1,
  engine: "graph",
  config: [{ key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 5 }],
  instances: [{ id: "alt", name: "Alt feed" }],
};
export const ALT_FEED_INSTANCE: PluginInstance = { id: "alt", name: "Alt feed" };
