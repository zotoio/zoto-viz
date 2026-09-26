import type { NetScene } from "../graph/scene";
import type { TetrisView } from "./tetris";

/** Wire Tetris as a 1×1 host tile: main scene idles (no graph render), host loop ticks the well. */
export function bindTetrisStandaloneHost(scene: NetScene, view: TetrisView): void {
  scene.setStageOnly(false);
  scene.setActive(false);
  scene.setStandaloneTileTick((dtSec) => {
    view.hostFrameTick(dtSec);
  });
}

export function unbindTetrisStandaloneHost(scene: NetScene): void {
  scene.setStandaloneTileTick(null);
  scene.setActive(true);
}
