import { pulse } from "./helper.js";
import fixture from "./fixture.js";

const z = globalThis.zoto;

// The sky (sky/fragment.glsl) takes all its brightness from uBright, so the fixture value is what
// lights the board. helper.js's pulse only sways the sky's stripes, through slot 0.
function write() {
  z.writeUniform("uBright", fixture.bright);
  z.writeBuffer(0, [pulse()]);
}

// No viz.presentTick in plugin.yml, so the host sends no present ticks: write on data frames too,
// otherwise tile health sees frames arriving with no viz writes and heals the view to Topology (#180).
z.onFrame = write;
z.onPresent = write;
