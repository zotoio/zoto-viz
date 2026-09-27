/**
 * Type-level brand checks for viz clocks (TSE #95: lives under web/typecheck/, not web/src tests).
 */
import { monoMs } from "../src/core/viz-time";
import { buildVizFrame } from "../src/plugins/viz-host";
import { vizWallMs } from "../src/core/viz-clock";
import { fatLanFixture } from "../src/plugins/fixtures/fat-lan-state";

const state = fatLanFixture();
const frameT = 1_700_000_000;

// @ts-expect-error frame.t is EpochSec/plain, not MonoMs
buildVizFrame(state, frameT, 0);
// @ts-expect-error vizWallMs is wall clock, not monotonic MonoMs
buildVizFrame(state, vizWallMs(), 0);
void buildVizFrame(state, monoMs(0), 0).dt;
