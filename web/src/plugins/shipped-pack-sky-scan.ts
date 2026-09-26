import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Shipped packs that ship `sky/fragment.glsl` (via `plugin.yml` home). Update when adding a sky pack. */
export const PINNED_SHIPPED_PACK_SKY_IDS = [
  "backrooms",
  "blob-mesh",
  "cypher-cic",
  "hn-rain",
  "hn-term",
  "kefrens-bars",
  "marble-run",
  "nixie-clock",
  "packet-tunnel",
  "rf-constellation",
  "roto-proto",
  "star-sines",
  "stereo-gram",
  "syscon",
  "talker-storm",
] as const;

export type ShippedPackSkyFragment = {
  packId: string;
  pluginYmlPath: string;
  skyFragmentPath: string;
  source: string;
};

function parsePluginIdFromYml(yml: string, dirName: string): string {
  const m = yml.match(/^id:\s*(\S+)/m);
  return m?.[1] ?? dirName;
}

/** Shipped catalog homes: ``plugins/src/<dir>/plugin.yml``. */
export function listShippedPackHomes(repoRoot: string): string[] {
  const packsSrc = path.join(repoRoot, "plugins/src");
  return readdirSync(packsSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(packsSrc, e.name))
    .filter((home) => existsSync(path.join(home, "plugin.yml")))
    .sort();
}

/** Mirrors service ``optional_part_flags`` ``has_sky_shader`` (fragment on disk under pack home). */
export function packHomeDeclaresSkyShader(packHome: string): boolean {
  return existsSync(path.join(packHome, "sky", "fragment.glsl"));
}

export function countShippedPacksDeclaringSkyShader(repoRoot: string): number {
  return listShippedPackHomes(repoRoot).filter(packHomeDeclaresSkyShader).length;
}

/**
 * Read each shipped pack's sky GLSL as text from disk (never bundler imports under ``plugins/src``).
 * Discovery walks ``plugin.yml`` per pack directory, same as the Python catalog inspect.
 */
export function scanShippedPackSkyFragments(repoRoot: string): ShippedPackSkyFragment[] {
  const out: ShippedPackSkyFragment[] = [];
  for (const packHome of listShippedPackHomes(repoRoot)) {
    const pluginYmlPath = path.join(packHome, "plugin.yml");
    const yml = readFileSync(pluginYmlPath, "utf8");
    const packId = parsePluginIdFromYml(yml, path.basename(packHome));
    if (!packHomeDeclaresSkyShader(packHome)) continue;
    const skyFragmentPath = path.join(packHome, "sky", "fragment.glsl");
    out.push({
      packId,
      pluginYmlPath,
      skyFragmentPath,
      source: readFileSync(skyFragmentPath, "utf8"),
    });
  }
  return out.sort((a, b) => a.packId.localeCompare(b.packId));
}
