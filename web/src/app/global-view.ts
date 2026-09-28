import type { PluginLook } from "../plugins/plugin";
import { pluginWall } from "../plugins/plugin";

/**
 * Header and digit picks on a wall leave the mosaic for one full-screen view.
 * A catalog wall (Syscon, Cypher CIC) stays a wall — that view is the mosaic.
 */
export function globalViewLeavesMosaic(mosaicOn: boolean, look: PluginLook | null | undefined): boolean {
  if (!mosaicOn) return false;
  return !pluginWall(look);
}
