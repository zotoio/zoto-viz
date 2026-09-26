import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "yaml";
import { toPluginView } from "../plugin-visualisation";
import type { PluginView } from "../plugin";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Catalog row shape: plugin.yml identity + visualisation.yml body. */
export function loadSettingsDeclFixture(): PluginView {
  const plugin = yaml.parse(readFileSync(join(DIR, "settings-decl-pack/plugin.yml"), "utf8"));
  const visualisation = yaml.parse(readFileSync(join(DIR, "settings-decl-pack/visualisation.yml"), "utf8"));
  return toPluginView({ ...plugin, visualisation });
}
