/**
 * Type-level brand checks for viz clocks (TSE #95: lives under web/typecheck/, not web/src tests).
 */
import { monoMs } from "../src/core/viz-time";
import { buildVizFrame } from "../src/plugins/viz-host";
import { vizWallMs } from "../src/core/viz-clock";
import { fatLanFixture } from "../src/plugins/fixtures/fat-lan-state";

const state = fatLanFixture();
const frameT = 1_700_000_000;

void buildVizFrame(state, monoMs(frameT), 0).dt;
void buildVizFrame(state, monoMs(vizWallMs()), 0).dt;
