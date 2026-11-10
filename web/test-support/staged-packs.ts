import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * tests/shipped_catalog.py STAGED_SHIPPED_PLUGIN_IDS that are on disk (sorted): packs whose host
 * support merged ahead of their pack-only PR. Shipped-pack pins add these to their counts.
 */
export function stagedShippedPackIds(repoRoot: string): string[] {
  const py = readFileSync(path.join(repoRoot, "tests/shipped_catalog.py"), "utf8");
  const body = py.match(/STAGED_SHIPPED_PLUGIN_IDS[^=]*=\s*\(([\s\S]*?)\)/)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((id) => existsSync(path.join(repoRoot, "plugins/src", id, "plugin.yml")))
    .sort();
}
