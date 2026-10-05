/**
 * Each tile's `cant-draw` view state from the host's draw events (#171 c / #179):
 * - the shared context is lost: every tile on the host is `cant-draw` / `context-lost`, and gets
 *   `reload: true` once the wall notice offers Reload;
 * - the context is back and a real frame drew (the moment the wall notice clears): each tile goes
 *   back to what it showed before, else `ready`;
 * - one tile's shader failed: that tile alone is `cant-draw` / `shader`, until its shader compiles
 *   or its pack is swapped or cleared.
 * The graph layer only emits; this is the one place those events become view state.
 * A lost context's tile ids go through `viewStateTileKey`, so the main scene's tile "main" lands on
 * the mosaic pane holding `#scene` (its line, Retry and state), as every other pane's does.
 */

import type { TileDrawEvent } from "../graph/render-host";
import { assertNever, enterCantDrawShader, enterContextLost, leaveCantDrawShader, leaveContextLost, viewStateTileKey } from "./view-state";

/** The tiles an event names, as view-state keys, once each. */
const keys = (ids: readonly string[]): string[] => [...new Set(ids.map(viewStateTileKey))];

export type TileDrawSource = { onDrawEvent(fn: (e: TileDrawEvent) => void): () => void };

export function bindCantDrawViewState(host: TileDrawSource): () => void {
  /** Tiles this loss marked (a tile torn down while lost still leaves context-lost on restore). */
  const lost = new Set<string>();
  return host.onDrawEvent((e) => {
    switch (e.type) {
      case "context-lost":
        for (const id of keys(e.tileIds)) {
          lost.add(id);
          enterContextLost(id);
        }
        return;
      case "reload-offered":
        for (const id of new Set([...lost, ...keys(e.tileIds)])) {
          lost.add(id);
          enterContextLost(id, { reload: true });
        }
        return;
      case "context-drawn":
        for (const id of new Set([...lost, ...keys(e.tileIds)])) leaveContextLost(id);
        lost.clear();
        return;
      case "shader-failed":
        enterCantDrawShader(e.tileId, e.packId, e.log);
        return;
      case "shader-cleared":
        leaveCantDrawShader(e.tileId);
        return;
      default:
        assertNever(e);
    }
  });
}
