import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { describe, expect, it } from "vitest";
import { toPluginView } from "./plugin-visualisation";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function shippedPackHomes(): string[] {
  const packsSrc = path.join(repoRoot, "plugins/src");
  return readdirSync(packsSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(packsSrc, e.name))
    .filter((home) => existsSync(path.join(home, "plugin.yml")))
    .sort();
}

describe("shipped pack visualisation engines", () => {
  it("loads every shipped plugin.yml with visualisation.yml and no unknown engine", () => {
    const engineErrors: string[] = [];
    for (const home of shippedPackHomes()) {
      const vizPath = path.join(home, "visualisation.yml");
      if (!existsSync(vizPath)) continue;
      const packId = path.basename(home);
      const pluginYml = yaml.parse(readFileSync(path.join(home, "plugin.yml"), "utf8")) as Record<
        string,
        unknown
      >;
      const visualisation = yaml.parse(readFileSync(vizPath, "utf8")) as Record<string, unknown>;
      try {
        toPluginView({ ...pluginYml, visualisation });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("visualisation.engine")) {
          engineErrors.push(`${packId}: ${msg}`);
          continue;
        }
        throw e;
      }
    }
    expect(engineErrors).toEqual([]);
  });
});
