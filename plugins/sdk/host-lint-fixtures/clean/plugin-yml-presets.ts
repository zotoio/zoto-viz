import { readFileSync } from "node:fs";
import path from "node:path";

/** Host reads pack metadata from shipped YAML — no import from plugins/src. */
export function readPackDisplayName(repoRoot: string, packId: string): string {
  const yml = readFileSync(
    path.join(repoRoot, "plugins/src", packId, "plugin.yml"),
    "utf8",
  );
  const m = yml.match(/^name:\s*(.+)\s*$/m);
  return m?.[1]?.trim() ?? packId;
}
