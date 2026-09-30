import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
host.onFrame = (frame) => {
  // No sky/*.glsl ships with this pack, so there is no shader to bind uAudio to.
  host.writeUniform("uAudio", frame.audio);
};
