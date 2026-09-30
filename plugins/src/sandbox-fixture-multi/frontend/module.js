import { pulse } from "./helper.js";
import fixture from "./fixture.js";

const z = globalThis.zoto;

function writeBright() {
  z.writeUniform("uBright", fixture.bright * pulse());
}

// No viz.presentTick in plugin.yml, so the host sends no present ticks: write on data frames too,
// otherwise tile health sees frames arriving with no viz writes and heals the view to Topology (#180).
z.onFrame = writeBright;
z.onPresent = writeBright;
