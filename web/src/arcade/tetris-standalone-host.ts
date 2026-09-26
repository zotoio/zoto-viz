import type { FrameTs } from "../core/time-ms";
import type { BackdropKind } from "../graph/backdrop";
import type { NetScene } from "../graph/scene";
import type { TetrisView } from "./tetris";

/** Static lit far-field sky for Tetris on #47 (photo/crossfade work lives on the backdrop PR). */
export const TETRIS_TILE_BACKDROP: BackdropKind = "space";

/** Wire Tetris as a 1×1 host tile: main scene idles (no graph render), host loop ticks the well. */
export function bindTetrisStandaloneHost(scene: NetScene, view: TetrisView): void {
  scene.setStageOnly(false);
  scene.setActive(false);
  scene.setAnim({ ...scene.dreamAnim, backdrop: TETRIS_TILE_BACKDROP });
  scene.setStandaloneTileTick((dtSec, presentTs) => {
    view.hostFrameTick(presentTs, dtSec);
  });
}

export function unbindTetrisStandaloneHost(scene: NetScene): void {
  scene.setStandaloneTileTick(null);
  scene.setActive(true);
}
