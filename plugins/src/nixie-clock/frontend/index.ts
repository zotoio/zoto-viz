/** IN-18 Nixie clock — local time packed into sky slots. */

import type { VizDataFrame, VizZotoPluginHooks } from "../../../sdk/viz-contract";
void (null as VizZotoPluginHooks | null);
import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();

/*
 * Slot 0 (tube digits, look, canvas, LAN pulse) is host-owned: the host mirrors this
 * pack's frame handler (runPackFrameHandler "nixie-clock") from the shared wall clock
 * and the view's look options. The pack always runs in the sandboxed iframe, so it only
 * writes its uniforms here and never probes the embedding page (#187).
 */
host.onFrame = (frame: VizDataFrame) => {
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [1.0, 0.38, 0.06]);
  host.writeUniform("uBg", [0.06, 0.03, 0.02]);
};
