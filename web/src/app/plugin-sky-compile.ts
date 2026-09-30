import type { PackSkyMeta } from "../graph/scene";

/** A tile's sky install: NetScene's `setPluginShader` with its pack. */
export type TileSkyTarget = {
  setPluginShader(opts: { id: string; source: string }, meta: PackSkyMeta): string | null;
};

/**
 * Install a pack's sky fragment on a tile, with the pack it belongs to (#171 c / #179). The pack is
 * what makes the host begin the tile's pack and probe the compile, so a sky that fails to compile
 * mounts the tile's fallback and puts the tile in cant-draw (reason `shader`, this pack's id).
 * Returns the compile error, or null.
 */
export function installTileSkyShader(
  target: TileSkyTarget,
  spec: { id: string; name: string },
  source: string,
  packKey: string,
): string | null {
  return target.setPluginShader(
    { id: spec.id, source },
    { packId: spec.id, packName: spec.name || spec.id, packKey, isShaderPack: true },
  );
}
